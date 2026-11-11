/**
 * Kino metrics for SigNoz: open panes, bytes sent and refusals by reason. The only label is the
 * refusal reason (a fixed set); there is no agent, login or account label, by construction: nothing
 * here accepts one.
 */
import type { RefusalReason } from './relay.ts';

export interface KinoMetricsSnapshot {
  panes_open: number;
  bytes_sent: number;
  refusals: Partial<Record<RefusalReason, number>>;
}

export class KinoMetrics {
  private panes = 0;
  private bytes = 0;
  private readonly refusals = new Map<RefusalReason, number>();

  readonly onPanes = (open: number): void => {
    this.panes = open;
  };
  readonly onBytes = (n: number): void => {
    this.bytes += n;
  };
  readonly onRefusal = (reason: RefusalReason): void => {
    this.refusals.set(reason, (this.refusals.get(reason) ?? 0) + 1);
  };

  snapshot(): KinoMetricsSnapshot {
    return {
      panes_open: this.panes,
      bytes_sent: this.bytes,
      refusals: Object.fromEntries(this.refusals),
    };
  }
}
