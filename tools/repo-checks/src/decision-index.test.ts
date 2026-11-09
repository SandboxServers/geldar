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

  it('ignores files that are not numbered records and links outside table rows', () => {
    const readme = `${readmeListing(['0001-contract.md'])}\nSee [the spec](../spec.md) for more.\n`;
    const files = [
      ...decisionFiles(['0001-contract.md'], readme),
      { path: 'docs/decisions/template.md', text: '# template\n' },
    ];
    expect(checkDecisionIndex(files)).toEqual([]);
  });
});
