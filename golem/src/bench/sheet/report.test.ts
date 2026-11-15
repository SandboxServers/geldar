import { describe, expect, it } from 'vitest';
import { formatReport, formatSection, parseCsv } from './report.ts';

describe('parseCsv', () => {
  it('reads the header and the rows', () => {
    expect(parseCsv('domain,world_tick\nmining,40\ncombat,41\n')).toEqual({
      header: ['domain', 'world_tick'],
      rows: [
        ['mining', '40'],
        ['combat', '41'],
      ],
    });
  });

  it('reads empty input as an empty table', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });

  it('refuses a quoted field rather than mis-splitting it', () => {
    expect(() => parseCsv('a,b\n"x,y",2\n')).toThrow('quoted CSV fields are not supported');
  });
});

describe('formatSection', () => {
  it('prints the title with the row count and aligned columns', () => {
    const text = formatSection({
      title: 'xp_evidence',
      csv: 'domain,evidence_key\nmining,mine:a1\ncombat,kill:b22\n',
    });
    expect(text).toBe(
      [
        '== xp_evidence (2 rows) ==',
        'domain  evidence_key',
        'mining  mine:a1',
        'combat  kill:b22',
      ].join('\n'),
    );
  });

  it('uses the singular for one row and says none for an empty table', () => {
    expect(formatSection({ title: 'rolls', csv: 'fx\nstr\n' })).toContain('== rolls (1 row) ==');
    expect(formatSection({ title: 'rolls', csv: '' })).toBe('== rolls (0 rows) ==\n(none)');
  });
});

describe('formatReport', () => {
  it('joins the sections in the order given, with a blank line between them', () => {
    const text = formatReport([
      { title: 'rolls', csv: '' },
      { title: 'xp_evidence', csv: '' },
    ]);
    expect(text).toBe('== rolls (0 rows) ==\n(none)\n\n== xp_evidence (0 rows) ==\n(none)');
  });
});
