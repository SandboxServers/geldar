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

  it('carries no marker word in agent-visible text', () => {
    expect(markedWords(RAW)).toEqual([]);
  });
});
