import { describe, expect, it, vi } from 'vitest';
import { defaultStreamSettings, loadStreamSettings, type StreamSettings } from './config.ts';
import { ensureStream } from './consumer.ts';
import { consumingLine } from './main.ts';

const DAY_NS = 24 * 3600 * 1_000_000_000;

/** A JetStream manager fake: `info` resolves or rejects; `add` resolves or rejects. */
function jsmOf(options: { exists: boolean; addError?: Error }) {
  const info = vi.fn(async () => {
    if (!options.exists) throw new Error('stream not found');
    return {};
  });
  const add = vi.fn(async () => {
    if (options.addError) throw options.addError;
    return {};
  });
  return { jsm: { streams: { info, add } } as never, info, add };
}

describe('ensureStream', () => {
  it('leaves an existing stream alone, even one with other limits', async () => {
    const { jsm, add } = jsmOf({ exists: true });
    const nf: StreamSettings = {
      ...defaultStreamSettings(),
      name: 'GELDAR_EVENTS',
      retentionDays: 1,
    };
    await expect(ensureStream(jsm, nf)).resolves.toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });

  it('creates a missing stream with the configured name, filter, retention and cap', async () => {
    const { jsm, add } = jsmOf({ exists: false });
    const stream = loadStreamSettings({
      GELDAR_EVENTS_STREAM: 'GELDAR_EVENTS_NF',
      GELDAR_EVENTS_SUBJECTS: 'geldar.nf.*',
      GELDAR_EVENTS_MAX_AGE_DAYS: '7',
      GELDAR_EVENTS_MAX_BYTES: '1048576',
    });
    await ensureStream(jsm, stream);
    expect(add).toHaveBeenCalledWith({
      name: 'GELDAR_EVENTS_NF',
      subjects: ['geldar.nf.*'],
      storage: 'file',
      retention: 'limits',
      max_age: 7 * DAY_NS,
      max_bytes: 1048576,
    });
  });

  it("creates the default stream with today's limits when nothing is configured", async () => {
    const { jsm, add } = jsmOf({ exists: false });
    await ensureStream(jsm);
    expect(add).toHaveBeenCalledWith({
      name: 'GELDAR_EVENTS',
      subjects: ['geldar.*.*'],
      storage: 'file',
      retention: 'limits',
      max_age: 30 * DAY_NS,
      max_bytes: 2 * 1024 * 1024 * 1024,
    });
  });

  it('resolves when the plugin created the stream between the check and the add', async () => {
    const { jsm, info } = jsmOf({ exists: false, addError: new Error('already exists') });
    info.mockResolvedValueOnce({} as never);
    await expect(ensureStream(jsm)).resolves.toBeUndefined();
  });

  it('rejects with the add error when the stream is still missing', async () => {
    const { jsm } = jsmOf({ exists: false, addError: new Error('insufficient resources') });
    await expect(ensureStream(jsm)).rejects.toThrow('insufficient resources');
  });
});

describe('consume log line', () => {
  it('keeps the text CI greps for on the default stream', () => {
    expect(consumingLine(undefined)).toBe('eventsink: consuming GELDAR_EVENTS');
    expect(consumingLine('GELDAR_EVENTS')).toBe('eventsink: consuming GELDAR_EVENTS');
  });

  it('names the configured stream otherwise', () => {
    expect(consumingLine('GELDAR_EVENTS_NF')).toBe('eventsink: consuming GELDAR_EVENTS_NF');
  });
});
