import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChannelGuide } from '../../web/kino/guide.ts';
import { clearSharedSkins } from '../../web/kino/skin-figure.ts';

// The channel guide draws a face for every listed agent; the skin requests must wait for the first open.

let win: Window;

beforeAll(() => {
  win = new Window({ url: 'https://glass.example.test/kino/' });
  const g = globalThis as Record<string, unknown>;
  g.document = win.document;
  g.HTMLElement = win.HTMLElement;
});

afterAll(async () => {
  const g = globalThis as Record<string, unknown>;
  delete g.document;
  delete g.HTMLElement;
  vi.unstubAllGlobals();
  await win.happyDOM.close();
});

function guideDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog') as HTMLDialogElement;
  dialog.innerHTML =
    '<button class="guide-close">x</button><p class="guide-caption"></p><ul class="guide-list"></ul>';
  // happy-dom may not model a modal dialog; the guide only needs open and close.
  (dialog as unknown as { showModal(): void }).showModal = () => {
    (dialog as unknown as { open: boolean }).open = true;
  };
  (dialog as unknown as { close(): void }).close = () => {
    (dialog as unknown as { open: boolean }).open = false;
  };
  document.body.appendChild(dialog);
  return dialog;
}

describe('channel guide faces', () => {
  it('requests no skin until the guide is first opened', () => {
    clearSharedSkins();
    const requested: string[] = [];
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        set src(v: string) {
          requested.push(v);
        }
      },
    );
    const agents = [
      { id: 'ag_one', label: 'One' },
      { id: 'ag_two', label: 'Two' },
      { id: 'ag_three', label: 'Three' },
    ];
    const guide = new ChannelGuide(guideDialog(), agents, { tune() {}, watchNew() {} });
    expect(requested).toEqual([]);
    guide.open({ onAir: new Map(), activeChannel: 1, canOpen: true }, (id) => id);
    expect(requested).toHaveLength(3);
    guide.open({ onAir: new Map(), activeChannel: 1, canOpen: true }, (id) => id);
    expect(requested).toHaveLength(3);
  });
});
