import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  markedWords,
  validateExploreArguments,
  validateFarmArguments,
  validatePatrolArguments,
  validateThought,
} from '@geldar/contract';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { PROGRAM_ARGS } from '../../../player-core/src/validate/bounds.ts';
import { createProgramRegistry } from '../body/programs/index.ts';
import { contextFor, newWorld } from '../body/programs/programs.fakes.ts';
import { repoRoot } from '../config.ts';
import { FakeWorld } from '../perception/perception.fakes.ts';

interface BodyApiFile {
  say: { example: unknown };
  verbs: { do: string; example: unknown }[];
  programs: { program: string; summary: string; example: { arguments: unknown } }[];
}

const RAW = readFileSync(join(repoRoot(), 'prompts', 'body-api', 'v13.json'), 'utf8');

/** v13 is the unselected candidate: its examples must be what the Body accepts. */
const table = JSON.parse(RAW) as BodyApiFile;

const ARGUMENT_CHECKS: Record<string, (value: unknown) => { ok: boolean }> = {
  explore: validateExploreArguments,
  farm: validateFarmArguments,
  patrol: validatePatrolArguments,
};

/** follow refuses a target it cannot see, so its example starts with that person in sight. */
function contextForExample(program: string) {
  const base = contextFor(newWorld());
  if (program !== 'follow') return base;
  const sight = new FakeWorld();
  sight.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 4.5) };
  return { ...base, bot: sight.bot };
}

describe('prompts/body-api/v13.json against the Body', () => {
  it('names only programs the Body registers', () => {
    const programs = createProgramRegistry().names();
    for (const entry of table.programs) expect(programs, entry.program).toContain(entry.program);
  });

  it('adds explore, farm and patrol, and keeps the v12 programs', () => {
    const names = table.programs.map((entry) => entry.program);
    expect(names).toEqual(
      expect.arrayContaining(['travel', 'gather', 'build', 'explore', 'farm', 'patrol']),
    );
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
      const ctx = contextForExample(entry.program);
      await expect(
        program?.start(entry.example.arguments as Record<string, unknown>, ctx),
      ).resolves.toBeUndefined();
    });
  }

  for (const [program, check] of Object.entries(ARGUMENT_CHECKS)) {
    it(`keeps the ${program} example arguments inside the bounds`, () => {
      const entry = table.programs.find((candidate) => candidate.program === program);
      const verdict = check(entry?.example.arguments);
      expect(verdict.ok, program).toBe(true);
    });
  }

  it('states the owner-approved summaries verbatim', () => {
    const summaries = Object.fromEntries(table.programs.map((e) => [e.program, e.summary]));
    expect(summaries.explore).toBe(
      'Walk in legs toward chunks you have not visited, avoiding water if asked. It stops when nothing new is near or danger is close.',
    );
    expect(summaries.farm).toBe(
      'Harvest ripe crops of yours within a set radius and replant them if asked. It does not touch crops that are not yours and does not till.',
    );
    expect(summaries.patrol).toBe(
      'Walk a route of 2 to 8 block positions a set number of laps, returning to the start if looping.',
    );
  });

  it('states each argument bound as the PROGRAM_ARGS min and max', () => {
    for (const entry of table.programs) {
      if (!(entry.program in ARGUMENT_CHECKS)) continue;
      const shapes = PROGRAM_ARGS[entry.program] ?? {};
      const written = entry as unknown as { arguments: Record<string, string> };
      expect(Object.keys(written.arguments).sort(), entry.program).toEqual(
        Object.keys(shapes).sort(),
      );
      for (const [key, text] of Object.entries(written.arguments)) {
        const spec = shapes[key];
        if (spec === undefined) {
          throw new Error(`${entry.program}.${key} has no PROGRAM_ARGS shape`);
        }
        if (spec.kind === 'bool') {
          expect(text, `${entry.program}.${key}`).toBe('optional, true or false');
          continue;
        }
        if (spec.kind !== 'int' && spec.kind !== 'route') {
          throw new Error(`${entry.program}.${key} is ${spec.kind}, not a bounded number`);
        }
        const numbers = /(\d+) to (\d+)/.exec(text);
        expect(numbers, `${entry.program}.${key}`).not.toBeNull();
        expect([Number(numbers?.[1]), Number(numbers?.[2])], `${entry.program}.${key}`).toEqual([
          spec.min,
          spec.max,
        ]);
      }
    }
  });

  it('is version 13, and the same as v12 apart from the version, description and three programs', () => {
    const v12 = JSON.parse(
      readFileSync(join(repoRoot(), 'prompts', 'body-api', 'v12.json'), 'utf8'),
    ) as Record<string, unknown>;
    const v13 = JSON.parse(RAW) as Record<string, unknown>;
    expect(v13.version).toBe(13);
    const strip = (file: Record<string, unknown>, programs: unknown[]) => {
      const { version: _version, description: _description, ...rest } = file;
      return { ...rest, programs };
    };
    const v12Programs = v12.programs as unknown[];
    const v13Programs = v13.programs as unknown[];
    expect(strip(v13, v13Programs.slice(0, -3))).toEqual(strip(v12, v12Programs));
  });

  it('keeps the v12 description text', () => {
    const v12 = JSON.parse(
      readFileSync(join(repoRoot(), 'prompts', 'body-api', 'v12.json'), 'utf8'),
    ) as { description: string };
    expect((JSON.parse(RAW) as { description: string }).description).toBe(v12.description);
  });

  it('carries no marker word in agent-visible text', () => {
    expect(markedWords(RAW)).toEqual([]);
  });
});
