-- ============================================================================
-- WebAuthn / Passkeys for biometric login.
--
-- Each user can register multiple authenticators (Face ID + Windows Hello + etc).
-- We store the credential public key, sign counter, and metadata.
-- ============================================================================

create table if not exists webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  credential_id text not null,                    -- base64url(rawId)
  public_key bytea not null,                      -- COSE public key
  counter bigint not null default 0,
  device_type text,                                -- 'platform' | 'cross-platform'
  backed_up boolean not null default false,
  transports text[],                               -- ['internal','hybrid','usb',...]
  nickname text,                                   -- 'Tom’s iPhone'
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (credential_id)
);

create index if not exists webauthn_credentials_user_idx on webauthn_credentials (user_id);

-- Pending challenges (write/read by API; ttl ~5 min)
create table if not exists webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  challenge text not null,                        -- base64url
  type text not null check (type in ('register', 'authenticate')),
  expires_at timestamptz not null default now() + interval '5 minutes',
  used_at timestamptz
);
create index if not exists webauthn_challenges_lookup on webauthn_challenges (challenge, expires_at);

alter table webauthn_credentials enable row level security;
alter table webauthn_challenges enable row level security;

create policy "webauthn_creds: owner read" on webauthn_credentials for select using (auth.uid() = user_id);
create policy "webauthn_creds: owner delete" on webauthn_credentials for delete using (auth.uid() = user_id);
-- Inserts go through service role (signed by server after challenge verify).
