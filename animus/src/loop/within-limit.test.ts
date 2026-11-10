import { describe, expect, it } from 'vitest';
import { CycleAborted } from './cycle-await.ts';
import { withinLimit } from './within-limit.ts';

describe('withinLimit', () => {
  it('returns the work as it is when no limit is set', async () => {
    await expect(withinLimit(Promise.resolve('done'), undefined, () => {})).resolves.toBe('done');
  });

  it('returns a result that arrives inside the limit, and does not run onTimeout', async () => {
    let timedOut = false;
    const value = await withinLimit(Promise.resolve(7), 1000, () => {
      timedOut = true;
    });
    expect(value).toBe(7);
    expect(timedOut).toBe(false);
  });

  it('ends the wait after the limit as a memory abort, and runs onTimeout first', async () => {
    const order: string[] = [];
    const never = new Promise<string>(() => {});
    const result = withinLimit(never, 5, () => order.push('timeout'));
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CycleAborted);
    expect((error as CycleAborted).reason).toBe('memory');
    expect(order).toEqual(['timeout']);
  });

  it('drops a late failure of the work, so it never reaches the caller', async () => {
    let fail: (reason: Error) => void = () => {};
    const late = new Promise<string>((_, reject) => {
      fail = reject;
    });
    await expect(withinLimit(late, 5, () => {})).rejects.toBeInstanceOf(CycleAborted);
    fail(new Error('the query failed after the caller gave up'));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
