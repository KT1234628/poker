'use client';

import { useState } from 'react';

export interface LobbyFilterState {
  stakes: 'any' | 'micro' | 'low' | 'mid' | 'high';
  minSeats: number;
  maxSeats: number;
  onlyHasPlayers: boolean;
  favoritesOnly: boolean;
  sortBy: 'stakes' | 'seated' | 'name';
  sortDir: 'asc' | 'desc';
}

export const DEFAULT_FILTERS: LobbyFilterState = {
  stakes: 'any',
  minSeats: 2,
  maxSeats: 10,
  onlyHasPlayers: false,
  favoritesOnly: false,
  sortBy: 'stakes',
  sortDir: 'asc',
};

export function LobbyFilters({ value, onChange }: { value: LobbyFilterState; onChange: (f: LobbyFilterState) => void }) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof LobbyFilterState>(k: K, v: LobbyFilterState[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="rounded-lg border border-white/10 bg-black/40 p-3">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between text-sm font-semibold uppercase text-white/70">
        Filters
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <Field label="Stakes">
            <select value={value.stakes} onChange={e => set('stakes', e.target.value as LobbyFilterState['stakes'])} className="w-full rounded bg-white/5 p-2 ring-1 ring-white/10">
              <option value="any">Any</option>
              <option value="micro">Micro (≤$0.10/$0.20)</option>
              <option value="low">Low ($0.20–$2)</option>
              <option value="mid">Mid ($2–$10)</option>
              <option value="high">High ($10+)</option>
            </select>
          </Field>
          <Field label="Min seats">
            <input type="number" min={2} max={10} value={value.minSeats} onChange={e => set('minSeats', parseInt(e.target.value))} className="w-full rounded bg-white/5 p-2 ring-1 ring-white/10" />
          </Field>
          <Field label="Max seats">
            <input type="number" min={2} max={10} value={value.maxSeats} onChange={e => set('maxSeats', parseInt(e.target.value))} className="w-full rounded bg-white/5 p-2 ring-1 ring-white/10" />
          </Field>
          <Field label="Sort by">
            <select value={value.sortBy} onChange={e => set('sortBy', e.target.value as LobbyFilterState['sortBy'])} className="w-full rounded bg-white/5 p-2 ring-1 ring-white/10">
              <option value="stakes">Stakes</option>
              <option value="seated">Seated</option>
              <option value="name">Name</option>
            </select>
          </Field>

          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={value.onlyHasPlayers} onChange={e => set('onlyHasPlayers', e.target.checked)} />
            Only tables with players
          </label>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={value.favoritesOnly} onChange={e => set('favoritesOnly', e.target.checked)} />
            Favorites only
          </label>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[11px] uppercase text-white/50">{label}</span>{children}</label>;
}
