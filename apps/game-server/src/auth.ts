import { jwtVerify } from 'jose';
import { env } from './env.js';

export interface SessionClaims {
  sub: string;          // user id (uuid)
  username: string;
  scope: 'play';
  kyc: 'approved' | 'pending' | 'none' | 'rejected' | 'expired';
  iat: number;
  exp: number;
  jti: string;          // unique session id
  fp: string;           // device fingerprint
}

const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);

export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['HS256'],
    issuer: 'stacks',
    audience: 'game-server',
    clockTolerance: 30,
  });
  if (typeof payload.sub !== 'string') throw new Error('missing sub');
  if (payload.scope !== 'play') throw new Error('bad scope');
  return payload as unknown as SessionClaims;
}

// Constant-time string compare for shared-secret webhooks.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
