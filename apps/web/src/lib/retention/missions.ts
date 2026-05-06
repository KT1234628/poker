// Mission progress tracker.
//
// Hooks the game-server (or post-hand) flow: when a hand or tournament event
// happens, call recordEvent() with a normalized payload. This bumps progress
// on any matching active templates the user has assigned, completes them, and
// emits payouts.

import { supabaseAdmin } from '@/lib/supabase/server';

export type MissionEvent =
  | { kind: 'hand_played'; userId: string; userIds?: string[]; potSize: number; phase: string }
  | { kind: 'hand_won'; userId: string; userIds?: string[]; potSize: number; holeCardLabel?: string }
  | { kind: 'tournament_played'; userId: string; tournamentId: string }
  | { kind: 'tournament_cashed'; userId: string; tournamentId: string; place: number }
  | { kind: 'final_table'; userId: string; tournamentId: string }
  | { kind: 'rakeback_chips'; userId: string; rakePaid: number }
  | { kind: 'login'; userId: string };

export async function recordEvent(ev: MissionEvent) {
  const admin = supabaseAdmin();
  const userId = ev.userId;

  // Pull active mission templates
  const { data: templates } = await admin.from('mission_templates')
    .select('*')
    .or('active_until.is.null,active_until.gt.' + new Date().toISOString());
  if (!templates) return;

  for (const t of templates) {
    const delta = matchTemplate(t, ev);
    if (!delta) continue;

    // Ensure assignment exists
    const { data: existing } = await admin.from('mission_progress')
      .select('progress, target_at_assign, completed_at')
      .eq('user_id', userId).eq('template_id', t.id).maybeSingle();
    if (existing?.completed_at) continue;

    if (!existing) {
      // Initial assignment
      const target = (t.target as { count?: number; hands?: number; days?: number; amount?: number; rank?: number }).count
        ?? (t.target as { hands?: number }).hands
        ?? (t.target as { days?: number }).days
        ?? (t.target as { amount?: number }).amount
        ?? 1;
      await admin.from('mission_progress').insert({
        user_id: userId,
        template_id: t.id,
        progress: delta,
        target_at_assign: target,
        completed_at: delta >= target ? new Date().toISOString() : null,
      });
    } else {
      const newProgress = Number(existing.progress) + delta;
      const completed = newProgress >= Number(existing.target_at_assign);
      await admin.from('mission_progress').update({
        progress: newProgress,
        completed_at: completed ? new Date().toISOString() : null,
      }).eq('user_id', userId).eq('template_id', t.id);
    }
  }
}

function matchTemplate(template: { kind: string; target: unknown }, ev: MissionEvent): number {
  const target = template.target as {
    count?: number; hands?: number; days?: number; amount?: number; hand?: string;
  };
  switch (template.kind) {
    case 'play_n_hands':
      if (ev.kind === 'hand_played') return 1;
      return 0;
    case 'win_n_hands':
      if (ev.kind === 'hand_won') return 1;
      return 0;
    case 'win_with_specific_hand':
      if (ev.kind === 'hand_won' && ev.holeCardLabel === target.hand) return 1;
      return 0;
    case 'play_n_tournaments':
      if (ev.kind === 'tournament_played') return 1;
      return 0;
    case 'final_table':
      if (ev.kind === 'final_table') return 1;
      return 0;
    case 'cash_in_tournament':
      if (ev.kind === 'tournament_cashed') return 1;
      return 0;
    case 'rakeback_n_chips':
      if (ev.kind === 'rakeback_chips') return ev.rakePaid;
      return 0;
    case 'streak_n_days':
      if (ev.kind === 'login') return 1;
      return 0;
    default:
      return 0;
  }
}

/** Claim a completed mission's reward. Idempotent. */
export async function claimMissionReward(userId: string, templateId: string): Promise<{ ok: boolean; reward?: number; reason?: string }> {
  const admin = supabaseAdmin();
  // Atomic claim: SQL function flips claimed_at IFF completed_at set & not yet
  // claimed, and only then credits chips. TOCTOU-safe.
  const { data, error } = await admin.rpc('mission_claim_atomic', {
    p_user_id: userId,
    p_template_id: templateId,
  });
  if (error) return { ok: false, reason: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) return { ok: false, reason: row?.reason ?? 'unknown' };
  return { ok: true, reward: Number(row.reward ?? 0) };
}
