import { describe, expect, it, vi } from 'vitest';
import { normalizeOrigin, parseAllowedOrigins } from './origins.ts';
import { loadKinoEnv } from './wiring.ts';
import { originAllowed } from './ws.ts';

describe('Kino origin allow-list', () => {
  it.each([
    ['https://glass.example.test', 'https://glass.example.test'],
    ['https://glass.example.test/', 'https://glass.example.test'],
    ['https://glass.example.test:443', 'https://glass.example.test'],
    ['http://glass.example.test:80/', 'http://glass.example.test'],
    ['HTTPS://Glass.Example.TEST', 'https://glass.example.test'],
    ['https://glass.example.test:8443', 'https://glass.example.test:8443'],
    [' https://glass.example.test ', 'https://glass.example.test'],
  ])('normalises %s', (entry, want) => {
    expect(normalizeOrigin(entry)).toBe(want);
  });

  it('keeps a non-default port for the other scheme', () => {
    expect(normalizeOrigin('https://glass.example.test:80')).toBe('https://glass.example.test:80');
  });

  it.each([
    'glass.example.test',
    'https://glass.example.test/path',
    'https://*.example.test',
    'https://glass.example.test?x=1',
    'ftp://glass.example.test',
    'https://user@glass.example.test',
    '',
  ])('rejects %s and names the entry', (entry) => {
    expect(normalizeOrigin(entry)).toBeNull();
    expect(() => parseAllowedOrigins(['https://ok.example.test', entry])).toThrow(
      new RegExp(`entry "${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
    );
  });

  it('refuses to start Kino with a host-only entry and normalises the rest', () => {
    vi.stubEnv('GELDAR_KINO_ENABLED', '1');
    vi.stubEnv('GELDAR_SHARD', 'colo');
    vi.stubEnv('GELDAR_KINO_ALLOWED_ORIGINS', 'glass.example.test');
    expect(() => loadKinoEnv()).toThrow(/glass\.example\.test/);
    vi.stubEnv('GELDAR_KINO_ALLOWED_ORIGINS', 'https://Glass.example.test:443/, http://b.test');
    expect(loadKinoEnv().allowedOrigins).toEqual(['https://glass.example.test', 'http://b.test']);
    vi.unstubAllEnvs();
  });

  it('compares the request Origin in the same normal form', () => {
    const allowed = ['https://glass.example.test'];
    expect(originAllowed('https://GLASS.example.test:443', allowed)).toBe(true);
    expect(originAllowed('https://glass.example.test', ['https://glass.example.test/'])).toBe(true);
    expect(originAllowed('https://evil.example.test', allowed)).toBe(false);
    expect(originAllowed('null', ['null'])).toBe(false);
    expect(originAllowed(undefined, allowed)).toBe(true);
  });
});
