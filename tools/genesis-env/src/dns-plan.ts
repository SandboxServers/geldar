/**
 * Prints the DNS plan for one environment (G2-06): the names to create, update or leave alone, then the
 * `az network dns record-set a` lines that would make the zone match. It prints only and never runs `az`.
 *
 *   node tools/genesis-env/src/dns-plan.ts --env envs/<name>.yaml --snapshot <record-sets.json> \
 *     --zone <zone> --resource-group <group> --address <ipv4>
 *
 * The snapshot is the JSON array from `az network dns record-set a list --zone-name <zone> -g <group> -o json`.
 * Exit 0 for a plan, 1 for an invalid definition, snapshot or refused record, 2 for bad arguments.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import {
  azureCommands,
  DEFAULT_DNS_TTL_SECONDS,
  definitionRecordNames,
  planDnsDiff,
  type SnapshotRecord,
} from './dns-diff.ts';
import { validateEnvironment } from './validate.ts';

const USAGE =
  'usage: dns-plan.ts --env <envs/name.yaml> --snapshot <json> --zone <zone> --resource-group <group> --address <ipv4>';

interface Definition {
  name: string;
  hostnames: string[];
  mcp_public_host?: string;
  dns_ttl_seconds?: number;
}

/** The parsed options, or null after printing why the arguments are bad (an unknown option, for one). */
function readOptions(): Record<string, string | undefined> | null {
  try {
    return parseArgs({
      options: {
        env: { type: 'string' },
        snapshot: { type: 'string' },
        zone: { type: 'string' },
        'resource-group': { type: 'string' },
        address: { type: 'string' },
      },
      strict: true,
    }).values;
  } catch (error) {
    console.log(`error: ${(error as Error).message}`);
    return null;
  }
}

function main(): number {
  const values = readOptions();
  const {
    env,
    snapshot,
    zone,
    'resource-group': group,
    address,
  } = values ?? ({} as Record<string, string | undefined>);
  if (!values || !env || !snapshot || !zone || !group || !address) {
    console.log(USAGE);
    return 2;
  }

  try {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const schema = JSON.parse(
      readFileSync(join(root, 'envs', 'environment.schema.json'), 'utf8'),
    ) as object;
    const text = readFileSync(env, 'utf8');
    const problems = validateEnvironment(text, env, schema);
    if (problems.length > 0) {
      for (const problem of problems) console.log(`error: ${problem}`);
      return 1;
    }

    const definition = parse(text) as Definition;
    const names = definitionRecordNames(definition);
    const records = JSON.parse(readFileSync(snapshot, 'utf8')) as SnapshotRecord[];
    const ttl = definition.dns_ttl_seconds ?? DEFAULT_DNS_TTL_SECONDS;
    const diff = planDnsDiff({
      zone,
      environmentNames: names,
      requested: names,
      ttl,
      address,
      snapshot: records,
    });
    const commands = azureCommands(diff, group);
    console.log(
      `dns plan for ${definition.name} in zone ${diff.zone} (ttl ${ttl}s): ` +
        `${diff.create.length} create, ${diff.update.length} update, ${diff.none.length} none`,
    );
    for (const change of diff.create) console.log(`create ${change.fqdn}`);
    for (const change of diff.update) console.log(`update ${change.fqdn}`);
    for (const fqdn of diff.none) console.log(`none ${fqdn}`);
    console.log('commands (printed only, not run):');
    for (const line of commands) console.log(line);
    return 0;
  } catch (error) {
    console.log(`error: ${(error as Error).message}`);
    return 1;
  }
}

process.exitCode = main();
