/**
 * Glass shows no agent board. Owner ruling: no agent-board text on Glass unless agents make it
 * in-game (a later decision). This pins today's "none": the static file set is exactly the page, its
 * stylesheet and its script, and every board-like path is a 404.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { type Running, send, startGlass } from './harness.ts';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

let running: Running | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('no board on Glass', () => {
  it('serves only index.html, app.css and app.js as static files', () => {
    expect(readdirSync(PUBLIC_DIR).sort()).toEqual(['app.css', 'app.js', 'index.html']);
  });

  it.each([
    '/api/board',
    '/board',
    '/api/chronicle',
    '/api/books',
    '/chronicle',
    '/books',
    '/board.html',
  ])('answers %s with 404', async (path) => {
    running = await startGlass();
    const reply = await send(running.port, {
      method: 'GET',
      path,
      host: `127.0.0.1:${running.port}`,
    });
    expect(reply.status).toBe(404);
  });
});
