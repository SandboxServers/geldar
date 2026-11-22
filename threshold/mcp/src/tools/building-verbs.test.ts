import { readFileSync } from 'node:fs';
import { listTools } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { BUILDING_VERBS_SENTENCE, forBuildingFlag, hiddenVerbsFor } from './building-verbs.ts';
import { hiddenToolsFor, NOT_AVAILABLE_MESSAGE, refuseHiddenCall } from './unavailable.ts';

const NOT_AVAILABLE_TEXT = { type: 'text', text: `not_available: ${NOT_AVAILABLE_MESSAGE}` };
const POS = { x: 0, y: 64, z: 0 };
const BUILDING_WORD = /\b(break|plan)\b/;

/** The act tool as the world lists it, with the flag given to the listing as threshold does. */
function listedAct(buildingOn: boolean, showUnavailable = false) {
  const hidden = hiddenToolsFor(showUnavailable, buildingOn);
  const act = listTools(hidden)
    .map((tool) => forBuildingFlag(tool, buildingOn))
    .find((tool) => tool.name === 'act');
  if (!act) throw new Error('act is not listed');
  return act;
}

function intentText(act: ReturnType<typeof listedAct>): string {
  return (act.inputSchema.properties as { intent: { description: string } }).intent.description;
}

describe('the building verbs with body_actions.building off', () => {
  it('leaves break and plan out of the act description text', () => {
    for (const showUnavailable of [false, true]) {
      const act = listedAct(false, showUnavailable);
      const properties = act.inputSchema.properties as { actions: { description: string } };
      const text = [act.description, intentText(act), properties.actions.description].join(' ');
      expect(text).not.toMatch(BUILDING_WORD);
    }
  });

  it('keeps the rest of the intent description, so the programs still read', () => {
    const text = intentText(listedAct(false));
    expect(text).toContain('To put up a structure use program build');
    expect(text).toContain('Other programs: explore walks');
  });

  it('refuses an act whose action names break or plan, whole, with not_available', () => {
    const hidden = hiddenVerbsFor(false);
    const breakAct = { actions: [{ do: 'break', at: POS }] };
    const planAct = {
      actions: [
        { do: 'goto', target: POS },
        { do: 'plan', op: 'cancel' },
      ],
    };
    expect(refuseHiddenCall('act', breakAct, hidden)).toEqual({
      isError: true,
      content: [NOT_AVAILABLE_TEXT],
    });
    expect(refuseHiddenCall('act', planAct, hidden)).toEqual({
      isError: true,
      content: [NOT_AVAILABLE_TEXT],
    });
  });

  it('lets an act with no building verb through', () => {
    const hidden = hiddenVerbsFor(false);
    expect(
      refuseHiddenCall('act', { actions: [{ do: 'goto', target: POS }] }, hidden),
    ).toBeUndefined();
    expect(refuseHiddenCall('act', { say: 'hello' }, hidden)).toBeUndefined();
  });
});

describe('the building verbs with body_actions.building on', () => {
  it('describes break and plan in the act description, as before', () => {
    expect(intentText(listedAct(true))).toContain(BUILDING_VERBS_SENTENCE);
    expect(intentText(listedAct(true))).toContain('break removes one block');
  });

  it('is not refused for break or plan', () => {
    const hidden = hiddenVerbsFor(true);
    expect(hidden).toEqual([]);
    expect(
      refuseHiddenCall('act', { actions: [{ do: 'break', at: POS }] }, hidden),
    ).toBeUndefined();
    expect(
      refuseHiddenCall('act', { actions: [{ do: 'plan', op: 'cancel' }] }, hidden),
    ).toBeUndefined();
  });
});

describe('the sentence that the flag-off description drops', () => {
  it('is the sentence the contract schema carries, word for word', () => {
    const schema = readFileSync(
      new URL('../../../../contract/schemas/mcp-play.schema.json', import.meta.url),
      'utf8',
    );
    expect(schema).toContain(BUILDING_VERBS_SENTENCE.trimEnd());
  });
});
