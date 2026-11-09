import { randomBytes } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so an id never reads as a different character. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const RANDOM_BYTES = 10;
const RANDOM_CHARS = 16;

/** Encodes `value` as exactly `length` base32 characters, most significant first. */
function encode(value: bigint, length: number): string {
  let out = '';
  let rest = value;
  for (let i = 0; i < length; i++) {
    out = (ALPHABET[Number(rest & 31n)] ?? '0') + out;
    rest >>= 5n;
  }
  return out;
}

/**
 * A 26-character, time-sortable id: 10 characters of the 48-bit millisecond time, then 16 of 80
 * random bits. Used as `sn_${ulid()}` for snapshot ids. `now` and `rand` are injectable for tests.
 */
export function ulid(now = Date.now(), rand: (size: number) => Uint8Array = randomBytes): string {
  const random = BigInt(`0x${Buffer.from(rand(RANDOM_BYTES)).toString('hex')}`);
  return encode(BigInt(Math.floor(now)), TIME_CHARS) + encode(random, RANDOM_CHARS);
}
