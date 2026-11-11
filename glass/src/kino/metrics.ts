/**
 * Kino metrics for SigNoz: open panes, bytes sent and refusals by reason. The only label is the
 * refusal reason (a fixed set); there is no agent, login or account label, by construction: nothing
 * here accepts one.
 */
import type { ByeReason } from './relay.ts';

export interface KinoMetricsSnapshot {
  panes_open: number;
  bytes_sent: number;
  refusals: Partial<Record<ByeReason, number>>;
}

export class KinoMetrics {
  private panes = 0;
  private bytes = 0;
  private readonly refusals = new Map<ByeReason, number>();

  readonly onPanes = (open: number): void => {
    this.panes = open;
  };
  readonly onBytes = (n: number): void => {
    this.bytes += n;
  };
  readonly onRefusal = (reason: ByeReason): void => {
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
