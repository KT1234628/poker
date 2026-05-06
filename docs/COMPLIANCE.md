# Compliance

**Read this before flipping to real money.** Operating an unlicensed real-money poker site is illegal in most jurisdictions. This codebase does not make you legally compliant — it gives you the technical primitives.

## Licensing paths (cheapest → most expensive)

| Jurisdiction | Cost | Time | Coverage |
|---|---|---|---|
| Curaçao eGaming sublicense | $20–30k/yr + 2% rev | 4–8 wk | Most of EU/LATAM/Asia, NOT US/UK/AU/FR/DE/NL |
| Anjouan | $25–40k/yr | 6 wk | Similar to Curaçao, more permissive |
| Costa Rica (data-processing license) | $5–15k/yr | 4 wk | Grey-zone — many sportsbooks operate here, treats poker as skill game |
| Kahnawake | $30k/yr | 8 wk | Includes US tribal jurisdictions |
| Isle of Man | £35k/yr + 1.5% | 3–6 mo | UK + EU, premium reputation |
| Malta (MGA) | €25–50k/yr + 5% | 4–6 mo | All EU |
| Gibraltar | £100k/yr + 1% | 6+ mo | UK + EU, high prestige |
| US state-by-state | $200k–2M per state | 6–18 mo per state | NJ, PA, MI, NV, WV — separate license each |
| UK (UKGC) | £370k/yr + 21% RGD | 6–12 mo | UK only, strictest in world |

For most operators starting out, **Curaçao + a generous geo-block list** is the practical entry point.

## Mandatory operational programs

### KYC (Know Your Customer)
- Persona (wired) or Sumsub or Onfido — all support automated ID + selfie matching.
- Standard tiers:
  - **Tier 0** (signup): email verification only, can play freerolls.
  - **Tier 1** (deposit): government ID + selfie + proof of address. Required before any real-money play.
  - **Tier 2** (high-volume): source of wealth, source of funds, employer info. Required at thresholds (typically $10k cumulative deposits).
- Persona webhook handler: `/api/kyc/webhook` updates `profiles.kyc_status`.

### AML (Anti–Money Laundering)
- Transaction monitoring: flag deposits/withdrawals matching SAR (Suspicious Activity Report) patterns. Examples:
  - Structuring (multiple deposits just under reporting threshold)
  - Rapid in/out (deposit then withdraw, no play)
  - Chip dumping at heads-up tables
- File SARs / STRs with FinCEN (US) or your jurisdiction's FIU when triggered.
- ⚠️ Build out a transaction-monitoring job that scans `ledger_entries` + `deposits` + `withdrawals` daily. The hooks are there; the logic isn't.
- Sanctions screening on every signup against OFAC SDN, EU consolidated, UK HMT lists. Both Persona and Onfido include this.

### Responsible gambling
- Self-exclusion (in `player_limits.self_excluded_until`) — wired.
- Deposit limits (daily/weekly/monthly) — wired, enforced via SQL function.
- Session timers — table data logged in `session_events`; UI nudges not yet built.
- Reality checks (popups every X minutes) — UI hook needed.
- Required signposting: links to GamCare, BeGambleAware, the National Council on Problem Gambling. Add to footer.

### Fairness & game integrity
- RNG certified by an independent lab (BMM, GLI, iTech Labs). Required by every regulator. Cost: $5–15k for cert.
- Our shuffle is provably-fair via commit-reveal — provide the verification white paper to the lab and they'll certify it.
- Hand histories retained ≥ 5 years (UKGC requires 7). Implemented: every action + seed is in Postgres.

### Player funds segregation
- Player funds must be held separately from operating capital. Our vault PDA architecture does this on-chain by default — operator funds and player USDC are different addresses.
- The audit endpoint `/api/audit/totals` proves segregation at any moment.

### Tax
- US 1099 reporting threshold: $5,000 single payout, or $20,000 + 200 transactions. You issue 1099-K to players; they pay tax.
- W-9 collection (US persons), W-8BEN (foreign) at signup or on first cashout.
- VAT/GST varies; in many EU states gambling is VAT-exempt but separate gaming duty applies.

## Geofencing — minimum block list

Default `BLOCKED_COUNTRIES` includes US, FR, AU, IL, KP, IR, CU, SY, SD. Tune per your license. Common additions:
- Singapore, Hong Kong (gambling restricted)
- UAE, Saudi Arabia, Qatar (haram)
- North Korea, Cuba, Syria, Iran, Sudan (US sanctions)
- Russia, Belarus (post-2022 sanctions)

## Data residency

- GDPR: provide data export + deletion. Stub the right endpoint as `/api/me/export` and `/api/me/delete-request`.
- CCPA: similar; California users.
- Data must be deletable except where retention is mandated (AML logs are typically retained 5 years even after account deletion).

## Game-specific rules

- Poker is regulated as a "game of skill" in some places (US states like NV, AK, MN) and "gambling" in others. Where gambling, it's typically lumped with casino — verify in your license terms.
- Rake disclosure: many regulators require rake to be disclosed at the table. Build a tooltip.
- Tournament cancellation: must refund according to a documented policy. Add it to ToS.

## Tournaments-specific

- Late registration window must be disclosed pre-event.
- Payouts must follow a published structure. Stored in `tournaments.payout_structure`.
- Disconnection protection: if a player disconnects mid-tournament, their hand-by-hand state is server-authoritative; reconnection is automatic (LiveKit + ws-client both reconnect).

## Records you must keep

| Record | Retention | Where |
|---|---|---|
| Hand histories | ≥ 5 yr (UK 7 yr) | `hands`, `hand_actions`, `hand_results` |
| Deposits / withdrawals | ≥ 7 yr | `deposits`, `withdrawals`, on-chain |
| KYC documents | ≥ 5 yr post-account-closure | Persona |
| Login events | ≥ 1 yr | `session_events` |
| Self-exclusion records | Indefinitely | `player_limits` |
| Promotional T&Cs | Indefinitely | Static pages or CMS |

## Footer links (legally required in most regulated markets)

- Terms & Conditions
- Privacy Policy
- Responsible Gambling
- Self-exclusion
- Complaint procedure (must include independent ADR)
- License number + regulator logo
- Age verification (18+ or 21+)
