import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChannelGuide } from '../../web/kino/guide.ts';

// The guide uses the shared sigil renderer and never asks for skin images.

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

describe('channel guide sigils', () => {
  it('draws a shared sigil without fetching a skin, even on repeated opens', () => {
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
    const inline = document.createElement('section');
    inline.innerHTML = `<div class="guide-content">
      <button class="guide-close">Close</button><p class="guide-caption"></p><ul class="guide-list"></ul>
    </div>`;
    const trigger = document.createElement('button');
    const media = Object.assign(new EventTarget(), { matches: true }) as MediaQueryList;
    const dialog = guideDialog();
    const guide = new ChannelGuide(dialog, inline, trigger, media, agents, {
      tune() {},
      watchNew() {},
    });
    guide.update({ onAir: new Map(), activeChannel: 1, canOpen: true });
    const sigils = [...dialog.querySelectorAll('canvas.sigil')];
    expect(sigils).toHaveLength(agents.length);
    expect(requested).toEqual([]);
    guide.open();
    dialog.close();
    guide.open();
    expect([...dialog.querySelectorAll('canvas.sigil')]).toEqual(sigils);
    expect(requested).toEqual([]);
  });
});
