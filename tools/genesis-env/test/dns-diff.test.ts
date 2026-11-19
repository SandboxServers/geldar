import { describe, expect, it } from 'vitest';
import {
  azureCommands,
  definitionRecordNames,
  planDnsDiff,
  relativeName,
  type SnapshotRecord,
} from '../src/dns-diff.ts';

const ZONE = 'example.test';
const RG = 'rg-geldar-dns';
const ADDRESS = '192.0.2.10';
const NAMES = ['glass.example.test', 'map.example.test'];

function input(
  snapshot: SnapshotRecord[],
  overrides: Partial<Parameters<typeof planDnsDiff>[0]> = {},
) {
  return {
    zone: ZONE,
    environmentNames: NAMES,
    requested: NAMES,
    ttl: 300,
    address: ADDRESS,
    snapshot,
    ...overrides,
  };
}

const recordAt = (name: string, ttl: number, ...ips: string[]): SnapshotRecord => ({
  name,
  ttl,
  aRecords: ips.map((ipv4Address) => ({ ipv4Address })),
});

describe('planDnsDiff', () => {
  it('reports no change and no commands when the zone already matches', () => {
    const snapshot = [recordAt('glass', 300, ADDRESS), recordAt('map', 300, ADDRESS)];
    const diff = planDnsDiff(input(snapshot));
    expect(diff.none).toEqual(NAMES);
    expect(diff.create).toEqual([]);
    expect(diff.update).toEqual([]);
    expect(azureCommands(diff, RG)).toEqual([]);
  });

  it('plans one create for a name the zone lacks, with its record set and address', () => {
    const snapshot = [recordAt('glass', 300, ADDRESS)];
    const diff = planDnsDiff(input(snapshot));
    expect(diff.none).toEqual(['glass.example.test']);
    expect(diff.create).toEqual([
      { fqdn: 'map.example.test', relativeName: 'map', ttl: 300, addresses: [ADDRESS] },
    ]);
    expect(diff.update).toEqual([]);
    expect(azureCommands(diff, RG)).toEqual([
      `az network dns record-set a create --resource-group ${RG} --zone-name ${ZONE} --name map --ttl 300`,
      `az network dns record-set a add-record --resource-group ${RG} --zone-name ${ZONE} --record-set-name map --ipv4-address ${ADDRESS}`,
    ]);
  });

  it('plans one update when the TTL differs and prints only the TTL change', () => {
    const snapshot = [recordAt('glass', 3600, ADDRESS), recordAt('map', 300, ADDRESS)];
    const diff = planDnsDiff(input(snapshot));
    expect(diff.create).toEqual([]);
    expect(diff.update).toHaveLength(1);
    expect(diff.update[0]).toMatchObject({
      fqdn: 'glass.example.test',
      ttl: 300,
      current: { ttl: 3600, addresses: [ADDRESS] },
    });
    expect(azureCommands(diff, RG)).toEqual([
      `az network dns record-set a update --resource-group ${RG} --zone-name ${ZONE} --name glass --ttl 300`,
    ]);
  });

  it('plans an address swap as add then remove, keeping the record set', () => {
    const snapshot = [recordAt('glass', 300, '192.0.2.99'), recordAt('map', 300, ADDRESS)];
    const diff = planDnsDiff(input(snapshot));
    expect(diff.update).toHaveLength(1);
    expect(azureCommands(diff, RG)).toEqual([
      `az network dns record-set a add-record --resource-group ${RG} --zone-name ${ZONE} --record-set-name glass --ipv4-address ${ADDRESS}`,
      `az network dns record-set a remove-record --resource-group ${RG} --zone-name ${ZONE} --record-set-name glass --ipv4-address 192.0.2.99 --keep-empty-record-set`,
    ]);
  });

  it('refuses a record outside the zone and writes nothing', () => {
    expect(() => planDnsDiff(input([], { requested: [...NAMES, 'glass.other.test'] }))).toThrow(
      /glass\.other\.test: outside zone example\.test/,
    );
  });

  it('refuses a record inside the zone that the environment does not own', () => {
    expect(() => planDnsDiff(input([], { requested: ['admin.example.test'] }))).toThrow(
      /admin\.example\.test: not a record name of this environment/,
    );
  });

  it('treats a repeated request, in another case or with a trailing dot, as one change', () => {
    const diff = planDnsDiff(
      input([], { requested: ['GLASS.example.test.', 'glass.example.test'] }),
    );
    expect(diff.create).toHaveLength(1);
    expect(azureCommands(diff, RG).filter((line) => line.includes('--name glass'))).toHaveLength(1);
  });

  it('a second run on the snapshot the first run left yields zero writes', () => {
    const first = planDnsDiff(input([]));
    const after = NAMES.map((fqdn) => recordAt(relativeName(fqdn, ZONE), 300, ADDRESS));
    const second = planDnsDiff(input(after));
    expect(second.create).toEqual([]);
    expect(second.update).toEqual([]);
    expect(azureCommands(second, RG)).toEqual([]);
    expect(first.create).toHaveLength(2);
  });

  it('rejects a TTL outside 30..3600 and a malformed address', () => {
    expect(() => planDnsDiff(input([], { ttl: 10 }))).toThrow(/ttl 10/);
    expect(() => planDnsDiff(input([], { ttl: 7200 }))).toThrow(/ttl 7200/);
    expect(() => planDnsDiff(input([], { address: '192.0.2.300' }))).toThrow(/IPv4/);
    expect(() => planDnsDiff(input([], { address: '192.0.2.1; x' }))).toThrow(/IPv4/);
  });

  it('refuses a snapshot record whose TTL is not a number, or missing', () => {
    const textTtl = [{ name: 'glass', ttl: '300', aRecords: [] }] as unknown as SnapshotRecord[];
    expect(() => planDnsDiff(input(textTtl))).toThrow(/glass has no numeric ttl/);
    const noTtl = [{ name: 'glass', aRecords: [] }] as unknown as SnapshotRecord[];
    expect(() => planDnsDiff(input(noTtl))).toThrow(/glass has no numeric ttl/);
  });

  it('refuses a snapshot A record whose address is not IPv4', () => {
    const snapshot = [recordAt('glass', 300, '192.0.2.1; x')];
    expect(() => planDnsDiff(input(snapshot))).toThrow(/glass has a non-IPv4 address/);
  });

  it('refuses a snapshot that is not a list of record sets', () => {
    expect(() => planDnsDiff(input({} as unknown as SnapshotRecord[]))).toThrow(/not an array/);
  });
});

describe('azureCommands', () => {
  it('refuses a resource group with characters that are not plain names', () => {
    const diff = planDnsDiff(input([]));
    expect(() => azureCommands(diff, 'rg(x)')).toThrow(/resource group name is not valid/);
    expect(() => azureCommands(diff, 'rg; rm -rf x')).toThrow(/resource group name is not valid/);
  });
});

describe('definitionRecordNames', () => {
  it('takes the hostnames and the MCP host, lower-cased and de-duplicated', () => {
    expect(
      definitionRecordNames({
        hostnames: ['Glass.example.test', 'map.example.test'],
        mcp_public_host: 'map.example.test.',
      }),
    ).toEqual(['glass.example.test', 'map.example.test']);
  });
});

describe('relativeName', () => {
  it('returns the zone-relative label and "@" for the apex', () => {
    expect(relativeName('glass.example.test', ZONE)).toBe('glass');
    expect(relativeName('a.b.example.test', ZONE)).toBe('a.b');
    expect(relativeName('example.test', ZONE)).toBe('@');
  });
});
