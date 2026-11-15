import { describe, expect, it } from 'vitest';
import { validateToolInput } from '../src/index.ts';

// GX-08: WaitInput takes an optional boolean `peek`; the schema is additive, so every plain wait still validates.
describe('wait peek input', () => {
  it('accepts a boolean peek alongside max_seconds', () => {
    expect(validateToolInput('wait', { max_seconds: 5, peek: true }).ok).toBe(true);
    expect(validateToolInput('wait', { max_seconds: 5, peek: false }).ok).toBe(true);
  });

  it('keeps a plain wait valid without peek', () => {
    expect(validateToolInput('wait', { max_seconds: 5 }).ok).toBe(true);
    expect(validateToolInput('wait', { max_seconds: 5, cursor: 'c_0' }).ok).toBe(true);
  });

  it('rejects a non-boolean peek', () => {
    expect(validateToolInput('wait', { max_seconds: 5, peek: 'yes' }).ok).toBe(false);
    expect(validateToolInput('wait', { max_seconds: 5, peek: 1 }).ok).toBe(false);
    expect(validateToolInput('wait', { max_seconds: 5, peek: null }).ok).toBe(false);
  });
});
