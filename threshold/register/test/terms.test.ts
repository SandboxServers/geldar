import { afterEach, describe, expect, it } from 'vitest';
import { type Harness, harness } from './fixture.ts';

let h: Harness | undefined;

afterEach(async () => {
  if (h) await new Promise<void>((resolve) => h?.server.close(() => resolve()));
  h = undefined;
});

describe('/register/terms (C7-08)', () => {
  it('serves the owner-approved version 1 with its version stamp and contact address', async () => {
    h = await harness();
    const res = await fetch(`${h.base}/register/terms`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Version 1, effective 2026-11-11, approved by the owner');
    expect(body).toContain('abuse@sandboxservers.games');
    expect(body).not.toContain('DRAFT');
    expect(body).not.toContain('<CONTACT ADDRESS>');
  });

  it('links the terms from the sign-up page, with the consent box', async () => {
    h = await harness();
    const body = await (await fetch(`${h.base}/register/`)).text();
    expect(body).toContain('href="/register/terms"');
    expect(body).toContain('name="consent"');
  });
});
