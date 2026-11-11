import { describe, expect, it } from 'vitest';
import { validateKinoFeed } from '../../../contract/src/generated/validators.js';
import { isFeedMessage, MAX_FEED_BYTES, validFeedText } from '../../src/kino/feed-check.ts';
import { type KinoConn, KinoRelay } from '../../src/kino/relay.ts';
import { type Access, ANONYMOUS, type ScopeStore } from '../../src/kino/scope.ts';

const ENT = { id: 'e1', type: 'minecraft:zombie', x: 1.5, y: 64, z: -3, yaw: 10, pitch: 0 };
const GOOD: Record<string, unknown>[] = [
  { type: 'hello', feed_version: 1, world: 'world', target_agent_id: 'mine', view_radius: 4 },
  {
    type: 'chunk_section',
    chunk_x: -3,
    chunk_z: 4,
    section_y: 0,
    palette: ['minecraft:stone', 'minecraft:oak_log[axis=y]'],
    bits: 1,
    data: 'AAAA',
  },
  { type: 'block_update', pos: { x: 1, y: 2, z: 3 }, state: 'minecraft:air' },
  { type: 'entity_positions', entities: [ENT, { ...ENT, id: 'e2', agent_id: 'mine' }] },
  { type: 'target_moved', target_agent_id: 'mine', x: 1, y: 2, z: 3 },
  { type: 'bye', reason: 'kill_switch' },
];
const BAD: Record<string, unknown>[] = [
  { ...GOOD[0], extra: 1 },
  { ...GOOD[0], feed_version: 2 },
  { ...GOOD[0], view_radius: 9 },
  { ...GOOD[0], view_radius: 0 },
  { ...GOOD[0], target_agent_id: 'Bad Name' },
  { ...GOOD[0], world: '' },
  { ...GOOD[1], bits: 13 },
  { ...GOOD[1], palette: [] },
  { ...GOOD[1], palette: ['Not A State'] },
  { ...GOOD[1], data: 'not base64!' },
  { ...GOOD[1], chunk_x: 1.5 },
  { ...GOOD[1], section_y: 129 },
  { type: 'block_update', pos: { x: 1, y: 3000, z: 3 }, state: 'minecraft:air' },
  { type: 'block_update', pos: { x: 1, y: 2 }, state: 'minecraft:air' },
  { type: 'entity_positions', entities: [{ ...ENT, pitch: 91 }] },
  { type: 'entity_positions', entities: [{ ...ENT, pitch: -91 }] },
  { type: 'entity_positions', entities: [{ ...ENT, name: 'Steve' }] },
  { type: 'entity_positions', entities: Array.from({ length: 257 }, () => ENT) },
  { type: 'entity_positions', entities: [{ ...ENT, id: 'has space' }] },
  { type: 'target_moved', target_agent_id: 'mine', x: 1, y: 2 },
  { type: 'target_moved', target_agent_id: 'mine', x: '1', y: 2, z: 3 },
  { type: 'bye', reason: 'because' },
  { type: 'chat', text: 'hi' },
  {},
];

describe('feed check mirrors kino-feed.schema.json (contract sync)', () => {
  it('agrees with the generated validator on every sample', () => {
    for (const m of [...GOOD, ...BAD]) {
      expect({ m, ok: isFeedMessage(m) }).toEqual({ m, ok: validateKinoFeed(m) });
    }
    expect(GOOD.every((m) => isFeedMessage(m))).toBe(true);
    expect(BAD.some((m) => isFeedMessage(m))).toBe(false);
  });

  it('rejects non-objects, bad JSON and oversize text without throwing', () => {
    for (const v of [null, 1, 'x', [], [GOOD[0]]]) expect(isFeedMessage(v)).toBe(false);
    expect(validFeedText('{not json')).toBe(false);
    expect(validFeedText('null')).toBe(false);
    expect(validFeedText(JSON.stringify(GOOD[0]))).toBe(true);
    expect(validFeedText(JSON.stringify({ type: 'bye', reason: 'x'.repeat(MAX_FEED_BYTES) }))).toBe(
      false,
    );
  });
});

const OWNER: Access = { signedIn: true, admin: true, ownerId: 'o1', banned: false };
const store: ScopeStore = {
  access: async (h) => (h === null ? ANONYMOUS : OWNER),
  agent: async () => ({ owner: 'o1', publicCamera: true }),
};
const sub = (a: string) =>
  JSON.stringify({ type: 'subscribe', target_agent_id: a, mode: 'follow' });
const conn = () => {
  const c = { sent: [] as string[], closed: 0 } as { sent: string[]; closed: number } & KinoConn;
  c.send = (t) => void c.sent.push(t);
  c.close = () => void c.closed++;
  return c;
};

async function rig() {
  const emit = new Map<string, (json: string) => void>();
  const refusals: string[] = [];
  const relay = new KinoRelay({
    store,
    feed: {
      subscribe: (a, on) => {
        emit.set(a, on);
        return () => emit.delete(a);
      },
    },
    onRefusal: (r) => refusals.push(r),
  });
  const a = conn();
  const b = conn();
  await relay.accept(a, 'h1', 'h')?.message(sub('mine'));
  await relay.accept(b, 'h2', 'h')?.message(sub('other'));
  return { emit, refusals, a, b };
}

describe('the relay forwards only valid feed messages to the right pane', () => {
  it('forwards a valid message to its own agent pane only', async () => {
    const r = await rig();
    r.emit.get('mine')?.(JSON.stringify(GOOD[2]));
    expect(r.a.sent).toEqual([JSON.stringify(GOOD[2])]);
    expect(r.b.sent).toEqual([]);
  });

  it('drops and counts malformed, oversized and non-JSON messages, and keeps relaying', async () => {
    const r = await rig();
    const emit = r.emit.get('mine');
    emit?.('{broken');
    emit?.(JSON.stringify({ ...GOOD[2], extra: true }));
    emit?.(JSON.stringify({ type: 'bye', reason: 'x'.repeat(MAX_FEED_BYTES) }));
    emit?.('null');
    expect(r.a.sent).toEqual([]);
    expect(r.a.closed).toBe(0);
    expect(r.refusals).toEqual(['bad_feed', 'bad_feed', 'bad_feed', 'bad_feed']);
    emit?.(JSON.stringify(GOOD[2]));
    expect(r.a.sent).toEqual([JSON.stringify(GOOD[2])]);
  });

  it('drops a hello or target_moved that names another agent', async () => {
    const r = await rig();
    r.emit.get('mine')?.(JSON.stringify({ ...GOOD[0], target_agent_id: 'other' }));
    r.emit.get('mine')?.(JSON.stringify({ ...GOOD[4], target_agent_id: 'other' }));
    expect(r.a.sent).toEqual([]);
    expect(r.refusals).toEqual(['bad_feed', 'bad_feed']);
    r.emit.get('mine')?.(JSON.stringify(GOOD[0]));
    expect(r.a.sent).toHaveLength(1);
  });
});
