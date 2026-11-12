// See-through foliage: leaves (and other see-through blocks) near the camera, or near the line from
// the camera to the followed agent, are drawn with a dithered discard so they keep ~30% of their
// pixels. A shader uniform pair moves the zone each frame; nothing is remeshed. Far leaves are forced
// opaque in the shader so alpha-tested textures do not sparkle at a distance.

import { type Material, MeshBasicMaterial, Vector3 } from 'three';

export const FADE_LINE_RADIUS = 3; // blocks from the camera-agent segment
export const FADE_CAMERA_RADIUS = 3; // blocks from the camera
export const FADE_OPACITY = 0.3;
export const SOLID_LEAF_FROM = 20; // leaves further than this lose their alpha holes ...
export const SOLID_LEAF_TO = 36; // ... completely by this distance

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Distance from point `p` to the segment a-b. */
export function distanceToSegment(p: P3, a: P3, b: P3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (len2 > 0) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}

/**
 * The share of a see-through block's pixels to keep (1 = fully drawn). Mirrors the fragment shader:
 * faded within FADE_CAMERA_RADIUS of the camera, or within FADE_LINE_RADIUS of the camera-agent segment.
 */
export function seeThroughOpacity(block: P3, camera: P3, agent: P3 | null): number {
  if (Math.hypot(block.x - camera.x, block.y - camera.y, block.z - camera.z) < FADE_CAMERA_RADIUS)
    return FADE_OPACITY;
  if (agent && distanceToSegment(block, camera, agent) < FADE_LINE_RADIUS) return FADE_OPACITY;
  return 1;
}

export interface FadeUniforms {
  uCam: { value: Vector3 };
  uAgent: { value: Vector3 };
  uUseAgent: { value: number };
}

export function makeFadeUniforms(): FadeUniforms {
  return {
    uCam: { value: new Vector3() },
    uAgent: { value: new Vector3() },
    uUseAgent: { value: 0 },
  };
}

export function setFadeFocus(u: FadeUniforms, camera: P3, agent: P3 | null): void {
  u.uCam.value.set(camera.x, camera.y, camera.z);
  if (agent) u.uAgent.value.set(agent.x, agent.y, agent.z);
  u.uUseAgent.value = agent ? 1 : 0;
}

const f = (n: number): string => n.toFixed(3);

/** The GLSL spliced into the basic material (exported for the test that checks it matches the policy). */
export const FADE_VERTEX_DECL =
  'attribute float soft;\nvarying float vSoft;\nvarying vec3 vWorld;\n';
export const FADE_FRAGMENT_BODY = `
  float camD = distance(vWorld, uCam);
  if (vSoft > 0.25) {
    vec3 ab = uAgent - uCam;
    float t = clamp(dot(vWorld - uCam, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
    float lineD = uUseAgent > 0.5 ? distance(vWorld, uCam + ab * t) : 1e9;
    if (vSoft > 0.75) diffuseColor.a = mix(diffuseColor.a, 1.0, smoothstep(${f(SOLID_LEAF_FROM)}, ${f(SOLID_LEAF_TO)}, camD));
    if (camD < ${f(FADE_CAMERA_RADIUS)} || lineD < ${f(FADE_LINE_RADIUS)}) {
      float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (dither >= ${f(FADE_OPACITY)}) discard;
    }
  }
`;

/**
 * A per-scene copy of the atlas material (the shared one cannot carry per-pane uniforms) whose
 * shader reads the `soft` vertex attribute and applies the see-through and far-leaf rules.
 */
export function makeFadeMaterial(base: Material, uniforms: FadeUniforms): Material {
  if (!(base instanceof MeshBasicMaterial) || !base.map) return base;
  const m = new MeshBasicMaterial({
    map: base.map,
    alphaTest: base.alphaTest,
    vertexColors: true,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FADE_VERTEX_DECL}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSoft = soft;\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vSoft;\nvarying vec3 vWorld;\nuniform vec3 uCam;\nuniform vec3 uAgent;\nuniform float uUseAgent;',
      )
      .replace(
        '#include <alphatest_fragment>',
        `${FADE_FRAGMENT_BODY}\n#include <alphatest_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'kino-fade-1';
  return m;
}
