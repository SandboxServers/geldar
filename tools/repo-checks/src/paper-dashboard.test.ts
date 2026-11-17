// PT-17a: the Paper dashboard for the SigNoz import (deploy/signoz/paper-dashboard.json). Every metric it reads must be a
// frozen Ledger name, and no panel may split by a per-player key (S7, 0350 point 1).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DASHBOARD = `${ROOT}deploy/signoz/paper-dashboard.json`;

/** The frozen metric names of paper-plugin/README.md section 4, copied here on purpose: a rename there fails this test. */
const FROZEN_METRICS = new Set([
  'geldar_tick_lag_ms',
  'geldar_tick_overruns_total',
  'geldar_tick_stalls_total',
  'geldar_tps',
  'geldar_tick_rate_target',
  'geldar_tick_frozen',
  'geldar_spark_tps',
  'geldar_spark_mspt_ms',
  'geldar_spark_cpu_ratio',
  'geldar_spark_gc_ms',
  'geldar_world_loaded_chunks',
  'geldar_world_entities',
  'geldar_world_players',
  'geldar_players_online',
  'geldar_operators_count',
  'geldar_plugins_enabled',
  'geldar_scheduler_pending_tasks',
  'geldar_event_count_total',
  'geldar_event_duty_ratio',
  'geldar_paper_collector_disabled',
  'geldar_ledger_collector_time_us',
  'geldar_ledger_dropped_total',
  'geldar_ledger_queue_depth',
  'geldar_jfr_thread_group_cpu_ratio',
  'geldar_jfr_safepoint_ms',
  'geldar_jfr_monitor_contention_total',
  'geldar_jfr_file_io_ms',
  'geldar_jfr_exceptions_total',
  'geldar_container_cpu_periods_total',
  'geldar_container_cpu_throttled_periods_total',
  'geldar_container_cpu_throttled_seconds_total',
  'geldar_container_memory_bytes',
  'geldar_container_memory_limit_bytes',
  'geldar_disk_bytes',
  'geldar_bridge_chunky_running',
  'geldar_bridge_coreprotect_queue',
  'geldar_bridge_bluemap_enabled',
]);

/** Per-player attribute keys: a panel that groups or filters by one breaks S7. */
const PER_PLAYER_KEYS = ['geldar.life_id', 'minecraft.player.uuid', 'geldar.mc_session'];

/** The panels the card lists; each must read at least these metrics. */
const REQUIRED_PANELS: Record<string, string[]> = {
  'Tick time p50, p95, p99': ['geldar_tick_lag_ms'],
  'TPS by window': ['geldar_tps'],
  'Tick overruns and stalls per hour': ['geldar_tick_overruns_total', 'geldar_tick_stalls_total'],
  'Container CPU throttled-period ratio': [
    'geldar_container_cpu_throttled_periods_total',
    'geldar_container_cpu_periods_total',
  ],
  'Container memory against limit': [
    'geldar_container_memory_bytes',
    'geldar_container_memory_limit_bytes',
  ],
  'Loaded chunks per world': ['geldar_world_loaded_chunks'],
  'Entities per world': ['geldar_world_entities'],
  'Players online': ['geldar_players_online'],
  'Census: top 20 event classes by rate': ['geldar_event_count_total'],
  'Plugin drops per queue': ['geldar_ledger_dropped_total'],
  'Collectors disabled': ['geldar_paper_collector_disabled'],
  'JFR thread-group CPU': ['geldar_jfr_thread_group_cpu_ratio'],
  'Disk bytes per area': ['geldar_disk_bytes'],
};

interface QueryData {
  dataSource: string;
  queryName: string;
  aggregateAttribute?: { key?: string };
  groupBy?: { key?: string }[];
  filters?: { items?: { key?: { key?: string } }[] };
  limit?: number | null;
}
interface Widget {
  id: string;
  title: string;
  panelTypes: string;
  query: { builder: { queryData: QueryData[]; queryFormulas: { expression: string }[] } };
}
interface Dashboard {
  title: string;
  layout: { i: string }[];
  widgets: Widget[];
}

/** Every problem found in a dashboard; an empty list means it passes. */
function problems(dash: Dashboard): string[] {
  const found: string[] = [];
  const text = JSON.stringify(dash);
  for (const key of PER_PLAYER_KEYS) {
    if (text.includes(key)) found.push(`per-player key ${key} appears in the dashboard`);
  }
  const ids = new Set<string>();
  for (const w of dash.widgets) {
    if (ids.has(w.id)) found.push(`duplicate widget id ${w.id}`);
    ids.add(w.id);
    const queries = w.query.builder.queryData;
    if (queries.length === 0) found.push(`${w.title}: no query`);
    for (const q of queries) {
      const metric = q.aggregateAttribute?.key;
      if (q.dataSource === 'metrics' && !(metric && FROZEN_METRICS.has(metric))) {
        found.push(`${w.title}: metric ${metric} is not a frozen name`);
      }
    }
    // A formula may only name queries of its own panel.
    const names = new Set([...queries.map((q) => q.queryName)]);
    for (const f of w.query.builder.queryFormulas) {
      for (const ref of f.expression.match(/[A-Z]\w*/g) ?? []) {
        if (!names.has(ref))
          found.push(`${w.title}: formula ${f.expression} names unknown query ${ref}`);
      }
    }
  }
  for (const l of dash.layout) {
    if (!ids.has(l.i)) found.push(`layout entry ${l.i} has no widget`);
  }
  for (const w of dash.widgets) {
    if (!dash.layout.some((l) => l.i === w.id)) found.push(`widget ${w.id} has no layout entry`);
  }
  return found;
}

const raw = readFileSync(DASHBOARD, 'utf8');
const dashboard = JSON.parse(raw) as Dashboard;

describe('Paper dashboard JSON (PT-17a)', () => {
  it('parses, is LF only and has no panels without a query', () => {
    expect(raw).not.toContain('\r');
    expect(dashboard.title).toBe('Geldar Paper');
    expect(dashboard.widgets.length).toBeGreaterThan(0);
  });

  it('reads only frozen metric names and has consistent layout and formulas', () => {
    expect(problems(dashboard)).toEqual([]);
  });

  it('has every panel the card lists, reading the metrics it names', () => {
    for (const [title, metrics] of Object.entries(REQUIRED_PANELS)) {
      const w = dashboard.widgets.find((x) => x.title === title);
      expect(w, `panel ${title}`).toBeDefined();
      const read = (w?.query.builder.queryData ?? []).map((q) => q.aggregateAttribute?.key);
      for (const m of metrics) expect(read, `${title} reads ${m}`).toContain(m);
    }
  });

  it('shows three TPS windows, p50 p95 p99 tick time and a top-20 census (shape of the card)', () => {
    const tps = dashboard.widgets.find((x) => x.title === 'TPS by window');
    expect(tps?.query.builder.queryData[0]?.groupBy?.map((g) => g.key)).toEqual(['window']);
    const tick = dashboard.widgets.find((x) => x.title === 'Tick time p50, p95, p99');
    expect(tick?.query.builder.queryData).toHaveLength(3);
    const census = dashboard.widgets.find((x) => x.title.startsWith('Census'));
    expect(census?.query.builder.queryData[0]?.limit).toBe(20);
  });

  it('computes the throttled ratio from the two counters', () => {
    const w = dashboard.widgets.find((x) => x.title === 'Container CPU throttled-period ratio');
    expect(w?.query.builder.queryFormulas.map((f) => f.expression)).toEqual(['A/B']);
  });

  it('the checker catches a bad dashboard (so the checks above can fail)', () => {
    const bad = structuredClone(dashboard);
    const first = bad.widgets[0];
    if (!first) throw new Error('no widget');
    first.query.builder.queryData.push({
      dataSource: 'metrics',
      queryName: 'Z',
      aggregateAttribute: { key: 'geldar_not_a_frozen_metric' },
      groupBy: [{ key: 'geldar.life_id' }],
    });
    const found = problems(bad);
    expect(found.some((p) => p.includes('geldar_not_a_frozen_metric'))).toBe(true);
    expect(found.some((p) => p.includes('geldar.life_id'))).toBe(true);
    const orphan = structuredClone(dashboard);
    orphan.layout.push({ i: 'ghost' });
    expect(problems(orphan).some((p) => p.includes('ghost'))).toBe(true);
  });
});
