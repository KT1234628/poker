'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { useLocalParticipant } from '@livekit/components-react';

interface Props {
  tableName: string;
  stakes: { sb: number; bb: number };
  features: { rit: boolean; bombPot: number; straddle: string };
  onSettings: () => void;
  onLeave: () => void;
  onTogglePanel: (panel: 'chat' | 'notes' | 'replay' | 'tournament') => void;
  activePanel: 'chat' | 'notes' | 'replay' | 'tournament' | null;
  inTournament: boolean;
}

export function TableTopBar({ tableName, stakes, features, onSettings, onLeave, onTogglePanel, activePanel, inTournament }: Props) {
  const { localParticipant } = useLocalParticipant();
  return (
    <header className="absolute inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-white/10 bg-black/60 px-3 py-2 backdrop-blur">
      <Link href="/lobby" onClick={onLeave} className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20">← Lobby</Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{tableName}</p>
        <p className="truncate font-mono text-[10px] text-white/60">
          ${(stakes.sb/1e6).toFixed(2)}/${(stakes.bb/1e6).toFixed(2)}
          {features.rit && <span className="ml-2 rounded bg-gold-500/20 px-1 text-gold-300">RIT</span>}
          {features.bombPot > 0 && <span className="ml-1 rounded bg-fuchsia-500/20 px-1 text-fuchsia-300">Bomb {features.bombPot}</span>}
          {features.straddle !== 'none' && <span className="ml-1 rounded bg-blue-500/20 px-1 text-blue-300">Straddle</span>}
        </p>
      </div>

      <PanelToggle label="💬" name="chat" active={activePanel === 'chat'} onClick={() => onTogglePanel('chat')} />
      <PanelToggle label="✎" name="notes" active={activePanel === 'notes'} onClick={() => onTogglePanel('notes')} />
      <PanelToggle label="↺" name="replay" active={activePanel === 'replay'} onClick={() => onTogglePanel('replay')} />
      {inTournament && <PanelToggle label="🏆" name="tournament" active={activePanel === 'tournament'} onClick={() => onTogglePanel('tournament')} />}

      <button
        onClick={() => localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled)}
        className={clsx('rounded-md px-2 py-1 text-xs', localParticipant.isMicrophoneEnabled ? 'bg-white/10 hover:bg-white/20' : 'bg-red-700/50')}
      >
        {localParticipant.isMicrophoneEnabled ? '🎙' : '🔇'}
      </button>
      <button
        onClick={() => localParticipant.setCameraEnabled(!localParticipant.isCameraEnabled)}
        className={clsx('rounded-md px-2 py-1 text-xs', localParticipant.isCameraEnabled ? 'bg-white/10 hover:bg-white/20' : 'bg-red-700/50')}
      >
        {localParticipant.isCameraEnabled ? '🎥' : '📷‍❌'}
      </button>
      <button onClick={onSettings} className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20">⚙</button>
    </header>
  );
}

function PanelToggle({ label, name, active, onClick }: { label: string; name: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx('rounded-md px-2 py-1 text-xs', active ? 'bg-gold-500 text-black' : 'bg-white/10 hover:bg-white/20')}
      aria-label={name}
      title={name}
    >
      {label}
    </button>
  );
}
