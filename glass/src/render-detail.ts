/**
 * The facts of one entry: the detail card that opens under a row on a narrow screen, and the reader pane
 * beside the list on a wide one. Both are built from the same parts, with textContent only, as the rows
 * are (render-view.ts). Every value from the world goes through display().
 *
 * This file is served to the browser after type stripping, so it stays erasable TypeScript.
 */
import {
  copyText,
  display,
  type Row,
  receiptLine,
  type ThoughtView,
  whenLabel,
} from './render-model.ts';
import { action, type Doc, type El, kindLines, make, marked, sigil } from './render-view.ts';

/** The label of the copy control, and what it says for a moment after a press. */
export const COPY_LABEL = 'Copy entry';

export interface DetailOptions {
  death?: Row;
  /** How the agent's mind is run, from the agents list. Left out: the entry's tier. */
  mode?: string;
  nowMs?: number;
  keyword?: string;
  /**
   * Given, the entry gets a "Copy entry" button. It is called with the entry as plain text (copyText) and with
   * `say`, which sets the button's label: the caller says how the copy went, in its own fixed words.
   */
  onCopy?: (text: string, say: (label: string) => void) => void;
}

/** A value the entry does not carry. */
const NONE = '—';

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

/** The facts a row leaves out, as label and value pairs. A journal line has no tick, latency or template. */
function facts(doc: Doc, view: ThoughtView, death?: Row): El {
  const list = doc.createElement('dl');
  list.className = 'facts';
  const journal = view.kind === 'journal';
  const pairs: [string, string, string][] = [
    ['world day', view.worldDay === null ? NONE : String(view.worldDay), ''],
    ['tick', view.worldTick === null ? NONE : view.worldTick.toLocaleString('en-US'), ''],
    ['tier', view.tier === '' ? NONE : view.tier, ''],
    ['latency', journal || view.latencyMs === null ? NONE : `${view.latencyMs} ms`, ''],
    ['template', journal || view.templateVersion === '' ? NONE : view.templateVersion, ''],
    ['written', view.at === '' ? NONE : view.at, ''],
  ];
  if (death?.died_at != null) {
    pairs.push(['died', str(death.died_at), ''], ['cause', str(death.death_cause), 'bad']);
  }
  for (const [label, value, tone] of pairs) {
    list.append(make(doc, 'dt', '', label), make(doc, 'dd', tone, value));
  }
  return list;
}

/**
 * The receipts of the entry's action: what the body did, how it ended and the credits it moved. `null`
 * means the page does not know (no action is named, or the receipts are still on their way), and nothing
 * is said. An empty list is a fact, and the page says it.
 */
function receiptRows(doc: Doc, receipts: Row[] | null): El[] {
  if (receipts === null) return [];
  if (receipts.length === 0) {
    return [make(doc, 'p', 'none', 'No receipts: nothing was done with this entry.')];
  }
  const grid = doc.createElement('div');
  grid.className = 'receipts';
  for (const receipt of receipts) {
    const line = receiptLine(receipt);
    grid.append(
      make(doc, 'span', 'did', line.action),
      make(doc, 'span', `outcome ${line.tone}`, line.outcome),
      make(doc, 'span', 'amount', line.amount),
    );
  }
  return [make(doc, 'h3', '', 'receipts — what the body actually did'), grid];
}

/**
 * The detail of one entry: its facts, the receipts of its action and the copy control. Under a row it is a
 * card; in the reader the same nodes sit under a rule (the stylesheet tells the two apart).
 */
export function renderDetail(
  doc: Doc,
  view: ThoughtView,
  receipts: Row[] | null,
  options: DetailOptions = {},
): El {
  const section = doc.createElement('section');
  section.className = 'detail';
  section.append(facts(doc, view, options.death), ...receiptRows(doc, receipts));
  const { onCopy } = options;
  if (onCopy !== undefined) {
    const copy = action(doc, 'copy', COPY_LABEL, () => {
      onCopy(copyText(view), (label) => {
        copy.textContent = label;
      });
    });
    section.append(copy);
  }
  return section;
}

/**
 * The top of the reader pane: the agent's sigil and name, how its mind is run and when, what woke the
 * thought, and the text set large. The detail follows it (renderDetail).
 */
export function renderReaderHead(doc: Doc, view: ThoughtView, options: DetailOptions = {}): El[] {
  const keyword = options.keyword ?? '';
  const dead = options.death?.died_at != null;
  const head = doc.createElement('div');
  head.className = 'reader-head';
  const title = doc.createElement('div');
  title.className = 'reader-title';
  const when = whenLabel(view.atMs, options.nowMs ?? Date.now());
  const sub = [options.mode || view.tier, when === '' ? view.at : when]
    .map((part) => display(part))
    .filter((part) => part !== '')
    .join(' · ');
  title.append(
    marked(doc, 'h2', 'reader-name', view.agentName, keyword),
    make(doc, 'p', 'reader-sub', dead ? `† died · ${sub}` : sub),
  );
  head.append(sigil(doc, view, 'reader', dead), title);
  const nodes = [head, ...kindLines(doc, view, keyword)];
  if (view.plan !== '') {
    const journal = view.kind === 'journal';
    nodes.push(marked(doc, 'p', journal ? 'plan journal-text' : 'plan', view.plan, keyword));
  }
  return nodes;
}
