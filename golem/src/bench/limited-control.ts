import type { TestControl } from '../test-control.ts';

/** The only `ctl` methods a scenario may call while it runs. */
const RUN_PHASE_CONTROL = new Set(['effect', 'effectClear', 'timeSet', 'fill', 'chestItems']);

/**
 * A view of `ctl` for a scenario's `run`: effect, effectClear, timeSet, fill, chestItems and
 * gamerule queries (no value). Anything else throws, so a scenario cannot give itself items.
 */
export function limitedControl(ctl: TestControl): TestControl {
  return new Proxy(ctl, {
    get(target, prop, receiver) {
      if (prop === 'gamerule') {
        return (name: string, value?: boolean | number) => {
          if (value !== undefined)
            throw new Error('ctl.gamerule can only query while a scenario runs');
          return target.gamerule(name);
        };
      }
      if (typeof prop === 'string' && !RUN_PHASE_CONTROL.has(prop)) {
        throw new Error(`ctl.${prop} is not available while a scenario runs`);
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
