/**
 * The open sign-up runbook (docs/runbooks/open-signup.md) checked against the repo it names. Checks: every REGISTER_*
 * env name the register service sets in compose/colo.yml is in the runbook; every REGISTER_* name the runbook names is
 * set in compose, or is one card C7-03b2 adds; each compose name is filed under the list that matches how compose sets
 * it (the operator's env with a default, or a fixed value); the C7-03b2 allowlist and its pending sentence go once
 * compose sets the names; the runbook holds no UUID or token-like string; and deploy/README.md keeps no "Keep it off
 * until C2-08d" sentence. The inputs come through an injectable reader, so the tests run the same checks on modified
 * copies of compose and the runbook without editing them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const readRepo = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

type Reader = (rel: string) => string;

interface Inputs {
  runbook: string;
  readme: string;
  composeText: string;
}

/** Names the runbook gives ahead of the compose change. Card C7-03b2 adds them: delete this list then. */
const NOT_YET_IN_COMPOSE: readonly string[] = [
  'REGISTER_NATS_URL',
  'REGISTER_NATS_USER',
  'REGISTER_NATS_PASSWORD_FILE',
];

const PENDING_MARKER = 'pending C7-03b2';
const OPERATOR_HEADING = 'Deploy values the operator sets in the node env';
const FIXED_SENTENCE = 'Compose sets these names itself';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TOKEN_LIKE = /[A-Za-z0-9+/_-]{32,}/;
/** A compose value the operator can set: a variable with a default, as in the register service's environment. */
const OPERATOR_DEFAULT = /^\$\{[A-Z0-9_]+:-/;

function loadInputs(read: Reader = readRepo): Inputs {
  return {
    runbook: read('docs/runbooks/open-signup.md'),
    readme: read('deploy/README.md'),
    composeText: read('compose/colo.yml'),
  };
}

/** A reader that serves the repo, except that compose/colo.yml is replaced by the given text. */
function withCompose(composeText: string): Reader {
  return (rel) => (rel === 'compose/colo.yml' ? composeText : readRepo(rel));
}

/** The register service's REGISTER_* environment: name to the raw compose value. */
function registerEnv(composeText: string): Map<string, string> {
  const parsed = parse(composeText) as {
    services?: Record<string, { environment?: Record<string, unknown> }>;
  };
  const env = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed.services?.register?.environment ?? {})) {
    if (key.startsWith('REGISTER_')) env.set(key, String(value));
  }
  return env;
}

/** REGISTER_* names written in backticks. */
function backticked(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/`(REGISTER_[A-Z0-9_]+)`/g)) {
    const name = match[1];
    if (name === undefined) throw new Error('backtick regex lost its capture group');
    names.add(name);
  }
  return [...names].sort();
}

interface Lists {
  operator: string[];
  fixed: string[];
}

/** The operator list (the bullets under the operator heading) and the compose list (the one sentence after them). */
function classify(runbook: string): Lists | null {
  const lines = runbook.split('\n');
  const start = lines.findIndex((line) => line.includes(OPERATOR_HEADING));
  const end = lines.findIndex((line) => line.includes(FIXED_SENTENCE));
  const fixedLine = lines[end];
  if (start < 0 || end <= start || fixedLine === undefined) return null;
  const bullets = lines.slice(start + 1, end).filter((line) => line.startsWith('- '));
  return { operator: backticked(bullets.join('\n')), fixed: backticked(fixedLine) };
}

function namingProblems(inputs: Inputs, notYet: readonly string[]): string[] {
  const out: string[] = [];
  const env = registerEnv(inputs.composeText);
  for (const name of env.keys()) {
    if (!inputs.runbook.includes(`\`${name}\``)) out.push(`runbook must name ${name}`);
  }
  for (const name of backticked(inputs.runbook)) {
    if (!env.has(name) && !notYet.includes(name)) {
      out.push(`runbook names ${name}, which compose does not set`);
    }
  }
  return out;
}

function classificationProblems(inputs: Inputs, notYet: readonly string[]): string[] {
  const lists = classify(inputs.runbook);
  if (!lists) {
    return ['runbook has no operator-heading block or no "Compose sets these names itself" line'];
  }
  const env = registerEnv(inputs.composeText);
  const out: string[] = [];
  for (const name of env.keys()) {
    if (lists.operator.includes(name) === lists.fixed.includes(name)) {
      out.push(`runbook must list ${name} under exactly one of the two lists`);
    }
  }
  for (const name of lists.operator) {
    if (!env.has(name)) {
      if (!notYet.includes(name))
        out.push(`runbook lists ${name} as operator-set; compose does not set it`);
      continue;
    }
    if (!OPERATOR_DEFAULT.test(env.get(name) ?? '')) {
      out.push(
        `runbook says the operator sets ${name}, but compose fixes its value: move it to the compose list`,
      );
    }
  }
  for (const name of lists.fixed) {
    if (!env.has(name)) {
      if (!notYet.includes(name)) out.push(`runbook says compose sets ${name}; compose does not`);
      continue;
    }
    if (OPERATOR_DEFAULT.test(env.get(name) ?? '')) {
      out.push(
        `runbook says compose fixes ${name}, but compose takes it from the operator's env: move it to the operator list`,
      );
    }
  }
  return out;
}

function allowlistProblems(inputs: Inputs, notYet: readonly string[]): string[] {
  const env = registerEnv(inputs.composeText);
  const out: string[] = [];
  const stale = notYet.filter((name) => env.has(name));
  if (stale.length > 0 && (notYet.length > 0 || inputs.runbook.includes(PENDING_MARKER))) {
    out.push(
      `C7-03b2 merged (compose sets ${stale.join(', ')}): remove the allowlist and the pending sentence ` +
        `("${PENDING_MARKER}") in docs/runbooks/open-signup.md`,
    );
  }
  if (notYet.length > 0 && !inputs.runbook.includes(PENDING_MARKER)) {
    out.push(`runbook must carry the "${PENDING_MARKER}" marker while the allowlist is not empty`);
  }
  return out;
}

/** Every problem the runbook has against compose; an empty list means the runbook matches compose. */
function problems(inputs: Inputs, notYet: readonly string[] = NOT_YET_IN_COMPOSE): string[] {
  return [
    ...namingProblems(inputs, notYet),
    ...classificationProblems(inputs, notYet),
    ...allowlistProblems(inputs, notYet),
  ];
}

/** The compose text after C7-03b2 has merged: the three NATS names are fixed values in the register environment. */
function composeAfterC7_03b2(composeText: string): string {
  const anchor = '      REGISTER_SHARD: colo\n';
  if (!composeText.includes(anchor))
    throw new Error('compose anchor for the register environment is missing');
  return composeText.replace(
    anchor,
    `${anchor}      REGISTER_NATS_URL: nats://example.invalid:4222\n` +
      '      REGISTER_NATS_USER: register\n' +
      '      REGISTER_NATS_PASSWORD_FILE: /run/secrets/nats-register.txt\n',
  );
}

/** The runbook as it reads once C7-03b2 has merged and its card has moved the names to the compose list. */
function runbookAfterC7_03b2(runbook: string): string {
  return runbook
    .split('\n')
    .filter((line) => !(line.startsWith('- ') && line.includes('`REGISTER_NATS_URL`')))
    .map((line) =>
      line.includes(FIXED_SENTENCE)
        ? line.replace(
            FIXED_SENTENCE,
            `${FIXED_SENTENCE} (\`REGISTER_NATS_URL\`, \`REGISTER_NATS_USER\` and \`REGISTER_NATS_PASSWORD_FILE\`)`,
          )
        : line,
    )
    .join('\n')
    .split(PENDING_MARKER)
    .join('set by C7-03b2');
}

/** The runbook with REGISTER_KILL_SWITCH moved from the operator list into the compose list (the pass-1 error). */
function killSwitchMisfiled(runbook: string): string {
  return runbook
    .split('\n')
    .filter((line) => !line.startsWith('- `REGISTER_KILL_SWITCH`'))
    .map((line) =>
      line.includes(FIXED_SENTENCE) ? `${line} \`REGISTER_KILL_SWITCH\` is set by compose.` : line,
    )
    .join('\n');
}

describe('open-signup runbook against compose/colo.yml', () => {
  it('reads a non-empty register environment from compose', () => {
    expect(registerEnv(loadInputs().composeText).size).toBeGreaterThan(0);
  });

  it('names every REGISTER_* env name the register service sets', () => {
    const inputs = loadInputs();
    for (const name of registerEnv(inputs.composeText).keys()) {
      expect(inputs.runbook, `runbook must name ${name}`).toContain(`\`${name}\``);
    }
  });

  it('names no REGISTER_* env name that compose does not set (except the C7-03b2 names)', () => {
    const inputs = loadInputs();
    expect(namingProblems(inputs, NOT_YET_IN_COMPOSE)).toEqual([]);
  });

  it('files each compose name under the list that matches how compose sets it', () => {
    expect(classificationProblems(loadInputs(), NOT_YET_IN_COMPOSE)).toEqual([]);
  });

  it('matches compose before C7-03b2 merges (allowlist and pending sentence in place)', () => {
    expect(problems(loadInputs())).toEqual([]);
  });

  it('fails with a clear message when C7-03b2 has merged but the allowlist and pending sentence stay', () => {
    const inputs = loadInputs(withCompose(composeAfterC7_03b2(loadInputs().composeText)));
    const found = problems(inputs);
    expect(found.join('\n')).toContain('remove the allowlist and the pending sentence');
  });

  it('passes once C7-03b2 has merged and the names moved to the compose list', () => {
    const base = loadInputs(withCompose(composeAfterC7_03b2(loadInputs().composeText)));
    const merged: Inputs = { ...base, runbook: runbookAfterC7_03b2(base.runbook) };
    expect(problems(merged, [])).toEqual([]);
  });

  it('fails when REGISTER_KILL_SWITCH (a compose default) is filed under the compose list', () => {
    const base = loadInputs();
    const mutated: Inputs = { ...base, runbook: killSwitchMisfiled(base.runbook) };
    expect(mutated.runbook).not.toBe(base.runbook);
    expect(classificationProblems(mutated, NOT_YET_IN_COMPOSE).join('\n')).toContain(
      'runbook says compose fixes REGISTER_KILL_SWITCH',
    );
  });
});

describe('open-signup runbook content', () => {
  it('holds no UUID', () => {
    expect(loadInputs().runbook.match(UUID)).toBeNull();
  });

  it('holds no token-like string of 32 or more characters', () => {
    expect(loadInputs().runbook.match(TOKEN_LIKE)).toBeNull();
  });
});

describe('deploy/README.md', () => {
  it('does not keep the "Keep it off until C2-08d" sentence', () => {
    expect(loadInputs().readme).not.toContain('Keep it off until C2-08d');
  });
});
