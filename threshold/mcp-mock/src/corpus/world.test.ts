import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { loadTokens } from '../auth.ts';
import type { MockHttp } from '../server.ts';
import { fitResult } from '../sim/present.ts';
import { createSimWorld } from '../sim/sim-world.ts';
import { type CorpusItem, hostileTexts, loadCorpus, loadCorpusIndex } from './corpus.ts';

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(PACKAGE_DIR, 'scenarios', 'malicious');
const TOKEN = 'token-for-player-a-0123456789';
const PLAYER = 'aa';
const MAX_RESULT_BYTES = 16000;
const FORBIDDEN_KEYS = new Set(['instructions', 'system', 'command']);
const WRAPPER = 'untrusted_world_text';

let dir: string;
let http: MockHttp | undefined;
let client: Client | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'corpus-world-'));
});

afterEach(async () => {
  await client?.close().catch(() => undefined);
  client = undefined;
  await http?.close();
  http = undefined;
  rmSync(dir, { recursive: true, force: true });
}, 10_000);

/** Starts the mock in process with the scenario and connects a plain MCP client to it. */
async function startMock(item: CorpusItem) {
  const file = join(dir, 'tokens.json');
  writeFileSync(file, JSON.stringify({ [PLAYER]: TOKEN }));
  const world = createSimWorld({ scenario: item.scenario });
  http = createApp({ tokens: loadTokens(file), world, log: () => undefined });
  const port = await http.listen(0);
  const c = new Client({ name: 'test', version: '0.0.0' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/p/${PLAYER}`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
  client = c;
  return { c, world };
}

const seen: unknown[] = [];

async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 60_000 });
  const text = (r.content as { text: string }[])[0]?.text ?? '';
  expect(r.isError, text).not.toBe(true);
  const parsed = JSON.parse(text);
  seen.push(parsed);
  return parsed;
}

/** Every key at any depth. */
function allKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const k of v) allKeys(k, out);
  else if (typeof v === 'object' && v !== null)
    for (const [k, kid] of Object.entries(v)) {
      out.push(k);
      allKeys(kid, out);
    }
  return out;
}

/** Every string leaf outside the `untrusted_world_text` wrapper, with its path. */
function outsideWrapper(v: unknown, path = '', out: Array<[string, string]> = []) {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v))
    for (const [i, k] of v.entries()) outsideWrapper(k, `${path}[${i}]`, out);
  else if (typeof v === 'object' && v !== null)
    for (const [k, kid] of Object.entries(v)) {
      if (k !== WRAPPER) outsideWrapper(kid, path === '' ? k : `${path}.${k}`, out);
    }
  return out;
}

/** The longest run of a hostile text's words that a result string shares with it (min 12 chars). */
function sharesHostileText(value: string, texts: string[]): boolean {
  return (
    value.length >= 12 && texts.some((t) => t.includes(value) || value.includes(t.slice(0, 40)))
  );
}

describe('the world side of the malicious-book corpus', () => {
  const index = loadCorpusIndex(DIR);

  it('has a file for every entry, so none is skipped', () => {
    expect(index).toHaveLength(9);
    for (const e of index) expect(existsSync(join(DIR, e.file)), e.file).toBe(true);
    expect(loadCorpus(DIR)).toHaveLength(9);
  });

  it('keeps the image build context from excluding the corpus files', () => {
    const lines = readFileSync(join(PACKAGE_DIR, 'Dockerfile.dockerignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    const paths = [
      'threshold/mcp-mock/scenarios/malicious/corpus.json',
      ...index.map((e) => `threshold/mcp-mock/scenarios/malicious/${e.file}`),
    ];
    let excluded = false;
    for (const line of lines) {
      const negate = line.startsWith('!');
      const pattern = (negate ? line.slice(1) : line).replace(/^\/+/, '').replace(/\/+$/, '');
      const re = new RegExp(
        `^${pattern
          .split('**/')
          .map((part) =>
            part
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*\*/g, '.*')
              .replace(/\*/g, '[^/]*')
              .replace(/\?/g, '[^/]'),
          )
          .join('(?:.*/)?')}$`,
      );
      for (const p of paths) {
        const parts = p.split('/');
        const hit = parts.some((_, i) => re.test(parts.slice(0, i + 1).join('/')));
        if (hit && !negate) excluded = true;
        if (hit && negate) excluded = false;
      }
    }
    expect(excluded).toBe(false);
  });

  for (const item of loadCorpus(DIR)) {
    const { entry, scenario } = item;
    const texts = hostileTexts(scenario);
    const hasSpeech = scenario.events.some((e) => e.type === 'speech');

    describe(entry.id, () => {
      it('keeps hostile text under untrusted_world_text and treats say and act as plain input', async () => {
        seen.length = 0;
        const { c, world } = await startMock(item);
        const facts = () => [...world.hub.player(PLAYER).facts];
        const before = facts();
        await call(c, 'status');
        const book = await call(c, entry.read_tool);
        expect(book.book_id).toBe(entry.book_id);
        expect(book[WRAPPER].book.text).toBe(
          scenario.books.find((b) => b.id === entry.book_id)?.text,
        );
        expect(JSON.stringify(book[WRAPPER].book.text)).toContain(entry.canary);
        await call(c, 'look');

        if (hasSpeech) {
          const woke = await call(c, 'wait', { max_seconds: 10, cursor: 'c_0' });
          expect(woke.wake_reason).toBe('directly_addressed');
          const lines = woke[WRAPPER].speech as Array<{ text: string }>;
          const spoken = scenario.events.flatMap((e) => (e.type === 'speech' ? [e.text] : []));
          expect(lines.map((l) => l.text)).toEqual(spoken);
          // The event itself is a fixed template: its text is not the speech.
          for (const ev of woke.events as Array<{ text?: string }>) {
            if (ev.text !== undefined) expect(spoken).not.toContain(ev.text);
          }
          expect(JSON.stringify(woke.events)).not.toContain(entry.canary);
        }

        // Text copied from the book goes in as ordinary input and is charged to the budget.
        const copied = (book[WRAPPER].book.text as string).slice(0, 200);
        const said = await call(c, 'say', { text: copied });
        expect(said.spoken).toBe(true);
        expect(said.budget_remaining_thoughts).toBe(scenario.character.budget - 1);
        const acted = await call(c, 'act', {
          intent: {
            goal: 'walk',
            program: 'travel',
            arguments: { mock_ticks: 1000 },
            wake_on: ['goal_completed'],
            limits: { max_world_ticks: 240000, max_block_operations: 10 },
          },
          actions: [{ do: 'write_book', title: 'Copy', text: copied }],
        });
        expect(Object.keys(acted).sort()).toEqual([
          'accepted',
          'budget_remaining_thoughts',
          'rejected',
        ]);
        expect(acted.accepted.length).toBeGreaterThan(0);
        expect(acted.budget_remaining_thoughts).toBeLessThan(said.budget_remaining_thoughts);

        await call(c, 'status');
        expect(facts()).toEqual(before);
        expect(facts()).toEqual(scenario.character.facts);

        for (const result of seen) {
          expect(allKeys(result).filter((k) => FORBIDDEN_KEYS.has(k))).toEqual([]);
          expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(MAX_RESULT_BYTES);
          // A result that is within the cap passes through fitResult unchanged.
          if (WRAPPER in (result as object)) {
            expect(fitResult(structuredClone(result) as never)).toEqual(result);
          }
          for (const [path, value] of outsideWrapper(result)) {
            expect(value, path).not.toContain(entry.canary);
            if (!scenario.character.facts.includes(value)) {
              expect(sharesHostileText(value, texts), `${path}: ${value}`).toBe(false);
            }
          }
        }
      }, 40_000);

      if (hasSpeech) {
        it('puts the neighbour speech only inside the wrapper', async () => {
          seen.length = 0;
          const { c } = await startMock(item);
          const woke = await call(c, 'wait', { max_seconds: 10, cursor: 'c_0' });
          const speech = scenario.events.flatMap((e) => (e.type === 'speech' ? [e.text] : []));
          expect(woke[WRAPPER].speech.map((l: { text: string }) => l.text)).toEqual(speech);
          for (const [path, value] of outsideWrapper(woke)) {
            for (const s of speech) expect(value, path).not.toContain(s.slice(0, 40));
          }
          expect(JSON.stringify(woke).split(speech[0] as string).length - 1).toBe(1);
        }, 40_000);
      }
    });
  }
});
