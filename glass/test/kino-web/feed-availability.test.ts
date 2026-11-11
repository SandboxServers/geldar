import { describe, expect, it } from 'vitest';
import { buildKino } from '../../src/kino/wiring.ts';
import { FeedState } from '../../web/kino/feed.ts';

describe('rate_limited', () => {
  it('shows a short notice and does not end the feed', () => {
    const change = new FeedState().apply({ type: 'rate_limited' });
    expect(change.notice).toMatch(/wait/);
    expect(change.bye).toBeUndefined();
  });
});

describe('Kino with a feed that comes and goes', () => {
  const db = { query: async () => ({ rows: [] }) } as never;
  it('is disabled while the feed is unavailable and ends panes when the feed is lost', () => {
    let up = false;
    let lost: (() => void) | undefined;
    const parts = buildKino({
      db,
      feed: {
        subscribe: () => () => {},
        available: () => up,
        onLost: (l) => {
          lost = l;
        },
      },
      sessionKey: undefined,
      glassEnabled: () => true,
      serveWeb: false,
      allowedOrigins: ['https://glass.example.test'],
    });
    const ended: string[] = [];
    parts.relay.endAll = ((r: string) => void ended.push(r)) as never;
    expect(lost).toBeDefined();
    lost?.();
    expect(ended).toEqual(['feed_unavailable']);
    up = true;
    parts.stop();
  });
});
