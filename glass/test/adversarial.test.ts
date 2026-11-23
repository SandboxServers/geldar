/**
 * Adversarial fixtures through the whole Glass path: a database row (fake pool), the API reply
 * (JSON, nosniff), and the page's DOM (happy-dom, scripts off, no fetch). Every string is inert
 * test data. Each canary is a host the test never contacts (canary.invalid, reserved by RFC 2606),
 * and each global canary is one the payload would set if it ran.
 */
import { type Element, Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderDetail, renderReaderHead } from '../src/render-detail.ts';
import type { Row } from '../src/render-model.ts';
import { display, toView } from '../src/render-model.ts';
import { type Doc, type El, renderChips, renderRow } from '../src/render-view.ts';
import { auditTree, freshDoc } from './audit.ts';
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
  'CANVAS',
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

  it('returns a thought as JSON with no model_input and no raw_output, however nested', async () => {
    const deep = JSON.parse(`${'['.repeat(400)}1${']'.repeat(400)}`);
    running = await startGlass([
      { thought_id: 't1', model_input: deep, raw_output: 'secret', parsed: null },
    ]);
    const reply = await send(running.port, {
      method: 'GET',
      path: '/api/thoughts/t1',
      host: `127.0.0.1:${running.port}`,
    });
    expect(reply.status).toBe(200);
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(String(reply.headers['content-type'])).toMatch(/^application\/json/);
    const thought = (JSON.parse(reply.body) as { thought: Record<string, unknown> }).thought;
    expect(thought.thought_id).toBe('t1');
    expect(thought).not.toHaveProperty('model_input');
    expect(thought).not.toHaveProperty('raw_output');
    expect(reply.body).not.toContain('secret');
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
        win.document.body.appendChild(row as never);
      }
      const all = [...win.document.body.querySelectorAll('*')] as Element[];
      for (const el of all) {
        expect(PAGE_TAGS.has(el.tagName), `tag ${el.tagName}`).toBe(true);
        for (const attr of [...el.attributes]) {
          expect(attr.name.startsWith('on'), `handler ${attr.name}`).toBe(false);
          // A sigil canvas carries its fixed size and aria-hidden; nothing else has an attribute but class and type.
          expect(
            ['class', 'type', 'width', 'height', 'aria-hidden'].includes(attr.name),
            `attribute ${attr.name}`,
          ).toBe(true);
        }
      }
      expect(
        win.document.body.querySelectorAll(
          'script,img,iframe,link,base,meta,style,form,object,embed',
        ).length,
      ).toBe(0);
      expect(win.document.body.textContent).toContain(display(value).slice(0, 200));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((globalThis as { __glassCanary?: unknown }).__glassCanary).toBeUndefined();
      expect((win as unknown as { __glassCanary?: unknown }).__glassCanary).toBeUndefined();
      void win.close();
    },
  );
});

describe('adversarial fixtures through the detail, the reader head and the agent chips', () => {
  it.each(CORPUS.map((c) => [c.name, c.value] as const))(
    'renders %s as text only in the detail, the reader head and the chips',
    (_name, value) => {
      // The detail: the hostile text in every receipt field, and the copied entry as plain text.
      const detailDoc = freshDoc();
      const detailBody = detailDoc.body as unknown as El;
      const receipts = [{ kind: value, phase: value, item: value, count: 1, credits: 2 }];
      const copied: string[] = [];
      detailBody.append(
        renderDetail(detailDoc as unknown as Doc, toView(rowWith('plan', value, 1)), receipts, {
          onCopy: (text) => copied.push(text),
        }),
      );
      auditTree(detailDoc.body);
      expect(detailDoc.body.textContent).toContain(display(value).slice(0, 40));
      // A phase the page does not know gets no colour of its own: it is world text, not a class.
      expect(detailDoc.body.querySelector('.outcome')?.className).toBe('outcome other');
      (detailDoc.body.querySelector('button.copy') as unknown as { click(): void }).click();
      expect(copied).toHaveLength(1);
      expect(copied[0]).toContain(display(value));

      // The reader head: every text field in turn, with a search keyword marked.
      for (const field of TEXT_FIELDS) {
        const headDoc = freshDoc();
        const headBody = headDoc.body as unknown as El;
        headBody.append(
          ...renderReaderHead(headDoc as unknown as Doc, toView(rowWith(field, value, 2)), {
            keyword: 'alert',
          }),
        );
        auditTree(headDoc.body);
        expect(headDoc.body.innerHTML).not.toMatch(/<(script|img|svg|iframe|a|style)[\s>]/i);
      }

      // The agent chips: a hostile agent name, and a press reports the chip's position.
      const chipDoc = freshDoc();
      const row = chipDoc.createElement('div');
      chipDoc.body.append(row);
      const picked: number[] = [];
      const { buttons } = renderChips(
        chipDoc as unknown as Doc,
        row as unknown as El,
        [{ name: value, dead: false }],
        0,
        (index) => picked.push(index),
      );
      auditTree(chipDoc.body);
      expect(buttons).toHaveLength(2);
      expect(row.querySelectorAll('.chip-name')[1]?.textContent).toContain(
        display(value).slice(0, 40),
      );
      (buttons[1] as unknown as { click(): void }).click();
      expect(picked).toEqual([0]);

      expect((globalThis as { __glassCanary?: unknown }).__glassCanary).toBeUndefined();
    },
  );
});
