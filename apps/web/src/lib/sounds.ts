// Sound + haptic system. Lazy-loads .wav/.mp3 from /public/sounds/{pack}/{name}.
// We don't ship real sound files in the scaffold — the system is wired so when
// you drop files into /public/sounds/standard/deal.mp3 etc., they just work.

type SoundName =
  | 'deal_card' | 'deal_flop' | 'deal_turn_river'
  | 'check' | 'bet' | 'call' | 'raise' | 'fold' | 'all_in'
  | 'pot_won' | 'big_pot' | 'showdown'
  | 'turn_alert' | 'turn_warning' | 'time_bank_low'
  | 'mission_complete' | 'rakeback_paid' | 'tier_up'
  | 'bbj_celebrate' | 'bounty' | 'mystery_bounty'
  | 'message_received' | 'friend_online'
  | 'sit_down' | 'stand_up'
  | 'rit_offered' | 'bomb_pot';

const cache = new Map<string, HTMLAudioElement>();

interface SoundOpts {
  pack: 'standard' | 'quiet' | 'tournament' | 'retro';
  volume: number;        // 0..100
  enabled: boolean;
}

let active: SoundOpts = { pack: 'standard', volume: 80, enabled: true };

export function configureSounds(opts: Partial<SoundOpts>) {
  active = { ...active, ...opts };
}

function preload(name: SoundName): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  const key = `${active.pack}/${name}`;
  let a = cache.get(key);
  if (!a) {
    a = new Audio(`/sounds/${active.pack}/${name}.mp3`);
    a.preload = 'auto';
    a.volume = active.volume / 100;
    cache.set(key, a);
  }
  return a;
}

export function playSound(name: SoundName, opts?: { vibrateMs?: number; volumeMul?: number }) {
  if (!active.enabled || active.volume === 0) {
    if (opts?.vibrateMs) vibrate(opts.vibrateMs);
    return;
  }
  const a = preload(name);
  if (!a) return;
  try {
    a.volume = Math.min(1, (active.volume / 100) * (opts?.volumeMul ?? 1));
    a.currentTime = 0;
    void a.play().catch(() => {});
  } catch {}
  if (opts?.vibrateMs) vibrate(opts.vibrateMs);
}

export function vibrate(ms: number) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(ms); } catch {}
  }
}

// Pre-warm a few common sounds on first user gesture (browsers require this for autoplay)
let warmed = false;
export function warmSoundsOnUserGesture() {
  if (warmed || typeof window === 'undefined') return;
  warmed = true;
  ['deal_card','check','bet','call','fold','turn_alert'].forEach(n => preload(n as SoundName));
}
