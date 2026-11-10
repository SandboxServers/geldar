import type { RateDecision, RateLimiter } from '../ports.ts';
import { clientKey } from './auth.ts';

/** Most requests one player may have open at once (a `wait` holds one). */
export const MAX_OPEN_PER_PLAYER = 4;

/** A sibling agent that called this recently (ms) still holds its share of the owner's pool. */
const ACTIVE_MS = 60_000;

/**
 * One agent's fair share of its owner's calls a minute: the owner rate split across the owner cap,
 * at least one call a minute. It is a guaranteed minimum, not a limit: see `FrontLimits.call`.
 */
export function ownerShare(ownerCallsPerMinute: number, agentsPerOwner: number): number {
  return Math.max(1, Math.floor(ownerCallsPerMinute / Math.max(1, agentsPerOwner)));
}

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
  private readonly openByAddress = new Map<string, number>();
  private readonly openByOwner = new Map<string, number>();
  /** Per owner, each agent's last call time: the agents that count as active siblings. */
  private readonly lastCall = new Map<string, Map<string, number>>();
  private readonly share: number;

  /** `share` is `ownerShare(...)`; 0 (the default) reserves nothing for siblings. */
  constructor(limiter: RateLimiter, share = 0) {
    this.limiter = limiter;
    this.share = share;
  }

  /**
   * Takes one failed-auth token for the address and one global. Returns the seconds to wait
   * when either bucket is empty, else undefined. Called only for a bearer that missed the token
   * cache and was refused: each such request costs one token, so a flood empties the bucket.
   */
  failedAuth(address: string, nowMs: number): number | undefined {
    const byAddress = this.limiter.take(`auth-failed:address:${clientKey(address)}`, nowMs);
    if (!byAddress.allowed) return retrySeconds(byAddress.retryAfterMs);
    const global = this.limiter.take('auth-failed:global', nowMs);
    if (!global.allowed) return retrySeconds(global.retryAfterMs);
    return undefined;
  }

  /**
   * Seconds to wait while the address or the global failed-auth bucket has no token left, else
   * undefined. Reads both buckets without taking from them, so a refused request costs no token
   * lookup. The caller skips this check for a cached hit, so authenticated traffic is never blocked
   * by failed-auth state.
   */
  authBlocked(address: string, nowMs: number): number | undefined {
    const byAddress = this.limiter.peek(`auth-failed:address:${clientKey(address)}`, nowMs);
    if (byAddress !== undefined && !byAddress.allowed) return retrySeconds(byAddress.retryAfterMs);
    const global = this.limiter.peek('auth-failed:global', nowMs);
    if (global !== undefined && !global.allowed) return retrySeconds(global.retryAfterMs);
    return undefined;
  }

  /**
   * Takes one call for the player. The owner's pool is checked first, so a refusal takes nothing.
   * The agent's own share is a guaranteed minimum: while it has share tokens its call takes one
   * from the share and one from the pool. Past its share, the agent may still take from the pool
   * when the pool keeps at least one share per active sibling after the take, so a lone agent
   * reaches its player rate. Only a nearly empty pool refuses an agent over its share, which keeps
   * the siblings' shares for them. The player's own bucket is taken last. Seconds to wait, or
   * undefined.
   */
  call(playerId: string, ownerId: string, nowMs: number): number | undefined {
    const reserved = this.siblingReserve(playerId, ownerId, nowMs);
    this.noteCall(playerId, ownerId, nowMs);
    const pool = this.limiter.peek(`owner:${ownerId}`, nowMs);
    if (!pool.allowed) return retrySeconds(pool.retryAfterMs);
    const share = this.limiter.take(`owner-agent:${ownerId}:${playerId}`, nowMs);
    if (!share.allowed && !spareAfterTake(pool, reserved)) return retrySeconds(share.retryAfterMs);
    const byOwner = this.limiter.take(`owner:${ownerId}`, nowMs);
    if (!byOwner.allowed) return retrySeconds(byOwner.retryAfterMs);
    const byPlayer = this.limiter.take(`player:${playerId}`, nowMs);
    if (!byPlayer.allowed) return retrySeconds(byPlayer.retryAfterMs);
    return undefined;
  }

  /** Pool tokens the other active agents of the owner hold, one share each. Drops stale entries. */
  private siblingReserve(playerId: string, ownerId: string, nowMs: number): number {
    const agents = this.lastCall.get(ownerId);
    if (agents === undefined) return 0;
    let active = 0;
    for (const [agent, at] of agents) {
      if (nowMs - at >= ACTIVE_MS) agents.delete(agent);
      else if (agent !== playerId) active++;
    }
    if (agents.size === 0) this.lastCall.delete(ownerId);
    return active * this.share;
  }

  /** Records that the agent called the owner's pool at `nowMs`. */
  private noteCall(playerId: string, ownerId: string, nowMs: number): void {
    let agents = this.lastCall.get(ownerId);
    if (agents === undefined) {
      agents = new Map();
      this.lastCall.set(ownerId, agents);
    }
    agents.set(playerId, nowMs);
  }

  /**
   * Takes one token from the player's handshake bucket, which carries initialize, resources/read
   * and the other non-call methods at its own, higher rate. They take no call token. Seconds to
   * wait, or undefined.
   */
  handshake(playerId: string, nowMs: number): number | undefined {
    const decision = this.limiter.take(`handshake:${playerId}`, nowMs);
    return decision.allowed ? undefined : retrySeconds(decision.retryAfterMs);
  }

  /** Counts one more open request for the player; false when the player is at its cap. */
  acquire(playerId: string): boolean {
    return takeSlot(this.open, playerId, MAX_OPEN_PER_PLAYER);
  }

  /** Counts one open request for the player as closed. */
  release(playerId: string): void {
    freeSlot(this.open, playerId);
  }

  /** Counts one more open request for the owner, across its agents and addresses; false at the cap. */
  acquireOwner(ownerId: string, cap: number): boolean {
    return takeSlot(this.openByOwner, ownerId, cap);
  }

  /** Counts one open request for the owner as closed. */
  releaseOwner(ownerId: string): void {
    freeSlot(this.openByOwner, ownerId);
  }

  /**
   * Counts one more open request for the effective client address; false at the cap. Behind a
   * tunnel every player shares the proxy's peer address, so this is the cap that is per client.
   * The connection cap sees only the peer at connect time, so it cannot make this distinction.
   */
  acquireAddress(address: string, cap: number): boolean {
    return takeSlot(this.openByAddress, clientKey(address), cap);
  }

  /** Counts one open request for the effective client address as closed. */
  releaseAddress(address: string): void {
    freeSlot(this.openByAddress, clientKey(address));
  }
}

/** True when the pool still holds `reserved` tokens after one more take. An unknown count reserves nothing. */
function spareAfterTake(pool: RateDecision, reserved: number): boolean {
  if (pool.remaining === undefined) return reserved === 0;
  return pool.remaining - 1 >= reserved;
}

/** Adds one to the key's count unless it is at the cap. */
function takeSlot(counts: Map<string, number>, key: string, cap: number): boolean {
  const count = counts.get(key) ?? 0;
  if (count >= cap) return false;
  counts.set(key, count + 1);
  return true;
}

/** Takes one from the key's count, dropping the entry at zero. */
function freeSlot(counts: Map<string, number>, key: string): void {
  const count = counts.get(key) ?? 0;
  if (count <= 1) counts.delete(key);
  else counts.set(key, count - 1);
}
