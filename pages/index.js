// pages/index.js
import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hello! What course, location, or dates are you looking for?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

      const reply = data.reply || "";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `Sorry—something went wrong. ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="wrap">
      <div className="chat">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`bubble ${m.role}`}
            dangerouslySetInnerHTML={{ __html: m.content }}
          />
        ))}
        <div ref={bottomRef} />
        {/* padding so last message not hidden behind fixed composer */}
        <div style={{ height: 96 }} />
      </div>

      <div className="composer-bar">
        <div className="composer-inner">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="e.g. 'SMSTS in Stratford next month' or 'HSA online anytime'"
          />
          <button onClick={send} disabled={loading}>{loading ? "..." : "Send"}</button>
        </div>
      </div>
    </div>
  );
}
