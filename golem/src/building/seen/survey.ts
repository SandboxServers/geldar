// Survey reader (BLD-20): a box of the seen map as layered run-length text for the Body reply.
// Reply: `{ text, truncated }`, no owner field. Text is one legend line, then one block per Y layer
// (`y=<y>`), then one line per Z row (`  z=<z> <run> <run> ...`). A run is `<count><symbol>[@<minutes>]`:
// the symbol is a legend entry, `@<minutes>` is the last-seen age in game minutes. A cell inherited from a
// predecessor life (decision 0424) carries an `i` after its age (`@<minutes>i`); a fresh sighting never does.
// `?` is unseen (legend `?=unknown`) and carries no age. Layers go nearest to `anchorY` first, so a box that does
// not fit answers with the nearest slice and `truncated` set.
import type { SeenMap } from './section.ts';

/** The reply text cap in characters: a payload cap, not a policy cap on box size. */
export const SURVEY_TEXT_CAP = 6000;
/** Game ticks per game minute (20 ticks a second). */
export const TICKS_PER_MINUTE = 1200;

const UNSEEN = '?';
const OVERFLOW = '*';
/** The mark after a run's age for a cell inherited from a predecessor life. */
const INHERITED = 'i';
const SYMBOLS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** An inclusive box of block coordinates. */
export interface SurveyBox {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** The survey reply: the layered text and whether a slice was left out. */
export interface SurveyReply {
  text: string;
  truncated: boolean;
}

interface Legend {
  names: Map<string, string>;
  overflow: boolean;
}

interface Layer {
  y: number;
  lines: string[];
}

function emptyLegend(): Legend {
  return { names: new Map(), overflow: false };
}

function cloneLegend(legend: Legend): Legend {
  return { names: new Map(legend.names), overflow: legend.overflow };
}

/** The symbol for a block name; past the 52 letters every further name shares `*` (legend `*=other`). */
function symbolFor(legend: Legend, name: string): string {
  const known = legend.names.get(name);
  if (known !== undefined) return known;
  if (legend.names.size >= SYMBOLS.length) {
    legend.overflow = true;
    return OVERFLOW;
  }
  const symbol = SYMBOLS[legend.names.size] as string;
  legend.names.set(name, symbol);
  return symbol;
}

function legendLine(legend: Legend): string {
  const parts = [`${UNSEEN}=unknown`];
  for (const [name, symbol] of legend.names) parts.push(`${symbol}=${name}`);
  if (legend.overflow) parts.push(`${OVERFLOW}=other`);
  return `legend ${parts.join(' ')}`;
}

/** Whole game minutes since a cell was last seen; a tick in the future counts as zero. */
function ageMinutes(nowTick: number, lastSeen: number): number {
  return Math.floor(Math.max(0, nowTick - lastSeen) / TICKS_PER_MINUTE);
}

/** One Y layer of the box: a header line and one run-length line per Z row. */
function renderLayer(
  map: SeenMap,
  box: SurveyBox,
  y: number,
  nowTick: number,
  legend: Legend,
): string[] {
  const lines = [`y=${y}`];
  for (let z = box.min.z; z <= box.max.z; z++) {
    const runs: string[] = [];
    let token: string | undefined;
    let count = 0;
    for (let x = box.min.x; x <= box.max.x; x++) {
      const cell = map.read(x, y, z);
      const next =
        cell === undefined
          ? UNSEEN
          : `${symbolFor(legend, cell.name)}@${ageMinutes(nowTick, cell.lastSeen)}${cell.inherited ? INHERITED : ''}`;
      if (next === token) {
        count++;
        continue;
      }
      if (token !== undefined) runs.push(`${count}${token}`);
      token = next;
      count = 1;
    }
    if (token !== undefined) runs.push(`${count}${token}`);
    lines.push(`  z=${z} ${runs.join(' ')}`);
  }
  return lines;
}

/** The reply text: the legend line first, then the layer lines in order. */
function assemble(legend: Legend, layers: Layer[]): string {
  const ordered = [...layers].sort((a, b) => a.y - b.y);
  return [legendLine(legend), ...ordered.flatMap((layer) => layer.lines)].join('\n');
}

/**
 * Surveys a box of the seen map. Cells never seen read `?` (`unknown`); nothing is guessed about them.
 * Layers are taken nearest to `anchorY` first until the text would pass the cap; the nearest rows of
 * a layer that does not fit whole are kept, and `truncated` is set whenever a slice was left out.
 */
export function surveyBox(
  map: SeenMap,
  box: SurveyBox,
  nowTick: number,
  anchorY: number = box.min.y,
): SurveyReply {
  if (box.max.x < box.min.x || box.max.y < box.min.y || box.max.z < box.min.z) {
    return { text: legendLine(emptyLegend()), truncated: false };
  }
  const ys: number[] = [];
  for (let y = box.min.y; y <= box.max.y; y++) ys.push(y);
  ys.sort((a, b) => Math.abs(a - anchorY) - Math.abs(b - anchorY) || a - b);

  let legend = emptyLegend();
  const chosen: Layer[] = [];
  let truncated = false;
  for (const y of ys) {
    const trial = cloneLegend(legend);
    const lines = renderLayer(map, box, y, nowTick, trial);
    const whole = assemble(trial, [...chosen, { y, lines }]);
    if (whole.length <= SURVEY_TEXT_CAP) {
      legend = trial;
      chosen.push({ y, lines });
      continue;
    }
    truncated = true;
    if (chosen.length === 0) {
      // Even this layer does not fit whole: keep its nearest rows, one line at a time.
      const kept: string[] = [];
      for (const line of lines) {
        const fits = assemble(trial, [{ y, lines: [...kept, line] }]);
        if (fits.length > SURVEY_TEXT_CAP) break;
        kept.push(line);
      }
      legend = trial;
      chosen.push({ y, lines: kept });
    }
    break;
  }
  return { text: assemble(legend, chosen), truncated };
}

/** One decoded cell: its block name (undefined for unseen), its age in game minutes (undefined for unseen) and its inherited mark. */
export interface DecodedCell {
  name: string | undefined;
  ageMinutes: number | undefined;
  inherited: boolean;
}

/** A decoded survey: the legend and the layers, each row's cells in ascending X order. */
export interface DecodedSurvey {
  legend: Map<string, string>;
  layers: { y: number; rows: { z: number; cells: DecodedCell[] }[] }[];
}

const RUN = /^(\d+)([A-Za-z?*])(?:@(\d+)(i)?)?$/;

/** Reads a survey text back into cells. Inverse of `surveyBox` for the cells it kept. */
export function decodeSurvey(text: string): DecodedSurvey {
  const [head = '', ...body] = text.split('\n');
  const legend = new Map<string, string>();
  for (const part of head.split(' ').slice(1)) {
    const eq = part.indexOf('=');
    legend.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const layers: DecodedSurvey['layers'] = [];
  for (const line of body) {
    if (line.startsWith('y=')) {
      layers.push({ y: Number(line.slice(2)), rows: [] });
      continue;
    }
    const [zPart = '', ...runs] = line.trimStart().split(' ');
    const layer = layers[layers.length - 1];
    if (layer === undefined) throw new Error('survey row before any layer');
    const cells: DecodedCell[] = [];
    for (const run of runs) {
      const match = RUN.exec(run);
      if (match === null) throw new Error(`bad survey run: ${run}`);
      const count = Number(match[1]);
      const symbol = match[2] as string;
      const cell: DecodedCell =
        symbol === UNSEEN
          ? { name: undefined, ageMinutes: undefined, inherited: false }
          : {
              name: legend.get(symbol),
              ageMinutes: Number(match[3]),
              inherited: match[4] === INHERITED,
            };
      for (let i = 0; i < count; i++) cells.push(cell);
    }
    layer.rows.push({ z: Number(zPart.slice(2)), cells });
  }
  return { legend, layers };
}
