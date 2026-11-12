// Test fixture for render-host.test.ts: a worker that crashes on a scene with yaw 1234 and answers
// every other scene with a PNG signature. No production code imports this file.
import { parentPort } from 'node:worker_threads';

parentPort?.on('message', (message: { id: number; scene: { yaw: number } }) => {
  if (message.scene.yaw === 1234) process.exit(1);
  parentPort?.postMessage({ id: message.id, png: Uint8Array.of(137, 80, 78, 71) });
});
