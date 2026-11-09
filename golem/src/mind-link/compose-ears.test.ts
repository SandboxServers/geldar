import type { Snapshot } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { composeEars } from './compose-ears.ts';

const HEARD: Snapshot['heard'] = [{ from: 'Eve', text: 'hello', tick: 1, distance: 3 }] as never;
const DIGEST: Snapshot['events_since_last_thought'] = [
  { type: 'wake', tick: 2 },
] as unknown as Snapshot['events_since_last_thought'];

describe('composeEars', () => {
  it('reads heard from the chat ears and drains events from the digest, each once', () => {
    let drained = 0;
    const ears = composeEars(
      { heard: () => HEARD },
      {
        drainEvents: () => {
          drained++;
          return DIGEST;
        },
      },
    );
    expect(ears.heard()).toBe(HEARD);
    expect(ears.heard()).toBe(HEARD);
    expect(drained).toBe(0);
    expect(ears.drainEvents()).toBe(DIGEST);
    expect(drained).toBe(1);
  });
});
