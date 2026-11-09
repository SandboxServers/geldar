import { describe, expect, it } from 'vitest';
import { checkDecisionIndex } from './decision-index.ts';

const README = 'docs/decisions/README.md';

/** A README whose table lists the given record names, in the repo's row format. */
function readmeListing(names: string[]): string {
  const rows = names.map((name) => `| [${name.slice(0, 4)}](${name}) | Decision | Accepted |`);
  return ['# Decisions', '', '| # | Decision | Status |', '|---|---|---|', ...rows, ''].join('\n');
}

function decisionFiles(names: string[], readme: string | null): { path: string; text: string }[] {
  const records = names.map((name) => ({ path: `docs/decisions/${name}`, text: '# record\n' }));
  return readme === null ? records : [...records, { path: README, text: readme }];
}

describe('checkDecisionIndex', () => {
  it('passes when every record has a row and every row links a record', () => {
    const names = ['0001-contract.md', '0002-host.md'];
    expect(checkDecisionIndex(decisionFiles(names, readmeListing(names)))).toEqual([]);
  });

  it('reports a record that has no row in the README table', () => {
    const readme = readmeListing(['0001-contract.md', '0002-host.md']);
    const problems = checkDecisionIndex(
      decisionFiles(['0001-contract.md', '0002-host.md', '0003-late.md'], readme),
    );
    expect(problems).toEqual([`${README} does not list 0003-late.md (add its row to the table)`]);
  });

  it('reports a README row that links a file which is not a record', () => {
    const readme = readmeListing(['0001-contract.md', '0009-renamed.md']);
    const problems = checkDecisionIndex(decisionFiles(['0001-contract.md'], readme));
    expect(problems).toEqual([
      `${README} links 0009-renamed.md, which is not a record in docs/decisions/`,
    ]);
  });

  it('reports every record when the README is missing', () => {
    const problems = checkDecisionIndex(decisionFiles(['0001-contract.md'], null));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('0001-contract.md');
  });

  it('reports a Markdown file in the folder that is not a numbered record', () => {
    const readme = readmeListing(['0001-contract.md']);
    const files = [
      ...decisionFiles(['0001-contract.md'], readme),
      { path: 'docs/decisions/template.md', text: '# template\n' },
    ];
    expect(checkDecisionIndex(files)).toEqual([
      'docs/decisions/template.md is not named NNNN-slug.md (rename it or move it out)',
    ]);
  });

  it('ignores links that are not in the first cell of a row or that are not records', () => {
    const readme = [
      '# Decisions',
      '',
      '| # | Decision | Status |',
      '|---|---|---|',
      '| [0001](0001-contract.md) | Cites [spec](../spec.md#13) and [x](https://example.com/x) | Accepted |',
      '| [0002](0002-host.md) | The spec is [here](../spec.md) | Accepted |',
      '| ../spec.md | Spec | Accepted |',
      'See [the spec](../spec.md) for more.',
      '',
    ].join('\n');
    const names = ['0001-contract.md', '0002-host.md'];
    expect(checkDecisionIndex(decisionFiles(names, readme))).toEqual([]);
  });

  it('accepts a first-cell link with an anchor or a leading ./', () => {
    const readme = [
      '| # | Decision | Status |',
      '|---|---|---|',
      '| [0001](./0001-contract.md#why) | The contract | Accepted |',
      '',
    ].join('\n');
    expect(checkDecisionIndex(decisionFiles(['0001-contract.md'], readme))).toEqual([]);
  });

  it('reports a record whose only mention is another row status cell', () => {
    const readme = [
      '| # | Decision | Status |',
      '|---|---|---|',
      '| [0001](0001-old.md) | Old choice | Superseded by [0002](0002-new.md) |',
      '',
    ].join('\n');
    const problems = checkDecisionIndex(decisionFiles(['0001-old.md', '0002-new.md'], readme));
    expect(problems).toEqual([`${README} does not list 0002-new.md (add its row to the table)`]);
  });
});
