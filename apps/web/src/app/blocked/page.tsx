export default async function BlockedPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const { country } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 text-center">
      <h1 className="font-display text-4xl font-bold">Service unavailable in your region</h1>
      <p className="text-white/70">
        Stacks Poker isn&apos;t licensed to operate in {country ?? 'your country'} at this time.
        We restrict access by IP geolocation in compliance with local laws.
      </p>
      <p className="text-sm text-white/50">If you believe this is incorrect, contact <a href="mailto:support@stacks.poker" className="underline">support@stacks.poker</a>.</p>
    </main>
  );
}
