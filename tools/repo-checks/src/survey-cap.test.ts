/**
 * The survey cap has one number in the Body (SURVEY_MAX_CELLS, golem/src/building/survey-reply.ts) and one in the
 * MCP tool's message (threshold/mcp/src/world.ts). This test reads both files as text and fails if they drift, or if
 * the message stops saying the cap applies after the layers clamp. It never imports either package.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SURVEY_REPLY = readFileSync(`${ROOT}golem/src/building/survey-reply.ts`, 'utf8');
const WORLD = readFileSync(`${ROOT}threshold/mcp/src/world.ts`, 'utf8');

describe('survey cap is the same in the Body and in the MCP message', () => {
  it('reads the Body constant, so the comparison is not empty', () => {
    const match = /export const SURVEY_MAX_CELLS = (\d+);/.exec(SURVEY_REPLY);
    expect(match, 'SURVEY_MAX_CELLS in golem/src/building/survey-reply.ts').not.toBeNull();
  });

  it('states the Body cap in the MCP survey message, with the layers clamp rule', () => {
    const body = /export const SURVEY_MAX_CELLS = (\d+);/.exec(SURVEY_REPLY)?.[1];
    const message = /over (\d+) cells after the layers clamp/.exec(WORLD);
    expect(message, 'survey message in threshold/mcp/src/world.ts').not.toBeNull();
    expect(message?.[1]).toBe(body);
  });
});
