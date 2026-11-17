// PT-17b: the Paper alert rules (deploy/signoz/paper-alerts-*.json). Definitions only: nothing is imported into SigNoz here.
// Every metric must be a frozen Ledger name (or a named agent metric), kinds must match the aggregation, thresholds are the
// card's numbers, and no channel secret, URL or address may appear. The frozen maps below are copied on purpose from
// paper-dashboard.test.ts (source: paper-plugin/README.md section 4); a rename there must be mirrored here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FILES = ['paper-alerts-server.json', 'paper-alerts-capacity.json'].map(
  (n) => `${ROOT}deploy/signoz/${n}`,
);

type Kind = 'counter' | 'gauge' | 'histogram' | 'monotonic-gauge';

/** Frozen Ledger metrics the alerts may read (README section 4), with their kinds. */
const KINDS: Record<string, Kind> = {
  geldar_tps: 'gauge',
  geldar_spark_mspt_ms: 'gauge',
  geldar_operators_count: 'gauge',
  geldar_ledger_dropped_total: 'counter',
  geldar_paper_collector_disabled: 'gauge',
  geldar_container_cpu_periods_total: 'monotonic-gauge',
  geldar_container_cpu_throttled_periods_total: 'monotonic-gauge',
  geldar_container_memory_bytes: 'gauge',
  geldar_container_memory_limit_bytes: 'gauge',
  // Agent metrics (README: "GC and heap metrics are the agent's jvm.*"), not Ledger names.
  jvm_memory_used_after_last_gc: 'gauge',
  jvm_memory_limit: 'gauge',
};

/** Bare metric attribute keys (README section 4 list 1). Logs use the event keys below. */
const METRIC_KEYS = new Set(['window', 'stat', 'queue', 'collector']);
const LOG_KEYS = new Set(['body', 'event.name']);

const KIND_RULES: Record<Kind, { type: string; ops: RegExp }> = {
  counter: { type: 'Sum', ops: /^(rate|increase)$/ },
  'monotonic-gauge': { type: 'Gauge', ops: /^(rate|increase)$/ },
  gauge: { type: 'Gauge', ops: /^(avg|latest|last|max|min)$/ },
  histogram: { type: 'Histogram', ops: /^hist_quantile_(50|90|95|99)$/ },
};

/** The card's numbers: op (1 above, 2 below, 3 equal), target, eval window. */
const EXPECTED: Record<string, { op: string; target: number; window: string }> = {
  'Paper TPS low': { op: '2', target: 12, window: '5m0s' },
  'Paper MSPT p95 high': { op: '1', target: 50, window: '5m0s' },
  'Paper container CPU throttled': { op: '1', target: 0.05, window: '10m0s' },
  'Paper JVM heap after GC high': { op: '1', target: 0.85, window: '10m0s' },
  'Paper container memory near limit': { op: '1', target: 0.9, window: '5m0s' },
  'Paper watchdog warning': { op: '1', target: 0, window: '5m0s' },
  'Paper exception events': { op: '1', target: 5, window: '5m0s' },
  'Paper operators present': { op: '1', target: 0, window: '5m0s' },
  'Paper ledger dropping events': { op: '1', target: 0, window: '10m0s' },
  'Paper collector disabled': { op: '3', target: 1, window: '5m0s' },
  'Paper TPS data absent': { op: '2', target: 0, window: '5m0s' },
};

interface Item {
  key?: { key?: string };
}
interface Query {
  queryName: string;
  dataSource?: string;
  aggregateOperator?: string;
  aggregateAttribute?: { key?: string; type?: string };
  groupBy?: { key?: string }[];
  filters?: { items?: Item[] };
  expression?: string;
}
interface Rule {
  alert: string;
  condition: {
    compositeQuery: { builderQueries: Record<string, Query> };
    op: string;
    target: number;
    selectedQueryName: string;
    alertOnAbsent?: boolean;
    absentFor?: number;
  };
  evalWindow: string;
  annotations: { description?: string };
  preferredChannels: string[];
}

function load(): Rule[] {
  return FILES.flatMap((f) => (JSON.parse(readFileSync(f, 'utf8')) as { rules: Rule[] }).rules);
}

/** Every problem found in a rule set; an empty list means it passes. */
function problems(rules: Rule[]): string[] {
  const found: string[] = [];
  const names = new Set<string>();
  for (const r of rules) {
    if (names.has(r.alert)) found.push(`duplicate alert name ${r.alert}`);
    names.add(r.alert);
    const want = EXPECTED[r.alert];
    if (!want) found.push(`${r.alert}: not a rule of the card`);
    else {
      const c = r.condition;
      if (c.op !== want.op || c.target !== want.target || r.evalWindow !== want.window)
        found.push(
          `${r.alert}: threshold ${c.op}/${c.target}/${r.evalWindow} differs from the card`,
        );
    }
    if (!r.annotations.description || !/[.:]/.test(r.annotations.description))
      found.push(`${r.alert}: no runbook description`);
    if (r.preferredChannels.some((c) => !/^geldar-[a-z-]+-channel$/.test(c)))
      found.push(`${r.alert}: channel is not a placeholder name`);
    const queries = Object.values(r.condition.compositeQuery.builderQueries);
    if (!queries.some((q) => q.queryName === r.condition.selectedQueryName))
      found.push(`${r.alert}: selected query missing`);
    for (const q of queries) {
      if (q.expression && !q.dataSource) {
        for (const ref of q.expression.match(/[A-Z]\w*/g) ?? [])
          if (!r.condition.compositeQuery.builderQueries[ref])
            found.push(`${r.alert}: formula names unknown query ${ref}`);
        continue;
      }
      const keys = [
        ...(q.groupBy ?? []).map((g) => g.key),
        ...(q.filters?.items ?? []).map((i) => i.key?.key),
      ];
      const allowed = q.dataSource === 'logs' ? LOG_KEYS : METRIC_KEYS;
      for (const k of keys)
        if (!k || !allowed.has(k)) found.push(`${r.alert}: key ${k} not allowed`);
      if (q.dataSource !== 'metrics') continue;
      const metric = q.aggregateAttribute?.key ?? '';
      const kind = KINDS[metric];
      if (!kind) {
        found.push(`${r.alert}: metric ${metric} is not frozen`);
        continue;
      }
      const rule = KIND_RULES[kind];
      if (q.aggregateAttribute?.type !== rule.type)
        found.push(`${r.alert}: ${metric} is ${kind}, typed ${q.aggregateAttribute?.type}`);
      if (!rule.ops.test(q.aggregateOperator ?? ''))
        found.push(`${r.alert}: ${metric} is ${kind}, operator ${q.aggregateOperator}`);
    }
  }
  for (const n of Object.keys(EXPECTED)) if (!names.has(n)) found.push(`missing alert ${n}`);
  const absent = rules.find((r) => r.alert === 'Paper TPS data absent');
  if (absent && !(absent.condition.alertOnAbsent && absent.condition.absentFor === 5))
    found.push('TPS absence alert does not fire on absence after 5 minutes');
  return found;
}

describe('Paper alert rules (PT-17b)', () => {
  const rules = load();

  it('parses and has the twelve-rule set the card lists, minus the skipped blocked-commands rule', () => {
    expect(rules).toHaveLength(11);
  });

  it('passes every check: names, thresholds, frozen metrics, keys and kinds', () => {
    expect(problems(rules)).toEqual([]);
  });

  it('holds no URL, address, secret or channel target', () => {
    for (const f of FILES) {
      const text = readFileSync(f, 'utf8');
      expect(text).not.toMatch(/https?:\/\/|hooks\.|@[a-z0-9-]+\.|\b\d{1,3}(\.\d{1,3}){3}\b/i);
      expect(text).not.toMatch(/token|secret|password|api[_-]?key|webhook/i);
    }
  });

  it('flags a wrong kind, an unknown metric, a URL and a duplicate name', () => {
    const wrongKind = structuredClone(rules);
    const q = wrongKind[0]?.condition.compositeQuery.builderQueries.A as Query;
    q.aggregateOperator = 'rate';
    expect(problems(wrongKind).join()).toContain('is gauge, operator rate');

    const unknown = structuredClone(rules);
    const u = unknown[0]?.condition.compositeQuery.builderQueries.A as Query;
    (u.aggregateAttribute as { key: string }).key = 'geldar_tps_bogus';
    expect(problems(unknown).join()).toContain('not frozen');

    const dup = structuredClone(rules);
    (dup[1] as Rule).alert = (dup[0] as Rule).alert;
    expect(problems(dup).join()).toContain('duplicate alert name');

    const threshold = structuredClone(rules);
    (threshold[0] as Rule).condition.target = 11;
    expect(problems(threshold).join()).toContain('differs from the card');
  });
});
