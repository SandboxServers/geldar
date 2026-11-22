import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const html = readFileSync(new URL('web/kino/index.html', root), 'utf8');
const css = readFileSync(new URL('web/kino/kino.css', root), 'utf8');
const glass = readFileSync(new URL('public/app.css', root), 'utf8');
const main = readFileSync(new URL('web/kino/main.ts', root), 'utf8');

function block(source: string, selector: string): string {
  return source.split(`${selector} {`)[1]?.split('}')[0] ?? '';
}

describe('Kino shares the Glass design', () => {
  it('uses the exact dark palette with the Glass faces and no light scheme', () => {
    const theme = block(glass.split('@media (prefers-color-scheme: dark)')[1] ?? '', ':root');
    const tokens = Object.fromEntries(
      [...theme.matchAll(/(--[\w-]+): ([^;]+);/g)].map((m) => [m[1], m[2]]),
    );
    expect(Object.keys(tokens)).toHaveLength(16);
    const kino = block(css, ':root');
    for (const [name, value] of Object.entries(tokens))
      expect(kino).toContain(`${name}: ${value};`);
    expect(kino).toContain('color-scheme: dark;');
    expect(kino).toContain('--mono: "DM Mono", ui-monospace, monospace;');
    expect(kino).toContain('--serif: "Instrument Serif", serif;');
    expect(css).not.toContain('prefers-color-scheme');
    expect(html).toContain('<link rel="stylesheet" href="/js/fonts.css" />');
    expect(html).toContain('<link rel="stylesheet" href="/js/roster.css" />');
  });

  it('has the four exact links in one labeled landmark', () => {
    expect(html.match(/<nav[\s\S]*?<\/nav>/)?.[0]).toBe(`<nav class="tabs" aria-label="Glass views">
      <a id="tab-glass" href="/">Glass</a>
      <a id="tab-kino" href="/kino/" aria-current="page">Kino</a>
      <a id="tab-map" href="https://map.geldar.sandboxservers.games" rel="noopener noreferrer">Map</a>
      <a id="tab-roster" href="/?view=roster">Roster</a>
    </nav>`);
  });

  it('docks below the wall on phones and moves beside the wall at 700px', () => {
    expect(block(css, '.kino')).toContain('grid-template: minmax(0, 1fr) auto / minmax(0, 1fr);');
    expect(html).toMatch(
      /<main class="kino">[\s\S]+class="wall-pane"[\s\S]+class="channel-pane"[\s\S]+class="dock"[\s\S]+<\/main>\s*<nav/,
    );
    const wide = css.split('@media (min-width: 700px)')[1] ?? '';
    expect(block(wide, '.kino')).toContain(
      'grid-template: minmax(0, 1fr) / repeat(2, minmax(0, 1fr));',
    );
    expect(block(wide, '#guide-inline')).toContain('padding:');
    expect(block(wide, '#open-guide, .guide-close')).toContain('display: none;');
    expect(main).toContain("matchMedia('(width < 700px)')");
  });

  it('uses a native dialog for the phone sheet with its labeled trigger and reduced motion', () => {
    expect(html).toContain('<dialog id="guide" aria-labelledby="guide-title"></dialog>');
    expect(html).toMatch(/id="open-guide"[^>]+aria-haspopup="dialog" aria-controls="guide"/);
    expect(html).toContain('id="guide-inline" aria-labelledby="guide-title" hidden');
    const sheet = block(css, '#guide');
    expect(sheet).toContain('margin: auto 0 0;');
    expect(sheet).toContain('max-height: 70dvh;');
    expect(sheet).toContain('border-top: 1px solid var(--accent);');
    expect(sheet).toContain('border-radius: 18px 18px 0 0;');
    expect(block(css, '#guide[open]')).toContain('animation: rise');
    expect(css.split('@media (prefers-reduced-motion: reduce)')[1]).toContain(
      'animation: none !important;',
    );
  });

  it('keeps channel rows compact with hairlines and a 28px sigil', () => {
    expect(block(css, '.guide-list li')).toContain('border-top: 1px solid var(--rule);');
    expect(block(css, '.guide-list .tune')).toContain('min-height: 51px;');
    expect(block(css, '.guide-list .sigil')).toContain('width: 28px; height: 28px;');
    expect(block(css, '.guide-list .label')).toContain('text-overflow: ellipsis;');
    expect(block(css, '.guide-list .onair')).toContain('color: var(--muted); font-size: 11px;');
    expect(block(css, 'button:disabled')).toContain('opacity: 0.45;');
  });

  it('keeps the short live status inside a positioned element and the guide out of it', () => {
    expect(block(css, '.wall-pane')).toContain('position: relative;');
    expect(block(css, '.guide-list li')).toContain('position: relative;');
    expect(html).toMatch(
      /class="wall-pane"[\s\S]*?<p id="say" class="sr-only" aria-live="polite"><\/p>\s*<\/section>/,
    );
    expect(html.match(/aria-live=/g)).toHaveLength(1);
  });

  it('uses the camera controls and zoom of only the focused monitor', () => {
    expect(main).toContain('cameraControls.replaceChildren(...(a ? [a.frame.controls] : []))');
    expect(main).toContain("if (rig.mode === 'follow') rig.zoomStep(a.level - rig.chase.zoom)");
    expect(main).toContain("frame.setZoom(rig.mode === 'follow' ? rig.chase.zoom : null)");
    expect(main).toContain("if (m) action(m, { kind: 'close' })");
  });
});
