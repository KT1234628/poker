import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { Toaster, ToasterBridge } from '@/components/Toaster';
import { PreferencesProvider } from '@/lib/preferences-context';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Stacks Poker — Provably fair on-chain Texas Hold\'em',
  description:
    'Play Texas Hold\'em with USDC custody secured on Solana. Voice and video at every table. Cash games and tournaments.',
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-felt-900 min-h-screen font-sans text-white antialiased selection:bg-gold-500 selection:text-black">
        <Providers>
          <PreferencesProvider>
            <Toaster>
              <ToasterBridge />
              <AppShell>{children}</AppShell>
            </Toaster>
          </PreferencesProvider>
        </Providers>
      </body>
    </html>
  );
}
