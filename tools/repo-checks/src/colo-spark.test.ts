// spark (C2-07n): the profiler bundled in Paper, configured and operator-only. Paper 26.1.2 build 74 ships spark-paper
// 1.10.152 inside its jar, so there is no jar to pin or hash; the Paper pin is the spark pin.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const colo = parse(readFileSync(`${ROOT}compose/colo.yml`, 'utf8'), { merge: true }) as {
  services: Record<string, Record<string, unknown>>;
};
const paper = colo.services.paper ?? {};
// The config is written by the Paper entrypoint from a quoted heredoc (compose/colo.yml has no spark mount).
const entrypoint = readFileSync(`${ROOT}compose/paper/paper-entrypoint.sh`, 'utf8');
const heredoc =
  /> \/data\/plugins\/spark\/config\.json <<'SPARK_CONFIG'\n([\s\S]*?)\nSPARK_CONFIG\n/.exec(
    entrypoint,
  )?.[1] ?? '{}';
const config = JSON.parse(heredoc) as Record<string, unknown>;

/** Source files that could grant a permission: plugin sources and resources, compose, shard and deploy files. */
function grantSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'build', '.gradle', 'dist'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) grantSources(path, out);
    else if (/\.(ya?ml|java|json|sh|properties|conf|toml)$/.test(name)) out.push(path);
  }
  return out;
}

describe('spark: bundled, configured, operator-only (C2-07n)', () => {
  it('adds no spark jar and no spark mount (spark is bundled in Paper)', () => {
    const volumes = (paper.volumes ?? []) as string[];
    expect(volumes.some((v) => /spark/i.test(v))).toBe(false);
    expect(existsSync(`plugins/spark/spark.lock.json`)).toBe(false);
    expect(entrypoint).toMatch(
      /^chown --reference=\/data .*\/data\/plugins\/spark\/config\.json$/m,
    );
  });

  it('pins the Paper build that bundles spark', () => {
    const env = (paper.environment ?? {}) as Record<string, string>;
    expect(env.VERSION).toBe('26.1.2');
    expect(env.PAPER_BUILD).toBe('74');
  });

  it('runs no background profiler and does not broadcast results to players', () => {
    expect(config.backgroundProfiler).toBe(false);
    expect(config.disableResponseBroadcast).toBe(true);
  });

  it('keeps the spark viewer and bytebin at their defaults: no custom egress target is set', () => {
    expect(Object.keys(config).sort()).toEqual(['backgroundProfiler', 'disableResponseBroadcast']);
  });

  it('gives Paper no operators', () => {
    const env = (paper.environment ?? {}) as Record<string, string>;
    for (const key of ['OPS', 'OPS_FILE', 'OP_PERMISSION_LEVEL', 'ENABLE_OPS']) {
      expect(env[key], key).toBeUndefined();
    }
    expect(existsSync(`${ROOT}compose/paper/ops.json`)).toBe(false);
  });

  it('grants the spark permission to nobody in any plugin, compose or shard file', () => {
    const offenders: string[] = [];
    for (const top of ['plugin', 'plugins', 'compose', 'shards', 'deploy']) {
      for (const file of grantSources(`${ROOT}${top}`)) {
        if (file.endsWith('colo-spark.test.ts')) continue;
        const text = readFileSync(file, 'utf8');
        if (/["']?spark(\.\w+)*["']?\s*:\s*(true|op|default)/i.test(text)) offenders.push(file);
        if (/\bspark\b[^\n]*\b(permission|default:\s*true)/i.test(text)) offenders.push(file);
        if (/permissions?[^\n]*\bspark\b/i.test(text)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
