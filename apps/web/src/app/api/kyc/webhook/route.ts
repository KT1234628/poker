import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/server';

// Persona webhook handler.
// Persona signs requests with `t=<unix>,v1=<hex>` in `Persona-Signature`.
// We parse that, enforce ±5 min replay window, and use timingSafeEqual.

const REPLAY_WINDOW_MS = 5 * 60_000;

export async function POST(req: NextRequest) {
  const secret = process.env.PERSONA_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const signatureHeader = req.headers.get('persona-signature') ?? '';
  const raw = await req.text();

  const parsed = parsePersonaSig(signatureHeader);
  if (!parsed) return NextResponse.json({ error: 'bad_signature' }, { status: 401 });

  const driftMs = Math.abs(Date.now() - parsed.t * 1000);
  if (driftMs > REPLAY_WINDOW_MS) {
    return NextResponse.json({ error: 'expired' }, { status: 401 });
  }

  // Persona's signed payload is `${t}.${rawBody}`.
  const expectedHex = crypto.createHmac('sha256', secret).update(`${parsed.t}.${raw}`).digest('hex');
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(parsed.v1, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }

  const body = JSON.parse(raw);
  const event = body.data?.attributes?.payload?.data;
  if (!event) return NextResponse.json({ ok: true });

  const inquiryId = event.id ?? body.data?.attributes?.payload?.data?.id;
  const status = event.attributes?.status as string | undefined;
  const referenceId = event.attributes?.['reference-id'] as string | undefined;
  if (!referenceId || !inquiryId) return NextResponse.json({ ok: true });

  // Bind: only update profile if the (referenceId, inquiryId) pair matches a
  // previously-stored inquiry — prevents cross-user inquiry hijack.
  const admin = supabaseAdmin();
  const { data: existing } = await admin
    .from('profiles')
    .select('id, kyc_inquiry_id')
    .eq('id', referenceId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ ok: true });
  if (existing.kyc_inquiry_id && existing.kyc_inquiry_id !== inquiryId) {
    // mismatched inquiry — don't overwrite
    return NextResponse.json({ ok: true });
  }

  const map: Record<string, 'approved' | 'rejected' | 'pending'> = {
    completed: 'approved', approved: 'approved',
    declined: 'rejected', failed: 'rejected',
    pending: 'pending', expired: 'pending',
  };
  const next = map[status ?? ''] ?? 'pending';

  await admin.from('profiles').update({
    kyc_status: next,
    kyc_inquiry_id: inquiryId,
  }).eq('id', referenceId);

  return NextResponse.json({ ok: true });
}

function parsePersonaSig(header: string): { t: number; v1: string } | null {
  const parts = header.split(',').map(s => s.trim());
  let t: number | null = null;
  let v1: string | null = null;
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k === 't') t = Number(v);
    if (k === 'v1') v1 = v ?? null;
  }
  if (!Number.isFinite(t!) || !v1) return null;
  return { t: t!, v1 };
}
