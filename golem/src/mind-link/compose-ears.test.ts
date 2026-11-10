import type { Snapshot } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { composeEars } from './compose-ears.ts';

const HEARD: Snapshot['heard'] = [{ from: 'Eve', text: 'hello', tick: 1, distance: 3 }] as never;
const DIGEST: Snapshot['events_since_last_thought'] = [
  { type: 'wake', tick: 2 },
] as unknown as Snapshot['events_since_last_thought'];

describe('composeEars', () => {
  it('reads heard from the chat ears and passes peek and ack to the digest', () => {
    const acked: number[] = [];
    const ears = composeEars(
      { heard: () => HEARD },
      {
        peekEvents: () => DIGEST,
        ackEvents: (count) => {
          acked.push(count);
        },
      },
    );
    expect(ears.heard()).toBe(HEARD);
    expect(ears.peekEvents()).toBe(DIGEST);
    expect(acked).toEqual([]);
    ears.ackEvents(1);
    expect(acked).toEqual([1]);
  });
});
