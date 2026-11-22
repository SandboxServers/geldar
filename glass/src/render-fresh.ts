/**
 * The "new entries" control of the Thought Stream page. It does two jobs. While the feed is paused it
 * counts what waits, and a press shows it. While the feed runs it counts what arrived at the top of the
 * list while the reader had scrolled away, and a press goes there. Every page object is passed in, so it
 * is tested through the page script (page-script.test.ts) with fakes.
 *
 * This file is served to the browser after type stripping, so it stays erasable TypeScript.
 */
import { freshLabel } from './render-model.ts';

interface Placed {
  getBoundingClientRect(): { top: number };
}

interface Scroller extends Placed {
  scrollTop: number;
}

interface ScrollTarget {
  addEventListener(type: 'scroll', listener: () => void, options: { passive: boolean }): void;
}

export interface FreshDeps {
  button: {
    textContent: string | null;
    hidden: boolean;
    addEventListener(type: 'click', listener: () => void): void;
  };
  /** The list of entries, the pane it scrolls in, and the pane that scrolls instead on a short screen. */
  list: Placed;
  scroller: Scroller & ScrollTarget;
  pane: { scrollTop: number } & ScrollTarget;
  /** The window, which is told of a scroll too. */
  win: ScrollTarget;
  /** True while the list is not on screen at all, because another view shows. */
  hidden(): boolean;
  /** While the feed is paused: how many held entries the filters would show. Null while it runs. */
  waiting(): number | null;
  /** A press: the page resumes a paused feed, so the held entries are drawn. */
  onPress(): void;
}

export interface Fresh {
  /**
   * An entry arrived while the feed runs. It is counted only while the top of the list is out of sight,
   * and only when `counts()` says it is a new entry the filters show.
   */
  arrived(counts: () => boolean): void;
  /** Forgets what arrived: the reader is at the top, or the list was replaced. */
  clear(): void;
  /** Draws the control again, after the pause or the held entries changed. */
  update(): void;
}

export function createFresh(deps: FreshDeps): Fresh {
  let arrivals = 0;

  /** True when the top of the list is out of sight: scrolled under the header, or off the screen. */
  function away(): boolean {
    if (deps.hidden()) return true;
    const top = deps.list.getBoundingClientRect().top;
    return top < 0 || top < deps.scroller.getBoundingClientRect().top - 1;
  }

  function update(): void {
    const count = deps.waiting() ?? arrivals;
    deps.button.textContent = freshLabel(count);
    deps.button.hidden = count === 0;
  }

  function clear(): void {
    arrivals = 0;
    update();
  }

  // Pressing "new entries" shows them: it resumes a paused feed, and goes to the top of the list.
  deps.button.addEventListener('click', () => {
    deps.onPress();
    deps.scroller.scrollTop = 0;
    deps.pane.scrollTop = 0;
    clear();
  });
  // Back at the top, whatever arrived is in sight. While paused the control still shows what waits.
  const onScroll = (): void => {
    if (!away()) clear();
  };
  for (const target of [deps.scroller, deps.pane, deps.win]) {
    target.addEventListener('scroll', onScroll, { passive: true });
  }

  return {
    arrived(counts: () => boolean): void {
      if (!away()) {
        clear();
        return;
      }
      if (!counts()) return;
      arrivals += 1;
      update();
    },
    clear,
    update,
  };
}
