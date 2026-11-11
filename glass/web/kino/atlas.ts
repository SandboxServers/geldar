// Builds the texture atlas and its material from BlueMap's textures.json. Browser only (canvas, Image).

import { CanvasTexture, MeshBasicMaterial, NearestFilter, SRGBColorSpace } from 'three';
import { buildAtlasLayout, loadTextures, makeUvLookup } from './textures.ts';

const TILE = 16;

export async function buildAtlas(url: string) {
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
  return {
    uv: makeUvLookup(layout),
    material: new MeshBasicMaterial({ map: atlas, alphaTest: 0.5 }),
  };
}
