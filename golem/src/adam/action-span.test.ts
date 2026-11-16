import { startTelemetry, type TelemetryHandle } from '@geldar/telemetry';
import { afterEach, describe, expect, it } from 'vitest';
import { MemorySink, type RecordSink } from '../body/records.ts';
import { ACTION_SPAN_NAME, type ActionTracer, actionSpanSink } from './adam-body.ts';

interface ExportedSpan {
  name: string;
  attributes: Record<string, unknown>;
}

/** An in-memory trace exporter: the SDK's processors run first, then the spans land here. */
function memoryTraces(spans: ExportedSpan[]) {
  return {
    export(batch: ExportedSpan[], done: (result: { code: number }) => void): void {
      spans.push(...batch);
      done({ code: 0 });
    },
    shutdown: async (): Promise<void> => {},
    forceFlush: async (): Promise<void> => {},
  };
}

/** A log or metric exporter that drops everything; the test is about spans only. */
const quietExporter = {
  export(_batch: unknown, done: (result: { code: number }) => void): void {
    done({ code: 0 });
  },
  shutdown: async (): Promise<void> => {},
  forceFlush: async (): Promise<void> => {},
};

// Record shapes as the Body writes them; the sink reads only `id` and `result`.
const running = (action_id: string): never => ({ action_id, state: 'running' }) as never;
const finished = (action_id: string, status: string): never =>
  ({ action_id, state: 'done', result: { status } }) as never;

describe('actionSpanSink: one span per body action', () => {
  let handle: TelemetryHandle | undefined;
  afterEach(async () => {
    await handle?.shutdown();
    handle = undefined;
  });

  /** Starts the SDK with an in-memory trace exporter and no network; returns its tracer. */
  function started(spans: ExportedSpan[]): {
    tracer: ActionTracer;
    flush: () => Promise<void>;
  } {
    handle = startTelemetry({
      service: 'geldar-golem-test',
      version: 'test',
      instanceId: 'test-instance',
      endpoint: 'http://127.0.0.1:4318',
      exporters: {
        traces: memoryTraces(spans) as never,
        logs: quietExporter as never,
        metrics: quietExporter as never,
      },
    });
    const provider = handle.tracerProvider;
    if (provider === undefined) throw new Error('telemetry did not start');
    return { tracer: provider.getTracer('geldar-golem-test'), flush: () => provider.forceFlush() };
  }

  it('gives exactly one span per action outcome, with only action_id and outcome', async () => {
    const spans: ExportedSpan[] = [];
    const { tracer, flush } = started(spans);
    const sink = actionSpanSink(new MemorySink(), tracer);
    sink.actionChanged(running('a1'));
    sink.actionChanged(finished('a1', 'completed'));
    await flush();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe(ACTION_SPAN_NAME);
    // Exactly these keys: no player, life, token, thought, chat or speech text.
    expect(spans[0]?.attributes).toEqual({ action_id: 'a1', outcome: 'completed' });
  });

  it('still gives one span when the only record is the terminal one', async () => {
    const spans: ExportedSpan[] = [];
    const { tracer, flush } = started(spans);
    actionSpanSink(new MemorySink(), tracer).actionChanged(finished('a9', 'failed'));
    await flush();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes).toEqual({ action_id: 'a9', outcome: 'failed' });
  });

  it('labels a status outside the closed set as other', async () => {
    const spans: ExportedSpan[] = [];
    const { tracer, flush } = started(spans);
    actionSpanSink(new MemorySink(), tracer).actionChanged(finished('a2', 'a free text status'));
    await flush();
    expect(spans[0]?.attributes).toEqual({ action_id: 'a2', outcome: 'other' });
  });

  it('gives each action its own span and no span while it is still running', async () => {
    const spans: ExportedSpan[] = [];
    const { tracer, flush } = started(spans);
    const sink = actionSpanSink(new MemorySink(), tracer);
    sink.actionChanged(running('a1'));
    sink.actionChanged(running('a2'));
    await flush();
    expect(spans).toHaveLength(0);
    sink.actionChanged(finished('a2', 'completed'));
    sink.actionChanged(finished('a1', 'cancelled'));
    await flush();
    expect(spans.map((s) => s.attributes.action_id)).toEqual(['a2', 'a1']);
    expect(spans.map((s) => s.attributes.outcome)).toEqual(['completed', 'cancelled']);
  });

  it('passes every record on to the inner sink, in order', () => {
    const inner = new MemorySink();
    const sink: RecordSink = actionSpanSink(inner, {
      startSpan: () => ({ setAttribute: () => undefined, end: () => undefined }),
    });
    sink.actionChanged(running('a1'));
    sink.actionChanged(finished('a1', 'completed'));
    expect(inner.actions.map((a) => a.action_id)).toEqual(['a1', 'a1']);
  });

  it('keeps the record flowing when the tracer throws', () => {
    const inner = new MemorySink();
    const broken: ActionTracer = {
      startSpan: () => {
        throw new Error('exporter gone');
      },
    };
    const sink = actionSpanSink(inner, broken);
    expect(() => sink.actionChanged(finished('a3', 'completed'))).not.toThrow();
    expect(inner.actions.map((a) => a.action_id)).toEqual(['a3']);
  });

  it('with no endpoint the SDK starts no provider, so the Body has no tracer', () => {
    handle = startTelemetry({ service: 'geldar-golem-test', version: 'test' });
    expect(handle.enabled).toBe(false);
    expect(handle.tracerProvider).toBeUndefined();
  });
});

interface FakeSpan extends ActionSpan {
  attrs: Record<string, string>;
  ends: number;
}

/** A tracer that keeps every span it starts: the attributes set on it, and how many times it ended. */
function countingTracer(throwOn: (key: string, index: number) => boolean = () => false): {
  tracer: ActionTracer;
  spans: FakeSpan[];
} {
  const spans: FakeSpan[] = [];
  const tracer: ActionTracer = {
    startSpan: () => {
      const index = spans.length;
      const span: FakeSpan = {
        attrs: {},
        ends: 0,
        setAttribute(key, value) {
          if (throwOn(key, index)) throw new Error('attribute refused');
          span.attrs[key] = value;
          return undefined;
        },
        end() {
          span.ends += 1;
        },
      };
      spans.push(span);
      return span;
    },
  };
  return { tracer, spans };
}

describe('actionSpanSink: the open-span cap and the lifecycle', () => {
  const CAP = 256;
  const runningIds = (from: number, to: number): never[] =>
    Array.from({ length: to - from }, (_, i) => running(`r${from + i}`));

  it('traces up to the cap with every span still open', () => {
    const { tracer, spans } = countingTracer();
    const sink = actionSpanSink(new MemorySink(), tracer);
    for (const record of runningIds(0, CAP)) sink.actionChanged(record);
    expect(spans).toHaveLength(CAP);
    expect(spans.every((span) => span.ends === 0)).toBe(true);
  });

  it('ends and evicts the oldest open span as other when the 257th action starts', () => {
    const { tracer, spans } = countingTracer();
    const lines: string[] = [];
    const sink = actionSpanSink(new MemorySink(), tracer, (line) => lines.push(line));
    for (const record of runningIds(0, CAP)) sink.actionChanged(record);
    sink.actionChanged(running('r256'));
    expect(spans).toHaveLength(CAP + 1);
    expect(spans[0]?.attrs).toEqual({ action_id: 'r0', outcome: 'other' });
    expect(spans[0]?.ends).toBe(1);
    expect(spans.slice(1, CAP).every((span) => span.ends === 0)).toBe(true);
    // One line for the first eviction; the next eviction does not log again.
    expect(lines).toHaveLength(1);
    sink.actionChanged(running('r257'));
    expect(spans[1]?.attrs).toEqual({ action_id: 'r1', outcome: 'other' });
    expect(spans[1]?.ends).toBe(1);
    expect(lines).toHaveLength(1);
  });

  it('traces new actions again once the open ones finish (the entries are removed)', () => {
    const { tracer, spans } = countingTracer();
    const sink = actionSpanSink(new MemorySink(), tracer);
    for (const record of runningIds(0, CAP)) sink.actionChanged(record);
    // r0 stays open; r1 to r255 finish.
    for (let i = 1; i < CAP; i += 1) sink.actionChanged(finished(`r${i}`, 'completed'));
    expect(spans.slice(1).every((span) => span.ends === 1)).toBe(true);
    sink.actionChanged(running('x'));
    sink.actionChanged(finished('x', 'completed'));
    expect(spans).toHaveLength(CAP + 1);
    expect(spans[CAP]?.attrs).toEqual({ action_id: 'x', outcome: 'completed' });
    // r0 was never evicted: no outcome, one end is still owed. Every other span ends exactly once.
    expect(spans[0]?.attrs).toEqual({ action_id: 'r0' });
    expect(spans[0]?.ends).toBe(0);
    expect(spans.slice(1).every((span) => span.ends === 1)).toBe(true);
  });

  it('gives a terminal-only record past the cap its own span, without evicting', () => {
    const { tracer, spans } = countingTracer();
    const lines: string[] = [];
    const inner = new MemorySink();
    const sink = actionSpanSink(inner, tracer, (line) => lines.push(line));
    for (const record of runningIds(0, CAP)) sink.actionChanged(record);
    sink.actionChanged(finished('t1', 'completed'));
    expect(spans).toHaveLength(CAP + 1);
    expect(spans[CAP]?.attrs).toEqual({ action_id: 't1', outcome: 'completed' });
    expect(spans[CAP]?.ends).toBe(1);
    expect(spans[0]?.ends).toBe(0);
    expect(lines).toHaveLength(0);
    expect(inner.actions.at(-1)?.action_id).toBe('t1');
  });

  it('does not leave the entry open when setAttribute(action_id) throws', () => {
    const { tracer, spans } = countingTracer((key, index) => key === 'action_id' && index === 0);
    const inner = new MemorySink();
    const sink = actionSpanSink(inner, tracer);
    expect(() => sink.actionChanged(running('bad'))).not.toThrow();
    expect(inner.actions.map((a) => a.action_id)).toEqual(['bad']);
    expect(spans[0]?.ends).toBe(1);
    // The failed span is not in the map, so a later terminal record starts a fresh span.
    sink.actionChanged(finished('bad', 'failed'));
    expect(spans).toHaveLength(2);
    expect(spans[1]?.attrs).toEqual({ action_id: 'bad', outcome: 'failed' });
  });

  it('removes the entry and ends the span when setAttribute(outcome) throws', () => {
    const { tracer, spans } = countingTracer((key) => key === 'outcome');
    const sink = actionSpanSink(new MemorySink(), tracer);
    sink.actionChanged(running('o1'));
    expect(() => sink.actionChanged(finished('o1', 'completed'))).not.toThrow();
    expect(spans[0]?.ends).toBe(1);
    // The entry is gone, so the next record for the same id starts a new span.
    sink.actionChanged(running('o1'));
    expect(spans).toHaveLength(2);
  });
});
