import { describe, expect, it } from 'vitest';
import { dbUrl } from '../src/db-url.ts';

const files: Record<string, string> = {
  '/u': ' postgres://x@h/db \n',
  '/p': 'p@ss/w:rd\n',
  '/e': '\n',
};
const read = (p: string): string => files[p] ?? '';

describe('dbUrl', () => {
  it('uses the URL file as it is, trimmed', () => {
    expect(dbUrl({ REGISTER_DB_URL_FILE: '/u', REGISTER_DB_PASSWORD_FILE: '/p' }, read)).toBe(
      'postgres://x@h/db',
    );
  });

  it('builds the geldar_register URL from the password file, with the password escaped', () => {
    expect(
      dbUrl(
        { REGISTER_DB_PASSWORD_FILE: '/p', POSTGRES_HOST: 'postgres', POSTGRES_PORT: '5432' },
        read,
      ),
    ).toBe('postgres://geldar_register:p%40ss%2Fw%3Ard@postgres:5432/geldar');
  });

  it('refuses when neither file is named, and when the password file is empty', () => {
    expect(() => dbUrl({}, read)).toThrow('is not set');
    expect(() => dbUrl({ REGISTER_DB_PASSWORD_FILE: '/e' }, read)).toThrow('is empty');
  });
});
