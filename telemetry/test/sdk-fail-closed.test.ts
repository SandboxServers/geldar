import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace';
import { describe, expect, it } from 'vitest';
import { AllowListLogProcessor, AllowListSpanProcessor } from '../src/sdk-processors.ts';

type Bag = Record<string, unknown>;

// Throws on the first key listing only: the filter fails, and the clean-up that follows can succeed.
function throwOnceBag(entries: Bag): Bag {
  let listings = 0;
  return new Proxy(entries, {
    ownKeys(target) {
      listings += 1;
      if (listings === 1) throw new Error('boom');
      return Reflect.ownKeys(target);
    },
  });
}

// Records whatever the wrapped processor receives.
function sink<T>(into: T[]) {
  return {
    onStart() {},
    onEnd(item: T) {
      into.push(item);
    },
    onEmit(item: T) {
      into.push(item);
    },
    forceFlush: async () => {},
    shutdown: async () => {},
  };
}

describe('span processor fails closed', () => {
  it('clears attributes and still exports the span when the filter throws', () => {
    const exported: ReadableSpan[] = [];
    const processor = new AllowListSpanProcessor(sink(exported) as unknown as SpanProcessor);
    const span = {
      name: 'fake',
      attributes: throwOnceBag({ password: 'hunter2', life_id: 'lf_9' }),
      events: [],
      links: [],
    };
    processor.onEnd(span as unknown as ReadableSpan);
    expect(exported).toHaveLength(1);
    expect(Object.keys(exported[0]?.attributes ?? {})).toEqual([]);
  });

  it('drops the span when its attributes are frozen and cannot be cleared', () => {
    const exported: ReadableSpan[] = [];
    const processor = new AllowListSpanProcessor(sink(exported) as unknown as SpanProcessor);
    const span = {
      name: 'fake',
      attributes: Object.freeze({ password: 'hunter2' }),
      events: [],
      links: [],
    };
    processor.onEnd(span as unknown as ReadableSpan);
    expect(exported).toHaveLength(0);
  });
});

describe('log processor fails closed', () => {
  it('clears record attributes and still emits when the filter throws', () => {
    const emitted: Array<{ attributes: Bag }> = [];
    const processor = new AllowListLogProcessor(sink(emitted) as unknown as LogRecordProcessor);
    processor.onEmit({
      attributes: throwOnceBag({ password: 'hunter2', life_id: 'lf_9' }),
    } as never);
    expect(emitted).toHaveLength(1);
    expect(Object.keys(emitted[0]?.attributes ?? {})).toEqual([]);
  });

  it('drops the record when its attributes are frozen and cannot be cleared', () => {
    const emitted: Array<{ attributes: Bag }> = [];
    const processor = new AllowListLogProcessor(sink(emitted) as unknown as LogRecordProcessor);
    processor.onEmit({ attributes: Object.freeze({ password: 'hunter2' }) } as never);
    expect(emitted).toHaveLength(0);
  });
});
