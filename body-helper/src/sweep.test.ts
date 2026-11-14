import { describe, expect, it } from 'vitest';
import { bodyFixture, createFakeEngine, hostFixture } from './fake-engine.ts';
import { SWEEP_FAILED, sweepStrays } from './sweep.ts';

// The roster holds one name under one owner. Any other pair is not on the roster.
const roster = {
  displayName: async (owner: string, name: string) =>
    owner === 'owner-1' && name === 'known' ? 'Known' : null,
};

describe('stray sweep (report only)', () => {
  it('logs one stable line per Body whose name is not on the roster, and removes nothing', async () => {
    const engine = createFakeEngine([
      bodyFixture('known', true),
      bodyFixture('stray1', true),
      bodyFixture('stray2', false),
      hostFixture('p1'),
    ]);
    const audit: string[] = [];
    const strays = await sweepStrays({ engine, roster, audit: (line) => audit.push(line) });
    expect(strays).toBe(2);
    expect(audit).toEqual([
      'body-helper stray name=stray1 outcome=report_only',
      'body-helper stray name=stray2 outcome=report_only',
    ]);
    expect(engine.containers.map((c) => c.name)).toContain('stray1');
    expect(engine.containers.map((c) => c.name)).toContain('stray2');
  });

  it('matches a mixed-case container name to its lower-case roster key, so it is not a stray', async () => {
    const engine = createFakeEngine([bodyFixture('Known', true), bodyFixture('Stray1', true)]);
    const audit: string[] = [];
    expect(await sweepStrays({ engine, roster, audit: (line) => audit.push(line) })).toBe(1);
    expect(audit).toEqual(['body-helper stray name=Stray1 outcome=report_only']);
  });

  it('logs SWEEP_FAILED and returns -1 when the listing fails, without throwing', async () => {
    const engine = createFakeEngine();
    engine.bodies = async () => {
      throw new Error('docker list refused');
    };
    const audit: string[] = [];
    expect(await sweepStrays({ engine, roster, audit: (line) => audit.push(line) })).toBe(-1);
    expect(audit).toEqual([SWEEP_FAILED]);
  });

  it('logs SWEEP_FAILED when the roster read fails, and keeps the containers', async () => {
    const engine = createFakeEngine([bodyFixture('stray1', true)]);
    const audit: string[] = [];
    const failing = {
      displayName: async () => {
        throw new Error('database refused');
      },
    };
    expect(await sweepStrays({ engine, roster: failing, audit: (line) => audit.push(line) })).toBe(
      -1,
    );
    expect(audit).toEqual([SWEEP_FAILED]);
    expect(engine.containers).toHaveLength(1);
  });
});
