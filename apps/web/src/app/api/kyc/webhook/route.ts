import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/server';

// Persona webhook handler.
// Persona signs requests with HMAC-SHA256 over the raw body.
//   v1=<hex>     in the `Persona-Signature` header
export async function POST(req: NextRequest) {
  const secret = process.env.PERSONA_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const signatureHeader = req.headers.get('persona-signature') ?? '';
  const raw = await req.text();
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (!signatureHeader.includes(expected)) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }

  const body = JSON.parse(raw);
  const event = body.data?.attributes?.payload?.data;
  if (!event) return NextResponse.json({ ok: true });

  const inquiryId = event.id ?? body.data?.attributes?.payload?.data?.id;
  const status = event.attributes?.status;
  const referenceId = event.attributes?.['reference-id'];

  if (!referenceId || !inquiryId) return NextResponse.json({ ok: true });

  const map: Record<string, 'approved' | 'rejected' | 'pending'> = {
    completed: 'approved',
    approved: 'approved',
    declined: 'rejected',
    failed: 'rejected',
    pending: 'pending',
    expired: 'pending',
  };
  const next = map[status] ?? 'pending';

  await supabaseAdmin().from('profiles').update({
    kyc_status: next,
    kyc_inquiry_id: inquiryId,
  }).eq('id', referenceId);

  return NextResponse.json({ ok: true });
}
