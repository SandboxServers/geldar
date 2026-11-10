import type { SovereignCallPayload } from '@geldar/contract';
import { type ToolContext, ToolError, type ToolHandler, type ToolHandlers } from '@geldar/mcp-mock';
import type {
  AgentProfiles,
  BodyGateway,
  BudgetLedger,
  CallRecorder,
  JournalStore,
  PlayerDirectory,
  SleepMarks,
} from './ports.ts';
import { BodyUnavailable } from './ports.ts';
import { JOURNAL_LINE_LIMIT, journalTool } from './tools/journal.ts';
import { lookTool, type ToolCall } from './tools/look.ts';
import { readBookTool } from './tools/read-book.ts';
import { statusTool } from './tools/status.ts';
import { type NotAvailableTool, notAvailableTool } from './tools/unavailable.ts';

/** The fixed messages the handlers add. None echoes world text or names an observer (decision 0059). */
export const BODY_UNAVAILABLE_MESSAGE = 'Your body did not answer. Try again.' as const;
export const UNKNOWN_PLAYER_MESSAGE = 'No player is bound to this session.' as const;
export const NOT_WIRED_MESSAGE = 'This tool is not wired in this build yet.' as const;

/** The most journal characters a `sovereign_call` record keeps (the payload's own limit). */
const RECORD_JOURNAL_LIMIT = 2000;

/** Everything the read-only handlers reach. Each tool function takes the subset it needs. */
export interface WorldDeps {
  players: PlayerDirectory;
  body: BodyGateway;
  budget: BudgetLedger;
  sleeps: SleepMarks;
  profiles: AgentProfiles;
  journal: JournalStore;
  recorder: CallRecorder;
  /** The laws in force, as sign lines, for `status`. */
  laws: readonly string[];
  now: () => number;
}

type Run = (call: ToolCall, input: unknown) => unknown;

/** The player comes from the bound session, never from the arguments. */
async function callerOf(deps: WorldDeps, ctx: ToolContext): Promise<ToolCall> {
  const player = await deps.players.find(ctx.playerId);
  if (player === null) throw new ToolError('unknown_player', UNKNOWN_PLAYER_MESSAGE);
  return { playerId: ctx.playerId, lifeId: player.lifeId };
}

/** A Body that does not answer becomes the `body_unavailable` tool error; other faults pass on. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof BodyUnavailable) {
      throw new ToolError('body_unavailable', BODY_UNAVAILABLE_MESSAGE);
    }
    throw err;
  }
}

function bound(deps: WorldDeps, run: Run): ToolHandler {
  return (input, ctx) => guarded(async () => run(await callerOf(deps, ctx), input));
}

/** The tools this build does not run yet; part 2 of WM-11a replaces them with the Body wiring. */
const notWired: ToolHandler = () => {
  throw new ToolError('not_wired', NOT_WIRED_MESSAGE);
};

/** Mirrors one journal line and records the call (spec 5.15.3: journal publishes a sovereign_call). */
async function journalAndRecord(deps: WorldDeps, call: ToolCall, text: string) {
  const started = deps.now();
  const result = await journalTool(deps, call, { text });
  const balance = await deps.budget.balance(call.lifeId, started);
  const record: SovereignCallPayload = {
    player_id: call.playerId,
    tool: 'journal',
    outcome: 'ok',
    accepted: [0],
    rejected: [],
    credits_charged: 0,
    budget_remaining: Math.max(0, Math.floor(balance)),
    latency_ms: Math.max(0, deps.now() - started),
    journal: text.slice(0, RECORD_JOURNAL_LIMIT),
  };
  await deps.recorder.record(record);
  return result;
}

/**
 * The 14 tool handlers of the real world. Four still answer `not_wired` (act, say, sleep, wait);
 * the rest run the WM-06 tool functions against the Body and the stores.
 */
export function createWorld(deps: WorldDeps): ToolHandlers {
  const unavailable = (tool: NotAvailableTool): ToolHandler =>
    bound(deps, (call) => notAvailableTool(deps, call, tool));
  return {
    act: notWired,
    say: notWired,
    sleep: notWired,
    wait: notWired,
    look: bound(deps, (call) => lookTool(deps, call)),
    status: bound(deps, (call) => statusTool(deps, call)),
    journal: bound(deps, (call, input) =>
      journalAndRecord(deps, call, (input as { text: string }).text.slice(0, JOURNAL_LINE_LIMIT)),
    ),
    read_book: bound(deps, (call) => readBookTool(deps, call)),
    write_book: unavailable('write_book'),
    define_skill: unavailable('define_skill'),
    use_skill: unavailable('use_skill'),
    offer: unavailable('offer'),
    propose: unavailable('propose'),
    vote: unavailable('vote'),
  };
}
