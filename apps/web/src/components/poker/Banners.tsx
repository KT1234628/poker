'use client';

interface Props {
  sitOutWarning?: { consecutive: number; max: number } | null;
  disconnectProtection?: { secondsRemaining: number } | null;
  reEntryAvailable?: { tournamentId: string; level: number } | null;
}

export function Banners({ sitOutWarning, disconnectProtection, reEntryAvailable }: Props) {
  return (
    <div className="absolute inset-x-0 top-12 z-30 space-y-1">
      {sitOutWarning && (
        <Banner color="orange">
          You've sat out {sitOutWarning.consecutive}/{sitOutWarning.max} hands.
          You'll be removed if you keep sitting out.
        </Banner>
      )}
      {disconnectProtection && (
        <Banner color="amber">
          ⚠ Disconnect protection active — {disconnectProtection.secondsRemaining}s before auto-fold resumes.
        </Banner>
      )}
      {reEntryAvailable && (
        <Banner color="blue">
          🔁 You busted at level {reEntryAvailable.level}. Re-entry is open — <a href={`/tournaments/${reEntryAvailable.tournamentId}`} className="font-bold underline">register again</a>.
        </Banner>
      )}
    </div>
  );
}

const COLOR: Record<string, string> = {
  orange: 'border-orange-500/50 bg-orange-950/80 text-orange-100',
  amber: 'border-amber-500/50 bg-amber-950/80 text-amber-100',
  blue: 'border-blue-500/50 bg-blue-950/80 text-blue-100',
};

function Banner({ color, children }: { color: keyof typeof COLOR; children: React.ReactNode }) {
  return <div className={`mx-2 rounded border px-3 py-1.5 text-xs font-semibold backdrop-blur ${COLOR[color]}`}>{children}</div>;
}
