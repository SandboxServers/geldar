import { describe, expect, it } from 'vitest';
import type { RosterPort } from './roster.ts';
import type { ContainerState } from './service.ts';
import { ORPHAN_EXIT_CODE, SWEEP_FAILED, type SweepDeps, sweepStrays } from './sweep.ts';

// The orphan is one managed Body under one owner. Its roster row is gone unless `onRoster` says otherwise.
const NAME = 'orphan1';
const LIFE = 'ag_0123456789ab';

interface World {
  onRoster: boolean;
  rosterThrows: boolean;
  inspectThrows: boolean;
  /** What a fresh inspect of the Body reports. Null: the container is absent. */
  state: ContainerState | null;
  /** The exit codes the whitelist remove one-shot returns, in order. An empty list means every call exits 0. */
  removeCodes: number[];
}

function orphanState(over: Partial<ContainerState> = {}): ContainerState {
  return {
    id: 'cid-orphan',
    running: false,
    helperBody: true,
    owner: 'owner-1',
    managed: true,
    lifeId: LIFE,
    exitCode: ORPHAN_EXIT_CODE,
    ...over,
  };
}

function world(over: Partial<World> = {}): World {
  return {
    onRoster: false,
    rosterThrows: false,
    inspectThrows: false,
    state: orphanState(),
    removeCodes: [],
    ...over,
  };
}

/** The sweep deps over one world. `order` records each whitelist remove and each container remove, in call order. */
function harness(w: World, withRemoval = true) {
  const audit: string[] = [];
  const order: string[] = [];
  const lifeIds: string[] = [];
  const seen = new Set<string>();
  const roster = {
    displayName: async () => {
      if (w.rosterThrows) throw new Error('roster down');
      return w.onRoster ? 'Orphan' : null;
    },
    lifeId: async () => null,
  } as RosterPort;
  const deps: SweepDeps = {
    engine: {
      bodies: async () => [{ name: NAME, owner: 'owner-1', running: w.state?.running === true }],
      inspect: async () => {
        if (w.inspectThrows) throw new Error('inspect down');
        return w.state;
      },
      remove: async (id: string) => {
        order.push(`container ${id}`);
      },
    },
    roster,
    audit: (line) => audit.push(line),
    ...(withRemoval
      ? {
          removal: {
            removeLife: async (lifeId: string) => {
              lifeIds.push(lifeId);
              order.push(`whitelist ${lifeId}`);
              return w.removeCodes.shift() ?? 0;
            },
            seen,
          },
        }
      : {}),
  };
  return { deps, audit, order, lifeIds, seen };
}

describe('stray sweep removal (BH-6)', () => {
  it('removes a managed orphan only on the second consecutive pass, whitelist first, then the container', async () => {
    const w = world();
    const h = harness(w);
    expect(await sweepStrays(h.deps)).toBe(1);
    expect(h.order).toEqual([]);
    expect(await sweepStrays(h.deps)).toBe(0);
    expect(h.order).toEqual([`whitelist ${LIFE}`, 'container cid-orphan']);
    expect(h.audit).toContain(`body-helper orphan_removed name=${NAME} outcome=removed`);
  });

  it('a failed whitelist remove keeps the container, and the confirming pass retries it on the next pass', async () => {
    const h = harness(world({ removeCodes: [1] }));
    await sweepStrays(h.deps);
    await sweepStrays(h.deps);
    expect(h.order).toEqual([`whitelist ${LIFE}`]);
    expect(h.audit).toContain(`body-helper orphan_removal_failed name=${NAME} outcome=failed`);
    await sweepStrays(h.deps);
    expect(h.order).toEqual([`whitelist ${LIFE}`, `whitelist ${LIFE}`, 'container cid-orphan']);
    expect(h.audit).toContain(`body-helper orphan_removed name=${NAME} outcome=removed`);
  });

  it('a failed container remove after a clean whitelist remove is retried on the next pass', async () => {
    const w = world();
    const h = harness(w);
    h.deps.engine.remove = async () => {
      throw new Error('engine down');
    };
    await sweepStrays(h.deps);
    await sweepStrays(h.deps);
    expect(h.audit).toContain(`body-helper orphan_removal_failed name=${NAME} outcome=failed`);
    expect(h.seen.has(NAME)).toBe(true);
  });

  it('a roster read error never removes: the failed pass clears the mark, so the next clean pass only marks again', async () => {
    const w = world();
    const h = harness(w);
    await sweepStrays(h.deps);
    w.rosterThrows = true;
    expect(await sweepStrays(h.deps)).toBe(-1);
    expect(h.audit).toContain(SWEEP_FAILED);
    w.rosterThrows = false;
    await sweepStrays(h.deps);
    expect(h.order).toEqual([]);
    await sweepStrays(h.deps);
    expect(h.order).toEqual([`whitelist ${LIFE}`, 'container cid-orphan']);
  });

  it('a null or throwing container read never removes, on either pass', async () => {
    const absent = harness(world({ state: null }));
    await sweepStrays(absent.deps);
    await sweepStrays(absent.deps);
    expect(absent.order).toEqual([]);
    const thrown = harness(world({ inspectThrows: true }));
    await sweepStrays(thrown.deps);
    expect(await sweepStrays(thrown.deps)).toBeGreaterThanOrEqual(0);
    expect(thrown.order).toEqual([]);
  });

  it.each([
    ['no life label', { lifeId: null }],
    ['no managed label (a legacy or house Body)', { managed: false }],
    ['not a Body-labelled container (an Adam or other container)', { helperBody: false }],
  ])('never removes a container with %s', async (_label, over) => {
    const h = harness(world({ state: orphanState(over) }));
    await sweepStrays(h.deps);
    await sweepStrays(h.deps);
    expect(h.order).toEqual([]);
  });

  it('never removes a Body that is on the roster', async () => {
    const h = harness(world({ onRoster: true }));
    await sweepStrays(h.deps);
    await sweepStrays(h.deps);
    expect(h.order).toEqual([]);
    expect(h.audit.some((line) => line.includes('orphan_removed'))).toBe(false);
  });

  it.each([
    ['exit 1', { exitCode: 1 }],
    ['exit 0 and stopped', { exitCode: 0 }],
    ['running with no exit code', { running: true, exitCode: null }],
    ['exit 137 (killed)', { exitCode: 137 }],
  ])('never removes a Body with %s', async (_label, over) => {
    const h = harness(world({ state: orphanState(over) }));
    await sweepStrays(h.deps);
    await sweepStrays(h.deps);
    expect(h.order).toEqual([]);
  });

  it('a clean pass resets the count: a mark, a clean pass, then a mark is not two in a row', async () => {
    const w = world();
    const h = harness(w);
    await sweepStrays(h.deps);
    w.onRoster = true;
    await sweepStrays(h.deps);
    w.onRoster = false;
    await sweepStrays(h.deps);
    expect(h.order).toEqual([]);
    await sweepStrays(h.deps);
    expect(h.order).toEqual([`whitelist ${LIFE}`, 'container cid-orphan']);
  });

  it('without removal (managed Bodies off) the sweep only reports and never inspects a removal', async () => {
    const h = harness(world(), false);
    await sweepStrays(h.deps);
    expect(await sweepStrays(h.deps)).toBe(1);
    expect(h.order).toEqual([]);
    expect(h.lifeIds).toEqual([]);
    expect(h.audit).toContain(`body-helper stray name=${NAME} outcome=report_only`);
  });
});
