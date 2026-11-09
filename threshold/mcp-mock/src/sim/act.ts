import type {
  ActResult,
  DefineSkillInput,
  Intent,
  OfferInput,
  SayInput,
  SayResult,
  UseSkillInput,
  VoteInput,
  WriteBookInputArgs,
} from '@geldar/contract';
import { type ToolContext, ToolError } from '../registry.ts';
import {
  type Applied,
  applyDefineSkill,
  applyOffer,
  applyPropose,
  applyUseSkill,
  applyVote,
  applyWriteBook,
  canAfford,
  charge,
} from './books.ts';
import type { SimHub } from './hub.ts';
import type { PlayerSim } from './player-sim.ts';
import { tryEat } from './reflex.ts';

/** The least time between two top-level `say` calls by one player. */
const SAY_SPACING_MS = 2000;

/** The input `act` receives after validation. */
interface ActArgs {
  say?: string | null;
  actions?: ({ do: string } & Record<string, unknown>)[];
  intent?: Intent;
}

const lastSay = new WeakMap<PlayerSim, number>();

function receipt(sim: PlayerSim): void {
  sim.pushReceipt(sim.nextId('ac'));
}

/** True if a top-level say is allowed now; records the time when it is. */
function sayAllowed(sim: PlayerSim, nowMs: number): boolean {
  const last = lastSay.get(sim);
  if (last !== undefined && nowMs - last < SAY_SPACING_MS) return false;
  lastSay.set(sim, nowMs);
  return true;
}

function isNeighbour(hub: SimHub, name: unknown): boolean {
  return typeof name === 'string' && hub.scenario.neighbours.some((n) => n.name === name);
}

/** Applies one action; accepted items are charged by the caller. */
function applyAction(
  hub: SimHub,
  sim: PlayerSim,
  a: { do: string } & Record<string, unknown>,
): Applied {
  switch (a.do) {
    case 'goto':
      if (typeof a.target === 'string' && !isNeighbour(hub, a.target)) {
        return { accepted: false, reason: 'unknown_target' };
      }
      return { accepted: true };
    case 'give':
      return isNeighbour(hub, a.to)
        ? { accepted: true }
        : { accepted: false, reason: 'unknown_target' };
    case 'eat': {
      const r = tryEat({ food: sim.food, inventory: sim.inventory }, 20);
      if (!r.ate) return { accepted: false, reason: 'nothing_to_eat' };
      sim.food = r.state.food;
      sim.inventory = r.state.inventory;
      return { accepted: true };
    }
    case 'write_book':
      applyWriteBook(sim, a as unknown as WriteBookInputArgs);
      return { accepted: true };
    case 'define_skill':
      applyDefineSkill(sim, a as unknown as DefineSkillInput);
      return { accepted: true };
    case 'use_skill':
      return applyUseSkill(sim, a as unknown as UseSkillInput);
    case 'offer':
      return applyOffer(sim, a as unknown as OfferInput);
    case 'propose':
      applyPropose(sim);
      return { accepted: true };
    case 'vote':
      return applyVote(sim, a as unknown as VoteInput);
    default:
      // mine, craft, place, build, attack, sleep, note, wait, open, read_book, write_sign and the
      // chest verbs are accepted and charged with no effect.
      return { accepted: true };
  }
}

/**
 * `act`: runs `say`, each action in order, then the intent, as one flat list. A refused item costs
 * nothing; an item with no budget left is rejected `budget_exhausted`. The result is exactly
 * Appendix K's: the `ac_` and `in_` ids stay on `sim.receipts`.
 */
export function actTool(hub: SimHub, ctx: ToolContext, input: ActArgs): ActResult {
  const sim = hub.player(ctx.playerId);
  const nowMs = hub.clock.nowMs();
  const accepted: number[] = [];
  const rejected: { index: number; reason: string }[] = [];
  let index = 0;

  const refuse = (reason: string): void => {
    rejected.push({ index: index++, reason });
  };
  const take = (): void => {
    accepted.push(index++);
  };

  if (input.say != null) {
    if (!canAfford(sim)) refuse('budget_exhausted');
    else if (!sayAllowed(sim, nowMs)) refuse('rate_limited');
    else {
      charge(sim);
      receipt(sim);
      take();
    }
  }
  for (const action of input.actions ?? []) {
    if (!canAfford(sim)) {
      refuse('budget_exhausted');
      continue;
    }
    let applied: Applied;
    try {
      applied = applyAction(hub, sim, action);
    } catch (err) {
      if (!(err instanceof ToolError)) throw err;
      applied = { accepted: false, reason: err.code };
    }
    if (applied.accepted) {
      charge(sim);
      receipt(sim);
      take();
    } else {
      refuse(applied.reason ?? 'rejected');
    }
  }
  if (input.intent !== undefined) {
    if (!canAfford(sim)) refuse('budget_exhausted');
    else if (!sim.startIntent(input.intent, nowMs).ok) refuse('precondition_false');
    else {
      charge(sim);
      take();
    }
  }
  return { accepted, rejected, budget_remaining_thoughts: sim.budget };
}

/** `say`: costs 1, at most one per 2 seconds; a refused say costs nothing. */
export function sayTool(hub: SimHub, ctx: ToolContext, _input: SayInput): SayResult {
  const sim = hub.player(ctx.playerId);
  const refused = (reason: string): SayResult => ({
    spoken: false,
    reason,
    budget_remaining_thoughts: sim.budget,
  });
  if (!canAfford(sim)) return refused('budget_exhausted');
  if (!sayAllowed(sim, hub.clock.nowMs())) return refused('rate_limited');
  charge(sim);
  receipt(sim);
  return { spoken: true, budget_remaining_thoughts: sim.budget };
}
