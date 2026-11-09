import type { BodyView } from './view.ts';

/** One named condition, evaluated on the Body's view. */
export type Precondition = (view: BodyView) => boolean;

/** The verdict on a list of precondition names. */
export type PreconditionVerdict =
  | { ok: true }
  | {
      ok: false;
      /** The first name that failed. */
      name: string;
      /** True when the name is not registered: unknown names fail closed. */
      unknown: boolean;
    };

const SEEDS = ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds'];

/**
 * A registry of named preconditions (the contract's `preconditions` strings, spec 5.3). A name
 * that is not registered fails: a plan that asks for a check the Body cannot make does not run.
 * Names that need knowledge outside the `BodyView` (for example `field_is_known`, which needs the
 * Mind's memory) are not built in; the owner of that knowledge registers them.
 */
export class PreconditionRegistry {
  private readonly checks = new Map<string, Precondition>();

  /** Adds a precondition. Throws if the name already has one. */
  register(name: string, check: Precondition): void {
    if (this.checks.has(name)) throw new Error(`duplicate precondition ${name}`);
    this.checks.set(name, check);
  }

  /** The registered names, in registration order. */
  names(): string[] {
    return [...this.checks.keys()];
  }

  /**
   * Evaluates the names in order and stops at the first failure. A check that throws counts as
   * failed. An empty list passes.
   */
  evaluate(names: readonly string[], view: BodyView): PreconditionVerdict {
    for (const name of names) {
      const check = this.checks.get(name);
      if (check === undefined) return { ok: false, name, unknown: true };
      let passed = false;
      try {
        passed = check(view);
      } catch {
        passed = false;
      }
      if (!passed) return { ok: false, name, unknown: false };
    }
    return { ok: true };
  }
}

/** A registry with the preconditions the `BodyView` can answer on its own. */
export function builtinPreconditions(): PreconditionRegistry {
  const registry = new PreconditionRegistry();
  registry.register('seeds_available', (view) => SEEDS.some((s) => view.inventoryCount(s) > 0));
  registry.register('not_in_fluid', (view) => view.inFluid === null);
  registry.register('not_on_fire', (view) => !view.onFire);
  registry.register('no_hostiles_nearby', (view) => view.nearbyHostiles(16).length === 0);
  registry.register('health_above_half', (view) => view.health > 10);
  registry.register('not_hungry', (view) => view.hunger > 14);
  return registry;
}
