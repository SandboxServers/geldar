/**
 * Applies a validated `Reflection` to memory (spec 5.4 steps 2 to 6). Everything goes through the
 * `MemoryStore` port, so the store decides what a relationship row may be keyed by (overnight
 * decision 40). Nothing is deleted: a belief is retired by `active = false`. Provenance is guarded:
 * a `report` is never promoted to an `observation` unless the digest holds a matching own one.
 */
import type { Reflection } from '@geldar/contract';
import type { Embedder, MemoryRow, MemoryStore, NewMemory, Provenance } from '../ports/index.ts';
import { type Digest, sameStatement } from './digest.ts';

/** The most memories a degraded (fatigued) reflection keeps. */
export const DEGRADED_MAX_MEMORIES = 2;

/** What `applyReflection` did. */
export interface ApplyResult {
  memoriesWritten: number;
  beliefsAdded: number;
  beliefsRemoved: number;
  relationshipsUpdated: number;
  goalsSet: number;
  /** True when only the degraded subset was applied. */
  degraded: boolean;
}

/** What the apply step needs to know about the reflection it applies. */
export interface ApplyContext {
  lifeId: string;
  day: number;
  /** The thought row of the reflection, recorded as the source of every memory. */
  thoughtId: string;
  degraded: boolean;
  digest: Pick<Digest, 'ownObservations' | 'heard'>;
  /** The active beliefs before the reflection. */
  beliefs: MemoryRow[];
}

function clampTrust(trust: number): number {
  return Math.min(100, Math.max(0, Math.round(trust)));
}

/**
 * The provenance a statement may carry. An `observation` stands only on a matching own
 * observation in the digest; when it matches nothing of its own but something heard, or an
 * existing report belief, it stays a `report`.
 */
export function guardProvenance(
  text: string,
  claimed: Provenance,
  context: Pick<ApplyContext, 'digest' | 'beliefs'>,
): Provenance {
  if (claimed !== 'observation') return claimed;
  if (context.digest.ownObservations.some((o) => sameStatement(o, text))) return 'observation';
  const heard = context.digest.heard.some((h) => sameStatement(h, text));
  const reported = context.beliefs.some(
    (b) => b.provenance === 'report' && sameStatement(b.text, text),
  );
  return heard || reported ? 'report' : 'observation';
}

/** Applies `reflection`; throws if the embedder or the store does, before setting the sleep day. */
export async function applyReflection(
  deps: { store: MemoryStore; embedder: Embedder },
  reflection: Reflection,
  context: ApplyContext,
): Promise<ApplyResult> {
  const { store, embedder } = deps;
  const { lifeId, day, thoughtId } = context;
  const base = { createdDay: day, sourceThought: thoughtId, sourceAgent: null, dueTick: null };
  const keep = context.degraded
    ? reflection.memories_to_keep.slice(0, DEGRADED_MAX_MEMORIES)
    : reflection.memories_to_keep;
  const memories: NewMemory[] = keep.map((text) => ({
    ...base,
    kind: 'episodic',
    provenance: guardProvenance(text, 'observation', context),
    subject: null,
    text,
  }));
  const beliefs = context.degraded ? [] : reflection.beliefs_add;
  for (const b of beliefs) {
    memories.push({
      ...base,
      kind: 'semantic',
      provenance: guardProvenance(b.belief, b.kind, context),
      subject: null,
      text: b.belief,
    });
  }
  if (!context.degraded) {
    memories.push({
      ...base,
      kind: 'episodic',
      provenance: 'interpretation',
      subject: `day_summary:${day}`,
      text: reflection.day_summary,
    });
  }

  let memoriesWritten = 0;
  if (memories.length > 0) {
    const embeddings = await embedder.embed(
      memories.map((m) => m.text),
      'document',
    );
    memoriesWritten = (await store.writeMemories(lifeId, memories, embeddings)).length;
  }
  const result: ApplyResult = {
    memoriesWritten,
    beliefsAdded: beliefs.length,
    beliefsRemoved: 0,
    relationshipsUpdated: 0,
    goalsSet: 0,
    degraded: context.degraded,
  };
  if (!context.degraded) {
    // A belief added and removed in one reflection stays: the removal never reaches the new row.
    const added = new Set(beliefs.map((b) => b.belief));
    const removals = reflection.beliefs_remove.filter((text) => !added.has(text));
    if (removals.length > 0)
      result.beliefsRemoved = await store.deactivateBeliefs(lifeId, removals);
    const updates = reflection.relationship_updates.map((u) => ({
      ...u,
      trust: clampTrust(u.trust),
    })) as Reflection['relationship_updates'];
    if (updates.length > 0) await store.upsertRelationships(lifeId, updates, day);
    result.relationshipsUpdated = updates.length;
    await store.replaceGoals(lifeId, reflection.goals);
    result.goalsSet = reflection.goals.length;
  }
  await store.setLastSleepDay(lifeId, day);
  return result;
}
