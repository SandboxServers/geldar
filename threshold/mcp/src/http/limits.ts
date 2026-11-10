import type { RateLimiter } from '../ports.ts';

/** Most requests one player may have open at once (a `wait` holds one). */
export const MAX_OPEN_PER_PLAYER = 4;

/** Seconds to wait before a bucket has a token again: at least one, rounded up. */
function retrySeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

/**
 * The front door's request budgets, each a bucket of the injected `RateLimiter`: a failed-auth
 * bucket per address and one global, a call bucket per player and per owner, and the open
 * requests per player. The limiter owns the capacities; this names the buckets and the gates.
 */
export class FrontLimits {
  private readonly limiter: RateLimiter;
  private readonly open = new Map<string, number>();

  constructor(limiter: RateLimiter) {
    this.limiter = limiter;
  }

  /**
   * Takes one failed-auth token for the address and one global. Returns the seconds to wait
   * when either bucket is empty, else undefined. Called only for a refused bearer, so a valid
   * token is never blocked by a failure elsewhere.
   */
  failedAuth(address: string, nowMs: number): number | undefined {
    const byAddress = this.limiter.take(`auth-failed:address:${address}`, nowMs);
    if (!byAddress.allowed) return retrySeconds(byAddress.retryAfterMs);
    const global = this.limiter.take('auth-failed:global', nowMs);
    if (!global.allowed) return retrySeconds(global.retryAfterMs);
    return undefined;
  }

  /**
   * Seconds to wait while the address has no failed-auth token left, else undefined. Reads the
   * bucket without taking from it, so a refused address costs no token lookup.
   */
  authBlocked(address: string, nowMs: number): number | undefined {
    const decision = this.limiter.peek?.(`auth-failed:address:${address}`, nowMs);
    if (decision === undefined || decision.allowed) return undefined;
    return retrySeconds(decision.retryAfterMs);
  }

  /** Takes one call from the player's bucket and one from the owner's. Seconds to wait, or undefined. */
  call(playerId: string, ownerId: string, nowMs: number): number | undefined {
    const byPlayer = this.limiter.take(`player:${playerId}`, nowMs);
    if (!byPlayer.allowed) return retrySeconds(byPlayer.retryAfterMs);
    const byOwner = this.limiter.take(`owner:${ownerId}`, nowMs);
    if (!byOwner.allowed) return retrySeconds(byOwner.retryAfterMs);
    return undefined;
  }

  /** Counts one more open request for the player; false when the player is at its cap. */
  acquire(playerId: string): boolean {
    const count = this.open.get(playerId) ?? 0;
    if (count >= MAX_OPEN_PER_PLAYER) return false;
    this.open.set(playerId, count + 1);
    return true;
  }

  /** Counts one open request for the player as closed. */
  release(playerId: string): void {
    const count = this.open.get(playerId) ?? 0;
    if (count <= 1) this.open.delete(playerId);
    else this.open.set(playerId, count - 1);
  }
}
