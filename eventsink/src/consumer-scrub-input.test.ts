import { describe, expect, it, vi } from 'vitest';

const scrubInputs: number[] = [];
vi.mock('@geldar/telemetry', async (importOriginal) => {
  const real = await importOriginal<typeof import('@geldar/telemetry')>();
  return {
    ...real,
    scrubText: (text: string) => {
      scrubInputs.push(text.length);
      return real.scrubText(text);
    },
  };
});

const { handleBatch } = await import('./consumer.ts');

describe('error log reason is cut before it is scrubbed', () => {
  it('scrubText never sees more than the limit plus its slack, even for a 1 MiB reason', async () => {
    const records: Array<{ reason: unknown }> = [];
    const key = 'k'.repeat(1_048_576);
    await handleBatch(
      [
        {
          subject: 'geldar.phase0.damage',
          data: new TextEncoder().encode(JSON.stringify({ [key]: 1 })),
          deliveryCount: 1,
          headers: { get: () => '' },
          ack: () => {},
          nak: () => {},
        },
      ],
      {
        writer: { async insertBatch() {} },
        log: () => {},
        async publishDlq() {},
        errorLog: (_event, fields) => records.push({ reason: fields.reason }),
      },
    );
    expect(records).toHaveLength(1);
    expect(scrubInputs.length).toBeGreaterThan(0);
    expect(Math.max(...scrubInputs)).toBeLessThanOrEqual(8192 + 512);
  });
});
