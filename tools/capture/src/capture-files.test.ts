import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  captureFileName,
  DEFAULT_OUT_DIR,
  DEFAULT_SUBJECTS,
  DEFAULT_URL,
  indexLine,
  metaFileName,
  parseCaptureArgs,
  readCaptureMetas,
  writeCapture,
} from './capture-files.ts';

// No network here: the subscriber's connection is never opened by these tests.
let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'cap1-files-'));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('file naming', () => {
  it('pads the sequence to six digits and writes the subject with its dots as dashes', () => {
    expect(captureFileName(12, 'geldar.phase0.provenance.break')).toBe(
      '000012-geldar-phase0-provenance-break.json',
    );
    expect(captureFileName(1234567, 'geldar.phase0.combat_fact')).toBe(
      '1234567-geldar-phase0-combat_fact.json',
    );
  });

  it('names the sidecar of a payload with .meta.json in place of .json', () => {
    expect(metaFileName('000012-geldar-phase0-provenance-break.json')).toBe(
      '000012-geldar-phase0-provenance-break.meta.json',
    );
  });
});

describe('index.jsonl lines', () => {
  it('is one JSON object per line, newline included, and parses back to the metadata', () => {
    const meta = {
      seq: 3,
      subject: 'geldar.phase0.combat_fact',
      received_at: '2026-11-19T12:00:00.000Z',
      bytes: 5,
      file: '000003-geldar-phase0-combat_fact.json',
    };
    const line = indexLine(meta);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.indexOf('\n')).toBe(line.length - 1);
    expect(JSON.parse(line)).toEqual(meta);
  });
});

describe('writeCapture', () => {
  it('writes the message bytes unchanged, a sidecar, and an index line per message', () => {
    const dir = join(root, 'raw');
    const bytes = Buffer.from([0xff, 0x00, 0x7b, 0x0a, 0x7d, 0x0a]); // not valid UTF-8 JSON: must still be kept as is
    const meta = writeCapture(
      dir,
      7,
      'geldar.phase0.provenance.take',
      bytes,
      new Date('2026-11-19T12:00:00Z'),
    );
    expect(meta).toEqual({
      seq: 7,
      subject: 'geldar.phase0.provenance.take',
      received_at: '2026-11-19T12:00:00.000Z',
      bytes: 6,
      file: '000007-geldar-phase0-provenance-take.json',
    });
    expect(readFileSync(join(dir, meta.file)).equals(bytes)).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, metaFileName(meta.file)), 'utf8'))).toEqual(meta);
    writeCapture(dir, 8, 'geldar.phase0.combat_fact', Buffer.from('{}'), new Date());
    const lines = readFileSync(join(dir, 'index.jsonl'), 'utf8').trimEnd().split('\n');
    expect(lines.map((l) => (JSON.parse(l) as { seq: number }).seq)).toEqual([7, 8]);
  });

  it('reads the sidecars back in sequence order', () => {
    const dir = join(root, 'order');
    writeCapture(dir, 2, 'geldar.phase0.combat_fact', Buffer.from('{}'), new Date());
    writeCapture(dir, 10, 'geldar.phase0.provenance.pickup', Buffer.from('{}'), new Date());
    writeCapture(dir, 1, 'geldar.phase0.provenance.break', Buffer.from('{}'), new Date());
    expect(readCaptureMetas(dir).map((m) => m.seq)).toEqual([1, 2, 10]);
  });
});

describe('parseCaptureArgs', () => {
  const saved = process.env.GELDAR_NATS_URL;
  afterAll(() => {
    if (saved === undefined) delete process.env.GELDAR_NATS_URL;
    else process.env.GELDAR_NATS_URL = saved;
  });

  it('defaults to the loopback URL, the two session subjects and the .capture/nats directory, until stopped', () => {
    delete process.env.GELDAR_NATS_URL;
    expect(parseCaptureArgs([])).toEqual({
      url: DEFAULT_URL,
      subjects: DEFAULT_SUBJECTS,
      out: DEFAULT_OUT_DIR,
      durationSeconds: null,
    });
    expect(DEFAULT_URL).toBe('nats://127.0.0.1:4222');
    expect(DEFAULT_OUT_DIR).toBe('.capture/nats');
  });

  it('reads GELDAR_NATS_URL when --url is not given, and --url wins over it', () => {
    process.env.GELDAR_NATS_URL = 'nats://127.0.0.1:14223';
    expect(parseCaptureArgs([]).url).toBe('nats://127.0.0.1:14223');
    expect(parseCaptureArgs(['--url', 'nats://127.0.0.1:4333']).url).toBe('nats://127.0.0.1:4333');
  });

  it('splits --subjects on commas, trims, and takes --out and --duration', () => {
    const args = parseCaptureArgs([
      '--subjects',
      'geldar.phase0.provenance.>, geldar.phase0.combat_fact',
      '--out',
      'x/y',
      '--duration',
      '2.5',
    ]);
    expect(args.subjects).toEqual(['geldar.phase0.provenance.>', 'geldar.phase0.combat_fact']);
    expect(args.out).toBe('x/y');
    expect(args.durationSeconds).toBe(2.5);
  });

  it('rejects a zero or non-numeric duration, an empty subject list, and an unknown flag', () => {
    expect(() => parseCaptureArgs(['--duration', '0'])).toThrow(/positive number/);
    expect(() => parseCaptureArgs(['--duration', 'soon'])).toThrow(/positive number/);
    expect(() => parseCaptureArgs(['--subjects', ' , '])).toThrow(/names no subject/);
    expect(() => parseCaptureArgs(['--frobnicate'])).toThrow();
  });
});
