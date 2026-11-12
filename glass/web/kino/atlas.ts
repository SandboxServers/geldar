// Builds the texture atlas and its material from BlueMap's textures.json. Browser only (canvas, Image).

import { CanvasTexture, MeshBasicMaterial, NearestFilter, SRGBColorSpace } from 'three';
import { applyTint, MISSING_COLOUR, tileFallbackColour, tintFor } from './blocktex.ts';
import { buildAtlasLayout, loadTextures, makeUvLookup } from './textures.ts';

const TILE = 16;

export async function buildAtlas(url: string) {
  const cache = await caches.open('kino-textures-v1');
  const textures = await loadTextures(url, { fetch: (u) => fetch(u), cache });
  const layout = buildAtlasLayout(textures.keys());
  const canvas = document.createElement('canvas');
  canvas.width = layout.cols * TILE;
  canvas.height = layout.rows * TILE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.fillStyle = MISSING_COLOUR;
  ctx.fillRect(0, 0, TILE, TILE); // slot 0: missing texture
  let decoded = 0;
  for (const [id, slot] of layout.slotOf) {
    const entry = textures.get(id);
    if (!entry) continue;
    const x = (slot % layout.cols) * TILE;
    const y = Math.floor(slot / layout.cols) * TILE;
    try {
      const img = new Image();
      img.src = entry.texture;
      await img.decode();
      // Animated textures are tall strips: take the first square frame.
      ctx.drawImage(img, 0, 0, img.width, img.width, x, y, TILE, TILE);
      const tint = tintFor(id);
      if (tint !== null) {
        const px = ctx.getImageData(x, y, TILE, TILE);
        applyTint(px.data, tint);
        ctx.putImageData(px, x, y);
      }
      decoded++;
    } catch {
      ctx.fillStyle = tileFallbackColour(entry.color);
      ctx.fillRect(x, y, TILE, TILE);
    }
  }
  const atlas = new CanvasTexture(canvas);
  atlas.magFilter = NearestFilter;
  atlas.colorSpace = SRGBColorSpace;
  return {
    uv: makeUvLookup(layout),
    material: new MeshBasicMaterial({ map: atlas, alphaTest: 0.5, vertexColors: true }),
    count: textures.size,
    decoded,
  };
}
