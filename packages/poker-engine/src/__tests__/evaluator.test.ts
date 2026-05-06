import { describe, expect, it } from 'vitest';
import { cardFromString } from '../cards.js';
import { compareHands, evaluate } from '../evaluator.js';

const h = (s: string) => s.split(/\s+/).filter(Boolean).map(cardFromString);

describe('evaluator', () => {
  it('royal flush > everything', () => {
    const royal = evaluate(h('As Ks Qs Js Ts'));
    expect(royal.rank).toBe(9);
    const sf = evaluate(h('9s 8s 7s 6s 5s'));
    expect(sf.rank).toBe(9);
    expect(compareHands(royal, sf)).toBe(1);
  });

  it('wheel straight flush is 5-high', () => {
    const wheel = evaluate(h('As 2s 3s 4s 5s'));
    expect(wheel.rank).toBe(9);
    const six = evaluate(h('6s 5s 4s 3s 2s'));
    expect(compareHands(six, wheel)).toBe(1);
  });

  it('quads beats full house', () => {
    const q = evaluate(h('As Ah Ad Ac 2s'));
    const fh = evaluate(h('Ks Kh Kd Qs Qh'));
    expect(compareHands(q, fh)).toBe(1);
  });

  it('full house compares trips first then pair', () => {
    const a = evaluate(h('Ks Kh Kd 2s 2h'));   // KKK22
    const b = evaluate(h('Qs Qh Qd As Ah'));   // QQQAA
    expect(compareHands(a, b)).toBe(1);
  });

  it('flush vs straight', () => {
    const f = evaluate(h('Ah 9h 5h 3h 2h'));
    const s = evaluate(h('Tc 9d 8h 7s 6c'));
    expect(compareHands(f, s)).toBe(1);
  });

  it('best of 7 picks strongest', () => {
    const best = evaluate(h('As Ks Qs Js Ts 2c 3d')); // royal in 7
    expect(best.rank).toBe(9);
  });

  it('chops on identical hands', () => {
    const a = evaluate(h('As Kc Qd Js Th'));
    const b = evaluate(h('Ah Kd Qs Jc Td'));
    expect(compareHands(a, b)).toBe(0);
  });

  it('two pair beats one pair', () => {
    const tp = evaluate(h('As Ah Ks Kh 2c'));
    const op = evaluate(h('As Ah Kc Qs 2c'));
    expect(compareHands(tp, op)).toBe(1);
  });

  it('high-card kickers', () => {
    const a = evaluate(h('As 2c 3d 4s 6h'));    // A high
    const b = evaluate(h('Kc Qd Js 9h 7c'));   // K high
    expect(compareHands(a, b)).toBe(1);
  });
});
