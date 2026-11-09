import { describe, expect, it } from 'vitest';
import { findPublicPorts, isComposeFile } from './loopback-ports.ts';

describe('isComposeFile', () => {
  it('covers compose files only', () => {
    expect(isComposeFile('compose/phase0.yml')).toBe(true);
    expect(isComposeFile('compose/velocity/velocity.toml')).toBe(false);
    expect(isComposeFile('compose/sub/extra.yml')).toBe(false);
    expect(isComposeFile('docs/compose.yml')).toBe(false);
  });
});

describe('findPublicPorts', () => {
  it('accepts entries that start with the loopback prefix', () => {
    const text = [
      'services:',
      '  postgres:',
      '    ports:',
      '      - "127.0.0.1:5432:5432"',
      '      - 127.0.0.1:4222:4222',
    ].join('\n');
    expect(findPublicPorts('compose/phase0.yml', text)).toEqual([]);
  });

  it('fails a bare port that binds every interface, with its line number', () => {
    const text = ['services:', '  postgres:', '    ports:', '      - "5432:5432"'].join('\n');
    expect(findPublicPorts('compose/phase0.yml', text)).toEqual([
      { path: 'compose/phase0.yml', line: 4, entry: '5432:5432' },
    ]);
  });

  it('fails a non-loopback address and a variable host', () => {
    const text = ['    ports:', '      - "0.0.0.0:25565:25565"', '      - "$HOST:8222:8222"'].join(
      '\n',
    );
    const entries = findPublicPorts('compose/phase0.yml', text).map((f) => f.entry);
    expect(entries).toEqual(['0.0.0.0:25565:25565', '$HOST:8222:8222']);
  });

  it('reads flow sequences on their own line', () => {
    const text = '    ports: ["127.0.0.1:1:1", "5432:5432"]';
    expect(findPublicPorts('compose/phase0.yml', text).map((f) => f.entry)).toEqual(['5432:5432']);
  });

  it('ignores other keys and ends the list at the next key', () => {
    const text = [
      'services:',
      '  paper:',
      '    expose:',
      '      - "25565"',
      '    ports:',
      '      - "127.0.0.1:25575:25575"',
      '    secrets: [rcon]',
      '    environment:',
      '      - "5432:5432"',
    ].join('\n');
    expect(findPublicPorts('compose/phase0.yml', text)).toEqual([]);
  });

  it('handles CRLF line endings and trailing comments', () => {
    const text = '    ports:\r\n      - "5432:5432" # bare\r\n';
    expect(findPublicPorts('compose/phase0.yml', text)).toEqual([
      { path: 'compose/phase0.yml', line: 2, entry: '5432:5432' },
    ]);
  });
});
