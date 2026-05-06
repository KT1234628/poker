'use client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="font-display text-2xl font-bold text-red-400">Something went wrong</h2>
      <p className="text-sm text-white/60">{error.message || 'Unknown error.'}</p>
      <button onClick={reset} className="btn btn-primary mt-4">Try again</button>
    </main>
  );
}
