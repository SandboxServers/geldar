import type { WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { intentEvent } from '../projection.fakes.ts';
import {
  decisionEvent,
  LIFE_ID,
  MemoryAuditStore,
  OTHER_HASH,
  ROLL_ID,
  rollEvent,
  SHEET,
  SHEET_HASH,
  sheetEvent,
} from './projection.fakes.ts';
import { projectAudit } from './projection.ts';
import { pgAuditStore } from './store.ts';

async function project(store: MemoryAuditStore, events: WorldEvent[]): Promise<void> {
  for (const event of events) await projectAudit(event, store);
}

describe('rolls', () => {
  it('stores the roll columns, with proficiency 0 when the payload has none', async () => {
    const store = new MemoryAuditStore();
    const event = rollEvent(1);
    await projectAudit(event, store);
    expect([...store.rolls.values()]).toEqual([
      expect.objectContaining({
        source_event_id: event.source_event_id,
        life_id: LIFE_ID,
        world_tick: 100,
        dice: [14],
        total: 15,
        success: true,
        proficiency: 0,
        inputs: null,
      }),
    ]);
  });

  it('a redelivered roll is one row', async () => {
    const store = new MemoryAuditStore();
    await project(store, [rollEvent(1), rollEvent(1)]);
    expect(store.rolls.size).toBe(1);
  });

  it('a producer retry with a new event id for the same draw is one row', async () => {
    const store = new MemoryAuditStore();
    await project(store, [rollEvent(1), rollEvent(2)]);
    expect(store.rolls.size).toBe(1);
  });

  it('rejects a malformed roll with the reason and writes nothing', async () => {
    const store = new MemoryAuditStore();
    const error = await projectAudit(rollEvent(1, { dice: [1, 2, 3] }), store).catch((e) => e);
    expect(error).toMatchObject({ code: '23514' });
    expect(String(error.message)).toMatch(/roll event payload is not valid/);
    expect(store.rolls.size).toBe(0);
  });
});

describe('a payload for another life', () => {
  it('rejects a payload for another life, for every audit type, and writes nothing', async () => {
    const store = new MemoryAuditStore();
    const events = [
      rollEvent(1, { life_id: 'ag_other_02' }),
      decisionEvent(2, { life_id: 'ag_other_02' }),
      sheetEvent(3, {}, 'ag_other_02'),
    ];
    for (const event of events) {
      await expect(projectAudit({ ...event, agent_id: LIFE_ID }, store)).rejects.toMatchObject({
        code: '23514',
      });
    }
    expect(store.rolls.size + store.decisions.size + store.adoptions.size).toBe(0);
    expect(store.agents.get(LIFE_ID)?.sheet_hash).toBeNull();
  });
});

describe('decisions', () => {
  it('stores a d20 decision before its rolls arrive, with its roll ids as given', async () => {
    const store = new MemoryAuditStore();
    await projectAudit(decisionEvent(3, { kind: 'd20', roll_event_ids: [ROLL_ID] }), store);
    expect(store.rolls.size).toBe(0);
    expect([...store.decisions.values()]).toEqual([
      expect.objectContaining({
        life_id: LIFE_ID,
        world_tick: 100,
        kind: 'd20',
        roll_event_ids: [ROLL_ID],
        policy: null,
        dropped: null,
      }),
    ]);
  });

  it('a redelivered decision is one row', async () => {
    const store = new MemoryAuditStore();
    await project(store, [decisionEvent(3), decisionEvent(3)]);
    expect(store.decisions.size).toBe(1);
  });

  it('rejects a malformed decision with the reason', async () => {
    const store = new MemoryAuditStore();
    await expect(projectAudit(decisionEvent(4, { kind: 'coin' }), store)).rejects.toMatchObject({
      code: '23514',
    });
    expect(store.decisions.size).toBe(0);
  });
});

describe('sheet_adopted', () => {
  it('adopts the first sheet; the same hash is same and another hash is conflict, baseline kept', async () => {
    const store = new MemoryAuditStore();
    await project(store, [sheetEvent(1), sheetEvent(2), sheetEvent(3, { sheet_hash: OTHER_HASH })]);
    expect([...store.adoptions.values()].map((row) => row.result)).toEqual([
      'adopted',
      'same',
      'conflict',
    ]);
    expect(store.agents.get(LIFE_ID)).toEqual({ sheet: SHEET, sheet_hash: SHEET_HASH });
  });

  it('a redelivered adoption writes one adoption row', async () => {
    const store = new MemoryAuditStore();
    await project(store, [sheetEvent(1), sheetEvent(1)]);
    expect(store.adoptions.size).toBe(1);
  });

  it('an unknown life is refused with a foreign key error and writes nothing', async () => {
    const store = new MemoryAuditStore();
    await expect(projectAudit(sheetEvent(5, {}, 'ag_ghost_09'), store)).rejects.toMatchObject({
      code: '23503',
    });
    expect(store.adoptions.size).toBe(0);
  });

  it('an invalid sheet hash is refused before any write', async () => {
    const store = new MemoryAuditStore();
    await expect(
      projectAudit(sheetEvent(6, { sheet_hash: 'A'.repeat(64) }), store),
    ).rejects.toMatchObject({ code: '23514' });
    expect(store.adoptions.size).toBe(0);
    expect(store.agents.get(LIFE_ID)?.sheet_hash).toBeNull();
  });
});

describe('other types', () => {
  it('ignores an event that is not an audit type', async () => {
    const store = new MemoryAuditStore();
    await projectAudit(intentEvent('accepted', 10), store);
    expect(store.rolls.size + store.decisions.size + store.adoptions.size).toBe(0);
  });
});

describe('pgAuditStore SQL', () => {
  it('inserts a roll with ON CONFLICT DO NOTHING', async () => {
    const memory = new MemoryAuditStore();
    const event = rollEvent(1);
    await projectAudit(event, memory);
    const row = memory.rolls.get(event.source_event_id);
    if (row === undefined) throw new Error('the roll was not projected');
    const sql: string[] = [];
    const db = {
      query: async (text: string) => {
        sql.push(text);
        return { rows: [] };
      },
    };
    await pgAuditStore(db).insertRoll(row);
    expect(sql[0]).toMatch(/^INSERT INTO rolls/);
    expect(sql[0]).toMatch(/ON CONFLICT DO NOTHING\s*$/);
  });

  it('a stored different hash is a conflict, and the adoption row is still written', async () => {
    const sql: string[] = [];
    const db = {
      query: async (text: string) => {
        sql.push(text);
        if (text.startsWith('SELECT sheet_hash')) return { rows: [{ sheet_hash: SHEET_HASH }] };
        return { rows: [] };
      },
    };
    const result = await pgAuditStore(db).adopt(LIFE_ID, SHEET, OTHER_HASH, 'config', 'ev_x');
    expect(result).toBe('conflict');
    expect(sql[0]).toMatch(/^UPDATE agents SET character_sheet/);
    expect(sql.at(-1)).toMatch(/ON CONFLICT \(source_event_id\) DO NOTHING$/);
  });

  it('a row changed by the UPDATE is adopted', async () => {
    const db = {
      query: async (text: string) =>
        text.startsWith('UPDATE agents') ? { rows: [{ agent_id: LIFE_ID }] } : { rows: [] },
    };
    await expect(
      pgAuditStore(db).adopt(LIFE_ID, SHEET, SHEET_HASH, 'roster', 'ev_y'),
    ).resolves.toBe('adopted');
  });
});
