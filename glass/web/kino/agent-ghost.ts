// The always-visible agent: a second, depth-test-off copy of the figure drawn translucent on top of
// the scene, so a figure hidden behind blocks still shows as a silhouette. Where the figure is
// visible the ghost lies over the same colour and changes nothing.

import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three';

export const GHOST_OPACITY = 0.4;
export const GHOST_ORDER = 10;

/** A depth-test-off translucent material in `colour`. */
export function ghostMaterial(colour: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: new Color(colour),
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: GHOST_OPACITY,
  });
}

/** Adds the ghost silhouette (body, head and outline) as children of the agent body mesh. */
export function addGhost(
  body: Mesh,
  bodyGeometry: BoxGeometry,
  bodyColour: number,
  headColour: number,
): void {
  const ghost = new Mesh(bodyGeometry, ghostMaterial(bodyColour));
  ghost.name = 'ghost';
  ghost.renderOrder = GHOST_ORDER;
  const head = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), ghostMaterial(headColour));
  head.position.y = 1.05;
  head.renderOrder = GHOST_ORDER;
  ghost.add(head);
  const outline = new LineSegments(
    new EdgesGeometry(bodyGeometry),
    new LineBasicMaterial({
      color: 0xffffff,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.7,
    }),
  );
  outline.renderOrder = GHOST_ORDER;
  ghost.add(outline);
  body.add(ghost);
}
