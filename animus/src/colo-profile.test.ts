// Decision 0134: on the Colo the Mind is a compose profile, so the core start never runs it. Reads compose/colo.yml
// as the compose file is written (no docker needed): animus has the `mind` profile and no other service has one that
// the core start would pick up.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './config.ts';

interface ComposeService {
  profiles?: string[];
}

function services(): Record<string, ComposeService> {
  const file = join(repoRoot(), 'compose', 'colo.yml');
  const doc = parse(readFileSync(file, 'utf8'), { merge: true }) as {
    services?: Record<string, ComposeService>;
  };
  return doc.services ?? {};
}

describe('compose/colo.yml profiles (decision 0134)', () => {
  it('puts animus under the mind profile, so `shard up colo` does not start it', () => {
    expect(services().animus?.profiles).toEqual(['mind']);
  });

  it('leaves the core services without a profile, so the core start runs them', () => {
    const core = ['postgres', 'nats', 'paper', 'velocity', 'eventsink', 'golem-body', 'geldar-mcp'];
    for (const name of core) {
      expect(services()[name]?.profiles, name).toBeUndefined();
    }
  });
});
