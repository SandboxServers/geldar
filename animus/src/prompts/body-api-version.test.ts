import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../config.ts';
import {
  BUILDING_BODY_API_VERSION,
  bodyApiVersionFor,
  createPromptLibrary,
  DEFAULT_BODY_API_VERSION,
} from './library.ts';

describe('the body-api version follows body_actions.building', () => {
  it('is v12 when the building flag is on and v10 when it is off', () => {
    expect(BUILDING_BODY_API_VERSION).toBe(12);
    expect(DEFAULT_BODY_API_VERSION).toBe(10);
    expect(bodyApiVersionFor(true)).toBe(12);
    expect(bodyApiVersionFor(false)).toBe(10);
  });

  it('loads body-api/v12.json, the template that teaches break and plan, when the flag is on', () => {
    const on = createPromptLibrary({ version: bodyApiVersionFor(true) });
    expect(on.bodyApiVersion).toMatch(/^body-api@12\+sha256:[0-9a-f]{12}$/);
    expect(readFileSync(join(repoRoot(), 'prompts', 'body-api', 'v12.json'), 'utf8')).toContain(
      '"break"',
    );
  });

  it('keeps the v10 default when the flag is off, with no version option', () => {
    const off = createPromptLibrary({ version: bodyApiVersionFor(false) });
    expect(off.bodyApiVersion).toMatch(/^body-api@10\+sha256:[0-9a-f]{12}$/);
    expect(createPromptLibrary().bodyApiVersion).toBe(off.bodyApiVersion);
  });
});
