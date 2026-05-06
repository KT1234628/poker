'use client';

import { useEffect, useState } from 'react';
import { RegisterPasskeyButton } from '@/components/auth/BiometricLogin';

interface Prefs {
  theme: string;
  card_back: string;
  sound_pack: string;
  master_volume: number;
  enable_chip_sounds: boolean;
  enable_voice: boolean;
  enable_video: boolean;
  default_video_quality: string;
  show_action_animations: boolean;
  show_equity_at_showdown: boolean;
  show_equity_pre_showdown: boolean;
  auto_rebuy: boolean;
  auto_rebuy_threshold_bps: number;
  auto_rebuy_amount_bps: number;
  auto_topup: boolean;
  auto_topup_threshold_bps: number;
  multi_tabling_enabled: boolean;
  max_simultaneous_tables: number;
  fast_fold_warn: boolean;
  big_blind_display: 'chips' | 'bb_count';
}

export default function PreferencesPage() {
  const [p, setP] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch('/api/preferences').then(r => r.json()).then(j => setP(j.preferences));
  }, []);

  async function save<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    if (!p) return;
    const next = { ...p, [key]: value };
    setP(next);
    setSaving(true);
    await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    setSaving(false);
  }

  if (!p) return <main className="mx-auto max-w-2xl px-6 py-10"><p className="text-white/60">Loading…</p></main>;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">Preferences</h1>
      {saving && <p className="mt-1 text-xs text-white/40">Saving…</p>}

      <Section title="Appearance">
        <Select label="Felt theme" value={p.theme} onChange={v => save('theme', v)} options={['felt-classic','felt-dark','felt-blue','felt-noir']} />
        <Select label="Card back" value={p.card_back} onChange={v => save('card_back', v)} options={['red-classic','navy','gold-foil','minimal','retro']} />
        <Toggle label="Action animations" value={p.show_action_animations} onChange={v => save('show_action_animations', v)} />
      </Section>

      <Section title="Sound">
        <Select label="Sound pack" value={p.sound_pack} onChange={v => save('sound_pack', v)} options={['standard','quiet','tournament','retro']} />
        <Slider label="Master volume" min={0} max={100} value={p.master_volume} onChange={v => save('master_volume', v)} />
        <Toggle label="Chip click sounds" value={p.enable_chip_sounds} onChange={v => save('enable_chip_sounds', v)} />
      </Section>

      <Section title="Video & voice">
        <Toggle label="Voice" value={p.enable_voice} onChange={v => save('enable_voice', v)} />
        <Toggle label="Video" value={p.enable_video} onChange={v => save('enable_video', v)} />
        <Select label="Video quality" value={p.default_video_quality} onChange={v => save('default_video_quality', v)} options={['auto','low','medium','high']} />
      </Section>

      <Section title="Auto rebuy / top-up">
        <Toggle label="Auto rebuy when busted" value={p.auto_rebuy} onChange={v => save('auto_rebuy', v)} />
        <Slider label="Rebuy at % of max" min={10} max={100} step={10} value={p.auto_rebuy_threshold_bps / 100} onChange={v => save('auto_rebuy_threshold_bps', v * 100)} />
        <Toggle label="Auto top-up between hands" value={p.auto_topup} onChange={v => save('auto_topup', v)} />
        <Slider label="Top-up threshold" min={10} max={100} step={10} value={p.auto_topup_threshold_bps / 100} onChange={v => save('auto_topup_threshold_bps', v * 100)} />
      </Section>

      <Section title="Multi-tabling">
        <Toggle label="Enable multi-tabling" value={p.multi_tabling_enabled} onChange={v => save('multi_tabling_enabled', v)} />
        <Slider label="Max simultaneous tables" min={1} max={24} value={p.max_simultaneous_tables} onChange={v => save('max_simultaneous_tables', v)} />
      </Section>

      <Section title="Display">
        <Select label="Show stack as" value={p.big_blind_display} onChange={v => save('big_blind_display', v as 'chips' | 'bb_count')} options={['chips','bb_count']} />
        <Toggle label="Show equity at showdown" value={p.show_equity_at_showdown} onChange={v => save('show_equity_at_showdown', v)} />
        <Toggle label="Show equity in-hand (advanced)" value={p.show_equity_pre_showdown} onChange={v => save('show_equity_pre_showdown', v)} />
      </Section>

      <Section title="Security — passkeys (Face ID / Touch ID)">
        <RegisterPasskeyButton />
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs uppercase text-white/50">{title}</h2>
      <div className="space-y-3 rounded-md border border-white/10 bg-black/30 p-4">{children}</div>
    </section>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} className="h-5 w-5 accent-gold-500" />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="rounded bg-white/5 p-2 ring-1 ring-white/10">
        {options.map(o => <option key={o} value={o}>{o.replace(/[-_]/g, ' ')}</option>)}
      </select>
    </label>
  );
}

function Slider({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between"><span>{label}</span><span className="font-mono text-sm text-gold-400">{value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="mt-1 w-full accent-gold-500" />
    </label>
  );
}
