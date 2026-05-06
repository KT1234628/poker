'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  minBet: number;
  canRaise: boolean;
  minRaise: number;
  maxRaise: number;
  canAllIn: boolean;
  allInAmount: number;
}

interface Props {
  legal: LegalActions | null;
  bigBlind: number;
  pot: number;
  deadlineMs: number | null;
  onAction: (action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in', amount?: number) => void;
}

export function ActionBar({ legal, bigBlind, pot, deadlineMs, onAction }: Props) {
  const [amount, setAmount] = useState<number>(legal?.minRaise ?? legal?.minBet ?? 0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (legal?.canRaise) setAmount(legal.minRaise);
    else if (legal?.canBet) setAmount(legal.minBet);
  }, [legal?.canRaise, legal?.canBet, legal?.minRaise, legal?.minBet]);

  if (!legal) return <div className="h-32" />;

  const remaining = deadlineMs ? Math.max(0, deadlineMs - now) : 0;
  const totalTime = 20000;
  const pct = deadlineMs ? Math.max(0, Math.min(100, (remaining / totalTime) * 100)) : 0;

  const presets = [
    { label: '½ pot', value: Math.floor(pot * 0.5) },
    { label: '⅔ pot', value: Math.floor(pot * 0.66) },
    { label: 'pot',   value: pot },
    { label: '2× pot', value: pot * 2 },
  ].map(p => ({ ...p, value: clamp(Math.max(p.value, legal.minRaise || legal.minBet), legal.minRaise || legal.minBet, legal.maxRaise) }));

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black/80 p-4 backdrop-blur">
      {deadlineMs && (
        <div className="mx-auto mb-3 h-1 max-w-3xl overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-gold-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        {(legal.canBet || legal.canRaise) && (
          <div className="flex flex-1 items-center gap-2">
            <input
              type="range"
              min={legal.minBet || legal.minRaise}
              max={legal.maxRaise}
              step={Math.max(1, Math.floor(bigBlind / 4))}
              value={amount}
              onChange={e => setAmount(parseInt(e.target.value))}
              className="flex-1 accent-gold-500"
            />
            <input
              type="number"
              min={legal.minBet || legal.minRaise}
              max={legal.maxRaise}
              value={amount}
              onChange={e => setAmount(parseInt(e.target.value || '0'))}
              className="w-28 rounded-md bg-white/10 px-3 py-2 font-mono text-right"
            />
            <div className="hidden gap-1 sm:flex">
              {presets.map(p => (
                <button key={p.label} onClick={() => setAmount(p.value)} className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20">
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => onAction('fold')} className="btn btn-danger" disabled={!legal.canFold}>Fold</button>
          {legal.canCheck && (
            <button onClick={() => onAction('check')} className="btn btn-ghost">Check</button>
          )}
          {legal.canCall && (
            <button onClick={() => onAction('call')} className="btn btn-primary">
              Call <span className="font-mono">${(legal.callAmount / 1e6).toFixed(2)}</span>
            </button>
          )}
          {legal.canBet && (
            <button onClick={() => onAction('bet', amount)} className={clsx('btn', 'btn-primary')}>
              Bet <span className="font-mono">${(amount / 1e6).toFixed(2)}</span>
            </button>
          )}
          {legal.canRaise && (
            <button onClick={() => onAction('raise', amount)} className="btn btn-primary">
              Raise <span className="font-mono">${(amount / 1e6).toFixed(2)}</span>
            </button>
          )}
          {legal.canAllIn && (
            <button onClick={() => onAction('all_in')} className="btn btn-danger">
              All in <span className="font-mono">${(legal.allInAmount / 1e6).toFixed(2)}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
