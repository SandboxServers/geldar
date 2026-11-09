import { describe, expect, it } from 'vitest';
import { hungerAt, tryEat } from './reflex.ts';

const bread = (count: number) => [{ item: 'bread', count }];

describe('tryEat', () => {
  it('eats once at food <= eat_below', () => {
    const r = tryEat({ food: 14, inventory: bread(2) }, 14);
    expect(r.ate).toBe(true);
    expect(r.item).toBe('bread');
    expect(r.state.inventory).toEqual(bread(1));
    expect(r.state.food).toBe(20);
  });

  it('does not eat above eat_below', () => {
    const r = tryEat({ food: 15, inventory: bread(2) }, 14);
    expect(r.ate).toBe(false);
    expect(r.state.inventory).toEqual(bread(2));
  });

  it('does not eat with nothing edible', () => {
    const r = tryEat({ food: 3, inventory: [{ item: 'stone', count: 5 }] }, 14);
    expect(r.ate).toBe(false);
    expect(r.state.food).toBe(3);
  });
});

describe('hungerAt', () => {
  it('falls 1 per interval and floors at 0', () => {
    const cfg = { hunger_interval_ticks: 100 };
    expect(hungerAt(99, cfg, 5)).toBe(5);
    expect(hungerAt(100, cfg, 5)).toBe(4);
    expect(hungerAt(300, cfg, 5)).toBe(2);
    expect(hungerAt(100000, cfg, 5)).toBe(0);
  });
});
