'use client';

import clsx from 'clsx';
import { Card } from './Card';
import { VideoTile } from './VideoTile';
import type { PublicSeat } from '@stacks/shared-types';

interface SeatProps {
  seat: PublicSeat;
  position: { top: string; left: string; transform?: string };
  isMe: boolean;
  isToAct: boolean;
  isWinner?: boolean;
  holeCards?: [number, number];
  showCards?: boolean;
  liveKitIdentity?: string;        // for video tile lookup
}

export function Seat({ seat, position, isMe, isToAct, isWinner, holeCards, showCards, liveKitIdentity }: SeatProps) {
  const isEmpty = seat.status === 'empty';
  const isFolded = seat.status === 'folded';

  return (
    <div className="absolute" style={position}>
      <div className={clsx('relative flex flex-col items-center gap-2', isFolded && 'opacity-50')}>
        {!isEmpty && (
          <>
            {/* Hole cards */}
            <div className="-mb-1 flex gap-1">
              {isMe && holeCards ? (
                <>
                  <Card index={holeCards[0]} animated />
                  <Card index={holeCards[1]} animated />
                </>
              ) : showCards && holeCards ? (
                <>
                  <Card index={holeCards[0]} />
                  <Card index={holeCards[1]} />
                </>
              ) : seat.status === 'active' || seat.status === 'all_in' ? (
                <>
                  <Card hidden />
                  <Card hidden />
                </>
              ) : null}
            </div>

            {/* Avatar / video tile */}
            <div
              className={clsx(
                'relative h-20 w-20 overflow-hidden rounded-full ring-2 sm:h-24 sm:w-24',
                isMe ? 'ring-gold-500' : 'ring-white/30',
                isToAct && 'animate-pulseRing ring-gold-400',
                isWinner && 'ring-gold-400'
              )}
            >
              {liveKitIdentity ? (
                <VideoTile identity={liveKitIdentity} fallbackInitials={seat.userId?.slice(0, 2).toUpperCase() ?? '??'} />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 text-2xl font-bold">
                  {(seat.userId ?? '??').slice(0, 2).toUpperCase()}
                </div>
              )}
              {seat.isDealer && (
                <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-white text-xs font-bold text-black ring-2 ring-felt-900">D</span>
              )}
              {seat.isSb && <span className="absolute bottom-0 right-0 rounded bg-blue-500 px-1 text-[10px] font-bold">SB</span>}
              {seat.isBb && <span className="absolute bottom-0 right-0 rounded bg-red-500 px-1 text-[10px] font-bold">BB</span>}
            </div>

            {/* Name + stack */}
            <div className="rounded bg-black/70 px-3 py-1 text-center backdrop-blur">
              <p className="max-w-[120px] truncate text-xs font-semibold">{seat.userId?.slice(0, 8) ?? '—'}</p>
              <p className="font-mono text-sm font-bold text-gold-400">${(seat.stack / 1e6).toFixed(2)}</p>
            </div>

            {/* Bet chips */}
            {seat.committedThisRound > 0 && (
              <div className="absolute -translate-y-32 animate-chipPush rounded-full border-2 border-yellow-700 bg-yellow-500 px-3 py-1 font-mono text-xs font-bold text-black">
                ${(seat.committedThisRound / 1e6).toFixed(2)}
              </div>
            )}

            {seat.status === 'all_in' && (
              <span className="absolute top-0 rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase">All in</span>
            )}
          </>
        )}
        {isEmpty && (
          <button className="grid h-20 w-20 place-items-center rounded-full border-2 border-dashed border-white/30 text-xs uppercase text-white/40 hover:border-gold-500 hover:text-gold-400 sm:h-24 sm:w-24">
            Sit
          </button>
        )}
      </div>
    </div>
  );
}
