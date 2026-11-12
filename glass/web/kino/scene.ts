// The three.js scene: one mesh per section, one marker per entity, a plain orbit camera.
// Collision and the camera modes belong to K05; this camera passes through everything.

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  Fog,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Sprite,
  SpriteMaterial,
} from 'three';
import type { EntityPosition } from '../../../contract/src/generated/types.ts';
import { FOG_FAR, FOG_NEAR, faceShade, SKY_COLOUR } from './blocktex.ts';
import { CullingWorld, cellsToCull, sectionsOfCells } from './cull.ts';
import type { FeedChange, FeedState } from './feed.ts';
import { type MeshData, meshSection, type UvLookup } from './mesher.ts';

const AGENT_COLOUR = 0x00e5ff;
const ENTITY_COLOUR = 0xd9a441;

export function toGeometry(mesh: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(mesh.positions), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(mesh.normals), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(mesh.uvs), 2));
  const shade: number[] = [];
  for (let i = 0; i + 2 < mesh.normals.length; i += 3) {
    const s = faceShade(
      mesh.normals[i] as number,
      mesh.normals[i + 1] as number,
      mesh.normals[i + 2] as number,
    );
    shade.push(s, s, s);
  }
  g.setAttribute('color', new BufferAttribute(new Float32Array(shade), 3));
  g.setIndex(new BufferAttribute(new Uint32Array(mesh.indices), 1));
  return g;
}

export class KinoScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.1, 400);
  private readonly sections = new Map<string, Mesh>();
  private readonly markers = new Map<string, Mesh>();
  private readonly markerGeometry = new BoxGeometry(0.6, 1.8, 0.6);
  // orbit state
  private yaw = 0;
  private pitch = 0.5;
  private radius = 24;
  private centre = { x: 0, y: 0, z: 0 };
  private culled = new Set<string>();

  private readonly state: FeedState;
  private readonly uvFor: UvLookup;
  private readonly material: Material;

  constructor(
    state: FeedState,
    uvFor: UvLookup,
    material: Material = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
  ) {
    this.state = state;
    this.uvFor = uvFor;
    this.material = material;
    this.scene.background = new Color(SKY_COLOUR);
    this.scene.fog = new Fog(SKY_COLOUR, FOG_NEAR, FOG_FAR);
    this.updateCamera();
  }

  /** Applies one feed change: remesh dirty sections, refresh markers, move the orbit centre. */
  update(change: FeedChange): void {
    for (const key of change.dirty) this.remesh(key);
    if (change.entities) this.setMarkers(change.entities);
    if (this.state.focus) {
      this.centre = { ...this.state.focus };
      this.updateCamera();
    }
  }

  /** Hides see-through blocks within a couple of blocks of the camera; remeshes only what changed. */
  cullAround(pos: { x: number; y: number; z: number }): void {
    const next = cellsToCull(this.state.world, pos);
    const changed = [...next].filter((c) => !this.culled.has(c));
    for (const c of this.culled) if (!next.has(c)) changed.push(c);
    if (changed.length === 0) return;
    this.culled = next;
    for (const key of sectionsOfCells(changed)) if (this.sections.has(key)) this.remesh(key);
  }

  sectionKeys(): string[] {
    return [...this.sections.keys()];
  }

  markerIds(): string[] {
    return [...this.markers.keys()];
  }

  markerOf(id: string): Mesh | undefined {
    return this.markers.get(id);
  }

  sectionMesh(key: string): Mesh | undefined {
    return this.sections.get(key);
  }

  /** Plain orbit: yaw and pitch in radians, radius in blocks. */
  orbit(dYaw: number, dPitch: number, dRadius = 0): void {
    this.yaw += dYaw;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dPitch));
    this.radius = Math.max(2, Math.min(128, this.radius + dRadius));
    this.updateCamera();
  }

  private updateCamera(): void {
    const { x, y, z } = this.centre;
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      x + this.radius * cp * Math.sin(this.yaw),
      y + this.radius * Math.sin(this.pitch),
      z + this.radius * cp * Math.cos(this.yaw),
    );
    this.camera.lookAt(x, y, z);
  }

  private remesh(key: string): void {
    const [cx = 0, sy = 0, cz = 0] = key.split(',').map(Number);
    const old = this.sections.get(key);
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
      this.sections.delete(key);
    }
    const data = meshSection(
      new CullingWorld(this.state.world, this.culled),
      cx,
      sy,
      cz,
      this.uvFor,
    );
    if (data.indices.length === 0) return;
    const mesh = new Mesh(toGeometry(data), this.material);
    this.scene.add(mesh);
    this.sections.set(key, mesh);
  }

  /** A player-sized box with a bright outline, a head block and a name label, so it reads as a figure. */
  private makeMarker(colour: number, label: string): Mesh {
    const body = new Mesh(this.markerGeometry, new MeshBasicMaterial({ color: new Color(colour) }));
    const edges = new LineSegments(
      new EdgesGeometry(this.markerGeometry),
      new LineBasicMaterial({ color: 0xffffff }),
    );
    body.add(edges);
    const head = new Mesh(
      new BoxGeometry(0.5, 0.5, 0.5),
      new MeshBasicMaterial({ color: 0xffe0b0 }),
    );
    head.position.y = 1.05;
    body.add(head);
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 48;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000b';
        ctx.fillRect(0, 0, 256, 48);
        ctx.fillStyle = '#fff';
        ctx.font = '28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label.slice(0, 18), 128, 34);
        const sprite = new Sprite(
          new SpriteMaterial({ map: new CanvasTexture(c), depthTest: false, transparent: true }),
        );
        sprite.scale.set(2.4, 0.45, 1);
        sprite.position.y = 1.7;
        body.add(sprite);
      }
    }
    return body;
  }

  private setMarkers(entities: EntityPosition[]): void {
    const seen = new Set<string>();
    for (const e of entities) {
      seen.add(e.id);
      let m = this.markers.get(e.id);
      const colour = e.agent_id === undefined ? ENTITY_COLOUR : AGENT_COLOUR;
      if (!m) {
        m = this.makeMarker(colour, e.agent_id === undefined ? e.type : e.agent_id);
        this.markers.set(e.id, m);
        this.scene.add(m);
      }
      // e.y is the feet; the box is centred on its middle.
      m.position.set(e.x, e.y + 0.9, e.z);
      m.rotation.y = (-e.yaw * Math.PI) / 180;
      m.userData = { type: e.type, agent: e.agent_id !== undefined };
    }
    for (const [id, m] of this.markers) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.markers.delete(id);
      }
    }
  }
}
