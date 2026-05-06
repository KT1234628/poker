'use client';

import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant } from '@livekit/components-react';
import type { ServerMessage, TableStateSnapshot } from '@stacks/shared-types';
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { connectGameServer, type GameClient } from '@/lib/ws-client';
import { ActionBar, type LegalActions } from './ActionBar';
import { Card } from './Card';
import { ChatPanel } from './ChatPanel';
import { Seat } from './Seat';

interface Props {
  tableId: string;
  gameWsUrl: string;
  livekitUrl: string;
  livekitToken: string;
  sessionToken: string;
  myUserId: string;
  fingerprint: string;
}

export function PokerTable(props: Props) {
  return (
    <LiveKitRoom
      serverUrl={props.livekitUrl}
      token={props.livekitToken}
      audio
      video
      connectOptions={{
        autoSubscribe: true,
        rtcConfig: {
          iceTransportPolicy: 'all',
          // Aggressive reconnection settings
          iceServers: [],   // LiveKit injects its own
        },
      }}
      options={{
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          videoSimulcastLayers: [
            { width: 320, height: 180, encoding: { maxBitrate: 150_000, maxFramerate: 15 } },
            { width: 640, height: 360, encoding: { maxBitrate: 500_000, maxFramerate: 30 } },
          ],
        },
        disconnectOnPageLeave: false,
      }}
      data-lk-theme="default"
    >
      <RoomAudioRenderer />
      <TableInner {...props} />
    </LiveKitRoom>
  );
}

function TableInner({ tableId, gameWsUrl, sessionToken, myUserId, fingerprint }: Props) {
  const clientRef = useRef<GameClient | null>(null);
  const [state, setState] = useState<TableStateSnapshot | null>(null);
  const [legal, setLegal] = useState<LegalActions | null>(null);
  const [holeCards, setHoleCards] = useState<[number, number] | null>(null);
  const [chat, setChat] = useState<Array<{ user: string; content: string; ts: number }>>([]);
  const [showdownReveals, setShowdownReveals] = useState<Map<number, [number, number]>>(new Map());
  const { localParticipant } = useLocalParticipant();

  // Connect to game server
  useEffect(() => {
    const c = connectGameServer({
      url: gameWsUrl,
      sessionToken,
      deviceFingerprint: fingerprint,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'srv',
    });
    clientRef.current = c;

    const off = c.on((m: ServerMessage) => {
      switch (m.type) {
        case 'state':
          setState(m.payload);
          break;
        case 'hole_cards':
          if (m.payload.tableId === tableId) setHoleCards(m.payload.cards);
          break;
        case 'showdown': {
          const map = new Map<number, [number, number]>();
          for (const r of m.payload.reveals) map.set(r.seatIdx, r.cards);
          setShowdownReveals(map);
          // Save seed reveal in console for verification
          // eslint-disable-next-line no-console
          console.info('[stacks] verifiable seed reveal:', m.payload.seedReveal);
          break;
        }
        case 'chat_event':
          setChat(c => [...c.slice(-100), { user: m.payload.username, content: m.payload.content, ts: m.payload.serverTs }]);
          break;
      }
    });
    return () => { off(); c.close(); };
  }, [gameWsUrl, sessionToken, fingerprint, tableId]);

  // Compute legal actions from snapshot
  useEffect(() => {
    if (!state) { setLegal(null); return; }
    const me = state.seats.find(s => s.userId === myUserId);
    if (!me || state.toAct !== me.idx || me.status !== 'active') { setLegal(null); return; }
    const toCall = state.currentBet - me.committedThisRound;
    const minRaiseInc = Math.max(state.minRaise, state.bigBlind);
    setLegal({
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0 && me.stack > 0,
      callAmount: Math.min(toCall, me.stack),
      canBet: state.currentBet === 0 && me.stack > 0,
      minBet: state.bigBlind,
      canRaise: state.currentBet > 0 && me.stack > toCall,
      minRaise: Math.min(me.committedThisRound + me.stack, state.currentBet + minRaiseInc),
      maxRaise: me.committedThisRound + me.stack,
      canAllIn: me.stack > 0,
      allInAmount: me.committedThisRound + me.stack,
    });
  }, [state, myUserId]);

  // Helpers
  const send = (msg: { type: 'action'; payload: { tableId: string; handId: string; action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in'; amount?: number; clientNonce: string } }) => {
    void clientRef.current?.send(msg as Parameters<NonNullable<typeof clientRef.current>['send']>[0]);
  };

  const handleAction = (a: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in', amount?: number) => {
    if (!state?.handId) return;
    send({
      type: 'action',
      payload: {
        tableId,
        handId: state.handId,
        action: a,
        amount,
        clientNonce: crypto.randomUUID(),
      },
    });
  };

  const sendChat = (content: string) => {
    void clientRef.current?.send({ type: 'chat', payload: { tableId, content } });
  };

  // Position seats around the felt
  const positions = useMemo(() => seatPositions(state?.seats.length ?? 9), [state?.seats.length]);

  const me = state?.seats.find(s => s.userId === myUserId);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Felt */}
      <div className="pointer-events-none absolute inset-0 -z-10" />
      <div className="relative mx-auto mt-6 aspect-[16/9] w-[95vw] max-w-6xl">
        <div className="absolute inset-0 rounded-[50%] bg-gradient-to-b from-felt-700 to-felt-900 shadow-2xl ring-2 ring-black/40" />

        {/* Pot + community */}
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3">
          {state && state.pot > 0 && (
            <div className="rounded-full bg-black/70 px-4 py-1 font-mono text-sm font-bold text-gold-400 backdrop-blur">
              POT ${(state.pot / 1e6).toFixed(2)}
            </div>
          )}
          <div className="flex gap-2">
            {(state?.board ?? []).map((c, i) => <Card key={i} index={c} animated />)}
            {Array.from({ length: 5 - (state?.board.length ?? 0) }).map((_, i) =>
              <div key={`ph-${i}`} className="h-20 w-14 rounded-md border-2 border-white/10 sm:h-28 sm:w-20" />
            )}
          </div>
          {state?.handNumber !== undefined && state.handNumber > 0 && (
            <p className="font-mono text-xs text-white/40">hand #{state.handNumber}</p>
          )}
        </div>

        {/* Seats */}
        {(state?.seats ?? []).map((s, i) => (
          <Seat
            key={i}
            seat={s}
            position={positions[i] ?? { top: '50%', left: '50%' }}
            isMe={s.userId === myUserId}
            isToAct={state?.toAct === s.idx}
            holeCards={s.userId === myUserId ? holeCards ?? undefined : showdownReveals.get(s.idx) ?? undefined}
            showCards={!!showdownReveals.get(s.idx)}
            liveKitIdentity={s.userId ?? undefined}
          />
        ))}

        {/* Status overlay if I'm not seated */}
        {!me && state && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-4 py-2 backdrop-blur">
            Click an empty seat to sit down.
          </div>
        )}
      </div>

      <ChatPanel messages={chat} onSend={sendChat} />

      {legal && state && (
        <ActionBar
          legal={legal}
          bigBlind={state.bigBlind}
          pot={state.pot}
          deadlineMs={state.actionDeadline}
          onAction={handleAction}
        />
      )}

      {/* Voice/video controls */}
      <div className="fixed left-4 top-4 flex flex-col gap-2 rounded-md bg-black/60 p-2 backdrop-blur">
        <button
          className={clsx('btn btn-ghost text-xs', !localParticipant.isMicrophoneEnabled && 'bg-red-600/30')}
          onClick={() => localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled)}
        >
          {localParticipant.isMicrophoneEnabled ? '🎙' : '🔇'} Mic
        </button>
        <button
          className={clsx('btn btn-ghost text-xs', !localParticipant.isCameraEnabled && 'bg-red-600/30')}
          onClick={() => localParticipant.setCameraEnabled(!localParticipant.isCameraEnabled)}
        >
          {localParticipant.isCameraEnabled ? '🎥' : '📷‍❌'} Cam
        </button>
      </div>
    </div>
  );
}

function seatPositions(n: number) {
  // Distribute n seats evenly around an ellipse, starting from bottom center.
  const out: Array<{ top: string; left: string; transform: string }> = [];
  const cx = 50, cy = 52;
  const a = 50, b = 42;        // ellipse radii in %
  for (let i = 0; i < n; i++) {
    const theta = Math.PI / 2 + (i / n) * Math.PI * 2;
    const x = cx - a * Math.cos(theta);
    const y = cy + b * Math.sin(theta);
    out.push({
      top: `${y}%`,
      left: `${x}%`,
      transform: 'translate(-50%, -50%)',
    });
  }
  return out;
}
