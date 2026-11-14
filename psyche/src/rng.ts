import { ENGINE_VERSION } from './version.ts';

/**
 * Identity of one draw. The body generation is part of the key: a restart starts a new generation with
 * decisionSeq from 0, so it never replays a draw. A retry of the same decision reuses the key and so the result.
 */
export interface DrawKey {
  lifeId: string;
  producer: 'body' | 'kit';
  generation: number;
  tick: number;
  fx: string;
  decisionSeq: number;
}

export interface Rng {
  next(): number;
  readonly draws: number;
}

function requireText(name: string, value: string): void {
  if (value === '' || value.includes(':')) {
    throw new RangeError(
      `${name} must be non-empty and must not contain ':': ${JSON.stringify(value)}`,
    );
  }
}

function requireCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer: ${value}`);
  }
}

/**
 * The engine validates the key: a colon in lifeId or fx would let two keys share one id, so both are refused.
 * The id format itself is fixed by the card and not escaped.
 */
export function decisionId(key: DrawKey): string {
  requireText('lifeId', key.lifeId);
  requireText('fx', key.fx);
  requireCount('generation', key.generation);
  requireCount('tick', key.tick);
  requireCount('decisionSeq', key.decisionSeq);
  return `${key.producer}:${key.lifeId}:${key.generation}:${key.tick}:${key.fx}:${key.decisionSeq}`;
}

/**
 * FNV-1a, 32 bit, over the UTF-16 code units of the text. Ports must hash UTF-16 code units
 * (JS string indices), not UTF-8 bytes or code points: 'é' is one unit, an emoji is two.
 */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function seedFor(key: DrawKey, engineVersion: number = ENGINE_VERSION): number {
  return fnv1a32(`${engineVersion}|${decisionId(key)}`);
}

/** mulberry32. next() is in [0, 1). */
function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  let draws = 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      draws += 1;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get draws(): number {
      return draws;
    },
  };
}

export function rngFor(key: DrawKey): Rng {
  return mulberry32(seedFor(key));
}

export function d20(rng: Rng): number {
  return Math.floor(rng.next() * 20) + 1;
}
