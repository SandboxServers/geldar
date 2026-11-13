// The channel guide (decision 0161): the agents this viewer may watch, as a list in a <dialog>. Pick one
// to tune the active monitor, or put it on a new monitor. The list is the server's (/kino/targets); the
// server checks every subscribe again. Labels are text only.

import { skinUrl } from './skin-uv.ts';
import type { TargetAgent } from './targets.ts';

export interface GuideHooks {
  /** Tune the active monitor (or open the first one) to this agent. */
  tune(agentId: string): void;
  /** Open a new monitor on this agent. */
  watchNew(agentId: string): void;
}

export interface GuideState {
  /** Agent id -> the channel numbers showing it. */
  onAir: ReadonlyMap<string, readonly number[]>;
  /** The channel the guide tunes, or null when there is no monitor yet. */
  activeChannel: number | null;
  canOpen: boolean;
}

/** Draws the face of a skin (head front plus the hat layer) on a small canvas; leaves the fallback on any failure. */
function drawFace(canvas: HTMLCanvasElement, agentId: string): void {
  const url = skinUrl(agentId);
  if (!url) return;
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx || img.width < 64) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, canvas.width, canvas.height);
    canvas.classList.add('loaded');
  };
  img.src = url;
}

export class ChannelGuide {
  private readonly dialog: HTMLDialogElement;
  private readonly list: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly items = new Map<
    string,
    { onAir: HTMLElement; tune: HTMLButtonElement; add: HTMLButtonElement }
  >();

  constructor(dialog: HTMLDialogElement, agents: readonly TargetAgent[], hooks: GuideHooks) {
    this.dialog = dialog;
    this.list = dialog.querySelector('.guide-list') as HTMLElement;
    this.caption = dialog.querySelector('.guide-caption') as HTMLElement;
    dialog.querySelector('.guide-close')?.addEventListener('click', () => dialog.close());
    // A click on the backdrop (outside the panel) closes the guide.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    this.list.replaceChildren();
    for (const a of agents) {
      const li = document.createElement('li');
      const tune = document.createElement('button');
      tune.type = 'button';
      tune.className = 'tune';
      const face = document.createElement('canvas');
      face.width = 32;
      face.height = 32;
      face.className = 'face';
      face.setAttribute('aria-hidden', 'true');
      drawFace(face, a.id);
      const text = document.createElement('span');
      text.className = 'who';
      const name = document.createElement('span');
      name.className = 'label';
      name.textContent = a.label;
      const onAir = document.createElement('span');
      onAir.className = 'onair';
      text.append(name, onAir);
      tune.append(face, text);
      tune.addEventListener('click', () => {
        hooks.tune(a.id);
        dialog.close();
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'add';
      add.textContent = 'New monitor';
      add.setAttribute('aria-label', `Watch ${a.label} on a new monitor`);
      add.addEventListener('click', () => {
        hooks.watchNew(a.id);
        dialog.close();
      });
      li.append(tune, add);
      this.list.appendChild(li);
      this.items.set(a.id, { onAir, tune, add });
    }
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  /** Opens the guide, showing which channels carry each agent. */
  open(state: GuideState, labelOf: (id: string) => string): void {
    this.caption.textContent =
      state.activeChannel === null
        ? 'Choose an agent to watch.'
        : `Choose an agent for CH ${state.activeChannel}.`;
    for (const [id, item] of this.items) {
      const chans = state.onAir.get(id) ?? [];
      item.onAir.textContent =
        chans.length > 0 ? `On ${chans.map((c) => `CH ${c}`).join(', ')}` : '';
      item.tune.setAttribute(
        'aria-label',
        state.activeChannel === null
          ? `Watch ${labelOf(id)}`
          : `Watch ${labelOf(id)} on CH ${state.activeChannel}`,
      );
      item.add.disabled = !state.canOpen;
    }
    if (!this.dialog.open) this.dialog.showModal();
    (this.list.querySelector('button.tune') as HTMLButtonElement | null)?.focus();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }
}
