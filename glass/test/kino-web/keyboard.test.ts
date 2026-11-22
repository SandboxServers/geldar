// Decision 0166, on the real listener: the keyboard drives the active monitor only, a held key never
// repeats a command, and a focused button keeps its own Space and Enter. happy-dom.

import { Window } from 'happy-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bindKeyboard } from '../../web/kino/keyboard.ts';
import type { Command } from '../../web/kino/keys.ts';

let win: Window;
let modal = false;
let freeFly = false;
let commands: Command[] = [];
let moves: string[][] = [];

beforeAll(() => {
  win = new Window({ url: 'https://glass.example.test/kino/' });
  win.document.body.innerHTML = `
    <button id="clear">Clear</button>
    <a id="tab" href="/">Glass</a>
    <details><summary id="more">More controls</summary></details>
    <input id="field" />
    <dialog><button id="row">Moss</button></dialog>`;
  bindKeyboard(win as unknown as Window & typeof globalThis, {
    modal: () => modal,
    freeFly: () => freeFly,
    move: (held) => moves.push([...held]),
    run: (c) => commands.push(c),
  });
});

beforeEach(() => {
  modal = false;
  freeFly = false;
  commands = [];
  moves = [];
});

afterAll(() => win.happyDOM.close());

/** Sends one key from the element (or the page body) and says whether the page cancelled it. */
function press(type: 'keydown' | 'keyup', key: string, on = 'body', repeat = false): boolean {
  const target = on === 'body' ? win.document.body : win.document.getElementById(on);
  const event = new win.KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true });
  target?.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('the Kino keyboard listener', () => {
  it('never lets a held Enter press the focused control again, in a dialog or out of one', () => {
    // The first press is the button's own: the page neither cancels it nor takes it as Solo.
    expect(press('keydown', 'Enter', 'clear')).toBe(false);
    expect(press('keydown', 'Enter', 'clear', true)).toBe(true);
    expect(press('keydown', 'Enter', 'more', true)).toBe(true);
    expect(press('keydown', 'Enter', 'tab', true)).toBe(true);
    modal = true;
    expect(press('keydown', 'Enter', 'row')).toBe(false);
    expect(press('keydown', 'Enter', 'row', true)).toBe(true);
    expect(commands).toEqual([]);
  });

  it('leaves Space on a button and a held Enter on the page to the browser', () => {
    expect(press('keydown', ' ', 'clear', true)).toBe(false);
    expect(press('keydown', 'Enter', 'body', true)).toBe(false);
    expect(commands).toEqual([]);
  });

  it('runs one command for a key however long it is held', () => {
    press('keydown', 'x');
    press('keydown', 'x', 'body', true);
    press('keydown', 'x', 'body', true);
    press('keydown', 'Enter');
    expect(commands).toEqual([{ kind: 'close' }, { kind: 'solo' }]);
  });

  it('takes no key while a dialog is open or while the viewer types', () => {
    modal = true;
    press('keydown', 'x');
    press('keydown', 'ArrowDown', 'row');
    expect(press('keydown', 'ArrowDown', 'row')).toBe(false);
    modal = false;
    press('keydown', 'x', 'field');
    expect(commands).toEqual([]);
    expect(moves).toEqual([]);
  });

  it('holds the movement keys in free-fly and lets them go on key up and on blur', () => {
    freeFly = true;
    press('keydown', 'w');
    press('keydown', 'd');
    press('keyup', 'W');
    press('keydown', 'a');
    win.dispatchEvent(new win.Event('blur'));
    expect(moves).toEqual([['w'], ['w', 'd'], ['d'], ['d', 'a'], []]);
    expect(commands).toEqual([]);
    freeFly = false;
    press('keydown', 'w');
    expect(moves).toHaveLength(5);
  });
});
