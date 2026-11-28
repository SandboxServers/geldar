import { logs } from '@opentelemetry/api';
import {
  LoggerProvider,
  type LogRecordProcessor,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowLogKeys } from './attributes.ts';
import { emitLogRecord, isShippedRecord } from './log-records.ts';
import { AllowListLogProcessor } from './sdk-processors.ts';

/** Keeps each record as it is emitted, so a test reads it at once: nothing is queued or exported. */
class CollectingProcessor implements LogRecordProcessor {
  private readonly records: ReadableLogRecord[] = [];

  onEmit(record: ReadableLogRecord): void {
    this.records.push(record);
  }

  getFinishedLogRecords(): ReadableLogRecord[] {
    return this.records;
  }

  async forceFlush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}

let exporter: CollectingProcessor;

// The provider is built as startTelemetry builds it: the MCP extra keys widen the allow-list, and the
// records pass through the real AllowListLogProcessor before they are collected.
beforeEach(() => {
  allowLogKeys(['tool', 'status', 'duration_ms']);
  exporter = new CollectingProcessor();
  const provider = new LoggerProvider({ processors: [new AllowListLogProcessor(exporter)] });
  logs.setGlobalLoggerProvider(provider);
});

afterEach(() => {
  vi.restoreAllMocks();
  logs.disable();
});

const TOKEN = `gmcp-${'ab'.repeat(32)}`;

describe('emitLogRecord', () => {
  it('turns a tool_call line into one INFO record with only its kept fields, and no player id', () => {
    emitLogRecord({
      event: 'tool_call',
      player_id: 'aa',
      tool: 'move',
      outcome: 'ok',
      duration_ms: 12,
    });
    const records = exporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.body).toBe('tool_call');
    expect(records[0]?.severityText).toBe('INFO');
    expect(records[0]?.attributes).toEqual({
      event: 'tool_call',
      tool: 'move',
      outcome: 'ok',
      duration_ms: 12,
    });
  });

  it('turns a 429 refusal line into one WARN record with its status and reason', () => {
    emitLogRecord({ event: 'rate_limited', status: 429, reason: 'rate_limited', player_id: 'aa' });
    const records = exporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.severityText).toBe('WARN');
    expect(records[0]?.attributes).toEqual({
      event: 'rate_limited',
      status: 429,
      reason: 'rate_limited',
    });
  });

  it('sets the severity from the data: 5xx and internal are ERROR, other non-ok outcomes WARN', () => {
    emitLogRecord({ event: 'http', status: 503 });
    emitLogRecord({ event: 'tool_call', outcome: 'internal' });
    emitLogRecord({ event: 'tool_call', outcome: 'bad_cursor' });
    emitLogRecord({ event: 'tool_call', status: 200, outcome: 'ok' });
    expect(exporter.getFinishedLogRecords().map((r) => r.severityText)).toEqual([
      'ERROR',
      'ERROR',
      'WARN',
      'INFO',
    ]);
  });

  it('is WARN for an error with no status, and ERROR for a closed failure event', () => {
    emitLogRecord({ event: 'stream_message_retry', error: 'TypeError' });
    emitLogRecord({ event: 'stop_failed', error: 'Error' });
    emitLogRecord({ event: 'auth_unavailable', error: 'Error', status: 503 });
    expect(exporter.getFinishedLogRecords().map((r) => r.severityText)).toEqual([
      'WARN',
      'ERROR',
      'ERROR',
    ]);
  });

  it('sends the error as error.type, so a token-looking cause never reaches the record', () => {
    emitLogRecord({
      event: 'rate_limited',
      status: 429,
      cause: `Authorization: Bearer ${TOKEN}`,
      error: 'TypeError',
    });
    const [record] = exporter.getFinishedLogRecords();
    expect(record?.attributes).toEqual({
      event: 'rate_limited',
      status: 429,
      'error.type': 'TypeError',
    });
    expect(JSON.stringify(exporter.getFinishedLogRecords())).not.toContain('gmcp-');
  });

  it('drops every key it does not name, suppressed included, and uses a fixed body without an event', () => {
    emitLogRecord({
      event: 'tool_call',
      token: TOKEN,
      headers: { authorization: 'x' },
      body: 'a player said hello',
      address: '203.0.113.7',
      suppressed: 2,
    });
    emitLogRecord({ status: 500, player_name: 'Steve' });
    const records = exporter.getFinishedLogRecords();
    expect(records[0]?.attributes).toEqual({ event: 'tool_call' });
    expect(records[1]?.body).toBe('log');
    expect(records[1]?.attributes).toEqual({ status: 500 });
    expect(JSON.stringify(records)).not.toMatch(/gmcp-|Steve|203\.0\.113|hello|suppressed/);
  });

  it('swallows a failure in the logs API, so the caller never sees an exception', () => {
    vi.spyOn(logs, 'getLogger').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => emitLogRecord({ event: 'tool_call' })).not.toThrow();
    expect(exporter.getFinishedLogRecords()).toHaveLength(0);
  });
});

describe('isShippedRecord', () => {
  it('ships a tool_call line (it has an outcome)', () => {
    expect(isShippedRecord({ event: 'tool_call', tool: 'move', outcome: 'ok' })).toBe(true);
  });

  it('ships a 429 refusal line', () => {
    expect(isShippedRecord({ event: 'rate_limited', status: 429 })).toBe(true);
  });

  it('does not ship a routine request line', () => {
    expect(isShippedRecord({ event: 'session_request', status: 200 })).toBe(false);
  });

  it('does not ship a pre-auth noise line, even with a 4xx status', () => {
    expect(isShippedRecord({ event: 'parse_error', status: 400 })).toBe(false);
  });

  it('ships a line that carries an error', () => {
    expect(isShippedRecord({ event: 'stream_loop_stopped', error: 'TypeError' })).toBe(true);
  });
});
