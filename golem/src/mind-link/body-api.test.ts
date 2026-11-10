import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateThought } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { createProgramRegistry } from '../body/programs/index.ts';
import { contextFor, newWorld } from '../body/programs/programs.fakes.ts';
import { repoRoot } from '../config.ts';

interface BodyApiFile {
  say: { example: unknown };
  verbs: { do: string; example: unknown }[];
  programs: { program: string; example: { arguments: unknown } }[];
}

/** The Mind's prompt table is the Body's contract: every example in it must be something the Body accepts. */
const table = JSON.parse(
  readFileSync(join(repoRoot(), 'prompts', 'body-api', 'v1.json'), 'utf8'),
) as BodyApiFile;

describe('prompts/body-api/v1.json against the Body', () => {
  it('names only programs the Body registers', () => {
    const programs = createProgramRegistry().names();
    for (const entry of table.programs) expect(programs, entry.program).toContain(entry.program);
  });

  it('gives a say example that is a valid thought', () => {
    expect(validateThought(table.say.example).ok).toBe(true);
  });

  for (const verb of table.verbs) {
    it(`accepts the ${verb.do} example as an action`, () => {
      const verdict = validateThought({ reasoning: 'x', actions: [verb.example] });
      expect(verdict.ok ? 'ok' : verdict.errors.join('; ')).toBe('ok');
    });
  }

  for (const entry of table.programs) {
    it(`accepts the ${entry.program} example as an intent and starts the program`, async () => {
      const thought = { reasoning: 'x', intent: entry.example };
      const verdict = validateThought(thought);
      expect(verdict.ok ? 'ok' : verdict.errors.join('; ')).toBe('ok');
      const program = createProgramRegistry().create(entry.program);
      expect(program, entry.program).toBeDefined();
      const ctx = contextFor(newWorld());
      await expect(
        program?.start(entry.example.arguments as Record<string, unknown>, ctx),
      ).resolves.toBeUndefined();
    });
  }

  it('refuses a program example with a field the table does not list', async () => {
    const program = createProgramRegistry().create('travel');
    await expect(
      program?.start({ target: { x: 1, y: 2, z: 3 }, extra: 1 }, contextFor(newWorld())),
    ).rejects.toThrow();
  });
});
