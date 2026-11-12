import { afterEach, describe, expect, it } from 'vitest';
import { type Harness, harness } from './fixture.ts';

let h: Harness | undefined;

afterEach(async () => {
  if (h) await new Promise<void>((resolve) => h?.server.close(() => resolve()));
  h = undefined;
});

describe('/register/terms (C7-08)', () => {
  it('serves the terms page marked as a draft, not approved', async () => {
    h = await harness();
    const res = await fetch(`${h.base}/register/terms`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('DRAFT for owner review, not approved, not legal advice');
    expect(body).not.toMatch(/terms (are|have been) approved/i);
  });

  it('links the terms from the sign-up page, with the consent box', async () => {
    h = await harness();
    const body = await (await fetch(`${h.base}/register/`)).text();
    expect(body).toContain('href="/register/terms"');
    expect(body).toContain('name="consent"');
  });
});
