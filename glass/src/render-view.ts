/**
 * The DOM part of the Thought Stream page. Every element is made here from a fixed tag and a fixed
 * class. Every value from the world goes in as text, after display(). Nothing from the
 * world becomes an attribute, a link, a style or markup. Nothing here sets markup from a string.
 *
 * glass/ has no DOM library, so the few DOM members used are declared below. The file is served to
 * the browser after type stripping, so it stays erasable TypeScript.
 */
import {
  display,
  journalShown,
  type Row,
  splitMatches,
  type ThoughtView,
  whenLabel,
} from './render-model.ts';
import { makeSigil } from './render-sigil.ts';

// The plan-activity panel (BLD-37) is served from this page's module list; it draws nothing while off.
export { renderPlanActivity } from './plan-activity/index.ts';

/** The DOM members this page uses. A string given to append or replaceChildren becomes a text node. */
export interface El {
  className: string;
  textContent: string | null;
  type: string;
  value: string;
  append(...nodes: (El | string)[]): void;
  replaceChildren(...nodes: (El | string)[]): void;
  addEventListener(type: 'click', listener: () => void): void;
  /** Only ever called with a fixed name and a fixed value: no world text becomes an attribute. */
  setAttribute(name: string, value: string): void;
  focus?: () => void;
}

export interface Doc {
  createElement(tag: string): El;
}

/** What a row needs besides its thought: the reader's clock, and the search keyword to mark. */
export interface RowOptions {
  death?: Row;
  /** How the agent's mind is run ("headless" or "sovereign"), from the agents list. Left out: the entry's tier. */
  mode?: string;
  /** The time now in epoch ms, for the "today" form of the time. Left out: the system clock. */
  nowMs?: number;
  /** The search keyword. Each match in the name, the wake reason and the text is marked. */
  keyword?: string;
  /** Called with the entry's id on a press anywhere in the row. The wide layout selects the entry with it. */
  onSelect?: (id: string) => void;
}

/** The line under the name of a journal entry. */
export const JOURNAL_LINE = 'journal · written for itself';
/** What a thought shows in place of its text when the reply did not parse. */
export const UNPARSED_LINE = 'unparsed · the mind replied, but not in a form the body could read.';

/** A node with one text value. The value is shown as text only, never parsed as markup. */
export function make(doc: Doc, tag: string, className: string, value: string): El {
  const node = doc.createElement(tag);
  node.className = className;
  node.textContent = display(value);
  return node;
}

/**
 * Puts a world value in a node as text, with each keyword match inside a <mark>. Without a keyword, or
 * without a match, the node gets the one text value, as make() gives it.
 */
export function fill(doc: Doc, node: El, value: string, keyword: string): void {
  const shown = display(value);
  const pieces = splitMatches(shown, keyword);
  if (!pieces.some((piece) => piece.hit)) {
    node.textContent = shown;
    return;
  }
  node.replaceChildren(
    ...pieces.map((piece) => {
      if (!piece.hit) return piece.text;
      const mark = doc.createElement('mark');
      mark.textContent = piece.text;
      return mark;
    }),
  );
}

/** A node with one world value, its keyword matches marked. */
export function marked(
  doc: Doc,
  tag: string,
  className: string,
  value: string,
  keyword: string,
): El {
  const node = doc.createElement(tag);
  node.className = className;
  fill(doc, node, value, keyword);
  return node;
}

/** A button with a fixed label. */
export function action(doc: Doc, className: string, label: string, onPress: () => void): El {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onPress);
  return button;
}

/** The sigil of an agent: the name picks it, or the id when the entry carries no name. */
export function sigil(doc: Doc, view: ThoughtView, size: 'row' | 'reader', dead: boolean): El {
  return makeSigil(doc, view.agentName || view.agentId, size, dead) as unknown as El;
}

/**
 * The lines between the name and the text, in a row and in the reader alike: what woke a thought, or that
 * the entry is a journal line, and for a reply that did not parse, the fixed sentence that says so.
 */
export function kindLines(doc: Doc, view: ThoughtView, keyword: string): El[] {
  if (view.kind === 'journal') return [make(doc, 'div', 'kind', JOURNAL_LINE)];
  const lines: El[] = [];
  if (view.wakeReason !== '') {
    const wake = doc.createElement('div');
    wake.className = 'wake';
    wake.append('woke: ', marked(doc, 'span', 'reason', view.wakeReason, keyword));
    lines.push(wake);
  }
  if (view.outcome === 'unparsed') lines.push(make(doc, 'div', 'unparsed', UNPARSED_LINE));
  return lines;
}

/**
 * One entry of the thought list: the sigil, who and when on one line, what woke the thought, then the text.
 * The text is plain text the reader can select. The time is a button that opens the entry with the given
 * callback; a long journal line also gets "Show more".
 */
export function renderRow(
  doc: Doc,
  view: ThoughtView,
  onOpen: (id: string) => void,
  options: RowOptions = {},
): El {
  const keyword = options.keyword ?? '';
  const dead = options.death?.died_at != null;
  const item = doc.createElement('li');
  item.className = 'entry';
  const { onSelect } = options;
  if (onSelect !== undefined) item.addEventListener('click', () => onSelect(view.id));
  const row = doc.createElement('div');
  const journal = view.kind === 'journal';
  row.className = journal ? 'row journal-row' : 'row';

  const meta = doc.createElement('div');
  meta.className = 'meta';
  const who = doc.createElement('div');
  who.className = 'who';
  who.append(marked(doc, 'span', 'agent', view.agentName, keyword));
  if (dead) who.append(make(doc, 'span', 'died', '† died'));
  who.append(make(doc, 'span', 'mode', options.mode || view.tier));
  // The time in the reader's zone; a time that did not parse is shown as it came.
  const when = whenLabel(view.atMs, options.nowMs ?? Date.now());
  const toggle = action(doc, 'when', '', () => onOpen(view.id));
  // The label a screen reader adds to the time, so the button says what it does. Hidden on screen.
  toggle.append(display(when === '' ? view.at : when), make(doc, 'span', 'sr', ', details'));
  meta.append(sigil(doc, view, 'row', dead), who, toggle);
  row.append(meta, ...kindLines(doc, view, keyword));

  if (!journal) {
    if (view.plan !== '') row.append(marked(doc, 'p', 'plan', view.plan, keyword));
    item.append(row);
    return item;
  }

  // A journal line shows 600 characters at first. A search opens it, so no match stays out of sight.
  const { expandable } = journalShown(view.plan, false);
  let expanded = keyword !== '';
  const body = doc.createElement('p');
  body.className = 'plan journal-text';
  fill(doc, body, journalShown(view.plan, expanded).shown, keyword);
  row.append(body);
  if (expandable) {
    const more = action(doc, 'more', expanded ? 'Show less' : 'Show more', () => {
      expanded = !expanded;
      fill(doc, body, journalShown(view.plan, expanded).shown, keyword);
      more.textContent = expanded ? 'Show less' : 'Show more';
    });
    row.append(more);
  }
  item.append(row);
  return item;
}

/** A short status line. */
export function renderNote(doc: Doc, message: string): El {
  return make(doc, 'p', 'note', message);
}

/** One agent of the filter row. */
export interface Chip {
  name: string;
  dead: boolean;
}

/**
 * Fills the agent filter: "Everyone" first, then one chip per agent, each with its sigil. `selected` is a
 * position in `chips`, or -1 for everyone. A press calls `onPick` with the chip's position (-1 for
 * "Everyone"), so no agent id or name becomes an attribute. Returns the chips in row order ("Everyone"
 * first) and the one that is on.
 */
export function renderChips(
  doc: Doc,
  row: El,
  chips: Chip[],
  selected: number,
  onPick: (index: number) => void,
): { buttons: El[]; on: El } {
  const chip = (index: number, label: string): El => {
    const button = action(doc, index === selected ? 'chip on' : 'chip', '', () => onPick(index));
    button.setAttribute('aria-pressed', index === selected ? 'true' : 'false');
    const item = chips[index];
    if (item !== undefined) {
      button.append(makeSigil(doc, item.name, 'chip', item.dead) as unknown as El);
    }
    button.append(make(doc, 'span', 'chip-name', label));
    if (item?.dead === true)
      button.append(make(doc, 'span', 'died', '†'), make(doc, 'span', 'sr', ' died'));
    return button;
  };
  const buttons = [chip(-1, 'Everyone'), ...chips.map((item, index) => chip(index, item.name))];
  row.replaceChildren(...buttons);
  return { buttons, on: buttons[selected + 1] ?? (buttons[0] as El) };
}
