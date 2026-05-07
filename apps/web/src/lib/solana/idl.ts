// Anchor IDL for the poker_vault program. Hand-written to match
// apps/solana-program/programs/poker-vault/src/lib.rs until `anchor build`
// generates the official artifact at apps/solana-program/target/idl/.
//
// The discriminators below are computed via:
//   sha256(`global:<instruction_name>`)[0..8]    — for instruction discriminators
//   sha256(`event:<EventName>`)[0..8]            — for event discriminators
//   sha256(`account:<AccountName>`)[0..8]        — for account discriminators

import idl from '../../../../solana-program/idl/poker_vault.json' assert { type: 'json' };

export const POKER_VAULT_IDL = idl as unknown as PokerVaultIdl;

export interface PokerVaultIdl {
  version: string;
  name: 'poker_vault';
  address: string;
  metadata?: { name: string; version: string; spec: string };
  instructions: Array<{ name: string; discriminator: number[]; accounts: unknown[]; args: Array<{ name: string; type: string }> }>;
  accounts: Array<{ name: string; discriminator: number[]; type: { kind: string; fields: Array<{ name: string; type: string }> } }>;
  events: Array<{ name: string; discriminator: number[]; fields: Array<{ name: string; type: string }> }>;
  errors: Array<{ code: number; name: string; msg: string }>;
}

// Discriminators we use for binary-level decode at the deposit-confirm path.
// These match the Anchor convention `sha256("global:<name>")[0..8]`.
export const IX_DISCRIMINATORS = {
  deposit:       Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]),
  withdraw:      Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]),
  initialize:    Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]),
  register_user: Buffer.from([2, 241, 150, 223, 99, 214, 116, 97]),
} as const;

export const EVENT_DISCRIMINATORS = {
  DepositEvent:    Buffer.from([120, 248, 61, 83, 31, 142, 107, 144]),
  WithdrawEvent:   Buffer.from([22, 9, 133, 26, 160, 44, 71, 192]),
  UserRegistered:  Buffer.from([56, 102, 91, 25, 74, 199, 33, 190]),
} as const;
