import { markedWords } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import {
  type MaintenanceNotice,
  maintenanceEvent,
  maintenanceSentence,
  parseMaintenanceNotice,
} from './maintenance-notice.ts';
import { RingEventLog } from './player-log.ts';
import { PRESENT_HANDLERS, presentEvents } from './present-handlers/index.ts';
import { handleStreamMessage } from './stream.ts';

const LIVES = ['ag_jason_01', 'ag_mira_01'];
const KINDS = ['pause', 'restart', 'back'] as const;
const SCOPES = ['bodies', 'world', 'mcp'] as const;

const notice = (kind: string, scope: string, seconds?: number): Record<string, unknown> => ({
  id: 'deploy-0001',
  kind,
  scope,
  ...(seconds === undefined ? {} : { seconds }),
});

describe('maintenance notice wording', () => {
  it('a pause on the bodies states its countdown in seconds', () => {
    expect(maintenanceSentence({ kind: 'pause', scope: 'bodies', seconds: 90 })).toBe(
      'The world will go still for about 90 seconds.',
    );
  });

  it('a pause on the bodies with no countdown omits the number', () => {
    const text = maintenanceSentence({ kind: 'pause', scope: 'bodies' });
    expect(text).toBe('The world will go still for a while.');
    expect(text).not.toMatch(/\d/);
  });

  it('a pause on the world reads as the world about to stop, whatever its seconds', () => {
    const expected = 'The world is about to stop for a short while.';
    expect(maintenanceSentence({ kind: 'pause', scope: 'world' })).toBe(expected);
    expect(maintenanceSentence({ kind: 'pause', scope: 'world', seconds: 30 })).toBe(expected);
  });

  it('a restart reads as the world about to stop, in every scope', () => {
    for (const scope of SCOPES) {
      expect(maintenanceSentence({ kind: 'restart', scope })).toBe(
        'The world is about to stop for a short while.',
      );
    }
  });

  it('a pause on the mcp reads as the senses flickering', () => {
    expect(maintenanceSentence({ kind: 'pause', scope: 'mcp', seconds: 30 })).toBe(
      'Your senses may flicker for a moment.',
    );
  });

  it('back reads as the world moving again, in every scope', () => {
    for (const scope of SCOPES) {
      expect(maintenanceSentence({ kind: 'back', scope })).toBe('The world moves again.');
    }
  });

  it('no combination of kind, scope and seconds reads with a forbidden word', () => {
    const seconds = [undefined, 0, 1, 600];
    for (const kind of KINDS) {
      for (const scope of SCOPES) {
        for (const s of seconds) {
          const text = maintenanceSentence({
            kind,
            scope,
            ...(s === undefined ? {} : { seconds: s }),
          });
          expect(markedWords(text), `${kind}/${scope}/${s}`).toEqual([]);
          for (const word of ['deploy', 'operator', 'update', 'server', 'observer', 'watcher']) {
            expect(text.toLowerCase()).not.toContain(word);
          }
        }
      }
    }
  });
});

describe('maintenance notice contract', () => {
  it('accepts a notice with and without a countdown', () => {
    expect(parseMaintenanceNotice(notice('pause', 'bodies', 60))).not.toBeNull();
    expect(parseMaintenanceNotice(notice('pause', 'bodies'))).not.toBeNull();
  });

  it('refuses an unknown kind', () => {
    expect(parseMaintenanceNotice(notice('explode', 'bodies'))).toBeNull();
  });

  it('refuses an unknown scope, a countdown over 600 and free text', () => {
    expect(parseMaintenanceNotice(notice('pause', 'the_moon'))).toBeNull();
    expect(parseMaintenanceNotice(notice('pause', 'bodies', 601))).toBeNull();
    expect(parseMaintenanceNotice({ ...notice('pause', 'bodies'), text: 'free words' })).toBeNull();
  });
});

describe('maintenance notice in the event stream', () => {
  function context(log: RingEventLog) {
    return {
      map: { identity: {} as never, runs: new Map() },
      log,
      lives: () => LIVES,
    };
  }

  it('delivers the notice to every live agent as one world line each, with no wake', async () => {
    const log = new RingEventLog();
    const counters = { invalid: 0 };
    await handleStreamMessage(4, notice('pause', 'bodies', 60), context(log), counters);
    expect(counters.invalid).toBe(0);
    for (const lifeId of LIVES) {
      const { events } = await log.since(lifeId, 0);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: 'maintenance', wakeOn: null });
      expect(events[0]?.text).toBe('The world will go still for about 60 seconds.');
    }
  });

  it('a redelivery at the same stream sequence is one line per life', async () => {
    const log = new RingEventLog();
    const counters = { invalid: 0 };
    await handleStreamMessage(4, notice('back', 'world'), context(log), counters);
    await handleStreamMessage(4, notice('back', 'world'), context(log), counters);
    for (const lifeId of LIVES) {
      expect((await log.since(lifeId, 0)).events).toHaveLength(1);
    }
  });

  it('counts a notice with an unknown kind as invalid and delivers nothing', async () => {
    const log = new RingEventLog();
    const counters = { invalid: 0 };
    await handleStreamMessage(5, notice('explode', 'bodies'), context(log), counters);
    expect(counters.invalid).toBe(1);
    expect((await log.since(LIVES[0] as string, 0)).events).toEqual([]);
  });

  it('presents the notice as the fixed sentence in a day_night-typed player line', () => {
    const n: MaintenanceNotice = { id: 'deploy-0002', kind: 'back', scope: 'bodies' };
    const lines = presentEvents(PRESENT_HANDLERS, [maintenanceEvent(9, n)]);
    expect(lines).toEqual([{ seq: 9, tick: 0, type: 'day_night', text: 'The world moves again.' }]);
  });
});
