// Server-side WebAuthn helpers for biometric login.
// Backed by @simplewebauthn/server.

import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type GenerateRegistrationOptionsOpts,
  type GenerateAuthenticationOptionsOpts,
} from '@simplewebauthn/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const RP_NAME = 'Stacks Poker';

function rpID(req?: { headers: { get: (k: string) => string | null } }): string {
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;
  if (req) {
    const host = req.headers.get('host') ?? 'localhost:3000';
    return host.split(':')[0]!;
  }
  return 'localhost';
}

function origin(req?: { headers: { get: (k: string) => string | null } }): string {
  if (process.env.WEBAUTHN_ORIGIN) return process.env.WEBAUTHN_ORIGIN;
  if (req) {
    const host = req.headers.get('host') ?? 'localhost:3000';
    const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}

export async function startRegistration(args: {
  userId: string;
  username: string;
  displayName?: string;
  request: { headers: { get: (k: string) => string | null } };
}) {
  const admin = supabaseAdmin();
  const { data: existing } = await admin
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', args.userId);

  const opts: GenerateRegistrationOptionsOpts = {
    rpName: RP_NAME,
    rpID: rpID(args.request),
    userName: args.username,
    userDisplayName: args.displayName ?? args.username,
    userID: new TextEncoder().encode(args.userId),
    timeout: 60_000,
    attestationType: 'none',
    excludeCredentials: (existing ?? []).map(c => ({
      id: c.credential_id,
      type: 'public-key',
      transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',     // prefer device-bound (Touch ID, Face ID, Windows Hello)
    },
    supportedAlgorithmIDs: [-7, -257],         // ES256, RS256
  };

  const options = await generateRegistrationOptions(opts);

  await admin.from('webauthn_challenges').insert({
    user_id: args.userId,
    challenge: options.challenge,
    type: 'register',
  });

  return options;
}

export async function verifyRegistration(args: {
  userId: string;
  expectedChallenge: string;
  response: Parameters<typeof verifyRegistrationResponse>[0]['response'];
  nickname?: string;
  request: { headers: { get: (k: string) => string | null } };
}) {
  const admin = supabaseAdmin();
  const verification = await verifyRegistrationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: origin(args.request),
    expectedRPID: rpID(args.request),
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false };
  }

  const r = verification.registrationInfo;
  await admin.from('webauthn_credentials').insert({
    user_id: args.userId,
    credential_id: r.credential.id,
    public_key: Buffer.from(r.credential.publicKey),
    counter: r.credential.counter,
    device_type: r.credentialDeviceType,
    backed_up: r.credentialBackedUp,
    transports: (r.credential.transports ?? []) as string[],
    nickname: args.nickname ?? null,
  });

  await admin.from('webauthn_challenges').delete().eq('challenge', args.expectedChallenge);

  return { verified: true, credentialId: r.credential.id };
}

export async function startAuthentication(args: {
  userId?: string;          // optional: if known, return only that user's creds
  request: { headers: { get: (k: string) => string | null } };
}) {
  const admin = supabaseAdmin();
  let allowCredentials: { id: string; type: 'public-key'; transports?: AuthenticatorTransportFuture[] }[] = [];
  if (args.userId) {
    const { data } = await admin
      .from('webauthn_credentials')
      .select('credential_id, transports')
      .eq('user_id', args.userId);
    allowCredentials = (data ?? []).map(c => ({
      id: c.credential_id,
      type: 'public-key',
      transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
    }));
  }

  const opts: GenerateAuthenticationOptionsOpts = {
    rpID: rpID(args.request),
    allowCredentials,
    userVerification: 'preferred',
    timeout: 60_000,
  };
  const options = await generateAuthenticationOptions(opts);
  await admin.from('webauthn_challenges').insert({
    user_id: args.userId ?? null,
    challenge: options.challenge,
    type: 'authenticate',
  });
  return options;
}

export async function verifyAuthentication(args: {
  expectedChallenge: string;
  response: Parameters<typeof verifyAuthenticationResponse>[0]['response'];
  request: { headers: { get: (k: string) => string | null } };
}) {
  const admin = supabaseAdmin();
  const credentialId = args.response.id;
  const { data: cred } = await admin
    .from('webauthn_credentials')
    .select('*')
    .eq('credential_id', credentialId)
    .maybeSingle();
  if (!cred) return { verified: false, reason: 'unknown_credential' };

  const verification = await verifyAuthenticationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: origin(args.request),
    expectedRPID: rpID(args.request),
    credential: {
      id: cred.credential_id,
      publicKey: new Uint8Array(cred.public_key),
      counter: Number(cred.counter),
      transports: (cred.transports ?? []) as AuthenticatorTransportFuture[],
    },
    requireUserVerification: false,
  });

  if (!verification.verified) return { verified: false, reason: 'verify_failed' };

  await admin.from('webauthn_credentials').update({
    counter: verification.authenticationInfo.newCounter,
    last_used_at: new Date().toISOString(),
  }).eq('id', cred.id);

  await admin.from('webauthn_challenges').delete().eq('challenge', args.expectedChallenge);

  return { verified: true, userId: cred.user_id as string };
}

type AuthenticatorTransportFuture = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';
