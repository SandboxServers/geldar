import { listTools } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import {
  hiddenToolsFor,
  NOT_AVAILABLE_MESSAGE,
  NOT_AVAILABLE_TOOLS,
  refuseHiddenCall,
} from './unavailable.ts';

const SIX = ['write_book', 'define_skill', 'use_skill', 'offer', 'propose', 'vote'];
const NOT_AVAILABLE_TEXT = { type: 'text', text: `not_available: ${NOT_AVAILABLE_MESSAGE}` };

function actSchemaText(showUnavailable: boolean): string {
  const act = listTools(hiddenToolsFor(showUnavailable)).find((tool) => tool.name === 'act');
  if (!act) throw new Error('act is not listed');
  return JSON.stringify(act.inputSchema);
}

describe('the building tools under body_actions.building', () => {
  it('are listed with show_unavailable_tools false when the building flag is on', () => {
    const names = listTools(hiddenToolsFor(false, true)).map((tool) => tool.name);
    expect(names).toContain('survey');
    expect(names).toContain('plan_check');
    for (const tool of SIX) expect(names).not.toContain(tool);
  });

  it('stay hidden with show_unavailable_tools false when the building flag is off', () => {
    const names = listTools(hiddenToolsFor(false, false)).map((tool) => tool.name);
    expect(names).not.toContain('survey');
    expect(names).not.toContain('plan_check');
    expect(names).toContain('read_book');
    expect(hiddenToolsFor(false)).toEqual(hiddenToolsFor(false, false));
  });

  it('are not refused by name when the building flag is on', () => {
    const hidden = hiddenToolsFor(false, true);
    expect(refuseHiddenCall('survey', {}, hidden)).toBeUndefined();
    expect(refuseHiddenCall('plan_check', {}, hidden)).toBeUndefined();
    expect(refuseHiddenCall('write_book', {}, hidden)).toEqual({
      isError: true,
      content: [NOT_AVAILABLE_TEXT],
    });
  });

  it('are refused by name when the building flag is off', () => {
    const hidden = hiddenToolsFor(false, false);
    expect(refuseHiddenCall('survey', {}, hidden)).toEqual({
      isError: true,
      content: [NOT_AVAILABLE_TEXT],
    });
  });
});

describe('the tools this world does not run', () => {
  it('are the six named in the spec, and read_book is not one of them', () => {
    expect([...NOT_AVAILABLE_TOOLS].sort()).toEqual([...SIX].sort());
    expect(NOT_AVAILABLE_TOOLS).not.toContain('read_book');
  });

  it('are all left out of the tool list when the flag is off', () => {
    const names = listTools(hiddenToolsFor(false)).map((tool) => tool.name);
    for (const tool of NOT_AVAILABLE_TOOLS) expect(names).not.toContain(tool);
    expect(names).toContain('read_book');
  });

  it('have no act variant when the flag is off', () => {
    const text = actSchemaText(false);
    for (const tool of NOT_AVAILABLE_TOOLS) expect(text).not.toContain(`"const":"${tool}"`);
    expect(text).toContain('"const":"goto"');
    expect(text).toContain('"const":"read_book"');
  });

  it('are all listed, as today, when the flag is on', () => {
    const names = listTools(hiddenToolsFor(true)).map((tool) => tool.name);
    for (const tool of SIX) expect(names).toContain(tool);
    const text = actSchemaText(true);
    for (const tool of SIX) expect(text).toContain(`"const":"${tool}"`);
  });

  it('are refused by name with not_available when the flag is off', () => {
    const hidden = hiddenToolsFor(false);
    for (const tool of NOT_AVAILABLE_TOOLS) {
      expect(refuseHiddenCall(tool, {}, hidden)).toEqual({
        isError: true,
        content: [NOT_AVAILABLE_TEXT],
      });
    }
  });

  it('refuse an act that names a hidden verb, and pass an act with other verbs', () => {
    const hidden = hiddenToolsFor(false);
    expect(refuseHiddenCall('act', { actions: [{ do: 'goto' }, { do: 'vote' }] }, hidden)).toEqual({
      isError: true,
      content: [NOT_AVAILABLE_TEXT],
    });
    expect(refuseHiddenCall('act', { actions: [{ do: 'goto' }] }, hidden)).toBeUndefined();
    expect(refuseHiddenCall('act', { say: 'hello' }, hidden)).toBeUndefined();
    expect(refuseHiddenCall('act', { actions: 'offer' }, hidden)).toBeUndefined();
  });

  it('never refuse read_book', () => {
    expect(refuseHiddenCall('read_book', { book: 'x' }, hiddenToolsFor(false))).toBeUndefined();
  });

  it('let every call through when the flag is on', () => {
    const open = hiddenToolsFor(true);
    for (const tool of [...SIX, 'read_book', 'act']) {
      expect(refuseHiddenCall(tool, { actions: [{ do: 'offer' }] }, open)).toBeUndefined();
    }
  });
});
