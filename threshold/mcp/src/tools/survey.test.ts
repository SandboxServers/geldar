import { describe, expect, it } from 'vitest';
import type { ToolCall } from './look.ts';
import { createSurveyLimiter, SURVEY_INTERVAL_MS, type SurveyDeps, surveyTool } from './survey.ts';

const LIFE = 'ag_ada_01';
const CALL = { playerId: 'pl_ada', lifeId: LIFE } as ToolCall;
const BOX = { from: { x: 0, y: 64, z: 0 }, to: { x: 4, y: 70, z: 4 } };
const REPLY = { text: 'legend ?=unknown\ny=64\n  z=0 25?', truncated: false };

interface Fake {
  deps: SurveyDeps;
  asked: { lifeId: string; box: unknown; layers?: number }[];
  clock: { now: number };
  open: { value: boolean };
}

/** A survey with a Body that answers `reply` (or throws when `reply` is an Error) and a clock the test moves. */
function fake(reply: unknown = REPLY): Fake {
  const clock = { now: 100_000 };
  const open = { value: true };
  const asked: Fake['asked'] = [];
  const deps: SurveyDeps = {
    survey: async (lifeId, request) => {
      const { box, layers } = request;
      asked.push({ lifeId, box, ...(layers === undefined ? {} : { layers }) });
      if (reply instanceof Error) throw reply;
      return reply;
    },
    isOpen: () => open.value,
    limiter: createSurveyLimiter(() => clock.now),
  };
  return { deps, asked, clock, open };
}

describe('survey tool', () => {
  it('returns the text and truncated flag the Body answers, and asks for the box of the life', async () => {
    const f = fake();
    const outcome = await surveyTool(f.deps, CALL, { box: BOX });
    expect(outcome).toEqual({ survey: { text: REPLY.text, truncated: false } });
    expect(f.asked).toEqual([{ lifeId: LIFE, box: BOX }]);
  });

  it('passes the layers count to the Body when one is given', async () => {
    const f = fake();
    await surveyTool(f.deps, CALL, { box: BOX, layers: 3 });
    expect(f.asked).toEqual([{ lifeId: LIFE, box: BOX, layers: 3 }]);
  });

  it('gives no owner field: a reply that carries one is refused, and a success has only text and truncated', async () => {
    const withOwner = fake({ ...REPLY, owner: 'ag_billy_01' });
    expect(await surveyTool(withOwner.deps, CALL, { box: BOX })).toEqual({
      error: 'body_unavailable',
    });
    const ok = fake();
    const outcome = await surveyTool(ok.deps, CALL, { box: BOX });
    expect(Object.keys('survey' in outcome ? outcome.survey : {}).sort()).toEqual([
      'text',
      'truncated',
    ]);
  });

  it('refuses a reply that is not a survey, as body_unavailable', async () => {
    const f = fake({ text: 'x' });
    expect(await surveyTool(f.deps, CALL, { box: BOX })).toEqual({ error: 'body_unavailable' });
  });

  it('refuses input that is not a box, with extra keys, or with layers out of 1 to 384, without asking the Body', async () => {
    const bad: unknown[] = [
      undefined,
      'box',
      {},
      { box: BOX, owner: 'ag_billy_01' },
      { box: BOX, layers: 0 },
      { box: BOX, layers: 385 },
      { box: { from: BOX.from } },
    ];
    for (const input of bad) {
      const f = fake();
      expect(await surveyTool(f.deps, CALL, input)).toEqual({ error: 'invalid_input' });
      expect(f.asked).toEqual([]);
    }
  });

  it('refuses a call on a closed session without asking the Body', async () => {
    const f = fake();
    f.open.value = false;
    expect(await surveyTool(f.deps, CALL, { box: BOX })).toEqual({ error: 'session_closed' });
    expect(f.asked).toEqual([]);
  });

  it('refuses a second survey within 5 seconds of the first for the same life, and allows one at 5 seconds', async () => {
    const f = fake();
    expect(await surveyTool(f.deps, CALL, { box: BOX })).toHaveProperty('survey');
    f.clock.now += SURVEY_INTERVAL_MS - 1;
    expect(await surveyTool(f.deps, CALL, { box: BOX })).toEqual({ error: 'rate_limited' });
    expect(f.asked).toHaveLength(1);
    f.clock.now += 1;
    expect(await surveyTool(f.deps, CALL, { box: BOX })).toHaveProperty('survey');
    expect(f.asked).toHaveLength(2);
  });

  it('keeps one window per life, so another life is not refused', async () => {
    const f = fake();
    await surveyTool(f.deps, CALL, { box: BOX });
    const other = { playerId: 'pl_bob', lifeId: 'ag_bob_01' } as ToolCall;
    expect(await surveyTool(f.deps, other, { box: BOX })).toHaveProperty('survey');
  });

  it('a refused call does not move the window: the next allowed call is 5 seconds after the admitted one', async () => {
    const f = fake();
    await surveyTool(f.deps, CALL, { box: BOX });
    f.clock.now += 2_000;
    await surveyTool(f.deps, CALL, { box: BOX });
    f.clock.now += SURVEY_INTERVAL_MS - 2_000;
    expect(await surveyTool(f.deps, CALL, { box: BOX })).toHaveProperty('survey');
  });

  it('a Body that does not answer is body_unavailable, and the failed call still uses the window', async () => {
    const f = fake(new Error('nats timeout'));
    expect(await surveyTool(f.deps, CALL, { box: BOX })).toEqual({ error: 'body_unavailable' });
    expect(await surveyTool(f.deps, CALL, { box: BOX })).toEqual({ error: 'rate_limited' });
    expect(f.asked).toHaveLength(1);
  });

  it('a call refused on input or a closed session does not use the window', async () => {
    const f = fake();
    f.open.value = false;
    await surveyTool(f.deps, CALL, { box: BOX });
    f.open.value = true;
    await surveyTool(f.deps, CALL, 'bad');
    expect(await surveyTool(f.deps, CALL, { box: BOX })).toHaveProperty('survey');
  });
});
