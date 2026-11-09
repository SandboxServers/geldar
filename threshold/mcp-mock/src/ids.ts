const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Book ids are 8 digits, so the counter must stay below 32^8. */
const BK_LIMIT = 32 ** 8;

/** The id kinds: snapshot, intent, action, proposal and book. */
export type IdPrefix = 'sn' | 'in' | 'ac' | 'pr' | 'bk';

/**
 * Builds a deterministic id: `<prefix>_` plus `n` in Crockford base32, left-padded with `0` to
 * 26 characters (8 for `bk`). No clock and no randomness, so a replayed scenario gets the same ids.
 */
export function makeId(prefix: IdPrefix, n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`id counter must be a non-negative integer, got ${n}`);
  }
  if (prefix === 'bk' && n >= BK_LIMIT) {
    throw new RangeError(`book counter must be below 32^8, got ${n}`);
  }
  let rest = BigInt(n);
  let digits = '';
  while (rest > 0n) {
    digits = CROCKFORD.charAt(Number(rest % 32n)) + digits;
    rest /= 32n;
  }
  return `${prefix}_${digits.padStart(prefix === 'bk' ? 8 : 26, '0')}`;
}
