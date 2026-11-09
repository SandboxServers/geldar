import { randomBytes } from 'node:crypto';

/** The id prefixes the Mind mints: thought, intent, action and Thinker job and event (common.schema.json). */
export type IdPrefix = 'th' | 'in' | 'ac' | 'jb' | 'ev';

/** The Crockford base32 alphabet of a ULID: no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The last ULID's time and random parts, so two ids in one millisecond still sort in order. */
let lastTime = -1;
let lastRandom: number[] = [];

/** Fresh 80-bit random part as sixteen 5-bit digits. */
function randomDigits(): number[] {
  const bytes = randomBytes(16);
  return Array.from(bytes, (byte) => byte & 31);
}

/** Adds one to a digit array in base 32, carrying; used when the clock has not moved. */
function increment(digits: number[]): number[] {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i--) {
    const digit = next[i] ?? 0;
    if (digit < 31) {
      next[i] = digit + 1;
      return next;
    }
    next[i] = 0;
  }
  // All 80 bits were set: start again from fresh randomness rather than wrap to zero.
  return randomDigits();
}

/** The 26-character ULID: 10 characters of millisecond time, 16 of randomness. */
function ulid(nowMs: number): string {
  let random: number[];
  if (nowMs <= lastTime) {
    // Same millisecond (or a clock step back): keep the earlier time and count up.
    random = increment(lastRandom);
  } else {
    lastTime = nowMs;
    random = randomDigits();
  }
  lastRandom = random;
  let time = '';
  let rest = lastTime;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  return time + random.map((digit) => ALPHABET[digit]).join('');
}

/**
 * A new id of the form `<prefix>_<ULID>`, matching the patterns in `common.schema.json`
 * (`th_`, `in_`, `ac_`, `jb_`, `ev_`). Ids from one process sort in the order they were made.
 */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid(Date.now())}`;
}
