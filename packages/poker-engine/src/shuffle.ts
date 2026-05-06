import { createHash, createHmac, randomBytes } from 'node:crypto';
import { FRESH_DECK, type Card } from './cards';

// Provably-fair shuffle:
//   1. Server generates `serverSeed` (kept secret).
//   2. Server publishes `commitment = sha256(serverSeed || nonce)` to all players.
//   3. Players' join/heartbeat tokens contribute `clientEntropy`.
//   4. After showdown, server reveals `serverSeed`. Anyone can verify
//      sha256(serverSeed || nonce) == commitment, then re-derive the deck.

export interface DeckMaterial {
  serverSeed: string;       // hex; revealed at showdown
  clientEntropy: string;    // hex; aggregated from players' join tokens
  nonce: string;            // hex; unique per hand
}

export function newServerSeed(): string {
  return randomBytes(32).toString('hex');
}

export function commit(material: { serverSeed: string; nonce: string }): string {
  return createHash('sha256')
    .update(material.serverSeed + ':' + material.nonce, 'utf8')
    .digest('hex');
}

// Deterministic shuffle from material — reproducible by anyone after reveal.
export function shuffleDeck(material: DeckMaterial): Card[] {
  const deck = [...FRESH_DECK];
  const stream = expandKeystream(material);
  // Fisher-Yates from end
  for (let i = deck.length - 1; i > 0; i--) {
    const r = nextUInt(stream, i + 1);
    [deck[i], deck[r]] = [deck[r]!, deck[i]!];
  }
  return deck;
}

// Internal: HMAC-SHA256 keystream expansion.
class Keystream {
  private buf: Buffer = Buffer.alloc(0);
  private counter = 0;
  constructor(private readonly key: Buffer, private readonly nonce: string) {}
  read(n: number): Buffer {
    while (this.buf.length < n) {
      const chunk = createHmac('sha256', this.key)
        .update(this.nonce + ':' + this.counter, 'utf8')
        .digest();
      this.counter++;
      this.buf = Buffer.concat([this.buf, chunk]);
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return Buffer.from(out);
  }
}

function expandKeystream(m: DeckMaterial): Keystream {
  const key = createHash('sha256')
    .update(m.serverSeed + ':' + m.clientEntropy, 'utf8')
    .digest();
  return new Keystream(key, m.nonce);
}

// Uniform integer in [0, max) using rejection sampling.
function nextUInt(s: Keystream, max: number): number {
  if (max <= 0 || max > 0xff_ff_ff_ff) throw new Error('bad max');
  // Smallest power-of-two >= max
  let bits = 0;
  for (let v = max - 1; v > 0; v >>>= 1) bits++;
  const bytes = Math.ceil(bits / 8);
  const mask = (1 << bits) - 1;
  while (true) {
    const buf = s.read(bytes);
    let val = 0;
    for (let i = 0; i < bytes; i++) val = (val << 8) | buf[i]!;
    val &= mask;
    if (val < max) return val;
  }
}

// Produce the verifiable claim emitted at showdown.
export function buildVerification(material: DeckMaterial): {
  serverSeed: string;
  clientEntropy: string;
  nonce: string;
  commitment: string;
  deckOrder: number[];
} {
  return {
    serverSeed: material.serverSeed,
    clientEntropy: material.clientEntropy,
    nonce: material.nonce,
    commitment: commit(material),
    deckOrder: shuffleDeck(material),
  };
}
