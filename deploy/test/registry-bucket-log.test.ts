// The 'Watching bucket' log line of RegistryClient.java must print the bucket's name, not the Bucket object that
// watchWhileConnected receives as a parameter of the same name (#870). A source check: the plugin has no seam for the log.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = fileURLToPath(
  new URL(
    '../../plugin/velocity-identity/src/main/java/dev/geldar/identity/RegistryClient.java',
    import.meta.url,
  ),
);

describe("RegistryClient's 'Watching bucket' log line (#870)", () => {
  const text = readFileSync(SOURCE, 'utf8');
  const line = text.split('\n').find((l) => l.includes('"Watching bucket {}"')) ?? '';

  it('logs the bucket field, not the parameter that shadows it', () => {
    expect(line).toContain('log.info("Watching bucket {}", this.bucket);');
  });

  it('logs no bare bucket argument', () => {
    expect(line).not.toMatch(/"Watching bucket \{\}",\s*bucket\)/);
  });
});
