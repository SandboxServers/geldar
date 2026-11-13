import { describe, expect, it } from 'vitest';
import { collectThoughts } from '../export-glass.ts';
import { parseBodyLog, UNKNOWN_AGENT } from '../src/body.ts';
import { agentFromFilename, agentOfFile, expandGlob } from '../src/files.ts';
import { inventoryMetrics, parseInventory } from '../src/inventory.ts';
import { parseOutcomes } from '../src/outcomes.ts';
import { parsePaperLog } from '../src/paper.ts';
import { parsePositions, positionMetrics } from '../src/positions.ts';
import { journalMetrics, parseThoughts } from '../src/thoughts.ts';

const DAY = Date.parse('2026-01-02T00:00:00Z');

describe('paper log', () => {
  const log = [
    '[10:00:00 INFO]: ag_zack_01 joined the game',
    '[10:00:05 INFO]: <ag_zack_01> hello there',
    '2026-01-02T10:00:06Z [10:00:06 INFO]: [Not Secure] <ag_zack_01> unsigned hello',
    '[10:10:00 INFO]: ag_zack_01 was slain by Zombie',
    '[10:11:00 INFO]: ag_zack_01 fell from a high place',
    '[10:12:00 INFO]: ag_zack_01 left the game',
    '[10:12:01 INFO]: ag_zack_01 lost connection: Disconnected',
    '[10:13:00 INFO]: Done (3.2s)! For help, type "help"',
    '2026-01-02T10:14:00.123456789Z [10:14:00 INFO]: ag_amy_02 drowned',
  ].join('\n');

  it('reads joins, chat, deaths with cause, leaves, and skips noise', () => {
    const ev = parsePaperLog(log, DAY);
    expect(ev.map((e) => [e.agent, e.kind, e.cause])).toEqual([
      ['ag_zack_01', 'join', ''],
      ['ag_zack_01', 'chat', ''],
      ['ag_zack_01', 'chat', ''],
      ['ag_zack_01', 'death', 'was slain by Zombie'],
      ['ag_zack_01', 'death', 'fell from a high place'],
      ['ag_zack_01', 'leave', ''],
      ['ag_amy_02', 'death', 'drowned'],
    ]);
    expect(ev[0]?.at).toBe(DAY + 10 * 3_600_000);
    expect(ev[6]?.at).toBe(Date.parse('2026-01-02T10:14:00.123Z'));
  });

  it('rolls the clock over midnight', () => {
    const ev = parsePaperLog(
      '[23:59:00 INFO]: ag_a joined the game\n[00:01:00 INFO]: ag_a left the game',
      DAY,
    );
    expect((ev[1]?.at ?? 0) - (ev[0]?.at ?? 0)).toBe(120_000);
  });
});

describe('body log', () => {
  const log = [
    '{"event":"action_result","agent":"ag_zack_01","ts":"2026-01-02T10:00:00Z","reason":"moved"}',
    '{"event":"stall_diag","agent":"ag_zack_01","reason":"escape_ladder","rung":"dig","worked":false}',
    '{"event":"stall_diag","agent":"ag_zack_01","reason":"escape_ladder","rung":"pillar","worked":true}',
    '{"event":"body_watchdog","agent":"ag_zack_01","action":"restart"}',
    '{"event":"body_restart","agent":"ag_zack_01","reason":"x","attempt":1}',
    '{"event":"eat","agent":"ag_zack_01"}',
    '{"event":"player_down","agent":"ag_zack_01","uptime_ms":5000}',
    '{"event":"player_down","agent":"ag_zack_01","uptime_ms":900000}',
    'not json',
    '{"event":"eat"}',
  ].join('\n');

  it('classifies each event kind; action_result is not a Body log event and no line is dropped', () => {
    const ev = parseBodyLog(log, null);
    const kinds = ev.map((e) => e.kind);
    expect(kinds).toEqual([
      'escape_rung',
      'escape_rung',
      'body_watchdog',
      'body_restart',
      'eat',
      'short_session',
      'eat',
    ]);
    expect(ev.at(-1)?.agent).toBe(UNKNOWN_AGENT);
    expect(ev.filter((e) => e.kind === 'escape_rung').map((e) => [e.reason, e.worked])).toEqual([
      ['dig', false],
      ['pillar', true],
    ]);
    expect(ev.every((e) => e.kind !== 'action')).toBe(true);
  });

  it('uses life_id, else the default agent, and reads a real docker-prefixed line', () => {
    const line = '2026-01-02T10:00:00.123456789Z {"event":"stall_diag","reason":"stall"}';
    expect(parseBodyLog(line, 'ag_x')[0]).toMatchObject({
      agent: 'ag_x',
      at: Date.parse('2026-01-02T10:00:00.123Z'),
    });
    const own = '{"life_id":"ag_b_02","event":"eat"}';
    expect(parseBodyLog(own, 'ag_x')[0]?.agent).toBe('ag_b_02');
  });
});

describe('positions', () => {
  const t = (s: number): string => new Date(DAY + s * 1000).toISOString();
  const line = (s: number, x: number, z: number): string =>
    `${t(s)}\tag_a\tag_a has the following entity data: [${x}d, 64.0d, ${z}d]`;

  it('parses the rcon reply', () => {
    expect(parsePositions(line(0, 12.5, -3.25))[0]).toMatchObject({
      agent: 'ag_a',
      x: 12.5,
      y: 64,
      z: -3.25,
    });
  });

  it('derives distance, chunks, longest stuck stretch and time to escape', () => {
    const samples = parsePositions(
      [
        line(0, 0, 0),
        line(10, 1, 0),
        line(20, 0, 1),
        line(30, 1, 1),
        line(40, 20, 0),
        line(50, 40, 0),
      ].join('\n'),
    );
    const m = positionMetrics(samples);
    expect(m.chunks).toBe(3);
    expect(m.stuckMs).toBe(30_000);
    expect(m.escapeMs).toBe(40_000);
    expect(m.distance).toBeCloseTo(1 + Math.SQRT2 + 1 + Math.hypot(19, 1) + 20, 5);
  });

  it('does not count a teleport as travel and reports null escape when never leaving', () => {
    const m = positionMetrics(
      parsePositions([line(0, 0, 0), line(10, 500, 0), line(20, 500, 1)].join('\n')),
    );
    expect(m.distance).toBeCloseTo(1, 5);
    expect(m.escapeMs).toBeNull();
  });
});

describe('inventory', () => {
  const t = (s: number): string => new Date(DAY + s * 60_000).toISOString();
  const text = [
    `${t(0)}\tag_a\tag_a has the following entity data: [{Slot: 0b, id: "minecraft:oak_log", count: 3}]`,
    `${t(5)}\tag_a\tag_a has the following entity data: [{Slot: 0b, id: "minecraft:oak_log", count: 3}, {Slot: 1b, id: "minecraft:wooden_pickaxe", count: 1}]`,
    `${t(9)}\tag_a\tag_a has the following entity data: [{Count: 1b, Slot: 2b, id: "minecraft:red_bed"}, {Slot: 1b, id: "minecraft:wooden_pickaxe", count: 1}]`,
    `${t(9)}\tag_a\tag_a has the following entity data: [{Count: 1b, Slot: 2b, id: "minecraft:red_bed"}]`,
  ].join('\n');

  it('derives first-seen times, distinct types and the first tool', () => {
    const s = parseInventory(text);
    expect(s[0]?.items.get('oak_log')).toBe(3);
    const m = inventoryMetrics(s);
    expect(m.firstSeen.wooden_pickaxe).toBe(DAY + 5 * 60_000);
    expect(m.firstSeen.bed).toBe(DAY + 9 * 60_000);
    expect(m.firstToolAt).toBe(DAY + 5 * 60_000);
    expect(m.distinctItems).toBe(3);
  });

  it('joins per-slot lines of one sample and reads count: and Count: forms', () => {
    const slot = (n: number, body: string): string =>
      `${t(0)}\tag_a\tag_a has the following entity data: {Slot: ${n}b, ${body}}`;
    const s = parseInventory(
      [
        slot(0, 'id: "minecraft:oak_log", count: 3'),
        slot(1, 'Count: 2b, id: "minecraft:oak_log"'),
        slot(2, 'id: "minecraft:white_bed", count: 1'),
        `${t(0)}\tag_a\tFound no elements matching Inventory[3]`,
      ].join('\n'),
    );
    expect(s).toHaveLength(1);
    expect(s[0]?.items.get('oak_log')).toBe(5);
    expect(s[0]?.items.get('bed')).toBe(1);
  });
});

describe('thoughts', () => {
  const mk = (i: number, text: string, kind = 'journal'): object => ({
    thought_id: `t${i}`,
    life_id: 'l1',
    at: new Date(DAY + i * 1000).toISOString(),
    name: 'ag_a',
    kind,
    text,
  });

  it('keeps journal entries and finds near duplicates and asleep entries', () => {
    const json = JSON.stringify([
      mk(1, 'Found iron near the river, going to mine it tomorrow.'),
      mk(2, 'found iron near the river going to mine it tomorrow'),
      mk(3, 'Built a shelter by the hill.'),
      mk(4, 'I was asleep, no news.'),
      mk(5, 'speech ignored', 'say'),
    ]);
    const entries = parseThoughts(json);
    expect(entries).toHaveLength(4);
    expect(journalMetrics(entries)).toEqual({ entries: 4, nearDuplicates: 1, asleep: 1 });
  });

  it('counts a Jaccard 0.9 near duplicate but not a 0.5 one', () => {
    const base = 'one two three four five six seven eight nine ten';
    const e = (i: number, text: string) => ({ agent: 'a', at: i, text });
    expect(journalMetrics([e(1, base), e(2, `${base} eleven`)]).nearDuplicates).toBe(1);
    expect(
      journalMetrics([e(1, base), e(2, 'one two three four five x y z w v')]).nearDuplicates,
    ).toBe(0);
  });
});

describe('outcomes', () => {
  it('reads action_outcome events (nats sub output) by reason and agent', () => {
    const ev = (ok: boolean, reason?: string): string =>
      JSON.stringify({
        type: 'action_outcome',
        agent_id: 'ag_test_01',
        at: '2026-01-02T10:00:00Z',
        payload: { verb: 'mine', index: 0, ok, ...(reason ? { reason } : {}), message: 'm' },
      });
    const out = parseOutcomes(
      [
        '[#1] Received on "geldar.main.action_outcome"',
        ev(false, 'no_effect'),
        ev(true),
        'junk',
      ].join('\n'),
      null,
    );
    expect(out.map((e) => [e.agent, e.reason, e.kind])).toEqual([
      ['ag_test_01', 'no_effect', 'action'],
      ['ag_test_01', 'ok', 'action'],
    ]);
    expect(out[0]?.at).toBe(Date.parse('2026-01-02T10:00:00Z'));
  });

  it('reads the Prometheus counter, expanding by value', () => {
    const out = parseOutcomes(
      [
        '# TYPE geldar_action_outcomes_total counter',
        'geldar_action_outcomes_total{status="failed",reason="no_effect"} 3',
        'geldar_action_outcomes_total{status="completed",reason="none"} 2',
        'geldar_tps 20',
      ].join('\n'),
      null,
    );
    expect(out.map((e) => e.reason).sort()).toEqual([
      'no_effect',
      'no_effect',
      'no_effect',
      'ok',
      'ok',
    ]);
    expect(out[0]?.agent).toBe(UNKNOWN_AGENT);
  });
});

describe('files', () => {
  it('infers the agent from both file name styles', () => {
    expect(agentFromFilename('/x/players-host-ag-test-01.log')).toBe('ag_test_01');
    expect(agentFromFilename('/x/ag_test_01.log')).toBe('ag_test_01');
    expect(agentFromFilename('/x/body.log')).toBeNull();
  });
  it('prefers a single life_id, gives up on several, expands a glob', () => {
    expect(agentOfFile('/x/body.log', '{"life_id":"ag_a_01"}\n{"life_id":"ag_a_01"}')).toBe(
      'ag_a_01',
    );
    expect(
      agentOfFile('/x/ag_c_03.log', '{"life_id":"ag_a_01"}\n{"life_id":"ag_b_02"}'),
    ).toBeNull();
    expect(agentOfFile('/x/ag_c_03.log', '{}')).toBe('ag_c_03');
    expect(expandGlob('tools/progress-metrics/test/*.test.ts').length).toBe(3);
  });
});

describe('export-glass paging', () => {
  it('follows next cursors up to the count and stops at a null cursor', async () => {
    const seen: (string | null)[] = [];
    const pages: Record<string, { thoughts: unknown[]; next: string | null }> = {
      start: { thoughts: [1, 2, 3], next: 'c1' },
      c1: { thoughts: [4, 5, 6], next: 'c2' },
      c2: { thoughts: [7], next: null },
    };
    const fetchPage = async (c: string | null) => {
      seen.push(c);
      return pages[c ?? 'start'] as { thoughts: unknown[]; next: string | null };
    };
    expect(await collectThoughts(fetchPage, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([null, 'c1']);
    seen.length = 0;
    expect(await collectThoughts(fetchPage, 100)).toHaveLength(7);
    expect(seen).toEqual([null, 'c1', 'c2']);
  });
});
