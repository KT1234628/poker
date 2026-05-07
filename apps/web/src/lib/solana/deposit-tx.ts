// Build a deposit transaction using the real Anchor IDL. Replaces the
// hand-rolled byte-stuffing in the wallet page.
//
// Returns a legacy Transaction (works in all wallet adapters); upgrade to
// VersionedTransaction + lookup tables when scaling.

import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { IX_DISCRIMINATORS } from './idl';
import { configPda, programId, usdcMint, userBalancePda, vaultPda, vaultTokenAccountPda } from './vault';

interface BuildDepositArgs {
  connection: Connection;
  user: PublicKey;
  amount: bigint;          // micro-USDC (1 USDC = 1_000_000)
  ensureUserBalance: boolean;  // call register_user before deposit if true
}

interface BuildResult {
  tx: Transaction;
  /** Computed deposit amount as the on-chain instruction encodes it. */
  amount: bigint;
}

export async function buildDepositTx(args: BuildDepositArgs): Promise<BuildResult> {
  const tx = new Transaction();
  const userAta = getAssociatedTokenAddressSync(usdcMint(), args.user);
  const [vault] = vaultPda();
  const [vaultToken] = vaultTokenAccountPda();
  const [config] = configPda();
  const [userBal] = userBalancePda(args.user);

  // Ensure user's USDC ATA exists (idempotent)
  const ataInfo = await args.connection.getAccountInfo(userAta);
  if (!ataInfo) {
    tx.add(createAssociatedTokenAccountInstruction(args.user, userAta, args.user, usdcMint()));
  }

  // Optionally call register_user the first time
  if (args.ensureUserBalance) {
    const ubInfo = await args.connection.getAccountInfo(userBal);
    if (!ubInfo) {
      tx.add(new TransactionInstruction({
        keys: [
          { pubkey: args.user,  isSigner: true,  isWritable: true },
          { pubkey: config,     isSigner: false, isWritable: true },
          { pubkey: userBal,    isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: programId(),
        data: IX_DISCRIMINATORS.register_user,
      }));
    }
  }

  // Encode `deposit(amount)` instruction
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(args.amount, 0);
  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: args.user,  isSigner: true,  isWritable: true },
      { pubkey: config,     isSigner: false, isWritable: true },
      { pubkey: userBal,    isSigner: false, isWritable: true },
      { pubkey: args.user,  isSigner: false, isWritable: false },   // owner (matches user_balance.owner)
      { pubkey: userAta,    isSigner: false, isWritable: true },
      { pubkey: vaultToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: programId(),
    data: Buffer.concat([IX_DISCRIMINATORS.deposit, amountBytes]),
  }));

  return { tx, amount: args.amount };
}
