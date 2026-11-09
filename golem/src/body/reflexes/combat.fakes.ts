import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ActionRegistry } from '../../actions/registry.ts';
import { MemorySink } from '../records.ts';
import type { ReflexContext } from '../reflex.ts';
import type { SafeSpot } from '../safe-spot.ts';
import type { BodyView, HostileView } from '../view.ts';

/** What the fake view reports; every field may be changed between calls. */
export interface CombatScene {
  health: number;
  position: { x: number; y: number; z: number };
  hostiles: HostileView[];
  items: Record<string, number>;
  ticksSinceHurt: number | null;
  safeSpot: SafeSpot | null;
}

/** A scene with a healthy, unhurt Body at the origin, no hostiles and no items. */
export function calmScene(): CombatScene {
  return {
    health: 20,
    position: { x: 0, y: 64, z: 0 },
    hostiles: [],
    items: {},
    ticksSinceHurt: null,
    safeSpot: { kind: 'spawn', position: { x: 50, y: 64, z: 0 } },
  };
}

/** A hostile at a distance along the x axis. */
export function zombieAt(distance: number, name = 'zombie'): HostileView {
  return { name, distance, position: { x: distance, y: 64, z: 0 } };
}

/** A view that reads the scene at call time. */
export function sceneView(scene: CombatScene): BodyView {
  return {
    tick: 0,
    get health() {
      return scene.health;
    },
    hunger: 20,
    get position() {
      return scene.position;
    },
    nearbyHostiles: (radius = 16) => scene.hostiles.filter((h) => h.distance <= radius),
    inventoryCount: (item) => scene.items[item] ?? 0,
    inFluid: null,
    onFire: false,
    fallingDistance: 0,
    get ticksSinceHurt() {
      return scene.ticksSinceHurt;
    },
    get safeSpot() {
      return scene.safeSpot;
    },
  };
}

/** A bot with a position and the inventory of the scene, for the actions a reflex starts. */
export function sceneBot(scene: CombatScene): Bot {
  return {
    entity: { position: new Vec3(scene.position.x, scene.position.y, scene.position.z) },
    inventory: {
      items: () => Object.entries(scene.items).map(([name, count]) => ({ name, count })),
    },
    waitForTicks: async () => undefined,
  } as unknown as Bot;
}

/** A reflex context over a scene; `cancelled()` counts the cancelAction calls. */
export function sceneContext(
  scene: CombatScene,
  overrides: Partial<ReflexContext> = {},
): ReflexContext & { sink: MemorySink; cancelled(): number } {
  const sink = new MemorySink();
  let cancels = 0;
  return {
    bot: sceneBot(scene),
    view: sceneView(scene),
    registry: new ActionRegistry(),
    sink,
    lifeId: 'life-1',
    bodyGeneration: 1,
    tick: 100,
    signal: new AbortController().signal,
    cancelAction: async () => {
      cancels += 1;
    },
    cancelled: () => cancels,
    ...overrides,
  } as ReflexContext & { sink: MemorySink; cancelled(): number };
}
