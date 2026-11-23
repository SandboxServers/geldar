import { describe, expect, it } from 'vitest';
import { findBoardLeaks } from './board-literals.ts';
import { type RepoPort, runRepoChecks } from './run-checks.ts';

/**
 * Fixtures are joined from parts so that this file holds no board host and no
 * key-shaped text for the check to read; the strings are the same at run time.
 */
const HOST = ['board', 'example-site', 'app'].join('.');
const HEX24 = 'a1b2c3d4e5f6a7b8c9d0e1f2';
const ALNUM24 = 'Q7xK2pLm9Rt4Vw8Zb3Nc6Hd1';

describe('findBoardLeaks', () => {
  it('flags a line that names the board host, with its line number', () => {
    const text = ['# notes', `open https://${HOST}/t/1`].join('\n');
    expect(findBoardLeaks('docs/x.md', text)).toEqual([
      'docs/x.md:2: names the developer board host (docs/agents/board.md)',
    ]);
  });

  it('does not flag a longer word that ends in board', () => {
    expect(findBoardLeaks('docs/x.md', ['dashboard.example-site.app'].join(''))).toEqual([]);
  });

  it('flags an Api-Key header with 20 or more hex characters', () => {
    expect(findBoardLeaks('a.txt', ['Api-Key:', HEX24].join(' '))).toHaveLength(1);
  });

  it('does not flag an Api-Key header with fewer than 20 hex characters', () => {
    expect(findBoardLeaks('a.txt', ['Api-Key:', HEX24.slice(0, 19)].join(' '))).toEqual([]);
  });

  it('flags a discourse-agent assignment with a long value, after = or :', () => {
    const name = ['discourse-agent', 'geldar', 'ops'].join('-');
    expect(findBoardLeaks('a.env', [name, ALNUM24].join('='))).toHaveLength(1);
    expect(findBoardLeaks('a.env', [name, ALNUM24].join(': '))).toHaveLength(1);
  });

  it('does not flag the placeholder names or a short value', () => {
    const placeholder = 'discourse-agent-<project>-<agent>';
    const short = ['discourse-agent', 'geldar', 'ops'].join('-') + '=' + ALNUM24.slice(0, 19);
    expect(findBoardLeaks('docs/agents/board.md', placeholder)).toEqual([]);
    expect(findBoardLeaks('a.env', short)).toEqual([]);
  });

  it('never repeats the matched key text in the finding', () => {
    const [finding] = findBoardLeaks('a.txt', ['Api-Key:', HEX24].join(' '));
    expect(finding).toBeDefined();
    expect(finding).not.toContain(HEX24);
  });
});

/** A port whose only tracked file is `docs/x.md` with the given text; every other read is missing. */
function portWith(text: string): RepoPort {
  return {
    indexEntries: () => [],
    untrackedPaths: () => ['docs/x.md'],
    crlfPaths: () => [],
    indexBlobs: () => new Map(),
    readText: (path) => (path === 'docs/x.md' ? text : undefined),
    readFileBytes: () => undefined,
  };
}

describe('runRepoChecks wiring of the board check', () => {
  it('fails the gate and names the file when a board host is in the tree', () => {
    const result = runRepoChecks(portWith(`see ${HOST}`), new Date('2026-11-23'));
    expect(result.failed).toBe(true);
    expect(
      result.lines.some((line) =>
        line.startsWith('error: docs/x.md:1: names the developer board host'),
      ),
    ).toBe(true);
  });

  it('reports no board finding for a clean file', () => {
    const result = runRepoChecks(portWith('no board text here'), new Date('2026-11-23'));
    expect(result.lines.some((line) => line.includes('developer board'))).toBe(false);
  });
});
