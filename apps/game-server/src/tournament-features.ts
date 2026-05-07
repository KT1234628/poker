// Tournament features wiring: bounty payouts, satellites, sync clock, ticker.
// Runs alongside the existing tournament-runner; can be invoked from there
// or as standalone hooks.

import {
  computeOverlay,
  computeSatellitePayouts,
  evaluateReEntry,
  newBountyState,
  newSyncClock,
  syncCurrentLevel as currentLevel,
  syncPause as pauseSync,
  syncResume as resumeSync,
  processKnockout,
  type BountyState,
  type KoConfig,
  type LevelDef,
  type ReEntryRule,
  type SyncClock,
} from '@stacks/tournament-engine';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { log } from './log.js';
import { Channels, publish } from './redis.js';

// ─── Bounty handling ─────────────────────────────────────────────────────────

export class BountyController {
  private state: BountyState;
  constructor(public readonly tournamentId: string, cfg: KoConfig, players: string[]) {
    this.state = newBountyState(cfg, players);
  }

  bountyOf(userId: string): number {
    return this.state.perPlayerBounty.get(userId) ?? 0;
  }

  async knockout(args: {
    cfg: KoConfig;
    handId: string | null;
    koUserId: string;
    koByUserId: string;
  }) {
    const payout = processKnockout(args.cfg, this.state, {
      koUserId: args.koUserId,
      koByUserId: args.koByUserId,
    });

    await db.from('bounty_payouts').insert({
      tournament_id: this.tournamentId,
      hand_id: args.handId,
      ko_user_id: args.koUserId,
      ko_by_user_id: args.koByUserId,
      bounty_amount: payout.bountyAmount,
      added_to_head: payout.addedToHead,
      is_mystery: payout.isMystery,
      mystery_bucket: payout.mysteryBucket ?? null,
    });

    if (payout.bountyAmount > 0) {
      await db.rpc('credit_chips', {
        p_user_id: args.koByUserId,
        p_amount: payout.bountyAmount,
        p_kind: 'tournament_prize',
        p_ref_table: 'tournaments',
        p_ref_id: this.tournamentId,
        p_metadata: { kind: 'bounty', from: args.koUserId, mystery: payout.isMystery, bucket: payout.mysteryBucket },
      });
    }

    // Update tournament_entries running totals
    await db.from('tournament_entries').update({
      bounty_balance: 0,
    }).eq('tournament_id', this.tournamentId).eq('user_id', args.koUserId);

    await db.from('tournament_entries').update({
      bounties_won: this.state.perPlayerKos.get(args.koByUserId) ?? 0,
      bounties_won_total: this.state.perPlayerWon.get(args.koByUserId) ?? 0,
      bounty_balance: this.state.perPlayerBounty.get(args.koByUserId) ?? 0,
    }).eq('tournament_id', this.tournamentId).eq('user_id', args.koByUserId);

    await publish(Channels.tournament(this.tournamentId), {
      kind: 'bounty',
      handId: args.handId,
      ...payout,
    });

    return payout;
  }
}

// ─── Re-entry ────────────────────────────────────────────────────────────────

export async function tryReEntry(args: {
  tournamentId: string;
  userId: string;
  rule: ReEntryRule;
  currentLevel: number;
  lateRegOpen: boolean;
  buyIn: number;
  rakeBps: number;
  startingStack: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: prior } = await db
    .from('tournament_entries')
    .select('re_entry_count, status')
    .eq('tournament_id', args.tournamentId)
    .eq('user_id', args.userId)
    .maybeSingle();
  const priorCount = Number(prior?.re_entry_count ?? 0);

  const decision = evaluateReEntry(args.rule, {
    userId: args.userId,
    currentLevel: args.currentLevel,
    priorReEntryCount: priorCount,
    lateRegOpen: args.lateRegOpen,
  });
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  // Debit buyin
  try {
    await db.rpc('debit_chips', {
      p_user_id: args.userId,
      p_amount: args.buyIn,
      p_kind: 'tournament_buyin',
      p_ref_table: 'tournaments',
      p_ref_id: args.tournamentId,
      p_metadata: { kind: 're_entry' },
    });
  } catch (e) {
    return { ok: false, reason: 'insufficient_funds' };
  }

  await db.from('tournament_entries').upsert({
    tournament_id: args.tournamentId,
    user_id: args.userId,
    status: 'playing',
    is_re_entry: true,
    re_entry_count: priorCount + 1,
    stack: args.startingStack,
    busted_at: null,
  }, { onConflict: 'tournament_id,user_id' });

  // Bump prize pool
  const rake = Math.floor((args.buyIn * args.rakeBps) / 10000);
  // (No accounting trace — prize-pool delta below is sufficient.)

  await db.from('tournaments')
    .update({ prize_pool: (await getPrizePool(args.tournamentId)) + (args.buyIn - rake) })
    .eq('id', args.tournamentId);

  return { ok: true };
}

async function getPrizePool(tournamentId: string): Promise<number> {
  const { data } = await db.from('tournaments').select('prize_pool').eq('id', tournamentId).maybeSingle();
  return Number(data?.prize_pool ?? 0);
}

// ─── Synchronized clock ──────────────────────────────────────────────────────

export class TournamentClock {
  clock: SyncClock;
  constructor(startsAtMs: number, public levels: LevelDef[], public breaks: { afterLevel: number; durationSeconds: number }[]) {
    this.clock = newSyncClock(startsAtMs);
  }
  level(now = Date.now()) {
    return currentLevel(this.clock, this.levels, this.breaks, now);
  }
  pause() { this.clock = pauseSync(this.clock); }
  resume() { this.clock = resumeSync(this.clock); }
}

// ─── Satellite payout helper ─────────────────────────────────────────────────

export async function awardSatellitePayouts(args: {
  tournamentId: string;
  finishOrder: string[];      // user IDs in finishing order (1st first)
  seatsAwarded: number;
  targetTournamentId: string;
  ticketValue: number;
  pennyPrize?: number;
}) {
  const payouts = computeSatellitePayouts(
    {
      seatsAwarded: args.seatsAwarded,
      targetTournamentId: args.targetTournamentId,
      ticketValue: args.ticketValue,
      pennyPrize: args.pennyPrize,
    },
    args.finishOrder
  );

  for (const p of payouts) {
    if (p.ticket) {
      const ticketId = randomUUID();
      await db.from('satellite_tickets').insert({
        id: ticketId,
        user_id: p.userId,
        source_tournament_id: args.tournamentId,
        target_tournament_id: args.targetTournamentId,
      });
      await publish(Channels.tournament(args.tournamentId), {
        kind: 'satellite_award',
        userId: p.userId,
        place: p.place,
        ticketId,
        targetTournamentId: args.targetTournamentId,
      });
    }
    if (p.cash > 0) {
      await db.rpc('credit_chips', {
        p_user_id: p.userId,
        p_amount: p.cash,
        p_kind: 'tournament_prize',
        p_ref_table: 'tournaments',
        p_ref_id: args.tournamentId,
      });
    }
    await db.from('tournament_entries').update({
      status: p.ticket ? 'paid' : 'busted',
      position: p.place,
      prize: p.ticket ? args.ticketValue : p.cash,
      ticket_award_id: p.ticket ? args.targetTournamentId : null,
    }).eq('tournament_id', args.tournamentId).eq('user_id', p.userId);
  }
  log.info({ tournamentId: args.tournamentId, awarded: payouts.filter(p => p.ticket).length }, 'satellite tickets awarded');
}

// ─── Live ticker ─────────────────────────────────────────────────────────────

export interface TickerInput {
  tournamentId: string;
  registeredCount: number;
  activeCount: number;
  averageStack: number;
  level: number;
  blindLevel: { sb: number; bb: number; ante: number };
  secondsLeftInLevel: number;
  inBreak: boolean;
  prizePool: number;
}

export async function publishTicker(t: TickerInput) {
  await publish(Channels.tournament(t.tournamentId), {
    kind: 'ticker',
    ...t,
  });
  await db.from('tournaments').update({
    average_chip_stack: t.averageStack,
    current_level: t.level,
  }).eq('id', t.tournamentId);
}

export { computeOverlay };
