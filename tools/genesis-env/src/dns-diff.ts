/**
 * The DNS A-record diff for one environment (G2-06). Pure: the caller reads the definition and the
 * record-set snapshot; this module returns what would change and the `az network dns record-set a`
 * lines that would make it so. Nothing here runs `az`.
 */

export const DEFAULT_DNS_TTL_SECONDS = 300;
const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 3600;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
// Only characters that need no quoting in the printed shell lines.
const AZ_NAME = /^[A-Za-z0-9._-]{1,90}$/;

/** One record set as `az network dns record-set a list` prints it. `name` is relative to the zone ("@" is the apex). */
export interface SnapshotRecord {
  name: string;
  ttl: number;
  aRecords?: { ipv4Address: string }[];
}

export interface DnsDiffInput {
  /** The DNS zone, for example `example.test`. */
  zone: string;
  /** Every record name the environment owns, from its definition. */
  environmentNames: readonly string[];
  /** The names this run wants to upsert. Any name outside the zone or outside `environmentNames` is refused. */
  requested: readonly string[];
  ttl: number;
  /** The IPv4 address the environment's records point at. */
  address: string;
  snapshot: readonly SnapshotRecord[];
}

export interface RecordChange {
  fqdn: string;
  relativeName: string;
  ttl: number;
  addresses: string[];
  /** Present only for an update: what the zone holds now. */
  current?: { ttl: number; addresses: string[] };
}

export interface DnsDiff {
  zone: string;
  ttl: number;
  create: RecordChange[];
  update: RecordChange[];
  none: string[];
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '');
}

/** The record names an environment owns: its hostnames and, when set, its MCP host. */
export function definitionRecordNames(definition: {
  hostnames: readonly string[];
  mcp_public_host?: string;
}): string[] {
  const names = [
    ...definition.hostnames,
    ...(definition.mcp_public_host ? [definition.mcp_public_host] : []),
  ];
  return [...new Set(names.map(normalizeName))].sort();
}

/** The zone-relative label `az` uses for a name: "@" for the apex, otherwise the labels before the zone. */
export function relativeName(fqdn: string, zone: string): string {
  const name = normalizeName(fqdn);
  const apex = normalizeName(zone);
  if (name === apex) return '@';
  return name.slice(0, -(apex.length + 1));
}

function sameAddresses(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join(',') === [...b].sort().join(',');
}

function validIpv4(address: unknown): boolean {
  if (typeof address !== 'string') return false;
  const match = IPV4.exec(address);
  if (!match) return false;
  return match.slice(1).every((octet) => Number(octet) <= 255);
}

/** Refuses a snapshot whose shape the diff cannot trust: a list of named record sets, each with a numeric TTL and IPv4 A records. */
function validateSnapshot(snapshot: unknown): void {
  if (!Array.isArray(snapshot)) throw new Error('snapshot is not an array of record sets');
  for (const record of snapshot as Partial<SnapshotRecord>[]) {
    if (typeof record?.name !== 'string') throw new Error('snapshot record has no name');
    if (typeof record.ttl !== 'number' || !Number.isFinite(record.ttl)) {
      throw new Error(`snapshot record ${record.name} has no numeric ttl (parse error)`);
    }
    if (record.aRecords !== undefined && !Array.isArray(record.aRecords)) {
      throw new Error(`snapshot record ${record.name} has aRecords that are not a list`);
    }
    for (const a of record.aRecords ?? []) {
      if (!validIpv4(a?.ipv4Address)) {
        throw new Error(`snapshot record ${record.name} has a non-IPv4 address`);
      }
    }
  }
}

/** Returns the diff for the requested names. Throws, and writes nothing, when any requested name is refused. */
export function planDnsDiff(input: DnsDiffInput): DnsDiff {
  const zone = normalizeName(input.zone);
  if (!HOSTNAME.test(zone)) throw new Error(`zone "${input.zone}" is not a DNS name`);
  if (!Number.isInteger(input.ttl) || input.ttl < MIN_TTL_SECONDS || input.ttl > MAX_TTL_SECONDS) {
    throw new Error(`ttl ${input.ttl} is outside ${MIN_TTL_SECONDS}..${MAX_TTL_SECONDS} seconds`);
  }
  if (!validIpv4(input.address)) throw new Error('address is not an IPv4 address');
  validateSnapshot(input.snapshot);

  const owned = new Set(input.environmentNames.map(normalizeName));
  const refused: string[] = [];
  for (const raw of input.requested) {
    const fqdn = normalizeName(raw);
    if (!fqdn.endsWith(`.${zone}`) && fqdn !== zone) {
      refused.push(`${fqdn}: outside zone ${zone}`);
    } else if (!owned.has(fqdn)) {
      refused.push(`${fqdn}: not a record name of this environment`);
    }
  }
  if (refused.length > 0) throw new Error(`refusing to plan: ${refused.join('; ')}`);

  const diff: DnsDiff = { zone, ttl: input.ttl, create: [], update: [], none: [] };
  const seen = new Set<string>();
  const addresses = [input.address];
  for (const raw of input.requested) {
    const fqdn = normalizeName(raw);
    if (seen.has(fqdn)) continue;
    seen.add(fqdn);
    const label = relativeName(fqdn, zone);
    const current = input.snapshot.find((record) => normalizeName(record.name) === label);
    if (!current) {
      diff.create.push({ fqdn, relativeName: label, ttl: input.ttl, addresses });
      continue;
    }
    const currentAddresses = (current.aRecords ?? []).map((record) => record.ipv4Address);
    if (current.ttl === input.ttl && sameAddresses(currentAddresses, addresses)) {
      diff.none.push(fqdn);
    } else {
      diff.update.push({
        fqdn,
        relativeName: label,
        ttl: input.ttl,
        addresses,
        current: { ttl: current.ttl, addresses: currentAddresses },
      });
    }
  }
  return diff;
}

/**
 * The command lines the plan would run, in order. A create is printed only for a name the zone lacks; an update
 * changes the TTL and adds or removes only the addresses that differ. A plan with no change yields no lines.
 */
export function azureCommands(diff: DnsDiff, resourceGroup: string): string[] {
  if (!AZ_NAME.test(resourceGroup)) throw new Error('resource group name is not valid');
  const common = `--resource-group ${resourceGroup} --zone-name ${diff.zone}`;
  const lines: string[] = [];
  for (const change of diff.create) {
    lines.push(
      `az network dns record-set a create ${common} --name ${change.relativeName} --ttl ${change.ttl}`,
    );
    for (const ip of change.addresses) {
      lines.push(
        `az network dns record-set a add-record ${common} --record-set-name ${change.relativeName} --ipv4-address ${ip}`,
      );
    }
  }
  for (const change of diff.update) {
    const current = change.current ?? { ttl: change.ttl, addresses: [] };
    if (current.ttl !== change.ttl) {
      lines.push(
        `az network dns record-set a update ${common} --name ${change.relativeName} --ttl ${change.ttl}`,
      );
    }
    for (const ip of change.addresses.filter((a) => !current.addresses.includes(a))) {
      lines.push(
        `az network dns record-set a add-record ${common} --record-set-name ${change.relativeName} --ipv4-address ${ip}`,
      );
    }
    for (const ip of current.addresses.filter((a) => !change.addresses.includes(a))) {
      lines.push(
        `az network dns record-set a remove-record ${common} --record-set-name ${change.relativeName} --ipv4-address ${ip} --keep-empty-record-set`,
      );
    }
  }
  return lines;
}
