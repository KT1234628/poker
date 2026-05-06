'use client';

// Multi-tabling grid: tile up to 24 tables, auto-focus on the next-action one.
// Each tile is an iframe of /table/[id]?embed=1; the parent page coordinates focus.
//
// Why iframe? Each table is a stateful WebSocket + LiveKit session. iframes
// isolate each table's React state, garbage-collect cleanly when removed, and
// preserve <video> elements without remount thrash.

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

interface Tile {
  tableId: string;
  hasAction: boolean;
}

export function MultiTableGrid({
  tableIds,
  onClose,
  maxColumns = 4,
}: {
  tableIds: string[];
  onClose: (tableId: string) => void;
  maxColumns?: number;
}) {
  const [tiles, setTiles] = useState<Tile[]>(() => tableIds.map(t => ({ tableId: t, hasAction: false })));
  const [focused, setFocused] = useState<string | null>(tableIds[0] ?? null);
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});

  useEffect(() => {
    setTiles(tableIds.map(t => ({ tableId: t, hasAction: false })));
  }, [tableIds.join(',')]);

  // Listen for postMessage from each iframe announcing "your turn"
  useEffect(() => {
    function handler(ev: MessageEvent<{ kind: string; tableId: string; isMyTurn?: boolean }>) {
      // Reject any cross-origin frame trying to post to us
      if (ev.origin !== window.location.origin) return;
      if (!ev.data || typeof ev.data !== 'object') return;
      const { kind, tableId, isMyTurn } = ev.data;
      if (kind === 'turn' && tableId) {
        setTiles(t => t.map(x => (x.tableId === tableId ? { ...x, hasAction: !!isMyTurn } : x)));
        if (isMyTurn && focused !== tableId) {
          // Auto-focus only when the user isn't actively typing somewhere
          const ae = document.activeElement;
          const userTyping = ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || (ae as HTMLElement | null)?.isContentEditable;
          if (!userTyping) {
            setFocused(tableId);
            iframeRefs.current[tableId]?.focus();
          }
        }
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [focused]);

  const cols = Math.min(maxColumns, Math.max(1, Math.ceil(Math.sqrt(tableIds.length))));
  const gridStyle = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };

  return (
    <div className="relative h-screen w-screen bg-felt-900">
      <div className="grid h-full gap-1 p-1" style={gridStyle}>
        {tiles.map(tile => (
          <div
            key={tile.tableId}
            className={clsx(
              'relative overflow-hidden rounded-md border-2',
              focused === tile.tableId ? 'border-gold-500' : 'border-white/10',
              tile.hasAction && 'animate-pulseRing'
            )}
            onClick={() => setFocused(tile.tableId)}
          >
            <iframe
              ref={el => { iframeRefs.current[tile.tableId] = el; }}
              src={`/table/${tile.tableId}?embed=1`}
              className="h-full w-full"
              sandbox="allow-same-origin allow-scripts allow-forms"
            />
            {tile.hasAction && (
              <div className="pointer-events-none absolute inset-0 ring-4 ring-gold-500/80 ring-offset-0" />
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onClose(tile.tableId); }}
              className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white/80 hover:bg-black/90"
            >×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
