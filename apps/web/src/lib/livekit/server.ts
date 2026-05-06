import { AccessToken } from 'livekit-server-sdk';

export async function issueLiveKitToken(opts: { room: string; identity: string; name?: string }) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) return '';                       // dev mode: no LiveKit configured
  const at = new AccessToken(apiKey, apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: '6h',
  });
  at.addGrant({
    room: opts.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // adaptive simulcast handled client-side
  });
  return at.toJwt();
}
