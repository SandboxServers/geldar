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
import { addGhost } from './agent-ghost.ts';
import { FOG_FAR, FOG_NEAR, faceShade, SKY_COLOUR } from './blocktex.ts';
import { CullingWorld, cellsToCull, sectionsOfCells } from './cull.ts';
import { labelStyle } from './entities.ts';
import { makeFadeMaterial, makeFadeUniforms, setFadeFocus } from './fade.ts';
import type { FeedChange, FeedState } from './feed.ts';
import { type MeshData, meshSection, type UvLookup } from './mesher.ts';
import { buildFigure, loadSkinCanvas } from './skin-figure.ts';
import { skinUrl } from './skin-uv.ts';

const AGENT_COLOUR = 0x00e5ff;
const MOB_COLOUR = 0x8a7f72;

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
  g.setAttribute(
    'soft',
    new BufferAttribute(
      new Float32Array(mesh.soft ?? new Array(mesh.positions.length / 3).fill(0)),
      1,
    ),
  );
  g.setIndex(new BufferAttribute(new Uint32Array(mesh.indices), 1));
  return g;
}

export class KinoScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.1, 400);
  private readonly sections = new Map<string, Mesh>();
  private readonly markers = new Map<string, Mesh>();
  private readonly markerGeometry = new BoxGeometry(0.6, 1.8, 0.6);
  /** One skin load per agent id; undefined results (404, bad image) are cached too, so a failure is silent and final. */
  private readonly skins = new Map<string, Promise<HTMLCanvasElement | undefined>>();
  // orbit state
  private yaw = 0;
  private pitch = 0.5;
  private radius = 24;
  private centre = { x: 0, y: 0, z: 0 };
  private culled = new Set<string>();

  private readonly state: FeedState;
  private readonly uvFor: UvLookup;
  private readonly material: Material;
  private readonly fade = makeFadeUniforms();

  constructor(
    state: FeedState,
    uvFor: UvLookup,
    material: Material = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
  ) {
    this.state = state;
    this.uvFor = uvFor;
    this.material = makeFadeMaterial(material, this.fade);
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

  /** Moves the see-through zone: leaves near the camera or the camera-agent line are dithered out. */
  setFadeFocus(
    camera: { x: number; y: number; z: number },
    agent: { x: number; y: number; z: number } | null,
  ): void {
    setFadeFocus(this.fade, camera, agent);
    // A camera right next to an agent would be filled by its silhouette: hide the ghost then.
    for (const m of this.markers.values()) {
      const ghost = m.getObjectByName('ghost');
      if (ghost) {
        const d = Math.hypot(
          m.position.x - camera.x,
          m.position.y - camera.y,
          m.position.z - camera.z,
        );
        ghost.visible = d > 2.2;
      }
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

  /** An agent: a cyan figure with a bright outline, a head block and a name label. */
  private makeAgentMarker(label: string): Mesh {
    const body = new Mesh(
      this.markerGeometry,
      new MeshBasicMaterial({ color: new Color(AGENT_COLOUR) }),
    );
    const outline = new LineSegments(
      new EdgesGeometry(this.markerGeometry),
      new LineBasicMaterial({ color: 0xffffff }),
    );
    outline.name = 'plain';
    body.add(outline);
    const head = new Mesh(
      new BoxGeometry(0.5, 0.5, 0.5),
      new MeshBasicMaterial({ color: 0xffe0b0 }),
    );
    head.position.y = 1.05;
    head.name = 'plain';
    body.add(head);
    addGhost(body, this.markerGeometry, AGENT_COLOUR, 0xffe0b0);
    this.addLabel(body, label, 1.7);
    this.attachSkin(body, label);
    return body;
  }

  /** Replaces the cyan box with the skinned figure once the agent's skin loads; any failure keeps the box. */
  private attachSkin(body: Mesh, agentId: string): void {
    const url = skinUrl(agentId);
    if (url === undefined || typeof document === 'undefined') return;
    let pending = this.skins.get(agentId);
    if (!pending) {
      pending = loadSkinCanvas(url);
      this.skins.set(agentId, pending);
    }
    void pending.then((canvas) => {
      if (!canvas) return;
      const figure = buildFigure(canvas);
      // The marker may have been rebuilt or removed while the skin loaded; a detached body is harmless.
      body.add(figure);
      (body.material as MeshBasicMaterial).visible = false;
      for (const c of body.children) if (c.name === 'plain') c.visible = false;
    });
  }

  /** A mob: a small neutral box, labelled only when the camera target is near (see labelStyle). */
  private makeMobMarker(type: string): Mesh {
    const body = new Mesh(
      this.markerGeometry,
      new MeshBasicMaterial({ color: new Color(MOB_COLOUR) }),
    );
    body.scale.set(0.6, 0.45, 0.6);
    this.addLabel(body, type.replace('minecraft:', ''), 1.4);
    return body;
  }

  private addLabel(body: Mesh, label: string, y: number): void {
    if (typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 48;
    const ctx = c.getContext('2d');
    if (!ctx) return;
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
    sprite.position.y = y;
    sprite.name = 'label';
    body.add(sprite);
  }

  /** Applies the label policy for a camera target at `focus`: agents always, mobs only when near. */
  updateLabels(focus: { x: number; y: number; z: number }): void {
    for (const m of this.markers.values()) {
      const sprite = m.getObjectByName('label') as Sprite | undefined;
      if (!sprite) continue;
      const d = Math.hypot(m.position.x - focus.x, m.position.y - focus.y, m.position.z - focus.z);
      const st = labelStyle(m.userData.agent === true, d);
      sprite.visible = st.visible;
      sprite.material.opacity = st.opacity;
      const k = m.userData.agent === true ? 1 : st.scale;
      sprite.scale.set(2.4 * k, 0.45 * k, 1);
    }
  }

  private setMarkers(entities: EntityPosition[]): void {
    const seen = new Set<string>();
    for (const e of entities) {
      seen.add(e.id);
      const isAgent = e.agent_id !== undefined;
      let m = this.markers.get(e.id);
      // The id's record decides what the marker is: a changed type or agent flag rebuilds it.
      if (m && (m.userData.type !== e.type || m.userData.agent !== isAgent)) {
        this.scene.remove(m);
        m = undefined;
      }
      if (!m) {
        m = isAgent ? this.makeAgentMarker(e.agent_id as string) : this.makeMobMarker(e.type);
        this.markers.set(e.id, m);
        this.scene.add(m);
      }
      // e.y is the feet; the box is centred on its middle.
      m.position.set(e.x, e.y + (isAgent ? 0.9 : 0.22), e.z);
      m.rotation.y = (-e.yaw * Math.PI) / 180;
      m.userData = { type: e.type, agent: isAgent };
    }
    for (const [id, m] of this.markers) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.markers.delete(id);
      }
    }
  }
}
