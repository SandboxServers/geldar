import { describe, expect, it } from 'vitest';
import { safeLogLine } from './log.ts';

/** The cause text a log line keeps for one raw cause. */
function causeOf(cause: string): string {
  const out = safeLogLine({ event: 'probe', cause });
  return String(out.cause);
}

describe('safeLogLine cause redaction', () => {
  it('redacts a JSON-style password whose quote sits between name and colon', () => {
    const kept = causeOf('{"password":"hunter2"}');
    expect(kept).not.toContain('hunter2');
    expect(kept).toContain('[redacted]');
  });

  it('redacts a secret_key= value', () => {
    const kept = causeOf('config secret_key=abc123 rejected');
    expect(kept).not.toContain('abc123');
    expect(kept).toContain('[redacted]');
  });

  it('redacts an api_key= value', () => {
    const kept = causeOf('api_key=zz9plural');
    expect(kept).not.toContain('zz9plural');
    expect(kept).toContain('[redacted]');
  });

  it('redacts a whole Authorization header value', () => {
    const kept = causeOf('authorization: Basic dXNlcjpwYXNz');
    expect(kept).not.toContain('dXNlcjpwYXNz');
    expect(kept).not.toContain('Basic');
    expect(kept).toBe('[redacted]');
  });

  it('redacts a whole Cookie header value', () => {
    const kept = causeOf('Cookie: session=abc; theme=dark');
    expect(kept).not.toContain('session');
    expect(kept).not.toContain('abc');
    expect(kept).toBe('[redacted]');
  });

  it('redacts the userinfo of a connection string and keeps the scheme and host', () => {
    const kept = causeOf('connect postgres://geldar_mcp:hunter2@db/x failed');
    expect(kept).not.toContain('geldar_mcp');
    expect(kept).not.toContain('hunter2');
    expect(kept).toBe('connect postgres://[redacted]@db/x failed');
  });

  it('keeps a plain cause unchanged', () => {
    expect(causeOf('connection refused')).toBe('connection refused');
  });

  it('cuts a long cause to 200 characters after redaction', () => {
    const kept = causeOf('word '.repeat(100));
    expect(kept.length).toBe(200);
    expect(kept.startsWith('word word')).toBe(true);
  });

  it('redacts a secret that straddles the 200-character cut before cutting', () => {
    const kept = causeOf(`${' '.repeat(190)}password=hunter2`);
    expect(kept).not.toContain('hunter');
    expect(kept).not.toContain('password');
    expect(kept.length).toBe(200);
    expect(kept.endsWith('[redacted]')).toBe(true);
  });

  it('keeps only the first line of a multi-line cause', () => {
    const kept = causeOf('first line here\nsecret=abc on the second line');
    expect(kept).toBe('first line here');
  });
});
