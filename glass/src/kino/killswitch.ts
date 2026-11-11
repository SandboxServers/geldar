/**
 * The Kino kill switch. One flag, read by the relay on every accept and subscribe. Flipping it off
 * sends `bye` `kill_switch` to every live pane and closes it; flipping it back on lets new panes in.
 */
import type { KinoRelay } from './relay.ts';

export class KinoKillSwitch {
  private on: boolean;
  private relay: KinoRelay | null = null;

  constructor(initiallyOn = false) {
    this.on = initiallyOn;
  }

  /** The `enabled` option for the relay. */
  readonly enabled = (): boolean => this.on;

  /** Binds the relay whose live panes are ended when the switch goes off. */
  attach(relay: KinoRelay): void {
    this.relay = relay;
  }

  set(on: boolean): void {
    if (this.on === on) return;
    this.on = on;
    if (!on) this.relay?.endAll('kill_switch');
  }
}
