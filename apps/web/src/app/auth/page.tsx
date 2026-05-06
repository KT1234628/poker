'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BiometricLoginButton } from '@/components/auth/BiometricLogin';
import { supabase } from '@/lib/supabase/client';

export default function AuthPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/lobby';
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'PublicKeyCredential' in window) {
      // @ts-expect-error static method may not be on lib type
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().then((b: boolean) => setBiometricSupported(b));
    }
  }, []);

  async function handle() {
    setErr(null);
    setLoading(true);
    try {
      const sb = supabase();
      if (mode === 'sign_up') {
        const { error } = await sb.auth.signUp({
          email, password,
          options: { data: { username: username.toLowerCase() } },
        });
        if (error) throw error;
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.replace(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <h1 className="font-display text-4xl font-bold text-gold-400">
          {mode === 'sign_in' ? 'Welcome back' : 'Create account'}
        </h1>
        <p className="mt-2 text-sm text-white/60">
          {mode === 'sign_in' ? 'Continue where you left off.' : '21+ only. Real-money play requires KYC.'}
        </p>
      </div>

      {biometricSupported && mode === 'sign_in' && (
        <>
          <BiometricLoginButton />
          <div className="flex items-center gap-2">
            <hr className="flex-1 border-white/10" />
            <span className="text-xs uppercase text-white/40">or with password</span>
            <hr className="flex-1 border-white/10" />
          </div>
        </>
      )}

      {mode === 'sign_up' && (
        <input
          autoFocus
          className="rounded-md bg-white/5 px-4 py-3 ring-1 ring-white/10"
          placeholder="username (3–24 lowercase)"
          value={username}
          onChange={e => setUsername(e.target.value)}
          maxLength={24}
        />
      )}
      <input
        className="rounded-md bg-white/5 px-4 py-3 ring-1 ring-white/10"
        type="email"
        autoComplete="email"
        placeholder="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
      />
      <input
        className="rounded-md bg-white/5 px-4 py-3 ring-1 ring-white/10"
        type="password"
        autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
        placeholder="password (12+ chars)"
        value={password}
        onChange={e => setPassword(e.target.value)}
        minLength={12}
      />
      {err && <p className="text-sm text-red-400">{err}</p>}
      <button onClick={handle} disabled={loading} className="btn btn-primary">
        {loading ? '…' : mode === 'sign_in' ? 'Sign in' : 'Create account'}
      </button>
      <button onClick={() => setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')} className="text-sm text-white/60 underline-offset-2 hover:underline">
        {mode === 'sign_in' ? 'Need an account?' : 'Have an account?'}
      </button>

      {mode === 'sign_in' && biometricSupported && (
        <p className="text-center text-xs text-white/40">
          Sign in once with password, then enable Face ID / Touch ID in Profile → Settings.
        </p>
      )}
    </main>
  );
}
