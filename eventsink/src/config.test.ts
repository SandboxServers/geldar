import { describe, expect, it } from 'vitest';
import {
  CONSUMER_NAME,
  loadConfig,
  loadServedShard,
  loadStreamSettings,
  STREAM_CONFIG,
} from './config.ts';

const PASSWORD_ENV = { POSTGRES_PASSWORD_FILE: '/run/secrets/postgres' };
const readPassword = (): string => 'pw\n';

// The values every sink ran with before the per-shard keys existed. Changing one changes colo.
const OLD_STREAM = {
  name: 'GELDAR_EVENTS',
  subjects: ['geldar.*.*'],
  storage: 'file',
  retentionDays: 30,
  maxBytes: 2147483648,
};

describe('defaults equal the values colo runs with', () => {
  it('pins the stream, the consumer name and every setting', () => {
    expect(STREAM_CONFIG).toEqual(OLD_STREAM);
    expect(CONSUMER_NAME).toBe('eventsink');
    expect(loadStreamSettings({})).toEqual(OLD_STREAM);
    expect(loadServedShard({})).toBeUndefined();
    const config = loadConfig(PASSWORD_ENV, readPassword);
    expect(config).toEqual({
      natsUrl: 'nats://127.0.0.1:4222',
      pg: {
        host: '127.0.0.1',
        port: 5432,
        user: 'geldar',
        database: 'geldar',
        password: 'pw',
      },
      batchSize: 50,
      fetchWaitMs: 1000,
      stream: OLD_STREAM,
      servedShard: undefined,
    });
  });

  it('treats an empty value as unset', () => {
    const env = {
      ...PASSWORD_ENV,
      GELDAR_EVENTS_STREAM: '',
      GELDAR_EVENTS_SUBJECTS: '',
      GELDAR_EVENTS_MAX_AGE_DAYS: '',
      GELDAR_EVENTS_MAX_BYTES: '',
      GELDAR_EVENTSINK_SHARD: '',
    };
    expect(loadStreamSettings(env)).toEqual(OLD_STREAM);
    expect(loadServedShard(env)).toBeUndefined();
  });
});

describe('stream settings', () => {
  it('reads each per-shard key', () => {
    expect(
      loadStreamSettings({
        GELDAR_EVENTS_STREAM: 'GELDAR_EVENTS_NF',
        GELDAR_EVENTS_SUBJECTS: 'geldar.nf.*',
        GELDAR_EVENTS_MAX_AGE_DAYS: '7',
        GELDAR_EVENTS_MAX_BYTES: '1048576',
      }),
    ).toEqual({
      name: 'GELDAR_EVENTS_NF',
      subjects: ['geldar.nf.*'],
      storage: 'file',
      retentionDays: 7,
      maxBytes: 1048576,
    });
  });

  it('accepts the retention bounds', () => {
    expect(loadStreamSettings({ GELDAR_EVENTS_MAX_AGE_DAYS: '1' }).retentionDays).toBe(1);
    expect(loadStreamSettings({ GELDAR_EVENTS_MAX_AGE_DAYS: '3650' }).retentionDays).toBe(3650);
    expect(loadStreamSettings({ GELDAR_EVENTS_MAX_BYTES: '1048576' }).maxBytes).toBe(1048576);
  });

  it.each(['bad name', 'a.b', 'a*', 'a/b', 'x'.repeat(65)])(
    'refuses the stream name %j',
    (name) => {
      expect(() => loadStreamSettings({ GELDAR_EVENTS_STREAM: name })).toThrow(
        'GELDAR_EVENTS_STREAM must be',
      );
    },
  );

  it.each(['geldar.*.*.*', 'other.nf.*', 'geldar.nf', 'geldar.nf.>', 'geldar.nf.x y', 'geldar..x'])(
    'refuses the subject filter %j',
    (subjects) => {
      expect(() => loadStreamSettings({ GELDAR_EVENTS_SUBJECTS: subjects })).toThrow(
        'GELDAR_EVENTS_SUBJECTS must be',
      );
    },
  );

  it.each(['0', '-1', '1.5', 'abc', '3651'])('refuses the retention %j days', (days) => {
    expect(() => loadStreamSettings({ GELDAR_EVENTS_MAX_AGE_DAYS: days })).toThrow(
      'GELDAR_EVENTS_MAX_AGE_DAYS must be a whole number',
    );
  });

  it.each(['1023', '2.5', '1099511627777'])('refuses the byte cap %j', (bytes) => {
    expect(() => loadStreamSettings({ GELDAR_EVENTS_MAX_BYTES: bytes })).toThrow(
      'GELDAR_EVENTS_MAX_BYTES must be a whole number',
    );
  });

  it('refuses a bad stream setting at start-up, before any connection', () => {
    expect(() =>
      loadConfig({ ...PASSWORD_ENV, GELDAR_EVENTS_MAX_AGE_DAYS: '0' }, readPassword),
    ).toThrow('GELDAR_EVENTS_MAX_AGE_DAYS');
  });

  it('keeps the old message for the old integer keys', () => {
    expect(() => loadConfig({ ...PASSWORD_ENV, EVENTSINK_BATCH_SIZE: '0' }, readPassword)).toThrow(
      'EVENTSINK_BATCH_SIZE must be a positive integer',
    );
  });
});

describe('served shard', () => {
  it.each(['nf', 'colo', 'nf-scratch', 'ab'])('accepts the shard token %j', (token) => {
    expect(loadServedShard({ GELDAR_EVENTSINK_SHARD: token })).toBe(token);
  });

  it.each(['N', 'NF', 'nf_x', 'nf.x', '1nf', 'a', 'a'.repeat(33), 'nf scratch'])(
    'refuses the shard %j',
    (token) => {
      expect(() => loadServedShard({ GELDAR_EVENTSINK_SHARD: token })).toThrow(
        'GELDAR_EVENTSINK_SHARD must be a shard token',
      );
    },
  );

  it('is read into the configuration', () => {
    const config = loadConfig({ ...PASSWORD_ENV, GELDAR_EVENTSINK_SHARD: 'nf' }, readPassword);
    expect(config.servedShard).toBe('nf');
  });

  it('refuses a bad shard at start-up', () => {
    expect(() =>
      loadConfig({ ...PASSWORD_ENV, GELDAR_EVENTSINK_SHARD: 'NF' }, readPassword),
    ).toThrow('GELDAR_EVENTSINK_SHARD');
  });
});
