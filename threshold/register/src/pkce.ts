import { createHash, randomBytes } from 'node:crypto';

const b64url = (b: Buffer): string => b.toString('base64url');

export function newVerifier(): string {
  return b64url(randomBytes(32));
}

/** The S256 challenge for a verifier (RFC 7636). */
export function challengeOf(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export const STATE_TTL_MS = 10 * 60 * 1000;
export const STATE_COOKIE = 'gr_state';

interface Pending {
  readonly verifier: string;
  readonly provider: string;
  readonly expiresAt: number;
  /** The sign-up consent box was ticked on the page that started this sign-in (C7-08). */
  readonly consent: boolean;
  used: boolean;
}

/** Single-use, short-lived sign-in states. Held in memory: a restart only asks the user to retry. */
export class StateStore {
  private readonly pending = new Map<string, Pending>();
  private readonly now: () => number;
  private readonly maxPending: number;
  constructor(now: () => number, maxPending = 5000) {
    this.now = now;
    this.maxPending = maxPending;
  }

  issue(provider: string, verifier: string, consent = false): string {
    this.sweep();
    if (this.pending.size >= this.maxPending) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    const state = b64url(randomBytes(24));
    this.pending.set(state, {
      verifier,
      provider,
      expiresAt: this.now() + STATE_TTL_MS,
      consent,
      used: false,
    });
    return state;
  }

  /** Whether the sign-in that issued this state carried the consent box; false for an unknown state. */
  consented(state: string): boolean {
    return this.pending.get(state)?.consent === true;
  }

  /** Returns the verifier once; a replay, an expired state or a provider mismatch gets null. */
  consume(state: string, provider: string): string | null {
    const entry = this.pending.get(state);
    if (!entry || entry.used || entry.provider !== provider) return null;
    entry.used = true;
    if (this.now() >= entry.expiresAt) return null;
    return entry.verifier;
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, v] of this.pending) if (v.used || t >= v.expiresAt) this.pending.delete(k);
  }
}
