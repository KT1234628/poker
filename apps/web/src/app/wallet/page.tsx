'use client';

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
    const lamports = BigInt(Math.floor(parseFloat(amount) * 1e6));
    if (lamports <= 0n) return;
    setBusy(true); setMsg(null);
    try {
      // Build a deposit transaction by calling the program.
      // The user transfers USDC from their ATA into the vault token account.
      const userAta = getAssociatedTokenAddressSync(USDC_MINT, publicKey);
      const [vault] = vaultPda();
      const [vaultToken] = vaultTokenAccountPda();
      const [config] = configPda();
      const [userBal] = userBalancePda(publicKey);

      const tx = new Transaction();
      // (Anchor 8-byte discriminator for `deposit` would be added here in a real build via the IDL)
      // For this scaffold, instructions go through the Next API which signs with admin.
      // Redirect: the production path is to call the program directly via @coral-xyz/anchor.
      // Here we simply trigger the off-chain registration of the deposit signature.
      const placeholder = new TransactionInstruction({
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: userAta, isSigner: false, isWritable: true },
          { pubkey: vaultToken, isSigner: false, isWritable: true },
          { pubkey: config, isSigner: false, isWritable: true },
          { pubkey: userBal, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: VAULT_PROGRAM_ID,
        data: Buffer.concat([Buffer.from([0xa1, 0x4f, 0x36, 0x09, 0x35, 0xed, 0x83, 0x6c]), Buffer.from(lamports.toString(16).padStart(16, '0'), 'hex').reverse()]),
      });
      tx.add(placeholder);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, 'confirmed');

      // Notify the server, which credits chips after watching the on-chain event
      await fetch('/api/deposit/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txSignature: sig, walletAddress: publicKey.toBase58() }),
      });

      setMsg('Deposit submitted: ' + sig.slice(0, 8) + '…');
      await refresh();
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (!publicKey || !signMessage) return;
    const micros = BigInt(Math.floor(parseFloat(amount) * 1e6));
    if (micros <= 0n) return;
    setBusy(true); setMsg(null);
    try {
      const nonce = crypto.randomUUID();
      const message = `withdraw:${micros}:${publicKey.toBase58()}:${nonce}`;
      const sig = await signMessage(new TextEncoder().encode(message));
      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: Number(micros),
          walletAddress: publicKey.toBase58(),
          userSignature: bs58.encode(sig),
          nonce,
        }),
      }).then(r => r.json());
      if (res.error) throw new Error(res.error);
      setMsg('Withdrawal queued. Tx will land within ~30s once oracle co-signs.');
      await refresh();
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
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
