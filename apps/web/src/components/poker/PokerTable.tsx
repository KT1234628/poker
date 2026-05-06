'use client';

import { uuid } from '@/lib/uuid';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import type { ServerMessage, TableStateSnapshot } from '@stacks/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionBar, type LegalActions } from './ActionBar';
import { Banners } from './Banners';
import { Card } from './Card';
import { EquityDisplay } from './EquityDisplay';
import { MobileActionBar } from './MobileActionBar';
import { MultiBoard } from './MultiBoard';
import { PlayerNotesPanel } from './PlayerNotesPanel';
import { RunItTwicePrompt } from './RunItTwicePrompt';
import { Seat } from './Seat';
import { ShowdownChoiceModal } from './ShowdownChoiceModal';
import { SidePanel } from './SidePanel';
import { TableTopBar } from './TableTopBar';
import { toast } from '@/components/Toaster';
import { usePreferences } from '@/lib/preferences-context';
import { configureSounds, playSound, warmSoundsOnUserGesture } from '@/lib/sounds';
import { connectGameServer, type GameClient } from '@/lib/ws-client';

interface Props {
  tableId: string;
  gameWsUrl: string;
  livekitUrl: string;
  livekitToken: string;
  sessionToken: string;
  myUserId: string;
  fingerprint: string;
  observerOnly?: boolean;
  tournamentId?: string | null;
  features?: { rit: boolean; bombPot: number; straddle: string };
  embedded?: boolean;             // true when rendered in multi-table iframe
  tableName?: string;
  stakes?: { sb: number; bb: number };
}

export function PokerTable(props: Props) {
  const { prefs } = usePreferences();
  const livekitEnabled = !!props.livekitToken && prefs.enable_voice;

  const inner = (
    <TableInner {...props} />
  );
  if (!livekitEnabled) return inner;
  return (
    <LiveKitRoom
      serverUrl={props.livekitUrl}
      token={props.livekitToken}
      audio={prefs.enable_voice}
      video={prefs.enable_video}
      connectOptions={{ autoSubscribe: true }}
      options={{
        adaptiveStream: true,
        dynacast: true,
        // simulcast layer presets are configured via LiveKit's built-in defaults
        disconnectOnPageLeave: false,
      }}
    >
      <RoomAudioRenderer />
      {inner}
    </LiveKitRoom>
  );
}

function TableInner(props: Props) {
  const { tableId, gameWsUrl, sessionToken, myUserId, fingerprint, observerOnly, tournamentId, features, embedded, tableName, stakes } = props;
  const { prefs, isMobile } = usePreferences();
  const clientRef = useRef<GameClient | null>(null);
  const [state, setState] = useState<TableStateSnapshot | null>(null);
  const [legal, setLegal] = useState<LegalActions | null>(null);
  const [holeCards, setHoleCards] = useState<[number, number] | null>(null);
  const [chat, setChat] = useState<Array<{ user: string; content: string; ts: number }>>([]);
  const [recentActions, setRecentActions] = useState<Array<{ phase: string; seatIdx: number; action: string; amount: number; ts: number }>>([]);
  const [showdownReveals, setShowdownReveals] = useState<Map<number, [number, number]>>(new Map());
  const [multiBoardData, setMultiBoardData] = useState<{ boards: number[][]; payouts: { seatIdx: number; userId: string | null; amount: number; rank: number; description: string }[][] } | null>(null);
  const [activePanel, setActivePanel] = useState<'chat' | 'notes' | 'replay' | 'tournament' | null>(null);
  const [notesTarget, setNotesTarget] = useState<{ userId: string; username: string } | null>(null);
  const [ritOffer, setRitOffer] = useState<{ decisionSeats: number[]; maxRunCount: 1 | 2 | 3; deadline: number } | null>(null);
  const [showChoice, setShowChoice] = useState<{ deadline: number } | null>(null);
  const [sitOutWarning, setSitOutWarning] = useState<{ consecutive: number; max: number } | null>(null);
  const [disconnectInfo, setDisconnectInfo] = useState<{ secondsRemaining: number } | null>(null);
  const [preAction, setPreAction] = useState<'fold_to_any' | 'check_fold' | 'call_any' | null>(null);

  // Configure sound system from prefs
  useEffect(() => {
    configureSounds({ pack: prefs.sound_pack, volume: prefs.master_volume, enabled: prefs.enable_chip_sounds });
  }, [prefs.sound_pack, prefs.master_volume, prefs.enable_chip_sounds]);

  // Connect to game server
  useEffect(() => {
    const c = connectGameServer({
      url: gameWsUrl,
      sessionToken,
      deviceFingerprint: fingerprint,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'srv',
    });
    clientRef.current = c;

    let prevHandId: string | null = null;
    const off = c.on((m: ServerMessage) => {
      switch (m.type) {
        case 'state':
          // On hand rollover, clear stale reveals and per-hand UI state
          if (m.payload.handId && m.payload.handId !== prevHandId) {
            prevHandId = m.payload.handId;
            setShowdownReveals(new Map());
            setMultiBoardData(null);
            setHoleCards(null);
            setRitOffer(null);
          }
          setState(m.payload);
          // Notify parent in multi-tabling about my-turn (use targeted origin)
          if (embedded && window.parent !== window) {
            const me = m.payload.seats.find(s => s.userId === myUserId);
            try {
              window.parent.postMessage(
                { kind: 'turn', tableId: m.payload.tableId, isMyTurn: me ? m.payload.toAct === me.idx : false },
                window.location.origin
              );
            } catch {}
          }
          break;
        case 'hole_cards':
          if (m.payload.tableId === tableId) {
            setHoleCards(m.payload.cards);
            playSound('deal_card');
          }
          break;
        case 'phase_event':
          if (m.payload.phase === 'flop') playSound('deal_flop');
          else playSound('deal_turn_river');
          break;
        case 'action_event': {
          // Cap to last 100 to bound memory in long sessions
          setRecentActions(prev => {
            const next = [...prev, { phase: 'preflop', seatIdx: m.payload.seatIdx, action: m.payload.action, amount: m.payload.amount, ts: m.payload.serverTs }];
            return next.length > 100 ? next.slice(-100) : next;
          });
          switch (m.payload.action) {
            case 'fold': playSound('fold'); break;
            case 'check': playSound('check'); break;
            case 'call': playSound('call'); break;
            case 'bet': playSound('bet'); break;
            case 'raise': playSound('raise'); break;
            case 'all_in': playSound('all_in', { vibrateMs: 50 }); break;
          }
          break;
        }
        case 'showdown': {
          const map = new Map<number, [number, number]>();
          for (const r of m.payload.reveals) map.set(r.seatIdx, r.cards);
          setShowdownReveals(map);
          playSound('showdown');
          // eslint-disable-next-line no-console
          console.info('[stacks] verifiable seed reveal:', m.payload.seedReveal);
          break;
        }
        case 'showdown_multi': {
          const map = new Map<number, [number, number]>();
          for (const r of m.payload.reveals) map.set(r.seatIdx, r.cards);
          setShowdownReveals(map);
          setMultiBoardData({ boards: m.payload.boards, payouts: m.payload.boardPayouts });
          playSound('big_pot', { vibrateMs: 80 });
          break;
        }
        case 'rit_offer':
          setRitOffer({ decisionSeats: m.payload.decisionSeats, maxRunCount: m.payload.maxRunCount, deadline: m.payload.deadline });
          playSound('rit_offered');
          break;
        case 'rit_decided':
          setRitOffer(null);
          break;
        case 'bomb_pot':
          toast({ kind: 'celebrate', emoji: '💥', title: 'Bomb pot!', body: `Everyone antes $${(m.payload.ante / 1e6).toFixed(2)}` });
          playSound('bomb_pot', { vibrateMs: 60 });
          break;
        case 'bounty_collected':
          toast({
            kind: 'success',
            emoji: m.payload.isMystery ? '🎁' : '🎯',
            title: `+$${(m.payload.bountyAmount / 1e6).toFixed(2)} bounty`,
            body: m.payload.isMystery ? `Mystery bucket: ${m.payload.mysteryBucket ?? 'unknown'}` : 'Knockout!',
          });
          playSound(m.payload.isMystery ? 'mystery_bounty' : 'bounty');
          break;
        case 'sit_out_warning':
          setSitOutWarning({ consecutive: m.payload.consecutive, max: m.payload.max });
          break;
        case 'disconnect_protection':
          setDisconnectInfo({ secondsRemaining: m.payload.secondsRemaining });
          setTimeout(() => setDisconnectInfo(null), m.payload.secondsRemaining * 1000);
          break;
        case 'chat_event':
          setChat(c => [...c.slice(-100), { user: m.payload.username, content: m.payload.content, ts: m.payload.serverTs }]);
          playSound('message_received', { volumeMul: 0.4 });
          break;
        case 'balance_update':
          if (m.payload.chips > 0) playSound('pot_won');
          break;
      }
    });
    return () => { off(); c.close(); };
  }, [gameWsUrl, sessionToken, fingerprint, tableId, myUserId, embedded]);

  // Compute legal actions
  useEffect(() => {
    if (!state) { setLegal(null); return; }
    const me = state.seats.find(s => s.userId === myUserId);
    if (!me || state.toAct !== me.idx || me.status !== 'active') { setLegal(null); return; }

    // Auto-fire pre-actions if configured
    if (preAction) {
      const toCall = state.currentBet - me.committedThisRound;
      if (preAction === 'fold_to_any') { handleAction('fold'); setPreAction(null); return; }
      if (preAction === 'check_fold') { handleAction(toCall === 0 ? 'check' : 'fold'); setPreAction(null); return; }
      if (preAction === 'call_any') { handleAction(toCall === 0 ? 'check' : 'call'); setPreAction(null); return; }
    }

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
    playSound('turn_alert', { vibrateMs: 30 });
  }, [state, myUserId, preAction]);

  function handleAction(a: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in', amount?: number) {
    if (!state?.handId) return;
    warmSoundsOnUserGesture();
    void clientRef.current?.send({
      type: 'action',
      payload: {
        tableId,
        handId: state.handId,
        action: a,
        amount,
        clientNonce: uuid(),
      },
    });
  }

  function sendChat(content: string) {
    void clientRef.current?.send({ type: 'chat', payload: { tableId, content } });
  }

  function vote(runCount: 1 | 2 | 3) {
    if (!state?.handId) return;
    void clientRef.current?.send({ type: 'rit_vote', payload: { tableId, handId: state.handId, runCount } });
    setRitOffer(null);
  }

  function pickShowChoice(choice: 'show_both' | 'show_one_high' | 'show_one_low' | 'muck') {
    if (!state?.handId) return;
    void clientRef.current?.send({ type: 'show_option', payload: { tableId, handId: state.handId, choice } });
    setShowChoice(null);
  }

  // Position seats around the felt
  const positions = useMemo(() => seatPositions(state?.seats.length ?? 9), [state?.seats.length]);
  const me = state?.seats.find(s => s.userId === myUserId);
  const myActiveSeat = me ?? null;
  const opponents = (state?.seats ?? []).filter(s => s.userId !== myUserId && (s.status === 'active' || s.status === 'all_in'));
  const opponentHoles: Array<[number, number]> = opponents
    .map(s => showdownReveals.get(s.idx))
    .filter((c): c is [number, number] => Array.isArray(c));
  const isAtShowdown = (state?.phase === 'showdown' || state?.phase === 'complete');

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: 'var(--felt-grad)' }}>
      <TableTopBar
        tableName={tableName ?? `Table ${tableId.slice(0, 6)}`}
        stakes={stakes ?? { sb: state?.smallBlind ?? 0, bb: state?.bigBlind ?? 0 }}
        features={features ?? { rit: true, bombPot: 0, straddle: 'none' }}
        onSettings={() => window.open('/profile/preferences', '_blank')}
        onLeave={() => clientRef.current?.send({ type: 'leave_table', payload: { tableId, seatIdx: myActiveSeat?.idx ?? 0 } }).catch(() => {})}
        onTogglePanel={p => setActivePanel(prev => (prev === p ? null : p))}
        activePanel={activePanel}
        inTournament={!!tournamentId}
      />

      <Banners
        sitOutWarning={sitOutWarning}
        disconnectProtection={disconnectInfo}
        reEntryAvailable={null}
      />

      {/* Felt */}
      <div className="relative mx-auto mt-14 aspect-[16/9] w-[95vw] max-w-6xl">
        <div className="absolute inset-0 rounded-[50%] shadow-2xl ring-2 ring-black/40"
             style={{ background: 'radial-gradient(ellipse at center, var(--felt-top), var(--felt-bottom))' }} />

        {/* Center: pot + community OR multi-board */}
        {multiBoardData && multiBoardData.boards.length > 1 ? (
          <MultiBoard boards={multiBoardData.boards} boardPayouts={multiBoardData.payouts} mySeat={myActiveSeat?.idx ?? null} />
        ) : (
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3">
            {state && state.pot > 0 && (
              <div className="rounded-full bg-black/70 px-4 py-1 font-mono text-sm font-bold text-gold-400 backdrop-blur">
                POT ${(state.pot / 1e6).toFixed(2)}
              </div>
            )}
            <div className="flex gap-2">
              {(state?.board ?? []).map((c, i) => <Card key={i} index={c} animated={prefs.show_action_animations} />)}
              {Array.from({ length: 5 - (state?.board.length ?? 0) }).map((_, i) =>
                <div key={`ph-${i}`} className="h-20 w-14 rounded-md border-2 border-white/10 sm:h-28 sm:w-20" />
              )}
            </div>
          </div>
        )}

        {/* Seats */}
        {(state?.seats ?? []).map((s, i) => (
          <div key={i} onContextMenu={e => { e.preventDefault(); if (s.userId && s.userId !== myUserId) setNotesTarget({ userId: s.userId, username: s.userId.slice(0,8) }); }}>
            <Seat
              seat={s}
              position={positions[i] ?? { top: '50%', left: '50%' }}
              isMe={s.userId === myUserId}
              isToAct={state?.toAct === s.idx}
              holeCards={s.userId === myUserId ? holeCards ?? undefined : showdownReveals.get(s.idx) ?? undefined}
              showCards={!!showdownReveals.get(s.idx)}
              liveKitIdentity={s.userId ?? undefined}
            />
          </div>
        ))}
      </div>

      <EquityDisplay
        myHole={holeCards}
        opponentHoles={opponentHoles}
        board={state?.board ?? []}
        enabledPreShowdown={prefs.show_equity_pre_showdown}
        isAtShowdown={isAtShowdown}
        enabledAtShowdown={prefs.show_equity_at_showdown}
      />

      <SidePanel
        panel={activePanel}
        onClose={() => setActivePanel(null)}
        chatMessages={chat}
        onSendChat={sendChat}
        notesTargetUserId={notesTarget?.userId}
        tournamentId={tournamentId}
        recentActions={recentActions}
      />

      {ritOffer && (
        <RunItTwicePrompt
          visible={true}
          decisionSeats={ritOffer.decisionSeats}
          mySeat={myActiveSeat?.idx ?? null}
          maxRunCount={ritOffer.maxRunCount}
          deadline={ritOffer.deadline}
          onVote={vote}
        />
      )}

      {showChoice && (
        <ShowdownChoiceModal open onChoice={pickShowChoice} deadlineMs={showChoice.deadline} />
      )}

      {notesTarget && (
        <PlayerNotesPanel
          targetUserId={notesTarget.userId}
          targetUsername={notesTarget.username}
          onClose={() => setNotesTarget(null)}
        />
      )}

      {legal && state && !observerOnly && (
        isMobile
          ? <MobileActionBar
              legal={legal}
              bigBlind={state.bigBlind}
              pot={state.pot}
              deadlineMs={state.actionDeadline}
              onAction={handleAction}
              onPreAction={(a) => setPreAction(a === 'cancel' ? null : a)}
              preAction={preAction}
              isMyTurn={state.toAct === myActiveSeat?.idx}
            />
          : <ActionBar
              legal={legal}
              bigBlind={state.bigBlind}
              pot={state.pot}
              deadlineMs={state.actionDeadline}
              onAction={handleAction}
            />
      )}

      {/* Pre-action shown to mobile users when not their turn */}
      {!legal && state && !observerOnly && me && state.toAct !== me.idx && isMobile && (
        <MobileActionBar
          legal={null}
          bigBlind={state.bigBlind}
          pot={state.pot}
          deadlineMs={null}
          onAction={handleAction}
          onPreAction={(a) => setPreAction(a === 'cancel' ? null : a)}
          preAction={preAction}
          isMyTurn={false}
        />
      )}
    </div>
  );
}

function seatPositions(n: number) {
  const out: Array<{ top: string; left: string; transform: string }> = [];
  const cx = 50, cy = 52;
  const a = 50, b = 42;
  for (let i = 0; i < n; i++) {
    const theta = Math.PI / 2 + (i / n) * Math.PI * 2;
    const x = cx - a * Math.cos(theta);
    const y = cy + b * Math.sin(theta);
    out.push({ top: `${y}%`, left: `${x}%`, transform: 'translate(-50%, -50%)' });
  }
  return out;
}
