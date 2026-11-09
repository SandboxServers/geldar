import type { WaitInput, WaitResult } from '@geldar/contract';
import { type ToolContext, ToolError } from '../registry.ts';
import { decodeCursor, encodeCursor } from './events.ts';
import type { SimHub } from './hub.ts';
import {
  dayAt,
  fitResult,
  snapshotOf,
  toPlayerEvents,
  WORLD_TEXT_NOTE,
  worldText,
} from './present.ts';
import { evaluateWake, type WakeReason } from './wake.ts';

const ALL_INTERESTS = [
  'directly_addressed',
  'intent_finished',
  'damage',
  'agent_approached',
  'proposal',
  'day_night',
];

function superseded(): ToolError {
  return new ToolError('session_superseded', 'Another session took over this player.');
}

/**
 * The long poll. Holds the call until the wake policy fires or `max_seconds` pass, syncing the sim
 * in small steps (never past the next scheduled moment) so dusk, dawn and hunger always happen.
 * Events are never consumed: the same cursor returns the same events and speech.
 */
export async function waitTool(
  hub: SimHub,
  ctx: ToolContext,
  input: WaitInput & { max_seconds: number },
): Promise<WaitResult> {
  const clock = hub.clock;
  const sim = hub.player(ctx.playerId);
  let fromSeq = sim.log.lastSeq();
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursor);
    if (decoded === null || decoded > sim.log.lastSeq()) {
      throw new ToolError('bad_cursor', 'That cursor is not valid.');
    }
    fromSeq = decoded;
  }
  const interests: readonly string[] = input.interests ?? ALL_INTERESTS;
  const deadline = clock.nowMs() + input.max_seconds * 1000;

  let reason: WakeReason;
  let now: number;
  for (;;) {
    if (ctx.signal.aborted) throw superseded();
    now = clock.nowMs();
    sim.syncTo(now);
    const fresh = sim.log
      .since(fromSeq)
      .events.filter((e) => sim.lastWakeMs === null || e.atMs > sim.lastWakeMs);
    const decision = evaluateWake({
      events: fresh,
      intentStartedMs: sim.intentStartedMs,
      interests,
      nowMs: now,
      lastWakeMs: sim.lastWakeMs,
      config: hub.config.wake,
      alreadySuppressed: sim.suppressedSeqs,
    });
    for (const s of decision.suppressed) {
      sim.suppressedSeqs.add(s.seq);
      hub.recordSuppressed({
        player_id: ctx.playerId,
        seq: s.seq,
        kind: s.kind,
        reason: s.reason,
        at_ms: s.atMs,
        tick: fresh.find((e) => e.seq === s.seq)?.tick ?? sim.tick,
      });
    }
    if (decision.wake) {
      reason = decision.wake.reason;
      break;
    }
    if (now >= deadline) {
      reason = 'timeout';
      break;
    }
    const waits = [hub.config.pollMs, deadline - now];
    if (decision.recheckAtMs !== null) waits.push(decision.recheckAtMs - now);
    const next = sim.nextScheduledMs();
    if (next !== null) waits.push(next - now);
    try {
      await clock.sleep(Math.max(1, Math.min(...waits)), ctx.signal);
    } catch {
      throw superseded();
    }
  }

  // A timeout starts the spacing window too.
  sim.lastWakeMs = now;
  const since = sim.log.since(fromSeq);
  const life = hub.life(ctx.playerId);
  const result: WaitResult = {
    snapshot: snapshotOf(sim, hub.scenario, dayAt(hub.scenario, sim.tick) - life.lastSleepDay),
    events: toPlayerEvents(since.events),
    cursor: encodeCursor(sim.log.lastSeq()),
    wake_reason: reason,
    dropped_events: since.dropped,
    untrusted_world_text: worldText(since.events),
    note: WORLD_TEXT_NOTE,
  };
  return fitResult(result);
}
