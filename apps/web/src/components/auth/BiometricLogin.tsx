'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export function BiometricLoginButton({ usernameHint }: { usernameHint?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function login() {
    setBusy(true); setErr(null);
    try {
      const opts = await fetch('/api/webauthn/auth/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usernameHint }),
      }).then(r => r.json());
      if (opts.error) throw new Error(opts.error);

      const credential = await startAuthentication({ optionsJSON: opts });
      const verify = await fetch('/api/webauthn/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challenge: opts.challenge, response: credential }),
      }).then(r => r.json());
      if (verify.error) throw new Error(verify.error);

      if (verify.magic) {
        // Server returned a magic link — exchanging it transparently signs us in.
        window.location.href = verify.magic;
      } else {
        window.location.href = '/lobby';
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button onClick={login} disabled={busy} className="btn btn-primary flex w-full items-center justify-center gap-2">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M7 11V7a5 5 0 0110 0v4M5 11h14v9H5z" />
        </svg>
        {busy ? 'Verifying…' : 'Sign in with Face ID / Touch ID'}
      </button>
      {err && <p className="text-sm text-red-400">{err}</p>}
    </div>
  );
}

export function RegisterPasskeyButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function register() {
    setBusy(true); setMsg(null);
    try {
      const sb = supabase();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error('Sign in first');

      const opts = await fetch('/api/webauthn/register/options', { method: 'POST' }).then(r => r.json());
      if (opts.error) throw new Error(opts.error);

      const credential = await startRegistration({ optionsJSON: opts });
      const verify = await fetch('/api/webauthn/register/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challenge: opts.challenge, response: credential, nickname: getDeviceName() }),
      }).then(r => r.json());
      if (verify.error) throw new Error(verify.error);
      setMsg('Passkey registered. Try biometric login next time.');
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button onClick={register} disabled={busy} className="btn btn-ghost">
        {busy ? '…' : 'Register Face ID / Touch ID'}
      </button>
      {msg && <p className="text-xs text-white/70">{msg}</p>}
    </div>
  );
}

function getDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Device';
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Device';
}
