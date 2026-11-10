import { stableJson } from './world-text.ts';

interface VerbEntry {
  do: string;
  summary: string;
  fields: Record<string, string>;
  example: unknown;
}

interface ProgramEntry {
  program: string;
  summary: string;
  arguments: Record<string, string>;
  example: unknown;
}

/** The shape of `prompts/body-api/vN.json`. */
export interface BodyApiFile {
  version: number;
  say: { summary: string; example: unknown };
  verbs: VerbEntry[];
  programs: ProgramEntry[];
  wake_on: { summary: string; values: string[] };
}

function fieldList(fields: Record<string, string>): string {
  const keys = Object.keys(fields).sort();
  return keys.length === 0 ? 'no fields' : keys.map((k) => `${k} (${fields[k]})`).join('; ');
}

/** Checks the file has the shape the renderer reads. Throws with the first problem. */
export function checkBodyApi(file: unknown): BodyApiFile {
  const f = file as Partial<BodyApiFile> | null;
  if (
    f === null ||
    typeof f !== 'object' ||
    typeof f.version !== 'number' ||
    !Array.isArray(f.verbs) ||
    !Array.isArray(f.programs) ||
    f.say === undefined ||
    f.wake_on === undefined
  ) {
    throw new Error('body-api file: expected version, say, verbs, programs and wake_on');
  }
  return f as BodyApiFile;
}

/**
 * The capabilities table of block 2: the verbs, the programs and one example of each, in the
 * file's order, with keys sorted inside each example. Byte-stable: no times, no counts.
 */
export function renderBodyApi(file: unknown): string {
  const api = checkBodyApi(file);
  const out: string[] = [];
  out.push('Actions (the "actions" list, at most 6, run in order, one after another):');
  for (const v of api.verbs) {
    out.push(
      `- ${v.do}: ${v.summary} Fields: ${fieldList(v.fields)}. Example: ${stableJson(v.example, 200)}`,
    );
  }
  out.push('');
  out.push('Routines (the "intent": a durable goal pursued by a program that runs on by itself):');
  for (const p of api.programs) {
    out.push(
      `- ${p.program}: ${p.summary} Arguments: ${fieldList(p.arguments)}. Example: ${stableJson(p.example, 200)}`,
    );
  }
  out.push('');
  out.push(`Speech ("say"): ${api.say.summary} Example: ${stableJson(api.say.example, 200)}`);
  out.push('');
  out.push(`wake_on: ${api.wake_on.summary} Values: ${api.wake_on.values.join(', ')}.`);
  out.push(
    'An intent needs "goal" (a lower-case name), "program", "arguments", "wake_on" and "limits" with max_world_ticks (20 ticks per second) and max_block_operations.',
  );
  out.push('Anything not listed here is not available to you.');
  return out.join('\n');
}
