// Void Runner — procedural low-poly models.
//
// Every model is assembled from a handful of primitive parts. Solid parts are
// baked into one vertex-coloured, flat-shaded mesh and glowing parts into one
// unlit HDR mesh, so a whole ship is two draw calls plus its turrets. Noses
// point down -Z, up is +Y.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// ─── Seeded randomness (cosmetic only) ─────────────────────────────────────

export function mulberry32(seed: number) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// ─── Materials ─────────────────────────────────────────────────────────────

/** Rim light shared by every hull; tinted to the sector so silhouettes pop against its nebula. */
export const RIM_COLOR = { value: new THREE.Color(0.35, 0.55, 0.8) }

// Shared by every ship surface: a cheap hash, value noise, and the hashed-cell
// panel layout. Everything is evaluated in the model's own space so the detail
// is welded to the hull and needs no UVs.
const SURFACE_GLSL = /* glsl */`
    uniform vec3 uRimColor;
    varying vec3 vSurfPos;
    varying float vSurfScale;
    varying float vSurfHeat;
    float surfHash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float surfHash2(vec2 p) {
        p = fract(p * vec2(0.3183099, 0.3678794) + vec2(0.71, 0.113));
        p *= 17.0;
        return fract(p.x * p.y * (p.x + p.y));
    }
    float surfNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(mix(surfHash(i), surfHash(i + vec3(1, 0, 0)), f.x), mix(surfHash(i + vec3(0, 1, 0)), surfHash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(surfHash(i + vec3(0, 0, 1)), surfHash(i + vec3(1, 0, 1)), f.x), mix(surfHash(i + vec3(0, 1, 1)), surfHash(i + vec3(1, 1, 1)), f.x), f.y),
            f.z);
    }
    // Plating: strakes of height size, each cut into panels of its own hashed
    // length and offset, and some panels split again, so no two rows line up
    // and it never reads as a checkerboard. Returns (distance to seam, panel id).
    vec2 surfPanels(vec2 q, float size, float seed) {
        float v = q.y / size;
        float row = floor(v);
        float rh = surfHash2(vec2(row, seed));
        float w = size * (1.3 + rh * 1.9);
        float u = q.x / w + rh * 7.0;
        float id = surfHash2(vec2(floor(u), row) + seed);
        float fv = fract(v);
        float h = size;
        if (id > 0.62) {
            h *= 0.5;
            id = fract(id * 7.31 + floor(fv * 2.0) * 0.37);
            fv = fract(fv * 2.0);
        }
        float fu = fract(u);
        return vec2(min(min(fu, 1.0 - fu) * w, min(fv, 1.0 - fv) * h), id);
    }`

// Face-aligned layout. The facet's own normal (from the derivatives of the
// surface position, so it needs no attribute) picks the projection; X is
// mirrored so both flanks of a ship carry the same plating. The biases keep
// a 45 degree chamfer from flickering between two projections.
const SURFACE_FRAME_GLSL = /* glsl */`
    vec3 sp = vSurfPos;
    vec3 spDx = dFdx(sp);
    vec3 spDy = dFdy(sp);
    float spPx = max(length(spDx), length(spDy));
    vec3 spN = abs(cross(spDx, spDy));
    int spAxis = spN.y * 1.15 > max(spN.x, spN.z) ? 1 : (spN.x * 1.07 > spN.z ? 0 : 2);
    vec2 spQ = spAxis == 1 ? vec2(sp.z, abs(sp.x)) : (spAxis == 0 ? vec2(sp.z, sp.y) : vec2(abs(sp.x), sp.y));
    float surfH = 0.0;`

interface SurfaceSpec {
    key: string
    rim: number
    /** Runs after the vertex colour is applied: shapes diffuseColor and the height `surfH` (in model units). */
    albedo: string
    /** Runs after roughnessFactor and metalnessFactor are read. */
    gloss?: string
    /** Runs on outgoingLight just before it is written. */
    light?: string
}

/**
 * Gives a standard material a procedural surface: object-space detail in the
 * albedo and gloss, a derivative bump laid over the flat facet normal, and the
 * sector rim light. Each spec compiles to one shared program.
 */
function withSurface(material: THREE.MeshStandardMaterial, spec: SurfaceSpec) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uRimColor = RIM_COLOR
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `
                #include <common>
                attribute float heat;
                varying vec3 vSurfPos;
                varying float vSurfScale;
                varying float vSurfHeat;`)
            .replace('#include <begin_vertex>', `
                #include <begin_vertex>
                float surfScale = length(modelMatrix[0].xyz);
                #ifdef USE_INSTANCING
                    surfScale *= length(instanceMatrix[0].xyz);
                #endif
                // Scaled-up models get somewhat finer detail, so a big hostile is not a magnified toy.
                vSurfPos = position * pow(surfScale, 0.6);
                vSurfScale = pow(surfScale, 0.4);
                vSurfHeat = heat;`)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${SURFACE_GLSL}`)
            .replace('#include <color_fragment>', `#include <color_fragment>\n${SURFACE_FRAME_GLSL}\n${spec.albedo}`)
            .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${spec.gloss ?? ''}`)
            .replace('#include <normal_fragment_maps>', `
                #include <normal_fragment_maps>
                {
                    vec2 dH = vec2(dFdx(surfH), dFdy(surfH)) * vSurfScale;
                    vec3 sx = dFdx(-vViewPosition);
                    vec3 sy = dFdy(-vViewPosition);
                    vec3 r1 = cross(sy, normal);
                    vec3 r2 = cross(normal, sx);
                    float det = dot(sx, r1) * faceDirection;
                    vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
                    normal = normalize(abs(det) * normal - grad);
                }`)
            .replace('#include <opaque_fragment>', `
                float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
                outgoingLight += uRimColor * rim * ${spec.rim.toFixed(2)};
                ${spec.light ?? ''}
                #include <opaque_fragment>`)
    }
    material.customProgramCacheKey = () => `void-surface-${spec.key}`
    return material
}

/**
 * Painted hull plating. The vertex colour is the paint; the shader lays two
 * scales of recessed panel seams over it, shifts each panel's tone a few
 * percent, gathers grime in the seams, chips the paint along them, streaks the
 * hull fore to aft and scorches it around the engines. Every layer fades out
 * as it approaches a pixel in size, so a distant ship is clean, not noisy.
 */
export const HULL_MATERIAL = withSurface(new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0.45,
    roughness: 0.6,
    envMapIntensity: 0.65
}), {
    key: 'hull',
    rim: 0.45,
    albedo: /* glsl */`
        vec2 panA = surfPanels(spQ, 0.62, 3.7);
        vec2 panB = surfPanels(spQ + 0.31, 2.3, 8.1);
        float fadeA = 1.0 - smoothstep(0.03, 0.11, spPx);
        float fadeB = 1.0 - smoothstep(0.1, 0.4, spPx);
        // Seams never get thinner than a pixel; they get fainter instead.
        float seamWA = max(0.014, spPx * 1.1);
        float seamWB = max(0.024, spPx * 1.1);
        float seamA = (1.0 - smoothstep(seamWA * 0.45, seamWA, panA.x)) * (0.014 / seamWA) * fadeA;
        float seamB = (1.0 - smoothstep(seamWB * 0.45, seamWB, panB.x)) * (0.024 / seamWB) * fadeB;
        float seam = max(seamA, seamB);
        float seamDist = min(panA.x + (1.0 - fadeA), panB.x + (1.0 - fadeB));

        float blotch = surfNoise(sp * 1.35 + 4.0);
        float streakFade = 1.0 - smoothstep(0.04, 0.16, spPx);
        float streak = (surfNoise(vec3(sp.x * 5.5, sp.y * 5.5, sp.z * 0.32)) - 0.5) * streakFade;
        float grainFade = 1.0 - smoothstep(0.006, 0.024, spPx);
        float grain = (surfNoise(sp * 46.0) - 0.5) * grainFade;

        float tone = 1.0 + (panA.y - 0.5) * 0.1 * fadeA + (panB.y - 0.5) * 0.07 * fadeB;
        tone -= step(0.9, panA.y) * 0.06 * fadeA;
        tone += (blotch - 0.5) * 0.1 + streak * 0.14 + grain * 0.07;
        // Grime pools in the seams and creeps out from them where the hull is dirtiest.
        float grime = (1.0 - smoothstep(0.0, 0.16, seamDist)) * smoothstep(0.35, 0.8, blotch) * fadeA;
        float soot = vSurfHeat * (0.75 + streak * 0.8);
        tone *= (1.0 - grime * 0.22) * (1.0 - seam * 0.62) * (1.0 - soot * 0.6);
        diffuseColor.rgb *= tone;
        // Paint chipped back to bare alloy along the seam edges.
        float wear = smoothstep(0.012, 0.022, seamDist) * (1.0 - smoothstep(0.03, 0.075, seamDist));
        wear *= (1.0 - smoothstep(0.2, 0.5, blotch)) * (0.5 + grain + 0.5 * (1.0 - grainFade)) * (1.0 - smoothstep(0.012, 0.05, spPx));
        wear = saturate(wear);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.63, 0.68), wear * 0.55);
        surfH = -seamA * 0.016 - seamB * 0.03 + grain * 0.0016;`,
    gloss: /* glsl */`
        roughnessFactor += (blotch - 0.5) * 0.26 + (panA.y - 0.5) * 0.12 * fadeA + streak * 0.2 + grain * 0.18;
        roughnessFactor += grime * 0.2 + soot * 0.3 - wear * 0.3;
        roughnessFactor = clamp(roughnessFactor, 0.2, 1.0);
        metalnessFactor = saturate(metalnessFactor + wear * 0.5 - soot * 0.3);`
})

/**
 * Asteroid rock. The mesh carries the big forms; the fine grain, pits and
 * cracks are a procedural bump and albedo in the shader, laid out in the
 * rock's own space so they turn with it and hold up at any size.
 */
export const ROCK_MATERIAL = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.08,
    roughness: 0.92,
    envMapIntensity: 0.35
})
ROCK_MATERIAL.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = RIM_COLOR
    shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;\nvarying float vRockScale;')
        .replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vRockPos = position;
            #ifdef USE_INSTANCING
                vRockScale = length(instanceMatrix[0].xyz);
            #else
                vRockScale = 1.0;
            #endif`)
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `
            #include <common>
            uniform vec3 uRimColor;
            varying vec3 vRockPos;
            varying float vRockScale;
            float rockHash(vec3 p) {
                p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
                p *= 17.0;
                return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
            }
            float rockNoise(vec3 p) {
                vec3 i = floor(p);
                vec3 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(
                    mix(mix(rockHash(i), rockHash(i + vec3(1, 0, 0)), f.x), mix(rockHash(i + vec3(0, 1, 0)), rockHash(i + vec3(1, 1, 0)), f.x), f.y),
                    mix(mix(rockHash(i + vec3(0, 0, 1)), rockHash(i + vec3(1, 0, 1)), f.x), mix(rockHash(i + vec3(0, 1, 1)), rockHash(i + vec3(1, 1, 1)), f.x), f.y),
                    f.z);
            }
            // Soft swells broken by ridged octaves: pitted, weathered stone rather than blobs.
            const mat3 ROCK_TURN = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
            float rockHeight(vec3 p, float fine) {
                float h = rockNoise(p * 0.55) * 0.5;
                float a = 0.4;
                vec3 q = p * 1.2;
                for (int i = 0; i < 4; i++) {
                    float n = rockNoise(q);
                    float ridge = 1.0 - abs(n * 2.0 - 1.0);
                    h += a * mix(n, ridge * ridge, 0.55) * (i < 2 ? 1.0 : fine);
                    q = ROCK_TURN * q * 2.17 + vec3(1.7, 9.2, 3.1);
                    a *= 0.5;
                }
                return h;
            }`)
        .replace('#include <color_fragment>', `
            #include <color_fragment>
            // A mountain gets proportionally finer grain than a pebble, so neither looks stretched.
            float rockFreq = 4.2 * max(1.0, vRockScale / 9.0);
            vec3 rockP = vRockPos * rockFreq;
            // Drop the finest octaves once they fall below a pixel, or distant rock shimmers.
            float rockFine = 1.0 - smoothstep(0.05, 0.3, length(fwidth(rockP)));
            float rockH = rockHeight(rockP, rockFine);
            float rockPatch = rockNoise(vRockPos * 1.6 + 11.0);
            diffuseColor.rgb *= (0.5 + rockH * 0.7) * (0.8 + rockPatch * 0.4);`)
        .replace('#include <normal_fragment_maps>', `
            #include <normal_fragment_maps>
            {
                vec2 dH = vec2(dFdx(rockH), dFdy(rockH)) * vRockScale / rockFreq * 0.34;
                vec3 sx = dFdx(-vViewPosition);
                vec3 sy = dFdy(-vViewPosition);
                vec3 r1 = cross(sy, normal);
                vec3 r2 = cross(normal, sx);
                float det = dot(sx, r1) * faceDirection;
                vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
                normal = normalize(abs(det) * normal - grad);
            }`)
        .replace('#include <opaque_fragment>', `
            float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
            outgoingLight += uRimColor * rim * 0.30;
            #include <opaque_fragment>`)
}
ROCK_MATERIAL.customProgramCacheKey = () => 'void-rock'

/**
 * Bare machinery: darker, shinier, catches the environment. Machined with a
 * fine lathe grain that runs around anything lying along the ship, polished
 * and dull patches so highlights break up, and tempering colours (straw to
 * violet to blue) where it sits next to an engine.
 */
export const METAL_MATERIAL = withSurface(new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0.9,
    roughness: 0.34,
    envMapIntensity: 1.25
}), {
    key: 'metal',
    rim: 0.35,
    albedo: /* glsl */`
        vec3 brushAxis = spAxis == 2 ? vec3(5.0, 34.0, 5.0) : vec3(5.0, 5.0, 34.0);
        float brushFadeA = 1.0 - smoothstep(0.008, 0.03, spPx);
        float brushFadeB = 1.0 - smoothstep(0.003, 0.012, spPx);
        float brush = (surfNoise(sp * brushAxis) - 0.5) * brushFadeA + (surfNoise(sp * brushAxis * 2.7 + 5.0) - 0.5) * 0.6 * brushFadeB;
        float blotch = surfNoise(sp * 2.4 + 9.0);
        diffuseColor.rgb *= 1.0 + brush * 0.16 + (blotch - 0.5) * 0.14;
        float heatT = saturate(vSurfHeat * (0.8 + blotch * 0.5));
        vec3 temper = mix(vec3(1.0, 0.72, 0.38), vec3(0.62, 0.4, 0.95), smoothstep(0.35, 0.65, heatT));
        temper = mix(temper, vec3(0.3, 0.55, 1.0), smoothstep(0.65, 0.95, heatT));
        diffuseColor.rgb = mix(diffuseColor.rgb, (diffuseColor.rgb + 0.12) * temper * 1.5, smoothstep(0.08, 0.4, heatT) * 0.7);
        surfH = brush * 0.0022;`,
    gloss: /* glsl */`
        roughnessFactor = clamp(roughnessFactor + (blotch - 0.5) * 0.34 + brush * 0.3, 0.12, 0.8);`
})

/**
 * Cockpit glass: near black and deep, with a hard reflection of the nebula,
 * a bright fresnel edge, a sliding reflection streak and a faint lit interior
 * that shows when you look straight in.
 */
export const GLASS_MATERIAL = withSurface(new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 1,
    roughness: 0.06,
    envMapIntensity: 2
}), {
    key: 'glass',
    rim: 0,
    albedo: '',
    light: /* glsl */`
        vec3 glassV = normalize(vViewPosition);
        float glassFacing = saturate(dot(normal, glassV));
        float glassEdge = pow(1.0 - glassFacing, 3.0);
        outgoingLight += (uRimColor * 1.3 + 0.1) * glassEdge;
        vec3 glassR = reflect(-glassV, normal);
        float glassBand = fract(dot(glassR, vec3(0.55, 0.8, 0.2)) * 1.4 + sp.z * 0.21 + sp.y * 0.33);
        float glassStreak = smoothstep(0.4, 0.44, glassBand) * (1.0 - smoothstep(0.5, 0.54, glassBand))
            + 0.5 * smoothstep(0.6, 0.62, glassBand) * (1.0 - smoothstep(0.64, 0.66, glassBand));
        outgoingLight += vec3(0.7, 0.85, 1.0) * glassStreak * (0.1 + glassEdge * 0.5);
        outgoingLight += (vColor.rgb + vec3(0.015, 0.04, 0.06)) * glassFacing * glassFacing * (0.35 + 0.3 * surfNoise(sp * 2.6));`
})

export const GLOW_MATERIAL = new THREE.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false
})

// ─── Primitive geometry ────────────────────────────────────────────────────

export type Vec3 = [number, number, number]

/** A box whose front (-Z) face is scaled by taper — noses, fuselages, blades. */
export function wedge(w: number, h: number, l: number, taperX = 0.3, taperY = 0.5, backX = 1, backY = 1) {
    const g = new THREE.BoxGeometry(w, h, l)
    const pos = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i)
        if (z < 0) {
            pos.setX(i, pos.getX(i) * taperX)
            pos.setY(i, pos.getY(i) * taperY)
        } else {
            pos.setX(i, pos.getX(i) * backX)
            pos.setY(i, pos.getY(i) * backY)
        }
    }
    return g
}

/** A flat 2D outline (x, z) extruded to `thickness` along Y. */
export function plate(points: [number, number][], thickness: number) {
    const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
    g.rotateX(Math.PI / 2)
    g.translate(0, thickness / 2, 0)
    return g
}

export function cyl(rTop: number, rBottom: number, h: number, segments = 8) {
    return new THREE.CylinderGeometry(rTop, rBottom, h, segments)
}

/** Cylinder lying along Z. */
export function tube(rFront: number, rBack: number, l: number, segments = 8) {
    return new THREE.CylinderGeometry(rFront, rBack, l, segments).rotateX(-Math.PI / 2)
}

export function octa(r: number) {
    return new THREE.OctahedronGeometry(r, 0)
}

export function ico(r: number, detail = 0) {
    return new THREE.IcosahedronGeometry(r, detail)
}

export function ring(r: number, tube: number, radial = 6, tubular = 16) {
    return new THREE.TorusGeometry(r, tube, radial, tubular)
}

// ─── Builder ───────────────────────────────────────────────────────────────

export interface Hardpoint {
    position: THREE.Vector3
    /** Outward normal: which way the turret's base faces. */
    normal: THREE.Vector3
}

export interface BuiltModel {
    group: THREE.Group
    hardpoints: Hardpoint[]
    /** Engine nozzle positions and radii, for flames and trails. */
    engines: { position: THREE.Vector3, radius: number }[]
    radius: number
}

const tmpMatrix = new THREE.Matrix4()
const tmpQuat = new THREE.Quaternion()
const tmpEuler = new THREE.Euler()

function prepare(geo: THREE.BufferGeometry, color: THREE.Color, pos: Vec3, rot: Vec3, scale: Vec3) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    g.deleteAttribute('uv')
    g.deleteAttribute('normal')
    tmpEuler.set(rot[0], rot[1], rot[2])
    tmpQuat.setFromEuler(tmpEuler)
    tmpMatrix.compose(new THREE.Vector3(...pos), tmpQuat, new THREE.Vector3(...scale))
    g.applyMatrix4(tmpMatrix)
    // A negative scale flips the winding, so turn the triangles back around.
    if (scale[0] * scale[1] * scale[2] < 0) {
        const p = g.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < p.count; i += 3) {
            for (let k = 0; k < 3; k++) {
                const a = p.getComponent(i + 1, k)
                p.setComponent(i + 1, k, p.getComponent(i + 2, k))
                p.setComponent(i + 2, k, a)
            }
        }
    }
    const count = g.attributes.position!.count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
        colors[i * 3] = color.r
        colors[i * 3 + 1] = color.g
        colors[i * 3 + 2] = color.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeVertexNormals()
    if (g !== geo) geo.dispose()
    return g
}

/**
 * How hot each vertex runs, from its distance to the nearest nozzle. The
 * shaders turn it into tempering colours on bare metal and soot on paint.
 */
function bakeHeat(geo: THREE.BufferGeometry, engines: { position: THREE.Vector3, radius: number }[]) {
    const pos = geo.attributes.position as THREE.BufferAttribute
    const heat = new Float32Array(pos.count)
    const p = new THREE.Vector3()
    for (let i = 0; i < pos.count && engines.length; i++) {
        p.fromBufferAttribute(pos, i)
        let h = 0
        for (const e of engines) h = Math.max(h, 1 - (p.distanceTo(e.position) - e.radius * 0.9) / (e.radius * 2.6))
        heat[i] = Math.min(1, h)
    }
    geo.setAttribute('heat', new THREE.BufferAttribute(heat, 1))
    return geo
}

export class ModelBuilder {
    private solids: THREE.BufferGeometry[] = []
    private metals: THREE.BufferGeometry[] = []
    private glasses: THREE.BufferGeometry[] = []
    private glows: THREE.BufferGeometry[] = []
    hardpoints: Hardpoint[] = []
    engines: { position: THREE.Vector3, radius: number }[] = []
    extra: THREE.Object3D[] = []

    /** Adds a solid part. Pass `mirror` to also add its reflection across X. */
    solid(geo: THREE.BufferGeometry, color: number, pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1], mirror = false) {
        const c = new THREE.Color(color)
        if (mirror) {
            this.solids.push(prepare(geo.clone(), c, [-pos[0], pos[1], pos[2]], [rot[0], -rot[1], -rot[2]], [-scale[0], scale[1], scale[2]]))
        }
        this.solids.push(prepare(geo, c, pos, rot, scale))
        return this
    }

    /** Bare metal part: machinery, nozzles, barrels. */
    metal(geo: THREE.BufferGeometry, color: number, pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1], mirror = false) {
        const c = new THREE.Color(color)
        if (mirror) this.metals.push(prepare(geo.clone(), c, [-pos[0], pos[1], pos[2]], [rot[0], -rot[1], -rot[2]], [-scale[0], scale[1], scale[2]]))
        this.metals.push(prepare(geo, c, pos, rot, scale))
        return this
    }

    /** Glass part: canopies and viewports. */
    glass(geo: THREE.BufferGeometry, color: number, pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1], mirror = false) {
        const c = new THREE.Color(color)
        if (mirror) this.glasses.push(prepare(geo.clone(), c, [-pos[0], pos[1], pos[2]], [rot[0], -rot[1], -rot[2]], [-scale[0], scale[1], scale[2]]))
        this.glasses.push(prepare(geo, c, pos, rot, scale))
        return this
    }

    /** Adds an unlit glowing part. Intensity above 1 is what the bloom picks up. */
    glow(geo: THREE.BufferGeometry, color: number, intensity: number, pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1], mirror = false) {
        const c = new THREE.Color(color).multiplyScalar(intensity)
        if (mirror) {
            this.glows.push(prepare(geo.clone(), c, [-pos[0], pos[1], pos[2]], [rot[0], -rot[1], -rot[2]], [-scale[0], scale[1], scale[2]]))
        }
        this.glows.push(prepare(geo, c, pos, rot, scale))
        return this
    }

    hardpoint(pos: Vec3, normal: Vec3 = [0, 1, 0], mirror = false) {
        this.hardpoints.push({ position: new THREE.Vector3(...pos), normal: new THREE.Vector3(...normal).normalize() })
        if (mirror) this.hardpoints.push({ position: new THREE.Vector3(-pos[0], pos[1], pos[2]), normal: new THREE.Vector3(-normal[0], normal[1], normal[2]).normalize() })
        return this
    }

    /** A nozzle: dark bell, hot glowing core, recorded for flames. */
    engine(pos: Vec3, r: number, mirror = false, glowColor = 0x6fd8ff) {
        const place = (p: Vec3) => {
            this.metal(tube(r * 1.05, r * 1.3, r * 1.2, 10), 0x2a2f38, [p[0], p[1], p[2] + r * 0.2])
            this.metal(ring(r * 1.28, r * 0.08, 4, 10), 0x6c7684, [p[0], p[1], p[2] + r * 0.8])
            this.glow(new THREE.CircleGeometry(r * 0.88, 10), glowColor, 0.55, [p[0], p[1], p[2] + r * 0.8])
            this.glow(new THREE.CircleGeometry(r * 0.48, 10), glowColor, 2.4, [p[0], p[1], p[2] + r * 0.82])
            this.engines.push({ position: new THREE.Vector3(p[0], p[1], p[2] + r * 0.85), radius: r })
        }
        place(pos)
        if (mirror) place([-pos[0], pos[1], pos[2]])
        return this
    }

    build(): BuiltModel {
        const group = new THREE.Group()
        if (this.solids.length) {
            const mesh = new THREE.Mesh(bakeHeat(mergeGeometries(this.solids), this.engines), HULL_MATERIAL)
            mesh.name = 'hull'
            group.add(mesh)
        }
        if (this.metals.length) {
            const mesh = new THREE.Mesh(bakeHeat(mergeGeometries(this.metals), this.engines), METAL_MATERIAL)
            mesh.name = 'hull'
            group.add(mesh)
        }
        if (this.glasses.length) {
            const mesh = new THREE.Mesh(mergeGeometries(this.glasses), GLASS_MATERIAL)
            mesh.name = 'glass'
            group.add(mesh)
        }
        if (this.glows.length) {
            const mesh = new THREE.Mesh(mergeGeometries(this.glows), GLOW_MATERIAL)
            mesh.name = 'glow'
            group.add(mesh)
        }
        for (const o of this.extra) group.add(o)
        for (const g of [...this.solids, ...this.metals, ...this.glasses, ...this.glows]) g.dispose()
        const box = new THREE.Box3().setFromObject(group)
        const size = new THREE.Vector3()
        box.getSize(size)
        return { group, hardpoints: this.hardpoints, engines: this.engines, radius: Math.max(size.x, size.y, size.z) / 2 }
    }
}


// ─── Turrets and drones ────────────────────────────────────────────────────

export interface TurretModel {
    root: THREE.Group
    /** Rotates around the mount's local Y. */
    yaw: THREE.Group
    /** Rotates around its local X to elevate the barrels. */
    pitch: THREE.Group
    /** Recoils along +Z when firing. */
    barrel: THREE.Group
    /** Local muzzle offset inside `barrel`. */
    muzzle: THREE.Vector3
}
