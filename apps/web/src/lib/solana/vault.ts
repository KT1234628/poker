// Helpers for interacting with the on-chain poker vault program.
import { PublicKey } from '@solana/web3.js';

const SYSTEM_PROGRAM = '11111111111111111111111111111111';        // valid base58 fallback

let _programId: PublicKey | null = null;
let _usdcMint: PublicKey | null = null;

function tryPubkey(value: string | undefined, fallback: string): PublicKey {
  try {
    return new PublicKey(value && value.length >= 32 ? value : fallback);
  } catch {
    return new PublicKey(fallback);
  }
}

export function programId(): PublicKey {
  if (!_programId) _programId = tryPubkey(process.env.NEXT_PUBLIC_VAULT_PROGRAM_ID, SYSTEM_PROGRAM);
  return _programId;
}

export function usdcMint(): PublicKey {
  if (!_usdcMint)
    _usdcMint = tryPubkey(process.env.NEXT_PUBLIC_USDC_MINT, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  return _usdcMint;
}

// Backwards-compat exports (now always go through the lazy accessors above)
export const VAULT_PROGRAM_ID = new Proxy({} as PublicKey, {
  get(_t, p) { return Reflect.get(programId(), p); },
});
export const USDC_MINT = new Proxy({} as PublicKey, {
  get(_t, p) { return Reflect.get(usdcMint(), p); },
});

export function vaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), usdcMint().toBuffer()], programId());
}

export function configPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId());
}

export function userBalancePda(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('user'), user.toBuffer()], programId());
}

export function vaultTokenAccountPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('vault_token'), usdcMint().toBuffer()], programId());
}

// Build the message the oracle signs to authorize a withdrawal.
export function buildWithdrawMessage(opts: {
  user: PublicKey;
  amount: bigint;
  nonce: bigint;
  expiresAt: bigint;          // unix seconds
}): Uint8Array {
  const out = new Uint8Array(16 + 32 + 8 + 8 + 8);
  out.set(new TextEncoder().encode('stacks_withdraw:'), 0);
  out.set(opts.user.toBytes(), 16);
  const view = new DataView(out.buffer, out.byteOffset);
  view.setBigUint64(48, opts.amount, true);
  view.setBigUint64(56, opts.nonce, true);
  view.setBigInt64(64, opts.expiresAt, true);
  return out;
}
