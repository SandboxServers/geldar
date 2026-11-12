// Test fixture for render-host.test.ts: a worker that takes every render and never answers.
// No production code imports this file.
import { parentPort } from 'node:worker_threads';

parentPort?.on('message', () => undefined);
