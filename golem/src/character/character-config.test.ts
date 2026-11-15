import { STANDARD_SHEET } from '@geldar/psyche';
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_OFF,
  type CharacterConfig,
  lifeCharacter,
  parseCharacterConfig,
} from './character-config.ts';

const SHEET = {
  version: 1,
  attributes: { curiosity: 5, common_sense: 2, cleverness: 4, aggression: 1 },
  alignment: { law: 2, good: 4 },
  op_modes: { explorer: 5, farmer: 2, miner: 3, builder: 4, crafter: 1, warrior: 2, nitwit: 3 },
};

/** A log that keeps every line, so a test can count them. */
function collector(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

/** A config in sheet mode with the defaults for the other keys. */
const SHEET_MODE: CharacterConfig = parseCharacterConfig({ mode: 'sheet' }, collector().log);

describe('parseCharacterConfig', () => {
  it('is off when the block is omitted or null', () => {
    expect(parseCharacterConfig(undefined, collector().log)).toEqual(CHARACTER_OFF);
    expect(parseCharacterConfig(null, collector().log)).toEqual(CHARACTER_OFF);
    expect(CHARACTER_OFF.mode).toBe('off');
  });

  it('defaults rolls and proficiency to off with the standard thresholds', () => {
    expect(SHEET_MODE).toEqual({
      mode: 'sheet',
      rolls: false,
      proficiency: { enabled: false, thresholds: [10, 30, 70] },
    });
  });

  it('reads every key the block owns', () => {
    const config = parseCharacterConfig(
      { mode: 'sheet', rolls: true, proficiency: { enabled: true, thresholds: [5, 20, 60] } },
      collector().log,
    );
    expect(config).toEqual({
      mode: 'sheet',
      rolls: true,
      proficiency: { enabled: true, thresholds: [5, 20, 60] },
    });
  });

  it('refuses a mode that is neither off nor sheet', () => {
    expect(() => parseCharacterConfig({ mode: 'on' }, collector().log)).toThrow(
      'character.mode must be off or sheet',
    );
  });

  it('refuses a block that is not a map', () => {
    expect(() => parseCharacterConfig('sheet', collector().log)).toThrow('character must be a map');
  });

  it('refuses an unknown key', () => {
    expect(() => parseCharacterConfig({ mode: 'off', rollz: true }, collector().log)).toThrow(
      'character.rollz: unknown key',
    );
  });

  it('refuses a rolls value that is not true or false', () => {
    expect(() => parseCharacterConfig({ mode: 'sheet', rolls: 'yes' }, collector().log)).toThrow(
      'character.rolls must be true or false',
    );
  });

  it('refuses an enabled value that is not true or false', () => {
    expect(() =>
      parseCharacterConfig({ mode: 'sheet', proficiency: { enabled: 1 } }, collector().log),
    ).toThrow('character.proficiency.enabled must be true or false');
  });

  it.each([
    [[30, 10, 70], 'must ascend'],
    [[10, 10, 70], 'must ascend'],
    [[0, 30, 70], 'must be positive integers'],
    [[-1, 30, 70], 'must be positive integers'],
    [[10.5, 30, 70], 'must be positive integers'],
    [[10, 30, '70'], 'must be positive integers'],
    [[10, 30], 'must be three integers'],
  ])('refuses thresholds %j (%s)', (thresholds, message) => {
    expect(() =>
      parseCharacterConfig({ mode: 'sheet', proficiency: { thresholds } }, collector().log),
    ).toThrow(message);
  });

  it('accepts the smallest ascending positive integers', () => {
    const config = parseCharacterConfig(
      { mode: 'sheet', proficiency: { thresholds: [1, 2, 3] } },
      collector().log,
    );
    expect(config.proficiency.thresholds).toEqual([1, 2, 3]);
  });

  it.each([
    'idle_think_probability',
    'max_heuristic_picks',
    'failure_hard_cap',
    'sanity_check',
    'tom',
    'morality_hooks',
    'drift',
  ])('tolerates the instinct key %s and logs one line for it', (key) => {
    const log = collector();
    const config = parseCharacterConfig({ mode: 'off', [key]: { any: 1 } }, log.log);
    expect(config).toEqual(CHARACTER_OFF);
    expect(log.lines).toEqual([`character.${key} is owned by the kit or a later wave; ignored`]);
  });
});

describe('lifeCharacter', () => {
  it('off yields no sheet even with a non-standard stored sheet', () => {
    const off = lifeCharacter(CHARACTER_OFF, SHEET, 'ag_jason_01', collector().log);
    expect(off.sheet).toBeNull();
    expect(off.source).toBe('off');
  });

  it('off yields no sheet when none is stored', () => {
    expect(
      lifeCharacter(CHARACTER_OFF, undefined, 'ag_jason_01', collector().log).sheet,
    ).toBeNull();
  });

  it('sheet mode with no sheet uses the standard sheet and logs one line naming the life', () => {
    for (const raw of [undefined, null]) {
      const log = collector();
      const result = lifeCharacter(SHEET_MODE, raw, 'ag_jason_01', log.log);
      expect(result.sheet).toEqual(STANDARD_SHEET);
      expect(result.source).toBe('standard');
      expect(log.lines).toEqual(['standard sheet for ag_jason_01']);
    }
  });

  it('sheet mode with a valid sheet returns it and logs nothing', () => {
    const log = collector();
    const result = lifeCharacter(SHEET_MODE, SHEET, 'ag_jason_01', log.log);
    expect(result.sheet).toEqual(SHEET);
    expect(result.source).toBe('config');
    expect(result.config).toBe(SHEET_MODE);
    expect(log.lines).toEqual([]);
  });

  it('sheet mode refuses a malformed sheet and names the life and the field', () => {
    const bad = { ...SHEET, attributes: { ...SHEET.attributes, curiosity: 9 } };
    expect(() => lifeCharacter(SHEET_MODE, bad, 'ag_jason_01', collector().log)).toThrow(
      /ag_jason_01.*attributes\.curiosity/,
    );
  });

  it('sheet mode refuses an unknown top-level sheet key and names it', () => {
    const bad = { ...SHEET, extra: 1 };
    expect(() => lifeCharacter(SHEET_MODE, bad, 'ag_jason_01', collector().log)).toThrow(
      /ag_jason_01.*extra/,
    );
  });

  it('keeps score values out of its log lines', () => {
    const log = collector();
    lifeCharacter(SHEET_MODE, SHEET, 'ag_jason_01', log.log);
    lifeCharacter(SHEET_MODE, undefined, 'ag_jason_01', log.log);
    expect(log.lines).toEqual(['standard sheet for ag_jason_01']);
    expect(log.lines.join('\n')).not.toContain('5');
  });
});
