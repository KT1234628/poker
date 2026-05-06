'use client';

import { useState } from 'react';

export function ChatPanel({
  messages,
  onSend,
}: {
  messages: Array<{ user: string; content: string; ts: number }>;
  onSend: (content: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  return (
    <div className="fixed bottom-32 right-4 z-20 w-72 max-w-[90vw]">
      <button onClick={() => setOpen(o => !o)} className="btn btn-ghost mb-2 w-full">
        {open ? 'Hide chat' : `💬 Chat (${messages.length})`}
      </button>
      {open && (
        <div className="flex h-64 flex-col rounded-lg border border-white/10 bg-black/80 backdrop-blur">
          <div className="flex-1 space-y-1 overflow-y-auto p-2 text-xs">
            {messages.map((m, i) => (
              <p key={i}>
                <span className="font-semibold text-gold-400">{m.user}:</span> {m.content}
              </p>
            ))}
          </div>
          <form
            onSubmit={e => {
              e.preventDefault();
              if (text.trim()) {
                onSend(text);
                setText('');
              }
            }}
            className="flex border-t border-white/10"
          >
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={280}
              placeholder="Say nice things…"
              className="flex-1 bg-transparent px-3 py-2 text-sm outline-none"
            />
          </form>
        </div>
      )}
    </div>
  );
}
