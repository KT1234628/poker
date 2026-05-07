// Anchor program loader. Constructs a Program<PokerVault> from the IDL,
// usable on both client (with a wallet) and server (read-only or with the
// oracle keypair).

import { AnchorProvider, BorshCoder, type Idl, Program, type Provider } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { POKER_VAULT_IDL } from './idl';
import { programId } from './vault';

// Generic Anchor types — we don't auto-generate the typed IDL here so we use
// the lossy any-typed Program; callers that want stronger typing can build a
// typed Program from the JSON via `anchor build` artifacts in production.
type AnyProgram = Program<Idl>;

let cached: AnyProgram | null = null;

export function getProgram(provider: Provider): AnyProgram {
  if (cached && cached.provider === provider) return cached;
  const idl = { ...POKER_VAULT_IDL, address: programId().toBase58() } as unknown as Idl;
  cached = new Program(idl, provider);
  return cached;
}

/** Server-side read-only provider (no signing). */
export function readonlyProvider(rpc: string): Provider {
  const connection = new Connection(rpc, 'confirmed');
  return new AnchorProvider(connection, {
    publicKey: PublicKey.default,
    // No signers — anything that requires signing on this provider will throw.
    signTransaction: async () => { throw new Error('readonly'); },
    signAllTransactions: async () => { throw new Error('readonly'); },
  } as unknown as AnchorProvider['wallet'], { commitment: 'confirmed' });
}

/** Server-side oracle-signing provider. Use only in withdrawal-worker. */
export function oracleProvider(rpc: string, keypair: Keypair): Provider {
  const connection = new Connection(rpc, 'confirmed');
  return new AnchorProvider(connection, {
    publicKey: keypair.publicKey,
    signTransaction: async tx => { tx.partialSign(keypair); return tx; },
    signAllTransactions: async txs => { txs.forEach(t => t.partialSign(keypair)); return txs; },
  } as unknown as AnchorProvider['wallet'], { commitment: 'confirmed' });
}

/** Decode a `Program data: <base64>` log into the raw discriminator+payload. */
export function decodeProgramDataLog(line: string): Buffer | null {
  if (!line.startsWith('Program data: ')) return null;
  const b64 = line.slice('Program data: '.length).trim();
  try { return Buffer.from(b64, 'base64'); } catch { return null; }
}

/** Decode a DepositEvent log via Anchor's BorshCoder. Returns null if not ours. */
export function decodeDepositEvent(b: Buffer): { user: PublicKey; amount: bigint; userTotalDeposited: bigint; vaultTotalDeposits: bigint } | null {
  if (b.length < 8 + 32 + 24) return null;
  const disc = b.subarray(0, 8);
  const expected = (POKER_VAULT_IDL.events.find(e => e.name === 'DepositEvent')!.discriminator as number[]);
  for (let i = 0; i < 8; i++) if (disc[i] !== expected[i]) return null;
  const user = new PublicKey(b.subarray(8, 8 + 32));
  const amount = b.readBigUInt64LE(8 + 32);
  const userTotalDeposited = b.readBigUInt64LE(8 + 32 + 8);
  const vaultTotalDeposits = b.readBigUInt64LE(8 + 32 + 16);
  return { user, amount, userTotalDeposited, vaultTotalDeposits };
}

export { BorshCoder };
