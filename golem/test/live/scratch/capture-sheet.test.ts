// CAP-4: the flag-setting and teardown commands of the run sheet (docs/runbooks/capture-real-payloads.md, "Set the flag on
// the scratch shard"). The form that broke at teardown nested a `sed` with its own single quotes inside `sh -c '...'`. The
// fix is a heredoc (`sh <<'EOF'`), so the lint rejects a shell with a `-c` flag (`sh -c '`, `sh -ec '`) and any single-quoted
// string that holds a second single quote. The lint is text-only; `bash -n` also runs on each block when a bash is on
// PATH (Git Bash or WSL) and is skipped, visibly, when there is none. The blocks are the trimmed lines of the section.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RUNBOOK = new URL('../../../../docs/runbooks/capture-real-payloads.md', import.meta.url);
const SECTION = '## Set the flag on the scratch shard';
const HEREDOC_OPEN = /<<\s*'([A-Za-z]+)'\s*$/;
/** A shell run with a `-c` flag, alone or combined (`-c`, `-ec`, `-lc`), then a single quote. */
const SHELL_C_QUOTE = /\b(?:sh|bash|dash|zsh)\s+-[a-z]*c\s+'/;
/** True when `bash -n` runs (an empty script exits 0); false on a box with no bash, or a WSL that has no distro. */
const BASH_PRESENT = spawnSync('bash', ['-n'], { input: '' }).status === 0;

/** The fenced code blocks under `heading`, up to the next `## ` heading; each block is its trimmed lines. */
export function fencedBlocks(md: string, heading: string): string[][] {
  const lines = md.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`heading not found: ${heading}`);
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines.slice(start + 1)) {
    if (current === null && line.startsWith('## ')) break;
    if (line.trim().startsWith('```')) {
      if (current === null) current = [];
      else {
        blocks.push(current);
        current = null;
      }
      continue;
    }
    if (current !== null) current.push(line.trim());
  }
  return blocks;
}

/**
 * The problems in one block's lines. A `sh -c '` command is refused (use a heredoc). A single-quoted string may not hold
 * a second single quote, and every line has an even number of single quotes. Heredoc bodies are read as shell input,
 * so they are checked for the same quote balance but not for nesting.
 */
export function quoteProblems(lines: string[]): string[] {
  const problems: string[] = [];
  let terminator: string | null = null;
  lines.forEach((line, i) => {
    const where = `line ${i + 1}: ${line}`;
    if (terminator !== null && line === terminator) terminator = null;
    if (line.split("'").length % 2 === 0) problems.push(`unbalanced single quotes, ${where}`);
    if (terminator === null) {
      const shellC = SHELL_C_QUOTE.exec(line);
      if (shellC !== null) {
        problems.push(`sh -c with a single-quoted string (use a heredoc), ${where}`);
        const inner = line.slice(shellC.index + shellC[0].length);
        if (inner.split("'").length > 2) problems.push(`nested single quote, ${where}`);
      }
      const open = HEREDOC_OPEN.exec(line);
      if (open !== null) terminator = open[1] ?? null;
    }
  });
  if (terminator !== null) problems.push(`heredoc not closed: ${terminator}`);
  return problems;
}

describe('the run sheet commands for the flag have no nested single quotes', () => {
  const md = readFileSync(RUNBOOK, 'utf8');
  const blocks = fencedBlocks(md, SECTION);

  it('the section has the set, the sed and the teardown blocks', () => {
    expect(blocks.length).toBe(3);
  });

  it('every block passes the lint', () => {
    for (const block of blocks) {
      expect(quoteProblems(block), block.join('\n')).toEqual([]);
    }
  });

  it('no block in the section uses sh -c with a quoted string', () => {
    for (const block of blocks) {
      expect(block.some((line) => SHELL_C_QUOTE.test(line))).toBe(false);
    }
  });
});

describe('bash -n accepts every block of the run sheet section (skipped when no bash is on PATH)', () => {
  const blocks = fencedBlocks(readFileSync(RUNBOOK, 'utf8'), SECTION);
  blocks.forEach((block, i) => {
    it.skipIf(!BASH_PRESENT)(`block ${i + 1} parses`, () => {
      const run = spawnSync('bash', ['-n'], { input: `${block.join('\n')}\n`, encoding: 'utf8' });
      expect(run.status, `block ${i + 1}: ${run.stderr}`).toBe(0);
    });
  });
});

describe('the lint catches the forms that broke, and passes the heredoc form', () => {
  it('refuses the sh -c printf line the sheet used before CAP-4', () => {
    const before = [
      `docker exec geldar-phase0-paper-1 sh -c 'printf "provenance:\\n  enabled: true\\n" >> /data/plugins/GeldarCore/config.yml'`,
    ];
    expect(quoteProblems(before).some((p) => p.includes('sh -c'))).toBe(true);
  });

  it('refuses a sed with its own single quotes inside sh -c', () => {
    const nested = [
      `docker exec geldar-phase0-paper-1 sh -c 'sed -i 's/provenance:.*//' /data/plugins/GeldarCore/config.yml'`,
    ];
    expect(quoteProblems(nested).some((p) => p.includes('nested single quote'))).toBe(true);
  });

  it('refuses the combined flag form sh -ec with a quoted string', () => {
    const combined = [`docker exec geldar-phase0-paper-1 sh -ec 'sed -i s/a/b/ /data/x.yml'`];
    expect(quoteProblems(combined).some((p) => p.includes('sh -c'))).toBe(true);
  });

  it('refuses an unbalanced quote', () => {
    expect(quoteProblems(["echo 'abc"]).length).toBeGreaterThan(0);
  });

  it('passes the sed line of the heredoc form, the cp backup and the restore', () => {
    const fixture = [
      'docker exec geldar-phase0-paper-1 cp /data/plugins/GeldarCore/config.yml /tmp/geldar-config-cap.bak',
      "docker exec -i geldar-phase0-paper-1 sh <<'EOF'",
      "sed -i '/^blockowner:/,/^[^ ]/ s/enabled: false/enabled: true/' /data/plugins/GeldarCore/config.yml",
      'EOF',
      "docker exec geldar-phase0-paper-1 grep -c '^provenance:' /data/plugins/GeldarCore/config.yml",
    ];
    expect(quoteProblems(fixture)).toEqual([]);
  });

  it('reads the fenced blocks under a heading and stops at the next section', () => {
    const md = ['## A', '```bash', 'one', '```', '## B', '```bash', 'two', '```'].join('\n');
    expect(fencedBlocks(md, '## A')).toEqual([['one']]);
  });
});
