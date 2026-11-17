import { describe, expect, it } from 'vitest';
import { verifyRegistry } from './probe-verify.ts';

describe('verifyRegistry', () => {
  it('maps an absent read to absent, with no reason', async () => {
    expect(await verifyRegistry(async () => 'absent')).toEqual({ state: 'absent' });
  });

  it('maps a present read to present, with no reason', async () => {
    expect(await verifyRegistry(async () => 'present')).toEqual({ state: 'present' });
  });

  it('maps a read that rejects to unknown, with its reason', async () => {
    const result = await verifyRegistry(async () => {
      throw new Error('nats: no responders');
    });
    expect(result).toEqual({ state: 'unknown', reason: 'nats: no responders' });
  });

  it('maps a read that throws before it returns a promise to unknown', async () => {
    const result = await verifyRegistry(() => {
      throw new Error('bucket object missing');
    });
    expect(result).toEqual({ state: 'unknown', reason: 'bucket object missing' });
  });

  it('maps a read that never answers to unknown after the bound', async () => {
    const started = Date.now();
    const result = await verifyRegistry(() => new Promise(() => undefined), 30);
    expect(result).toEqual({ state: 'unknown', reason: 'registry verify timed out' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
