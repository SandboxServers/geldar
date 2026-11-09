const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type IdPrefix = 'sn' | 'in' | 'ac' | 'pr' | 'bk';

/**
 * Builds a deterministic id: `<prefix>_` plus `n` in Crockford base32, left-padded with `0` to
 * 26 characters (8 for `bk`). No clock and no randomness, so a replayed scenario gets the same ids.
 */
export function makeId(prefix: IdPrefix, n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`id counter must be a non-negative integer, got ${n}`);
  }
  let rest = BigInt(n);
  let digits = '';
  while (rest > 0n) {
    digits = CROCKFORD.charAt(Number(rest % 32n)) + digits;
    rest /= 32n;
  }
  return `${prefix}_${digits.padStart(prefix === 'bk' ? 8 : 26, '0')}`;
}
