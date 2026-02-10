// src/ChatWithPDF.js
import React, { useEffect, useState, useRef } from "react";
import { API_URL } from "../config";
import "./ChatWithPDF.css";


export default function ChatWithPDF({ pdfId }) {
  const storageKey = `chat_history_${pdfId}`;
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) setMessages(JSON.parse(saved));
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(messages));
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, storageKey]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;

    const userMsg = { id: Date.now(), sender: "user", text: question };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);
    setQuestion("");

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_id: pdfId, question }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const { answer } = await res.json();
      setMessages((m) => [...m, { id: Date.now() + 1, sender: "bot", text: answer }]);
    } catch (err) {
      console.error("Erreur chat:", err);
      setMessages((m) => [
        ...m,
        { id: Date.now() + 1, sender: "bot", text: "❌ Erreur serveur" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>🤖 Chat avec le document</h2>
        <button onClick={() => { localStorage.removeItem(storageKey); setMessages([]); }}>
          🗑️ Effacer
        </button>
      </div>

      <div className="chat-messages">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-msg ${m.sender}`}
          >
            {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="chat-input" onSubmit={handleSubmit}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Pose ta question..."
        />
        <button type="submit" disabled={loading}>
          {loading ? "..." : "Envoyer"}
        </button>
      </form>
    </div>
  );
}
