'use client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en"><body className="bg-felt-900 text-white">
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="font-display text-3xl font-bold text-red-400">Fatal error</h2>
        <p className="text-sm text-white/60">{error.message || 'Unknown error.'}</p>
        <button onClick={reset} className="rounded-md bg-yellow-500 px-4 py-2 font-bold text-black">Retry</button>
      </main>
    </body></html>
  );
}
