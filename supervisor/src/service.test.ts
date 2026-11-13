import { describe, expect, it } from 'vitest';
import { FakeWorld } from './fakes.ts';
import { BODY_MEMORY_BYTES, BODY_NANO_CPUS } from './limits.ts';
import type { ControlRequest, LogEvent, Op } from './ports.ts';
import { DAY_MS, HOUR_MS, LOG_TAIL_LIMIT, LOG_TAIL_WINDOW_MS } from './quotas.ts';
import { createSupervisor } from './service.ts';

const A = 'owner-a';
const B = 'owner-b';

function req(op: Op, ownerId: string, agentId: string, playerName: string): ControlRequest {
  return { op, ownerId, agentId, playerName };
}

function setup() {
  const world = new FakeWorld();
  world.addPlayer('Ranger', A);
  world.addPlayer('Scout', B);
  world.addPlayer('Hawk', A);
  world.addPlayer('Wren', A);
  world.addPlayer('Finch', A);
  const sup = createSupervisor(world.deps());
  return { world, sup, handle: (r: ControlRequest) => sup.handle(r) };
}

const start = (agent: string, player: string, owner = A) => req('start', owner, agent, player);
const stop = (agent: string, owner = A) => req('stop', owner, agent, 'Ranger');

describe('association: an owner acts only on their own agents', () => {
  it('owner A stopping owner B agent gets the unknown-agent reply and changes nothing', async () => {
    const { world, handle } = setup();
    expect(await handle(start('agent-b', 'Scout', B))).toEqual({ ok: true, code: 'started' });
    const crossOwner = await handle(stop('agent-b', A));
    const noSuchAgent = await handle(stop('agent-missing', A));
    expect(crossOwner).toEqual(noSuchAgent);
    expect(crossOwner).toEqual({ ok: false, code: 'unknown' });
    expect(world.bodies.get('agent-b')?.running).toBe(true);
    expect(world.startRows).toHaveLength(1);
  });

  it('a start by a non-owner of the player gets the same reply as an unknown player', async () => {
    const { handle } = setup();
    const wrongOwner = await handle(start('agent-x', 'Scout', A));
    const unknownPlayer = await handle(start('agent-y', 'Nobody', A));
    expect(wrongOwner).toEqual(unknownPlayer);
    expect(wrongOwner).toEqual({ ok: false, code: 'unknown' });
  });

  it('a status or logtail request for another owner agent is refused as unknown', async () => {
    const { handle } = setup();
    await handle(start('agent-b', 'Scout', B));
    expect(await handle(req('status', A, 'agent-b', 'Ranger'))).toEqual({
      ok: false,
      code: 'unknown',
    });
    expect(await handle(req('logtail', A, 'agent-b', 'Ranger'))).toEqual({
      ok: false,
      code: 'unknown',
    });
  });
});

describe('roster read from the database', () => {
  it('a player listed only in the database roster can start', async () => {
    const { world, handle } = setup();
    world.addPlayer('NewName', A);
    expect(await handle(start('agent-n', 'NewName'))).toEqual({ ok: true, code: 'started' });
  });

  it('a name the roster does not list is refused for an owner request', async () => {
    const { world, handle } = setup();
    expect(await handle(start('agent-z', 'YamlOnly'))).toEqual({ ok: false, code: 'unknown' });
    expect(world.specs).toHaveLength(0);
  });
});

describe('quotas at the boundary (decision 0170, point 3)', () => {
  it('the third start of an agent in an hour is accepted and the fourth is refused and audited', async () => {
    const { world, handle } = setup();
    for (let i = 0; i < 3; i++) {
      expect(await handle(start('agent-a1', 'Ranger'))).toEqual({ ok: true, code: 'started' });
      expect(await handle(stop('agent-a1'))).toEqual({ ok: true, code: 'stopped' });
    }
    expect(await handle(start('agent-a1', 'Ranger'))).toEqual({ ok: false, code: 'quota' });
    expect(world.startRows).toHaveLength(3);
    const last = world.auditRows.at(-1);
    expect(last?.outcome).toBe('quota');
    expect(last?.detail).toBe('agent_hour');
    expect(last?.admin).toBe(false);
  });

  it('the agent hour window slides: at one hour exactly the old starts no longer count', async () => {
    const { world, handle } = setup();
    for (let i = 0; i < 3; i++) {
      await handle(start('agent-a1', 'Ranger'));
      await handle(stop('agent-a1'));
    }
    world.now = new Date(world.now.getTime() + HOUR_MS - 1000);
    expect(await handle(start('agent-a1', 'Ranger'))).toEqual({ ok: false, code: 'quota' });
    world.now = new Date(world.now.getTime() + 1000);
    expect(await handle(start('agent-a1', 'Ranger'))).toEqual({ ok: true, code: 'started' });
  });

  it('the tenth start of an owner in a day is accepted and the eleventh is refused', async () => {
    const { world, handle } = setup();
    const agents: [string, string][] = [
      ['agent-1', 'Ranger'],
      ['agent-2', 'Hawk'],
      ['agent-3', 'Wren'],
      ['agent-4', 'Finch'],
    ];
    for (const [agent, player] of agents.slice(0, 3)) {
      for (let i = 0; i < 3; i++) {
        expect(await handle(start(agent, player))).toEqual({ ok: true, code: 'started' });
        await handle(stop(agent));
      }
    }
    expect(await handle(start('agent-4', 'Finch'))).toEqual({ ok: true, code: 'started' });
    await handle(stop('agent-4'));
    expect(world.startRows).toHaveLength(10);
    expect(await handle(start('agent-4', 'Finch'))).toEqual({ ok: false, code: 'quota' });
    expect(world.startRows).toHaveLength(10);
    expect(world.auditRows.at(-1)?.detail).toBe('owner_day');
  });

  it('a refused request does not count toward a later start', async () => {
    const { world, handle } = setup();
    for (let i = 0; i < 3; i++) {
      await handle(start('agent-a1', 'Ranger'));
      await handle(stop('agent-a1'));
    }
    for (let i = 0; i < 5; i++) await handle(start('agent-a1', 'Ranger'));
    expect(world.startRows).toHaveLength(3);
  });

  it('stop, status and logtail do not count toward the quotas', async () => {
    const { world, handle } = setup();
    await handle(start('agent-a1', 'Ranger'));
    for (let i = 0; i < 6; i++) {
      await handle(stop('agent-a1'));
      await handle(req('status', A, 'agent-a1', 'Ranger'));
      await handle(req('logtail', A, 'agent-a1', 'Ranger'));
    }
    expect(world.startRows).toHaveLength(1);
  });

  it('a restart that is accepted counts like a start', async () => {
    const { world, handle } = setup();
    await handle(start('agent-a1', 'Ranger'));
    expect(await handle(req('restart', A, 'agent-a1', 'Ranger'))).toEqual({
      ok: true,
      code: 'restarted',
    });
    expect(world.startRows.map((r) => r.op)).toEqual(['start', 'restart']);
    expect(world.stops).toContain('agent-a1');
  });
});

describe('admin owners (decision 0170, point 5)', () => {
  it('an admin is exempt from the hourly agent counter: the fourth start is accepted', async () => {
    const { world, handle } = setup();
    world.admins.add(A);
    for (let i = 0; i < 3; i++) {
      await handle(start('agent-a1', 'Ranger'));
      await handle(stop('agent-a1'));
    }
    expect(await handle(start('agent-a1', 'Ranger'))).toEqual({ ok: true, code: 'started' });
    expect(world.auditRows.at(-1)?.admin).toBe(true);
  });

  it('an admin is exempt from the daily owner counter: the eleventh start is accepted', async () => {
    const { world, handle } = setup();
    world.admins.add(A);
    const agents: [string, string][] = [
      ['agent-1', 'Ranger'],
      ['agent-2', 'Hawk'],
      ['agent-3', 'Wren'],
      ['agent-4', 'Finch'],
    ];
    for (const [agent, player] of agents) {
      for (let i = 0; i < 3; i++) {
        expect(await handle(start(agent, player))).toEqual({ ok: true, code: 'started' });
        await handle(stop(agent));
      }
    }
    expect(world.startRows.length).toBeGreaterThanOrEqual(11);
  });

  it('an admin still gets a refusal for a second running body on one agent', async () => {
    const { world, handle } = setup();
    world.admins.add(A);
    await handle(start('agent-a1', 'Ranger'));
    expect(await handle(start('agent-a1', 'Ranger'))).toEqual({ ok: false, code: 'conflict' });
    expect(world.startRows).toHaveLength(1);
    expect(world.auditRows.at(-1)?.admin).toBe(true);
  });

  it('an admin still gets the unknown-agent reply for another owner agent', async () => {
    const { world, handle } = setup();
    world.admins.add(A);
    await handle(start('agent-b', 'Scout', B));
    expect(await handle(stop('agent-b', A))).toEqual({ ok: false, code: 'unknown' });
    expect(world.bodies.get('agent-b')?.running).toBe(true);
  });

  it('a flag read that errors is treated as not admin: the fourth start is refused', async () => {
    const { world, handle } = setup();
    world.admins.add(A);
    world.adminReadFails = true;
    for (let i = 0; i < 3; i++) {
      await handle(start('agent-a1', 'Ranger'));
      await handle(stop('agent-a1'));
    }
    expect(await handle(start('agent-a1', 'Ranger'))).toEqual({ ok: false, code: 'quota' });
    expect(world.auditRows.at(-1)?.admin).toBe(false);
  });
});

describe('concurrency', () => {
  it('two starts for one agent race and exactly one body starts', async () => {
    const { world, handle } = setup();
    const replies = await Promise.all([
      handle(start('agent-r', 'Ranger')),
      handle(start('agent-r', 'Ranger')),
    ]);
    const codes = replies.map((r) => r.code).sort();
    expect(codes).toEqual(['conflict', 'started']);
    expect(world.specs).toHaveLength(1);
    expect(world.startRows).toHaveLength(1);
  });
});

describe('container config carries the 0082 body limits', () => {
  it('the started body gets 1 CPU and 2048m memory with no extra swap', async () => {
    const { world, handle } = setup();
    await handle(start('agent-c', 'Ranger'));
    expect(world.specs[0]?.config).toEqual({
      NanoCpus: 1_000_000_000,
      Memory: 2048 * 1024 * 1024,
      MemorySwap: 2048 * 1024 * 1024,
    });
    expect(BODY_NANO_CPUS).toBe(1_000_000_000);
    expect(BODY_MEMORY_BYTES).toBe(2048 * 1024 * 1024);
  });
});

describe('abort and error paths', () => {
  it('a Docker error is reported and audited, and keeps no body_ops row', async () => {
    const { world, handle } = setup();
    world.startError = new Error('docker daemon went away');
    expect(await handle(start('agent-e', 'Ranger'))).toEqual({ ok: false, code: 'error' });
    expect(world.startRows).toHaveLength(0);
    expect(world.bodies.get('agent-e')?.running ?? false).toBe(false);
    expect(world.auditRows.at(-1)?.outcome).toBe('error');
  });

  it('a retry after a Docker error starts once and counts once', async () => {
    const { world, handle } = setup();
    world.startError = new Error('docker daemon went away');
    await handle(start('agent-e', 'Ranger'));
    world.startError = null;
    expect(await handle(start('agent-e', 'Ranger'))).toEqual({ ok: true, code: 'started' });
    expect(world.specs).toHaveLength(1);
    expect(world.startRows).toHaveLength(1);
  });

  it('an audit write that fails rejects the request and the owner queue still drains', async () => {
    const { world, handle } = setup();
    world.auditError = new Error('audit table unavailable');
    await expect(handle(start('agent-f', 'Ranger'))).rejects.toThrow('audit table unavailable');
    world.auditError = null;
    expect(await handle(req('status', A, 'agent-f', 'Ranger'))).toEqual({
      ok: true,
      code: 'running',
    });
  });

  it('a malformed request is refused as invalid and audited without a target', async () => {
    const { world, sup } = setup();
    expect(
      await sup.handle({ op: 'shutdown', ownerId: A, agentId: 'x', playerName: 'Ranger' }),
    ).toEqual({
      ok: false,
      code: 'invalid',
    });
    expect(world.auditRows.at(-1)?.action).toBe('body_invalid');
    expect(world.auditRows.at(-1)?.target).toBe('invalid');
  });
});

describe('logtail: 200 events at most, none older than 7 days', () => {
  function events(count: number, ageMs: number, now: Date): LogEvent[] {
    return Array.from({ length: count }, (_, i) => ({
      at: new Date(now.getTime() - ageMs + i),
      code: 'other' as const,
    }));
  }

  it('returns the newest 200 of 300 recent events', async () => {
    const { world, handle } = setup();
    await handle(start('agent-l', 'Ranger'));
    world.logs.set('agent-l', events(300, HOUR_MS, world.now));
    const reply = await handle(req('logtail', A, 'agent-l', 'Ranger'));
    expect(reply.ok && reply.events?.length).toBe(LOG_TAIL_LIMIT);
  });

  it('drops events older than 7 days, keeps the one exactly at 7 days', async () => {
    const { world, handle } = setup();
    await handle(start('agent-l', 'Ranger'));
    const edge = new Date(world.now.getTime() - LOG_TAIL_WINDOW_MS);
    const old = new Date(world.now.getTime() - LOG_TAIL_WINDOW_MS - 1);
    world.logs.set('agent-l', [
      { at: old, code: 'started' },
      { at: edge, code: 'stopped' },
      { at: world.now, code: 'started' },
    ]);
    const reply = await handle(req('logtail', A, 'agent-l', 'Ranger'));
    expect(reply).toEqual({
      ok: true,
      code: 'logs',
      events: [
        { at: edge, code: 'stopped' },
        { at: world.now, code: 'started' },
      ],
    });
    expect(DAY_MS * 7).toBe(LOG_TAIL_WINDOW_MS);
  });
});
