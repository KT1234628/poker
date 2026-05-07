// Build the withdraw transaction. The on-chain program requires that an
// ed25519 signature instruction precedes the withdraw instruction in the
// SAME transaction, signing the canonical message:
//
//   "stacks_withdraw:" || user_pubkey(32) || amount_le(8) || nonce_le(8) || expires_le(8)
//
// The oracle signs that message off-chain; this helper assembles the full tx.

import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, Ed25519Program, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { IX_DISCRIMINATORS } from './idl';
import { buildWithdrawMessage, configPda, programId, usdcMint, userBalancePda, vaultPda, vaultTokenAccountPda } from './vault';

interface BuildWithdrawArgs {
  connection: Connection;
  user: PublicKey;
  oracle: PublicKey;
  oracleSignature: Buffer;       // 64 bytes
  amount: bigint;
  nonce: bigint;
  expiresAt: bigint;             // unix seconds
}

export async function buildWithdrawTx(args: BuildWithdrawArgs): Promise<Transaction> {
  if (args.oracleSignature.length !== 64) throw new Error('oracle signature must be 64 bytes');
  const tx = new Transaction();

  const message = buildWithdrawMessage({
    user: args.user,
    amount: args.amount,
    nonce: args.nonce,
    expiresAt: args.expiresAt,
  });

  // Ed25519 verify instruction (built-in program). MUST be at index 0 so the
  // program's `verify_oracle_sig` finds it via load_instruction_at_checked(0).
  tx.add(Ed25519Program.createInstructionWithPublicKey({
    publicKey: args.oracle.toBytes(),
    message,
    signature: args.oracleSignature,
  }));

  const userAta = getAssociatedTokenAddressSync(usdcMint(), args.user);
  const [config] = configPda();
  const [vault] = vaultPda();
  const [vaultToken] = vaultTokenAccountPda();
  const [userBal] = userBalancePda(args.user);

  // Encode `withdraw(amount, nonce, expires_at, oracle_sig_index)`
  const data = Buffer.alloc(8 + 8 + 8 + 8 + 1);
  IX_DISCRIMINATORS.withdraw.copy(data, 0);
  data.writeBigUInt64LE(args.amount, 8);
  data.writeBigUInt64LE(args.nonce, 16);
  data.writeBigInt64LE(args.expiresAt, 24);
  data.writeUInt8(0, 32);                                       // oracle_sig_index = 0

  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: args.user,  isSigner: true,  isWritable: true },
      { pubkey: config,     isSigner: false, isWritable: true },
      { pubkey: vault,      isSigner: false, isWritable: false },
      { pubkey: userBal,    isSigner: false, isWritable: true },
      { pubkey: userAta,    isSigner: false, isWritable: true },
      { pubkey: vaultToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('Sysvar1nstructions1111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    programId: programId(),
    data,
  }));

  return tx;
}
