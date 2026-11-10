import type { Report } from './report.ts';
import type { Measure, Value } from './types.ts';

/** JSON with every object's keys sorted, two-space indent and a trailing newline. Byte-stable. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort())
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

function cell(v: Value | undefined): string {
  if (v === null || v === undefined) return 'null';
  return String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function measureBlock(m: Measure): string[] {
  const lines = [
    `## ${m.title}`,
    '',
    `- Verdict: **${m.verdict}**`,
    `- Window: ${cell(m.window)}`,
    `- Note: ${cell(m.note)}`,
    '',
  ];
  const keys = Object.keys(m.values).sort();
  if (keys.length > 0) {
    lines.push('| Value | Number |', '| --- | --- |');
    for (const k of keys) lines.push(`| ${k} | ${cell(m.values[k])} |`);
    lines.push('');
  }
  return lines;
}

/** The Markdown report. `generatedAt` is the only wall-clock value and sits in the header. */
export function renderMarkdown(report: Report, generatedAt: string): string {
  const head = [
    `# Adam run report: ${report.runId}`,
    '',
    `- Generated at: ${generatedAt}`,
    `- Life: ${report.lifeId}`,
    `- Query window: ${report.window.from} to ${report.window.to} (${report.window.thoughtRows} thought rows)`,
    `- Window length: ${report.window.hours} hours`,
    `- Run: ${report.run.aborted ? 'aborted' : 'not aborted'}, ${report.run.partial ? 'partial (no end line in status.log)' : 'complete'}`,
    `- Git sha: ${report.manifest.gitSha}`,
    `- World seed: ${report.manifest.worldSeed}`,
    `- Shard config hash: ${report.manifest.shardConfigHash}`,
    `- Start: ${report.manifest.startTime}`,
    `- TPS target: ${report.manifest.tpsTarget}`,
    '',
    '## Model tags',
    '',
    ...report.manifest.modelTags.map((m) => `- ${m.tag} (digest ${m.digest})`),
    '',
    '## Restarts',
    '',
    ...(report.manifest.restarts.length === 0
      ? ['- none recorded']
      : report.manifest.restarts.map((r) => `- ${r.at}: ${r.kind}`)),
    '',
    '## Exit criteria',
    '',
    '| Criterion | Verdict |',
    '| --- | --- |',
    ...report.measures.map((m) => `| ${cell(m.title)} | ${m.verdict} |`),
    '',
  ];
  const body = report.measures.flatMap(measureBlock);
  const outcomes = Object.entries(report.outcomes).map(([k, n]) => `| ${k} | ${n} |`);
  const outcomeBlock = [
    '## Outcome histogram',
    '',
    '| Outcome | Count |',
    '| --- | --- |',
    ...outcomes,
    '',
  ];
  return `${[...head, ...body, ...outcomeBlock].join('\n')}\n`;
}
