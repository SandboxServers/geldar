import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { type AnimusConfig, type LoadOptions, parseAnimusConfig, repoRoot } from './config.ts';

// biome-ignore lint/suspicious/noExplicitAny: the tests edit arbitrary nested keys of the parsed YAML
type Doc = any;

/**
 * The Phase 0 shard file with the life pinned to the committed strong life. `adam select` rewrites
 * mind.agent.username, mind.agent.tier and mind.run_tier in the working tree, so a test that reads
 * them from the live file fails on a run tree. Every other key is read from the live file.
 */
export function committedShardDoc(): Doc {
  const doc: Doc = parse(readFileSync(join(repoRoot(), 'shards', 'phase0.yaml'), 'utf8'));
  doc.mind.agent.username = doc.mind.lives.strong;
  doc.mind.agent.tier = 'strong';
  doc.mind.run_tier = 'strong';
  return doc;
}

/** The configuration of the committed strong life: loadAnimusConfig with the select keys pinned. */
export async function loadCommittedConfig(options: LoadOptions = {}): Promise<AnimusConfig> {
  return parseAnimusConfig(committedShardDoc(), options);
}
