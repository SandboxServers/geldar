import { describe, expect, it } from 'vitest';
import { HOSTILE } from './render-fixtures.ts';
import {
  fnv1a,
  makeSigil,
  paintSigil,
  SIGIL_CELLS,
  SIGIL_SIZE,
  type SigilCanvas,
  type SigilContext,
  sigilColours,
  sigilOf,
} from './render-sigil.ts';

/** A sigil as five rows of "#" and ".". */
function rows(name: string): string[] {
  const { cells } = sigilOf(name);
  return Array.from({ length: SIGIL_CELLS }, (_row, y) =>
    cells
      .slice(y * SIGIL_CELLS, (y + 1) * SIGIL_CELLS)
      .map((lit) => (lit ? '#' : '.'))
      .join(''),
  );
}

class FakeCanvas implements SigilCanvas {
  className = '';
  width = 0;
  height = 0;
  attrs = new Map<string, string>();
  fills: [string, number, number, number, number][] = [];
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getContext = (): SigilContext => {
    const fills = this.fills;
    return {
      fillStyle: '',
      fillRect(x, y, w, h) {
        fills.push([String(this.fillStyle), x, y, w, h]);
      },
    };
  };
}

describe('the agent sigil', () => {
  it('hashes a name with FNV-1a', () => {
    expect(fnv1a('')).toBe(2166136261);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('draws the approved design: the same name always gives the same hue and cells', () => {
    expect(sigilOf('Orrin').hue).toBe(142);
    expect(rows('Orrin')).toEqual(['.....', '.#.#.', '..#..', '..#..', '#...#']);
    expect(sigilOf('Tamsin').hue).toBe(178);
    expect(rows('Tamsin')).toEqual(['#####', '.....', '.###.', '#####', '.....']);
    expect(sigilOf('Bracken').hue).toBe(250);
    expect(rows('Bracken')).toEqual(['.#.#.', '#####', '..#..', '.###.', '#...#']);
  });

  it('mirrors left to right and always lights the centre, whatever the name', () => {
    for (const name of ['', 'a', 'Halloway', ...HOSTILE]) {
      const { hue, cells } = sigilOf(name);
      expect(Number.isInteger(hue) && hue >= 0 && hue < 360, name.slice(0, 20)).toBe(true);
      expect(cells).toHaveLength(SIGIL_CELLS * SIGIL_CELLS);
      expect(cells[12]).toBe(true);
      for (let y = 0; y < SIGIL_CELLS; y += 1) {
        for (let x = 0; x < SIGIL_CELLS; x += 1) {
          expect(cells[y * SIGIL_CELLS + x]).toBe(cells[y * SIGIL_CELLS + (SIGIL_CELLS - 1 - x)]);
        }
      }
    }
  });

  it('makes both colours from the hue alone', () => {
    expect(sigilColours(142)).toEqual({ ground: 'hsl(142, 28%, 16%)', ink: 'hsl(142, 70%, 66%)' });
  });

  it('paints the ground over the whole bitmap, then one square per lit cell inside a one-cell margin', () => {
    const canvas = new FakeCanvas();
    paintSigil(canvas.getContext(), sigilOf('Orrin'));
    const { ground, ink } = sigilColours(142);
    expect(canvas.fills[0]).toEqual([ground, 0, 0, SIGIL_SIZE, SIGIL_SIZE]);
    expect(canvas.fills.slice(1)).toEqual([
      [ink, 2, 2, 1, 1],
      [ink, 4, 2, 1, 1],
      [ink, 3, 3, 1, 1],
      [ink, 3, 4, 1, 1],
      [ink, 1, 5, 1, 1],
      [ink, 5, 5, 1, 1],
    ]);
  });

  it('makes a 7 by 7 canvas hidden from screen readers, and no part of the name reaches it', () => {
    for (const name of HOSTILE) {
      const canvas = new FakeCanvas();
      const made = makeSigil({ createElement: () => canvas }, name, 'row');
      expect(made).toBe(canvas);
      expect([canvas.className, canvas.width, canvas.height]).toEqual(['sigil sigil-row', 7, 7]);
      expect([...canvas.attrs]).toEqual([['aria-hidden', 'true']]);
      // What is drawn is two computed colours and whole-number squares.
      for (const [style, x, y, w, h] of canvas.fills) {
        expect(style).toMatch(/^hsl\(\d{1,3}, (28%, 16%|70%, 66%)\)$/);
        expect([x, y, w, h].every(Number.isInteger)).toBe(true);
      }
    }
  });

  it('picks the size by a fixed class, greys a dead agent, and survives a document without canvas', () => {
    const canvas = new FakeCanvas();
    makeSigil({ createElement: () => canvas }, 'Mote', 'chip', true);
    expect(canvas.className).toBe('sigil sigil-chip dead');
    const bare: SigilCanvas = { className: '', width: 0, height: 0, setAttribute: () => {} };
    expect(makeSigil({ createElement: () => bare }, 'Mote', 'reader').className).toBe(
      'sigil sigil-reader',
    );
    const broken: SigilCanvas = {
      ...bare,
      getContext: () => {
        throw new Error('not implemented');
      },
    };
    expect(() => makeSigil({ createElement: () => broken }, 'Mote', 'row')).not.toThrow();
  });
});
