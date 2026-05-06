'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DEFAULT_FILTERS, LobbyFilters, type LobbyFilterState } from './LobbyFilters';

interface TableRow {
  id: string;
  name: string;
  kind: 'cash' | 'sng' | 'mtt';
  max_seats: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  straddle_kind: string;
  allow_run_it_twice: boolean;
  bomb_pot_every_n_hands: number;
  seated: number;
  favorited: boolean;
}

export function LobbyView() {
  const [filters, setFilters] = useState<LobbyFilterState>(DEFAULT_FILTERS);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => params.set(k, String(v)));
    fetch(`/api/lobby/tables?${params.toString()}`)
      .then(r => r.json())
      .then(j => setRows(j.tables ?? []))
      .finally(() => setLoading(false));
  }, [filters]);

  async function toggleFavorite(t: TableRow) {
    if (t.favorited) {
      await fetch(`/api/lobby/tables?tableId=${t.id}`, { method: 'DELETE' });
    } else {
      await fetch('/api/lobby/tables', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: t.id }),
      });
    }
    setRows(rows.map(r => (r.id === t.id ? { ...r, favorited: !r.favorited } : r)));
  }

  return (
    <div className="space-y-4">
      <LobbyFilters value={filters} onChange={setFilters} />

      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/40 text-white/60">
            <tr>
              <th className="p-3"></th>
              <th className="p-3">Table</th>
              <th className="p-3">Stakes</th>
              <th className="p-3">Features</th>
              <th className="p-3">Seats</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="p-6 text-center text-white/50">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-white/50">No matches.</td></tr>
            )}
            {rows.map(t => (
              <tr key={t.id} className="border-t border-white/5 hover:bg-white/5">
                <td className="p-3">
                  <button onClick={() => toggleFavorite(t)} className="text-2xl" aria-label="Favorite">
                    {t.favorited ? '★' : '☆'}
                  </button>
                </td>
                <td className="p-3 font-medium">{t.name}</td>
                <td className="p-3 font-mono">${(Number(t.small_blind)/1e6).toFixed(2)}/${(Number(t.big_blind)/1e6).toFixed(2)}</td>
                <td className="p-3 text-xs text-white/60">
                  {t.allow_run_it_twice && <span className="mr-1 rounded bg-gold-500/20 px-1">RIT</span>}
                  {t.bomb_pot_every_n_hands > 0 && <span className="mr-1 rounded bg-fuchsia-500/20 px-1">Bomb {t.bomb_pot_every_n_hands}</span>}
                  {t.straddle_kind !== 'none' && <span className="mr-1 rounded bg-blue-500/20 px-1">Straddle</span>}
                </td>
                <td className="p-3 font-mono">{t.seated}/{t.max_seats}</td>
                <td className="flex items-center gap-2 p-3 text-right">
                  <Link href={`/table/${t.id}?observe=1`} className="btn btn-ghost text-xs">Observe</Link>
                  <Link href={`/table/${t.id}`} className="btn btn-primary text-xs">Join</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
