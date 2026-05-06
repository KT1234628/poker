'use client';

import { useState } from 'react';

export function KycStartButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/kyc/start', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      // In production: open Persona's hosted flow
      // window.location.href = `https://withpersona.com/verify?inquiry-id=${j.inquiryId}&session-token=${j.sessionToken}`;
      alert(`Persona inquiry created: ${j.inquiryId}\n\nIn production this redirects to Persona's verification flow.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button onClick={start} disabled={busy} className="btn btn-primary">
        {busy ? 'Starting…' : 'Start verification'}
      </button>
      {err && <p className="text-sm text-red-400">{err}</p>}
    </div>
  );
}
