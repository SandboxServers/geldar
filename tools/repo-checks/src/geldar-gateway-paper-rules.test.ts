// PT-12: the gateway rules for Paper logs (deploy/telemetry/gateway.yaml). The test parses the config and asserts that each rule is present,
// and that the gateway still has no truncation, size cap or sampling (decision 0350: full-text capture, no opt-out).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

type Block = { context: string; statements: string[] };
type Gateway = {
  processors: Record<
    string,
    {
      logs?: { log_record?: string[] };
      log_statements?: Block[];
      trace_statements?: Block[];
      metric_statements?: Block[];
    }
  >;
  service: { pipelines: Record<string, { processors: string[] }> };
};

const gateway = parse(readFileSync(`${ROOT}deploy/telemetry/gateway.yaml`, 'utf8')) as Gateway;
const procs = gateway.processors;
const stmts = (blocks: Block[] | undefined, context: string): string[] =>
  (blocks ?? []).filter((b) => b.context === context).flatMap((b) => b.statements);

const PROCESS_KEYS = [
  'process.command_line',
  'process.command_args',
  'process.environment_variables',
];

describe('PT-12 gateway rules for Paper logs', () => {
  it('drops the RCON thread lines except the geldar.rcon.command audit stream', () => {
    const rules = procs['filter/noise']?.logs?.log_record ?? [];
    const rule = rules.find((r) => r.includes('RCON Client'));
    expect(rule).toBeDefined();
    expect(rule).toContain('(RCON Client|Thread RCON)');
    expect(rule).toContain('attributes["event.name"] != "geldar.rcon.command"');
    expect(rule).not.toContain('Rcon:');
  });

  it('deletes the process command line, args and environment from the resource of logs, traces and metrics', () => {
    const sets = [
      stmts(procs['transform/redact']?.log_statements, 'resource'),
      stmts(procs['transform/redact']?.trace_statements, 'resource'),
      stmts(procs['transform/metric_labels']?.metric_statements, 'resource'),
    ];
    for (const s of sets) {
      for (const key of PROCESS_KEYS) {
        expect(s).toContain(`delete_key(resource.attributes, "${key}")`);
      }
    }
  });

  it('masks IPv4 and IPv6 in string log attribute values with the log body patterns', () => {
    const logCtx = stmts(procs['transform/redact']?.log_statements, 'log');
    const bodyPatterns = logCtx
      .filter((s) => s.startsWith('replace_pattern(log.body, '))
      .map((s) => s.slice('replace_pattern(log.body, '.length));
    const attrPatterns = logCtx
      .filter((s) => s.startsWith('replace_all_patterns(log.attributes, "value", '))
      .map((s) => s.slice('replace_all_patterns(log.attributes, "value", '.length));
    expect(bodyPatterns).toHaveLength(4);
    expect(attrPatterns).toEqual(bodyPatterns);
  });

  it('still deletes credential-looking log attribute keys (password, token, authorization)', () => {
    const del = stmts(procs['transform/redact']?.log_statements, 'log').find((s) =>
      s.startsWith('delete_matching_keys(log.attributes, '),
    );
    expect(del).toBeDefined();
    for (const word of ['passw', 'token', 'authorization']) {
      expect(del).toContain(word);
    }
  });

  it('puts the rules in the logs pipeline, in order: noise filter before redaction', () => {
    const p = gateway.service.pipelines.logs?.processors ?? [];
    expect(p.indexOf('filter/noise')).toBeGreaterThan(-1);
    expect(p.indexOf('transform/redact')).toBeGreaterThan(p.indexOf('filter/noise'));
  });

  it('has no IP literal in any processor rule', () => {
    const text = JSON.stringify(procs);
    expect(text).not.toMatch(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/);
  });

  it('has no truncation, size cap or sampling anywhere (0350 full-text capture)', () => {
    for (const name of Object.keys(procs)) {
      expect(name).not.toMatch(/^(probabilistic_sampler|tail_sampling|logdedup|cumulativetodelta)/);
    }
    const all = JSON.stringify(procs).toLowerCase();
    for (const word of [
      'truncate_all',
      'limit_',
      'sampl',
      'substring(',
      'len(body',
      'len(log.body',
      'size(',
    ]) {
      if (word === 'limit_') {
        // memory_limiter has limit_mib, which bounds the process, not content.
        expect(all.replaceAll('limit_mib', '')).not.toContain(word);
      } else {
        expect(all).not.toContain(word);
      }
    }
  });
});
