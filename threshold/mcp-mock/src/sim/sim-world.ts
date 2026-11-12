import type {
  DefineSkillInput,
  OfferInput,
  ProposeInput,
  SayInput,
  UseSkillInput,
  VoteInput,
  WaitInput,
  WriteBookInputArgs,
} from '@geldar/contract';
import type { McpWorld } from '../app.ts';
import { ImageToolResult, type ToolHandlers } from '../registry.ts';
import { actTool, sayTool } from './act.ts';
import {
  defineSkillTool,
  offerTool,
  proposeTool,
  readBookTool,
  useSkillTool,
  voteTool,
  writeBookTool,
} from './books.ts';
import { type Clock, RealClock } from './clock.ts';
import { SimHub, type SuppressedRecord } from './hub.ts';
import { journalTool, lookTool, sleepTool, statusTool } from './lifecycle.ts';
import type { Scenario } from './scenario.ts';
import { waitTool } from './wait.ts';

/** The longest `wait`, in seconds (0009 item 3). */
const WAIT_CAP_SECONDS = 240;

/** What `createSimWorld` is built from. */
export interface SimWorldOptions {
  scenario: Scenario;
  /** The time source; the wall clock when omitted. */
  clock?: Clock | undefined;
  /** Called for every suppressed wakeup. */
  onSuppressed?: ((record: SuppressedRecord) => void) | undefined;
}

/**
 * The scripted world: the 15 tool handlers and the three resources over one `SimHub`. Every
 * handler gets its player's sim through `hub.player`, so one handler set serves all players.
 */
export function createSimWorld(opts: SimWorldOptions): McpWorld & { hub: SimHub } {
  const hub = new SimHub({
    scenario: opts.scenario,
    clock: opts.clock ?? new RealClock(),
    ...(opts.onSuppressed !== undefined ? { onSuppressed: opts.onSuppressed } : {}),
  });
  const tools: ToolHandlers = {
    look: (_input, ctx) => lookTool(hub, ctx),
    wait: (input, ctx) => waitTool(hub, ctx, input as WaitInput & { max_seconds: number }),
    act: (input, ctx) => actTool(hub, ctx, input as Parameters<typeof actTool>[2]),
    say: (input, ctx) => sayTool(hub, ctx, input as SayInput),
    read_book: (_input, ctx) => readBookTool(hub, ctx),
    view: () => ({ text: 'Facing north. Grass ahead, a stone wall to the east.' }),
    see: () =>
      new ImageToolResult(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
        'what you see, from your eyes (an approximation, not a photograph)',
      ),
    write_book: (input, ctx) => writeBookTool(hub, ctx, input as WriteBookInputArgs),
    define_skill: (input, ctx) => defineSkillTool(hub, ctx, input as DefineSkillInput),
    use_skill: (input, ctx) => useSkillTool(hub, ctx, input as UseSkillInput),
    offer: (input, ctx) => offerTool(hub, ctx, input as OfferInput),
    propose: (input, ctx) => proposeTool(hub, ctx, input as ProposeInput),
    vote: (input, ctx) => voteTool(hub, ctx, input as VoteInput),
    sleep: (_input, ctx) => sleepTool(hub, ctx),
    journal: (input, ctx) => journalTool(hub, ctx, input as { text: string }),
    status: (_input, ctx) => statusTool(hub, ctx),
  };
  const character = opts.scenario.character;
  return {
    hub,
    tools,
    readSelf: () => ({ name: character.name, seed: character.seed, born_day: character.born_day }),
    readJournalRecent: (playerId) => hub.life(playerId).journal || 'Nothing written yet.',
    readShardRules: () => ({
      chat_radius: opts.scenario.shard_rules.chat_radius,
      wait_cap_seconds: WAIT_CAP_SECONDS,
      day_length_seconds: opts.scenario.day_length_seconds,
    }),
  };
}
