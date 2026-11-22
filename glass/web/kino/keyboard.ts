// The page's one keyboard listener (decision 0166): a keydown becomes a held free-fly key or a command
// for the wall or the active monitor. keys.ts decides what a key means; this file decides when the
// page may take it. Every command is view-only.

import { type Command, routeKey } from './keys.ts';

export interface KeyboardDeps {
  /** A dialog is open (the sheet or the controls card): its keys are the browser's. */
  modal(): boolean;
  /** The active monitor is in free-fly. */
  freeFly(): boolean;
  /** The movement keys now held changed. */
  move(held: ReadonlySet<string>): void;
  run(command: Command): void;
}

type Target = Pick<Window, 'addEventListener'>;

export function bindKeyboard(target: Target, deps: KeyboardDeps): void {
  const held = new Set<string>();
  target.addEventListener('keydown', (e) => {
    const t = e.target as Partial<Element> | null;
    const onButton = (t?.closest?.('button, a, summary') ?? null) !== null;
    // A held Enter never presses the focused control again, in a dialog or out of one: on Clear it
    // would empty the wall, and on a channel row it would open a monitor (and subscribe) per repeat.
    if (e.repeat && e.key === 'Enter' && onButton) {
      e.preventDefault();
      return;
    }
    if (deps.modal() || t?.closest?.('input, select, textarea')) return;
    const route = routeKey({
      key: e.key,
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      alt: e.altKey,
      repeat: e.repeat,
      onButton,
      freeFly: deps.freeFly(),
    });
    if (route.preventDefault) e.preventDefault();
    if (route.kind === 'move') {
      held.add(route.key);
      deps.move(held);
    } else if (route.kind === 'command') deps.run(route.command);
  });
  target.addEventListener('keyup', (e) => {
    held.delete(e.key.toLowerCase());
    deps.move(held);
  });
  target.addEventListener('blur', () => {
    held.clear();
    deps.move(held);
  });
}
