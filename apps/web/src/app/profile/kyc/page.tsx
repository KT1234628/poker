import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { KycStartButton } from './start-button';

export const dynamic = 'force-dynamic';

export default async function KycPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/auth?next=/profile/kyc');
  const { data: profile } = await sb
    .from('profiles')
    .select('kyc_status, kyc_inquiry_id')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">Verify your identity</h1>
      <p className="mt-2 max-w-xl text-white/70">
        We&apos;re required to verify the identity of every player before allowing real-money play.
        It takes about 2 minutes — government ID + a quick selfie. Your data is processed by Persona,
        not stored by us.
      </p>

      <div className="my-8 rounded-lg border border-white/10 bg-black/30 p-6">
        <p className="text-sm uppercase text-white/50">Status</p>
        <p className="mt-1 font-mono text-2xl font-bold">
          {(() => {
            switch (profile?.kyc_status) {
              case 'approved': return <span className="text-green-400">✓ Approved</span>;
              case 'pending':  return <span className="text-yellow-400">⏳ Under review</span>;
              case 'rejected': return <span className="text-red-400">✗ Rejected — contact support</span>;
              case 'expired':  return <span className="text-orange-400">↻ Expired — re-verify</span>;
              default:         return 'Not started';
            }
          })()}
        </p>
        {profile?.kyc_inquiry_id && (
          <p className="mt-1 font-mono text-xs text-white/40">Inquiry: {profile.kyc_inquiry_id}</p>
        )}
      </div>

      {profile?.kyc_status !== 'approved' && (
        <KycStartButton />
      )}

      <p className="mt-8 text-xs text-white/40">
        Why we ask: regulatory compliance (KYC + AML), age verification, anti-fraud, and to enforce self-exclusion across accounts.
      </p>
    </main>
  );
}
