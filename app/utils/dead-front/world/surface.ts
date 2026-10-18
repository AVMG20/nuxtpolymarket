import type * as THREE from 'three'

// World-space surface detail for the map's voxel chunks. The greedy mesher
// merges whole walls into single quads, so on its own a wall is one flat
// colour. This patch puts the blocks back: every 0.5 m cell gets a soft bevel
// (lit top-left edge, shaded bottom-right edge) and 8 x 8 "texels" of value
// noise, so cobbles, bricks and planks read as crafted blocks up close. Both
// fade out with distance (by screen-space derivative) so nothing shimmers.

const VERT_HEAD = /* glsl */`#include <common>
varying vec3 vDfWPos;
varying vec3 vDfWNor;`

const VERT_BODY = /* glsl */`#include <worldpos_vertex>
vDfWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vDfWNor = normalize(mat3(modelMatrix) * objectNormal);`

const FRAG_HEAD = /* glsl */`#include <common>
varying vec3 vDfWPos;
varying vec3 vDfWNor;
uniform float uDfCell;
float dfH2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float dfSurface(float glow) {
    vec3 n = normalize(vDfWNor);
    vec3 an = abs(n);
    // Face plane coordinates: u runs to the right, v runs up (or north on floors).
    vec2 uv = an.y > 0.5 ? vDfWPos.xz : (an.x > 0.5 ? vec2(vDfWPos.z * sign(n.x), vDfWPos.y) : vec2(-vDfWPos.x * sign(n.z), vDfWPos.y));
    // Nudge off the face plane so the cell index is stable on the face itself.
    vec3 inside = vDfWPos - n * 0.01;
    vec2 c = uv / uDfCell;
    vec2 cellId = floor(c);
    vec2 f = c - cellId;
    float slice = an.y > 0.5 ? floor(inside.y / uDfCell) : (an.x > 0.5 ? floor(inside.x / uDfCell) : floor(inside.z / uDfCell));
    vec2 fw = fwidth(c);
    float px = max(fw.x, fw.y);
    // Texels: 8 per cell, faded out once they shrink below ~2 pixels.
    vec2 tex = floor(f * 8.0);
    float t1 = dfH2(cellId * 8.0 + tex + slice * 17.0);
    float t2 = dfH2(cellId + slice * 3.1 + 0.5);
    float texFade = 1.0 - smoothstep(0.06, 0.2, px);
    float k = 1.0 + ((t1 - 0.5) * 0.11 + (t2 - 0.5) * 0.06) * texFade;
    // Bevel: a lighter rim on the upper-left of each cell, a darker one bottom-right.
    float w = max(0.055, px * 1.5);
    float lo = 1.0 - smoothstep(0.0, w, min(f.x, f.y));
    float hi = 1.0 - smoothstep(0.0, w, min(1.0 - f.x, 1.0 - f.y));
    float bevelFade = 1.0 - smoothstep(0.12, 0.4, px);
    k *= 1.0 + (lo * 0.07 - hi * 0.13) * bevelFade;
    // Up-facing faces catch a touch more sky; nothing on glowing voxels.
    return mix(k, 1.0, step(0.001, glow));
}`

export interface DfSurfaceOpts {
    /** Metres per map cell. */
    cell: number
}

/** Patches a voxel material (already glow-patched) with the world-space block detail. */
export function dfPatchWorldSurface<T extends THREE.Material>(m: T, opts: DfSurfaceOpts): T {
    const prev = m.onBeforeCompile
    m.onBeforeCompile = (shader, renderer) => {
        prev.call(m, shader, renderer)
        shader.uniforms.uDfCell = { value: opts.cell }
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', VERT_HEAD)
            .replace('#include <worldpos_vertex>', VERT_BODY)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', FRAG_HEAD)
            .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= dfSurface(vGlow);')
    }
    const prevKey = m.customProgramCacheKey.bind(m)
    m.customProgramCacheKey = () => `dfsurf|${prevKey()}`
    return m
}
