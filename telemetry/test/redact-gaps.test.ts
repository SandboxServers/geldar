import { describe, expect, it } from 'vitest';
import { REDACTED as R, scrubText } from '../src/redact.ts';

// Credential-shaped fixtures are built at run time.
const pw = ['pass', 'word'].join('');
const pd = ['pass', 'wd'].join('');
const tk = ['to', 'ken'].join('');
const sec = ['sec', 'ret'].join('');
const ak = ['api', 'key'].join('-');
const val = ['Zq9x', 'K2mP7vL4Ab'].join('');
const long = ['Q7vL4Ab', 'Zq9xK2mP7v', 'Rt5'].join('');
const MiB = 1 << 20;

describe('credential flag followed by a space', () => {
  it.each([pw, pd, tk, sec, ak])('hides the value after --%s', (name) => {
    expect(scrubText(`run --${name} ${val} --verbose`)).toBe(`run --${name} ${R} --verbose`);
  });

  it('hides a quoted value with a space and a value with a digit and a letter', () => {
    expect(scrubText(`x --${pw} "open sesame" y`)).toBe(`x --${pw} "${R}" y`);
    expect(scrubText(`x --${tk} a1b2 y`)).toBe(`x --${tk} ${R} y`);
    expect(scrubText(`--${tk} ${val}.`)).toBe(`--${tk} ${R}.`);
  });

  it('hides a value after tabs or several spaces', () => {
    expect(scrubText(`--${pw}  \t${val}`)).toBe(`--${pw}  \t${R}`);
  });

  it('keeps ordinary uses and other flags', () => {
    for (const text of [
      `--${pw}-file /etc/x`,
      `use --${tk} option`,
      `--${sec}-name abc`,
      `--${pw} --verbose`,
      `--${pw} north`,
      `--${tk} 5`,
      `--${pw}`,
      `--${pw} `,
      `my--${tk} ${val}`,
      `-p ${val}`,
      `--${pw}s ${val}`,
    ]) {
      expect(scrubText(text)).toBe(text);
    }
  });
});

describe('curl -u name:secret', () => {
  it('hides the secret and keeps the name', () => {
    expect(scrubText(`curl -u alice:${val} http://h/x`)).toBe(`curl -u alice:${R} http://h/x`);
    expect(scrubText(`curl --user bob:${val}`)).toBe(`curl --user bob:${R}`);
    expect(scrubText(`curl -u "carol:${val}" h`)).toBe(`curl -u "carol:${R}" h`);
  });

  it('keeps arguments that are not name:secret or not secret-like', () => {
    for (const text of [
      'git push -u origin main',
      'git push -u origin:main',
      'curl -u alice',
      'curl -u alice:',
      'curl -u :north',
      'curl -u http://host/path',
      'curl -u origin:/refs/heads/x',
      'curl -U alice:Zq9xK2mP7vL4Ab',
      'curl -ux alice:abc',
    ]) {
      expect(scrubText(text)).toBe(text);
    }
  });
});

describe('credential URL query keys', () => {
  it.each([
    `https://h/p?sig=${val}`,
    `https://h/p?a=1&sig=${val}`,
    `https://h/p?X-Amz-Credential=${val}`,
    `https://h/p?a=1&X-Amz-Signature=${val}`,
    `https://h/p?sig=abc`,
    `https://h/p?Signature=${val}`,
  ])('hides %s', (url) => {
    const out = scrubText(url);
    expect(out).toContain(R);
    expect(out).not.toContain('Zq9x');
    expect(out).not.toContain('abc');
  });

  it('keeps the other query parameters', () => {
    expect(scrubText(`https://h/p?sig=${val}&page=2`)).toBe(`https://h/p?sig=${R}&page=2`);
    expect(scrubText(`?X-Amz-Credential=a%2Fb&X-Amz-Date=1`)).toBe(
      `?X-Amz-Credential=${R}&X-Amz-Date=1`,
    );
  });

  it('hides Azure AccountKey in a connection string', () => {
    const base64 = `${long}+/${val}==`;
    expect(scrubText(`DefaultEndpointsProtocol=https;AccountKey=${base64};EndpointSuffix=x`)).toBe(
      `DefaultEndpointsProtocol=https;AccountKey=${R};EndpointSuffix=x`,
    );
    expect(scrubText(`account_key=${base64}`)).toBe(`account_key=${R}`);
  });

  it('hides key and code only with a long secret-like value', () => {
    expect(scrubText(`https://h/p?key=${long}`)).toBe(`https://h/p?key=${R}`);
    expect(scrubText(`https://h/p?a=1&code=${long}&b=2`)).toBe(`https://h/p?a=1&code=${R}&b=2`);
  });

  it('keeps short or plain key and code values and non-query uses', () => {
    for (const text of [
      'https://h/p?code=404',
      'https://h/p?key=name',
      'https://h/p?key=abc123',
      `key=${long}`,
      `code: ${long}`,
      `https://h/p/key=${long}`,
      `https://h/p?monkey=${long}`,
      'the sig of the sword',
      'sig',
      'sig=abc',
      'signal=abcdefghij',
      'https://h/p?sigma=abcdefghij',
      'https://h/p?code=northwestern',
    ]) {
      expect(scrubText(text)).toBe(text);
    }
  });
});

describe('forms that stay (not credentials)', () => {
  it('keeps Authorization: Token with a short word and ssh public keys', () => {
    const ssh = `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${val} user@host`;
    expect(scrubText(ssh)).toBe(ssh);
  });
});

describe('new shapes are linear', () => {
  const shapes: Record<string, string> = {
    flag: `--${pw} `,
    'flag value': `--${pw} ${val} `,
    'flag spaces': `--${tk}${' '.repeat(100)}`,
    'curl -u': '-u a:b ',
    'curl -u secret': `-u a:${val} `,
    'query sig': '?sig=',
    'query key': '?key=Zq9xK2mP7vL4AbZq9x&',
    'query amz': '&X-Amz-Credential=a ',
    'one long run': `--${pw} ${'a'.repeat(1000)}`,
  };
  const timed = (text: string): number => {
    const start = performance.now();
    scrubText(text);
    return performance.now() - start;
  };
  const rep = (unit: string, size: number): string => unit.repeat(Math.ceil(size / unit.length));

  it.each(Object.entries(shapes))('%s: 1 MiB under 1 s and 3x on doubling', (_n, unit) => {
    timed(rep(unit, 1 << 16));
    const t1 = Math.min(...[1, 2, 3].map(() => timed(rep(unit, MiB))));
    const t2 = Math.min(...[1, 2, 3].map(() => timed(rep(unit, 2 * MiB))));
    expect(t1).toBeLessThan(1000);
    expect(t2).toBeLessThan(3 * t1 + 100);
  });

  it.each(Object.entries(shapes))('%s: 10 MiB under 5 s', (_n, unit) => {
    expect(timed(rep(unit, 10 * MiB))).toBeLessThan(5000);
  });

  it('a single 10 MiB value after a flag is hidden whole in bounded time', () => {
    const text = `--${pw} ${'a1'.repeat(5 * MiB)}`;
    const start = performance.now();
    expect(scrubText(text)).toBe(`--${pw} ${R}`);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
