'use client';

import { uuid } from '@/lib/uuid';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { useEffect, useState } from 'react';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { configPda, USDC_MINT, userBalancePda, vaultPda, vaultTokenAccountPda, VAULT_PROGRAM_ID } from '@/lib/solana/vault';
import { supabase } from '@/lib/supabase/client';

export default function WalletPage() {
  const { publicKey, signMessage, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const [chips, setChips] = useState<number>(0);
  const [usdcBalance, setUsdcBalance] = useState<number>(0);
  const [vaultBalance, setVaultBalance] = useState<number>(0);
  const [vaultTotalUserBalance, setVaultTotalUserBalance] = useState<number>(0);
  const [amount, setAmount] = useState<string>('100');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [publicKey]);

  async function refresh() {
    const sb = supabase();
    const { data } = await sb.from('balances').select('chips').maybeSingle();
    setChips(Number(data?.chips ?? 0));

    if (publicKey) {
      const ata = getAssociatedTokenAddressSync(USDC_MINT, publicKey);
      const acct = await connection.getTokenAccountBalance(ata).catch(() => null);
      setUsdcBalance(Number(acct?.value.amount ?? 0));
    }

    const [vaultTokenPda] = vaultTokenAccountPda();
    const vaultAcct = await connection.getTokenAccountBalance(vaultTokenPda).catch(() => null);
    setVaultBalance(Number(vaultAcct?.value.amount ?? 0));

    const auditRes = await fetch('/api/audit/totals').then(r => r.json()).catch(() => null);
    setVaultTotalUserBalance(Number(auditRes?.vault_total_user_balance ?? 0));
  }

  async function handleConnectWallet() {
    if (!publicKey || !signMessage) return;
    setBusy(true); setMsg(null);
    try {
      // Step 1: get challenge
      const challenge = await fetch('/api/auth/wallet/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
      }).then(r => r.json());
      if (!challenge.message) throw new Error(challenge.error ?? 'challenge_failed');

      // Step 2: sign challenge
      const sig = await signMessage(new TextEncoder().encode(challenge.message));

      // Step 3: verify + link
      const verifyRes = await fetch('/api/auth/wallet/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          signature: bs58.encode(sig),
          challenge: challenge.message,
        }),
      }).then(r => r.json());
      if (verifyRes.error) throw new Error(verifyRes.error);
      setMsg('Wallet linked.');
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeposit() {
    if (!publicKey || !signTransaction) return;
    const micros = BigInt(Math.floor(parseFloat(amount) * 1e6));
    if (micros <= 0n) return;
    setBusy(true); setMsg(null);
    try {
      // Build a real deposit transaction via the IDL — register_user (if first
      // time) + deposit. The on-chain program logs DepositEvent which the
      // server-side /api/deposit/confirm route verifies down to instruction
      // accounts + amount.
      const { buildDepositTx } = await import('@/lib/solana/deposit-tx');
      const { tx } = await buildDepositTx({
        connection, user: publicKey, amount: micros, ensureUserBalance: true,
      });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

      const res = await fetch('/api/deposit/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txSignature: sig, walletAddress: publicKey.toBase58() }),
      }).then(r => r.json());
      if (res.error) throw new Error(res.error);

      setMsg(`Deposit confirmed: ${sig.slice(0, 8)}…`);
      await refresh();
    } catch (e) {
      const msg = (e as Error).message ?? 'unknown';
      setMsg(/User rejected|cancelled/i.test(msg) ? 'Cancelled by wallet.' : `Error: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (!publicKey || !signMessage || !signTransaction) return;
    const micros = BigInt(Math.floor(parseFloat(amount) * 1e6));
    if (micros <= 0n) return;
    setBusy(true); setMsg(null);
    try {
      // Step 1: server-issued nonce + canonical message
      const start = await fetch('/api/withdraw/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: Number(micros), walletAddress: publicKey.toBase58() }),
      }).then(r => r.json());
      if (start.error) throw new Error(start.error);

      // Step 2: user signs the canonical bytes (NOT a string) with their wallet
      const canonicalBytes = Uint8Array.from(atob(start.canonicalMessageB64), c => c.charCodeAt(0));
      const userSig = await signMessage(canonicalBytes);

      // Step 3: server verifies, oracle co-signs, marks `submitted`
      const sign = await fetch('/api/withdraw/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          withdrawalId: start.withdrawalId,
          userSignatureB58: bs58.encode(userSig),
        }),
      }).then(r => r.json());
      if (sign.error) throw new Error(sign.error);

      // Step 4: build + submit the on-chain withdraw tx with the oracle sig.
      // We need to re-fetch the oracle pubkey + signature from the server.
      const w = await fetch(`/api/withdraw/sign?withdrawalId=${start.withdrawalId}`, { method: 'GET' }).then(r => r.json()).catch(() => null);
      if (!w?.oraclePubkeyB58 || !w?.oracleSignatureB58) {
        setMsg('Withdrawal queued. The relay worker will broadcast within ~30s.');
        await refresh();
        return;
      }

      const { buildWithdrawTx } = await import('@/lib/solana/withdraw-tx');
      const { PublicKey } = await import('@solana/web3.js');
      const tx = await buildWithdrawTx({
        connection,
        user: publicKey,
        oracle: new PublicKey(w.oraclePubkeyB58),
        oracleSignature: Buffer.from(bs58.decode(w.oracleSignatureB58)),
        amount: micros,
        nonce: BigInt(start.nonce),
        expiresAt: BigInt(Math.floor(new Date(start.expiresAt).getTime() / 1000)),
      });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

      // Persist final tx_signature so the worker can confirm
      await fetch('/api/withdraw/sign', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ withdrawalId: start.withdrawalId, txSignature: sig }),
      });
      setMsg(`Withdrawal complete: ${sig.slice(0, 8)}…`);
      await refresh();
    } catch (e) {
      const msg = (e as Error).message ?? 'unknown';
      setMsg(/User rejected|cancelled/i.test(msg) ? 'Cancelled by wallet.' : `Error: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-8 font-display text-4xl font-bold">Wallet</h1>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="Playable chips" value={`$${(chips / 1e6).toFixed(2)}`} />
        <Stat label="USDC in your wallet" value={`$${(usdcBalance / 1e6).toFixed(2)}`} />
        <Stat label="Total in vault" value={`$${(vaultBalance / 1e6).toFixed(2)}`} hint="On-chain balance" />
      </div>

      <div className="mb-6 flex gap-3">
        <WalletMultiButton />
        {connected && <button onClick={handleConnectWallet} className="btn btn-ghost" disabled={busy}>Link wallet to account</button>}
      </div>

      <div className="rounded-lg border border-white/10 bg-black/30 p-6">
        <h2 className="mb-4 font-display text-xl font-bold">Deposit / Withdraw</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="number"
            step="any"
            min={1}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-32 rounded-md bg-white/5 px-3 py-2 ring-1 ring-white/10"
          />
          <span className="text-white/60">USDC</span>
          <button onClick={handleDeposit} disabled={!connected || busy} className="btn btn-primary">Deposit</button>
          <button onClick={handleWithdraw} disabled={!connected || busy} className="btn btn-ghost">Withdraw</button>
        </div>
        {msg && <p className="mt-3 text-sm text-white/70">{msg}</p>}
      </div>

      <p className="mt-6 text-xs text-white/50">
        Audit: vault total ${(vaultBalance / 1e6).toFixed(2)} · users credited ${(vaultTotalUserBalance / 1e6).toFixed(2)} ·
        {' '}
        {vaultBalance >= vaultTotalUserBalance ? '✓ solvent' : '✗ INSOLVENT — contact support'}
      </p>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/40 p-4">
      <p className="text-xs uppercase text-white/50">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold">{value}</p>
      {hint && <p className="text-[10px] text-white/40">{hint}</p>}
    </div>
  );
}
