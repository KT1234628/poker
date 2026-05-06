'use client';

import { useEffect, useState } from 'react';

export function ShowdownChoiceModal({ open, onChoice, deadlineMs }: {
  open: boolean;
  onChoice: (c: 'show_both' | 'show_one_high' | 'show_one_low' | 'muck') => void;
  deadlineMs: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [open]);
  if (!open) return null;
  const remaining = Math.max(0, deadlineMs - now);
  const pct = Math.min(100, (remaining / 8000) * 100);

  return (
    <div className="fixed inset-x-4 bottom-32 z-40 mx-auto max-w-sm rounded-lg border border-gold-500/60 bg-black/95 p-4 backdrop-blur">
      <h3 className="font-display text-base font-bold">Show or muck?</h3>
      <p className="mt-1 text-xs text-white/60">You won uncontested. You can reveal your hand to taunt or to advertise.</p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gold-500" style={{ width: `${pct}%` }} /></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => onChoice('show_both')} className="btn btn-primary">Show both</button>
        <button onClick={() => onChoice('show_one_high')} className="btn btn-ghost">Show high card</button>
        <button onClick={() => onChoice('show_one_low')} className="btn btn-ghost">Show low card</button>
        <button onClick={() => onChoice('muck')} className="btn btn-danger">Muck</button>
      </div>
    </div>
  );
}
