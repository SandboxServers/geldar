/**
 * Sheet driver step 0: one scripted life over core NATS, with no model. `snapshot` asks the Body for a snapshot.
 * `mine-once` sends one plan with one `mine` action and waits for its ack and its plan_result. The Body's own
 * pipeline writes any rows or events that follow; this CLI writes nothing itself.
 *
 *   SHEET_SHARD=scratch-sheet0 SHEET_PROJECT=scratch-sheet0 node --experimental-strip-types \
 *     golem/src/bench/sheet/life-cli.ts snapshot <life_id>
 *   ... golem/src/bench/sheet/life-cli.ts mine-once <life_id> <block> <count>
 *
 * Endpoints: SHEET_NATS_URL (default nats://127.0.0.1:14223, the scratch overlay's port). The NATS password
 * path, if any, comes from the contract's connectNats environment and is never printed.
 * Exit: 0 done, 1 refused, failed or timed out, 2 bad usage.
 */
import { pathToFileURL } from 'node:url';
import { planSubject, type Snapshot, snapshotSubject } from '@geldar/contract';
import { connectNats } from '@geldar/contract/nats';
import type { NatsConnection } from '@nats-io/transport-node';
import { checkScratch } from './guard.ts';
import {
  buildMineOncePlan,
  buildSnapshotRequest,
  newMineOnceIds,
  parseAck,
  parseSnapshotReply,
  planResultFor,
} from './life-payload.ts';

const DEFAULT_NATS_URL = 'nats://127.0.0.1:14223';
const NAME = 'sheet-driver0';
const SNAPSHOT_TIMEOUT_MS = 5_000;
/** The Body's ack deadline is 2 s (spec 5.3.2); this wait is longer so a slow ack is still read. */
const ACK_TIMEOUT_MS = 5_000;
const DEFAULT_RESULT_TIMEOUT_MS = 60_000;
/** The shortest result wait the CLI accepts: a plan_result takes a few ticks, so less is a typo. */
const MIN_RESULT_TIMEOUT_MS = 1000;

const USAGE =
  'usage: life-cli.ts snapshot <life_id> | mine-once <life_id> <block> <count> (env: SHEET_SHARD, SHEET_PROJECT)';

type Subscription = ReturnType<NatsConnection['subscribe']>;

/** Asks the Body for a snapshot. A Body that does not serve this life sends no reply, so this times out. */
async function requestSnapshot(
  nc: NatsConnection,
  shard: string,
  lifeId: string,
): Promise<Snapshot> {
  const body = JSON.stringify(buildSnapshotRequest(lifeId, NAME));
  const reply = await nc.request(snapshotSubject(shard, lifeId), body, {
    timeout: SNAPSHOT_TIMEOUT_MS,
  });
  return parseSnapshotReply(reply.string());
}

/** Reads plan_result messages until one is for this thought, or the subscription is ended by the timer. */
async function waitForResult(
  sub: Subscription,
  thoughtId: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const timer = setTimeout(() => sub.unsubscribe(), timeoutMs);
  try {
    for await (const msg of sub) {
      const found = planResultFor(msg.string(), thoughtId);
      if (found) return found;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function summary(snapshot: Snapshot): Record<string, unknown> {
  return {
    snapshot_id: snapshot.snapshot_id,
    revision: snapshot.revision,
    body_generation: snapshot.body_generation ?? null,
    world_ticks: snapshot.world_time.ticks,
    health: snapshot.self.health,
    held_item: snapshot.self.held_item,
  };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const shard = env.SHEET_SHARD ?? '';
  const project = env.SHEET_PROJECT ?? shard;
  const verdict = checkScratch(shard, project);
  if (!verdict.ok) {
    console.error(verdict.reason);
    return 1;
  }
  const [command, lifeId, block, count] = argv;
  const wellFormed =
    (command === 'snapshot' && argv.length === 2) ||
    (command === 'mine-once' && argv.length === 4);
  if (!wellFormed || lifeId === undefined) {
    console.error(USAGE);
    return 2;
  }
  const resultTimeoutMs = Number(env.SHEET_RESULT_TIMEOUT_MS ?? DEFAULT_RESULT_TIMEOUT_MS);
  if (!Number.isInteger(resultTimeoutMs) || resultTimeoutMs < MIN_RESULT_TIMEOUT_MS) {
    console.error('SHEET_RESULT_TIMEOUT_MS must be a whole number of milliseconds, 1000 or more');
    console.error(USAGE);
    return 2;
  }
  const nc = await connectNats({ name: NAME, servers: env.SHEET_NATS_URL ?? DEFAULT_NATS_URL });
  try {
    const snapshot = await requestSnapshot(nc, shard, lifeId);
    if (command === 'snapshot') {
      console.log(JSON.stringify(summary(snapshot), null, 2));
      return 0;
    }
    const ids = newMineOnceIds();
    const plan = buildMineOncePlan({
      lifeId,
      snapshot,
      block: block ?? '',
      count: Number(count),
      ids,
    });
    // Subscribe before the plan goes out, so the plan_result cannot arrive before the listener exists.
    const sub = nc.subscribe(`geldar.${shard}.plan_result`);
    const result = waitForResult(sub, ids.thoughtId, resultTimeoutMs);
    const reply = await nc.request(planSubject(shard, lifeId), JSON.stringify(plan), {
      timeout: ACK_TIMEOUT_MS,
    });
    const ack = parseAck(reply.string(), ids.thoughtId);
    if (!ack.accepted) {
      sub.unsubscribe();
      console.log(JSON.stringify({ thought_id: ids.thoughtId, ack }, null, 2));
      return 1;
    }
    const outcome = await result;
    console.log(
      JSON.stringify(
        {
          thought_id: ids.thoughtId,
          action_id: ids.actionId,
          snapshot: summary(snapshot),
          ack,
          plan_result: outcome,
        },
        null,
        2,
      ),
    );
    return outcome === null ? 1 : 0;
  } finally {
    await nc.drain();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`sheet life-cli failed: ${message}`);
      process.exitCode = 1;
    });
}
