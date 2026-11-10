/**
 * Hostile text on the live stream. Stream rows carry the same corpus as the API. Each frame must
 * stay one SSE event: one `data:` line, JSON-escaped, so a newline or a fake `event:` line inside a
 * value cannot start a second event or change the event name.
 */
import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { CORPUS } from './corpus.ts';
import { type Running, startGlass } from './harness.ts';

let running: Running | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** Thought events in a stream body. A blank line ends an event, so the count is by event, not by text. */
function thoughtEvents(body: string): string[] {
  return body.split('\n\n').filter((f) => f.startsWith('event: thought'));
}

/** Reads the stream until `want` thought events have arrived, or fails after 4 seconds. */
function readFrames(port: number, want: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/api/stream', headers: { Host: `127.0.0.1:${port}` } },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          if (thoughtEvents(body).length >= want) {
            req.destroy();
            resolve(body);
          }
        });
      },
    );
    req.on('error', (err) => {
      if (thoughtEvents(body).length >= want) resolve(body);
      else reject(err);
    });
    req.setTimeout(4000, () => {
      req.destroy();
      reject(new Error(`only ${thoughtEvents(body).length} of ${want} events arrived`));
    });
    req.end();
  });
}

describe('adversarial fixtures on the live stream', () => {
  it('sends each hostile thought as one event with one data line, JSON-escaped, and the same value back', async () => {
    const rows = CORPUS.map((c, i) => ({
      thought_id: `s-${i}`,
      life_id: 'life-1',
      name: `${c.value}\n\nevent: thought\ndata: {"injected":true}\n\n`,
      tier: 'local',
      at: '2026-11-10T00:00:00.000Z',
      world_day: 3,
      world_tick: 1200,
      wake_reason: c.value,
      prompt_template_version: 'v1',
      latency_ms: 1,
      parsed: { plan: c.value },
      cursor_at: '2026-11-10T00:00:00.000Z',
    }));
    running = await startGlass([], rows);
    const body = await readFrames(running.port, rows.length);
    const frames = thoughtEvents(body);
    expect(frames).toHaveLength(rows.length);
    frames.forEach((frame, i) => {
      const lines = frame.split('\n');
      expect(lines.filter((l) => l.startsWith('data: '))).toHaveLength(1);
      expect(lines[0]).toBe('event: thought');
      const data = JSON.parse(
        lines.find((l) => l.startsWith('data: '))?.slice(6) ?? 'null',
      ) as Record<string, unknown>;
      expect(data.thought_id).toBe(`s-${i}`);
      expect(data.wake_reason).toBe(CORPUS[i]?.value);
      expect(data.name).toBe(rows[i]?.name);
      expect(data).not.toHaveProperty('cursor_at');
    });
  });
});
