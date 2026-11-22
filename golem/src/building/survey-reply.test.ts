import { describe, expect, it } from 'vitest';
import { SeenMap } from './seen/section.ts';
import { type SurveyBox, surveyBox } from './seen/survey.ts';
import { answerSurvey, type SurveyAsk } from './survey-reply.ts';

/** A seen map stand-in that records each box and nowTick it is asked for. */
function fakeSeen(reply = { text: 'legend a=stone', truncated: false }) {
  const asked: { box: SurveyBox; nowTick: number }[] = [];
  const seen: SurveyAsk = {
    survey: (box, nowTick) => {
      asked.push({ box, nowTick });
      return reply;
    },
  };
  return { seen, asked };
}

const request = { box: { from: { x: 5, y: 70, z: -3 }, to: { x: 1, y: 64, z: 2 } } };

describe('answerSurvey', () => {
  it('asks the seen map for the inclusive box of the two corners, at the tick', () => {
    const { seen, asked } = fakeSeen();
    answerSurvey(seen, request, 900, true);
    expect(asked).toEqual([
      {
        box: { min: { x: 1, y: 64, z: -3 }, max: { x: 5, y: 70, z: 2 } },
        nowTick: 900,
      },
    ]);
  });

  it('answers with the text and truncated flag only, whatever else the map returns', () => {
    const { seen } = fakeSeen({
      text: 'legend a=stone',
      truncated: true,
      owner: 'ag_jason_01',
    } as unknown as { text: string; truncated: boolean });
    expect(answerSurvey(seen, request, 1, true)).toEqual({
      text: 'legend a=stone',
      truncated: true,
    });
  });

  it('refuses every request as not_available while the building flag is off, without asking the map', () => {
    const { seen, asked } = fakeSeen();
    expect(answerSurvey(seen, request, 1, false)).toEqual({ error: 'not_available' });
    expect(asked).toEqual([]);
  });

  it('refuses a request outside the contract without asking the map', () => {
    const { seen, asked } = fakeSeen();
    expect(answerSurvey(seen, { box: { from: { x: 0, y: 0, z: 0 } } }, 1, true)).toEqual({
      error: 'invalid_input',
    });
    expect(answerSurvey(seen, { ...request, layers: 0 }, 1, true)).toEqual({
      error: 'invalid_input',
    });
    expect(asked).toEqual([]);
  });

  it('counts layers upward from the lower y, clamping the box max y', () => {
    const { seen, asked } = fakeSeen();
    answerSurvey(seen, request, 1, true);
    answerSurvey(seen, { ...request, layers: 2 }, 1, true);
    answerSurvey(seen, { ...request, layers: 384 }, 1, true);
    expect(asked[0]?.box.max.y).toBe(70);
    expect(asked[1]?.box).toEqual({
      min: { x: 1, y: 64, z: -3 },
      max: { x: 5, y: 65, z: 2 },
    });
    expect(asked[2]?.box.max.y).toBe(70);
  });

  it('reads a block behind a wall as unknown: a cell the map never recorded', () => {
    const map = new SeenMap();
    map.record(1, 64, 1, 'stone', 10);
    const answer = answerSurvey(
      { survey: (box, tick) => surveyBox(map, box, tick) },
      { box: { from: { x: 1, y: 64, z: 1 }, to: { x: 2, y: 64, z: 1 } } },
      20,
      true,
    );
    expect('text' in answer && answer.text).toContain('unknown');
  });
});
