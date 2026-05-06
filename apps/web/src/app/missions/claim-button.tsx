'use client';

import { useState } from 'react';

export function ClaimButton({ templateId }: { templateId: string }) {
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState(false);

  async function claim() {
    setBusy(true);
    const r = await fetch('/api/missions/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId }),
    });
    if (r.ok) setClaimed(true);
    setBusy(false);
  }

  if (claimed) return <span className="text-green-400">Claimed ✓</span>;
  return (
    <button onClick={claim} disabled={busy} className="rounded bg-gold-500 px-3 py-1 font-bold uppercase text-black hover:bg-gold-400">
      {busy ? '…' : 'Claim'}
    </button>
  );
}
