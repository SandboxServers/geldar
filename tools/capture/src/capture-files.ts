import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

/** Where the subscriber writes when --out is not given. Under .capture/ (gitignored). */
export const DEFAULT_OUT_DIR = '.capture/nats';
/** The subjects of the provenance capture session (AN-26a, AN-27a, AN-47a, AN-51a). */
export const DEFAULT_SUBJECTS = ['geldar.phase0.provenance.>', 'geldar.phase0.combat_fact'];
export const DEFAULT_URL = 'nats://127.0.0.1:4222';

/** One captured message: the sidecar `<name>.meta.json` and one line of `index.jsonl`. */
export type CaptureMeta = {
  seq: number;
  subject: string;
  received_at: string;
  bytes: number;
  file: string;
};

export type CaptureArgs = {
  url: string;
  subjects: string[];
  out: string;
  durationSeconds: number | null;
};

/** `000012-geldar-phase0-provenance-break.json`: the sequence number, then the subject with dots as dashes. */
export function captureFileName(seq: number, subject: string): string {
  return `${String(seq).padStart(6, '0')}-${subject.replaceAll('.', '-')}.json`;
}

/** The sidecar of a capture file: `000012-....json` gets `000012-....meta.json`. */
export function metaFileName(file: string): string {
  return file.replace(/\.json$/, '.meta.json');
}

/** One line of index.jsonl, newline included. */
export function indexLine(meta: CaptureMeta): string {
  return `${JSON.stringify(meta)}\n`;
}

/**
 * Writes one message verbatim (the raw bytes, no re-encoding), its sidecar, and one index line. Returns the metadata.
 * The payload is never parsed here: the validator is the only reader that looks inside.
 */
export function writeCapture(
  dir: string,
  seq: number,
  subject: string,
  data: Uint8Array,
  receivedAt: Date,
): CaptureMeta {
  mkdirSync(dir, { recursive: true });
  const file = captureFileName(seq, subject);
  const meta: CaptureMeta = {
    seq,
    subject,
    received_at: receivedAt.toISOString(),
    bytes: data.byteLength,
    file,
  };
  writeFileSync(join(dir, file), data);
  writeFileSync(join(dir, metaFileName(file)), `${JSON.stringify(meta, null, 2)}\n`);
  appendFileSync(join(dir, 'index.jsonl'), indexLine(meta));
  return meta;
}

/** Reads the sidecars of a capture directory, in sequence order. A payload without a sidecar is reported, not read. */
export function readCaptureMetas(dir: string): CaptureMeta[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.meta.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as CaptureMeta);
}

/** Parses the command line. Throws a plain Error with the reason on a bad value; the CLI prints it and exits 2. */
export function parseCaptureArgs(argv: string[]): CaptureArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string' },
      subjects: { type: 'string' },
      out: { type: 'string' },
      duration: { type: 'string' },
    },
    strict: true,
  });
  const subjects = values.subjects
    ? values.subjects
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : DEFAULT_SUBJECTS;
  if (subjects.length === 0) throw new Error('--subjects names no subject');
  let durationSeconds: number | null = null;
  if (values.duration !== undefined) {
    durationSeconds = Number(values.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`--duration must be a positive number of seconds, got "${values.duration}"`);
    }
  }
  return {
    url: values.url ?? process.env.GELDAR_NATS_URL ?? DEFAULT_URL,
    subjects,
    out: values.out ?? DEFAULT_OUT_DIR,
    durationSeconds,
  };
}
