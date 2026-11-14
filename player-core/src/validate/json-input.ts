import type { OutputError } from '../ports/index.ts';
import { MAX_OUTPUT_BYTES } from './bounds.ts';

/** Options shared by both output pipelines. */
export interface InputOptions {
  /**
   * True (the default) when the job asked the engine for constrained output (decision 0049):
   * then the text is parsed exactly as it is, with no stripping of think blocks or code fences.
   * False applies the two steps of wave 5 Q5, and only those two.
   */
  constrainedOutput?: boolean;
  /** Called with the names of the steps applied when text was normalised (flag it on the row). */
  onNormalise?: (steps: string[]) => void;
}

/** The result of reading the text as one JSON document. */
export type JsonRead = { ok: true; value: unknown } | { ok: false; errors: OutputError[] };

/**
 * Size check, optional normalisation, `JSON.parse`. Never repairs: trailing commas, comments,
 * single quotes and text around the document are all `not_json`.
 */
export function readJson(text: string, options: InputOptions): JsonRead {
  if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) {
    return fail('out_of_bounds', `the output is over ${MAX_OUTPUT_BYTES} bytes`);
  }
  let body = text;
  if (options.constrainedOutput === false) {
    const steps: string[] = [];
    const think = /^\s*<think>[\s\S]*?<\/think>/.exec(body);
    if (think !== null) {
      body = body.slice(think[0].length);
      steps.push('strip_think_block');
    }
    const fence = /^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(body);
    if (fence !== null) {
      body = fence[1] as string;
      steps.push('strip_json_fence');
    }
    if (steps.length > 0) options.onNormalise?.(steps);
  }
  if (body.trim() === '') return fail('empty', 'the output is empty');
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return fail('not_json', 'the output is not one JSON document');
  }
}

function fail(code: OutputError['code'], detail: string): JsonRead {
  return { ok: false, errors: [{ code, path: '', detail }] };
}

/** Turns a contract validator message (`/path message` or `"" message`) into path and detail. */
export function splitSchemaMessage(message: string): { path: string; detail: string } {
  const space = message.indexOf(' ');
  const head = space === -1 ? message : message.slice(0, space);
  const detail = space === -1 ? '' : message.slice(space + 1);
  return { path: head === '""' ? '' : head, detail: detail.slice(0, 256) };
}
