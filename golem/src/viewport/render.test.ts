import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderRgb, renderViewportPng } from './index.ts';
import { pitGapScene, pitWallScene, pitWorld, type Scene, terrainScene } from './scenes.fixture.ts';
import type { ViewportRequest, ViewportWorld } from './world.ts';

/**
 * Golden hashes of the fixture scenes at the default 320x180 size (SHA-256 of the RGB bytes).
 * To regenerate after an intended change: run
 *   VIEWPORT_PRINT_GOLDEN=1 pnpm --filter @geldar/golem exec vitest run src/viewport/render.test.ts
 * and paste the printed hashes here. Do not regenerate to pass an unintended change.
 */
const GOLDEN: Record<string, string> = {
  'pit-gap': '5dbe10252244a4267c091598ab1e8648b07a9cd34a1f1d851b9627507937e035',
  'pit-wall': '5c52bce20d93abaee3e4ffbdf31aa305d4e1e0c7df21988ac55c3b0b8d7cef8a',
  terrain: '8000e94f531ffd79c0c1f6478686d5c2f907773f301d02450d868a319cc6411d',
};
const REGENERATE =
  'regenerate: VIEWPORT_PRINT_GOLDEN=1 pnpm --filter @geldar/golem exec vitest run src/viewport/render.test.ts';

const sha = (rgb: Uint8Array): string => createHash('sha256').update(rgb).digest('hex');

function toRequest(scene: Scene): ViewportRequest {
  const { name: _name, ...req } = scene;
  return req;
}

const SMALL = { width: 80, height: 45 };

describe('viewport golden scenes', () => {
  for (const scene of [pitGapScene(), pitWallScene(), terrainScene()]) {
    it(`${scene.name} matches its golden hash`, () => {
      const hash = sha(renderRgb(toRequest(scene)).rgb);
      if (process.env.VIEWPORT_PRINT_GOLDEN === '1') console.log(`${scene.name} ${hash}`);
      expect(hash, `${scene.name}: ${REGENERATE}`).toBe(GOLDEN[scene.name]);
    });
  }
});

describe('viewport knowledge boundary', () => {
  it('an entity behind a wall does not change a single pixel', () => {
    const withCreeper = pitWallScene();
    const without = pitWallScene([]);
    const a = renderRgb({ ...toRequest(withCreeper), options: SMALL });
    const b = renderRgb({ ...toRequest(without), options: SMALL });
    expect(Buffer.from(a.rgb).equals(Buffer.from(b.rgb))).toBe(true);
  });

  it('the same entity in the open does change pixels', () => {
    const base = { world: pitWorld(), eye: { x: 4.5, y: 65.62, z: 5.5 }, yaw: 0, pitch: 0 };
    const zombie = { type: 'zombie', x: 4.5, y: 64, z: 1.0, width: 0.6, height: 1.95 };
    const a = renderRgb({ ...base, entities: [zombie], options: SMALL });
    const b = renderRgb({ ...base, entities: [], options: SMALL });
    expect(Buffer.from(a.rgb).equals(Buffer.from(b.rgb))).toBe(false);
  });

  it('an unloaded cell ends the ray and is sky: stone beyond it is never drawn', () => {
    // Cells x < 10 are loaded air. Cells x 10 and 11 are unloaded. Cells x >= 12 are loaded stone that
    // the ray must never reach. The reference world has the same unloaded cells and no stone at all.
    const withStoneBeyond: ViewportWorld = {
      blockAt: (x) => (x >= 12 ? 'minecraft:stone' : x >= 10 ? null : 'minecraft:air'),
    };
    const reference: ViewportWorld = {
      blockAt: (x) => (x >= 10 ? null : 'minecraft:air'),
    };
    const eye = { x: 0.5, y: 64.5, z: 0.5 };
    const options = { width: 40, height: 20 };
    const a = renderRgb({ world: withStoneBeyond, eye, yaw: -Math.PI / 2, pitch: 0, options });
    const b = renderRgb({ world: reference, eye, yaw: -Math.PI / 2, pitch: 0, options });
    expect(Buffer.from(a.rgb).equals(Buffer.from(b.rgb))).toBe(true);
    for (let i = 0; i < a.rgb.length; i += 3)
      expect(a.rgb[i + 2] as number).toBeGreaterThan(a.rgb[i] as number);
  });

  it('the same input renders the same bytes', () => {
    const req = toRequest(pitGapScene());
    const a = renderViewportPng({ ...req, options: SMALL });
    const b = renderViewportPng({ ...req, options: SMALL });
    expect(a.equals(b)).toBe(true);
  });
});
