/**
 * The two things that make the Thought Stream page an installable app: the service worker's registration,
 * and the strip that offers "Install" when the browser says the page can be installed. Neither sends
 * anything anywhere. Every page object is passed in, so both are tested with fakes (render-install.test.ts).
 *
 * This file is served to the browser after type stripping, so it stays erasable TypeScript.
 */

/** Where the worker script is served. Its place at the root makes the whole origin its scope. */
export const WORKER_URL = '/sw.js';

/** The storage key that remembers "Not now". Its value is the fixed text "1". */
export const DISMISSED_KEY = 'glass.install.dismissed';

/** The browser's `beforeinstallprompt` event: the page may hold it and show the prompt later, once. */
export interface InstallPrompt {
  preventDefault(): void;
  prompt(): unknown;
}

export interface InstallWindow {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  matchMedia?: (query: string) => { matches: boolean };
}

export interface InstallStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Pressable {
  addEventListener(type: 'click', listener: () => void): void;
}

export interface InstallParts {
  strip: { hidden: boolean };
  yes: Pressable;
  no: Pressable;
  win: InstallWindow;
  /** Where "Not now" is remembered, or null when the browser gives the page no storage. */
  store: InstallStore | null;
}

/** True when the page already runs as an installed app. */
function standalone(win: InstallWindow): boolean {
  try {
    return win.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}

/** Storage can throw (a private window, a full disk). A failure reads as "not dismissed" and is not kept. */
function dismissed(store: InstallStore | null): boolean {
  try {
    return store?.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Shows the install strip when the browser offers an install, and never otherwise: not in the installed
 * app, and not after "Not now". "Install" opens the browser's own prompt; the browser, not the page,
 * installs. The strip starts hidden in the markup and this is the only code that shows it.
 */
export function setUpInstall(parts: InstallParts): void {
  let offer: InstallPrompt | null = null;
  const hide = (): void => {
    parts.strip.hidden = true;
  };
  parts.win.addEventListener('beforeinstallprompt', (event) => {
    if (standalone(parts.win) || dismissed(parts.store)) return;
    offer = event as InstallPrompt;
    // Chrome's own mini-infobar is held back: the strip is the one prompt.
    offer.preventDefault();
    parts.strip.hidden = false;
  });
  parts.win.addEventListener('appinstalled', () => {
    offer = null;
    hide();
  });
  parts.yes.addEventListener('click', () => {
    const held = offer;
    offer = null;
    hide();
    try {
      void held?.prompt();
    } catch {
      // The browser refused the prompt (it was used already): nothing to do.
    }
  });
  parts.no.addEventListener('click', () => {
    offer = null;
    hide();
    try {
      parts.store?.setItem(DISMISSED_KEY, '1');
    } catch {
      // Not remembered: the strip may come back on the next visit.
    }
  });
}

/** The part of `navigator` the registration uses. */
export interface WorkerHost {
  serviceWorker?: { register(url: string): Promise<unknown> };
}

/**
 * Registers the service worker where the browser has one (a secure context). A failure is ignored: the
 * page works the same without it, only not offline.
 */
export function registerWorker(host: WorkerHost | undefined): void {
  try {
    host?.serviceWorker?.register(WORKER_URL).catch(() => undefined);
  } catch {
    // No worker here.
  }
}
