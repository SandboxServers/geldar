/**
 * Applies a validated `Reflection` to memory (spec 5.4 steps 2 to 6). Everything goes through the
 * `MemoryStore` port in one `commitReflection` call, so a failed apply writes nothing and the next
 * sleep runs again. An embedder failure does not discard the reflection: the memories are stored
 * with a NULL vector for `backfillEmbeddings`. Nothing is deleted: a belief is retired by
 * `active = false`, and a commitment that is retired is also resolved. Provenance is guarded: a
 * `report` is never promoted to an `observation` unless the digest holds a matching own one.
 */
import type { Reflection } from '@geldar/contract';
import type {
  Embedder,
  MemoryRow,
  MemoryStore,
  NewMemory,
  Provenance,
  ReflectionWrites,
} from '../ports/index.ts';
import { type Digest, sameStatement } from './digest.ts';

/** The most memories a degraded (fatigued) reflection keeps. */
export const DEGRADED_MAX_MEMORIES = 2;

/** Where a reported failure goes; `console.error` when none is given. */
export type LogLine = (message: string) => void;

/** What `applyReflection` needs besides the reflection and its context. */
export interface ApplyDeps {
  store: MemoryStore;
  embedder: Embedder;
  log?: LogLine;
}

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

/** Embeds `texts`; when the embedder fails, every text gets null and is stored for backfill. */
async function embedOrNull(
  embedder: Embedder,
  texts: string[],
  log: LogLine,
): Promise<(number[] | null)[]> {
  try {
    return await embedder.embed(texts, 'document');
  } catch (error) {
    log(`reflection: embedding failed, ${texts.length} memories stored without vectors: ${error}`);
    return texts.map(() => null);
  }
}

/** Applies `reflection`; throws, having written nothing, when the store fails. */
export async function applyReflection(
  deps: ApplyDeps,
  reflection: Reflection,
  context: ApplyContext,
): Promise<ApplyResult> {
  const { store, embedder } = deps;
  const log: LogLine = deps.log ?? ((message) => console.error(message));
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

  // A belief added and removed in one reflection stays: the removal never reaches the new row.
  const added = new Set(beliefs.map((b) => b.belief));
  const removals = context.degraded
    ? []
    : reflection.beliefs_remove.filter((text) => !added.has(text));
  const writes: ReflectionWrites = {
    day,
    memories,
    embeddings:
      memories.length === 0
        ? []
        : await embedOrNull(
            embedder,
            memories.map((m) => m.text),
            log,
          ),
    deactivate: removals,
    resolve: context.beliefs
      .filter((b) => b.provenance === 'commitment' && removals.includes(b.text))
      .map((b) => b.memoryId),
    relationships: context.degraded
      ? []
      : (reflection.relationship_updates.map((u) => ({
          ...u,
          trust: clampTrust(u.trust),
        })) as Reflection['relationship_updates']),
    goals: context.degraded ? null : reflection.goals,
  };
  const beliefsRemoved = await store.commitReflection(lifeId, writes);
  return {
    memoriesWritten: memories.length,
    beliefsAdded: beliefs.length,
    beliefsRemoved,
    relationshipsUpdated: writes.relationships.length,
    goalsSet: writes.goals?.length ?? 0,
    degraded: context.degraded,
  };
}
