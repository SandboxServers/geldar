// The worker thread's entry: renders one scene from its block snapshot and posts back the PNG.
// It holds no bot and no server data: only the snapshot, the eye, the look and the entities in sight.

import { parentPort } from 'node:worker_threads';
import { renderViewportPng } from '../viewport/index.ts';
import type { RenderScene } from './reader.ts';
import { SNAPSHOT_RANGE, snapshotWorld } from './snapshot.ts';

if (parentPort === null) throw new Error('render-worker must run in a worker thread');
const port = parentPort;

port.on('message', (message: { id: number; scene: RenderScene }) => {
  const { id, scene } = message;
  try {
    const png = renderViewportPng({
      world: snapshotWorld(scene.snapshot),
      eye: scene.eye,
      yaw: scene.yaw,
      pitch: scene.pitch,
      entities: scene.entities,
      options: { width: scene.width, height: scene.height, range: SNAPSHOT_RANGE },
    });
    port.postMessage({ id, png: new Uint8Array(png) });
  } catch (error) {
    port.postMessage({ id, error: String(error) });
  }
});
