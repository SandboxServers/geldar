/** An in-memory `ProjectionStore` for the projection tests, with a count of writes. */
import type { ActionRecord, Receipt, WorldEvent } from '@geldar/contract';
import type { IntentRow, ProjectionStore } from './projection.ts';

export class MemoryProjectionStore implements ProjectionStore {
  readonly intents = new Map<string, IntentRow>();
  readonly actions = new Map<string, ActionRecord>();
  readonly receipts: Receipt[] = [];
  writes = 0;

  async getIntent(intentId: string): Promise<IntentRow | undefined> {
    return this.intents.get(intentId);
  }

  async saveIntent(row: IntentRow): Promise<void> {
    this.writes++;
    this.intents.set(row.intent_id, { ...row });
  }

  async getAction(actionId: string): Promise<{ state: string } | undefined> {
    return this.actions.get(actionId);
  }

  async saveAction(record: ActionRecord): Promise<void> {
    this.writes++;
    this.actions.set(record.action_id, structuredClone(record));
  }

  async getReceipts(actionId: string): Promise<{ receipt_id: string; phase: string }[]> {
    return this.receipts.filter((r) => r.action_id === actionId);
  }

  async insertReceipt(receipt: Receipt): Promise<void> {
    this.writes++;
    this.receipts.push(structuredClone(receipt));
  }
}

export const INTENT_ID = 'in_01HZX3V9Q4M2K8R7T6Y5W4E3D5';
export const ACTION_ID = 'ac_01HZX3V9Q4M2K8R7T6Y5W4E3D2';

/** A world event of `type` with `payload`, ids fixed. */
export function eventOf(type: string, payload: object, n = 1): WorldEvent {
  return {
    source_event_id: `ev_01HZX3V9Q4M2K8R7T6Y5W4E${String(n).padStart(3, '0')}`,
    at: '2026-11-09T12:00:00Z',
    shard: 'phase0',
    world_day: 0,
    world_tick: 100,
    type,
    agent_id: 'ag_kestrel_01',
    payload: payload as WorldEvent['payload'],
  };
}

export function intentEvent(state: string, tick: number, detail?: string): WorldEvent {
  return eventOf('intent', {
    intent_id: INTENT_ID,
    life_id: 'ag_kestrel_01',
    body_generation: 1,
    state,
    tick,
    ...(detail === undefined ? {} : { detail }),
  });
}

export function actionEvent(state: string, receiptId: string | null = null): WorldEvent {
  return eventOf('action', {
    action_id: ACTION_ID,
    intent_id: INTENT_ID,
    life_id: 'ag_kestrel_01',
    body_generation: 1,
    sequence: 0,
    source_snapshot_id: 'sn_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
    snapshot_revision: 4,
    expires_tick: 900,
    kind: 'mine',
    args: { block: 'oak_log' },
    state,
    result: state === 'completed' ? { mined: 3 } : null,
    receipt_id: receiptId,
  });
}

export function receiptEvent(receiptId: string, phase: string): WorldEvent {
  return eventOf('receipt', {
    receipt_id: receiptId,
    action_id: ACTION_ID,
    life_id: 'ag_kestrel_01',
    kind: 'mine',
    phase,
    at: '2026-11-09T12:00:05Z',
  });
}

export const RECEIPT_A = 'rc_01HZX3V9Q4M2K8R7T6Y5W4E3D3';
export const RECEIPT_B = 'rc_01HZX3V9Q4M2K8R7T6Y5W4E3D4';
