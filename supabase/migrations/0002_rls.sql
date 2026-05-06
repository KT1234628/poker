-- ============================================================================
-- Row Level Security policies.
-- Default-deny: every table has RLS enabled. Only the policies below grant access.
-- The service role bypasses RLS — that's the game server's authority.
-- ============================================================================

alter table profiles enable row level security;
alter table wallets enable row level security;
alter table balances enable row level security;
alter table ledger_entries enable row level security;
alter table tables enable row level security;
alter table table_seats enable row level security;
alter table hands enable row level security;
alter table hand_hole_cards enable row level security;
alter table hand_actions enable row level security;
alter table hand_results enable row level security;
alter table tournaments enable row level security;
alter table tournament_entries enable row level security;
alter table blind_structures enable row level security;
alter table deposits enable row level security;
alter table withdrawals enable row level security;
alter table table_messages enable row level security;
alter table session_events enable row level security;
alter table security_flags enable row level security;
alter table device_fingerprints enable row level security;
alter table player_limits enable row level security;

-- ─── Profiles ─────────────────────────────────────────────────────────────────

create policy "profiles: anyone can read public fields"
  on profiles for select using (not is_banned);

create policy "profiles: users can update their own"
  on profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ─── Wallets ──────────────────────────────────────────────────────────────────

create policy "wallets: owner can read"
  on wallets for select using (auth.uid() = user_id);

create policy "wallets: owner can insert"
  on wallets for insert with check (auth.uid() = user_id);

create policy "wallets: owner can update"
  on wallets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "wallets: owner can delete"
  on wallets for delete using (auth.uid() = user_id);

-- ─── Balances ─────────────────────────────────────────────────────────────────

create policy "balances: owner reads"
  on balances for select using (auth.uid() = user_id);

-- ─── Ledger ───────────────────────────────────────────────────────────────────

create policy "ledger: owner reads"
  on ledger_entries for select using (auth.uid() = user_id);

-- ─── Tables (lobby visibility) ───────────────────────────────────────────────

create policy "tables: public read"
  on tables for select using (status <> 'closed' and not is_private);

create policy "tables: seated player reads private tables"
  on tables for select using (
    is_private and exists (
      select 1 from table_seats ts
      where ts.table_id = tables.id and ts.user_id = auth.uid()
    )
  );

-- ─── Seats — all seats at a public table are visible to everyone ─────────────

create policy "table_seats: public read"
  on table_seats for select using (
    exists (select 1 from tables t where t.id = table_seats.table_id and not t.is_private)
    or auth.uid() = user_id
  );

-- ─── Hands & actions: visible after the hand starts ──────────────────────────

create policy "hands: public read"
  on hands for select using (true);

create policy "hand_actions: public read"
  on hand_actions for select using (true);

create policy "hand_results: public read"
  on hand_results for select using (true);

-- ─── Hole cards: ONLY the player can read their own. After showdown the hand_results.shown=true. ─

create policy "hand_hole_cards: owner reads"
  on hand_hole_cards for select using (auth.uid() = user_id);

create policy "hand_hole_cards: shown cards public after showdown"
  on hand_hole_cards for select using (
    shown = true
    and exists (select 1 from hands h where h.id = hand_hole_cards.hand_id and h.ended_at is not null)
  );

-- ─── Tournaments ──────────────────────────────────────────────────────────────

create policy "tournaments: public read"
  on tournaments for select using (true);

create policy "blind_structures: public read"
  on blind_structures for select using (true);

create policy "tournament_entries: public read"
  on tournament_entries for select using (true);

-- ─── Deposits / Withdrawals: owner only ──────────────────────────────────────

create policy "deposits: owner reads"
  on deposits for select using (auth.uid() = user_id);

create policy "withdrawals: owner reads"
  on withdrawals for select using (auth.uid() = user_id);

-- Insertions go through service role functions (deposit confirmation, withdrawal request).
-- No insert policies for anon/authenticated.

-- ─── Chat: visible to users at the table (or anyone for public tables) ───────

create policy "table_messages: read at public table"
  on table_messages for select using (
    exists (select 1 from tables t where t.id = table_messages.table_id and not t.is_private)
    or exists (select 1 from table_seats ts where ts.table_id = table_messages.table_id and ts.user_id = auth.uid())
  );

create policy "table_messages: seated user inserts"
  on table_messages for insert with check (
    auth.uid() = user_id
    and exists (select 1 from table_seats ts where ts.table_id = table_messages.table_id and ts.user_id = auth.uid())
  );

-- ─── Security: owner can see their own session events ────────────────────────

create policy "session_events: owner reads"
  on session_events for select using (auth.uid() = user_id);

-- security_flags + device_fingerprints: service role only (no policies).

-- ─── Player limits ────────────────────────────────────────────────────────────

create policy "player_limits: owner read"
  on player_limits for select using (auth.uid() = user_id);

create policy "player_limits: owner update"
  on player_limits for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
