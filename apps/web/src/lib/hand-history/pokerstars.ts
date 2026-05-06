// Render a hand into PokerStars-format text. Compatible with PokerTracker 4
// and Hold'em Manager 3.
//
// Sample format:
//   PokerStars Hand #198765432:  Hold'em No Limit ($0.50/$1.00 USD) - 2026/05/06 12:34:56 ET
//   Table 'Tortoise II' 9-max Seat #5 is the button
//   Seat 1: alice ($120 in chips)
//   Seat 2: bob ($98.50 in chips)
//   ...
//   alice: posts small blind $0.50
//   bob: posts big blind $1.00
//   *** HOLE CARDS ***
//   Dealt to alice [Ah Kd]
//   alice: raises $2 to $3
//   bob: calls $2
//   *** FLOP *** [Qs Jc 4h]
//   alice: bets $4
//   ...
//   *** SUMMARY ***
//   Total pot $12 | Rake $0.60
//   Board [Qs Jc 4h 8d 2c]
//   Seat 1: alice (small blind) showed [Ah Kd] and won ($11.40) with high card Ace
//   Seat 2: bob (big blind) folded on the Turn

import type { SupabaseClient } from '@supabase/supabase-js';

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['s','h','d','c'];

function fmtCard(idx: number): string {
  return RANKS[idx >> 2]! + SUITS[idx & 3]!;
}

function fmtCards(cards: number[] | null | undefined): string {
  if (!cards || cards.length === 0) return '';
  return cards.map(fmtCard).join(' ');
}

function fmt(v: number): string {
  return '$' + (v / 1e6).toFixed(2);
}

interface Hand {
  id: string;
  hand_number: number;
  table_id: string;
  dealer_seat: number;
  sb_seat: number;
  bb_seat: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  pot: number;
  rake: number;
  board_cards: number[] | null;
  started_at: string;
  ended_at: string | null;
  is_bomb_pot?: boolean;
  run_count?: number;
  boards?: number[][] | null;
}

interface Action {
  seat_idx: number;
  user_id: string | null;
  phase: string;
  action: string;
  amount: number;
}

interface ResultRow {
  seat_idx: number;
  user_id: string | null;
  winnings: number;
  hand_rank: number | null;
  hole_cards: number[] | null;
  shown: boolean;
}

interface SeatedRow {
  seat_idx: number;
  username: string;
  stack: number;
}

interface TableMeta {
  name: string;
  max_seats: number;
}

export async function renderHandPokerStars(sb: SupabaseClient, handId: string): Promise<string | null> {
  const [{ data: hand }, { data: actions }, { data: results }, { data: holeCards }] = await Promise.all([
    sb.from('hands').select('*').eq('id', handId).maybeSingle<Hand>(),
    sb.from('hand_actions').select('seat_idx, user_id, phase, action, amount').eq('hand_id', handId).order('sequence', { ascending: true }),
    sb.from('hand_results').select('seat_idx, user_id, winnings, hand_rank, hole_cards, shown').eq('hand_id', handId),
    sb.from('hand_hole_cards').select('seat_idx, user_id, cards').eq('hand_id', handId),
  ]);
  if (!hand) return null;

  const { data: tableMeta } = await sb.from('tables').select('name, max_seats').eq('id', hand.table_id).maybeSingle<TableMeta>();
  const { data: seats } = await sb
    .from('table_seats')
    .select('seat_idx, profiles!inner(username), stack')
    .eq('table_id', hand.table_id)
    .returns<{ seat_idx: number; profiles: { username: string }; stack: number }[]>();

  const seatList: SeatedRow[] = (seats ?? []).map(s => ({ seat_idx: s.seat_idx, username: s.profiles.username, stack: Number(s.stack) }));
  const username = (seatIdx: number) => seatList.find(s => s.seat_idx === seatIdx)?.username ?? `seat${seatIdx}`;

  const lines: string[] = [];
  const date = new Date(hand.started_at);
  const dateStr = `${date.getUTCFullYear()}/${(date.getUTCMonth()+1).toString().padStart(2,'0')}/${date.getUTCDate().toString().padStart(2,'0')} ${date.getUTCHours().toString().padStart(2,'0')}:${date.getUTCMinutes().toString().padStart(2,'0')}:${date.getUTCSeconds().toString().padStart(2,'0')}`;
  lines.push(`Stacks Hand #${hand.hand_number}: Hold'em No Limit (${fmt(hand.small_blind)}/${fmt(hand.big_blind)} USD) - ${dateStr} UTC`);
  lines.push(`Table '${tableMeta?.name ?? hand.table_id.slice(0,8)}' ${tableMeta?.max_seats ?? 9}-max Seat #${hand.dealer_seat + 1} is the button`);
  for (const s of seatList) {
    lines.push(`Seat ${s.seat_idx + 1}: ${s.username} (${fmt(s.stack)} in chips)`);
  }
  if (hand.ante > 0) {
    for (const s of seatList) lines.push(`${s.username}: posts the ante ${fmt(hand.ante)}`);
  }
  lines.push(`${username(hand.sb_seat)}: posts small blind ${fmt(hand.small_blind)}`);
  lines.push(`${username(hand.bb_seat)}: posts big blind ${fmt(hand.big_blind)}`);

  const myUserId = (results ?? []).find(r => r.user_id)?.user_id;
  const myHole = (holeCards ?? []).find(h => h.user_id === myUserId)?.cards;

  lines.push('*** HOLE CARDS ***');
  if (myHole && myUserId) {
    const me = seatList.find(s => username(s.seat_idx) === username(seatList.find(x => myUserId)?.seat_idx ?? 0))?.username ?? 'hero';
    lines.push(`Dealt to ${me} [${fmtCards(myHole)}]`);
  }

  let lastPhase = 'preflop';
  for (const a of (actions ?? []) as Action[]) {
    if (a.phase !== lastPhase) {
      lastPhase = a.phase;
      const board = hand.board_cards ?? [];
      if (a.phase === 'flop') lines.push(`*** FLOP *** [${fmtCards(board.slice(0,3))}]`);
      else if (a.phase === 'turn') lines.push(`*** TURN *** [${fmtCards(board.slice(0,3))}] [${fmtCards(board.slice(3,4))}]`);
      else if (a.phase === 'river') lines.push(`*** RIVER *** [${fmtCards(board.slice(0,4))}] [${fmtCards(board.slice(4,5))}]`);
    }
    const u = username(a.seat_idx);
    switch (a.action) {
      case 'fold': lines.push(`${u}: folds`); break;
      case 'check': lines.push(`${u}: checks`); break;
      case 'call': lines.push(`${u}: calls ${fmt(a.amount)}`); break;
      case 'bet': lines.push(`${u}: bets ${fmt(a.amount)}`); break;
      case 'raise': lines.push(`${u}: raises to ${fmt(a.amount)}`); break;
      case 'all_in': lines.push(`${u}: goes all in ${fmt(a.amount)}`); break;
      case 'time_out': lines.push(`${u}: is disconnected`); break;
    }
  }

  if (hand.run_count && hand.run_count > 1) {
    lines.push(`*** RAN ${hand.run_count} TIMES ***`);
    for (let i = 0; i < (hand.boards?.length ?? 0); i++) {
      lines.push(`Board ${i+1} [${fmtCards(hand.boards![i] ?? [])}]`);
    }
  }

  lines.push('*** SUMMARY ***');
  lines.push(`Total pot ${fmt(hand.pot)} | Rake ${fmt(hand.rake)}`);
  if (hand.board_cards && hand.board_cards.length) {
    lines.push(`Board [${fmtCards(hand.board_cards)}]`);
  }
  for (const r of (results ?? []) as ResultRow[]) {
    const u = username(r.seat_idx);
    if (r.winnings > 0) {
      const cards = r.hole_cards ? `[${fmtCards(r.hole_cards)}]` : '';
      lines.push(`Seat ${r.seat_idx + 1}: ${u} ${cards} won ${fmt(r.winnings)}`);
    } else if (r.shown && r.hole_cards) {
      lines.push(`Seat ${r.seat_idx + 1}: ${u} showed [${fmtCards(r.hole_cards)}] and lost`);
    } else {
      lines.push(`Seat ${r.seat_idx + 1}: ${u} folded`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
