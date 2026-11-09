import type {
  AgentRow,
  Embedder,
  GoalRow,
  Journal,
  JournalEntry,
  MemoryRow,
  MemoryStore,
  NewMemory,
  RelationshipRow,
} from '../ports/index.ts';

/** How many relationships are loaded in full; the rest are named only (spec 5.4). */
export const RELATIONSHIPS_IN_FULL = 6;

/** The working window of a fatigued agent (spec 5.4; 20 otherwise, from `memory.working_window`). */
export const FATIGUED_WORKING_WINDOW = 10;

/** What a retrieval is asked for. */
export interface RetrievalRequest {
  lifeId: string;
  nowTick: number;
  /** The world day, to tell whether the agent is fatigued. */
  nowDay: number;
  /** Ids, names or accounts of the agents in view; matched to `otherId` and to belief subjects. */
  visibleAgents: string[];
  /** Notable things in view (block or item names); matched to belief subjects. */
  notableThings: string[];
  /** The text to search episodic memory with; an empty text skips the vector search. */
  query: string;
}

/** The memory a thought is built from, in the order of loading. */
export interface RetrievedMemory {
  agent: AgentRow;
  fatigued: boolean;
  /** The goal stack, rank 0 first. */
  goals: GoalRow[];
  /** Due, unresolved commitments, by due tick. Always loaded, whatever the query. */
  commitments: MemoryRow[];
  /** The top relationships of visible agents by trust magnitude, then recency. */
  relationships: RelationshipRow[];
  /** Visible agents whose relationship did not make the top; named only. */
  relationshipsNamedOnly: string[];
  /** Beliefs whose subject matches a visible agent or notable thing. */
  beliefs: MemoryRow[];
  /** Episodic memories nearest the query, none of them already loaded above. */
  episodic: MemoryRow[];
  /** The last working-window journal entries, oldest first. */
  workingWindow: JournalEntry[];
  /** True when the vector search was skipped because embedding failed. */
  degraded: boolean;
}

/** Where a failed embedding is logged and counted. */
export interface RetrievalObserver {
  onEmbedFailure(error: unknown): void;
}


/** Days awake at which an agent is fatigued; the clock starts at the last sleep, or at birth. */
export function isFatigued(agent: AgentRow, nowDay: number, fatigueDays: number): boolean {
  const since = agent.lastSleepDay ?? agent.bornDay ?? nowDay;
  return nowDay - since >= fatigueDays;
}

/**
 * Ranks relationships by trust magnitude (distance from the neutral 50), then by the most recent
 * `lastSeenDay`, then by `otherId` for a stable order. Returns a new array.
 */
export function rankRelationships(rows: RelationshipRow[]): RelationshipRow[] {
  return [...rows].sort(
    (a, b) =>
      Math.abs(b.trust - 50) - Math.abs(a.trust - 50) ||
      (b.lastSeenDay ?? -1) - (a.lastSeenDay ?? -1) ||
      a.otherId.localeCompare(b.otherId),
  );
}

/**
 * Loads memory deterministically first (goals, due commitments, relationships and beliefs of what
 * is in view), then fills with episodic memories by vector, then adds the working window.
 */
export class MemoryRetriever {
  /** How many retrievals fell back to deterministic memory only. */
  degradedCount = 0;

  private readonly store: MemoryStore;
  private readonly journal: Journal;
  private readonly embedder: Embedder;
  private readonly settings: { workingWindow: number; episodicTopK: number; fatigueDays: number };
  private readonly observer: RetrievalObserver;

  constructor(
    store: MemoryStore,
    journal: Journal,
    embedder: Embedder,
    settings: { workingWindow: number; episodicTopK: number; fatigueDays: number },
    observer: RetrievalObserver = { onEmbedFailure: () => undefined },
  ) {
    this.store = store;
    this.journal = journal;
    this.embedder = embedder;
    this.settings = settings;
    this.observer = observer;
  }

  async retrieve(request: RetrievalRequest): Promise<RetrievedMemory> {
    const loaded = await this.store.loadDeterministic(request.lifeId, request.nowTick);
    const fatigued = isFatigued(loaded.agent, request.nowDay, this.settings.fatigueDays);
    const visible = new Set(request.visibleAgents.map((v) => v.toLowerCase()));
    const subjects = new Set([...visible, ...request.notableThings.map((t) => t.toLowerCase())]);

    const inView = rankRelationships(
      loaded.relationships.filter((r) => visible.has(r.otherId.toLowerCase())),
    );
    const relationships = inView.slice(0, RELATIONSHIPS_IN_FULL);
    const relationshipsNamedOnly = inView.slice(RELATIONSHIPS_IN_FULL).map((r) => r.otherId);

    const beliefs = loaded.beliefs.filter(
      (b) => b.subject !== null && subjects.has(stripRelationshipPrefix(b.subject).toLowerCase()),
    );
    const alreadyLoaded = new Set([...loaded.dueCommitments, ...beliefs].map((m) => m.memoryId));

    const { episodic, degraded } = await this.searchEpisodic(request, alreadyLoaded);
    const window = fatigued ? FATIGUED_WORKING_WINDOW : this.settings.workingWindow;
    const journal = await this.journal.journalSince(request.lifeId, 0, window);

    return {
      agent: loaded.agent,
      fatigued,
      goals: loaded.goals,
      commitments: loaded.dueCommitments,
      relationships,
      relationshipsNamedOnly,
      beliefs,
      episodic,
      workingWindow: journal,
      degraded,
    };
  }

  /**
   * Writes memories with their vectors. When the embedder fails the failure is logged and counted
   * and the memories are stored with a NULL embedding for `backfillEmbeddings` to fill in.
   */
  async remember(
    store: MemoryStore,
    lifeId: string,
    memories: NewMemory[],
  ): Promise<number[]> {
    if (memories.length === 0) return [];
    let vectors: (number[] | null)[];
    try {
      vectors = await this.embedder.embed(
        memories.map((m) => m.text),
        'document',
      );
    } catch (error) {
      this.degradedCount++;
      this.observer.onEmbedFailure(error);
      vectors = memories.map(() => null);
    }
    return store.writeMemoriesPartial(lifeId, memories, vectors);
  }

  private async searchEpisodic(
    request: RetrievalRequest,
    alreadyLoaded: Set<number>,
  ): Promise<{ episodic: MemoryRow[]; degraded: boolean }> {
    if (request.query.trim() === '') return { episodic: [], degraded: false };
    const topK = this.settings.episodicTopK;
    let vector: number[] | undefined;
    try {
      [vector] = await this.embedder.embed([request.query], 'query');
      if (vector === undefined) throw new Error('the embedder returned no vector');
    } catch (error) {
      this.degradedCount++;
      this.observer.onEmbedFailure(error);
      return { episodic: [], degraded: true };
    }
    // Ask for enough extra rows to still fill the slots after dropping what is loaded.
    const found = await this.store.searchEpisodic(
      request.lifeId,
      vector,
      topK + alreadyLoaded.size,
    );
    return {
      episodic: found.filter((m) => !alreadyLoaded.has(m.memoryId)).slice(0, topK),
      degraded: false,
    };
  }
}

function stripRelationshipPrefix(subject: string): string {
  return subject.startsWith('relationship:') ? subject.slice('relationship:'.length) : subject;
}
