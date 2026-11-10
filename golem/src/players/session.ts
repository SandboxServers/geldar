/**
 * One player's session: `up` whitelists the life, opens a connection and runs a `BodySupervisor`
 * on it (the supervisor restarts the Body with backoff, as Adam's does); `down` stops the
 * supervisor, which stops the Body (checkpoint kept), then closes the connection. Each `up` makes
 * a new connection, because a manager cannot be restarted after `stop`.
 */
import type { Bot } from 'mineflayer';
import type { RunningAdamBody } from '../adam/adam-body.ts';
import { BodySupervisor, type SupervisorOptions } from '../adam/main.ts';

/** One connection of the player: the bot source for the supervisor, and its close. */
export interface PlayerConnection {
  acquire: SupervisorOptions['acquire'];
  close(): Promise<void>;
}

export interface PlayerSessionOptions {
  lifeId: string;
  /** Adds the life to the whitelist; runs before every `connect`, and an error skips the start. */
  admit(lifeId: string): Promise<void>;
  connect(): PlayerConnection;
  /** Starts one run of the player's Body on the bot. */
  body(bot: Bot): Promise<RunningAdamBody>;
  log: (line: Record<string, unknown>) => void;
}

interface ActiveSession {
  supervisor: BodySupervisor;
  /** Ends the current run at once, even one still starting (see `up`). */
  stopRun(reason: string): void;
  /** Settles once the supervisor has ended and the connection is closed. */
  done: Promise<void>;
}

export class PlayerSession {
  private active: ActiveSession | null = null;
  private readonly opts: PlayerSessionOptions;

  constructor(options: PlayerSessionOptions) {
    this.opts = options;
  }

  /** True while a supervisor runs (it may still be starting its Body). */
  get running(): boolean {
    return this.active !== null;
  }

  /** Starts the Body. A no-op while one runs; a whitelist error logs and starts nothing. */
  async up(): Promise<void> {
    if (this.active !== null) return;
    const { lifeId, log } = this.opts;
    try {
      await this.opts.admit(lifeId);
    } catch (error) {
      log({ event: 'whitelist_failed', life_id: lifeId, error: String(error) });
      return;
    }
    const connection = this.opts.connect();
    // The supervisor listens for a stop only once a run has started, so a `down` during the start
    // would wait for the bot to end. This run-level stop settles the run's `ended` at once instead.
    let stopRun: (reason: string) => void = () => undefined;
    const stopping = new Promise<string>((resolve) => {
      stopRun = resolve;
    });
    const supervisor = new BodySupervisor({
      acquire: connection.acquire,
      start: async (bot) => {
        const run = await this.opts.body(bot);
        return { ...run, ended: Promise.race([run.ended, stopping]) };
      },
      log,
    });
    const active: ActiveSession = {
      supervisor,
      stopRun,
      done: supervisor
        .run()
        .then(() => connection.close())
        .catch((error: unknown) => log({ event: 'connection_close_failed', error: String(error) }))
        .then(() => {
          if (this.active === active) this.active = null;
        }),
    };
    this.active = active;
    log({ event: 'player_up', life_id: lifeId });
  }

  /** Stops the Body and the connection. The checkpoint stays for the next `up`. */
  async down(): Promise<void> {
    const active = this.active;
    if (active === null) return;
    this.active = null;
    active.stopRun('stop requested');
    await active.supervisor.stop();
    await active.done;
    this.opts.log({ event: 'player_down', life_id: this.opts.lifeId });
  }
}
