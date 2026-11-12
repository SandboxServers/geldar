// node tools/viewport-spike/src/run.ts <outDir>
// Renders the fixture views to PNG and prints time, memory and size.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pitScene, spawnY, terrainScene } from './fixtures.ts';
import { encodePng } from './png.ts';
import { renderViewport } from './render.ts';

const out = process.argv[2] ?? '.';
mkdirSync(out, { recursive: true });
const deg = (d: number): number => (d * Math.PI) / 180;

const pit = pitScene();
const terrain = terrainScene();
const EYE = 1.62;
const views = [
  // inside the pit, looking north through the gap: zombie outside visible
  { name: 'pit-gap', scene: pit, eye: { x: 4.5, y: 64 + EYE, z: 5.5 }, yaw: 0, pitch: 0 },
  // inside the pit, looking east at the wall: a creeper stands behind it and must NOT show
  { name: 'pit-wall', scene: pit, eye: { x: 4.5, y: 64 + EYE, z: 4.5 }, yaw: deg(-90), pitch: 0 },
  // terrain, looking along the ground towards the zombie and the pond
  {
    name: 'terrain-a',
    scene: terrain,
    eye: { x: 14.5, y: spawnY(terrain, 14, 14) + EYE, z: 14.5 },
    yaw: deg(-70),
    pitch: deg(-5),
  },
  // terrain, looking at the edge of the loaded world (nothing beyond is drawn)
  {
    name: 'terrain-edge',
    scene: terrain,
    eye: { x: 30.5, y: spawnY(terrain, 30, 30) + EYE, z: 30.5 },
    yaw: deg(180),
    pitch: deg(8),
  },
];

for (const v of views) {
  const runs: number[] = [];
  let png = Buffer.alloc(0);
  for (let i = 0; i < 6; i++) {
    const t0 = performance.now();
    const img = renderViewport(v.scene.world, v.eye, v.yaw, v.pitch, v.scene.entities);
    const t1 = performance.now();
    png = encodePng(img.rgb, img.width, img.height);
    runs.push(t1 - t0 + (performance.now() - t1));
  }
  runs.sort((a, b) => a - b);
  writeFileSync(join(out, `${v.name}.png`), png);
  console.log(
    `${v.name}: render+encode median ${runs[3]?.toFixed(0)} ms (min ${runs[0]?.toFixed(0)}), png ${png.length} bytes`,
  );
}
const m = process.memoryUsage();
console.log(
  `rss ${(m.rss / 1048576).toFixed(0)} MB, heapUsed ${(m.heapUsed / 1048576).toFixed(0)} MB`,
);
