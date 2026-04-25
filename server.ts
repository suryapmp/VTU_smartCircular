import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as cheerio from "cheerio";
import { readFileSync, existsSync } from "fs";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, setDoc, doc, getDocs, deleteDoc, Timestamp, query, orderBy, limit, writeBatch } from "firebase/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase safely
let db: any = null;
const configPath = "./firebase-applet-config.json";
if (existsSync(configPath)) {
  try {
    const firebaseConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
    console.log("Firebase initialized successfully.");
  } catch (e) {
    console.error("Failed to initialize Firebase:", e);
  }
} else {
  console.warn("firebase-applet-config.json missing. Database operations will fail.");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Scrape VTU Circulars from multiple sources and store in Firestore
  app.get("/api/scrape", async (req, res) => {
    if (!db) {
      return res.status(503).json({ error: "Database not initialized" });
    }
    
    // Return immediately to avoid timeout
    res.json({ success: true, message: "Scrape started in background" });

    // Run scraping in background
    (async () => {
      try {
        console.log("Starting background scrape...");
        const allCirculars: any[] = [];
        const sources: string[] = [];
        
        const safeToISOString = (dateStr: string | null | undefined) => {
          if (!dateStr) return new Date().toISOString();
          const d = new Date(dateStr);
          return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
        };
        
        // Get existing links
        const existingSnapshot = await getDocs(collection(db, "circulars"));
        const existingLinks = new Set(existingSnapshot.docs.map(d => d.data().link));

        // administration category
        for (const cat of ["administration"]) {
          for (let p = 1; p <= 157; p++) {
            const url = p === 1 
              ? `https://vtu.ac.in/en/category/${cat}/` 
              : `https://vtu.ac.in/en/category/${cat}/page/${p}/`;
            
            try {
              const { data: html } = await axios.get(url, {
                headers: { "User-Agent": "Mozilla/5.0" },
                timeout: 10000
              });
              
              const $ = cheerio.load(html);
              const pageBatch: any[] = [];

              $("article, .post, .entry, .type-post, div[class*='post-']").each((i, el) => {
              const titleEl = $(el).find(".entry-title a, h2 a, h3 a, .title a");
              const title = titleEl.text().trim();
              const link = titleEl.attr("href");
              
              // Extract date exactly as per user's HTML snippet
              const metaDate = $(el).find(".entry-meta-date");
              const entryDay = metaDate.find(".entry-day").text().trim();
              const entryMonth = metaDate.find(".entry-month").text().trim();
              
              let publishedDate = null;
              if (entryDay && entryMonth) {
                // Combine: "25 Apr 2026"
                publishedDate = safeToISOString(`${entryDay} ${entryMonth}`);
              } else {
                // Fallbacks if snippet not found
                const dateAttr = $(el).find(".entry-date").first().attr("datetime") || 
                                $(el).find("time").first().attr("datetime");
                if (dateAttr) {
                  publishedDate = safeToISOString(dateAttr);
                } else {
                  const rawText = metaDate.text().trim();
                  if (rawText) publishedDate = safeToISOString(rawText);
                }
              }
              
              if (title && link && !existingLinks.has(link)) {
                const refMatch = title.match(/VTU\/[A-Z0-9\/_-]+/i) || 
                                 title.match(/VTU-[A-Z0-9\/_-]+/i);
                
                const refNumber = refMatch ? refMatch[0].trim() : null;
                
                pageBatch.push({ 
                  title, 
                  link, 
                  refNumber: refNumber || "",
                  date: publishedDate,
                  publishedDate: publishedDate 
                });
              }
            });

              if (pageBatch.length > 0) {
                for (const item of pageBatch) {
                  const docId = item.link.replace(/[^a-zA-Z0-9]/g, '_').slice(-128);
                  await setDoc(doc(db, "circulars", docId), {
                    ...item,
                    createdAt: Timestamp.now()
                  }, { merge: true });
                  existingLinks.add(item.link);
                }
              } else {
                // If no items on page, it's likely the end
                console.log(`No more items found on ${url}, stopping category.`);
                break;
              }
            } catch (err: any) {
              if (err.response?.status === 404) {
                console.log(`Page ${p} not found (404), stopping category.`);
                break;
              }
              console.error(`Error scraping ${url}:`, err.message);
            }
          }
        }
        console.log("Background scrape complete.");
      } catch (error: any) {
        console.error("Background scrape fatal error:", error.message);
      }
    })();
  });

  // Fetch from DB
  app.get("/api/circulars", async (req, res) => {
    if (!db) {
      return res.status(503).json({ error: "Database not initialized. Please check configuration." });
    }
    try {
      const q = query(collection(db, "circulars"), orderBy("date", "desc"), limit(1000));
      const snapshot = await getDocs(q);
      const circulars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json({ success: true, circulars });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Clear all circulars (Admin/Manual use)
  app.post("/api/circulars/clear", async (req, res) => {
    console.log("--- START DATABASE CLEAR ---");
    if (!db) {
      return res.status(503).json({ error: "Database not initialized" });
    }
    try {
      // Fetch documents in batches to avoid memory issues
      const snapshot = await getDocs(collection(db, "circulars"));
      const totalDocs = snapshot.size;
      console.log(`Documents found for deletion: ${totalDocs}`);

      if (totalDocs === 0) {
        return res.json({ success: true, count: 0, message: "Database is already empty." });
      }

      let deletedCount = 0;
      const batchSize = 500;
      const docs = snapshot.docs;

      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + batchSize);
        chunk.forEach(docSnap => {
          batch.delete(docSnap.ref);
          deletedCount++;
        });
        await batch.commit();
        console.log(`Deleted ${deletedCount} / ${totalDocs}`);
      }

      console.log("--- DATABASE CLEAR SUCCESS ---");
      res.json({ success: true, count: deletedCount });
    } catch (error: any) {
      console.error("CRITICAL ERROR during clear:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get direct PDF link from a circular's post page
  app.post("/api/get-pdf-link", async (req, res) => {
    const { postUrl } = req.body;
    if (!postUrl) return res.status(400).json({ error: "postUrl is required" });

    try {
      const { data: html } = await axios.get(postUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      });
      const $ = cheerio.load(html);
      
      let pdfUrl = "";
      
      // 1. Target links inside the main post content that specifically end in .pdf
      const entryContent = $(".entry-content");
      const attachmentLinks = entryContent.find("a[href$='.pdf']");
      
      if (attachmentLinks.length > 0) {
        // Try to filter out generic PDFs like visitor guides, logos, or maps
        for (let i = 0; i < attachmentLinks.length; i++) {
          const href = $(attachmentLinks[i]).attr("href") || "";
          const lowercaseHref = href.toLowerCase();
          const cleanTitle = $(attachmentLinks[i]).text().toLowerCase();
          
          const isGeneric = 
            lowercaseHref.includes("visitor") || 
            lowercaseHref.includes("logo") || 
            lowercaseHref.includes("map") ||
            lowercaseHref.includes("common") ||
            cleanTitle.includes("visitor") ||
            cleanTitle.includes("location");

          if (!isGeneric) {
            pdfUrl = href;
            break;
          }
        }
        
        // If all were generic, just take the first one as a last resort
        if (!pdfUrl) pdfUrl = attachmentLinks.first().attr("href") || "";
      }

      // 2. Fallback: search general attachment blocks if content search failed
      if (!pdfUrl) {
        const fallbackLinks = $(".attachments a, .wp-block-file a");
        if (fallbackLinks.length > 0) {
            pdfUrl = fallbackLinks.first().attr("href") || "";
        }
      }

      res.json({ pdfUrl });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Serving static files / Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
