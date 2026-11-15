import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkDecisionRows } from './decision-rows.ts';

const README = 'docs/decisions/README.md';

/** A README file entry whose table has the given rows after the header and separator. */
function readme(rows: string[]): { path: string; text: string }[] {
  const text = ['# Decisions', '', '| # | Decision | Status |', '|---|---|---|', ...rows, ''];
  return [{ path: README, text: text.join('\n') }];
}

function row(number: string): string {
  return `| [${number}](${number}-slug.md) | Decision | Accepted |`;
}

describe('checkDecisionRows', () => {
  it('passes when the rows are in ascending order, with gaps', () => {
    expect(checkDecisionRows(readme([row('0001'), row('0003'), row('0010')]))).toEqual([]);
  });

  it('reports a row whose number is lower than an earlier row', () => {
    expect(checkDecisionRows(readme([row('0001'), row('0003'), row('0002')]))).toEqual([
      `${README} row 0002 comes after 0003 (keep the rows in number order)`,
    ]);
  });

  it('reports a row whose number is already listed by an adjacent row', () => {
    expect(checkDecisionRows(readme([row('0001'), row('0002'), row('0002')]))).toEqual([
      `${README} lists 0002 more than once`,
    ]);
  });

  it('reports a repeated number that is far from its first row', () => {
    const rows = [row('0001'), row('0005'), row('0002'), row('0001')];
    expect(checkDecisionRows(readme(rows))).toEqual([
      `${README} row 0002 comes after 0005 (keep the rows in number order)`,
      `${README} lists 0001 more than once`,
    ]);
  });

  it('reads a bold first cell and skips rows whose first cell is not a record', () => {
    const rows = [
      '| **[0001](0001-slug.md)** | Decision | Accepted |',
      '| [spec](../spec.md#13) | Spec | Accepted |',
      row('0002'),
    ];
    expect(checkDecisionRows(readme(rows))).toEqual([]);
  });

  it('passes on the real README', () => {
    const text = readFileSync(
      new URL('../../../docs/decisions/README.md', import.meta.url),
      'utf8',
    );
    expect(checkDecisionRows([{ path: README, text }])).toEqual([]);
  });
});
