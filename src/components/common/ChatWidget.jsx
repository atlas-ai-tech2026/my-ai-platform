import React, { useState, useRef, useEffect } from 'react';
import { X, MessageCircle, Send } from 'lucide-react';

const initialMessages = [
  { role: 'assistant', text: 'Hi! 👋 How can we help you today?' }
];

export function openChat() {
  window.__voxelChatOpen?.();
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    window.__voxelChatOpen = () => setOpen(true);
    return () => { delete window.__voxelChatOpen; };
  }, []);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInput('');
    // Placeholder AI response — connect to your AI customer service here
    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Thanks for reaching out! Our team will get back to you shortly.' }]);
    }, 800);
  };

  return (
    <>
      {/* Chat Bubble Button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-[200] w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-300"
        style={{ background: '#E01E1E' }}
        aria-label="Open chat"
      >
        {open ? <X size={22} className="text-white" /> : <MessageCircle size={22} className="text-white" />}
      </button>

      {/* Chat Box */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-[200] w-80 rounded-2xl overflow-hidden flex flex-col shadow-2xl animate-scale-in"
          style={{ background: '#111', border: '1px solid #2A2A2A', maxHeight: '420px' }}
        >
          {/* Header */}
          <div className="px-4 py-3 flex items-center gap-3" style={{ background: '#E01E1E' }}>
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <MessageCircle size={16} className="text-white" />
            </div>
            <div>
              <p className="text-white text-sm font-bold">VOXEL Support</p>
              <p className="text-white/70 text-xs">Q&A · We're here to help</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ minHeight: '200px', maxHeight: '280px' }}>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed"
                  style={{
                    background: msg.role === 'user' ? '#E01E1E' : '#1a1a1a',
                    color: '#fff',
                    border: msg.role === 'assistant' ? '1px solid #2A2A2A' : 'none'
                  }}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 flex gap-2 items-center" style={{ borderTop: '1px solid #2A2A2A' }}>
            <input
              className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-gray-600"
              placeholder="Type a message..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
            />
            <button
              onClick={send}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
              style={{ background: input.trim() ? '#E01E1E' : '#2A2A2A' }}
            >
              <Send size={14} className="text-white" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}