import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../config.ts';

/** The released body-api files and their sha256 digests. A released file is never edited (prompts/README.md). */
const RELEASED: Record<string, string> = {
  'v1.json': 'f943151a1af44dbd717239c088f56a157f5b3b1154aac7cb5f70bc19c8c89c2f',
  'v2.json': '8d5d127ee971750f7e8250746b6c55e730b14506d280c0a399a4126b3fb37221',
  'v3.json': 'b6b5c59f9b06c13a6f208b4298acca593665d66aebc9485643003edbdb490584',
  'v4.json': 'a0e982ccd77db46bff5605118e1d3593770cb2ce8603ce2974320b0882619cd6',
  'v5.json': '10762698128a0e081955d0d997c9223971f93e92738666097c59a8079200b476',
  'v6.json': 'f4453645cd36f6047e425c7e555861abbfede63c516cad4219feff8ab7721245',
  'v7.json': '5c6d3eb34167448c73611cefa36d2c84f5f0e92f6ec3f97c23d6b7bf6a093e4c',
  'v8.json': 'f5488b463931140fda83f7653a9c32bb7e324f14741e679d499bb2faa0ea64e7',
  'v9.json': 'abb6488999343c64fe51db3abe715b88291e9960cf7a40273fa7a70e9508d17a',
  'v10.json': 'ece8cdda4d8741637996094670785ad3aae9a5c2600b109d50388a9039df2100',
  'v12.json': 'b25d954d562185a1553cc0505f733badfe3153744e57969b6fd72649d0c05384',
};

const DIR = join(repoRoot(), 'prompts', 'body-api');

describe('prompts/body-api released files are unchanged', () => {
  for (const [name, digest] of Object.entries(RELEASED)) {
    it(`${name} has its pinned sha256`, () => {
      const actual = createHash('sha256')
        .update(readFileSync(join(DIR, name)))
        .digest('hex');
      expect(actual).toBe(digest);
    });
  }

  it('has no v11.json (v11 is never published; v12 follows v10)', () => {
    expect(existsSync(join(DIR, 'v11.json'))).toBe(false);
  });
});
