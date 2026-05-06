'use client';

// Mobile-optimized action bar.
//   • Big tap targets (56px+ height)
//   • Pre-action buttons: "Check/Fold", "Call any", "Fold to any" — fire as
//     soon as it's your turn so quick deciders don't have to wait for the
//     server tick.
//   • Swipe-up bet slider with haptic dots at ½ pot, ⅔, pot, 2× pot, all-in
//   • Big translucent action confirmation pulse over the whole screen.
//
// Sound + haptic feedback when supported (iOS Safari supports vibration only
// in PWAs; Android works generally).

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { LegalActions } from './ActionBar';

interface Props {
  legal: LegalActions | null;
  bigBlind: number;
  pot: number;
  deadlineMs: number | null;
  onAction: (a: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in', amount?: number) => void;
  /** Pre-action: fires as soon as it's the user's turn. */
  onPreAction: (a: 'fold_to_any' | 'check_fold' | 'call_any' | 'cancel') => void;
  preAction: 'fold_to_any' | 'check_fold' | 'call_any' | null;
  isMyTurn: boolean;
}

export function MobileActionBar({ legal, bigBlind, pot, deadlineMs, onAction, onPreAction, preAction, isMyTurn }: Props) {
  const [amount, setAmount] = useState<number>(legal?.minRaise ?? legal?.minBet ?? 0);
  const [now, setNow] = useState(Date.now());
  const [confirmingFold, setConfirmingFold] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (legal?.canRaise) setAmount(legal.minRaise);
    else if (legal?.canBet) setAmount(legal.minBet);
  }, [legal?.canBet, legal?.canRaise, legal?.minBet, legal?.minRaise]);

  function vib(ms: number) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
  }

  // Pre-action mode (no legal actions yet — show pre-action toggles)
  if (!legal && !isMyTurn) {
    return (
      <div ref={wrapperRef} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 gap-1 bg-black/85 p-2 backdrop-blur">
        <PreBtn label="Fold to any" active={preAction === 'fold_to_any'} onClick={() => { vib(15); onPreAction(preAction === 'fold_to_any' ? 'cancel' : 'fold_to_any'); }} color="red" />
        <PreBtn label="Check/Fold" active={preAction === 'check_fold'} onClick={() => { vib(15); onPreAction(preAction === 'check_fold' ? 'cancel' : 'check_fold'); }} color="gray" />
        <PreBtn label="Call any" active={preAction === 'call_any'} onClick={() => { vib(15); onPreAction(preAction === 'call_any' ? 'cancel' : 'call_any'); }} color="green" />
      </div>
    );
  }

  if (!legal) return null;

  const remaining = deadlineMs ? Math.max(0, deadlineMs - now) : 0;
  const totalTime = 20000;
  const pct = deadlineMs ? Math.max(0, Math.min(100, (remaining / totalTime) * 100)) : 0;

  const presets = [
    { label: '½', value: Math.max(legal.minRaise || legal.minBet, Math.floor(pot * 0.5)) },
    { label: '⅔', value: Math.max(legal.minRaise || legal.minBet, Math.floor(pot * 0.66)) },
    { label: 'pot', value: Math.max(legal.minRaise || legal.minBet, pot) },
    { label: '2×', value: Math.max(legal.minRaise || legal.minBet, pot * 2) },
    { label: 'max', value: legal.maxRaise },
  ].map(p => ({ ...p, value: Math.min(p.value, legal.maxRaise) }));

  return (
    <div ref={wrapperRef} className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black/90 p-3 backdrop-blur">
      {deadlineMs && (
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-gold-500" style={{ width: `${pct}%` }} />
        </div>
      )}

      {(legal.canBet || legal.canRaise) && (
        <div className="mb-2 space-y-2">
          <input
            type="range"
            min={legal.minBet || legal.minRaise}
            max={legal.maxRaise}
            step={Math.max(1, Math.floor(bigBlind / 4))}
            value={amount}
            onChange={e => { setAmount(parseInt(e.target.value)); }}
            onTouchStart={() => vib(8)}
            className="h-12 w-full accent-gold-500"
          />
          <div className="grid grid-cols-5 gap-1">
            {presets.map(p => (
              <button key={p.label} onClick={() => { setAmount(p.value); vib(10); }} className="rounded bg-white/10 py-2 text-xs font-bold uppercase active:bg-white/30">
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-center font-mono text-xl font-bold text-gold-400">${(amount / 1e6).toFixed(2)}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => {
            if (confirmingFold) {
              vib(50);
              onAction('fold');
              setConfirmingFold(false);
            } else {
              setConfirmingFold(true);
              setTimeout(() => setConfirmingFold(false), 1500);
            }
          }}
          className={clsx('h-14 rounded-md font-bold uppercase', confirmingFold ? 'bg-red-700 text-white' : 'bg-red-600/90 text-white active:bg-red-700')}
          disabled={!legal.canFold}
        >
          {confirmingFold ? 'Tap again' : 'Fold'}
        </button>

        {legal.canCheck ? (
          <button onClick={() => { vib(20); onAction('check'); }} className="h-14 rounded-md bg-white/10 font-bold uppercase active:bg-white/30">
            Check
          </button>
        ) : legal.canCall ? (
          <button onClick={() => { vib(20); onAction('call'); }} className="h-14 rounded-md bg-gold-500 font-bold uppercase text-black active:bg-gold-400">
            Call <br /><span className="font-mono text-sm">${(legal.callAmount / 1e6).toFixed(2)}</span>
          </button>
        ) : (
          <div />
        )}

        {legal.canRaise ? (
          <button onClick={() => { vib(30); onAction('raise', amount); }} className="h-14 rounded-md bg-gold-600 font-bold uppercase text-black active:bg-gold-500">
            Raise <br /><span className="font-mono text-sm">${(amount / 1e6).toFixed(2)}</span>
          </button>
        ) : legal.canBet ? (
          <button onClick={() => { vib(30); onAction('bet', amount); }} className="h-14 rounded-md bg-gold-600 font-bold uppercase text-black active:bg-gold-500">
            Bet <br /><span className="font-mono text-sm">${(amount / 1e6).toFixed(2)}</span>
          </button>
        ) : legal.canAllIn ? (
          <button onClick={() => { vib(50); onAction('all_in'); }} className="h-14 rounded-md bg-red-700 font-bold uppercase text-white active:bg-red-800">
            All in
          </button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}

function PreBtn({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color: 'red' | 'gray' | 'green' }) {
  const baseColor = color === 'red' ? 'bg-red-600/40 text-red-100' : color === 'green' ? 'bg-green-600/40 text-green-100' : 'bg-white/10';
  const activeRing = active ? 'ring-2 ring-gold-400' : '';
  return (
    <button onClick={onClick} className={`h-14 rounded-md ${baseColor} ${activeRing} text-xs font-bold uppercase active:opacity-80`}>
      {active && <span>✓ </span>}
      {label}
    </button>
  );
}
