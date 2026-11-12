import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadAliases as loadGlass } from '../../../glass/src/alias.ts';
import { loadAliases as loadProxy } from '../alias-proxy/alias-proxy.ts';

// One shared fixture through both readers: Glass and the BlueMap proxy must accept the same file.
// If the format of either reader drifts (key form or shape), this fails.
const FIXTURE = fileURLToPath(new URL('./fixtures/aliases.json', import.meta.url));
const EXPECTED = [
  ['ag_test_01', 'TestRanger'],
  ['ag_test_02', 'OtherRanger'],
];

it('Glass and the BlueMap proxy read the shared alias file to the same mapping', () => {
  const glass = loadGlass(FIXTURE, () => {});
  const proxy = loadProxy(FIXTURE);
  expect([...glass].sort()).toEqual(EXPECTED);
  expect(proxy).not.toBeNull();
  expect([...(proxy ?? [])].sort()).toEqual(EXPECTED);
});
