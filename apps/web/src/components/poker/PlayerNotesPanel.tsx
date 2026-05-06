'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';

const COLORS = ['red','orange','yellow','green','blue','purple','gray','pink'] as const;
type Color = typeof COLORS[number];

const SWATCH: Record<Color, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  gray: 'bg-gray-400',
  pink: 'bg-pink-500',
};

export function PlayerNotesPanel({ targetUserId, targetUsername, onClose }: { targetUserId: string; targetUsername: string; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [color, setColor] = useState<Color | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch(`/api/notes?targetUserId=${targetUserId}`)
      .then(r => r.json())
      .then(j => {
        const n = j.notes;
        if (n) {
          setNote(n.note ?? '');
          setColor((n.color_tag ?? null) as Color | null);
        }
      });
  }, [targetUserId]);

  async function save() {
    setSaving(true);
    await fetch('/api/notes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUserId, note, colorTag: color }),
    });
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-black/95 p-4" onClick={e => e.stopPropagation()}>
        <h3 className="mb-1 font-display text-lg font-bold">Notes on @{targetUsername}</h3>
        <p className="mb-3 text-xs text-white/60">Private to you. Visible at every table you sit at with this player.</p>

        <div className="mb-3 flex flex-wrap gap-2">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(color === c ? null : c)}
              className={clsx('h-6 w-6 rounded-full ring-2', SWATCH[c], color === c ? 'ring-white' : 'ring-transparent')}
              aria-label={`Tag ${c}`}
            />
          ))}
        </div>

        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Plays tight pre. 3-bets light from button."
          rows={6}
          className="w-full rounded-md bg-white/5 p-3 text-sm ring-1 ring-white/10 focus:ring-gold-500"
        />

        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? '…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
