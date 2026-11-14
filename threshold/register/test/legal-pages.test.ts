import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { renderModule } from '../scripts/gen-legal.ts';
import { TERMS_VERSION } from '../src/account.ts';
import { escapeHtml, renderMarkdown } from '../src/legal-render.ts';
import { LEGAL_SOURCE_SHA256, LEGAL_TEXTS } from '../src/legal-texts.generated.ts';
import { type Harness, harness } from './fixture.ts';

let h: Harness | undefined;

afterEach(async () => {
  if (h) await new Promise<void>((resolve) => h?.server.close(() => resolve()));
  h = undefined;
});

/** The three approved files, by the key the generated module uses and the route they are served at. */
const PAGES = [
  { key: 'terms', file: 'terms.md', route: '/register/terms' },
  { key: 'privacy', file: 'privacy.md', route: '/register/privacy' },
  { key: 'acceptable-use', file: 'acceptable-use.md', route: '/register/acceptable-use' },
] as const;

const LEGAL_DIR = new URL('../../../docs/legal/', import.meta.url);
const SCRIPT = fileURLToPath(new URL('../scripts/gen-legal.ts', import.meta.url));

function source(file: string): string {
  return readFileSync(new URL(file, LEGAL_DIR), 'utf8');
}

/** The text of each markdown line, without its marker: the words a reader must find on the page. */
function lineTexts(md: string): string[] {
  return md
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^-\s+/, '')
        .trim(),
    )
    .filter((line) => line.length > 0);
}

describe('legal pages served from the approved files (LEGAL-SERVE)', () => {
  for (const page of PAGES) {
    it(`serves ${page.file} at ${page.route} with every line of the file`, async () => {
      h = await harness();
      const res = await fetch(`${h.base}${page.route}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      for (const line of lineTexts(source(page.file))) expect(body).toContain(escapeHtml(line));
    });

    it(`embeds the exact bytes of ${page.file} (source hash matches)`, () => {
      const text = source(page.file);
      expect(LEGAL_TEXTS[page.key]).toBe(text);
      expect(LEGAL_SOURCE_SHA256[page.key]).toBe(createHash('sha256').update(text).digest('hex'));
    });

    it(`serves ${page.file} as an HTML page with no script`, async () => {
      h = await harness();
      const res = await fetch(`${h.base}${page.route}`);
      expect(res.headers.get('content-type')).toContain('text/html');
      const body = await res.text();
      expect(body.startsWith('<!doctype html>')).toBe(true);
      expect(body).not.toMatch(/<script/i);
    });
  }

  it('shows the version stamp on the terms page and the stamp equals TERMS_VERSION', async () => {
    h = await harness();
    const body = await (await fetch(`${h.base}/register/terms`)).text();
    expect(body).toContain('Version 1, effective 2026-11-11, approved by the owner');
    const header = /^Version (\d+),/m.exec(source('terms.md'));
    expect(header?.[1]).toBe(TERMS_VERSION.replace(/^v/, ''));
    expect(TERMS_VERSION).toBe('v1');
  });

  it('links the terms, privacy and acceptable-use pages from the sign-up page', async () => {
    h = await harness();
    const body = await (await fetch(`${h.base}/register/`)).text();
    expect(body).toContain('href="/register/terms"');
    expect(body).toContain('href="/register/privacy"');
    expect(body).toContain('href="/register/acceptable-use"');
    expect(body).toContain('name="consent"');
  });

  it('keeps the kill switch ahead of the legal routes', async () => {
    h = await harness({ killSwitch: true });
    for (const page of PAGES) {
      const res = await fetch(`${h.base}${page.route}`);
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain(escapeHtml(lineTexts(source(page.file))[0] ?? ''));
    }
  });
});

describe('markdown render is safe (no raw HTML pass-through)', () => {
  it('escapes raw HTML and does not render links from hostile markdown', () => {
    const out = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[click](javascript:alert(1))',
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/<a /i);
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('renders headings, paragraphs and list items', () => {
    const out = renderMarkdown(
      '# Title\n\nFirst line\nsecond line\n\n- item one\n- item two\n\n## Part',
    );
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<p>First line second line</p>');
    expect(out).toContain('<ul><li>item one</li><li>item two</li></ul>');
    expect(out).toContain('<h2>Part</h2>');
  });
});

describe('generated legal module (scripts/gen-legal.ts)', () => {
  it('the committed module equals a fresh regeneration from docs/legal', () => {
    const committed = readFileSync(
      new URL('../src/legal-texts.generated.ts', import.meta.url),
      'utf8',
    );
    expect(committed).toBe(renderModule(fileURLToPath(LEGAL_DIR)));
  });

  it.each(PAGES.map((page) => page.file))(
    'exits non-zero and names %s when it is empty, so no empty page is built',
    (empty) => {
      const dir = mkdtempSync(join(tmpdir(), 'legal-gen-'));
      try {
        mkdirSync(join(dir, 'legal'));
        for (const page of PAGES) {
          writeFileSync(join(dir, 'legal', page.file), page.file === empty ? '' : '# Text\n');
        }
        const res = spawnSync(process.execPath, [SCRIPT, join(dir, 'legal')], { encoding: 'utf8' });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain(empty);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('exits non-zero and names the file when one is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legal-gen-'));
    try {
      mkdirSync(join(dir, 'legal'));
      writeFileSync(join(dir, 'legal', 'terms.md'), '# Terms\n');
      writeFileSync(join(dir, 'legal', 'privacy.md'), '# Privacy\n');
      const res = spawnSync(process.execPath, [SCRIPT, join(dir, 'legal')], { encoding: 'utf8' });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('acceptable-use.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('every approved file carries the version header, and its number equals TERMS_VERSION', () => {
    const header = 'Version 1, effective 2026-11-11, approved by the owner.';
    for (const page of PAGES) {
      const lines = source(page.file).split('\n');
      expect(lines, page.file).toContain(header);
      const number = /^Version (\d+),/m.exec(source(page.file))?.[1];
      expect(`v${number}`, page.file).toBe(TERMS_VERSION);
    }
  });
});
