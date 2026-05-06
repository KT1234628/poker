// Cards are integers 0..51.
//   rank = floor(card / 4)        rank 0  = '2', rank 12 = 'A'
//   suit = card % 4               suit 0..3 = 's','h','d','c'

export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

export const CARD_COUNT = 52;

export function makeCard(rank: number, suit: number): Card {
  return rank * 4 + suit;
}

export function rankOf(card: Card): number {
  return card >> 2;
}

export function suitOf(card: Card): number {
  return card & 3;
}

export function cardToString(card: Card): string {
  return RANKS[rankOf(card)]! + SUITS[suitOf(card)]!;
}

export function cardFromString(s: string): Card {
  if (s.length !== 2) throw new Error(`bad card: ${s}`);
  const r = RANKS.indexOf(s[0]!.toUpperCase());
  const su = SUITS.indexOf(s[1]!.toLowerCase());
  if (r < 0 || su < 0) throw new Error(`bad card: ${s}`);
  return makeCard(r, su);
}

export function cardsToString(cards: readonly Card[]): string {
  return cards.map(cardToString).join(' ');
}

export const FRESH_DECK: ReadonlyArray<Card> = (() => {
  const d: Card[] = [];
  for (let i = 0; i < 52; i++) d.push(i);
  return d;
})();
