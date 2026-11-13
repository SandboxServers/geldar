/**
 * The DOM part of the Thought Stream page. Every element is made here from a fixed tag and a fixed
 * class. Every value from the world goes in as text, after display(). Nothing from the
 * world becomes an attribute, a link, a style or markup. Nothing here sets markup from a string.
 *
 * glass/ has no DOM library, so the few DOM members used are declared below. The file is served to
 * the browser after type stripping, so it stays erasable TypeScript.
 */
import {
  copyText,
  display,
  journalSplit,
  type Row,
  splitMatches,
  type ThoughtView,
  whenLabel,
} from './render-model.ts';

/** The DOM members this page uses. A string given to append or replaceChildren becomes a text node. */
export interface El {
  className: string;
  textContent: string | null;
  type: string;
  value: string;
  append(...nodes: (El | string)[]): void;
  replaceChildren(...nodes: (El | string)[]): void;
  /** Used only with fixed names and fixed values, never with a value from the world. */
  setAttribute(name: 'aria-expanded' | 'hidden', value: string): void;
  addEventListener(type: 'click' | 'beforematch', listener: () => void): void;
}

export interface Doc {
  createElement(tag: string): El;
}

/** What a row needs besides its thought: the reader's clock, and the search keyword to mark. */
export interface RowOptions {
  death?: Row;
  /** The time now in epoch ms, for the "today" form of the time. Left out: the system clock. */
  nowMs?: number;
  /** The search keyword. Each match in the name, the wake reason and the text is marked. */
  keyword?: string;
  /**
   * Given, each entry gets a "Copy" button. It is called with the entry as plain text (copyText) and with
   * `say`, which sets the button's label: the caller says how the copy went, in its own fixed words.
   */
  onCopy?: (text: string, say: (label: string) => void) => void;
  /**
   * True when the browser supports hidden="until-found": the hidden rest of a long journal line is then
   * still reached by find-in-page. Left out, the rest is plainly hidden, as a browser without it would do.
   */
  findable?: boolean;
}

/** A node with one text value. The value is shown as text only, never parsed as markup. */
function make(doc: Doc, tag: string, className: string, value: string): El {
  const node = doc.createElement(tag);
  node.className = className;
  node.textContent = display(value);
  return node;
}

/**
 * Puts a world value in a node as text, with each keyword match inside a <mark>. Without a keyword, or
 * without a match, the node gets the one text value, as make() gives it.
 */
function fill(doc: Doc, node: El, value: string, keyword: string): void {
  fillShown(doc, node, display(value), keyword);
}

/** fill() for text that has been through display() already. */
function fillShown(doc: Doc, node: El, shown: string, keyword: string): void {
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
function marked(doc: Doc, tag: string, className: string, value: string, keyword: string): El {
  const node = doc.createElement(tag);
  node.className = className;
  fill(doc, node, value, keyword);
  return node;
}

/** A button with a fixed label. */
function action(doc: Doc, className: string, label: string, onPress: () => void): El {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onPress);
  return button;
}

/** A value from a receipt row as text. Nulls become empty. */
function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * One entry of the thought list: a line of facts (who, what kind, when), then the text. The text is plain
 * text the reader can select. The time is a button that opens the entry with the given callback; a long
 * journal line also gets "Show more", and "Copy" puts the entry on the clipboard as plain text.
 */
export function renderRow(
  doc: Doc,
  view: ThoughtView,
  onOpen: (id: string) => void,
  options: RowOptions = {},
): El {
  const keyword = options.keyword ?? '';
  const item = doc.createElement('li');
  const row = doc.createElement('div');
  const journal = view.kind === 'journal';
  // `card` is kept from the first layout: one entry is one stacked card at every width.
  row.className = journal ? 'row card journal-row' : 'row card';

  const meta = doc.createElement('div');
  meta.className = 'meta';
  const kind = journal ? 'journal' : view.outcome === 'unparsed' ? 'unparsed' : 'thought';
  meta.append(marked(doc, 'span', 'agent', view.agentName, keyword));
  if (options.death?.died_at != null) meta.append(make(doc, 'span', 'died', 'died'));
  meta.append(
    make(doc, 'span', 'tier', view.tier),
    make(doc, 'span', `outcome ${view.outcome}`, kind),
  );
  if (!journal) meta.append(marked(doc, 'span', 'wake', view.wakeReason, keyword));
  // The time in the reader's zone; a time that did not parse is shown as it came.
  const when = whenLabel(view.atMs, options.nowMs ?? Date.now());
  const toggle = action(doc, 'when', '', () => onOpen(view.id));
  // Closed at first; the page sets it to "true" while the detail is open under the entry.
  toggle.setAttribute('aria-expanded', 'false');
  // The label a screen reader adds to the time, so the button says what it does. Hidden on screen.
  toggle.append(display(when === '' ? view.at : when), make(doc, 'span', 'sr', ', details'));
  // The entry's controls stay together at the end of the line: "Copy" when the page can copy, then the time.
  const acts = doc.createElement('span');
  acts.className = 'acts';
  const { onCopy } = options;
  if (onCopy !== undefined) {
    const copy = action(doc, 'copy', 'Copy', () => {
      onCopy(copyText(view), (label) => {
        copy.textContent = label;
      });
    });
    acts.append(copy);
  }
  acts.append(toggle);
  meta.append(acts);
  row.append(meta);

  if (!journal) {
    row.append(marked(doc, 'span', 'plan', view.plan, keyword));
    item.append(row);
    return item;
  }

  // A journal line shows 600 characters at first. A search opens it, so no match stays out of sight.
  const shown = display(view.plan);
  const { head, rest } = journalSplit(shown);
  const body = doc.createElement('span');
  body.className = 'plan journal-text';
  row.append(body);
  item.append(row);
  if (rest === '') {
    fillShown(doc, body, shown, keyword);
    return item;
  }
  let expanded = keyword !== '';
  const more = action(doc, 'more', '', () => draw(!expanded));
  /** Shows the whole line, or its first 600 characters with the rest kept in the page but hidden. */
  const draw = (open: boolean): void => {
    expanded = open;
    more.textContent = open ? 'Show less' : 'Show more';
    more.setAttribute('aria-expanded', String(open));
    if (open) {
      fillShown(doc, body, shown, keyword);
      return;
    }
    const start = doc.createElement('span');
    fillShown(doc, start, head, keyword);
    const ellipsis = make(doc, 'span', '', '...');
    // hidden="until-found": the browser's find-in-page reaches the hidden rest and opens it. Where the
    // browser lacks it (Safari today), the rest is plainly hidden, as before.
    const after = doc.createElement('span');
    fillShown(doc, after, rest, keyword);
    after.setAttribute('hidden', options.findable === true ? 'until-found' : '');
    after.addEventListener('beforematch', () => {
      // The browser shows the rest itself, so this keeps the nodes and only says the line is open.
      expanded = true;
      ellipsis.textContent = '';
      more.textContent = 'Show less';
      more.setAttribute('aria-expanded', 'true');
    });
    body.replaceChildren(start, ellipsis, after);
  };
  draw(expanded);
  row.append(more);
  return item;
}

/**
 * The detail of one entry, shown under its row: the facts the row leaves out, and the receipts of a
 * thought's action. The text itself is in the row, so it is not repeated here.
 */
export function renderDetail(doc: Doc, view: ThoughtView, receipts: Row[], death?: Row): El {
  const section = doc.createElement('section');
  section.className = 'detail';
  const facts = doc.createElement('dl');
  const latency = view.latencyMs === null ? 'not recorded' : `${view.latencyMs} ms`;
  // A journal line has no wake reason, outcome, template version, latency or receipts: only who and when.
  const pairs: [string, string][] =
    view.kind === 'journal'
      ? [
          ['Agent', view.agentName],
          ['Agent id', view.agentId],
          ['Tier', view.tier],
          ['When', view.at],
          ['Kind', 'journal'],
        ]
      : [
          ['Agent', view.agentName],
          ['Agent id', view.agentId],
          ['Tier', view.tier],
          ['When', view.at],
          ['Wake reason', view.wakeReason],
          ['Outcome', view.outcome],
          ['Template version', view.templateVersion],
          ['Latency', latency],
        ];
  if (death?.died_at != null)
    pairs.push(['Died', str(death.died_at)], ['Cause', str(death.death_cause)]);
  for (const [label, value] of pairs) {
    facts.append(make(doc, 'dt', '', label), make(doc, 'dd', '', value));
  }
  section.append(facts);
  if (view.kind === 'journal' || receipts.length === 0) return section;
  section.append(make(doc, 'h3', '', 'Receipts'));
  const wrap = make(doc, 'div', 'receipts', '');
  const table = doc.createElement('table');
  const head = doc.createElement('thead');
  const headings = doc.createElement('tr');
  for (const label of ['Kind', 'Phase', 'Item', 'Count', 'Credits']) {
    headings.append(make(doc, 'th', '', label));
  }
  head.append(headings);
  const body = doc.createElement('tbody');
  for (const receipt of receipts) {
    const row = doc.createElement('tr');
    for (const key of ['kind', 'phase', 'item', 'count', 'credits']) {
      row.append(make(doc, 'td', '', str(receipt[key])));
    }
    body.append(row);
  }
  table.append(head, body);
  wrap.append(table);
  section.append(wrap);
  return section;
}

/** A short status line. */
export function renderNote(doc: Doc, message: string): El {
  return make(doc, 'p', 'note', message);
}

/**
 * Fills the agent filter. The first option means every agent. Each other option's value is its
 * position in `names`, so no agent id or name becomes an attribute.
 */
export function fillAgentOptions(
  doc: Doc,
  select: El,
  names: string[],
  dead: boolean[] = [],
): void {
  const all = doc.createElement('option');
  all.value = '';
  all.textContent = 'All agents';
  const options = [all];
  names.forEach((name, index) => {
    const option = doc.createElement('option');
    option.value = String(index);
    option.textContent = display(name) + (dead[index] ? ' (died)' : '');
    options.push(option);
  });
  select.replaceChildren(...options);
}
