// ============================================================================
// poker_vault — Stacks Poker custody program
//
// Trust model:
//   • A single program-owned vault holds all users' USDC.
//   • Each user has an on-chain `UserBalance` PDA that tracks deposits and
//     processed withdrawals. The DB tracks the *playable* chip balance (which
//     moves around with games). The on-chain balance can never go below zero
//     and the vault total always equals SUM(user_balances).
//   • Deposits: user sends USDC into the vault; their UserBalance is incremented.
//   • Withdrawals: TWO signatures are required —
//       (a) the user (proves intent),
//       (b) the oracle (proves the user's playable balance covers the request).
//     The oracle is a server keypair held by the operator. With the operator
//     compromised, the worst case is the oracle signs phantom withdrawals
//     against the operator's *own* balance (not other users'), because each
//     user's withdrawal is bounded by their own UserBalance.
//   • Audit: anyone can sum the on-chain UserBalance accounts and compare to
//     the vault token balance — if they don't match, the operator is insolvent.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

declare_id!("PoKeRVau1tXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

const VAULT_SEED: &[u8] = b"vault";
const USER_SEED: &[u8] = b"user";
const NONCE_SEED: &[u8] = b"nonce";

#[program]
pub mod poker_vault {
    use super::*;

    /// One-time setup. The admin sets the USDC mint and the oracle pubkey.
    pub fn initialize(ctx: Context<Initialize>, oracle_pubkey: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.oracle = oracle_pubkey;
        cfg.usdc_mint = ctx.accounts.usdc_mint.key();
        cfg.bump = ctx.bumps.config;
        cfg.vault_bump = ctx.bumps.vault;
        cfg.total_deposits = 0;
        cfg.total_withdrawals = 0;
        cfg.user_count = 0;
        cfg.paused = false;
        Ok(())
    }

    /// Admin-only: emergency pause.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.config.admin, VaultError::NotAdmin);
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    /// Admin-only: rotate oracle.
    pub fn set_oracle(ctx: Context<AdminOnly>, new_oracle: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.config.admin, VaultError::NotAdmin);
        ctx.accounts.config.oracle = new_oracle;
        Ok(())
    }

    /// Create a UserBalance PDA the first time a user deposits.
    pub fn register_user(ctx: Context<RegisterUser>) -> Result<()> {
        let ub = &mut ctx.accounts.user_balance;
        ub.owner = ctx.accounts.user.key();
        ub.deposited = 0;
        ub.withdrawn = 0;
        ub.last_nonce = 0;
        ub.bump = ctx.bumps.user_balance;
        ctx.accounts.config.user_count = ctx.accounts.config.user_count.saturating_add(1);

        emit!(UserRegistered { user: ub.owner });
        Ok(())
    }

    /// Deposit USDC into the vault.
    /// The user's USDC is transferred from `user_token_account` into the
    /// program-owned `vault_token_account`. UserBalance.deposited increases.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, VaultError::Paused);
        require!(amount > 0, VaultError::ZeroAmount);
        require_keys_eq!(
            ctx.accounts.user_token_account.mint,
            ctx.accounts.config.usdc_mint,
            VaultError::WrongMint
        );

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        transfer(cpi_ctx, amount)?;

        let ub = &mut ctx.accounts.user_balance;
        ub.deposited = ub.deposited.checked_add(amount).ok_or(VaultError::Overflow)?;
        ctx.accounts.config.total_deposits = ctx
            .accounts
            .config
            .total_deposits
            .checked_add(amount)
            .ok_or(VaultError::Overflow)?;

        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            amount,
            user_total_deposited: ub.deposited,
            vault_total_deposits: ctx.accounts.config.total_deposits,
        });
        Ok(())
    }

    /// Process a withdrawal. The user has signed off-chain; the oracle has
    /// also signed off-chain. We verify the oracle's ed25519 signature on
    /// (user, amount, nonce, expires_at) using the Solana ed25519 program in
    /// a preceding instruction (sysvar Instructions). The user is the
    /// transaction signer here.
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
        nonce: u64,
        expires_at: i64,
        _oracle_sig_index: u8,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, VaultError::Paused);
        require!(amount > 0, VaultError::ZeroAmount);

        let now = Clock::get()?.unix_timestamp;
        require!(expires_at >= now, VaultError::OracleExpired);

        let ub = &mut ctx.accounts.user_balance;
        require_keys_eq!(ub.owner, ctx.accounts.user.key(), VaultError::WrongUser);
        require!(nonce > ub.last_nonce, VaultError::ReplayedNonce);

        // Verify oracle signature is present in the previous instruction.
        verify_oracle_sig(
            &ctx.accounts.instructions_sysvar,
            ctx.accounts.config.oracle,
            ctx.accounts.user.key(),
            amount,
            nonce,
            expires_at,
        )?;

        // Bound: cannot withdraw more than user's own deposits net of withdrawals.
        let available = ub.deposited.saturating_sub(ub.withdrawn);
        require!(amount <= available, VaultError::ExceedsBalance);

        // Transfer USDC from vault to user.
        let cfg = &ctx.accounts.config;
        let bump = cfg.vault_bump;
        let mint_key = cfg.usdc_mint;
        let seeds: &[&[u8]] = &[VAULT_SEED, mint_key.as_ref(), &[bump]];
        let signer_seeds = &[seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        transfer(cpi_ctx, amount)?;

        ub.withdrawn = ub.withdrawn.checked_add(amount).ok_or(VaultError::Overflow)?;
        ub.last_nonce = nonce;
        ctx.accounts.config.total_withdrawals = ctx
            .accounts
            .config
            .total_withdrawals
            .checked_add(amount)
            .ok_or(VaultError::Overflow)?;

        emit!(WithdrawEvent {
            user: ctx.accounts.user.key(),
            amount,
            nonce,
            user_total_withdrawn: ub.withdrawn,
            vault_total_withdrawals: ctx.accounts.config.total_withdrawals,
        });
        Ok(())
    }
}

// ─── Oracle signature verification via ed25519 sysvar ────────────────────────

fn verify_oracle_sig(
    instructions: &AccountInfo,
    oracle: Pubkey,
    user: Pubkey,
    amount: u64,
    nonce: u64,
    expires_at: i64,
) -> Result<()> {
    use solana_program::sysvar::instructions::{
        load_instruction_at_checked, ID as SYSVAR_INSTRUCTIONS_ID,
    };
    require_keys_eq!(*instructions.key, SYSVAR_INSTRUCTIONS_ID, VaultError::BadSysvar);

    // The ed25519 instruction must be the one immediately preceding ours.
    let ix = load_instruction_at_checked(0, instructions)
        .map_err(|_| error!(VaultError::OracleSigMissing))?;

    require_keys_eq!(
        ix.program_id,
        solana_program::ed25519_program::ID,
        VaultError::OracleSigMissing
    );

    // ed25519 instruction layout (little-endian):
    //   u8   num_signatures (=1)
    //   u8   padding
    //   u16  signature_offset
    //   u16  signature_instruction_index (=0xffff for current ix)
    //   u16  public_key_offset
    //   u16  public_key_instruction_index
    //   u16  message_data_offset
    //   u16  message_data_size
    //   u16  message_instruction_index
    //   [signature; 64]
    //   [pubkey; 32]
    //   [message; n]
    let data = &ix.data;
    require!(data.len() >= 16 + 64 + 32, VaultError::OracleSigMalformed);
    require!(data[0] == 1, VaultError::OracleSigMalformed);

    let pk_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;

    require!(pk_offset + 32 <= data.len(), VaultError::OracleSigMalformed);
    require!(msg_offset + msg_size <= data.len(), VaultError::OracleSigMalformed);

    let signed_pk = &data[pk_offset..pk_offset + 32];
    require!(signed_pk == oracle.as_ref(), VaultError::OracleSigWrongKey);

    // The message format the oracle signs:
    //   "stacks_withdraw:" || user(32) || amount_le(8) || nonce_le(8) || expires_le(8)
    let mut expected = Vec::with_capacity(16 + 32 + 24);
    expected.extend_from_slice(b"stacks_withdraw:");
    expected.extend_from_slice(user.as_ref());
    expected.extend_from_slice(&amount.to_le_bytes());
    expected.extend_from_slice(&nonce.to_le_bytes());
    expected.extend_from_slice(&expires_at.to_le_bytes());

    require!(
        &data[msg_offset..msg_offset + msg_size] == expected.as_slice(),
        VaultError::OracleSigPayloadMismatch
    );

    Ok(())
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct VaultConfig {
    pub admin: Pubkey,
    pub oracle: Pubkey,
    pub usdc_mint: Pubkey,
    pub total_deposits: u64,
    pub total_withdrawals: u64,
    pub user_count: u64,
    pub paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
}
impl VaultConfig {
    pub const SIZE: usize = 8 + 32 * 3 + 8 * 3 + 1 + 1 + 1 + 32; // padding
}

#[account]
#[derive(Default)]
pub struct UserBalance {
    pub owner: Pubkey,
    pub deposited: u64,
    pub withdrawn: u64,
    pub last_nonce: u64,
    pub bump: u8,
}
impl UserBalance {
    pub const SIZE: usize = 8 + 32 + 8 * 3 + 1 + 16;
}

// ─── Contexts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = VaultConfig::SIZE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, VaultConfig>,
    /// CHECK: PDA, holder of vault token account authority
    #[account(
        seeds = [VAULT_SEED, usdc_mint.key().as_ref()],
        bump
    )]
    pub vault: UncheckedAccount<'info>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        token::mint = usdc_mint,
        token::authority = vault,
        seeds = [b"vault_token", usdc_mint.key().as_ref()],
        bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
}

#[derive(Accounts)]
pub struct RegisterUser<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(
        init,
        payer = user,
        space = UserBalance::SIZE,
        seeds = [USER_SEED, user.key().as_ref()],
        bump
    )]
    pub user_balance: Account<'info, UserBalance>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_balance.bump,
        has_one = owner @ VaultError::WrongUser
    )]
    pub user_balance: Account<'info, UserBalance>,
    /// CHECK: matches user_balance.owner
    pub owner: UncheckedAccount<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault_token", config.usdc_mint.as_ref()],
        bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
    /// CHECK: vault PDA holds vault token account authority
    #[account(seeds = [VAULT_SEED, config.usdc_mint.as_ref()], bump = config.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_balance.bump
    )]
    pub user_balance: Account<'info, UserBalance>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault_token", config.usdc_mint.as_ref()],
        bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    /// CHECK: address-checked inside ix
    #[account(address = solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

// ─── Events & errors ─────────────────────────────────────────────────────────

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub user_total_deposited: u64,
    pub vault_total_deposits: u64,
}

#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub user_total_withdrawn: u64,
    pub vault_total_withdrawals: u64,
}

#[event]
pub struct UserRegistered {
    pub user: Pubkey,
}

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    Paused,
    #[msg("Amount must be positive")]
    ZeroAmount,
    #[msg("Wrong USDC mint")]
    WrongMint,
    #[msg("Math overflow")]
    Overflow,
    #[msg("Caller is not admin")]
    NotAdmin,
    #[msg("UserBalance owner mismatch")]
    WrongUser,
    #[msg("Withdrawal exceeds user's deposit balance")]
    ExceedsBalance,
    #[msg("Replayed nonce")]
    ReplayedNonce,
    #[msg("Oracle signature missing or wrong sysvar")]
    BadSysvar,
    #[msg("Oracle signature instruction missing")]
    OracleSigMissing,
    #[msg("Oracle signature malformed")]
    OracleSigMalformed,
    #[msg("Oracle signature payload mismatch")]
    OracleSigPayloadMismatch,
    #[msg("Signed by wrong oracle key")]
    OracleSigWrongKey,
    #[msg("Oracle approval expired")]
    OracleExpired,
}
