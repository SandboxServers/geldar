import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feedStream, logKinds, waitAfter } from '../fixtures/real-body-feed.ts';
import { structuredOf } from './client.ts';

/*
 * The live smoke 6 failed act (test/fixtures/real-body-action-failed.json) through the real path, and the
 * wait result as the MCP registry sends it: one JSON text part, with no structuredContent.
 */
const pair = JSON.parse(
  readFileSync(new URL('../fixtures/real-body-action-failed.json', import.meta.url), 'utf8'),
) as { events: unknown[] };

describe('the live client reads a wait result the server sends as text', () => {
  it('reads wake_reason and the events from the text part of a failed-act wait', async () => {
    const fed = await feedStream(pair.events);
    expect(fed.invalid).toBe(0);
    expect(await logKinds(fed.log)).toEqual(['1:intent_finished']);
    const out = await waitAfter(fed, 0);
    expect(out.ok).toBe(true);
    const response = {
      content: [{ type: 'text', text: JSON.stringify(out.ok ? out.result : null) }],
    };
    const structured = structuredOf(response) as {
      wake_reason?: unknown;
      events?: { type: string }[];
    };
    expect(structured.wake_reason).toBe('precondition_failed');
    expect(structured.events?.map((e) => e.type)).toContain('intent_finished');
  });

  it('still reads structuredContent when a server sends it', () => {
    const response = { structuredContent: { wake_reason: 'timeout' }, content: [] };
    expect(structuredOf(response).wake_reason).toBe('timeout');
  });

  it('gives an empty object for an error text that is not JSON', () => {
    expect(
      structuredOf({ isError: true, content: [{ type: 'text', text: 'wait_replaced' }] }),
    ).toEqual({});
  });
});
