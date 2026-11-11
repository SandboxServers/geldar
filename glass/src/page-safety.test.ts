/**
 * Static checks on the page. Escaping is the page's only defence against stored text, so these
 * tests fail when a markup-from-string or code-from-string API appears under glass/public or in a
 * render module, and when index.html carries an inline script, style or handler.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, get as httpGet } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { createHandler } from './http.ts';
import type { SqlClient } from './query.ts';
import { hostileRow } from './render-fixtures.ts';
import { display, toView } from './render-model.ts';
import { type Doc, renderDetail, renderRow } from './render-view.ts';
import type { SseHub } from './sse.ts';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const SRC = fileURLToPath(new URL('./', import.meta.url));

/** APIs that turn a string into markup, or into code. None may appear in a page source. */
const FORBIDDEN: RegExp[] = [
  /\binnerHTML\b/,
  /\bouterHTML\b/,
  /\binsertAdjacentHTML\b/,
  /\bsetHTMLUnsafe\b/,
  /\bdocument\.write(ln)?\b/,
  /\beval\s*\(/,
  /\bnew\s+Function\b/,
];

/** Every file under glass/public, and every render module (its tests are not served). */
function pageSources(): string[] {
  const served = readdirSync(PUBLIC, { recursive: true }) as string[];
  const files = served.map((name) => join(PUBLIC, name)).filter((path) => statSync(path).isFile());
  const renders = readdirSync(SRC)
    .filter((name) => /^render-.*\.ts$/.test(name) && !name.endsWith('.test.ts'))
    .map((name) => join(SRC, name));
  return [...files, ...renders];
}

/** The lines of one source that use a forbidden API, as "file:line". */
function hitsIn(file: string): string[] {
  const hits: string[] = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (FORBIDDEN.some((re) => re.test(line))) hits.push(`${file}:${i + 1}`);
    });
  return hits;
}

describe('page sources', () => {
  it('use no markup-from-string or code-from-string API', () => {
    const sources = pageSources();
    expect(sources.some((file) => file.endsWith('app.js'))).toBe(true);
    expect(sources.some((file) => file.endsWith('render-view.ts'))).toBe(true);
    const hits = sources.flatMap(hitsIn);
    expect(hits).toEqual([]);
  });

  it('the forbidden patterns catch every sink they name', () => {
    const samples = [
      'node.innerHTML = value;',
      'node.outerHTML = value;',
      'node.insertAdjacentHTML("beforeend", value);',
      'node.setHTMLUnsafe(value);',
      'document.write(value);',
      'document.writeln(value);',
      'eval(value);',
      'const f = new Function(value);',
    ];
    for (const line of samples) {
      expect(
        FORBIDDEN.some((re) => re.test(line)),
        line,
      ).toBe(true);
    }
    expect(FORBIDDEN.some((re) => re.test('const evaluated = retrieval.text;'))).toBe(false);
  });
});

describe('index.html', () => {
  const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');

  it('has no inline style, style element or event-handler attribute', () => {
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('has one module script, and it is the page script from this origin', () => {
    const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
    expect(scripts).toEqual(['<script type="module" src="/app.js">']);
    expect(html).toContain('<script type="module" src="/app.js"></script>');
  });

  it('links one stylesheet from this origin', () => {
    const links = html.match(/<link\b[^>]*>/gi) ?? [];
    expect(links).toEqual(['<link rel="stylesheet" href="/app.css" />']);
  });
});

/** Agent-authored text the page must show as plain text: markup, breakouts, a link, an entity. */
const AGENT_TEXT = [
  '<script>alert(1)</script>',
  '" onmouseover="alert(1)',
  'javascript:alert(1)',
  'a thought with </script><script>alert(2)</script> inside',
  'Tom &amp; Jerry &lt;b&gt;',
  '<img src=x onerror="alert(1)">',
];

/** Elements that agent text must never create in the page. */
const MARKUP_SINKS = ['script', 'img', 'a', 'iframe', 'svg', 'style'];

function get(
  port: number,
  path: string,
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpGet({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

describe('agent text in the rendered page', () => {
  it.each(AGENT_TEXT)(
    'shows %s as text in a row and in the detail, with no new element or handler',
    (text) => {
      const doc = new Window().document;
      const view = toView(hostileRow(text, 0));
      const row = renderRow(doc as unknown as Doc, view, () => {});
      const detail = renderDetail(
        doc as unknown as Doc,
        view,
        JSON.stringify(hostileRow(text, 0)),
        [],
      );
      type DomNode = Parameters<typeof doc.body.append>[number];
      doc.body.append(row as unknown as DomNode, detail as unknown as DomNode);
      for (const tag of MARKUP_SINKS) expect(doc.body.querySelectorAll(tag).length, tag).toBe(0);
      for (const node of Array.from(doc.body.querySelectorAll('*'))) {
        for (const attr of Array.from(node.attributes)) {
          expect(attr.name.startsWith('on'), `${attr.name} on ${node.tagName}`).toBe(false);
        }
      }
      expect(doc.body.textContent).toContain(display(text).slice(0, 40));
    },
  );
});

describe('agent text in the API reply', () => {
  it.each(AGENT_TEXT)('returns %s unchanged as JSON data, never as markup', async (text) => {
    const row = { ...hostileRow(text, 0), model_input: text };
    const db = { query: async () => ({ rows: [row] }) } as unknown as SqlClient;
    const server = createServer(createHandler({ db, hub: {} as unknown as SseHub }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const reply = await get(port, '/api/thoughts/t-0');
      expect(reply.status).toBe(200);
      expect(String(reply.headers['content-type'])).toBe('application/json; charset=utf-8');
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
      const body = JSON.parse(reply.body) as {
        thought: { name: string; model_input: { json: string } };
      };
      expect(body.thought.name).toBe(text);
      expect(body.thought.model_input.json).toBe(text);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
