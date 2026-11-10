import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKOFF_INITIAL_MS,
  DEFAULT_BACKOFF_MAX_MS,
  jitteredDelay,
} from '../src/thinker.ts';
import { type FakeMind, type FakeOllama, until } from './thinker.fakes.ts';
import { answer, type Rig, startRig } from './thinker.fixture.ts';

let rig: Rig;
let mind: FakeMind;
let ollama: FakeOllama;
let logs: string[];
let launch: Rig['launch'];

beforeEach(async () => {
  rig = await startRig();
  ({ mind, ollama, logs, launch } = rig);
});

afterEach(async () => {
  await rig.close();
});
describe('reconnect backoff', () => {
  it('starts at 250 ms and caps at 5 s by default, with jitter between half and all of each step', () => {
    expect(DEFAULT_BACKOFF_INITIAL_MS).toBe(250);
    expect(DEFAULT_BACKOFF_MAX_MS).toBe(5000);
    expect(jitteredDelay(250, () => 0)).toBe(125);
    expect(jitteredDelay(250, () => 0.999999)).toBe(249);
    expect(jitteredDelay(5000, () => 0.5)).toBe(3750);
  });

  it('doubles each failed attempt up to the cap, and logs each with its delay', async () => {
    launch({ wsUrl: 'ws://127.0.0.1:1/v1/thinker/stream', random: () => 1 });
    await until(() => logs.filter((l) => l.startsWith('reconnecting')).length >= 4, 'four retries');
    expect(logs.filter((l) => l.startsWith('reconnecting')).slice(0, 4)).toEqual([
      'reconnecting in 30 ms',
      'reconnecting in 60 ms',
      'reconnecting in 120 ms',
      'reconnecting in 120 ms',
    ]);
    expect(logs.some((l) => l.startsWith('connecting to ws://'))).toBe(true);
    expect(logs.some((l) => l.startsWith('connection failed'))).toBe(true);
  });

  it('applies the jitter to the delay', async () => {
    launch({ wsUrl: 'ws://127.0.0.1:1/v1/thinker/stream', random: () => 0 });
    await until(() => logs.some((l) => l.startsWith('reconnecting')), 'a retry');
    expect(logs.find((l) => l.startsWith('reconnecting'))).toBe('reconnecting in 15 ms');
  });

  it('logs the connect, the hello, the welcome and the close with its reason', async () => {
    const t = launch();
    await mind.next('hello');
    await until(() => t.welcomes === 1, 'the welcome');
    mind.push({ type: 'drain', reconnect_after_seconds: 0 });
    await until(() => logs.some((l) => l.startsWith('closed (')), 'the close');
    expect(logs.some((l) => l.startsWith('connecting to ws://'))).toBe(true);
    expect(logs.some((l) => l.startsWith('connected; sending hello'))).toBe(true);
    expect(logs.some((l) => l.startsWith('welcomed; accepted 1'))).toBe(true);
    expect(logs.find((l) => l.startsWith('closed ('))).toMatch(
      /code 1000, reason "drain"\) \(was welcomed\)/,
    );
  });
});

describe('connection', () => {
  it('sends hello with the advertised models, then serves after welcome and heartbeats', async () => {
    launch({ heartbeatMs: 40 });
    const hello = await mind.next('hello');
    expect(hello).toEqual({
      type: 'hello',
      thinker_version: '1.2.3',
      models: [{ name: 'qwen3:8b', max_concurrent: 1, max_tokens: 2048 }],
    });
    const beat = await mind.next('heartbeat');
    expect(beat.load).toEqual({ 'qwen3:8b': 0 });
  });

  it('sends the configured token in hello and never logs it', async () => {
    const token = 'lantern-test-token-value';
    launch({ token });
    const hello = await mind.next('hello');
    expect(hello.token).toBe(token);
    expect(logs.every((line) => !line.includes(token))).toBe(true);
  });

  it('sends no token field when none is configured', async () => {
    launch();
    const hello = await mind.next('hello');
    expect(hello).not.toHaveProperty('token');
  });

  it('closes and reconnects when no welcome arrives in time', async () => {
    mind.autoWelcome = false;
    launch({ helloTimeoutMs: 50 });
    await until(() => mind.connections >= 2, 'a second connection');
  });

  it('ignores a job that arrives before welcome', async () => {
    mind.autoWelcome = false;
    const t = launch();
    await mind.next('hello');
    mind.push(mind.job());
    await until(() => t.droppedFrames === 1, 'the early job to be dropped');
    expect(ollama.requests).toHaveLength(0);
  });

  it('drains: closes, then reconnects after the given delay', async () => {
    launch();
    await mind.next('hello');
    const before = Date.now();
    mind.push({ type: 'drain', reconnect_after_seconds: 0 });
    await until(() => mind.connections === 2, 'the reconnect');
    expect(Date.now() - before).toBeLessThan(2000);
    await until(
      () => mind.frames.filter((f) => f.type === 'hello').length === 2,
      'the second hello',
    );
    expect(mind.frames.filter((f) => f.type === 'hello')).toHaveLength(2);
  });

  it('waits the whole drain delay before reconnecting', async () => {
    launch();
    await mind.next('hello');
    mind.push({ type: 'drain', reconnect_after_seconds: 1 });
    await new Promise((r) => setTimeout(r, 400));
    expect(mind.connections).toBe(1);
    await until(() => mind.connections === 2, 'the reconnect after the delay');
  });

  it('sends goodbye{shutdown} on stop', async () => {
    const t = launch();
    await mind.next('hello');
    await until(() => t.welcomes === 1, 'the welcome');
    await t.stop();
    expect(await mind.next('goodbye')).toEqual({ type: 'goodbye', reason: 'shutdown' });
  });

  it('drops an invalid inbound frame, counts it, and keeps serving', async () => {
    ollama.handler = (_r, res) => ollama.reply(res, answer);
    const t = launch();
    await mind.next('hello');
    await until(() => t.welcomes === 1, 'the welcome');
    mind.push('not json');
    mind.push({ type: 'job', job_id: 'nope' });
    mind.push({ type: 'cancel', job_id: 'jb_01HZXY0000000000000000AAAA', extra: 1 });
    await until(() => t.droppedFrames === 3, 'three dropped frames');
    mind.push(mind.job());
    expect((await mind.next('completion')).text).toBe('{"ok":true}');
  });

  it('escapes and cuts a hostile property name in the log line of a dropped frame', async () => {
    const hostile = `evil\n${'z'.repeat(2000)}`;
    const t = launch();
    await mind.next('hello');
    await until(() => t.welcomes === 1, 'the welcome');
    mind.push(mind.job({ [hostile]: 1 }));
    await until(() => t.droppedFrames === 1, 'the dropped frame');
    const line = logs.find((l) => l.startsWith('dropped an inbound frame'));
    expect(line).toBeDefined();
    expect(line?.includes('\n')).toBe(false);
    expect(line?.length ?? Infinity).toBeLessThan(300);
  });
});
