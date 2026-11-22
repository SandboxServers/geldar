/**
 * The parts of the view model the redesigned page added: the world day, tick and action of a row, which
 * entry the reader shows, the words of the status control, and a receipt as three cells.
 */
import { describe, expect, it } from 'vitest';
import { HOSTILE } from './render-fixtures.ts';
import {
  freshLabel,
  readDelay,
  readerEntry,
  receiptLine,
  statusLabel,
  toView,
} from './render-model.ts';

describe('what the redesigned page reads from a row', () => {
  it('keeps the world day and tick, reading a BIGINT sent as digits, and nothing else as a number', () => {
    const view = toView({ thought_id: 't', world_day: 41, world_tick: '16463' });
    expect([view.worldDay, view.worldTick]).toEqual([41, 16463]);
    for (const odd of [undefined, null, '', '1e9', '-3', '12abc', '<b>', {}, Number.NaN]) {
      const none = toView({ thought_id: 't', world_day: odd, world_tick: odd });
      expect([none.worldDay, none.worldTick], String(odd)).toEqual([null, null]);
    }
  });

  it('keeps the action a thought names, as text only when it is text', () => {
    expect(toView({ thought_id: 't', action_id: 'act-1' }).actionId).toBe('act-1');
    expect(toView({ thought_id: 't' }).actionId).toBe('');
    expect(toView({ thought_id: 't', action_id: { $ne: '' } }).actionId).toBe('');
  });
});

describe('readerEntry', () => {
  const list = ['a', 'b', 'c'].map((id) => toView({ thought_id: id }));
  it('is the selected entry while it is on the page, otherwise the newest shown', () => {
    expect(readerEntry(list, 'b')?.id).toBe('b');
    expect(readerEntry(list, '')?.id).toBe('a');
    expect(readerEntry(list, 'gone')?.id).toBe('a');
    expect(readerEntry([], 'b')).toBeUndefined();
  });
});

describe('the status control', () => {
  it('says each state of the feed in fixed words, and "live" carries the delay when there is one', () => {
    expect(statusLabel('live', 60)).toBe('Live \u221260s');
    expect(statusLabel('live', 0)).toBe('Live');
    expect(statusLabel('connecting', 60)).toBe('Connecting...');
    expect(statusLabel('reconnecting', 60)).toBe('Reconnecting...');
    expect(statusLabel('paused', 60)).toBe('Paused');
    expect(statusLabel('closed', 60)).toBe('Closed');
  });

  it('reads the delay the server wrote into the page as plain digits only', () => {
    expect(readDelay('60')).toBe(60);
    expect(readDelay('0')).toBe(0);
    for (const odd of [null, undefined, '', '-1', '6.5', '60s', '1e3', '<b>', '1234567']) {
      expect(readDelay(odd), String(odd)).toBe(0);
    }
  });

  it('counts the entries that wait', () => {
    expect(freshLabel(1)).toBe('1 new entry');
    expect(freshLabel(2000)).toBe('2000 new entries');
  });
});

describe('receiptLine', () => {
  it('says what was done, how the receipt ended and the credits it moved', () => {
    expect(
      receiptLine({ kind: 'place', item: 'oak_planks', count: 4, phase: 'committed', credits: 3 }),
    ).toEqual({
      action: 'place oak_planks \u00d74',
      outcome: 'committed',
      tone: 'ok',
      amount: '3 cr',
    });
    expect(receiptLine({ kind: 'eat', item: 'bread', count: 1, phase: 'aborted' })).toEqual({
      action: 'eat bread',
      outcome: 'aborted',
      tone: 'bad',
      amount: '',
    });
    expect(receiptLine({ kind: 'move', phase: 'prepared', credits: 0 })).toEqual({
      action: 'move',
      outcome: 'prepared',
      tone: 'other',
      amount: '0 cr',
    });
  });

  it('gives an unknown phase no tone of its own, and an empty row empty cells', () => {
    for (const value of HOSTILE) {
      const line = receiptLine({ kind: value, item: value, phase: value, count: value });
      expect(line.tone).toBe('other');
      expect(line.outcome).toBe(value);
      expect(line.amount).toBe('');
    }
    expect(receiptLine({})).toEqual({ action: '', outcome: '', tone: 'other', amount: '' });
  });
});
