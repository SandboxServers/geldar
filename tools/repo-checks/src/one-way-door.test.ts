import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkOneWayDoor,
  guardedTriggers,
  headerDecisions,
  isAccepted,
  ONE_WAY_DOOR_ALLOWLIST,
} from './one-way-door.ts';

type File = { path: string; text: string };

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

const TRIGGER =
  'CREATE TRIGGER journal_immutable BEFORE UPDATE ON journal FOR EACH ROW EXECUTE FUNCTION refuse();';

/** A migration whose header names the given decisions and that creates a guarded trigger. */
function migration(path: string, decisions: string[], body = TRIGGER): File {
  const header = decisions.map(
    (number) => `-- Decision ${number}: the rule this migration relies on.`,
  );
  return { path, text: ['-- Migration header.', ...header, '', body, ''].join('\n') };
}

function record(number: string, status: string, title = 'A rule'): File {
  return {
    path: `docs/decisions/${number}-a-rule.md`,
    text: `# ${number}. ${title}\n\n- Status: ${status}\n- Date: 2026-11-01\n`,
  };
}

/** An allow-list with no entries: the rule runs on every file. */
const NONE = '{"exemptions": []}';
const ALLOW = (path: string, decision = '0186') =>
  JSON.stringify({ exemptions: [{ path, decision, note: 'until the owner rules' }] });

/** The real repo's files the rule reads: every migration and every decision record. */
function readRepoFiles(): File[] {
  const dirs = ['sql/', 'docs/decisions/'];
  return dirs.flatMap((dir) =>
    readdirSync(join(REPO, dir), { recursive: true })
      .map(String)
      .filter((name) => name.endsWith('.sql') || name.endsWith('.md'))
      .map((name) => {
        const path = `${dir}${name.replace(/\\/g, '/')}`;
        return { path, text: readFileSync(join(REPO, path), 'utf8') };
      }),
  );
}

function realAllowlist(): string {
  return readFileSync(join(REPO, ONE_WAY_DOOR_ALLOWLIST), 'utf8');
}

describe('one-way-door rule', () => {
  it('passes when the cited decision is Accepted', () => {
    const files = [migration('sql/0060_ledger.sql', ['0186']), record('0186', 'Accepted. Live.')];
    expect(checkOneWayDoor(files, NONE, 'list.json').problems).toEqual([]);
  });

  it('fails with the sql path, the decision title and the status text when the decision is Proposed', () => {
    const files = [
      migration('sql/0060_ledger.sql', ['0186']),
      record('0186', 'Proposed. Assumed for planning.', 'Character sheet: the answers'),
    ];
    const result = checkOneWayDoor(files, NONE, 'list.json');
    expect(result.problems).toEqual([
      'sql/0060_ledger.sql (trigger journal_immutable): 0186 Character sheet: the answers -- status: Proposed. Assumed for planning.',
    ]);
  });

  it('skips the migration own number even when its own record is not Accepted', () => {
    const files = [
      migration('sql/0007_journals_append_only.sql', ['0007', '0085']),
      record('0007', 'Proposed'),
      record('0085', 'Accepted'),
    ];
    expect(checkOneWayDoor(files, NONE, 'list.json').problems).toEqual([]);
  });

  it('warns, and does not fail, when a cited decision has no record', () => {
    const files = [migration('sql/0060_ledger.sql', ['0299'])];
    const result = checkOneWayDoor(files, NONE, 'list.json');
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([
      'sql/0060_ledger.sql: decision 0299 has no record in docs/decisions/ (not checked)',
    ]);
  });

  it('accepts a status that starts with Decided', () => {
    const files = [
      migration('sql/0060_ledger.sql', ['0186']),
      record('0186', 'Decided 2026-11-02.'),
    ];
    expect(checkOneWayDoor(files, NONE, 'list.json').problems).toEqual([]);
    expect(isAccepted('Decided 2026-11-02.')).toBe(true);
    expect(isAccepted('Proposed. Decided later.')).toBe(false);
  });

  it('reads a Status line with or without the "- " list marker', () => {
    const bare = {
      path: 'docs/decisions/0186-a-rule.md',
      text: '# 0186. A rule\n\nStatus: Accepted\n',
    };
    const marked = {
      path: 'docs/decisions/0186-a-rule.md',
      text: '# 0186. A rule\n\n- Status: Accepted\n',
    };
    const migrations = [migration('sql/0060_ledger.sql', ['0186'])];
    expect(checkOneWayDoor([...migrations, bare], NONE, 'list.json').problems).toEqual([]);
    expect(checkOneWayDoor([...migrations, marked], NONE, 'list.json').problems).toEqual([]);
    const proposed = {
      path: 'docs/decisions/0186-a-rule.md',
      text: '# 0186. A rule\n\nStatus: Proposed\n',
    };
    expect(checkOneWayDoor([...migrations, proposed], NONE, 'list.json').problems).toHaveLength(1);
  });

  it('skips an allow-listed file and reports it as info', () => {
    const files = [migration('sql/0060_ledger.sql', ['0186']), record('0186', 'Proposed')];
    const result = checkOneWayDoor(files, ALLOW('sql/0060_ledger.sql'), 'list.json');
    expect(result.problems).toEqual([]);
    expect(result.info).toEqual([
      'sql/0060_ledger.sql is allow-listed in list.json (rule skipped)',
    ]);
  });

  it('ignores a migration whose guarded trigger is only in a comment, and a trigger with another name', () => {
    const commented = migration(
      'sql/0061_note.sql',
      ['0186'],
      '-- CREATE TRIGGER journal_immutable (not real)\nCREATE TRIGGER refresh_cache BEFORE INSERT ON journal;',
    );
    expect(guardedTriggers(commented.text)).toEqual([]);
    const files = [commented, record('0186', 'Proposed')];
    expect(checkOneWayDoor(files, NONE, 'list.json').problems).toEqual([]);
  });

  it('reads only the header comment lines, before the first code line', () => {
    const text = 'CREATE TABLE t (a int);\n-- late note, Decision 0186\n';
    expect(headerDecisions(text)).toEqual([]);
  });

  it('matches the guarded words case-insensitively in the trigger name', () => {
    expect(
      guardedTriggers('create or replace trigger Rolls_NO_DELETE before delete on r;'),
    ).toEqual(['Rolls_NO_DELETE']);
  });

  it('fails an allow-list entry whose file no longer exists', () => {
    const files = [record('0186', 'Accepted')];
    const result = checkOneWayDoor(files, ALLOW('sql/0099_gone.sql'), 'list.json');
    expect(result.problems).toEqual([
      'list.json lists sql/0099_gone.sql, which no longer exists (remove the entry)',
    ]);
  });

  it('fails an allow-list entry whose file no longer fails the rule', () => {
    const files = [migration('sql/0060_ledger.sql', ['0186']), record('0186', 'Accepted')];
    const result = checkOneWayDoor(files, ALLOW('sql/0060_ledger.sql'), 'list.json');
    expect(result.problems).toEqual([
      'list.json lists sql/0060_ledger.sql, which no longer fails the one-way-door rule (remove the entry)',
    ]);
  });

  it('fails a malformed allow-list and a missing one', () => {
    expect(checkOneWayDoor([], '{not json', 'list.json').problems[0]).toContain(
      'is not valid JSON',
    );
    expect(
      checkOneWayDoor([], '{"exemptions": [{"path": "sql/x.sql"}]}', 'list.json').problems,
    ).toEqual(['list.json entry 0 needs a path, a 4-digit decision and a note (the reason)']);
  });

  it('treats a missing allow-list as no exemptions, so a failing migration still fails', () => {
    const files = [migration('sql/0060_ledger.sql', ['0186']), record('0186', 'Proposed')];
    const result = checkOneWayDoor(files, undefined, 'list.json');
    expect(result.problems).toEqual([
      'sql/0060_ledger.sql (trigger journal_immutable): 0186 A rule -- status: Proposed',
    ]);
  });
});

describe('one-way-door rule on the real repo', () => {
  const files = readRepoFiles();

  it('finds the guarded triggers in sql/0007 and sql/0025 and both pass', () => {
    const triggers = (path: string) =>
      guardedTriggers(files.find((f) => f.path === path)?.text ?? '');
    expect(triggers('sql/0007_journals_append_only.sql').length).toBeGreaterThan(0);
    expect(triggers('sql/0025_admin_flag_and_register_audit.sql').length).toBeGreaterThan(0);
    const problems = checkOneWayDoor(files, realAllowlist()).problems;
    expect(problems.filter((p) => /sql\/0007_|sql\/0025_/.test(p))).toEqual([]);
  });

  it('passes with the allow-list', () => {
    expect(checkOneWayDoor(files, realAllowlist()).problems).toEqual([]);
  });

  it('fails sql/0050 and sql/0051 on decision 0186 when the allow-list is empty', () => {
    const problems = checkOneWayDoor(files, '{"exemptions": []}').problems;
    expect(problems.map((p) => p.split(' ')[0])).toEqual([
      'sql/0050_character_sheet_xp.sql',
      'sql/0051_character_audit.sql',
    ]);
    expect(problems.every((p) => p.includes(': 0186 '))).toBe(true);
  });

  it('reports sql/0050 again when its allow-list entry is removed', () => {
    const list = JSON.parse(realAllowlist()) as { exemptions: { path: string }[] };
    list.exemptions = list.exemptions.filter((e) => e.path !== 'sql/0050_character_sheet_xp.sql');
    const problems = checkOneWayDoor(files, JSON.stringify(list)).problems;
    expect(problems.some((p) => p.startsWith('sql/0050_character_sheet_xp.sql'))).toBe(true);
  });
});
