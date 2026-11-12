import { validateMaintenanceNotice } from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';

/** A maintenance notice as the contract states it (maintenance-notice.schema.json, CD-1). */
export interface MaintenanceNotice {
  id: string;
  kind: 'pause' | 'restart' | 'back';
  scope: 'bodies' | 'world' | 'mcp';
  seconds?: number;
  reason?: 'update' | 'plugin_update' | 'config';
}

/** The notice when `raw` passes the contract, else null. A notice with any other field is refused. */
export function parseMaintenanceNotice(raw: unknown): MaintenanceNotice | null {
  return validateMaintenanceNotice(raw) ? (raw as MaintenanceNotice) : null;
}

/**
 * The one fixed sentence a notice reads as to the agent. The text is the server's own template: it
 * never names the reason, the deployer or the plumbing. A pause on the bodies states its countdown
 * when there is one; a restart, or a pause on the world, reads the same.
 */
export function maintenanceSentence(
  n: Pick<MaintenanceNotice, 'kind' | 'scope' | 'seconds'>,
): string {
  if (n.kind === 'back') return 'The world moves again.';
  if (n.kind === 'pause' && n.scope === 'mcp') return 'Your senses may flicker for a moment.';
  if (n.kind === 'pause' && n.scope === 'bodies') {
    return n.seconds === undefined
      ? 'The world will go still for a while.'
      : `The world will go still for about ${n.seconds} seconds.`;
  }
  return 'The world is about to stop for a short while.';
}

/**
 * The notice as a sim event at its stream sequence, so a redelivery at the same sequence is one line
 * per life, as day_night is. No wake interest maps to it (`wakeOn` is null), so it never wakes an agent.
 * It has no game tick or wall time of its own: both are 0.
 */
export function maintenanceEvent(seq: number, n: MaintenanceNotice): SimEvent {
  return {
    seq,
    tick: 0,
    atMs: 0,
    kind: 'maintenance',
    name: n.kind,
    wakeOn: null,
    text: maintenanceSentence(n),
  };
}
