import { type HTMLElement, Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Row } from './render-model.ts';
import { createMore, MORE_LIMIT, type MoreDeps } from './render-more.ts';
import { DEBOUNCE_MS } from './render-roster.ts';

const agent = (id: string, name: string): Row => ({ agent_id: id, name, died_at: null }) as Row;

/** Lets the pending promise callbacks run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function setup(
  options: { fetchAgents?: MoreDeps['fetchAgents']; pick?: (id: string) => boolean } = {},
) {
  const win = new Window();
  const doc = win.document;
  const toggle = doc.createElement('button');
  const panel = doc.createElement('section');
  const search = doc.createElement('input');
  const count = doc.createElement('p');
  const list = doc.createElement('ol');
  doc.body.append(toggle, panel);
  panel.append(search, count, list);
  panel.hidden = true;
  const fetchAgents = vi.fn(
    options.fetchAgents ?? (async () => ({ agents: [agent('a', 'Ada')], total: 1 })),
  );
  const pick = vi.fn(options.pick ?? (() => true));
  createMore({
    doc: doc as unknown as MoreDeps['doc'],
    toggle: toggle as unknown as MoreDeps['toggle'],
    panel: panel as unknown as MoreDeps['panel'],
    search: search as unknown as MoreDeps['search'],
    count: count as unknown as MoreDeps['count'],
    list: list as unknown as MoreDeps['list'],
    fetchAgents,
    pick,
  });
  const pressEscape = () =>
    panel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }) as never);
  return { win, doc, toggle, panel, search, count, list, fetchAgents, pick, pressEscape };
}

const items = (list: HTMLElement) => list.querySelectorAll('.more-agent');

afterEach(() => {
  vi.useRealTimers();
});

describe('the More agents list (#902)', () => {
  it('asks the agents API for the search text, once, after the debounce', async () => {
    vi.useFakeTimers();
    const { win, toggle, search, fetchAgents } = setup();
    toggle.click();
    await flush();
    fetchAgents.mockClear();
    search.value = '  Ada  ';
    search.dispatchEvent(new win.Event('input') as never);
    await flush();
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    await flush();
    expect(fetchAgents).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await flush();
    expect(fetchAgents).toHaveBeenCalledTimes(1);
    expect(fetchAgents).toHaveBeenCalledWith(`/api/agents?limit=${MORE_LIMIT}&q=Ada`);
  });

  it('shows the total, and never draws more than the limit', async () => {
    const many = Array.from({ length: MORE_LIMIT + 10 }, (_, i) => agent(`n${i}`, `Agent ${i}`));
    const { toggle, list, count } = setup({
      fetchAgents: async () => ({ agents: many, total: many.length }),
    });
    toggle.click();
    await flush();
    expect(items(list as unknown as HTMLElement)).toHaveLength(MORE_LIMIT);
    expect(count.textContent).toBe(`${MORE_LIMIT + 10} matching; showing the first ${MORE_LIMIT}.`);
  });

  it('a press picks the agent as a chip does, closes the list and gives the focus back', async () => {
    const { doc, toggle, panel, list, pick } = setup();
    toggle.click();
    await flush();
    (items(list as unknown as HTMLElement)[0] as unknown as { click(): void }).click();
    expect(pick).toHaveBeenCalledWith('a');
    expect(panel.hidden).toBe(true);
    expect(doc.activeElement).toBe(toggle);
  });

  it('a pick the chip row does not hold keeps the list open and says why', async () => {
    const { toggle, panel, list, count } = setup({ pick: () => false });
    toggle.click();
    await flush();
    (items(list as unknown as HTMLElement)[0] as unknown as { click(): void }).click();
    expect(panel.hidden).toBe(false);
    expect(count.textContent).toContain('not in the chip row');
  });

  it('Escape closes the list and gives the focus back to the button, without a pick', async () => {
    const { doc, toggle, panel, pressEscape, pick } = setup();
    toggle.click();
    await flush();
    pressEscape();
    expect(panel.hidden).toBe(true);
    expect(doc.activeElement).toBe(toggle);
    expect(pick).not.toHaveBeenCalled();
  });

  it('a reply that arrives after the list closed is dropped', async () => {
    let answer: (reply: { agents: Row[]; total: number }) => void = () => undefined;
    const { toggle, list, pressEscape } = setup({
      fetchAgents: () => new Promise((resolve) => (answer = resolve)),
    });
    toggle.click();
    pressEscape();
    answer({ agents: [agent('a', 'Ada')], total: 1 });
    await flush();
    expect(items(list as unknown as HTMLElement)).toHaveLength(0);
  });

  it('a 429 says when to try again; any other failure says the agents did not load', async () => {
    let fail: unknown = { httpStatus: 429, retryAfter: 5 };
    const { toggle, count } = setup({
      fetchAgents: async () => {
        throw fail;
      },
    });
    toggle.click();
    await flush();
    expect(count.textContent).toBe('Too many requests. Try again in 5 seconds.');
    fail = new Error('boom');
    toggle.click();
    toggle.click();
    await flush();
    expect(count.textContent).toBe('Could not load the agents.');
  });
});
