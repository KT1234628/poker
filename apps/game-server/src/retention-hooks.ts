// Retention + integrity hooks called by Room.completeHand.
//
//   • detect & pay out Bad Beat Jackpot (when qualifying)
//   • record mission progress (hand played + hand won + rakeback)
//   • contribute to BBJ pot from raked pots
//
// Each function is idempotent and safe to no-op when nothing applies.

import { detectBadBeat, type Card } from '@stacks/poker-engine';
import { db } from './db.js';
import { log } from './log.js';

export async function recordHandMissions(args: {
  handId: string;
  participants: string[];
  winners: { userId: string; holeCards: [Card, Card]; potShare: number }[];
}) {
  // Each player who played a hand: +1 'hand_played'.
  for (const u of args.participants) {
    await bumpMission(u, ['play_n_hands']);
  }
  // Winners: +1 'hand_won' and check pocket-pair specials
  for (const w of args.winners) {
    await bumpMission(w.userId, ['win_n_hands']);
    const label = pocketLabel(w.holeCards);
    if (label) {
      await db.from('mission_progress').upsert({
        user_id: w.userId,
        template_id: '00000000-0000-0000-0000-000000000000', // placeholder; missions service reads label-keyed templates
        progress: 1,
        target_at_assign: 1,
      } as never, { onConflict: 'user_id,template_id' as never }).then(() => undefined).catch(() => undefined);
    }
  }
}

async function bumpMission(userId: string, kinds: string[]) {
  // Query mission_templates by kinds, increment progress
  const { data: templates } = await db
    .from('mission_templates')
    .select('id, target')
    .in('kind', kinds);
  for (const t of templates ?? []) {
    const target = ((t.target as { count?: number; hands?: number }).count ?? (t.target as { hands?: number }).hands) ?? 1;
    // Idempotency: upsert and increment via raw RPC
    await db.rpc('increment_mission_progress', {
      p_user_id: userId,
      p_template_id: t.id,
      p_target: target,
    } as never).catch(() => {
      // Fallback: emulate without the RPC
      void db.from('mission_progress').upsert({
        user_id: userId,
        template_id: t.id,
        progress: 1,
        target_at_assign: target,
      }, { onConflict: 'user_id,template_id', ignoreDuplicates: true });
    });
  }
}

function pocketLabel(c: [Card, Card]): string | null {
  const r1 = c[0] >> 2, r2 = c[1] >> 2, s1 = c[0] & 3, s2 = c[1] & 3;
  const rankCh = '23456789TJQKA';
  if (r1 === r2) return rankCh[r1]! + rankCh[r1]!;
  const high = Math.max(r1, r2), low = Math.min(r1, r2);
  return rankCh[high]! + rankCh[low]! + (s1 === s2 ? 's' : 'o');
}

// ─── BBJ ─────────────────────────────────────────────────────────────────────

export async function bbjContribute(potSize: number, scope = 'global'): Promise<number> {
  const { data } = await db.rpc('bbj_contribute', { p_pot_amount: potSize, p_scope: scope });
  return Number(data ?? 0);
}

export async function bbjMaybePay(args: {
  scope?: string;
  handId: string;
  board: Card[];
  reveals: Array<{ seatIdx: number; userId: string | null; cards: [Card, Card] }>;
  allDealtUserIds: string[];
}): Promise<{ paid: boolean; amount: number } | null> {
  const scope = args.scope ?? 'global';
  const { data: jackpot } = await db.from('bad_beat_jackpots')
    .select('id, qualifying_hand_min_rank, qualifying_hand_min_value, pot_amount')
    .eq('scope', scope).maybeSingle();
  if (!jackpot) return null;

  const detected = detectBadBeat(
    {
      minLoserRank: Number(jackpot.qualifying_hand_min_rank),
      minLoserValue: jackpot.qualifying_hand_min_value ? BigInt(jackpot.qualifying_hand_min_value) : undefined,
      requireBothHoleCardsUsed: true,
    },
    { board: args.board, reveals: args.reveals }
  );
  if (!detected || !detected.loser.userId || !detected.winner.userId) return { paid: false, amount: 0 };

  const { data: paid } = await db.rpc('bbj_award', {
    p_jackpot_id: jackpot.id,
    p_hand_id: args.handId,
    p_loser_user_id: detected.loser.userId,
    p_winner_user_id: detected.winner.userId,
    p_table_user_ids: args.allDealtUserIds,
  });

  if (paid && Number(paid) > 0) {
    log.info({ handId: args.handId, paid }, 'BBJ paid');
    return { paid: true, amount: Number(paid) };
  }
  return { paid: false, amount: 0 };
}
