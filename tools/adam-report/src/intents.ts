import type { ActionRow, IntentRow, Measure, ReceiptRow, ThoughtRow, Value } from './types.ts';

const TERMINAL_ACTION = new Set(['completed', 'failed', 'cancelled']);
const FINAL_PHASE = new Set(['committed', 'aborted']);

/** Maps each action id to its intent id, for actions that have one. */
export function intentByAction(actions: ActionRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of actions) if (a.intentId !== null) map.set(a.actionId, a.intentId);
  return map;
}

/** Completed intents with no model call during their tick range (a tick range is needed). */
export function intentsWithoutCall(
  intents: IntentRow[],
  thoughts: ThoughtRow[],
): { without: number; unmeasured: number } {
  let without = 0;
  let unmeasured = 0;
  for (const i of intents) {
    if (i.state !== 'completed') continue;
    if (i.startedTick === null || i.endedTick === null) {
      unmeasured++;
      continue;
    }
    const start = i.startedTick;
    const end = i.endedTick;
    const called = thoughts.some((t) => t.called && t.tick >= start && t.tick <= end);
    if (!called) without++;
  }
  return { without, unmeasured };
}

/** Completed intents whose actions ran in two or more Body generations: a checkpoint resume. */
export function resumedIntents(intents: IntentRow[], actions: ActionRow[]): number {
  const gens = new Map<string, Set<number>>();
  for (const a of actions) {
    if (a.intentId === null || a.bodyGeneration === null) continue;
    const set = gens.get(a.intentId) ?? new Set<number>();
    set.add(a.bodyGeneration);
    gens.set(a.intentId, set);
  }
  return intents.filter((i) => i.state === 'completed' && (gens.get(i.intentId)?.size ?? 0) >= 2)
    .length;
}

/** The intent measures: completed, chatter-interrupted, completed without a model call. */
export function intentMeasures(
  intents: IntentRow[],
  thoughts: ThoughtRow[],
  minWithoutCall: number | null,
  windowText: string,
): Measure[] {
  const completed = intents.filter((i) => i.state === 'completed').length;
  const chatter = intents.filter(
    (i) => i.endReason?.startsWith('interrupted:') && i.endReason.includes('chatter'),
  ).length;
  const { without, unmeasured } = intentsWithoutCall(intents, thoughts);
  const values: Record<string, Value> = {
    intents_total: intents.length,
    completed,
    interrupted_by_chatter: chatter,
    completed_without_model_call: without,
    completed_without_tick_range: unmeasured,
  };
  const base = {
    id: 'intents',
    title: 'Intents completed without a model call',
    window: windowText,
    values,
  };
  if (intents.length === 0) return [{ ...base, verdict: 'UNKNOWN', note: 'no intents recorded' }];
  if (minWithoutCall === null)
    return [{ ...base, verdict: 'UNKNOWN', note: 'not computed: definition pending' }];
  const verdict = without >= minWithoutCall ? 'PASS' : 'FAIL';
  return [{ ...base, verdict, note: `${without} against a minimum of ${minWithoutCall}` }];
}

/** Checkpoint resume: a completed intent whose actions span a Body restart. */
export function resumeMeasure(
  intents: IntentRow[],
  actions: ActionRow[],
  bodyRestarts: number | null,
  windowText: string,
): Measure {
  const resumed = resumedIntents(intents, actions);
  const values: Record<string, Value> = {
    checkpoint_resumes: resumed,
    body_restarts: bodyRestarts,
  };
  const base = {
    id: 'resume',
    title: 'Body restart mid-intent resumed from checkpoint',
    window: windowText,
    values,
  };
  if (resumed > 0)
    return { ...base, verdict: 'PASS', note: 'a completed intent ran in two Body generations' };
  if (intents.length === 0 && actions.length === 0)
    return { ...base, verdict: 'UNKNOWN', note: 'no intents or actions recorded' };
  if (bodyRestarts === null)
    return { ...base, verdict: 'UNKNOWN', note: 'no restart record in the manifest' };
  if (bodyRestarts === 0)
    return { ...base, verdict: 'UNKNOWN', note: 'no Body restart in the run' };
  return { ...base, verdict: 'FAIL', note: 'a Body restart happened and no intent resumed' };
}

/** The receipt measure: terminal actions with one final receipt; economic actions with a prepared row. */
export function receiptMeasure(
  actions: ActionRow[],
  receipts: ReceiptRow[],
  windowText: string,
): Measure {
  const terminal = actions.filter((a) => TERMINAL_ACTION.has(a.state));
  const finals = new Map<string, number>();
  const phases = new Map<string, Set<string>>();
  for (const r of receipts) {
    if (FINAL_PHASE.has(r.phase)) finals.set(r.actionId, (finals.get(r.actionId) ?? 0) + 1);
    const set = phases.get(r.actionId) ?? new Set<string>();
    set.add(r.phase);
    phases.set(r.actionId, set);
  }
  const badFinalIds = terminal.filter((a) => finals.get(a.actionId) !== 1).map((a) => a.actionId);
  const economic = actions.filter((a) => phases.has(a.actionId));
  const noPreparedIds = economic
    .filter((a) => !phases.get(a.actionId)?.has('prepared'))
    .map((a) => a.actionId);
  const values: Record<string, Value> = {
    actions_total: actions.length,
    terminal_actions: terminal.length,
    terminal_without_one_final_receipt: badFinalIds.length,
    economic_actions: economic.length,
    economic_without_prepared: noPreparedIds.length,
  };
  const base = { id: 'receipts', title: 'Every action has a receipt', window: windowText, values };
  if (terminal.length === 0) return { ...base, verdict: 'UNKNOWN', note: 'no terminal action' };
  if (badFinalIds.length > 0)
    return {
      ...base,
      verdict: 'FAIL',
      note: `action ${badFinalIds[0]} has no one final receipt`,
    };
  if (noPreparedIds.length > 0)
    return {
      ...base,
      verdict: 'FAIL',
      note: `economic action ${noPreparedIds[0]} has no prepared receipt`,
    };
  return { ...base, verdict: 'PASS', note: 'one final receipt per terminal action' };
}
