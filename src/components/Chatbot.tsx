import { useState, useRef, useEffect } from "react";
import { Send, Bot, User as UserIcon, Loader2, Volume2, VolumeX } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";
import { Circular } from "../types";

export default function Chatbot({ 
  circulars, 
  onViewPdf 
}: { 
  circulars: Circular[], 
  onViewPdf: (circular: Circular) => void 
}) {
  const [messages, setMessages] = useState<{ 
    role: "user" | "bot", 
    text: string,
    references?: Circular[]
  }[]>([
    { role: "bot", text: "Welcome to the VTU Smart Assistant. I am an advanced AI system indexed with thousands of circulars. How can I help you today?" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const speak = (text: string, index: number) => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (isSpeaking === index) {
        setIsSpeaking(null);
        return;
      }
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setIsSpeaking(null);
    setIsSpeaking(index);
    window.speechSynthesis.speak(utterance);
  };

  const suggestedQuestions = [
    "Latest Exam Notifications",
    "Ph.D. Research Extension",
    "Academic Calendar 2025-26",
    "AICTE Activity Points"
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setMessages(prev => [...prev, { role: "user", text: userMessage }]);
    setInput("");
    setLoading(true);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
      
      const genAI = new GoogleGenAI({ apiKey });
      
      // Advanced Search: Multi-Stage Filtering
      const searchInput = userMessage.toLowerCase();
      
      // 1. Direct Keyword Match
      const directMatches = circulars.filter(c => 
        (c.title.toLowerCase().includes(searchInput))
      );

      // 2. Fuzzy / Semantic Word Match
      const fuzzyMatches = circulars.filter(c => {
        const words = searchInput.split(" ").filter(w => w.length > 3);
        return words.some(word => c.title.toLowerCase().includes(word));
      });

      // Combine and deduplicate
      const allRelevant = Array.from(new Set([...directMatches, ...fuzzyMatches])).slice(0, 10);

      // Create a global overview of what's available
      const repositoryOverview = circulars.slice(0, 30).map(c => `- ${c.title}`).join("\n");

      const contextStr = allRelevant.length > 0 
        ? "Detailed Document Context:\n" + allRelevant.map(c => `[DOC]: ${c.title}\nID: ${c.id}\nDATE: ${c.date ? c.date.split('T')[0] : 'N/A'}\nSNIPPET: ${c.content?.substring(0, 1200) || "No text extracted"}`).join("\n\n")
        : "No direct matches found. However, I have access to the repository index. Suggest syncing if the user is looking for very new items.";

      const prompt = `
        You are the VTU Administrative Intelligence (VTU-AI). 
        Global Repository Status: ${circulars.length} total indexed documents.
        Recent Index Overview:
        ${repositoryOverview}

        Search Context for current query:
        ${contextStr}

        User Request: ${userMessage}

        CRITICAL OPERATING PROCEDURES:
        1. Be authoritative, professional, and precise.
        2. If you find a document that matches the query, verify details and provide a clear summary.
        3. Mention the "Date" clearly in your response (Format: YYYY-MM-DD, do not include time).
        4. If a specific status is asked (e.g., 'Has results been declared?'), and you don't see it in the context but see other related items, specify what is available.
        5. DO NOT use double asterisks (**) or markdown headers. Use plain, clean text with clear line breaks.
        6. Always emphasize that the user can use the "VIEW PDF" button below to see the original signed document.
        7. If multiple documents are relevant, list them clearly.
      `;

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      setMessages(prev => [...prev, { 
        role: "bot", 
        text: response.text || "I apologize, I am unable to generate a response at this time.",
        references: allRelevant
      }]);
    } catch (error: any) {
      console.error("Chat error:", error);
      
      let errorText = "System Error: " + error.message;
      if (error.message?.includes("RESOURCE_EXHAUSTED") || error.status === 429) {
        errorText = "Spending Cap Exceeded: Your project has reached its monthly spending limit in Google AI Studio. Please visit https://ai.studio/spend to manage your project settings.";
      }
      
      setMessages(prev => [...prev, { role: "bot", text: errorText }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-app">
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4 md:space-y-6 scrollbar-thin">
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div 
              key={i} 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 md:gap-4 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              <div className={`w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center shrink-0 ${
                m.role === "bot" ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-600"
              }`}>
                {m.role === "bot" ? <Bot className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <UserIcon className="w-3.5 h-3.5 md:w-4 md:h-4" />}
              </div>
              <div className={`max-w-[85%] md:max-w-[80%] p-3 md:p-4 rounded-xl shadow-sm text-xs md:text-sm leading-relaxed relative group ${
                m.role === "bot" 
                  ? "bg-white border border-slate-200 text-slate-700 font-medium" 
                  : "bg-slate-800 text-white shadow-md"
              }`}>
                <div className="whitespace-pre-wrap">{m.text}</div>
                
                {m.role === "bot" && (
                  <button 
                    onClick={() => speak(m.text, i)}
                    className="absolute -right-10 top-0 p-2 text-slate-400 hover:text-primary transition-colors opacity-0 group-hover:opacity-100 hidden md:block"
                    title="Read Response"
                  >
                    {isSpeaking === i ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                )}
                
                {/* Reference list with cleaner layout */}
                {m.role === "bot" && m.references && m.references.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <div className="w-1 h-1 bg-primary rounded-full" />
                      DOCUMENT SOURCES
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {m.references.map((c, idx) => (
                        <div key={idx} className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 flex flex-col justify-between hover:border-primary/20 transition-all">
                          <div>
                            <div className="text-[11px] font-bold text-slate-800 line-clamp-1 mb-0.5">{c.title}</div>
                          </div>
                          <div className="flex justify-start items-center gap-2">
                             <button 
                               onClick={() => onViewPdf(c)} 
                               className="text-[10px] font-bold text-primary bg-white px-3 py-1 rounded-md border border-primary/20 hover:bg-primary hover:text-white transition-all shadow-sm"
                             >
                               VIEW PDF
                             </button>
                             <a href={c.link} target="_blank" rel="noopener noreferrer" className="text-[9px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-tighter">Official Link</a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {loading && (
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 md:p-6 bg-white border-t border-border-theme">
        <div className="max-w-4xl mx-auto">
          {/* Suggested Questions */}
          <div className="flex flex-wrap gap-2 mb-4 justify-center">
            {suggestedQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => { setInput(q); }}
                className="text-[10px] md:text-[11px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200 hover:border-primary hover:text-primary transition-all select-none"
              >
                {q}
              </button>
            ))}
          </div>

          <div className="flex gap-2 md:gap-3 bg-bg-app border border-border-theme p-1.5 md:p-2 rounded-xl">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask about a circular..."
              className="flex-1 bg-transparent px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm focus:outline-none"
            />
            <button 
              onClick={handleSend}
              disabled={loading}
              className="bg-primary text-white px-4 md:px-5 py-1.5 md:py-2 rounded-lg font-bold text-[10px] md:text-xs hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-1.5 md:gap-2 shadow-sm"
            >
              {loading ? <Loader2 className="w-3 md:w-3.5 h-3 md:h-3.5 animate-spin" /> : <Send className="w-3 md:w-3.5 h-3 md:h-3.5" />}
              <span className="hidden xs:inline">SEND</span>
            </button>
          </div>
          <div className="mt-2 md:mt-3 text-[9px] md:text-[10px] text-center text-text-muted font-medium uppercase tracking-widest px-4">
            Referencing local archive for speed and accuracy
          </div>
        </div>
      </div>
    </div>
  );
}
