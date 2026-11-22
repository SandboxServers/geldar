import { describe, expect, it, vi } from 'vitest';
import {
  DISMISSED_KEY,
  type InstallParts,
  type InstallStore,
  registerWorker,
  setUpInstall,
  WORKER_SCOPE,
  WORKER_URL,
} from './render-install.ts';

class Button {
  private press: (() => void) | undefined;
  addEventListener(_type: 'click', listener: () => void): void {
    this.press = listener;
  }
  click(): void {
    this.press?.();
  }
}

/** The page objects the install strip touches, as fakes. */
function parts(options: { standalone?: boolean; store?: InstallStore | null } = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const yes = new Button();
  const no = new Button();
  const strip = { hidden: true };
  const queries: string[] = [];
  const all: InstallParts = {
    strip,
    yes,
    no,
    win: {
      addEventListener: (type, listener) => void listeners.set(type, listener),
      matchMedia: (query) => {
        queries.push(query);
        return { matches: options.standalone === true };
      },
    },
    store: options.store === undefined ? null : options.store,
  };
  setUpInstall(all);
  const offer = () => {
    const event = { preventDefault: vi.fn(), prompt: vi.fn() };
    listeners.get('beforeinstallprompt')?.(event);
    return event;
  };
  return { strip, yes, no, offer, queries, installed: () => listeners.get('appinstalled')?.({}) };
}

function memory(): InstallStore & { kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
  };
}

describe('the install strip', () => {
  it('stays hidden until the browser offers an install, then shows and holds the browser prompt back', () => {
    const page = parts();
    expect(page.strip.hidden).toBe(true);
    const event = page.offer();
    expect(page.strip.hidden).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it('opens the browser prompt once on "Install", and hides', () => {
    const page = parts();
    const event = page.offer();
    page.yes.click();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(page.strip.hidden).toBe(true);
    // The offer is spent: a second press has nothing to open.
    page.yes.click();
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('never shows in the installed app', () => {
    const page = parts({ standalone: true });
    const event = page.offer();
    expect(page.strip.hidden).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(page.queries).toEqual(['(display-mode: standalone)']);
  });

  it('hides on "Not now", remembers it, and does not come back on the next visit', () => {
    const store = memory();
    const page = parts({ store });
    const event = page.offer();
    page.no.click();
    expect(page.strip.hidden).toBe(true);
    expect(event.prompt).not.toHaveBeenCalled();
    expect([...store.kept]).toEqual([[DISMISSED_KEY, '1']]);
    page.offer();
    expect(page.strip.hidden).toBe(true);
    // A later visit: a new page over the same storage.
    const next = parts({ store });
    next.offer();
    expect(next.strip.hidden).toBe(true);
  });

  it('hides once the app is installed', () => {
    const page = parts();
    const event = page.offer();
    page.installed();
    expect(page.strip.hidden).toBe(true);
    page.yes.click();
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it('works where storage throws or is missing: "Not now" hides the strip for this visit', () => {
    const broken: InstallStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    for (const store of [broken, null]) {
      const page = parts({ store });
      page.offer();
      expect(page.strip.hidden).toBe(false);
      expect(() => page.no.click()).not.toThrow();
      expect(page.strip.hidden).toBe(true);
    }
  });

  it('survives a browser prompt that throws', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const yes = new Button();
    const strip = { hidden: true };
    setUpInstall({
      strip,
      yes,
      no: new Button(),
      win: { addEventListener: (type, listener) => void listeners.set(type, listener) },
      store: null,
    });
    listeners.get('beforeinstallprompt')?.({
      preventDefault: () => {},
      prompt: () => {
        throw new Error('InvalidStateError');
      },
    });
    expect(strip.hidden).toBe(false);
    expect(() => yes.click()).not.toThrow();
    expect(strip.hidden).toBe(true);
  });
});

describe('the worker registration', () => {
  it('registers the worker under /js/ and asks for the whole origin as its scope', () => {
    const register = vi.fn(async () => undefined);
    registerWorker({ serviceWorker: { register } });
    // The script is under /js/, the one folder Caddy routes; the page it serves is at the root.
    expect([WORKER_URL, WORKER_SCOPE]).toEqual(['/js/sw.js', '/']);
    expect(register.mock.calls).toEqual([['/js/sw.js', { scope: '/' }]]);
  });

  it('does nothing where the browser has no worker, and ignores a refusal', async () => {
    expect(() => registerWorker(undefined)).not.toThrow();
    expect(() => registerWorker({})).not.toThrow();
    const refused = vi.fn(() => Promise.reject(new Error('SecurityError')));
    registerWorker({ serviceWorker: { register: refused } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(refused).toHaveBeenCalledTimes(1);
    const throws = {
      serviceWorker: {
        register: (): Promise<unknown> => {
          throw new Error('TypeError');
        },
      },
    };
    expect(() => registerWorker(throws)).not.toThrow();
  });
});
