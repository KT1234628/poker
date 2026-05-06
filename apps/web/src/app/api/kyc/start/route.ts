import { NextResponse } from 'next/server';
import { enforce } from '@/lib/rate-limit';
import { supabaseServer } from '@/lib/supabase/server';

// Start a Persona inquiry. The user is redirected to Persona's hosted flow,
// and we receive a webhook callback at /api/kyc/webhook when complete.
export async function POST() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const rl = await enforce('kyc_start', user.id, { tokens: 5, window: '1 h' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const apiKey = process.env.PERSONA_API_KEY;
  const templateId = process.env.PERSONA_TEMPLATE_ID;
  if (!apiKey || !templateId) {
    return NextResponse.json({ error: 'kyc_not_configured' }, { status: 503 });
  }

  const r = await fetch('https://api.withpersona.com/api/v1/inquiries', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Persona-Version': '2023-01-05',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          inquiryTemplateId: templateId,
          referenceId: user.id,
        },
      },
    }),
  });
  if (!r.ok) return NextResponse.json({ error: 'persona_error', status: r.status }, { status: 502 });
  const j = await r.json();

  await sb.from('profiles').update({
    kyc_status: 'pending',
    kyc_inquiry_id: j.data?.id ?? null,
  }).eq('id', user.id);

  return NextResponse.json({
    inquiryId: j.data?.id,
    sessionToken: j.data?.attributes?.sessionToken,
  });
}
