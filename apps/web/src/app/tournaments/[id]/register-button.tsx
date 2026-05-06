'use client';

import { useState } from 'react';

export function TournamentRegisterButton({
  tournamentId,
  alreadyEntered,
  buyIn,
}: {
  tournamentId: string;
  alreadyEntered: boolean;
  buyIn: number;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (alreadyEntered) {
    return <span className="text-sm text-gold-400">✓ You are registered.</span>;
  }

  async function go() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/tournaments/${tournamentId}/register`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setMsg('Registered.');
      window.location.reload();
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={go} disabled={busy} className="btn btn-primary">
        Register · ${(buyIn / 1e6).toFixed(0)}
      </button>
      {msg && <span className="text-sm text-white/70">{msg}</span>}
    </div>
  );
}
