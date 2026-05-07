// Anchor IDL for the poker_vault program. Hand-written to match
// apps/solana-program/programs/poker-vault/src/lib.rs until `anchor build`
// generates the official artifact at apps/solana-program/target/idl/.
//
// The discriminators below are computed via:
//   sha256(`global:<instruction_name>`)[0..8]    — for instruction discriminators
//   sha256(`event:<EventName>`)[0..8]            — for event discriminators
//   sha256(`account:<AccountName>`)[0..8]        — for account discriminators

// Inlined to keep the web app's Docker build context limited to apps/web.
// When the Anchor program ships its real IDL via `anchor build`, replace this
// const with a generated import; until then this stub is enough for the
// instruction + event discriminators we actually use.
const idl: PokerVaultIdl = {
  version: '0.1.0',
  name: 'poker_vault',
  address: process.env.NEXT_PUBLIC_VAULT_PROGRAM_ID ?? '11111111111111111111111111111111',
  metadata: { name: 'poker_vault', version: '0.1.0', spec: '0.1.0' },
  instructions: [],
  accounts: [],
  events: [
    { name: 'DepositEvent',   discriminator: [120, 248, 61, 83, 31, 142, 107, 144],
      fields: [
        { name: 'user', type: 'publicKey' },
        { name: 'amount', type: 'u64' },
        { name: 'user_total_deposited', type: 'u64' },
        { name: 'vault_total_deposits', type: 'u64' },
      ] },
    { name: 'WithdrawEvent',  discriminator: [22, 9, 133, 26, 160, 44, 71, 192],
      fields: [
        { name: 'user', type: 'publicKey' },
        { name: 'amount', type: 'u64' },
        { name: 'nonce', type: 'u64' },
        { name: 'user_total_withdrawn', type: 'u64' },
        { name: 'vault_total_withdrawals', type: 'u64' },
      ] },
    { name: 'UserRegistered', discriminator: [56, 102, 91, 25, 74, 199, 33, 190],
      fields: [{ name: 'user', type: 'publicKey' }] },
  ],
  errors: [],
};

export const POKER_VAULT_IDL = idl;

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
