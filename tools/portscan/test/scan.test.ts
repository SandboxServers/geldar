import { describe, expect, it } from 'vitest';
import { type Connector, type Probe, type ScanOptions, scanPorts } from '../src/scan.ts';

// Tests use only a fake connector and a fake clock. No test opens a socket.
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

function baseOptions(
  ports: number[],
  connect: Connector,
  overrides: Partial<ScanOptions> = {},
): ScanOptions {
  return {
    ports,
    connect,
    concurrency: 1,
    perSecond: 1000,
    attempts: 2,
    ...fakeClock(),
    ...overrides,
  };
}

/** A connector that answers from a fixed table; a port missing from the table is closed. */
function table(answers: Record<number, Probe[]>): {
  connect: Connector;
  calls: Map<number, number>;
} {
  const calls = new Map<number, number>();
  const connect: Connector = async (port) => {
    const count = (calls.get(port) ?? 0) + 1;
    calls.set(port, count);
    const script = answers[port] ?? ['closed'];
    return script[Math.min(count, script.length) - 1] ?? 'closed';
  };
  return { connect, calls };
}

describe('scanPorts: which ports come back open', () => {
  it('returns the open ports ascending and leaves out the closed ones', async () => {
    const { connect } = table({ 25570: ['open'], 25565: ['open'] });
    const open = await scanPorts(baseOptions([25570, 25565, 25566], connect, { concurrency: 3 }));
    expect(open).toEqual([25565, 25570]);
  });

  it('returns nothing for a closed range', async () => {
    const { connect } = table({});
    expect(await scanPorts(baseOptions([1, 2, 3], connect))).toEqual([]);
  });

  it('returns nothing for an empty port list and makes no connects', async () => {
    const { connect, calls } = table({});
    expect(await scanPorts(baseOptions([], connect))).toEqual([]);
    expect(calls.size).toBe(0);
  });
});

describe('scanPorts: timeouts are retried, and the last attempt is reported closed', () => {
  it('a port that times out once and then answers open is open', async () => {
    const { connect, calls } = table({ 25565: ['timeout', 'open'] });
    expect(await scanPorts(baseOptions([25565], connect))).toEqual([25565]);
    expect(calls.get(25565)).toBe(2);
  });

  it('a port that times out on the last allowed attempt is reported closed', async () => {
    // attempts: 2, so the second attempt is the last one. Its timeout is closed, and the port makes exactly 2 connects.
    const { connect, calls } = table({ 25565: ['timeout', 'timeout'] });
    expect(await scanPorts(baseOptions([25565], connect, { attempts: 2 }))).toEqual([]);
    expect(calls.get(25565)).toBe(2);
  });

  it('with one attempt, a timeout is closed at once and is not retried', async () => {
    const { connect, calls } = table({ 25565: ['timeout', 'open'] });
    expect(await scanPorts(baseOptions([25565], connect, { attempts: 1 }))).toEqual([]);
    expect(calls.get(25565)).toBe(1);
  });

  it('a refusal is closed on the first attempt and is never retried', async () => {
    const { connect, calls } = table({ 25565: ['closed', 'open'] });
    expect(await scanPorts(baseOptions([25565], connect, { attempts: 3 }))).toEqual([]);
    expect(calls.get(25565)).toBe(1);
  });
});

describe('scanPorts: the rate cap and the concurrency cap', () => {
  it('never has more connects in flight than the concurrency allows', async () => {
    let inFlight = 0;
    let peak = 0;
    const connect: Connector = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return 'closed';
    };
    const ports = Array.from({ length: 20 }, (_, i) => i + 1);
    await scanPorts(baseOptions(ports, connect, { concurrency: 4 }));
    expect(peak).toBe(4);
  });

  it('makes one rate-gate wait per connect attempt, so the rate cap covers every connect', async () => {
    let waits = 0;
    const clock = fakeClock();
    const connect: Connector = async () => 'closed';
    await scanPorts({
      ports: [1, 2, 3, 4, 5],
      connect,
      concurrency: 3,
      perSecond: 10,
      attempts: 1,
      now: clock.now,
      sleep: async (ms) => {
        waits += 1;
        await clock.sleep(ms);
      },
    });
    // Five connects at 10 per second: the first starts at once, the other four each wait one 100 ms slot.
    expect(waits).toBe(4);
  });
});

describe('scanPorts: abort and error paths', () => {
  it('rejects, and makes no connect, when the signal is already aborted', async () => {
    const { connect, calls } = table({});
    const controller = new AbortController();
    controller.abort();
    await expect(
      scanPorts(baseOptions([1, 2], connect, { signal: controller.signal })),
    ).rejects.toThrow();
    expect(calls.size).toBe(0);
  });

  it('stops after the abort: with one worker, no connect starts after the aborting one', async () => {
    const controller = new AbortController();
    const { connect, calls } = table({});
    const aborting: Connector = async (port, signal) => {
      await connect(port, signal);
      if (port === 1) controller.abort();
      return 'closed';
    };
    await expect(
      scanPorts(baseOptions([1, 2, 3], aborting, { signal: controller.signal })),
    ).rejects.toThrow();
    expect(calls.has(2)).toBe(false);
    expect(calls.has(3)).toBe(false);
  });

  it('rejects the whole scan when the connector throws, and makes no further connect', async () => {
    const calls: number[] = [];
    const connect: Connector = async (port) => {
      calls.push(port);
      if (port === 2) throw new Error('connector broke on port 2');
      return 'closed';
    };
    await expect(scanPorts(baseOptions([1, 2, 3, 4], connect))).rejects.toThrow(
      'connector broke on port 2',
    );
    expect(calls).toEqual([1, 2]);
  });

  it('refuses a concurrency below 1', async () => {
    const { connect } = table({});
    await expect(scanPorts(baseOptions([1], connect, { concurrency: 0 }))).rejects.toThrow(
      RangeError,
    );
  });

  it('refuses attempts below 1', async () => {
    const { connect } = table({});
    await expect(scanPorts(baseOptions([1], connect, { attempts: 0 }))).rejects.toThrow(RangeError);
  });

  it('refuses a rate that is not positive', async () => {
    const { connect } = table({});
    await expect(scanPorts(baseOptions([1], connect, { perSecond: 0 }))).rejects.toThrow(
      RangeError,
    );
  });
});
