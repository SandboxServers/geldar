import type {
  ActionOutcome,
  DefineSkillInput,
  DefineSkillResult,
  OfferInput,
  ProposeInput,
  ProposeResult,
  ReadBookResult,
  UseSkillInput,
  VoteInput,
  WriteBookInputArgs,
  WriteBookResult,
} from '@geldar/contract';
import { type ToolContext, ToolError } from '../registry.ts';
import type { SimHub } from './hub.ts';
import type { PlayerSim } from './player-sim.ts';
import { WORLD_TEXT_NOTE, worldText } from './present.ts';

/** What a delegated act item answers: accepted, or refused with a reason code. */
export interface Applied {
  accepted: boolean;
  reason?: string;
}

interface StoredBook {
  title: string;
  kind: 'text' | 'skill';
  text: string;
  skill_id?: string;
}

/** What one life has written and defined. Skill code is stored as text and never run. */
interface Shelf {
  books: Map<string, StoredBook>;
  skills: Map<string, string>;
  proposals: Set<string>;
}

const shelves = new WeakMap<PlayerSim, Shelf>();

function shelfOf(sim: PlayerSim): Shelf {
  let shelf = shelves.get(sim);
  if (!shelf) {
    shelf = { books: new Map(), skills: new Map(), proposals: new Set() };
    shelves.set(sim, shelf);
  }
  return shelf;
}

/** True if the player can still pay for one more item. */
export function canAfford(sim: PlayerSim): boolean {
  return sim.budget >= 1;
}

/** Takes 1 thought from the budget; call only for an item that was applied. */
export function charge(sim: PlayerSim): void {
  sim.budget -= 1;
}

function outcome(sim: PlayerSim, applied: Applied): ActionOutcome {
  return {
    accepted: applied.accepted,
    ...(applied.reason !== undefined ? { reason: applied.reason } : {}),
    budget_remaining_thoughts: sim.budget,
  };
}

/** Runs one costed item that answers an `ActionOutcome`: budget check, apply, charge when accepted. */
function costed(sim: PlayerSim, apply: () => Applied): ActionOutcome {
  if (!canAfford(sim)) return outcome(sim, { accepted: false, reason: 'budget_exhausted' });
  const applied = apply();
  if (applied.accepted) charge(sim);
  return outcome(sim, applied);
}

/** Registers a skill name with its code. The code is kept as text: nothing here ever runs it. */
export function applyDefineSkill(sim: PlayerSim, input: DefineSkillInput): string {
  shelfOf(sim).skills.set(input.name, input.code);
  return input.name;
}

/** Records a book and puts one `written_book` stack in the inventory; returns the book id. */
export function applyWriteBook(sim: PlayerSim, input: WriteBookInputArgs): string {
  const shelf = shelfOf(sim);
  let stored: StoredBook;
  if (input.skill_id !== undefined) {
    const code = shelf.skills.get(input.skill_id);
    if (code === undefined) throw new ToolError('unknown_skill', 'That skill is not defined.');
    stored = { title: input.title, kind: 'skill', text: code, skill_id: input.skill_id };
  } else {
    stored = { title: input.title, kind: 'text', text: input.text ?? '' };
  }
  const id = sim.nextId('bk');
  shelf.books.set(id, stored);
  sim.inventory = [...sim.inventory, { item: 'written_book', count: 1, book_id: id }];
  return id;
}

/** Using a skill: accepted for a name defined this life. The skill does not run. */
export function applyUseSkill(sim: PlayerSim, input: UseSkillInput): Applied {
  return shelfOf(sim).skills.has(input.name)
    ? { accepted: true }
    : { accepted: false, reason: 'unknown_skill' };
}

/** Offering takes the items out of the inventory, or refuses `not_held`. */
export function applyOffer(sim: PlayerSim, input: OfferInput): Applied {
  const at = sim.inventory.findIndex((s) => s.item === input.item && s.count >= input.count);
  const stack = sim.inventory[at];
  if (stack === undefined) return { accepted: false, reason: 'not_held' };
  sim.inventory = sim.inventory
    .map((s, i) => (i === at ? { ...s, count: s.count - input.count } : s))
    .filter((s) => s.count > 0);
  return { accepted: true };
}

/** A proposal: accepted with a fresh `pr_` id, remembered for `vote`. */
export function applyPropose(sim: PlayerSim): string {
  const id = sim.nextId('pr');
  shelfOf(sim).proposals.add(id);
  return id;
}

/** Voting counts for a proposal id from the scenario or from `propose`, else `unknown_proposal`. */
export function applyVote(sim: PlayerSim, input: VoteInput): Applied {
  const known =
    shelfOf(sim).proposals.has(input.proposal_id) ||
    sim.scenario.events.some((e) => e.type === 'proposal' && e.id === input.proposal_id);
  return known ? { accepted: true } : { accepted: false, reason: 'unknown_proposal' };
}

/** `read_book`: the first book the player holds; its text goes only under `untrusted_world_text`. */
export function readBookTool(hub: SimHub, ctx: ToolContext): ReadBookResult {
  const sim = hub.player(ctx.playerId);
  const shelf = shelfOf(sim);
  for (const stack of sim.inventory) {
    if (stack.book_id === undefined) continue;
    const written = shelf.books.get(stack.book_id);
    const book =
      written ??
      (() => {
        const b = hub.scenario.books.find((x) => x.id === stack.book_id);
        return b ? { title: b.title, kind: b.kind, text: b.text, skill_id: b.skill_id } : undefined;
      })();
    if (!book) continue;
    return {
      book_id: stack.book_id,
      kind: book.kind,
      ...(book.skill_id !== undefined ? { skill_id: book.skill_id } : {}),
      untrusted_world_text: worldText([], { book: { title: book.title, text: book.text } }),
      note: WORLD_TEXT_NOTE,
    };
  }
  throw new ToolError('no_book', 'You hold no book.');
}

function needThought(sim: PlayerSim): void {
  if (!canAfford(sim)) throw new ToolError('budget_exhausted', 'No thoughts left.');
}

/** `write_book`: costs 1. */
export function writeBookTool(
  hub: SimHub,
  ctx: ToolContext,
  input: WriteBookInputArgs,
): WriteBookResult {
  const sim = hub.player(ctx.playerId);
  needThought(sim);
  const id = applyWriteBook(sim, input);
  charge(sim);
  return { book_id: id, budget_remaining_thoughts: sim.budget };
}

/** `define_skill`: costs 1; registers the name and never executes the code. */
export function defineSkillTool(
  hub: SimHub,
  ctx: ToolContext,
  input: DefineSkillInput,
): DefineSkillResult {
  const sim = hub.player(ctx.playerId);
  needThought(sim);
  const id = applyDefineSkill(sim, input);
  charge(sim);
  return {
    skill_id: id,
    ok: true,
    tests_passed: 1,
    tests_failed: 0,
    budget_remaining_thoughts: sim.budget,
  };
}

/** `use_skill`: costs 1 when the skill is defined. */
export function useSkillTool(hub: SimHub, ctx: ToolContext, input: UseSkillInput): ActionOutcome {
  const sim = hub.player(ctx.playerId);
  return costed(sim, () => applyUseSkill(sim, input));
}

/** `offer`: costs 1 when the item is held. */
export function offerTool(hub: SimHub, ctx: ToolContext, input: OfferInput): ActionOutcome {
  const sim = hub.player(ctx.playerId);
  return costed(sim, () => applyOffer(sim, input));
}

/** `propose`: costs 1; returns a `pr_` id. */
export function proposeTool(hub: SimHub, ctx: ToolContext, _input: ProposeInput): ProposeResult {
  const sim = hub.player(ctx.playerId);
  if (!canAfford(sim)) {
    return {
      accepted: false,
      reason: 'budget_exhausted',
      proposal_id: 'pr_none',
      budget_remaining_thoughts: sim.budget,
    };
  }
  const id = applyPropose(sim);
  charge(sim);
  return { accepted: true, proposal_id: id, budget_remaining_thoughts: sim.budget };
}

/** `vote`: costs 1 for a known proposal. */
export function voteTool(hub: SimHub, ctx: ToolContext, input: VoteInput): ActionOutcome {
  const sim = hub.player(ctx.playerId);
  return costed(sim, () => applyVote(sim, input));
}
