// Browser entry for the dev page: BlueMap's textures -> atlas -> mocked feed -> orbit view.
// Not unit tested (needs WebGL and a canvas); the pure parts it calls are.

import {
  CanvasTexture,
  MeshBasicMaterial,
  NearestFilter,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { devFeed } from './dev-feed.ts';
import { FeedState } from './feed.ts';
import { KinoScene } from './scene.ts';
import { buildAtlasLayout, loadTextures, makeUvLookup } from './textures.ts';

const TILE = 16;

async function main(): Promise<void> {
  const url = new URLSearchParams(location.search).get('textures');
  if (!url) throw new Error('add ?textures=<map textures.json url>');
  const cache = await caches.open('kino-textures-v1');
  const textures = await loadTextures(url, { fetch: (u) => fetch(u), cache });
  const layout = buildAtlasLayout(textures.keys());
  const canvas = document.createElement('canvas');
  canvas.width = layout.cols * TILE;
  canvas.height = layout.rows * TILE;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, TILE, TILE); // slot 0: missing texture
  for (const [id, slot] of layout.slotOf) {
    const img = new Image();
    img.src = textures.get(id) as string;
    await img.decode();
    // Animated textures are tall strips: take the first square frame.
    ctx.drawImage(
      img,
      0,
      0,
      img.width,
      img.width,
      (slot % layout.cols) * TILE,
      Math.floor(slot / layout.cols) * TILE,
      TILE,
      TILE,
    );
  }
  const atlas = new CanvasTexture(canvas);
  atlas.magFilter = NearestFilter;
  atlas.colorSpace = SRGBColorSpace;

  const state = new FeedState();
  const view = new KinoScene(
    state,
    makeUvLookup(layout),
    new MeshBasicMaterial({ map: atlas, alphaTest: 0.5 }),
  );
  for (const msg of devFeed()) view.update(state.apply(msg));

  const el = document.getElementById('kino') as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas: el, antialias: false });
  let drag = false;
  el.addEventListener('pointerdown', () => (drag = true));
  addEventListener('pointerup', () => (drag = false));
  el.addEventListener(
    'pointermove',
    (e) => drag && view.orbit(-e.movementX * 0.01, e.movementY * 0.01),
  );
  el.addEventListener('wheel', (e) => view.orbit(0, 0, e.deltaY * 0.02));
  const frame = (): void => {
    renderer.setSize(el.clientWidth, el.clientHeight, false);
    view.camera.aspect = el.clientWidth / el.clientHeight;
    view.camera.updateProjectionMatrix();
    renderer.render(view.scene, view.camera);
    requestAnimationFrame(frame);
  };
  frame();
}

void main();
