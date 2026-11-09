/** In-memory fakes of the Body's sense interfaces, for tests of code that builds on them. */
import type { Snapshot } from '@geldar/contract';
import type { Ears, Perception, SayOutcome, Voice } from './senses.ts';

/** A `Perception` that returns what the test set. */
export class FakePerception implements Perception {
  surroundingsValue: Snapshot['surroundings'] = {
    blocks_summary: '',
    notable_blocks: [],
    entities: [],
    agents: [],
  };
  recipes: string[] = [];

  surroundings(): Snapshot['surroundings'] {
    return this.surroundingsValue;
  }

  unlockedRecipes(): string[] {
    return [...this.recipes];
  }
}

/** An `Ears` with queued events: `heard` is a plain list, `drainEvents` empties the queue. */
export class FakeEars implements Ears {
  lines: Snapshot['heard'] = [];
  queued: Snapshot['events_since_last_thought'] = [];

  heard(): Snapshot['heard'] {
    return [...this.lines];
  }

  drainEvents(): Snapshot['events_since_last_thought'] {
    const events = this.queued;
    this.queued = [];
    return events;
  }
}

/** A `Voice` that records what it was asked to say and answers with the scripted outcome. */
export class FakeVoice implements Voice {
  /** Every text passed to `say`, in order, including refused ones. */
  said: string[] = [];
  /** When set, every call resolves with this outcome instead of `said`. */
  outcome: SayOutcome | null = null;

  async say(text: string): Promise<SayOutcome> {
    this.said.push(text);
    return this.outcome ?? { status: 'said', text };
  }
}
