/**
 * The Thought Stream page without Postgres or a shard, for looking at it while changing it. It is Glass's
 * real handler (its static files, type stripping, Content-Security-Policy, Host check and routes) over a pool
 * that answers Glass's own statements from the invented rows in preview-sample.ts, with a live entry every
 * few seconds.
 *
 *   node glass/test/preview.ts [port] [live-entry-seconds]     (defaults: 8788 and 6; 0 means no live entries)
 *
 * It binds 127.0.0.1 only. Test-only: nothing in the Glass runtime imports this file.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createHandler } from '../src/http.ts';
import type { Row, SqlClient, ThoughtCursor } from '../src/query.ts';
import { SseHub } from '../src/sse.ts';
import { LIVE_LINES, type PreviewSample, previewSample } from './preview-sample.ts';

function ms(row: Row): number {
  return Date.parse(String(row.at));
}

/** Newest first, by time and then id: the order of Glass's list statements. */
function newestFirst(a: Row, b: Row): number {
  return ms(b) - ms(a) || String(b.thought_id).localeCompare(String(a.thought_id));
}

/** True when the row is older than the page cursor `(at, id)`; no cursor admits every row. */
function before(row: Row, at: unknown, id: unknown): boolean {
  if (at === null || at === undefined) return true;
  const cut = Date.parse(String(at));
  return ms(row) < cut || (ms(row) === cut && String(row.thought_id) < String(id ?? ''));
}

function since(row: Row, from: unknown): boolean {
  return from === null || from === undefined || ms(row) >= Date.parse(String(from));
}

/**
 * A pool that answers each statement Glass sends, told apart by its text, from the sample. It applies the
 * filters the page uses (agent, outcome, since, the page cursor and the limit). The visibility rules (the
 * delay, hidden living sovereign agents) are the database's work and are not modelled: the preview shows
 * every sample row.
 */
export function previewPool(sample: PreviewSample): SqlClient {
  return {
    async query(text: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
      if (text.includes('glass_journal_page')) {
        const [, , , lifeId, , from, at, id, limit] = values;
        const rows = sample.journal
          .filter((r) => lifeId === null || r.life_id === lifeId)
          .filter((r) => since(r, from) && before(r, at, id))
          .sort(newestFirst);
        return { rows: rows.slice(0, Number(limit)) };
      }
      if (text.includes('FROM thoughts t') && text.includes('ORDER BY t.at DESC')) {
        const [lifeId, , outcome, from, at, id, limit] = values;
        const rows = sample.thoughts
          .filter((r) => lifeId === null || r.life_id === lifeId)
          .filter((r) => outcome === null || (outcome === 'parsed') === (r.parsed !== null))
          .filter((r) => since(r, from) && before(r, at, id))
          .sort(newestFirst);
        return { rows: rows.slice(0, Number(limit)) };
      }
      if (text.includes('WHERE t.thought_id = $1')) {
        // The single-thought statement selects no cursor column.
        const rows = sample.thoughts.filter((r) => r.thought_id === values[0]);
        return { rows: rows.map(({ cursor_at: _cursor, ...row }) => row) };
      }
      if (text.includes('FROM receipts r')) {
        return { rows: sample.receipts.filter((r) => r.action_id === values[0]) };
      }
      if (text.includes('FROM agents a')) return { rows: sample.agents };
      // The stream statements and the owner lookup: the preview's hub has its own feed, and nobody is signed in.
      return { rows: [] };
    },
  };
}

/**
 * The preview's live feed: one new journal line each `everyMs`, by the sample's agents in turn, in the shape
 * the stream sends. Each line also joins the sample, so a reload shows it. `everyMs` 0 gives none.
 */
export function liveFeed(
  sample: PreviewSample,
  everyMs: number,
  now: () => number = Date.now,
): (after: ThoughtCursor) => Promise<Row[]> {
  let next = now() + everyMs;
  let count = 0;
  return async () => {
    if (everyMs <= 0 || now() < next) return [];
    next = now() + everyMs;
    const writer = sample.agents[(count % 2) + 1] as Row;
    const at = new Date(now()).toISOString();
    const row = {
      thought_id: `j-live-${String(count).padStart(4, '0')}`,
      life_id: writer.agent_id,
      at,
      cursor_at: at,
      name: writer.name,
      tier: writer.tier,
    };
    const text = LIVE_LINES[count % LIVE_LINES.length] as string;
    count += 1;
    sample.journal.push({ ...row, journal_text: text });
    return [
      {
        ...row,
        kind: 'journal',
        text,
        wake_reason: null,
        prompt_template_version: null,
        latency_ms: null,
        parsed: null,
      },
    ];
  };
}

export interface Preview {
  server: Server;
  port: number;
  sample: PreviewSample;
  close(): Promise<void>;
}

/** Starts the preview on 127.0.0.1. Port 0 picks a free port. */
export async function startPreview(port: number, liveEveryMs: number): Promise<Preview> {
  const sample = previewSample(Date.now());
  const hub = new SseHub({
    maxClients: 8,
    bufferFrames: 100,
    pollMs: 500,
    heartbeatMs: 15_000,
    start: async () => ({ at: new Date().toISOString(), id: '' }),
    fetch: liveFeed(sample, liveEveryMs),
  });
  const server = createServer(createHandler({ db: previewPool(sample), hub }));
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    server,
    port: (server.address() as AddressInfo).port,
    sample,
    async close() {
      hub.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? 8788);
  const seconds = Number(process.argv[3] ?? 6);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !(seconds >= 0)) {
    console.error('usage: node glass/test/preview.ts [port] [live-entry-seconds]');
    process.exit(2);
  }
  const preview = await startPreview(port, seconds * 1000);
  console.log(`glass preview on http://127.0.0.1:${preview.port}/ (sample data; Ctrl+C stops it)`);
  const stop = (): void => void preview.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
