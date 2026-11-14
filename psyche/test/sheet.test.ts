import { readdirSync, readFileSync } from 'node:fs';
import { validateCharacterSheet } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import {
  canonicalSheetJson,
  normalizeSheet,
  STANDARD_SHEET,
  sheetOrStandard,
} from '../src/index.ts';

type Plain = Record<string, unknown>;

/** The thirteen innate scores, as [group, key] paths into a sheet. */
const SCORE_PATHS: string[][] = [
  ['attributes', 'curiosity'],
  ['attributes', 'common_sense'],
  ['attributes', 'cleverness'],
  ['attributes', 'aggression'],
  ['alignment', 'law'],
  ['alignment', 'good'],
  ['op_modes', 'explorer'],
  ['op_modes', 'farmer'],
  ['op_modes', 'miner'],
  ['op_modes', 'builder'],
  ['op_modes', 'crafter'],
  ['op_modes', 'warrior'],
  ['op_modes', 'nitwit'],
];

/** A fresh, mutable copy of the standard sheet with the value at path replaced. */
function sheetWith(path: string[], value: unknown): Plain {
  const copy = JSON.parse(JSON.stringify(STANDARD_SHEET)) as Plain;
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key] as Plain;
  node[path[path.length - 1] ?? ''] = value;
  return copy;
}

describe('STANDARD_SHEET', () => {
  it('validates against the contract schema, with every score at 3', () => {
    expect(validateCharacterSheet(STANDARD_SHEET).ok).toBe(true);
    for (const [group, key] of SCORE_PATHS) {
      const scores = STANDARD_SHEET[group as 'alignment'] as Record<string, number>;
      expect(scores[key ?? '']).toBe(3);
    }
  });

  it('is deeply frozen: a write throws at runtime', () => {
    expect(Object.isFrozen(STANDARD_SHEET)).toBe(true);
    expect(Object.isFrozen(STANDARD_SHEET.attributes)).toBe(true);
    expect(Object.isFrozen(STANDARD_SHEET.op_modes)).toBe(true);
    expect(() => {
      (STANDARD_SHEET.attributes as { curiosity: number }).curiosity = 5;
    }).toThrow(TypeError);
  });
});

describe('normalizeSheet', () => {
  it('accepts the standard sheet and returns a copy, not an alias of the input', () => {
    const input = JSON.parse(JSON.stringify(STANDARD_SHEET)) as Plain;
    const result = normalizeSheet(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet).toEqual(STANDARD_SHEET);
    expect(result.sheet.attributes).not.toBe(input.attributes);
  });

  it('refuses each score at 0, 6 and 3.5', () => {
    for (const path of SCORE_PATHS) {
      for (const bad of [0, 6, 3.5]) {
        const result = normalizeSheet(sheetWith(path, bad));
        expect(result.ok, `${path.join('.')}=${bad}`).toBe(false);
      }
    }
  });

  it('refuses an unknown key at every level', () => {
    for (const level of [[], ['attributes'], ['alignment'], ['op_modes']]) {
      const result = normalizeSheet(sheetWith([...level, 'extra'], 3));
      expect(result.ok, `unknown key under ${level.join('.') || 'top level'}`).toBe(false);
    }
  });

  it('refuses a sheet that carries proficiency', () => {
    const result = normalizeSheet({ ...STANDARD_SHEET, proficiency: { combat: 0 } });
    expect(result.ok).toBe(false);
  });

  it('refuses a wrong version, a missing group, and non-object input', () => {
    expect(normalizeSheet(sheetWith(['version'], 2)).ok).toBe(false);
    const withoutOpModes: Plain = { ...STANDARD_SHEET };
    delete withoutOpModes.op_modes;
    expect(normalizeSheet(withoutOpModes).ok).toBe(false);
    expect(normalizeSheet(null).ok).toBe(false);
    expect(normalizeSheet([]).ok).toBe(false);
    expect(normalizeSheet('sheet').ok).toBe(false);
  });

  it('names the failing field in its errors', () => {
    const result = normalizeSheet(sheetWith(['alignment', 'law'], 6));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toContain('alignment.law');
  });
});

describe('sheetOrStandard', () => {
  it('treats undefined and null as the standard sheet', () => {
    expect(sheetOrStandard(undefined)).toEqual({ sheet: STANDARD_SHEET, standard: true });
    expect(sheetOrStandard(null)).toEqual({ sheet: STANDARD_SHEET, standard: true });
  });

  it('returns a valid sheet as given, not standard', () => {
    const result = sheetOrStandard(sheetWith(['attributes', 'curiosity'], 5));
    expect(result.standard).toBe(false);
    expect(result.sheet.attributes.curiosity).toBe(5);
  });

  it('throws on a malformed sheet and names the field; never repairs it', () => {
    expect(() => sheetOrStandard(sheetWith(['attributes', 'curiosity'], 9))).toThrow(
      /attributes\.curiosity/,
    );
    expect(() => sheetOrStandard({ version: 1 })).toThrow(/attributes/);
  });
});

describe('canonicalSheetJson', () => {
  it('sorts keys at every level, with no whitespace, and is stable under key order', () => {
    const reversed = {
      version: 1,
      op_modes: { nitwit: 3, warrior: 3, crafter: 3, builder: 3, miner: 3, farmer: 3, explorer: 3 },
      alignment: { good: 3, law: 3 },
      attributes: { aggression: 3, cleverness: 3, common_sense: 3, curiosity: 3 },
    };
    const text = canonicalSheetJson(reversed as typeof STANDARD_SHEET);
    expect(text).toBe(canonicalSheetJson(STANDARD_SHEET));
    expect(text).toBe(
      '{"alignment":{"good":3,"law":3},"attributes":{"aggression":3,"cleverness":3,"common_sense":3,"curiosity":3},' +
        '"op_modes":{"builder":3,"crafter":3,"explorer":3,"farmer":3,"miner":3,"nitwit":3,"warrior":3},"version":1}',
    );
    expect(text).not.toMatch(/\s/);
  });
});

describe('psyche/src imports', () => {
  it('imports nothing but relative modules with a .ts extension', () => {
    const dir = new URL('../src/', import.meta.url);
    let specifiers = 0;
    for (const file of readdirSync(dir)) {
      const text = readFileSync(new URL(file, dir), 'utf8');
      for (const match of text.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(?\s*'([^']+)'/g)) {
        const spec = match[1] ?? match[2] ?? '';
        specifiers += 1;
        expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/[^']+\.ts$/);
      }
    }
    expect(specifiers).toBeGreaterThan(0);
  });
});
