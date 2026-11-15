import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatScene } from './combat.fakes.ts';
import { calmScene, sceneView, zombieAt } from './combat.fakes.ts';
import { fightOrFleeReflex } from './fight-or-flee.ts';
import { LEGACY_THREAT } from './threat-policy.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Spies on the Body's log: the operator lines are JSON on console.log. */
function spyLog() {
  return vi.spyOn(console, 'log').mockImplementation(() => {});
}

/** The phantom_diag lines written so far, parsed. */
function diagLines(log: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return log.mock.calls
    .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
    .filter((line) => line.event === 'phantom_diag');
}

/** A calm scene at `health` with one phantom `distance` blocks away and the given items. */
function phantomScene(distance: number, items: Record<string, number> = {}, health = 20) {
  const scene: CombatScene = calmScene();
  scene.health = health;
  scene.hostiles = [zombieAt(distance, 'phantom')];
  scene.items = items;
  return scene;
}

describe('phantom_diag operator line (decision 0335)', () => {
  it('says health_too_low for an armed Body at health 5 that did not fight a phantom', () => {
    const log = spyLog();
    expect(fightOrFleeReflex.check(sceneView(phantomScene(8, { iron_sword: 1 }, 5)))).toBeNull();
    const lines = diagLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      armed: false,
      health: 5,
      armed_cutoff: LEGACY_THREAT.floor(),
      reason: 'health_too_low',
      weapon: 'iron_sword',
      phantoms_24: 1,
      others_16: 0,
    });
  });

  it('says no_weapon for an unarmed Body at full health, and counts the other hostiles', () => {
    const log = spyLog();
    const scene = phantomScene(8);
    scene.hostiles.push(zombieAt(5));
    expect(fightOrFleeReflex.check(sceneView(scene))).toBeNull();
    expect(diagLines(log)).toHaveLength(1);
    expect(diagLines(log)[0]).toMatchObject({
      armed: false,
      reason: 'no_weapon',
      weapon: 'none',
      others_16: 1,
    });
  });

  it('says not_in_range for a phantom 20 blocks away (listed, but beyond the trigger radius)', () => {
    const log = spyLog();
    expect(fightOrFleeReflex.check(sceneView(phantomScene(20, { iron_sword: 1 })))).toBeNull();
    expect(diagLines(log)[0]).toMatchObject({ reason: 'not_in_range', phantoms_24: 1 });
  });

  it('says fired when the trigger fires, and reports the open-air read from the view', () => {
    const log = spyLog();
    const view = { ...sceneView(phantomScene(12, { iron_sword: 1 })), roofWithin: () => false };
    expect(fightOrFleeReflex.check(view)).toMatchObject({ hostile: 'phantom', flyer: true });
    expect(diagLines(log)[0]).toMatchObject({ armed: true, reason: 'fired', in_open: true });
  });

  it('writes no line when no phantom is in view', () => {
    const log = spyLog();
    const scene = calmScene();
    scene.hostiles = [zombieAt(5)];
    scene.items = { iron_sword: 1 };
    fightOrFleeReflex.check(sceneView(scene));
    expect(diagLines(log)).toHaveLength(0);
  });

  it('writes at most one line per 5 s for a Body while a phantom is in view', () => {
    const log = spyLog();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const view = sceneView(phantomScene(8, {}, 20));
    fightOrFleeReflex.check(view);
    fightOrFleeReflex.check(view);
    clock.mockReturnValue(14_999);
    fightOrFleeReflex.check(view);
    expect(diagLines(log)).toHaveLength(1);
    clock.mockReturnValue(15_000);
    fightOrFleeReflex.check(view);
    expect(diagLines(log)).toHaveLength(2);
  });
});
