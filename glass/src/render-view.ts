/**
 * The DOM part of the Thought Stream page. Every element is made here from a fixed tag and a fixed
 * class. Every value from the world goes in with textContent, after display(). Nothing from the
 * world becomes an attribute, a link, a style or markup. Nothing here sets markup from a string.
 *
 * glass/ has no DOM library, so the few DOM members used are declared below. The file is served to
 * the browser after type stripping, so it stays erasable TypeScript.
 */
import { display, journalShown, type Row, type ThoughtView } from './render-model.ts';

/** The DOM members this page uses. */
export interface El {
  className: string;
  textContent: string | null;
  type: string;
  value: string;
  append(...nodes: El[]): void;
  replaceChildren(...nodes: El[]): void;
  addEventListener(type: 'click', listener: () => void): void;
}

export interface Doc {
  createElement(tag: string): El;
}

/** A node with one text value. The value is shown as text only, never parsed as markup. */
function make(doc: Doc, tag: string, className: string, value: string): El {
  const node = doc.createElement(tag);
  node.className = className;
  node.textContent = display(value);
  return node;
}

/** A value from a receipt row as text. Nulls become empty. */
function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

/** One line of the thought list. Pressing it opens the thought with the given callback. */
export function renderRow(doc: Doc, view: ThoughtView, onOpen: (id: string) => void): El {
  const item = doc.createElement('li');
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'row';
  const latency = view.latencyMs === null ? '' : `${view.latencyMs} ms`;
  if (view.kind === 'journal') {
    // A journal line shows its text on its own line, 200 characters at first, all of it on a tap.
    button.className = 'row journal-row';
    let expanded = false;
    const body = make(doc, 'span', 'plan journal-text', journalShown(view.plan, false).shown);
    button.addEventListener('click', () => {
      const { expandable } = journalShown(view.plan, expanded);
      if (!expandable) {
        onOpen(view.id);
        return;
      }
      expanded = !expanded;
      body.textContent = display(journalShown(view.plan, expanded).shown);
    });
    button.append(
      make(doc, 'span', 'when', view.at),
      make(doc, 'span', 'agent', view.agentName),
      make(doc, 'span', 'tier', view.tier),
      make(doc, 'span', 'outcome none', 'journal'),
      body,
    );
    item.append(button);
    return item;
  }
  button.addEventListener('click', () => onOpen(view.id));
  button.append(
    make(doc, 'span', 'when', view.at),
    make(doc, 'span', 'agent', view.agentName),
    make(doc, 'span', 'tier', view.tier),
    make(doc, 'span', `outcome ${view.outcome}`, view.outcome),
    make(doc, 'span', 'template', view.templateVersion),
    make(doc, 'span', 'latency', latency),
    make(doc, 'span', 'wake', view.wakeReason),
    make(doc, 'span', 'plan', view.plan),
  );
  item.append(button);
  return item;
}

/** The detail of one thought: its facts, its plan and the receipts of its action. */
export function renderDetail(doc: Doc, view: ThoughtView, receipts: Row[]): El {
  const section = doc.createElement('section');
  section.className = 'detail';
  const facts = doc.createElement('dl');
  const latency = view.latencyMs === null ? 'not recorded' : `${view.latencyMs} ms`;
  // A journal line has no wake reason, outcome, template version, latency or receipts: only who, when and what.
  const pairs: [string, string][] =
    view.kind === 'journal'
      ? [
          ['Agent', view.agentName],
          ['Agent id', view.agentId],
          ['Tier', view.tier],
          ['When', view.at],
          ['Kind', 'journal'],
          ['Text', view.plan],
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
          ['Plan', view.plan],
        ];
  for (const [label, value] of pairs) {
    facts.append(make(doc, 'dt', '', label), make(doc, 'dd', '', value));
  }
  if (view.kind === 'journal') {
    section.append(facts);
    return section;
  }
  section.append(facts, make(doc, 'h3', '', 'Receipts'));
  const list = doc.createElement('ul');
  for (const receipt of receipts) {
    const line = ['kind', 'phase', 'item', 'count', 'credits']
      .map((k) => str(receipt[k]))
      .join(' ');
    list.append(make(doc, 'li', 'receipt', line));
  }
  section.append(list);
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
export function fillAgentOptions(doc: Doc, select: El, names: string[]): void {
  const all = doc.createElement('option');
  all.value = '';
  all.textContent = 'All agents';
  const options = [all];
  names.forEach((name, index) => {
    const option = doc.createElement('option');
    option.value = String(index);
    option.textContent = display(name);
    options.push(option);
  });
  select.replaceChildren(...options);
}
