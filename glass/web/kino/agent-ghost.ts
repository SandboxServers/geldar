// The always-visible agent: a second copy of the figure drawn translucent with depth test GREATER, so
// it appears only where blocks hide the figure and shows as a faint silhouette. Where the figure is
// visible the ghost fails the depth test and the true colours stay.

import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  GreaterDepth,
  type Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three';

export const GHOST_OPACITY = 0.4;
export const GHOST_ORDER = 10;
export const GHOST_TINT = 0x66e0ff;

/**
 * A translucent material in `colour` that draws only where something nearer already covers the pixel
 * (depth test GREATER), so an unoccluded figure keeps its true colours and an occluded one shows a faint
 * silhouette.
 */
export function ghostMaterial(colour: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: new Color(colour),
    depthTest: true,
    depthFunc: GreaterDepth,
    depthWrite: false,
    transparent: true,
    opacity: GHOST_OPACITY,
  });
}

/** The ghost of a skinned figure: the same parts, drawn with the skin tinted, only where occluded. */
export function skinGhost(figure: Group): Group {
  const ghost = figure.clone(true);
  ghost.name = 'ghost';
  ghost.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const src = (o.material as MeshBasicMaterial).map;
    o.material = new MeshBasicMaterial({
      map: src,
      color: new Color(GHOST_TINT),
      alphaTest: 0.5,
      depthTest: true,
      depthFunc: GreaterDepth,
      depthWrite: false,
      transparent: true,
      opacity: GHOST_OPACITY,
    });
    o.renderOrder = GHOST_ORDER;
  });
  return ghost;
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
      depthTest: true,
      depthFunc: GreaterDepth,
      depthWrite: false,
      transparent: true,
      opacity: 0.7,
    }),
  );
  outline.renderOrder = GHOST_ORDER;
  ghost.add(outline);
  body.add(ghost);
}
