import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STREAM_CONFIG } from './config.ts';

/** Reads a file of the repo relative to this one. */
function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

// The plugin and the sink each create GELDAR_EVENTS if it is missing, so their definitions must
// agree. The plugin is Java, so this reads its source and README as text.
describe('stream definition agrees across the plugin and the sink', () => {
  it('matches the stream the plugin builds in NatsEventPublisher.java', () => {
    const java = read('../../plugin/core/src/main/java/dev/geldar/core/NatsEventPublisher.java');
    expect(java).toContain(`STREAM = "${STREAM_CONFIG.name}"`);
    for (const subject of STREAM_CONFIG.subjects) expect(java).toContain(`.subjects("${subject}")`);
    expect(java).toContain('.storageType(StorageType.File)');
    expect(java).toContain(`.maxAge(Duration.ofDays(${STREAM_CONFIG.retentionDays}))`);
  });

  it('matches the stream described in plugin/README.md', () => {
    const readme = read('../../plugin/README.md');
    expect(readme).toContain(`\`${STREAM_CONFIG.name}\``);
    expect(readme).toContain(`subjects \`${STREAM_CONFIG.subjects[0]}\``);
    expect(readme).toContain(`${STREAM_CONFIG.storage} storage`);
    expect(readme).toContain(`${STREAM_CONFIG.retentionDays}-day retention`);
  });

  it('matches the table in the eventsink README', () => {
    const readme = read('../README.md');
    expect(readme).toContain(`| name | \`${STREAM_CONFIG.name}\` |`);
    expect(readme).toContain(`| subjects | \`${STREAM_CONFIG.subjects[0]}\` |`);
    expect(readme).toContain(`| storage | ${STREAM_CONFIG.storage} |`);
    expect(readme).toContain(`\`max_age\` ${STREAM_CONFIG.retentionDays} days`);
  });
});
