/**
 * BLD-19 leak test: the seen map and the survey reply hold no cell an agent could not have seen.
 *
 * The world has a stone wall across the cone, a block behind it, a sealed cave behind the wall and an
 * unloaded chunk in front of it. Hidden blocks carry names no visible block has, so a leak shows up as
 * the name in the survey text. The control cell (in front of the wall) proves the sweep really ran.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  type ViewPose,
  type ViewWorld,
} from '../../perception/view/viewport.ts';
import {
  newRecorder,
  RAY_BUDGET,
  RECORD_EVERY_TICKS,
  recordSeen,
  type SeenRecorder,
} from './recorder.ts';
import { SeenMap } from './section.ts';
import { decodeSurvey, surveyBox } from './survey.ts';

const EYE: ViewPose = { x: 0.5, y: 64.5, z: 0.5, yaw: 0, pitch: 0 };
const NOW_TICK = 12_000;
const HIDDEN_NAMES = ['diamond_ore', 'gold_block', 'obsidian'];
const BOX = { min: { x: -4, y: 62, z: -12 }, max: { x: 4, y: 66, z: 0 } };

function sweep(rec: SeenRecorder, world: ViewWorld, pose: ViewPose, tick: number): void {
  const slices = Math.ceil((DEFAULT_COLS * DEFAULT_ROWS) / RAY_BUDGET);
  for (let i = 0; i < slices; i++) recordSeen(rec, world, pose, tick + i * RECORD_EVERY_TICKS);
}

/** Unloaded cells in front of the wall, inside the cone. */
const inUnloaded = (x: number, z: number): boolean => x >= 2 && x <= 4 && z >= -2 && z <= -1;

function leakWorld(): ViewWorld {
  const solid = new Map<string, string>();
  const put = (x: number, y: number, z: number, name: string): void => {
    solid.set(`${x},${y},${z}`, name);
  };
  for (let x = -30; x <= 30; x++) for (let y = 60; y <= 70; y++) put(x, y, -3, 'stone');
  put(0, 64, -6, 'diamond_ore');
  // A sealed cave (air at x -1..1, y 63..65, z -10..-8) inside a stone shell, with a gold block in it.
  for (let x = -2; x <= 2; x++)
    for (let y = 62; y <= 66; y++)
      for (let z = -11; z <= -7; z++) {
        const inner = Math.abs(x) <= 1 && y >= 63 && y <= 65 && z >= -10 && z <= -8;
        if (!inner) put(x, y, z, 'stone');
      }
  put(0, 64, -9, 'gold_block');
  return {
    dark: false,
    mobs: [],
    block(x, y, z) {
      if (inUnloaded(x, z)) return { kind: 'unknown' as const };
      const name = solid.get(`${x},${y},${z}`);
      return name === undefined
        ? { kind: 'air' as const, name: 'air' }
        : { kind: 'solid' as const, name };
    },
  };
}

describe('seen map leak test (BLD-19)', () => {
  it('control: the cell in front of the wall is recorded, so the sweep ran', () => {
    const map = new SeenMap();
    sweep(newRecorder(map), leakWorld(), EYE, 0);
    expect(map.read(0, 64, -2)).toMatchObject({ name: 'air' });
    expect(map.read(0, 64, -3)).toMatchObject({ name: 'stone' });
  });

  it('the map holds no cell behind the wall, in the sealed cave or in the unloaded chunk', () => {
    const map = new SeenMap();
    sweep(newRecorder(map), leakWorld(), EYE, 0);
    expect(map.read(0, 64, -6)).toBeUndefined();
    expect(map.read(0, 64, -9)).toBeUndefined();
    for (let x = BOX.min.x; x <= BOX.max.x; x++)
      for (let y = BOX.min.y; y <= BOX.max.y; y++)
        for (let z = -4; z >= BOX.min.z; z--) expect(map.read(x, y, z)).toBeUndefined();
    for (let x = 2; x <= 4; x++)
      for (let z = -2; z <= -1; z++) expect(map.read(x, 64, z)).toBeUndefined();
  });

  it('the survey reply carries no hidden name and reads unknown for every hidden cell', () => {
    const map = new SeenMap();
    sweep(newRecorder(map), leakWorld(), EYE, 0);
    const reply = surveyBox(map, BOX, NOW_TICK);
    for (const name of HIDDEN_NAMES) expect(reply.text).not.toContain(name);
    const decoded = decodeSurvey(reply.text);
    expect(decoded.layers.length).toBeGreaterThan(0);
    for (const layer of decoded.layers) {
      for (const row of layer.rows) {
        row.cells.forEach((cell, i) => {
          const x = BOX.min.x + i;
          if (row.z <= -4 || inUnloaded(x, row.z)) expect(cell.name).toBeUndefined();
        });
      }
    }
  });
});
