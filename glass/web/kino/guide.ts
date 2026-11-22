// The channel guide (decision 0166): choose from the viewer's permitted targets. The server checks
// every subscribe again. One list moves between the wide pane and the phone's modal sheet.

// In the browser the import map resolves this source path to the shared /js/ render module.
import { makeSigil } from '../../src/render-sigil.ts';
import type { TargetAgent } from './targets.ts';

export interface GuideHooks {
  /** Tune the active monitor (or open the first one) to this agent. */
  tune(agentId: string): void;
  /** Open a new monitor on this agent. */
  watchNew(agentId: string, channel?: number): void;
}

export interface GuideState {
  /** Agent id -> the channel numbers showing it. */
  onAir: ReadonlyMap<string, readonly number[]>;
  activeChannel: number | null;
  canOpen: boolean;
}

export class ChannelGuide {
  private readonly dialog: HTMLDialogElement;
  private readonly inline: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly narrow: MediaQueryList;
  private readonly content: HTMLElement;
  private readonly list: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly items = new Map<
    string,
    { onAir: HTMLElement; tune: HTMLButtonElement; add: HTMLButtonElement }
  >();
  private opener: HTMLElement | null = null;
  private newChannel: number | undefined;
  private state: GuideState = { onAir: new Map(), activeChannel: null, canOpen: false };

  constructor(
    dialog: HTMLDialogElement,
    inline: HTMLElement,
    trigger: HTMLButtonElement,
    narrow: MediaQueryList,
    agents: readonly TargetAgent[],
    hooks: GuideHooks,
  ) {
    this.dialog = dialog;
    this.inline = inline;
    this.trigger = trigger;
    this.narrow = narrow;
    this.content = inline.querySelector('.guide-content') as HTMLElement;
    this.list = this.content.querySelector('.guide-list') as HTMLElement;
    this.caption = this.content.querySelector('.guide-caption') as HTMLElement;
    this.closeButton = this.content.querySelector('.guide-close') as HTMLButtonElement;
    this.closeButton.addEventListener('click', () => this.dialog.close());
    // A click on the backdrop (outside the panel) closes the guide.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      const opener = this.opener?.isConnected ? this.opener : this.trigger;
      this.opener = null;
      // Unfolding closes the sheet without dismissing it: the list keeps the vacancy it was opened for.
      if (!this.narrow.matches) return;
      this.newChannel = undefined;
      this.update(this.state);
      opener.focus();
    });
    this.narrow.addEventListener('change', () => this.relocate());
    this.relocate();
    trigger.disabled = false;

    for (const a of agents) {
      const li = document.createElement('li');
      const tune = document.createElement('button');
      tune.type = 'button';
      tune.className = 'tune';
      const sigil = makeSigil(document, a.label, 'roster') as HTMLCanvasElement;
      const name = document.createElement('span');
      name.className = 'label';
      name.textContent = a.label;
      name.id = `channel-name-${this.items.size}`;
      const onAir = document.createElement('span');
      onAir.className = 'onair';
      tune.append(sigil, name, onAir);
      const pick = (openNew: boolean): void => {
        const channel = this.newChannel;
        this.newChannel = undefined;
        if (openNew) hooks.watchNew(a.id, channel);
        else hooks.tune(a.id);
        this.update(this.state);
        if (dialog.open) dialog.close();
        else if (document.activeElement === add && add.disabled) tune.focus();
      };
      tune.addEventListener('click', () =>
        pick(this.newChannel !== undefined || this.state.activeChannel === null),
      );
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'add';
      const hint = document.createElement('span');
      hint.className = 'sr-only';
      hint.id = `channel-add-${this.items.size}`;
      hint.textContent = 'New monitor for';
      add.textContent = '+';
      add.title = 'New monitor';
      add.setAttribute('aria-labelledby', `${hint.id} ${name.id}`);
      add.addEventListener('click', () => pick(true));
      li.append(tune, add, hint);
      this.list.appendChild(li);
      this.items.set(a.id, { onAir, tune, add });
    }
  }

  /** Resize without making an inline list modal or leaving a hidden modal trapping focus. */
  private relocate(): void {
    if (this.narrow.matches) {
      const hadFocus = this.content.contains(document.activeElement);
      this.dialog.appendChild(this.content);
      this.inline.hidden = true;
      if (hadFocus) this.trigger.focus();
    } else {
      const wasOpen = this.dialog.open;
      if (wasOpen) this.dialog.close();
      this.inline.appendChild(this.content);
      this.inline.hidden = false;
      if (wasOpen) this.focusChoice();
    }
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  update(state: GuideState): void {
    // Choosing another monitor drops a vacancy picked earlier: the next choice retunes that monitor.
    if (state.activeChannel !== this.state.activeChannel) this.newChannel = undefined;
    this.state = state;
    const channel = this.newChannel === undefined ? state.activeChannel : null;
    this.caption.textContent =
      channel === null
        ? this.newChannel === undefined
          ? 'Pick an agent for a new monitor. Four monitors at most.'
          : `Pick an agent for CH ${this.newChannel}. Four monitors at most.`
        : `Pick an agent for CH ${channel}. Four monitors at most.`;
    for (const [id, item] of this.items) {
      const chans = state.onAir.get(id) ?? [];
      item.onAir.textContent =
        chans.length > 0 ? `on ${chans.map((c) => `CH ${c}`).join(', ')}` : 'available';
      item.tune.disabled = channel === null && !state.canOpen;
      item.add.disabled = !state.canOpen;
    }
  }

  private focusChoice(): void {
    const first = this.list.querySelector<HTMLButtonElement>('button.tune:not(:disabled)');
    (first ?? this.closeButton).focus();
  }

  /** With an empty-slot opener, the first choice fills a monitor instead of retuning. */
  open(channel?: number, opener: HTMLElement | null = null): void {
    this.newChannel = channel;
    this.update(this.state);
    if (this.narrow.matches && !this.dialog.open) {
      this.opener = opener;
      this.dialog.showModal();
    }
    this.focusChoice();
  }
}
