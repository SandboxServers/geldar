// The Kino preview (decision 0161, test-only): it serves the real page and an invented feed that obeys
// the contract, so the page can be looked at without a shard.

import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateKinoFeed } from '../../contract/src/generated/validators.js';
import { decodePaletteIndices } from '../web/kino/palette.ts';
import { startPreview } from './kino-preview/server.ts';
import { AGENTS, entityPositions, sectionMessages } from './kino-preview/world.ts';

let base = '';
let close = (): void => undefined;

beforeAll(async () => {
  const server = startPreview(0, new URL('../web/kino/', import.meta.url).pathname);
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => void server.close();
});
afterAll(() => close());

describe('Kino preview', () => {
  it('serves the page, its stylesheet, textures, skins and the camera list', async () => {
    expect(await (await fetch(`http://${base}/kino/`)).text()).toContain('src="./main.ts"');
    expect((await fetch(`http://${base}/kino/kino.css`)).headers.get('content-type')).toContain(
      'text/css',
    );
    const tex = (await (
      await fetch(`http://${base}/kino/tex/maps/overworld/textures.json`)
    ).json()) as unknown[];
    expect(tex.length).toBeGreaterThan(5);
    expect(
      (await fetch(`http://${base}/kino/skins/${AGENTS[0]?.id}.png`)).headers.get('content-type'),
    ).toBe('image/png');
    const targets = (await (await fetch(`http://${base}/kino/targets`)).json()) as {
      agents: unknown[];
    };
    expect(targets.agents).toHaveLength(AGENTS.length);
  });

  it('invents a world and agents the feed contract accepts', () => {
    const sections = sectionMessages();
    for (const s of sections.slice(0, 6)) {
      expect(validateKinoFeed(s), JSON.stringify(validateKinoFeed.errors)).toBe(true);
      if (s.type === 'chunk_section') expect(decodePaletteIndices(s)).toHaveLength(4096);
    }
    const ents = { type: 'entity_positions', entities: entityPositions(12.5) };
    expect(validateKinoFeed(ents), JSON.stringify(validateKinoFeed.errors)).toBe(true);
  });

  it('answers a subscribe on its WebSocket with hello, sections and positions', async () => {
    const ws = new WebSocket(`ws://${base}/kino/ws`);
    const types = new Set<string>();
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () =>
        ws.send(
          JSON.stringify({ type: 'subscribe', target_agent_id: AGENTS[1]?.id, mode: 'follow' }),
        );
      ws.onerror = () => reject(new Error('socket error'));
      ws.onmessage = (ev) => {
        types.add((JSON.parse(String(ev.data)) as { type: string }).type);
        if (types.has('target_moved')) resolve();
      };
    });
    ws.close();
    expect([...types]).toEqual(['hello', 'chunk_section', 'entity_positions', 'target_moved']);
  });
});
