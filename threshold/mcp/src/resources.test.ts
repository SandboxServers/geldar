import type { SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { FakeBudgetLedger, FakeJournalStore, FakePlayerEventLog } from './fakes/stores.fakes.ts';
import { FakeBody } from './fakes/world.fakes.ts';
import type { PlayerRecord } from './ports.ts';
import {
  getPrompt,
  listPrompts,
  listResources,
  type ResourceDeps,
  readPlayerResource,
  shardRulesOf,
} from './resources.ts';
import { journalTool } from './tools/journal.ts';
import { lookTool, type ToolCall, WORLD_TEXT_NOTE } from './tools/look.ts';
import { sleepTool } from './tools/sleep.ts';
import { statusTool } from './tools/status.ts';
import { NOT_AVAILABLE_MESSAGE } from './tools/unavailable.ts';

const LIFE = 'ag_ranger_01';
const CALL: ToolCall = { playerId: 'ag-ranger-01', lifeId: LIFE };
const PLAYER: PlayerRecord = {
  playerId: 'ag-ranger-01',
  lifeId: LIFE,
  ownerId: 'owner_01',
  displayName: 'Ranger',
  harness: 'claude-code',
  status: 'active',
};
const SHARD = { chatRadius: 16, waitCapSeconds: 60, tickRate: 20 };

/** Lines that say or imply humans are watching, in any case (decision 0059). */
const OBSERVER = /watch|observ|audience|humans are/i;

function deps(journal = new FakeJournalStore(), tickRate = SHARD.tickRate): ResourceDeps {
  return {
    profiles: { profile: async () => ({ personality_seed: 'calm and curious', born_day: 3 }) },
    journal,
    shard: { ...SHARD, tickRate },
  };
}

/** Every string value in a JSON-like value, depth first. */
function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
}

describe('shard rules', () => {
  it('gives the day length as 24000 ticks at the tick rate: 1200 seconds at 20, 2400 at 10', () => {
    expect(shardRulesOf({ ...SHARD, tickRate: 20 }).day_length_seconds).toBe(1200);
    expect(shardRulesOf({ ...SHARD, tickRate: 10 }).day_length_seconds).toBe(2400);
  });

  it('shows the chat radius and the wait cap as set', () => {
    expect(shardRulesOf(SHARD)).toEqual({
      chat_radius: 16,
      wait_cap_seconds: 60,
      day_length_seconds: 1200,
    });
  });
});

describe('resources', () => {
  it('lists the three resources and no global laws resource', () => {
    expect(listResources().map((r) => r.uri)).toEqual([
      'geldar://player/self',
      'geldar://player/journal/recent',
      'geldar://shard/rules',
    ]);
  });

  it('reads self, the recent journal and the shard rules from the facts', async () => {
    const journal = new FakeJournalStore();
    await journal.append(LIFE, 'First line.', 1);
    await journal.append(LIFE, 'Second line.', 2);
    const d = deps(journal);
    const self = await readPlayerResource(d, PLAYER, 'geldar://player/self');
    expect(JSON.parse(self.contents[0]?.text ?? '')).toEqual({
      name: 'Ranger',
      seed: 'calm and curious',
      born_day: 3,
    });
    const recent = await readPlayerResource(d, PLAYER, 'geldar://player/journal/recent');
    expect(recent.contents[0]?.text).toBe('First line.\nSecond line.');
    const rules = await readPlayerResource(d, PLAYER, 'geldar://shard/rules');
    expect(JSON.parse(rules.contents[0]?.text ?? '').day_length_seconds).toBe(1200);
  });

  it('says so when there is no journal yet', async () => {
    const recent = await readPlayerResource(deps(), PLAYER, 'geldar://player/journal/recent');
    expect(recent.contents[0]?.text).toBe('Nothing written yet.');
  });

  it('refuses any other uri', async () => {
    await expect(readPlayerResource(deps(), PLAYER, 'geldar://laws')).rejects.toThrow(
      /unknown resource/,
    );
  });
});

describe('no tool or resource says or implies that humans are watching', () => {
  it('scans every tool result, resource text, prompt and fixed message for observer words', async () => {
    const log = new FakePlayerEventLog();
    const body = new FakeBody(log);
    const budget = new FakeBudgetLedger(0, 100);
    budget.seed(LIFE, 37, 0);
    const journal = new FakeJournalStore();
    const marks = new Map<string, { lastSleepDay: number; cursor: number }>();
    const sleeps = {
      read: async (id: string) => marks.get(id) ?? { lastSleepDay: 1, cursor: 0 },
      write: async (id: string, m: { lastSleepDay: number; cursor: number }) => {
        marks.set(id, m);
      },
    };
    const now = () => 0;
    // One event of each digested kind, so the sleep digest carries every fixed line.
    const kinds = [
      'speech',
      'conversation_digest',
      'damage',
      'agent_approached',
      'proposal',
      'day_night',
      'intent_finished',
      'reflex',
    ];
    for (const [i, kind] of kinds.entries()) {
      await body.emit(LIFE, {
        seq: i + 1,
        atMs: i,
        tick: i,
        kind,
        from: 'x',
        text: 'y',
      } as unknown as SimEvent);
    }
    const strings: string[] = [WORLD_TEXT_NOTE, NOT_AVAILABLE_MESSAGE];
    strings.push(
      ...allStrings(await lookTool({ body, budget, sleeps, now }, CALL)),
      ...allStrings(
        await statusTool(
          {
            body,
            budget,
            sleeps,
            profiles: deps().profiles,
            laws: [],
            now,
          },
          CALL,
        ),
      ),
      ...allStrings(
        await sleepTool(
          {
            body,
            events: log,
            journal,
            marks: sleeps,
            now,
            buildSleepPlan: () => ({ thought_id: 'th_sleep' }) as never,
          },
          CALL,
        ),
      ),
      ...allStrings(await journal.recent(LIFE, 10)),
    );
    await journalTool({ journal, now }, CALL, { text: 'Dusk.' });
    for (const uri of listResources().map((r) => r.uri)) {
      strings.push(...allStrings(await readPlayerResource(deps(journal), PLAYER, uri)));
    }
    for (const prompt of listPrompts()) {
      strings.push(prompt.name, prompt.description, ...allStrings(getPrompt(prompt.name)));
    }
    expect(strings.length).toBeGreaterThan(20);
    for (const s of strings) expect(s, s).not.toMatch(OBSERVER);
  });
});
