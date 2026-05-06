'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ChatPanel } from './ChatPanel';

interface Props {
  panel: 'chat' | 'notes' | 'replay' | 'tournament' | null;
  onClose: () => void;
  chatMessages: Array<{ user: string; content: string; ts: number }>;
  onSendChat: (s: string) => void;
  notesTargetUserId?: string | null;
  onOpenNotes?: (userId: string) => void;
  tournamentId?: string | null;
  recentActions: Array<{ phase: string; seatIdx: number; action: string; amount: number; ts: number }>;
  myEquity?: { equity: number; opponents: number } | null;
}

export function SidePanel(props: Props) {
  const { panel, onClose } = props;
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(panel !== null); }, [panel]);

  return (
    <div
      className={clsx(
        'fixed right-0 top-12 z-30 h-[calc(100vh-7rem)] w-80 overflow-hidden rounded-l-lg border-l border-white/10 bg-black/85 backdrop-blur transition-transform',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <h3 className="text-xs uppercase tracking-widest text-white/60">{panel}</h3>
        <button onClick={onClose} className="text-white/50 hover:text-white">×</button>
      </div>

      {panel === 'chat' && (
        <div className="h-full">
          <ChatPanel messages={props.chatMessages} onSend={props.onSendChat} />
        </div>
      )}

      {panel === 'notes' && (
        <div className="p-3 text-sm">
          {props.notesTargetUserId ? (
            <p className="text-white/70">Tap any seated player to view/edit your notes on them.</p>
          ) : (
            <p className="text-white/50">Long-press a player avatar to take notes.</p>
          )}
        </div>
      )}

      {panel === 'replay' && (
        <div className="space-y-2 overflow-y-auto p-3 text-xs">
          {props.recentActions.length === 0 && <p className="text-white/50">Action log appears here as the hand plays.</p>}
          {props.recentActions.slice().reverse().slice(0, 50).map((a, i) => (
            <div key={i} className="flex items-center justify-between rounded bg-white/5 px-2 py-1 font-mono">
              <span className="text-white/50">{a.phase}</span>
              <span>seat {a.seatIdx} · {a.action}</span>
              {a.amount > 0 && <span className="text-gold-400">${(a.amount/1e6).toFixed(2)}</span>}
            </div>
          ))}
        </div>
      )}

      {panel === 'tournament' && props.tournamentId && (
        <iframe
          src={`/tournaments/${props.tournamentId}?embed=1`}
          className="h-full w-full border-0"
          title="Tournament dashboard"
        />
      )}
    </div>
  );
}
