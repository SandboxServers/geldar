/**
 * Adversarial fixtures through the whole Glass path: a database row (fake pool), the API reply
 * (JSON, nosniff), and the page's DOM (happy-dom, scripts off, no fetch). Every string is inert
 * test data. Each canary is a host the test never contacts (canary.invalid, reserved by RFC 2606),
 * and each global canary is one the payload would set if it ran.
 */
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Row } from '../src/render-model.ts';
import { display, toView } from '../src/render-model.ts';
import { type Doc, renderRow } from '../src/render-view.ts';
import { CORPUS } from './corpus.ts';
import { type Running, send, startGlass } from './harness.ts';

/** Text fields of a thought row; each corpus string goes into every one of them, in turn. */
const TEXT_FIELDS = ['name', 'wake_reason', 'prompt_template_version', 'plan'] as const;

function rowWith(field: (typeof TEXT_FIELDS)[number], value: string, index: number): Row {
  const row: Row = {
    thought_id: `t-${index}`,
    life_id: 'life-1',
    name: 'plain',
    tier: 'local',
    at: '2026-11-10T00:00:00.000Z',
    world_day: 3,
    world_tick: 1200,
    wake_reason: 'plain',
    prompt_template_version: 'v1',
    latency_ms: 812,
    parsed: { plan: 'plain' },
  };
  if (field === 'plan') row.parsed = { plan: value };
  else row[field] = value;
  return row;
}

/** Every element the page could have created from data: a closed set, and no event handler. */
const PAGE_TAGS = new Set([
  'UL',
  'LI',
  'BUTTON',
  'SPAN',
  'DL',
  'DT',
  'DD',
  'SECTION',
  'H3',
  'PRE',
  'P',
  'DIV',
  'SELECT',
  'OPTION',
]);

function newPage(): { win: Window; doc: Doc } {
  const win = new Window({
    url: 'http://127.0.0.1/',
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      disableComputedStyleRendering: true,
    },
  });
  return { win, doc: win.document as unknown as Doc };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __glassCanary?: unknown }).__glassCanary;
});

describe('adversarial fixtures through the API', () => {
  let running: Running | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  it('returns every hostile value as JSON data: application/json, nosniff, and a round trip to the same string', async () => {
    const rows = CORPUS.flatMap((c, i) => TEXT_FIELDS.map((f) => rowWith(f, c.value, i)));
    running = await startGlass(rows);
    const reply = await send(running.port, {
      method: 'GET',
      path: '/api/thoughts?limit=100',
      host: `127.0.0.1:${running.port}`,
    });
    expect(reply.status).toBe(200);
    expect(String(reply.headers['content-type'])).toMatch(/^application\/json/);
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    const parsed = JSON.parse(reply.body) as { thoughts: Row[] };
    expect(parsed.thoughts).toHaveLength(rows.length);
    rows.forEach((row, i) => {
      const got = parsed.thoughts[i] ?? {};
      for (const field of TEXT_FIELDS) {
        const want = field === 'plan' ? (row.parsed as Row).plan : row[field];
        const have = field === 'plan' ? (got.parsed as Row).plan : got[field];
        expect(have, `${field} of ${rows[i]?.thought_id}`).toBe(want);
      }
    });
  });

  it('keeps a hostile string inside its JSON string: no reply byte escapes a quoted value', async () => {
    const rows = CORPUS.map((c, i) => rowWith('name', `${c.value}"}],"injected":true,"x":"`, i));
    running = await startGlass(rows);
    const reply = await send(running.port, {
      method: 'GET',
      path: '/api/thoughts?limit=100',
      host: `127.0.0.1:${running.port}`,
    });
    const parsed = JSON.parse(reply.body) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['thoughts', 'next']);
  });

  it('returns a deeply nested model_input as a capped JSON string, not as parsed structure', async () => {
    const deep = JSON.parse(`${'['.repeat(400)}1${']'.repeat(400)}`);
    running = await startGlass([{ thought_id: 't1', model_input: deep, parsed: null }]);
    const reply = await send(running.port, {
      method: 'GET',
      path: '/api/thoughts/t1',
      host: `127.0.0.1:${running.port}`,
    });
    expect(reply.status).toBe(200);
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(String(reply.headers['content-type'])).toMatch(/^application\/json/);
    expect(JSON.parse(reply.body)).toBeTypeOf('object');
  });
});

describe('adversarial fixtures through the page', () => {
  it.each(CORPUS.map((c) => [c.name, c.value] as const))(
    'renders %s as text only: no element, attribute, handler, request or script from data',
    (_name, value) => {
      const fetchSpy = vi.fn(() => Promise.reject(new Error('no network from the page')));
      vi.stubGlobal('fetch', fetchSpy);
      const { win, doc } = newPage();
      for (const field of TEXT_FIELDS) {
        const row = renderRow(doc, toView(rowWith(field, value, 1)), () => {});
        doc.body.appendChild(row as never);
      }
      const all = [...doc.body.querySelectorAll('*')] as Element[];
      for (const el of all) {
        expect(PAGE_TAGS.has(el.tagName), `tag ${el.tagName}`).toBe(true);
        for (const attr of [...el.attributes]) {
          expect(attr.name.startsWith('on'), `handler ${attr.name}`).toBe(false);
          expect(['class', 'type', 'value'].includes(attr.name), `attribute ${attr.name}`).toBe(
            true,
          );
        }
      }
      expect(
        doc.body.querySelectorAll('script,img,iframe,link,base,meta,style,form,object,embed')
          .length,
      ).toBe(0);
      expect(doc.body.textContent).toContain(display(value).slice(0, 200));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((globalThis as { __glassCanary?: unknown }).__glassCanary).toBeUndefined();
      expect((win as unknown as { __glassCanary?: unknown }).__glassCanary).toBeUndefined();
      void win.close();
    },
  );
});
