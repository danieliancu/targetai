// pages/index.js
import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hello! What course, location, or dates are you looking for?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    if (!input.trim()) return;
    const userMsg = { role: "user", content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: userMsg.content, context: messages }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Request failed");

      // Render links as simple bullets if present
      const reply = data.reply || "";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `Sorry—something went wrong. ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function onKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }

  return (
    <div className="wrap">
      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="e.g. 'SMSTS in Stratford next month' or 'HSA online anytime'"
        />
        <button onClick={send} disabled={loading}>{loading ? "..." : "Send"}</button>
      </div>

      <style jsx>{`
        .wrap { max-width: 820px; margin: 40px auto; padding: 0 16px; }
        .chat { min-height: 60vh; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; background: #fafafa; overflow-y: auto; }
        .bubble { max-width: 80%; padding: 10px 12px; margin: 8px 0; border-radius: 10px; line-height: 1.35; white-space: pre-wrap; }
        .bubble.assistant { background: #fff; border: 1px solid #e5e7eb; }
        .bubble.user { background: #e6f2ff; margin-left: auto; border: 1px solid #d7e8ff; }
        .composer { display: flex; gap: 8px; margin-top: 12px; }
        textarea { flex: 1; min-height: 56px; resize: vertical; padding: 10px; border-radius: 10px; border: 1px solid #d1d5db; }
        button { padding: 0 16px; border-radius: 10px; border: 1px solid #2563eb; background: #2563eb; color: white; height: 44px; }
        button:disabled { opacity: 0.5; }
      `}</style>
    </div>
  );
}
