import type { SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { reflexText, toPlayerEvents } from './present.ts';

const firing = (seq: number, atMs: number, name: string, trigger?: unknown): SimEvent =>
  ({
    seq,
    tick: seq,
    atMs,
    wakeOn: null,
    kind: 'reflex',
    name,
    result: 'handled',
    trigger,
  }) as unknown as SimEvent;

const hostile = (kind: unknown, distance: unknown) => ({
  cause: 'hostile',
  hostile: kind,
  distance,
});

describe('reflex lines state their cause (0213)', () => {
  it('names the hostile kind and its distance for a panic_burrow set off by a hostile', () => {
    const out = toPlayerEvents([firing(1, 0, 'panic_burrow', hostile('zombie', 5))]);
    expect(out.map((e) => e.text)).toEqual([
      'Reflex panic_burrow: a zombie was 5 blocks away, so you dug in.',
    ]);
  });

  it('names the hostile kind and its distance for a dark_shelter set off by a hostile', () => {
    expect(reflexText('dark_shelter', 'handled', hostile('skeleton', 3))).toBe(
      'Reflex dark_shelter: a skeleton was 3 blocks away, so you dug in.',
    );
  });

  it('says a night burrow set off by damage was damage, with no hostile named', () => {
    const out = toPlayerEvents([firing(1, 0, 'panic_burrow', { cause: 'damage' })]);
    expect(out.map((e) => e.text)).toEqual([
      'Reflex panic_burrow: you took damage at night with no bed near, so you dug in.',
    ]);
  });

  it('keeps the fixed phrase when the event carries no trigger (old events)', () => {
    expect(reflexText('panic_burrow', 'handled')).toBe(
      'Reflex panic_burrow: a threat was close, you dug in.',
    );
    expect(reflexText('panic_burrow', 'handled', undefined)).toBe(
      'Reflex panic_burrow: a threat was close, you dug in.',
    );
    expect(reflexText('panic_burrow', 'handled', { cause: 'unknown_cause' })).toBe(
      'Reflex panic_burrow: a threat was close, you dug in.',
    );
  });

  it('keeps the fixed phrase when a hostile trigger lacks a usable kind or distance', () => {
    const fixed = 'Reflex panic_burrow: a threat was close, you dug in.';
    const unsafe: Record<string, unknown>[] = [
      hostile('Zombie', 5),
      hostile('a zombie', 5),
      hostile('zombie)', 5),
      hostile('zombie\nx', 5),
      hostile('a'.repeat(33), 5),
      hostile(7, 5),
      hostile('zombie', 2.5),
      hostile('zombie', -1),
      hostile('zombie', '5'),
      hostile('zombie', undefined),
    ];
    for (const trigger of unsafe) {
      expect(reflexText('panic_burrow', 'handled', trigger), JSON.stringify(trigger)).toBe(fixed);
    }
  });

  it('folds identical hostile lines inside the repeat window, and not across distances', () => {
    const same = toPlayerEvents([
      firing(1, 0, 'panic_burrow', hostile('zombie', 5)),
      firing(2, 1000, 'panic_burrow', hostile('zombie', 5)),
    ]);
    expect(same.map((e) => e.text)).toEqual([
      'Reflex panic_burrow: a zombie was 5 blocks away, so you dug in. (x2)',
    ]);
    const apart = toPlayerEvents([
      firing(1, 0, 'panic_burrow', hostile('zombie', 5)),
      firing(2, 1000, 'panic_burrow', hostile('zombie', 6)),
    ]);
    expect(apart.map((e) => e.text)).toEqual([
      'Reflex panic_burrow: a zombie was 5 blocks away, so you dug in.',
      'Reflex panic_burrow: a zombie was 6 blocks away, so you dug in.',
    ]);
  });
});
