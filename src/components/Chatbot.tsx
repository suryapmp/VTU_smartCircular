import { useState, useRef, useEffect } from "react";
import { Send, Bot, User as UserIcon, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";
import { Circular } from "../types";

export default function Chatbot({ circulars }: { circulars: Circular[] }) {
  const [messages, setMessages] = useState<{ 
    role: "user" | "bot", 
    text: string,
    references?: Circular[]
  }[]>([
    { role: "bot", text: "Hello! I have indexed the VTU repository. You can search by reference number or ask questions about schedules, fees, or regulations." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      
      const relevantCirculars = circulars.filter(c => {
        const searchInput = userMessage.toLowerCase();
        return (
          (c.refNumber && searchInput.includes(c.refNumber.toLowerCase())) ||
          searchInput.split(" ").some(word => word.length > 3 && c.title.toLowerCase().includes(word)) ||
          (c.content && c.content.toLowerCase().includes(searchInput))
        );
      }).slice(0, 5);

      const contextStr = relevantCirculars.length > 0 
        ? "Context from relevant circulars (Internal PDF Content):\n" + relevantCirculars.map(c => `Title: ${c.title}\nRef: ${c.refNumber}\nContent Snippet: ${c.content?.substring(0, 1000) || "No text extracted yet"}\nLink: ${c.link}`).join("\n\n")
        : "No direct circular matches found in the local repository. If the user provided a reference number that I don't have yet, I should tell them to click Sync Repository.";

      const prompt = `
        You are a VTU Circular Intelligence Assistant.
        ${contextStr}

        User Question: ${userMessage}

        Instructions:
        1. Professional and concise.
        2. If relevant circulars are found, summarize key points and provide the title/ref.
        3. If no info is found, politely state that and suggest checking the official VTU site.
        4. ALWAYS mention the category if available (e.g., Administration, Academic, etc.).
        5. If a reference number is asked for, look for it through ALL indexed months/years available in context.
        6. IMPORTANT: DO NOT use any Markdown formatting like double asterisks (**) for bolding or symbols like '#' for headers. Use clean, plain text for readability.
        7. Maintain consistent spacing between points for a clean appearance.
      `;

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      setMessages(prev => [...prev, { 
        role: "bot", 
        text: response.text || "I apologize, I encountered an issue processing that.",
        references: relevantCirculars
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
      <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-thin">
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div 
              key={i} 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-4 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                m.role === "bot" ? "bg-primary text-white" : "bg-text-muted text-white"
              }`}>
                {m.role === "bot" ? <Bot className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
              </div>
              <div className={`max-w-[70%] p-4 rounded-xl shadow-sm text-sm leading-relaxed ${
                m.role === "bot" 
                  ? "bg-white border border-border-theme text-text-main" 
                  : "bg-primary text-white"
              }`}>
                <div className="whitespace-pre-wrap">{m.text}</div>
                
                {/* Preview Card logic using message references */}
                {m.role === "bot" && m.references && m.references.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border-theme space-y-2">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-tighter">Related Circulars</div>
                    {m.references.map((c, idx) => (
                      <div key={idx} className="bg-bg-app p-2 rounded border border-border-theme flex flex-col gap-1">
                        <div className="text-[11px] font-bold text-primary line-clamp-1">{c.title}</div>
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-mono text-secondary">{c.refNumber || "No Ref"}</span>
                          <div className="flex gap-2">
                             <a href={c.link} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-primary hover:underline">View Post</a>
                             {c.pdfUrl && <a href={c.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-secondary hover:underline">PDF</a>}
                          </div>
                        </div>
                      </div>
                    ))}
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

      <div className="p-6 bg-white border-t border-border-theme">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-3 bg-bg-app border border-border-theme p-2 rounded-xl">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask about a circular or search Ref No..."
              className="flex-1 bg-transparent px-4 py-2 text-sm focus:outline-none"
            />
            <button 
              onClick={handleSend}
              disabled={loading}
              className="bg-primary text-white px-5 py-2 rounded-lg font-bold text-xs hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              SEND
            </button>
          </div>
          <div className="mt-3 text-[10px] text-center text-text-muted font-medium uppercase tracking-widest">
            Referencing local archive for speed and accuracy
          </div>
        </div>
      </div>
    </div>
  );
}
