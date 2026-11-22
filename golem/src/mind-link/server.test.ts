import {
  type PlanAck,
  type PlanMessage,
  planCheckSubject,
  planSubject,
  type Snapshot,
  snapshotSubject,
  surveySubject,
  viewSubject,
  type WorldEvent,
} from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import type { EventPublisher } from '../body/records-nats.ts';
import { SnapshotRevision } from './revision.ts';
import { FakeEars, FakePerception, FakeVoice } from './senses.fakes.ts';
import {
  FakeRequestServer,
  GENERATION,
  LIFE,
  planOf,
  SHARD,
  StubExecutor,
  snapshotFrom,
} from './server.fakes.ts';
import { MindLinkServer } from './server.ts';

class MemoryPublisher implements EventPublisher {
  readonly sent: Array<{ subject: string; event: WorldEvent; msgId: string }> = [];
  async publish(subject: string, body: string, msgId: string): Promise<void> {
    this.sent.push({ subject, event: JSON.parse(body) as WorldEvent, msgId });
  }
}

function rig(tick = 10, build: typeof snapshotFrom = snapshotFrom) {
  const transport = new FakeRequestServer();
  const executor = new StubExecutor();
  const voice = new FakeVoice();
  const ears = new FakeEars();
  const publisher = new MemoryPublisher();
  const revision = new SnapshotRevision();
  const logs: string[] = [];
  const server = new MindLinkServer({
    shard: SHARD,
    lifeId: LIFE,
    bodyGeneration: GENERATION,
    revision,
    server: transport,
    executor,
    perception: new FakePerception(),
    ears,
    voice,
    buildSnapshot: build,
    tick: () => tick,
    publisher,
    log: (line) => logs.push(line),
  });
  server.start();
  const snapshot = async (reason = 'wake'): Promise<Snapshot> => {
    const body = await transport.request(
      snapshotSubject(SHARD, LIFE),
      JSON.stringify({ life_id: LIFE, reason }),
    );
    return JSON.parse(body ?? 'null') as Snapshot;
  };
  const plan = async (message: PlanMessage | string): Promise<PlanAck | null> => {
    const body = await transport.request(
      planSubject(SHARD, LIFE),
      typeof message === 'string' ? message : JSON.stringify(message),
    );
    return body === null ? null : (JSON.parse(body) as PlanAck);
  };
  return { transport, executor, voice, ears, publisher, revision, logs, server, snapshot, plan };
}

describe('SnapshotRevision', () => {
  it('counts up from its start and the getter reads the live value', () => {
    const revision = new SnapshotRevision();
    const read = revision.getter();
    expect(read()).toBe(0);
    expect(revision.next()).toBe(1);
    expect(revision.next()).toBe(2);
    expect(read()).toBe(2);
  });
});

describe('MindLinkServer snapshots', () => {
  it('serves exactly the snapshot, plan, view, survey and plan_check subjects of its life', () => {
    const { transport } = rig();
    expect(transport.subjects.sort()).toEqual(
      [
        snapshotSubject(SHARD, LIFE),
        planSubject(SHARD, LIFE),
        viewSubject(SHARD, LIFE),
        surveySubject(SHARD, LIFE),
        planCheckSubject(SHARD, LIFE),
      ].sort(),
    );
  });

  it('increments the revision on every request', async () => {
    const t = rig();
    expect((await t.snapshot()).revision).toBe(1);
    expect((await t.snapshot()).revision).toBe(2);
    expect(t.revision.current).toBe(2);
  });

  it('carries the generation, the heard lines and the drained events', async () => {
    const t = rig();
    t.ears.lines = [{ from: 'Eve', text: 'hi', age_seconds: 2 }];
    t.ears.queued = [{ type: 'wake' }];
    const first = await t.snapshot();
    expect(first.body_generation).toBe(GENERATION);
    expect(first.heard).toHaveLength(1);
    expect(first.events_since_last_thought).toEqual([{ type: 'wake' }]);
    expect((await t.snapshot()).events_since_last_thought).toEqual([]);
  });

  it('keeps the events of a snapshot that is not built, and sends them with the next one', async () => {
    let broken = true;
    const t = rig(10, (options) => {
      if (broken) throw new Error('perception down');
      return snapshotFrom(options);
    });
    t.ears.queued = [{ type: 'wake' }];
    expect(await t.snapshot()).toBeNull();
    broken = false;
    expect((await t.snapshot()).events_since_last_thought).toEqual([{ type: 'wake' }]);
    expect((await t.snapshot()).events_since_last_thought).toEqual([]);
  });

  it('logs why a snapshot that cannot be built is not sent', async () => {
    const t = rig(10, () => {
      throw new Error('perception down');
    });
    expect(await t.snapshot()).toBeNull();
    expect(t.logs).toContain(
      'mind-link: snapshot_unanswered reason=build_failed error=Error: perception down',
    );
  });

  it('logs the validation errors of a snapshot that is not sent', async () => {
    const t = rig(10, () => ({}) as never);
    expect(await t.snapshot()).toBeNull();
    const line = t.logs.find((entry) =>
      entry.startsWith('mind-link: snapshot_unanswered reason=invalid errors='),
    );
    expect(line).toBeDefined();
    expect(line?.length ?? 0).toBeGreaterThan(
      'mind-link: snapshot_unanswered reason=invalid errors='.length,
    );
  });

  it('does not answer a request for another life, and logs it', async () => {
    const t = rig();
    const body = await t.transport.request(
      snapshotSubject(SHARD, LIFE),
      JSON.stringify({ life_id: 'ag_other_01', reason: 'wake' }),
    );
    expect(body).toBeNull();
    expect(t.revision.current).toBe(0);
    expect(t.logs.join('\n')).toContain('ag_other_01');
  });

  it('reports the running intent as current_plan', async () => {
    const t = rig();
    await t.snapshot();
    t.executor.result = { rejection: null, actions: [], failedAt: null, intent: 'started' };
    await t.plan(
      planOf(1, {
        intent_id: 'in_00000000000000000000000001',
        thought: {
          reasoning: 'r',
          intent: {
            goal: 'find_water',
            program: 'travel',
            arguments: {},
            wake_on: [],
            limits: { max_world_ticks: 100, max_block_operations: 10 },
          },
        },
      }),
    );
    await t.server.idle();
    t.executor.intentState = 'running';
    expect((await t.snapshot()).current_plan).toEqual({
      goal: 'find_water',
      action: 'travel',
      status: 'running',
    });
  });

  it('reports a resumed intent as current_plan, though no plan of this process started it', async () => {
    const t = rig();
    t.executor.intentState = 'running';
    t.executor.runningIntent = {
      goal: 'find_water',
      program: 'travel',
      arguments: {},
      wake_on: [],
      limits: { max_world_ticks: 100, max_block_operations: 10 },
    } as never;
    expect((await t.snapshot()).current_plan).toEqual({
      goal: 'find_water',
      action: 'travel',
      status: 'running',
    });
  });
});

describe('MindLinkServer survey', () => {
  it('logs a survey callback that throws instead of leaving an unhandled rejection', async () => {
    const transport = new FakeRequestServer();
    const logs: string[] = [];
    const server = new MindLinkServer({
      shard: SHARD,
      lifeId: LIFE,
      bodyGeneration: GENERATION,
      revision: new SnapshotRevision(),
      server: transport,
      executor: new StubExecutor(),
      perception: new FakePerception(),
      ears: new FakeEars(),
      voice: new FakeVoice(),
      buildSnapshot: snapshotFrom,
      tick: () => 10,
      publisher: new MemoryPublisher(),
      log: (line) => logs.push(line),
      survey: () => {
        throw new Error('map gone');
      },
    });
    server.start();
    const reply = await transport.request(surveySubject(SHARD, LIFE), JSON.stringify({ box: {} }));
    expect(reply).toBeNull();
    expect(logs).toContainEqual(expect.stringContaining('survey not answered: Error: map gone'));
  });
});

describe('MindLinkServer plans', () => {
  it('refuses a plan made before the Body died as stale_snapshot, and accepts one made after', async () => {
    const t = rig();
    t.executor.deathFloor = 3;
    const before = await t.plan(planOf(1, { snapshot_revision: 3 }));
    expect(before?.accepted).toBe(false);
    expect(before?.rejection?.reason).toBe('stale_snapshot');
    expect(before?.rejection?.detail).toBe(
      'plan revision 3 was made before the Body died at revision 3',
    );
    expect(t.executor.submitted).toHaveLength(0);
    const after = await t.plan(planOf(2, { snapshot_revision: 4 }));
    expect(after?.accepted).toBe(true);
  });

  it('accepts a valid plan, runs it after the ack and publishes the result', async () => {
    const t = rig();
    await t.snapshot();
    const ack = await t.plan(planOf(1));
    expect(ack).toEqual({ thought_id: planOf(1).thought_id, accepted: true, rejection: null });
    await t.server.idle();
    expect(t.executor.submitted).toHaveLength(1);
    expect(t.publisher.sent).toHaveLength(1);
    const sent = t.publisher.sent[0];
    expect(sent?.subject).toBe(`geldar.${SHARD}.plan_result`);
    expect(sent?.msgId).toBe(sent?.event.source_event_id);
    expect(sent?.event.agent_id).toBe(LIFE);
    expect(sent?.event.payload).toMatchObject({ thought_id: planOf(1).thought_id, said: true });
  });

  it('replies before the executor finishes', async () => {
    const t = rig();
    await t.snapshot();
    let release: () => void = () => undefined;
    t.executor.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ack = await t.plan(planOf(1));
    expect(ack?.accepted).toBe(true);
    expect(t.publisher.sent).toEqual([]);
    release();
    await t.server.idle();
    expect(t.publisher.sent).toHaveLength(1);
  });

  it('refuses a plan for another life with a rejecting ack and runs nothing', async () => {
    const t = rig();
    await t.snapshot();
    const ack = await t.plan(planOf(1, { life_id: 'ag_dead_01' }));
    expect(ack?.accepted).toBe(false);
    expect(ack?.rejection?.reason).toBe('wrong_life');
    await t.server.idle();
    expect(t.executor.submitted).toEqual([]);
    expect(t.voice.said).toEqual([]);
  });

  it('refuses a stale generation', async () => {
    const t = rig();
    await t.snapshot();
    const ack = await t.plan(planOf(1, { body_generation: GENERATION - 1 }));
    expect(ack?.rejection?.reason).toBe('stale_generation');
    expect(t.executor.submitted).toEqual([]);
  });

  it('refuses a plan more than two revisions behind and accepts exactly two behind', async () => {
    const t = rig();
    for (let i = 0; i < 3; i++) await t.snapshot();
    expect(t.revision.current).toBe(3);
    expect((await t.plan(planOf(1, { snapshot_revision: 1 })))?.accepted).toBe(true);
    await t.snapshot();
    const ack = await t.plan(planOf(2, { snapshot_revision: 1 }));
    expect(ack?.rejection?.reason).toBe('stale_snapshot');
  });

  it('refuses an expired plan', async () => {
    const t = rig(50);
    await t.snapshot();
    expect((await t.plan(planOf(1, { expires_tick: 50 })))?.rejection?.reason).toBe('expired');
  });

  it('answers a repeated thought_id with the stored ack and runs nothing again', async () => {
    const t = rig();
    await t.snapshot();
    const first = await t.plan(planOf(1));
    await t.server.idle();
    for (let i = 0; i < 4; i++) await t.snapshot();
    const again = await t.plan(planOf(1));
    await t.server.idle();
    expect(again).toEqual(first);
    expect(t.executor.submitted).toHaveLength(1);
    expect(t.voice.said).toHaveLength(1);
    expect(t.publisher.sent).toHaveLength(1);
  });

  it('repeats a stored rejection too', async () => {
    const t = rig();
    await t.snapshot();
    const first = await t.plan(planOf(1, { life_id: 'ag_dead_01' }));
    const again = await t.plan(planOf(1, { life_id: 'ag_dead_01' }));
    expect(again).toEqual(first);
  });

  it('speaks only after an accepted plan', async () => {
    const t = rig();
    await t.snapshot();
    await t.plan(planOf(1, { life_id: 'ag_dead_01' }));
    await t.server.idle();
    expect(t.voice.said).toEqual([]);
    await t.plan(planOf(2));
    await t.server.idle();
    expect(t.voice.said).toEqual(['hello there']);
  });

  it('does not speak when the executor refuses the plan, and reports said false', async () => {
    const t = rig();
    await t.snapshot();
    t.executor.result = {
      rejection: { reason: 'invalid_plan', detail: 'ids do not match' },
      actions: [],
      failedAt: null,
      intent: 'none',
    };
    await t.plan(planOf(1));
    await t.server.idle();
    expect(t.voice.said).toEqual([]);
    expect(t.publisher.sent[0]?.event.payload).toMatchObject({ said: false });
  });

  it('reports said false when the voice refuses', async () => {
    const t = rig();
    await t.snapshot();
    t.voice.outcome = { status: 'refused', reason: 'rate_limited' };
    await t.plan(planOf(1));
    await t.server.idle();
    expect(t.publisher.sent[0]?.event.payload).toMatchObject({ said: false });
  });

  it('rejects a malformed plan that has a thought id, and ignores one that has none', async () => {
    const t = rig();
    const bad = await t.plan(JSON.stringify({ thought_id: planOf(1).thought_id }));
    expect(bad?.rejection?.reason).toBe('invalid_plan');
    expect(await t.plan('not json')).toBeNull();
    expect(t.executor.submitted).toEqual([]);
  });
});
