/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  setDoc,
  serverTimestamp,
  getDocs,
  writeBatch
} from "firebase/firestore";
import { Search, Loader2, RefreshCw, FileText, Download, Eye, Globe, Trash2, Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { db } from "./firebase";
import { Circular } from "./types";
import Chatbot from "./components/Chatbot";

export default function App() {
  const [circulars, setCirculars] = useState<Circular[]>([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedYear, setSelectedYear] = useState<number | "all">("all");
  const [showYearFilter, setShowYearFilter] = useState(false);
  const [selectedPdf, setSelectedPdf] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    setLoading(false);
  }, []);

  useEffect(() => {
    // Get all circulars. Using orderBy on a field that might be missing (like 'date') 
    // will filter out those documents. We'll fetch all and sort in memory.
    const q = query(collection(db, "circulars"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Circular));
      
      // Sort chronologically by date (newest first), fallback to createdAt
      const sorted = [...docs].sort((a, b) => {
        const getVal = (item: Circular) => {
          if (item.date) {
            const d = new Date(item.date).getTime();
            if (!isNaN(d)) return d;
          }
          if (item.createdAt) {
            // Firestore Timestamp or JS Date
            return (item.createdAt as any).toMillis ? (item.createdAt as any).toMillis() : new Date(item.createdAt).getTime();
          }
          return 0;
        };
        return getVal(b) - getVal(a);
      });
      
      setCirculars(sorted);
    });
    return () => unsubscribe();
  }, []);

  const [status, setStatus] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (status && !status.includes("Click again")) {
      const timer = setTimeout(() => setStatus(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const clearAllCirculars = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setStatus("Click again to confirm PERMANENT deletion");
      return;
    }
    
    try {
      setStatus("Wiping database collection...");
      setLoading(true);
      const response = await fetch("/api/circulars/clear", { 
        method: "POST"
      });
      
      const data = await response.json();
      if (data.success) {
        setCirculars([]);
        setStatus(`SUCCESS: Deleted ${data.count} records.`);
        setConfirmClear(false);
      } else {
        throw new Error(data.error || "Clear failed");
      }
    } catch (e: any) {
      setStatus("Error: " + e.message);
      setConfirmClear(false);
    } finally {
      setLoading(false);
    }
  };

  const startScrape = async () => {
    setScraping(true);
    setStatus("Starting system sync...");
    try {
      const response = await fetch("/api/scrape");
      const text = await response.text();
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error("Invalid server response");
      }
      
      if (data.success) {
        setStatus("Sync started in background. Documents will appear shortly.");
      } else {
        throw new Error(data.error || "Scrape failed");
      }
    } catch (error: any) {
      console.error("Scrape failed:", error);
      setStatus("Sync failed: " + error.message);
    } finally {
      setScraping(false);
    }
  };

  const filteredCirculars = circulars.filter(c => {
    const matchesSearch = c.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (c.refNumber && c.refNumber.toLowerCase().includes(searchTerm.toLowerCase()));
    
    if (selectedYear === "all") return matchesSearch;
    
    if (c.date) {
      const year = new Date(c.date).getFullYear();
      return matchesSearch && year === selectedYear;
    }
    return matchesSearch && selectedYear === "all";
  });

  const extractedYears: number[] = circulars
    .map(c => c.date ? new Date(c.date).getFullYear() : null)
    .filter((y): y is number => typeof y === 'number');
  
  const years: number[] = Array.from(new Set(extractedYears)).sort((a, b) => b - a);

  const getPdfPreviewUrl = (url: string) => {
    if (url.toLowerCase().endsWith(".pdf") || url.includes("wp-content/uploads")) {
      return `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;
    }
    return url;
  };

  const handleViewPdf = async (circular: any) => {
    if (circular.pdfUrl) {
      setSelectedPdf(circular.pdfUrl);
      return;
    }

    try {
      const response = await fetch("/api/get-pdf-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postUrl: circular.link })
      });
      const data = await response.json();
      if (data.pdfUrl) {
        setSelectedPdf(data.pdfUrl);
        setDoc(doc(db, "circulars", circular.id), { pdfUrl: data.pdfUrl }, { merge: true });
      } else {
        alert("Could not find a PDF on that page. Opening website...");
        window.open(circular.link, "_blank");
      }
    } catch (e) {
      console.error(e);
      window.open(circular.link, "_blank");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#E4E3E0]">
        <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-bg-app overflow-hidden relative">
      {/* PDF Modal */}
      <AnimatePresence>
        {selectedPdf && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 md:p-8"
            onClick={() => setSelectedPdf(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-5xl h-full rounded-2xl shadow-2xl overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                <h3 className="font-bold text-slate-800 truncate pr-4">PDF Preview</h3>
                <button 
                  onClick={() => setSelectedPdf(null)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors font-bold"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 bg-slate-100">
                <iframe 
                  src={getPdfPreviewUrl(selectedPdf)} 
                  className="w-full h-full border-none"
                  title="PDF Preview"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar repository */}
      <aside className={`
        fixed inset-y-0 left-0 z-[70] w-80 bg-sidebar border-r border-border-theme flex flex-col shrink-0 overflow-hidden transition-transform duration-300 lg:relative lg:translate-x-0
        ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="p-4 md:p-6 border-b border-border-theme bg-white">
          <div className="flex items-center justify-between mb-2 lg:mb-4">
            <div className="text-sm font-bold uppercase tracking-wider text-primary tracking-widest text-[#555]">
              VTU SMART REPOSITORY
            </div>
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden p-1 hover:bg-slate-100 rounded"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
          <div className="text-xs text-text-muted flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {circulars.length} Circulars Available
          </div>
          
          <AnimatePresence>
            {status && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 text-[10px] font-bold bg-secondary/10 text-secondary px-3 py-1.5 rounded border border-secondary/20"
              >
                {status}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-4 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input 
                type="text" 
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-white border border-border-theme rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary/20 transition-all font-medium"
              />
            </div>
            <div className="relative">
              <button 
                onClick={() => setShowYearFilter(!showYearFilter)}
                className={`p-2 rounded-lg border border-border-theme bg-white hover:bg-slate-50 transition-colors ${selectedYear !== 'all' ? 'text-primary border-primary/30' : 'text-text-muted'}`}
              >
                <div className="flex flex-col items-center justify-center">
                  <span className="text-[8px] font-bold uppercase leading-none mb-0.5">Year</span>
                  <span className="text-[10px] font-bold leading-none">{selectedYear === "all" ? "ALL" : selectedYear}</span>
                </div>
              </button>
              <AnimatePresence>
                {showYearFilter && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowYearFilter(false)} />
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-32 bg-white border border-border-theme rounded-xl shadow-xl z-20 py-1 overflow-hidden"
                    >
                      <button 
                        onClick={() => { setSelectedYear("all"); setShowYearFilter(false); }}
                        className={`w-full text-left px-4 py-2 text-xs font-bold hover:bg-slate-50 ${selectedYear === "all" ? "text-primary bg-primary/5" : "text-slate-600"}`}
                      >
                        ALL YEARS
                      </button>
                      {years.map(year => (
                        <button 
                          key={year}
                          onClick={() => { setSelectedYear(year); setShowYearFilter(false); }}
                          className={`w-full text-left px-4 py-2 text-xs font-bold hover:bg-slate-50 ${selectedYear === year ? "text-primary bg-primary/5" : "text-slate-600"}`}
                        >
                          {year}
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
          <AnimatePresence initial={false}>
            {filteredCirculars.map((circular) => {
              const displayDate = circular.publishedDate ? new Date(circular.publishedDate) : (circular.date ? new Date(circular.date) : null);
              const day = displayDate ? displayDate.getDate() : "--";
              const month = displayDate ? displayDate.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase() : "---";
              const year = displayDate ? displayDate.getFullYear() : "----";

              return (
                <motion.div 
                  key={circular.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => circular.pdfUrl && setSelectedPdf(circular.pdfUrl)}
                  className="flex gap-4 p-4 mb-3 rounded-xl border border-border-theme bg-white hover:border-primary/30 hover:shadow-md cursor-pointer group transition-all"
                >
                  <div className="flex flex-col items-center justify-center w-12 h-12 md:w-14 md:h-14 bg-slate-50 border border-slate-100 rounded-lg shrink-0 group-hover:bg-primary/5 group-hover:border-primary/10 transition-colors">
                    <span className="text-lg md:text-xl font-bold text-orange-500 leading-none">{day}</span>
                    <span className="text-[7px] md:text-[8px] font-extrabold text-orange-400 mt-0.5 tracking-tighter">{month} {year}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <button 
                        onClick={() => handleViewPdf(circular)}
                        className="text-xs md:text-[13px] font-bold leading-snug text-slate-800 line-clamp-2 text-left hover:text-primary transition-colors flex items-start gap-2"
                      >
                        <FileText className="w-3.5 h-3.5 md:w-4 md:h-4 mt-0.5 shrink-0 text-slate-400" />
                        {circular.title}
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-2 mt-1">
                      <div className="text-[9px] font-bold text-primary bg-primary/5 px-1.5 py-0.5 rounded border border-primary/10 truncate max-w-[80px] md:max-w-none">
                        {circular.refNumber || "No Ref #"}
                      </div>
                      <div className="text-[9px] font-medium text-slate-400 truncate">
                        {displayDate ? displayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Syncing...'}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-3">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleViewPdf(circular); }}
                        className="p-1 px-2.5 bg-primary/10 text-primary text-[9px] md:text-[10px] font-bold rounded-lg flex items-center gap-1 hover:bg-primary/20 transition-colors"
                      >
                        <Eye className="w-2.5 h-2.5 md:w-3 md:h-3" /> PREVIEW
                      </button>

                      {circular.pdfUrl && (
                        <a 
                          href={circular.pdfUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 px-2.5 bg-emerald-50 text-emerald-700 text-[9px] md:text-[10px] font-bold rounded-lg flex items-center gap-1 hover:bg-emerald-100 transition-colors border border-emerald-100"
                        >
                          <Download className="w-2.5 h-2.5 md:w-3 md:h-3" /> DOWNLOAD
                        </a>
                      )}
                      
                      <a 
                        href={circular.link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 px-2.5 bg-slate-100 text-slate-600 text-[9px] md:text-[10px] font-bold rounded-lg flex items-center gap-1 hover:bg-slate-200 transition-colors"
                      >
                        <Globe className="w-2.5 h-2.5 md:w-3 md:h-3" /> SOURCE
                      </a>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {filteredCirculars.length === 0 && (
            <div className="p-8 text-center text-xs text-text-muted italic">
              No documents found
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border-theme space-y-2 bg-white">
          <button 
            onClick={startScrape}
            disabled={scraping}
            className="w-full bg-primary text-white text-xs font-bold py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
          >
            {scraping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            SYNC FROM VTU
          </button>
          <button 
            onClick={clearAllCirculars}
            disabled={loading || scraping}
            className={`w-full text-[10px] font-bold py-2 rounded-lg transition-all flex items-center justify-center gap-2 border shadow-sm ${
              confirmClear 
                ? "bg-red-600 text-white border-red-700 animate-pulse" 
                : "bg-red-50 text-red-600 border-red-100 hover:bg-red-100"
            }`}
          >
            <Trash2 className="w-3 h-3" />
            {confirmClear ? "CONFIRM WIPE" : "CLEAR ALL"}
          </button>
        </div>
      </aside>

      {/* Main Intelligence area */}
      <main className="flex-1 flex flex-col bg-white overflow-hidden w-full">
        <header className="h-14 lg:h-16 flex items-center justify-between px-4 lg:px-8 border-b border-border-theme shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 hover:bg-slate-50 rounded-lg text-slate-600"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-xs lg:text-sm font-bold text-text-main flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="hidden sm:inline">VTU ADMINISTRATION</span>
              <span className="sm:hidden">VTU ADMIN</span>
            </h2>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden md:flex items-center gap-2 px-2 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase rounded border border-emerald-100">
              Active Portal
            </div>
            <button 
              onClick={startScrape}
              disabled={scraping}
              className="flex items-center gap-2 px-2.5 py-1.5 lg:px-3 lg:py-1.5 bg-primary text-white text-[10px] font-bold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 shadow-sm"
            >
              {scraping ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              <span className="hidden xs:inline">SYNC VTU</span>
              <span className="xs:hidden">SYNC</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden relative">
          <Chatbot circulars={circulars} />
        </div>
      </main>
    </div>
  );
}
