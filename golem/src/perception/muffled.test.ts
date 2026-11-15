import { describe, expect, it } from 'vitest';
import { MUFFLED_NOTICE_CAP, selectMuffledNotices } from './muffled.ts';

const n = (direction: string, band: string) => ({ direction, band });

describe('selectMuffledNotices', () => {
  it('selects nothing for no notices', () => {
    expect(selectMuffledNotices([])).toEqual([]);
  });

  it('collapses five notices in one direction to one notice with the band of the nearest', () => {
    const notices = selectMuffledNotices([
      n('n', 'far'),
      n('n', 'far'),
      n('n', 'mid'),
      n('n', 'near'),
      n('n', 'far'),
    ]);
    expect(notices).toEqual([{ direction: 'n', band: 'near' }]);
  });

  it('keeps overhead and below apart from the compass points', () => {
    expect(selectMuffledNotices([n('overhead', 'near'), n('n', 'far')])).toEqual([
      { direction: 'overhead', band: 'near' },
      { direction: 'n', band: 'far' },
    ]);
    expect(selectMuffledNotices([n('overhead', 'near'), n('below', 'near')])).toHaveLength(2);
  });

  it('caps the list at three notices and keeps the nearest bands first', () => {
    expect(MUFFLED_NOTICE_CAP).toBe(3);
    const notices = selectMuffledNotices([
      n('n', 'far'),
      n('e', 'mid'),
      n('s', 'near'),
      n('w', 'near'),
    ]);
    expect(notices).toEqual([
      { direction: 's', band: 'near' },
      { direction: 'w', band: 'near' },
      { direction: 'e', band: 'mid' },
    ]);
  });

  it('breaks a band tie by the direction order (n before s)', () => {
    expect(selectMuffledNotices([n('s', 'near'), n('n', 'near')])).toEqual([
      { direction: 'n', band: 'near' },
      { direction: 's', band: 'near' },
    ]);
  });

  it('refuses an unknown direction or band: it is skipped, not kept', () => {
    expect(selectMuffledNotices([n('up', 'near'), n('n', 'huge')])).toEqual([]);
  });

  it('carries only the direction and the band of each notice', () => {
    // The input has a speaker and words beside the direction and band: none of them may reach the output.
    const heard = {
      kind: 'heard_muffled',
      speaker: 'Ada',
      text: 'meet me at 100 64 -20',
      direction: 'w',
      band: 'mid',
    };
    const notices = selectMuffledNotices([heard]);
    expect(notices).toEqual([{ direction: 'w', band: 'mid' }]);
    for (const notice of notices) expect(Object.keys(notice).sort()).toEqual(['band', 'direction']);
  });
});
