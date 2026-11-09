import { createHash } from 'node:crypto';

/** Crockford base32, the alphabet of the contract's ids. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A deterministic id `<prefix>_<26 characters>`: the first 130 bits of the SHA-256 of `key`, in
 * Crockford base32. The same key always gives the same id, which is what makes a retry or a
 * replay dedup.
 */
export function derivedId(prefix: string, key: string): string {
  const digest = createHash('sha256').update(key).digest();
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const byte of digest) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      bits -= 5;
      out += CROCKFORD[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return `${prefix}_${out}`;
}

/** The `ev_` id of an event, from the record's own key. */
export function eventIdFor(key: string): string {
  return derivedId('ev', key);
}

/**
 * The `rc_` id of a receipt: derived from the action and the phase, so a plan replayed after a
 * restart cannot write a second receipt under a new random id (decision 0043).
 */
export function receiptIdFor(actionId: string, phase: string): string {
  return derivedId('rc', `receipt:${actionId}:${phase}`);
}
