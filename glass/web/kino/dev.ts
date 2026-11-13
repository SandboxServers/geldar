// Browser entry for the dev page: BlueMap's textures -> atlas -> mocked feed -> orbit view.
// Not unit tested (needs WebGL and a canvas); the pure parts it calls are.

import { WebGLRenderer } from 'three';
import { buildAtlas } from './atlas.ts';
import { bindPointer } from './camera/controls.ts';
import { CameraRig } from './camera/rig.ts';
import { devFeed } from './dev-feed.ts';
import { FeedState } from './feed.ts';
import { KinoScene } from './scene.ts';

async function main(): Promise<void> {
  const url = new URLSearchParams(location.search).get('textures');
  if (!url) throw new Error('add ?textures=<map textures.json url>');
  const atlas = await buildAtlas(url);

  const state = new FeedState();
  const view = new KinoScene(state, atlas.uv, atlas.material);
  for (const msg of devFeed()) view.update(state.apply(msg));

  const el = document.getElementById('kino') as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas: el, antialias: false });
  const rig = new CameraRig();
  bindPointer(el, () => rig, { onActivate: () => undefined });
  for (const [label, mode] of [
    ['Follow', 'follow'],
    ['Orbit', 'orbit'],
    ['Free', 'free'],
  ] as const) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => rig.setMode(mode));
    document.body.appendChild(b);
  }
  let last = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const target = state.focus;
    const pos = rig.update(state.world, target, Math.min(0.1, (now - last) / 1000), state.heading);
    last = now;
    view.camera.position.set(pos.x, pos.y, pos.z);
    view.setFadeFocus(pos, target ? { x: target.x, y: target.y + 1.2, z: target.z } : null);
    const look = rig.lookTarget(target);
    view.camera.lookAt(look.x, look.y, look.z);
    renderer.setSize(el.clientWidth, el.clientHeight, false);
    view.camera.aspect = el.clientWidth / el.clientHeight;
    view.camera.updateProjectionMatrix();
    renderer.render(view.scene, view.camera);
    requestAnimationFrame(frame);
  };
  frame();
}

void main();
