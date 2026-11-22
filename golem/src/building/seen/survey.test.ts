import { describe, expect, it } from 'vitest';
import { SeenMap } from './section.ts';
import {
  type DecodedCell,
  decodeSurvey,
  SURVEY_TEXT_CAP,
  type SurveyBox,
  surveyBox,
  TICKS_PER_MINUTE,
} from './survey.ts';

const NOW = 12 * TICKS_PER_MINUTE;

/** The cell a survey should decode to for a block: unseen reads no name and no age. */
function expectedCell(map: SeenMap, x: number, y: number, z: number, now: number): DecodedCell {
  const cell = map.read(x, y, z);
  if (cell === undefined) return { name: undefined, ageMinutes: undefined, inherited: false };
  return {
    name: cell.name,
    ageMinutes: Math.floor(Math.max(0, now - cell.lastSeen) / TICKS_PER_MINUTE),
    inherited: cell.inherited,
  };
}

describe('surveyBox', () => {
  it('renders the legend, the layer and the run-length rows exactly', () => {
    const map = new SeenMap();
    map.record(0, 0, 0, 'minecraft:stone', 0);
    map.record(1, 0, 0, 'minecraft:stone', 0);
    const box: SurveyBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0, z: 0 } };
    expect(surveyBox(map, box, NOW)).toEqual({
      text: 'legend ?=unknown a=minecraft:stone\ny=0\n  z=0 2a@12',
      truncated: false,
    });
  });

  it('reads a cell never seen as unknown and guesses nothing about it', () => {
    const map = new SeenMap();
    map.record(1, 0, 0, 'minecraft:stone', 0);
    const box: SurveyBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 0, z: 0 } };
    const reply = surveyBox(map, box, NOW);
    expect(reply.text).toBe('legend ?=unknown a=minecraft:stone\ny=0\n  z=0 1? 1a@12 1?');
    const row = decodeSurvey(reply.text).layers[0]?.rows[0]?.cells ?? [];
    expect(row.map((cell) => cell.name)).toEqual([undefined, 'minecraft:stone', undefined]);
    expect(row[0]).toEqual({ name: undefined, ageMinutes: undefined, inherited: false });
  });

  it('a stale cell inherited from a predecessor reads back with its age and the inherited mark', () => {
    const map = new SeenMap();
    map.record(0, 0, 0, 'minecraft:stone', 0, true);
    map.record(1, 0, 0, 'minecraft:stone', NOW);
    const box: SurveyBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0, z: 0 } };
    const reply = surveyBox(map, box, NOW);
    expect(reply.text).toBe('legend ?=unknown a=minecraft:stone\ny=0\n  z=0 1a@12i 1a@0');
    const row = decodeSurvey(reply.text).layers[0]?.rows[0]?.cells ?? [];
    expect(row).toEqual([
      { name: 'minecraft:stone', ageMinutes: 12, inherited: true },
      { name: 'minecraft:stone', ageMinutes: 0, inherited: false },
    ]);
  });

  it('a fresh sighting of an inherited cell clears its mark and its age restarts', () => {
    const map = new SeenMap();
    map.record(0, 0, 0, 'minecraft:stone', 0, true);
    map.record(0, 0, 0, 'minecraft:stone', NOW);
    const box: SurveyBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    expect(surveyBox(map, box, NOW).text).toBe(
      'legend ?=unknown a=minecraft:stone\ny=0\n  z=0 1a@0',
    );
  });

  it('round trips a box that spans negative coordinates, runs and both seen and unseen cells', () => {
    const map = new SeenMap();
    map.record(-2, -1, -1, 'minecraft:stone', 0);
    map.record(-1, -1, -1, 'minecraft:stone', 0);
    map.record(-1, 0, 0, 'minecraft:oak_planks', 13 * TICKS_PER_MINUTE);
    map.record(-2, 0, -1, 'minecraft:dirt', 6 * TICKS_PER_MINUTE);
    const box: SurveyBox = { min: { x: -2, y: -1, z: -1 }, max: { x: -1, y: 0, z: 0 } };
    const decoded = decodeSurvey(surveyBox(map, box, NOW).text);
    expect(decoded.layers.map((layer) => layer.y)).toEqual([-1, 0]);
    for (const layer of decoded.layers) {
      for (const row of layer.rows) {
        row.cells.forEach((cell, index) => {
          const x = box.min.x + index;
          expect(cell).toEqual(expectedCell(map, x, layer.y, row.z, NOW));
        });
      }
    }
  });

  it('reports a future last-seen tick as age zero', () => {
    const map = new SeenMap();
    map.record(0, 0, 0, 'minecraft:glass', NOW + 500);
    const box: SurveyBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    expect(surveyBox(map, box, NOW).text).toBe(
      'legend ?=unknown a=minecraft:glass\ny=0\n  z=0 1a@0',
    );
  });

  it('has no owner field: the reply is the text and the truncated marker only', () => {
    const map = new SeenMap();
    map.record(0, 0, 0, 'minecraft:stone', 0);
    const box: SurveyBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    const reply = surveyBox(map, box, NOW);
    expect(Object.keys(reply).sort()).toEqual(['text', 'truncated']);
    expect(reply.text.toLowerCase()).not.toContain('owner');
  });

  it('answers an empty box with the legend alone', () => {
    const map = new SeenMap();
    const box: SurveyBox = { min: { x: 1, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    expect(surveyBox(map, box, NOW)).toEqual({ text: 'legend ?=unknown', truncated: false });
  });

  it('keeps the layers nearest the anchor and marks the reply truncated past the cap', () => {
    const map = new SeenMap();
    const box: SurveyBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 15, y: 39, z: 15 } };
    for (let y = 0; y <= 39; y++) {
      for (let z = 0; z <= 15; z++) {
        for (let x = 0; x <= 15; x++) {
          map.record(x, y, z, x % 2 === 0 ? 'minecraft:stone' : 'minecraft:dirt', 0);
        }
      }
    }
    const reply = surveyBox(map, box, NOW, 20);
    expect(reply.truncated).toBe(true);
    expect(reply.text.length).toBeLessThanOrEqual(SURVEY_TEXT_CAP);
    const ys = decodeSurvey(reply.text).layers.map((layer) => layer.y);
    expect(ys).toContain(20);
    expect(ys).not.toContain(0);
    expect(ys).not.toContain(39);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it('keeps the nearest rows of a single layer that does not fit whole', () => {
    const map = new SeenMap();
    const box: SurveyBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 255, y: 0, z: 7 } };
    for (let z = 0; z <= 7; z++) {
      for (let x = 0; x <= 255; x++) {
        map.record(x, 0, z, x % 2 === 0 ? 'minecraft:stone' : 'minecraft:dirt', 0);
      }
    }
    const reply = surveyBox(map, box, NOW);
    expect(reply.truncated).toBe(true);
    expect(reply.text.length).toBeLessThanOrEqual(SURVEY_TEXT_CAP);
    const rows = decodeSurvey(reply.text).layers[0]?.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(8);
    expect(rows.map((row) => row.z)).toEqual(rows.map((_, index) => index));
  });

  it('is not truncated for a box that fits', () => {
    const map = new SeenMap();
    map.record(0, 0, 0, 'minecraft:stone', 0);
    const box: SurveyBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 3, y: 3, z: 3 } };
    expect(surveyBox(map, box, NOW).truncated).toBe(false);
  });
});
