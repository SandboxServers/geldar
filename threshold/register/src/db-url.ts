import { readFileSync } from 'node:fs';

/**
 * The Postgres connection string. REGISTER_DB_URL_FILE (a whole URL in a file) wins. Otherwise the URL is built from
 * POSTGRES_HOST, POSTGRES_PORT and POSTGRES_DB plus the geldar_register password file REGISTER_DB_PASSWORD_FILE, so a
 * container needs no file that holds a URL (compose/colo.yml mounts the password file only). Fails closed on a missing input.
 */
export function dbUrl(
  env: Readonly<Record<string, string | undefined>>,
  read: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): string {
  const urlFile = env.REGISTER_DB_URL_FILE;
  if (urlFile) return read(urlFile).trim();
  const passwordFile = env.REGISTER_DB_PASSWORD_FILE;
  if (!passwordFile)
    throw new Error('REGISTER_DB_URL_FILE or REGISTER_DB_PASSWORD_FILE is not set');
  const password = read(passwordFile).trim();
  if (password === '') throw new Error('REGISTER_DB_PASSWORD_FILE is empty');
  const host = env.POSTGRES_HOST || '127.0.0.1';
  const port = env.POSTGRES_PORT || '5432';
  const db = env.POSTGRES_DB || 'geldar';
  return `postgres://geldar_register:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}`;
}
