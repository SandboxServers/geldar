// The three.js scene: one mesh per section, one marker per entity, a plain orbit camera.
// Collision and the camera modes belong to K05; this camera passes through everything.

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  type Material,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
} from 'three';
import type { EntityPosition } from '../../../contract/src/generated/types.ts';
import type { FeedChange, FeedState } from './feed.ts';
import { type MeshData, meshSection, type UvLookup } from './mesher.ts';

const AGENT_COLOUR = 0x3fa9f5;
const ENTITY_COLOUR = 0xd9a441;

export function toGeometry(mesh: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(mesh.positions), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(mesh.normals), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(mesh.uvs), 2));
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

  private readonly state: FeedState;
  private readonly uvFor: UvLookup;
  private readonly material: Material;

  constructor(
    state: FeedState,
    uvFor: UvLookup,
    material: Material = new MeshBasicMaterial({ color: 0xffffff }),
  ) {
    this.state = state;
    this.uvFor = uvFor;
    this.material = material;
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
    const data = meshSection(this.state.world, cx, sy, cz, this.uvFor);
    if (data.indices.length === 0) return;
    const mesh = new Mesh(toGeometry(data), this.material);
    this.scene.add(mesh);
    this.sections.set(key, mesh);
  }

  private setMarkers(entities: EntityPosition[]): void {
    const seen = new Set<string>();
    for (const e of entities) {
      seen.add(e.id);
      let m = this.markers.get(e.id);
      const colour = e.agent_id === undefined ? ENTITY_COLOUR : AGENT_COLOUR;
      if (!m) {
        m = new Mesh(this.markerGeometry, new MeshBasicMaterial({ color: new Color(colour) }));
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
