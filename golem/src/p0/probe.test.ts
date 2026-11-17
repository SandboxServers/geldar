import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { ActionRun } from '../actions/registry.ts';
import type { AdmissionRcon } from '../players/whitelist.ts';
import { LifeRegistration, type RegistryKv } from '../registry.ts';
import { checkIsolation } from './isolation.ts';
import { type BodyLink, main, PROBE_USERNAME, type ProbeDeps, runProbe } from './probe.ts';

const UUID = '6f1e0c2a-1b3d-4e5f-8a9b-0c1d2e3f4a5b';

type Env = Record<string, string | undefined>;

/** A scratch env that passes every isolation rule. */
function scratchEnv(over: Env = {}): Env {
  return {
    GELDAR_P0_PROJECT: 'scratch-p0a',
    GELDAR_IN_NETWORK_HOSTS: '1',
    GELDAR_MC_HOST: 'velocity',
    GELDAR_MC_PORT: '25565',
    GELDAR_NATS_URL: 'nats://nats:4222',
    GELDAR_RCON_HOST: 'paper',
    GELDAR_RCON_PORT: '25575',
    GELDAR_RCON_PASSWORD_FILE: '/run/secrets/rcon',
    ...over,
  };
}

interface Options {
  whitelistRemoveReply?: string;
  kvPutFails?: boolean;
  kvDeleteFails?: boolean;
  openRconFails?: boolean;
  join?: 'ok' | 'kicked' | 'hang';
  noUuid?: boolean;
  goto?: 'completed' | 'failed';
  mine?: 'completed' | 'failed';
}

/** Every fake call in order: the probe's sequence is asserted on this list. */
interface Harness {
  events: string[];
  out: string[];
  err: string[];
  signals: Array<(name: NodeJS.Signals) => void>;
  deps: ProbeDeps;
}

function replyFor(cmd: string, opts: Options): string {
  if (cmd.startsWith('whitelist add')) return `Added ${PROBE_USERNAME} to the whitelist`;
  return opts.whitelistRemoveReply ?? `Removed ${PROBE_USERNAME} from the whitelist`;
}

function harness(opts: Options = {}): Harness {
  const events: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const signals: Array<(name: NodeJS.Signals) => void> = [];
  const kv: RegistryKv = {
    async put(key) {
      events.push(`put:${key}`);
      if (opts.kvPutFails) throw new Error('nats: put failed');
    },
    async delete(key) {
      events.push(`delete:${key}`);
      if (opts.kvDeleteFails) throw new Error('nats: delete failed');
    },
  };
  const bot = {
    player: opts.noUuid ? undefined : { uuid: UUID },
    entity: { position: { x: 10.7, y: 64, z: -3.2 } },
  } as unknown as Bot;
  const deps: ProbeDeps = {
    async openRcon(): Promise<AdmissionRcon> {
      events.push('open');
      if (opts.openRconFails) throw new Error('RCON connect refused');
      return {
        async command(cmd: string) {
          events.push(`cmd:${cmd}`);
          return replyFor(cmd, opts);
        },
        async close() {
          events.push('close');
        },
      };
    },
    registry: () =>
      new LifeRegistration(async () => ({ kv, close: async () => undefined }), undefined),
    startBody(): BodyLink {
      events.push('start');
      let bot_: Promise<Bot>;
      if (opts.join === 'kicked') {
        bot_ = Promise.reject(new Error('connection failed for good: kicked for whitelist'));
      } else if (opts.join === 'hang') {
        bot_ = new Promise<Bot>(() => undefined);
      } else {
        bot_ = Promise.resolve(bot);
      }
      return {
        bot: bot_,
        async disconnect() {
          events.push('disconnect');
        },
      };
    },
    actions: () => ({}) as never,
    async runAction(_registry, _bot, action): Promise<ActionRun> {
      const kind = (action as { do: string }).do;
      events.push(`run:${kind}`);
      const state = kind === 'goto' ? (opts.goto ?? 'completed') : (opts.mine ?? 'completed');
      return {
        state,
        result: {
          status: state,
          reason: state === 'completed' ? undefined : 'no_path',
          latency_ms: 5,
        },
      } as unknown as ActionRun;
    },
    onSignal(handler) {
      signals.push(handler);
      return () => undefined;
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  return { events, out, err, signals, deps };
}

describe('the probe run order and exit', () => {
  it('admits, registers, joins, goes, mines, then cleans up in order and exits 0', async () => {
    const h = harness();
    const code = await runProbe(checkIsolation(scratchEnv()), h.deps);
    expect(code).toBe(0);
    expect(h.events).toEqual([
      'open',
      `cmd:whitelist add ${PROBE_USERNAME}`,
      'close',
      `put:${PROBE_USERNAME}`,
      'start',
      'run:goto',
      'run:mine',
      'disconnect',
      `delete:${PROBE_USERNAME}`,
      'open',
      `cmd:whitelist remove ${PROBE_USERNAME}`,
      'close',
    ]);
    expect(h.out).toEqual([
      `p0 join ok name=${PROBE_USERNAME} uuid=${UUID}`,
      'p0 goto completed status=completed latency_ms=5',
      'p0 mine completed status=completed latency_ms=5',
      'p0 cleanup registry=removed whitelist=removed',
    ]);
    expect(h.err).toEqual([]);
  });

  it('a join that is kicked still removes both entries, prints the reason, and exits 1', async () => {
    const h = harness({ join: 'kicked' });
    const code = await runProbe(checkIsolation(scratchEnv()), h.deps);
    expect(code).toBe(1);
    expect(h.events).not.toContain('run:goto');
    expect(h.events).toContain(`delete:${PROBE_USERNAME}`);
    expect(h.events).toContain(`cmd:whitelist remove ${PROBE_USERNAME}`);
    expect(h.err).toContain('p0 failed: connection failed for good: kicked for whitelist');
    expect(h.out.at(-1)).toBe('p0 cleanup registry=removed whitelist=removed');
  });

  it('a joined Body with no UUID is a failure: no join line, no action, cleanup runs, exit 1', async () => {
    const h = harness({ noUuid: true });
    expect(await runProbe(checkIsolation(scratchEnv()), h.deps)).toBe(1);
    expect(h.out.some((line) => line.startsWith('p0 join ok'))).toBe(false);
    expect(h.events).not.toContain('run:goto');
    expect(h.err).toContain('p0 failed: the Body joined without a UUID');
    expect(h.out.at(-1)).toBe('p0 cleanup registry=removed whitelist=removed');
  });

  it('a failed goto stops the run: no mine, both entries removed, exit 1', async () => {
    const h = harness({ goto: 'failed' });
    const code = await runProbe(checkIsolation(scratchEnv()), h.deps);
    expect(code).toBe(1);
    expect(h.events).toContain('run:goto');
    expect(h.events).not.toContain('run:mine');
    expect(h.out).toContain('p0 goto failed status=failed reason=no_path latency_ms=5');
    expect(h.events).toContain(`delete:${PROBE_USERNAME}`);
    expect(h.out.at(-1)).toBe('p0 cleanup registry=removed whitelist=removed');
  });

  it('a failed mine exits 1 after both actions were tried', async () => {
    const h = harness({ mine: 'failed' });
    expect(await runProbe(checkIsolation(scratchEnv()), h.deps)).toBe(1);
    expect(h.events).toContain('run:mine');
    expect(h.out.at(-1)).toBe('p0 cleanup registry=removed whitelist=removed');
  });
});

describe('the probe cleanup', () => {
  it('a failed registry delete is reported and exits 1, and the whitelist is still removed', async () => {
    const h = harness({ kvDeleteFails: true });
    expect(await runProbe(checkIsolation(scratchEnv()), h.deps)).toBe(1);
    expect(h.out.at(-1)).toBe('p0 cleanup registry=failed whitelist=removed');
    expect(h.err).toContain('p0 registry delete failed: nats: delete failed');
    expect(h.events).toContain(`cmd:whitelist remove ${PROBE_USERNAME}`);
  });

  it('a whitelist removal with an unexpected reply is reported and exits 1', async () => {
    const h = harness({ whitelistRemoveReply: 'Internal error' });
    expect(await runProbe(checkIsolation(scratchEnv()), h.deps)).toBe(1);
    expect(h.out.at(-1)).toBe('p0 cleanup registry=removed whitelist=failed');
    expect(h.err.some((line) => line.startsWith('p0 whitelist remove failed:'))).toBe(true);
  });

  it('an admission that cannot reach RCON still cleans up, and exits 1 with nothing joined', async () => {
    const h = harness({ openRconFails: true });
    expect(await runProbe(checkIsolation(scratchEnv()), h.deps)).toBe(1);
    expect(h.events).not.toContain('start');
    expect(h.events).not.toContain(`put:${PROBE_USERNAME}`);
    expect(h.err).toContain('p0 failed: RCON connect refused');
    expect(h.out.at(-1)).toBe('p0 cleanup registry=removed whitelist=failed');
  });

  it('a failed registry put removes the key anyway, and exits 1', async () => {
    const h = harness({ kvPutFails: true });
    expect(await runProbe(checkIsolation(scratchEnv()), h.deps)).toBe(1);
    expect(h.events).not.toContain('start');
    expect(h.events).toContain(`delete:${PROBE_USERNAME}`);
    expect(h.out.at(-1)).toBe('p0 cleanup registry=removed whitelist=removed');
  });
});

describe('the probe on a signal', () => {
  it('SIGTERM during the join aborts the wait, cleans up both entries and exits 1', async () => {
    const h = harness({ join: 'hang' });
    const run = runProbe(checkIsolation(scratchEnv()), h.deps);
    await vi.waitFor(() => expect(h.events).toContain('start'));
    expect(h.signals).toHaveLength(1);
    h.signals[0]?.('SIGTERM');
    expect(await run).toBe(1);
    expect(h.events).not.toContain('run:goto');
    expect(h.events).toContain('disconnect');
    expect(h.events).toContain(`delete:${PROBE_USERNAME}`);
    expect(h.events).toContain(`cmd:whitelist remove ${PROBE_USERNAME}`);
    expect(h.out).toContain('p0 interrupted by SIGTERM');
    expect(h.out.at(-1)).toBe('p0 cleanup registry=removed whitelist=removed');
    expect(h.err).toContain('p0 failed: interrupted: interrupted by SIGTERM');
  });

  it('a second signal after the first is ignored by the probe', async () => {
    const h = harness({ join: 'hang' });
    const run = runProbe(checkIsolation(scratchEnv()), h.deps);
    await vi.waitFor(() => expect(h.events).toContain('start'));
    h.signals[0]?.('SIGINT');
    h.signals[0]?.('SIGTERM');
    expect(await run).toBe(1);
    expect(h.out.filter((line) => line.startsWith('p0 interrupted'))).toHaveLength(1);
  });
});

describe('main and the isolation check', () => {
  it('runs the probe for a scratch env', async () => {
    const h = harness();
    expect(await main(scratchEnv(), h.deps)).toBe(0);
    expect(h.events[0]).toBe('open');
  });

  it.each([
    ['the colo project name with the colo service names', { GELDAR_P0_PROJECT: 'geldar' }],
    [
      'loopback on the live ports',
      {
        GELDAR_MC_HOST: '127.0.0.1',
        GELDAR_NATS_URL: 'nats://127.0.0.1:4222',
        GELDAR_RCON_HOST: '127.0.0.1',
      },
    ],
    ['a dotted host', { GELDAR_RCON_HOST: 'paper.example' }],
    ['the in-network opt-in unset', { GELDAR_IN_NETWORK_HOSTS: undefined }],
  ])('refuses %s with exit 2 before any connection', async (_name, over) => {
    const h = harness();
    expect(await main(scratchEnv(over), h.deps)).toBe(2);
    // The isolation check runs first: no fake was touched and no signal handler was installed.
    expect(h.events).toEqual([]);
    expect(h.signals).toEqual([]);
    expect(h.err).toHaveLength(1);
    expect(h.err[0]?.startsWith('p0 probe refused: ')).toBe(true);
  });
});
