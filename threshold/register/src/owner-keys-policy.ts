import { createHmac, randomBytes } from 'node:crypto';

/** An owner key lives 90 days from mint (decision 0170, point 2). */
export const OWNER_KEY_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

/** The scopes an owner key may carry. */
export const OWNER_KEY_SCOPES = ['read', 'body', 'manage'] as const;

export type OwnerKeyScope = (typeof OWNER_KEY_SCOPES)[number];

const KEY_SHAPE = /^gowner-[0-9a-f]{64}$/;

/** Whether a presented value has the owner key shape. A player token never has it. */
export function isOwnerKeyShape(value: string): boolean {
  return KEY_SHAPE.test(value);
}

/** HMAC-SHA256 of the key value under the token pepper: the only form the database stores. */
export function hashOwnerKey(pepper: string, value: string): Buffer {
  return createHmac('sha256', pepper).update(value).digest();
}

/** A new key: the id (8 random bytes) and the value (32 random bytes, shown once). */
export interface NewOwnerKey {
  keyId: string;
  value: string;
}

export function newOwnerKey(random: (size: number) => Buffer = randomBytes): NewOwnerKey {
  return {
    keyId: `gok-${random(8).toString('hex')}`,
    value: `gowner-${random(32).toString('hex')}`,
  };
}

/** The requested scopes, or null when the list is empty, names an unknown scope, or repeats one. */
export function parseScopes(requested: readonly string[]): OwnerKeyScope[] | null {
  if (requested.length === 0) return null;
  const seen = new Set<string>();
  for (const scope of requested) {
    if (!(OWNER_KEY_SCOPES as readonly string[]).includes(scope) || seen.has(scope)) return null;
    seen.add(scope);
  }
  return requested as OwnerKeyScope[];
}

/** Whether the granted scopes include the required one. */
export function hasScope(granted: readonly string[], required: OwnerKeyScope): boolean {
  return granted.includes(required);
}

/** The expiry instant of a key minted at `mintedAt`. */
export function ownerKeyExpiresAt(mintedAt: Date): Date {
  return new Date(mintedAt.getTime() + OWNER_KEY_LIFETIME_MS);
}
