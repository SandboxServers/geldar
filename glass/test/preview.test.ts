/**
 * The page preview (preview.ts): Glass's real handler over sample rows. These cases pin that it is the real
 * handler (the security headers, the page, the routes) and that its fake pool pages, filters and feeds the
 * way the page needs, so what a designer looks at behaves like the live page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../src/http.ts';
import { send } from './harness.ts';
import { liveFeed, type Preview, startPreview } from './preview.ts';
import { previewSample } from './preview-sample.ts';

let preview: Preview | undefined;

afterEach(async () => {
  await preview?.close();
  preview = undefined;
});

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const port = preview?.port ?? 0;
  const reply = await send(port, { method: 'GET', path, host: `127.0.0.1:${port}` });
  return { status: reply.status, body: JSON.parse(reply.body) as Record<string, unknown> };
}

function ids(body: Record<string, unknown>): string[] {
  return (body.thoughts as { thought_id: string }[]).map((t) => t.thought_id);
}

describe('the page preview', () => {
  it('serves the page and its script through the real handler, with the security headers', async () => {
    preview = await startPreview(0, 0);
    const host = `127.0.0.1:${preview.port}`;
    const page = await send(preview.port, { method: 'GET', path: '/', host });
    expect(page.status).toBe(200);
    expect(page.body).toContain('<title>Glass: Thought Stream</title>');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(page.headers[name.toLowerCase()], name).toBe(value);
    }
    const model = await send(preview.port, { method: 'GET', path: '/js/render-model.ts', host });
    expect(model.status).toBe(200);
    // The same refusals as the live server: a write, and a Host that is not loopback.
    expect((await send(preview.port, { method: 'POST', path: '/api/agents', host })).status).toBe(
      405,
    );
    expect(
      (await send(preview.port, { method: 'GET', path: '/', host: 'example.com' })).status,
    ).toBe(421);
  });

  it('lists the sample agents, one of them dead and one with a hostile name', async () => {
    preview = await startPreview(0, 0);
    const agents = (await get('/api/agents')).body.agents as Record<string, unknown>[];
    expect(agents.map((a) => a.agent_id)).toContain('ag_owl_01');
    expect(agents.filter((a) => a.died_at !== null).map((a) => a.name)).toEqual(['Owl']);
    expect(agents.some((a) => String(a.name).includes('\u202E'))).toBe(true);
  });

  it('pages newest first through thoughts and journal lines together, with no row twice', async () => {
    preview = await startPreview(0, 0);
    const first = (await get('/api/thoughts?limit=50')).body;
    const firstIds = ids(first);
    expect(firstIds).toHaveLength(50);
    expect(firstIds.slice(0, 3)).toEqual(['j-9000', 't-0003', 'j-8999']);
    const kinds = (first.thoughts as Record<string, unknown>[]).map((t) => t.kind ?? 'thought');
    expect(new Set(kinds)).toEqual(new Set(['journal', 'thought']));
    const times = (first.thoughts as { at: string }[]).map((t) => Date.parse(t.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(typeof first.next).toBe('string');
    const older = (await get(`/api/thoughts?limit=100&cursor=${String(first.next)}`)).body;
    const olderIds = ids(older);
    expect(olderIds).toHaveLength(100);
    expect(olderIds.filter((id) => firstIds.includes(id))).toEqual([]);
    const last = (await get(`/api/thoughts?limit=100&cursor=${String(older.next)}`)).body;
    expect(ids(last)).toHaveLength(158 - 150);
    expect(last.next).toBeNull();
  });

  it('applies the agent, outcome and since filters the page sends', async () => {
    preview = await startPreview(0, 0);
    const ada = (await get('/api/thoughts?limit=50&agent=ag_ada_01')).body;
    expect(ids(ada)).toEqual(['t-0003', 't-0002']);
    const unparsed = (await get('/api/thoughts?limit=50&outcome=unparsed')).body;
    expect(ids(unparsed)).toEqual(['t-0002']);
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const recent = (await get(`/api/thoughts?limit=100&since=${encodeURIComponent(hourAgo)}`)).body;
    expect(ids(recent).length).toBeGreaterThan(5);
    expect(ids(recent).length).toBeLessThan(15);
  });

  it('answers one thought and the receipts of its action', async () => {
    preview = await startPreview(0, 0);
    const { thought } = (await get('/api/thoughts/t-0003')).body as {
      thought: Record<string, unknown>;
    };
    expect(thought.wake_reason).toBe('damage');
    expect(thought).not.toHaveProperty('cursor_at');
    const { receipts } = (await get(`/api/receipts?action_id=${String(thought.action_id)}`)).body;
    expect((receipts as { item: string }[]).map((r) => r.item)).toEqual(['bread', 'cobblestone']);
    expect((await get('/api/thoughts/no-such-id')).status).toBe(404);
  });
});

describe('the preview live feed', () => {
  it('gives one new journal line per interval, in the stream shape, and adds it to the sample', async () => {
    const sample = previewSample(Date.parse('2026-11-10T12:00:00Z'));
    const lines = sample.journal.length;
    let now = Date.parse('2026-11-10T12:00:00Z');
    const fetch = liveFeed(sample, 5000, () => now);
    const cursor = { at: '', id: '' };
    expect(await fetch(cursor)).toEqual([]);
    now += 4999;
    expect(await fetch(cursor)).toEqual([]);
    now += 1;
    const [row] = await fetch(cursor);
    expect(row).toMatchObject({ thought_id: 'j-live-0000', kind: 'journal', parsed: null });
    expect(row?.cursor_at).toBe(new Date(now).toISOString());
    expect(String(row?.text).length).toBeGreaterThan(10);
    expect(await fetch(cursor)).toEqual([]);
    expect(sample.journal).toHaveLength(lines + 1);
    now += 5000;
    expect((await fetch(cursor))[0]?.thought_id).toBe('j-live-0001');
  });

  it('gives nothing when live entries are off', async () => {
    const sample = previewSample(0);
    let now = 0;
    const fetch = liveFeed(sample, 0, () => now);
    now += 60_000;
    expect(await fetch({ at: '', id: '' })).toEqual([]);
  });
});

describe('the preview sample', () => {
  it('holds a line longer than the journal preview, hostile text, and no raw invisible character in its source', async () => {
    const sample = previewSample(Date.now());
    const texts = sample.journal.map((r) => String(r.journal_text));
    expect(texts.some((t) => t.length > 600)).toBe(true);
    expect(texts.some((t) => t.includes('<img src=x') && /\u{E0069}/u.test(t))).toBe(true);
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./preview-sample.ts', import.meta.url), 'utf8');
    expect(/(?![\t\n\r])[\p{Cc}\p{Cf}]/u.test(source)).toBe(false);
  });
});
