import type { ProgramCheckpoint } from '../program.ts';

/** Why a program refused to start: bad arguments, or a program the Body does not run. */
export type ProgramErrorReason = 'invalid_args' | 'unsupported';

/** Thrown by `start` and `resume`; the executor reads `reason` for the failed intent. */
export class ProgramError extends Error {
  readonly reason: ProgramErrorReason;
  readonly program: string;

  constructor(reason: ProgramErrorReason, program: string, message: string) {
    super(`${program}: ${message}`);
    this.name = 'ProgramError';
    this.reason = reason;
    this.program = program;
  }
}

/** A plain object as the program arguments or a checkpoint. */
export type PlainObject = Record<string, unknown>;

/**
 * Argument validators for the programs. The contract leaves `Intent.arguments` untyped, so each
 * program documents its own shape; these readers check one field at a time and throw a
 * `ProgramError('invalid_args')` that names the program and the field.
 */
export class ArgReader {
  private readonly seen = new Set<string>();

  private readonly program: string;
  private readonly source: unknown;
  private readonly what: string;

  constructor(program: string, source: unknown, what = 'arguments') {
    if (typeof source !== 'object' || source === null || Array.isArray(source)) {
      throw new ProgramError('invalid_args', program, `${what} must be an object`);
    }
    this.program = program;
    this.source = source;
    this.what = what;
  }
  private raw(field: string): unknown {
    this.seen.add(field);
    return (this.source as PlainObject)[field];
  }

  private bad(field: string, rule: string): ProgramError {
    return new ProgramError('invalid_args', this.program, `${this.what} ${field} ${rule}`);
  }

  /** A required integer in `min..max`. */
  int(field: string, min: number, max: number): number {
    const value = this.raw(field);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw this.bad(field, `must be an integer from ${min} to ${max}`);
    }
    return value;
  }

  /** An integer in `min..max`, or `fallback` when absent. */
  optionalInt(field: string, min: number, max: number, fallback: number): number {
    if (this.raw(field) === undefined) return fallback;
    this.seen.delete(field);
    return this.int(field, min, max);
  }

  /** A required lower-case item or block name (`oak_log`). */
  name(field: string): string {
    const value = this.raw(field);
    if (typeof value !== 'string' || !/^[a-z0-9_]{1,64}$/.test(value)) {
      throw this.bad(field, 'must be a name of lower-case letters, digits and underscores');
    }
    return value;
  }

  /** A name, or `fallback` when absent. */
  optionalName(field: string, fallback: string): string {
    if (this.raw(field) === undefined) return fallback;
    this.seen.delete(field);
    return this.name(field);
  }

  /** A required position `{ x, y, z }` of integers inside the contract's bounds. */
  position(field: string): Position {
    return this.positionOf(field, this.raw(field));
  }

  /** A position or a player name (3 to 16 letters, digits, underscores). */
  positionOrPlayer(field: string): Position | string {
    const value = this.raw(field);
    if (typeof value === 'string') {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(value)) throw this.bad(field, 'is not a player name');
      return value;
    }
    return this.positionOf(field, value);
  }

  /** A required boolean. */
  bool(field: string): boolean {
    const value = this.raw(field);
    if (typeof value !== 'boolean') throw this.bad(field, 'must be true or false');
    return value;
  }

  private positionOf(field: string, value: unknown): Position {
    if (typeof value !== 'object' || value === null) throw this.bad(field, 'must be a position');
    const sub = new ArgReader(this.program, value, `${this.what} ${field}`);
    const pos = {
      x: sub.int('x', -30_000_000, 30_000_000),
      y: sub.int('y', -64, 320),
      z: sub.int('z', -30_000_000, 30_000_000),
    };
    sub.done();
    return pos;
  }

  /** Throws when the object carries a field no reader asked for. */
  done(): void {
    for (const key of Object.keys(this.source as PlainObject)) {
      if (!this.seen.has(key)) throw this.bad(key, 'is not a known field');
    }
  }
}

/** A block position. */
export interface Position {
  x: number;
  y: number;
  z: number;
}

/** A checkpoint reader: same checks, reported as an invalid checkpoint. */
export function checkpointReader(program: string, saved: unknown): ArgReader {
  return new ArgReader(program, saved, 'checkpoint');
}

/** A checkpoint the program can hand back as plain JSON. */
export type Saved = ProgramCheckpoint;
