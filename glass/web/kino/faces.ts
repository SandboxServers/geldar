// The six cube faces: outward normal and the corners, counter-clockwise seen from outside.

export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

export interface FaceDef {
  face: Face;
  d: [number, number, number];
  corners: [number, number, number][];
}

// Corner order is counter-clockwise seen from outside, so the winding faces outward.
export const FACES: FaceDef[] = [
  {
    face: 'px',
    d: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    face: 'nx',
    d: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    face: 'py',
    d: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    face: 'ny',
    d: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    face: 'pz',
    d: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    face: 'nz',
    d: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];
