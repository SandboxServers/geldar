/**
 * Static checks on the page. Escaping is the page's only defence against stored text, so these
 * tests fail when a markup-from-string or code-from-string API appears under glass/public or in a
 * render module, and when index.html carries an inline script, style or handler.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
      expect(FORBIDDEN.some((re) => re.test(line)), line).toBe(true);
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
