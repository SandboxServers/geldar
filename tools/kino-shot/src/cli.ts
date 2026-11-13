// kino-shot: one page load of a Kino page in headless Chromium, evidence saved to disk.
// Anonymous only: no login, no cookies stored, no credentials written.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { parseArgs } from './args.ts';
import {
  buildSummary,
  checksFrom,
  type PixelFractions,
  pixelFractions,
  redact,
  tally,
} from './evidence.ts';

// Software WebGL flags verified on Windows (see docs/runbooks/kino.md).
export const GL_FLAGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36';

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2), process.env);
  // pnpm runs the script in the package dir; INIT_CWD is where the user typed the command.
  const out = resolve(process.env.INIT_CWD ?? process.cwd(), args.out);
  mkdirSync(out, { recursive: true });
  const origin = new URL(args.url).origin;

  const browser = await chromium.launch({ headless: true, args: GL_FLAGS });
  const context = await browser.newContext({
    viewport: args.viewport,
    userAgent: MOBILE_UA,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const log: string[] = [];
  const statuses: string[] = [];
  const wsTypes: string[] = [];
  let count429 = 0;
  const pathOf = (u: string): string => {
    const x = new URL(u);
    return x.pathname;
  };
  page.on('console', (m) => log.push(`console.${m.type()}: ${redact(m.text())}`));
  page.on('pageerror', (e) => log.push(`pageerror: ${redact(String(e.message ?? e))}`));
  page.on('requestfailed', (r) => {
    log.push(
      `requestfailed: ${r.method()} ${pathOf(r.url())} ${redact(r.failure()?.errorText ?? '')}`,
    );
  });
  page.on('response', (r) => {
    statuses.push(String(r.status()));
    if (r.url().startsWith(origin) && r.status() >= 400) {
      const mark = r.status() === 429 ? '!!! 429 ' : '';
      if (r.status() === 429) count429++;
      log.push(`${mark}http ${r.status()} ${r.request().method()} ${pathOf(r.url())}`);
    }
  });
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      if (typeof f.payload !== 'string') {
        wsTypes.push('binary');
        return;
      }
      try {
        const t = (JSON.parse(f.payload) as { type?: unknown }).type;
        wsTypes.push(typeof t === 'string' ? t.slice(0, 40) : 'untyped');
      } catch {
        wsTypes.push('text');
      }
    });
  });

  // The page's own camera list (no extra request): agent id -> the label the page shows.
  const targetsReply = page
    .waitForResponse((r) => pathOf(r.url()) === '/kino/targets', { timeout: 20_000 })
    .then((r) => r.json() as Promise<{ agents?: { id?: unknown; label?: unknown }[] }>)
    .catch(() => null);
  await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  let pickerOptions = 0;
  try {
    // The channel guide is filled once the texture atlas is built (decision 0161); a first visit
    // tunes CH 1 to the first agent by itself.
    await page.waitForFunction(
      () =>
        document.querySelectorAll('#guide .guide-list li').length > 0 ||
        /atlas FAILED/.test(document.getElementById('status')?.textContent ?? ''),
      undefined,
      { timeout: 60_000 },
    );
    pickerOptions = await page.locator('#guide .guide-list li').count();
    if (args.agent) {
      const agents = (await targetsReply)?.agents ?? [];
      const hit = agents.find((a) => a.id === args.agent || a.label === args.agent);
      const label = typeof hit?.label === 'string' ? hit.label : args.agent;
      await page.locator('#open-guide').click();
      await page
        .locator('#guide .guide-list li .tune', { hasText: label })
        .first()
        .click({ timeout: 3000 });
    }
    if (args.mode !== 'follow') {
      const name = args.mode === 'orbit' ? 'Orbit camera' : 'Free camera';
      await page.locator(`.monitor.active [aria-label="${name}"]`).click({ force: true });
    }
  } catch (e) {
    log.push(`setup: ${redact(String((e as Error).message).split('\n')[0] ?? '')}`);
  }
  await page.waitForTimeout(args.seconds * 1000);

  const files = {
    screenshot: join(out, 'screenshot.png'),
    canvas: join(out, 'canvas.png'),
    status: join(out, 'status.txt'),
    console: join(out, 'console.log'),
    network: join(out, 'network-summary.json'),
  };
  await page.screenshot({ path: files.screenshot, fullPage: true });

  let fractions: PixelFractions | null = null;
  const canvas = page.locator('.monitor:not(.empty) canvas').first();
  if ((await canvas.count()) > 0) {
    // Element screenshots composite the page, so a canvas without preserveDrawingBuffer is not blank.
    const png = await canvas.screenshot({ path: files.canvas });
    const sampled = await page.evaluate(async (b64: string) => {
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 96;
      const ctx = c.getContext('2d');
      if (!ctx) return [] as number[];
      ctx.drawImage(bmp, 0, 0, 96, 96);
      return Array.from(ctx.getImageData(0, 0, 96, 96).data);
    }, png.toString('base64'));
    fractions = pixelFractions(Uint8Array.from(sampled));
  }

  const statusTexts = await page.evaluate(() =>
    [...document.querySelectorAll('#notice, #status, .monitor .status, .monitor .msg')]
      .map((e) => (e.textContent ?? '').trim())
      .filter((t) => t.length > 0),
  );
  writeFileSync(files.status, `${statusTexts.map(redact).join('\n')}\n`);
  writeFileSync(files.console, `${log.join('\n')}\n`);
  writeFileSync(
    files.network,
    `${JSON.stringify({ httpStatus: tally(statuses), wsMessageTypes: tally(wsTypes) }, null, 2)}\n`,
  );
  await browser.close();

  const summary = buildSummary(
    checksFrom(pickerOptions, statusTexts, fractions),
    fractions,
    files,
    count429,
  );
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return summary.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`kino-shot: ${redact(String((e as Error).message ?? e))}\n`);
    process.exit(2);
  },
);
