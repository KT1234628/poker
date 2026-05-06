// Bounty / Knockout / Progressive Knockout / Mystery Bounty.
//
// Three formats supported:
//   • Knockout (KO): each player has a fixed bounty on their head. When you
//     bust them, you collect their bounty.
//   • Progressive Knockout (PKO): half (configurable) of the bounty goes to
//     the player who knocks them out; the other half is added to that
//     player's own bounty. Bounty grows like a snowball.
//   • Mystery Bounty: there is a fixed prize pool of "mystery" amounts. When
//     a player is KO'd in or after the mystery bounty round, the eliminator
//     draws an envelope from the pool to reveal their prize.
//
// In all formats, the **bounty pool** is funded out of the buyin (typically
// 50/50 between bounty pool and main prize pool, or 100/0 etc).

export interface KoConfig {
  format: 'knockout' | 'progressive_ko' | 'mystery_bounty';
  /** Initial bounty per player (used for KO + PKO). */
  initialBountyPerPlayer: number;
  /** For PKO: fraction of bounty that pays out vs. adds to head. Default 5000 = 50/50. */
  progressiveBps: number;
  /** For mystery_bounty: pool of envelopes [{ amount, count, weight }]. */
  mysteryPool?: MysteryBucket[];
  /** Mystery bounties activate after this number of bust-outs. */
  mysteryStartsAfterBustouts?: number;
}

export interface MysteryBucket {
  amount: number;        // micro-USDC
  count: number;         // how many envelopes of this amount remain
  weight: number;        // relative draw probability (often == count)
  label?: string;        // 'small', 'medium', 'big', 'mega'
}

export interface BountyState {
  /** Per-user-id current bounty on their head. */
  perPlayerBounty: Map<string, number>;
  /** Cumulative bounty winnings per user. */
  perPlayerWon: Map<string, number>;
  /** KO count per user. */
  perPlayerKos: Map<string, number>;
  /** Global cumulative pool removed from bounty pot (for accounting). */
  poolDistributed: number;
  /** For mystery: remaining envelopes, mutated as drawn. */
  mysteryRemaining: MysteryBucket[];
  /** Number of bust-outs so far (drives mystery activation). */
  bustoutsSoFar: number;
}

export function newBountyState(cfg: KoConfig, players: string[]): BountyState {
  const perPlayer = new Map<string, number>();
  for (const p of players) perPlayer.set(p, cfg.initialBountyPerPlayer);
  return {
    perPlayerBounty: perPlayer,
    perPlayerWon: new Map(),
    perPlayerKos: new Map(),
    poolDistributed: 0,
    mysteryRemaining: cfg.mysteryPool ? cfg.mysteryPool.map(b => ({ ...b })) : [],
    bustoutsSoFar: 0,
  };
}

export interface BountyPayout {
  format: KoConfig['format'];
  koUserId: string;             // player who got eliminated
  koByUserId: string;           // player who eliminated them
  bountyAmount: number;         // chips paid to KO'er
  addedToHead: number;          // chips added to KO'er's own head bounty
  isMystery: boolean;
  mysteryBucket?: string;
}

export function processKnockout(
  cfg: KoConfig,
  state: BountyState,
  args: { koUserId: string; koByUserId: string; rng?: () => number }
): BountyPayout {
  state.bustoutsSoFar++;
  const headBounty = state.perPlayerBounty.get(args.koUserId) ?? 0;

  switch (cfg.format) {
    case 'knockout': {
      state.perPlayerWon.set(
        args.koByUserId,
        (state.perPlayerWon.get(args.koByUserId) ?? 0) + headBounty
      );
      state.perPlayerKos.set(
        args.koByUserId,
        (state.perPlayerKos.get(args.koByUserId) ?? 0) + 1
      );
      state.perPlayerBounty.set(args.koUserId, 0);
      state.poolDistributed += headBounty;
      return {
        format: 'knockout',
        koUserId: args.koUserId,
        koByUserId: args.koByUserId,
        bountyAmount: headBounty,
        addedToHead: 0,
        isMystery: false,
      };
    }
    case 'progressive_ko': {
      const toKoer = Math.floor((headBounty * cfg.progressiveBps) / 10000);
      const toHead = headBounty - toKoer;
      state.perPlayerWon.set(
        args.koByUserId,
        (state.perPlayerWon.get(args.koByUserId) ?? 0) + toKoer
      );
      state.perPlayerKos.set(
        args.koByUserId,
        (state.perPlayerKos.get(args.koByUserId) ?? 0) + 1
      );
      state.perPlayerBounty.set(
        args.koByUserId,
        (state.perPlayerBounty.get(args.koByUserId) ?? 0) + toHead
      );
      state.perPlayerBounty.set(args.koUserId, 0);
      state.poolDistributed += toKoer;
      return {
        format: 'progressive_ko',
        koUserId: args.koUserId,
        koByUserId: args.koByUserId,
        bountyAmount: toKoer,
        addedToHead: toHead,
        isMystery: false,
      };
    }
    case 'mystery_bounty': {
      // If we haven't reached the mystery activation, fall back to flat KO
      const activation = cfg.mysteryStartsAfterBustouts ?? 0;
      if (state.bustoutsSoFar <= activation) {
        return processKnockout({ ...cfg, format: 'knockout' }, state, args);
      }
      const draw = drawMystery(state.mysteryRemaining, args.rng ?? Math.random);
      const amount = draw?.amount ?? headBounty;
      state.perPlayerWon.set(
        args.koByUserId,
        (state.perPlayerWon.get(args.koByUserId) ?? 0) + amount
      );
      state.perPlayerKos.set(
        args.koByUserId,
        (state.perPlayerKos.get(args.koByUserId) ?? 0) + 1
      );
      state.perPlayerBounty.set(args.koUserId, 0);
      state.poolDistributed += amount;
      return {
        format: 'mystery_bounty',
        koUserId: args.koUserId,
        koByUserId: args.koByUserId,
        bountyAmount: amount,
        addedToHead: 0,
        isMystery: true,
        mysteryBucket: draw?.label,
      };
    }
  }
}

function drawMystery(buckets: MysteryBucket[], rng: () => number): MysteryBucket | null {
  const live = buckets.filter(b => b.count > 0);
  if (live.length === 0) return null;
  const totalWeight = live.reduce((a, b) => a + b.weight, 0);
  let t = rng() * totalWeight;
  for (const b of live) {
    t -= b.weight;
    if (t <= 0) {
      b.count--;
      return b;
    }
  }
  const last = live[live.length - 1]!;
  last.count--;
  return last;
}
