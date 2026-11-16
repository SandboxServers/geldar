import { context, logs, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.ts';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

interface Exported {
  body: string;
  attributes: Record<string, unknown>;
}

// Fake OTLP sink: every emitted log record lands in `exported`. Nothing touches the network.
const exported: Exported[] = [];
const fakeProvider = {
  getLogger: () => ({
    emit: (record: Exported) => {
      exported.push({ body: record.body, attributes: { ...record.attributes } });
    },
  }),
};

async function otlpFor(body: string): Promise<Exported | undefined> {
  return exported.find((r) => r.body === body);
}

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  logs.setGlobalLoggerProvider(
    fakeProvider as unknown as Parameters<typeof logs.setGlobalLoggerProvider>[0],
  );
});

beforeEach(() => {
  exported.length = 0;
});

describe('createLogger', () => {
  it('writes one JSON line and stamps trace and span ids from the active span', () => {
    const lines: string[] = [];
    const log = createLogger({ name: 'test', write: (line) => lines.push(line) });
    const ctx = trace.setSpan(
      ROOT_CONTEXT,
      trace.wrapSpanContext({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 }),
    );
    context.with(ctx, () => log.info('turn_done', { life_id: 'lf_1' }));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      event: 'turn_done',
      level: 'info',
      life_id: 'lf_1',
      trace_id: TRACE_ID,
      span_id: SPAN_ID,
    });
  });

  it('writes no ids when no span is active', () => {
    const lines: string[] = [];
    createLogger({ name: 'test', write: (line) => lines.push(line) }).warn('plain');
    const row = JSON.parse(lines[0] ?? '');
    expect(row.trace_id).toBeUndefined();
    expect(row.span_id).toBeUndefined();
    expect(row.level).toBe('warn');
  });

  it('keeps every caller field on stdout except forbidden names', () => {
    const lines: string[] = [];
    createLogger({ name: 'test', write: (line) => lines.push(line) }).error('auth', {
      auth_token: 'abc',
      api_key: 'abc',
      password: 'abc',
      email: 'redacted',
      free_text: 'x',
      life_id: 'lf_2',
    });
    const row = JSON.parse(lines[0] ?? '');
    expect(row.auth_token).toBeUndefined();
    expect(row.api_key).toBeUndefined();
    expect(row.password).toBeUndefined();
    expect(row.email).toBeUndefined();
    expect(row.free_text).toBe('x');
    expect(row.life_id).toBe('lf_2');
  });

  it('keeps tool, duration_ms, status and uptime_ms on stdout', () => {
    const lines: string[] = [];
    createLogger({ name: 'test', write: (line) => lines.push(line) }).info('tool_done', {
      tool: 'move',
      duration_ms: 12,
      status: 'ok',
      uptime_ms: 3400,
    });
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      tool: 'move',
      duration_ms: 12,
      status: 'ok',
      uptime_ms: 3400,
    });
  });

  it('never sends forbidden names to stdout or to OTLP', async () => {
    const lines: string[] = [];
    createLogger({ name: 'test', write: (line) => lines.push(line) }).info('secret_event', {
      auth_token: 'abc',
      client_secret: 'abc',
      session_id: 'abc',
      life_id: 'lf_5',
    });
    const row = JSON.parse(lines[0] ?? '');
    expect(row.auth_token).toBeUndefined();
    expect(row.client_secret).toBeUndefined();
    expect(row.session_id).toBeUndefined();
    const record = await otlpFor('secret_event');
    expect(record).toBeDefined();
    expect(record?.attributes.auth_token).toBeUndefined();
    expect(record?.attributes.client_secret).toBeUndefined();
    expect(record?.attributes.session_id).toBeUndefined();
    expect(record?.attributes.life_id).toBe('lf_5');
  });

  it('keeps free_text off OTLP unless the service lists it in extraKeys, and always on stdout', async () => {
    // extraKeys is process-wide, so the no-extraKeys case runs first.
    const lines: string[] = [];
    const write = (line: string) => lines.push(line);
    createLogger({ name: 'test', write }).info('note_plain', { free_text: 'x' });
    expect(JSON.parse(lines[0] ?? '').free_text).toBe('x');
    const plain = await otlpFor('note_plain');
    expect(plain).toBeDefined();
    expect(plain?.attributes.free_text).toBeUndefined();

    createLogger({ name: 'test', write, extraKeys: ['free_text'] }).info('note_extra', {
      free_text: 'y',
    });
    expect(JSON.parse(lines[1] ?? '').free_text).toBe('y');
    const extra = await otlpFor('note_extra');
    expect(extra?.attributes.free_text).toBe('y');
  });

  it('emits an OTLP record with allow-listed attributes, including total tokens', async () => {
    createLogger({ name: 'test', write: () => {} }).info('turn_done', {
      life_id: 'lf_4',
      'gen_ai.usage.total_tokens': 42,
      unlisted_field: 'z',
      auth_token: 'abc',
    });
    const record = await otlpFor('turn_done');
    expect(record?.attributes).toMatchObject({
      event: 'turn_done',
      life_id: 'lf_4',
      'gen_ai.usage.total_tokens': 42,
    });
    expect(record?.attributes.unlisted_field).toBeUndefined();
    expect(record?.attributes.auth_token).toBeUndefined();
  });

  it('never throws, even when the sink fails or a field getter throws', () => {
    const log = createLogger({
      name: 'test',
      write: () => {
        throw new Error('sink down');
      },
    });
    expect(() => log.info('x', { life_id: 'lf' })).not.toThrow();
    const bad = {};
    Object.defineProperty(bad, 'life_id', {
      enumerable: true,
      get() {
        throw new Error('getter');
      },
    });
    expect(() => log.info('y', bad as Record<string, string>)).not.toThrow();
  });
});
