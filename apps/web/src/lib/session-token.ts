import { SignJWT } from 'jose';

const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET ?? '');

export async function mintGameToken(opts: {
  userId: string;
  username: string;
  kyc: 'approved' | 'pending' | 'none' | 'rejected' | 'expired';
  fingerprint: string;
}) {
  if (!process.env.SUPABASE_JWT_SECRET) throw new Error('SUPABASE_JWT_SECRET missing');
  return new SignJWT({
    sub: opts.userId,
    username: opts.username,
    kyc: opts.kyc,
    scope: 'play',
    jti: crypto.randomUUID(),
    fp: opts.fingerprint,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('stacks')
    .setAudience('game-server')
    .setIssuedAt()
    .setExpirationTime('30m')
    .sign(secret);
}
