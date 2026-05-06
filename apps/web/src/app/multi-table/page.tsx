'use client';

import { useState } from 'react';
import { MultiTableGrid } from '@/components/poker/MultiTableGrid';

export default function MultiTablePage() {
  const [ids, setIds] = useState<string[]>([]);
  const [input, setInput] = useState('');

  if (ids.length > 0) {
    return <MultiTableGrid tableIds={ids} onClose={(id) => setIds(ids.filter(x => x !== id))} />;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">Multi-tabling</h1>
      <p className="mt-2 text-white/70">Paste up to 24 table IDs separated by commas, or pick from your active sessions.</p>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="abc-123, def-456, …"
        className="mt-4 w-full rounded-md bg-white/5 p-3 ring-1 ring-white/10"
        rows={4}
      />
      <button
        className="mt-3 btn btn-primary"
        onClick={() => setIds(input.split(/[\s,]+/).filter(Boolean).slice(0, 24))}
      >
        Open all
      </button>
    </main>
  );
}
