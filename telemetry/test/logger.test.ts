import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.ts';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
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

  it('drops forbidden and unknown fields from the line', () => {
    const lines: string[] = [];
    createLogger({ name: 'test', write: (line) => lines.push(line) }).error('auth', {
      auth_token: 'abc',
      free_text: 'x',
      life_id: 'lf_2',
    });
    const row = JSON.parse(lines[0] ?? '');
    expect(row.auth_token).toBeUndefined();
    expect(row.free_text).toBeUndefined();
    expect(row.life_id).toBe('lf_2');
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
