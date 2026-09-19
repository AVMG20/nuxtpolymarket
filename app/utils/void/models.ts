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

function withRim(material: THREE.MeshStandardMaterial, strength: number) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uRimColor = RIM_COLOR
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;')
            .replace('#include <opaque_fragment>', `
                float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
                outgoingLight += uRimColor * rim * ${strength.toFixed(2)};
                #include <opaque_fragment>`)
    }
    material.customProgramCacheKey = () => `rim-${strength}`
    return material
}

export const HULL_MATERIAL = withRim(new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0.45,
    roughness: 0.62,
    envMapIntensity: 0.6
}), 0.45)

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

/** Bare machinery: darker, shinier, catches the environment. */
export const METAL_MATERIAL = withRim(new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0.85,
    roughness: 0.32,
    envMapIntensity: 1
}), 0.35)

/** Cockpit glass: near black with a hard reflection of the nebula. */
export const GLASS_MATERIAL = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 1,
    roughness: 0.08,
    envMapIntensity: 1.8
})

export const GLOW_MATERIAL = new THREE.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false
})

// ─── Primitive geometry ────────────────────────────────────────────────────

type Vec3 = [number, number, number]

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
            const mesh = new THREE.Mesh(mergeGeometries(this.solids), HULL_MATERIAL)
            mesh.name = 'hull'
            group.add(mesh)
        }
        if (this.metals.length) {
            const mesh = new THREE.Mesh(mergeGeometries(this.metals), METAL_MATERIAL)
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

const DARK = 0x2c323c

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

// ─── Enemies ───────────────────────────────────────────────────────────────

const E_HULL = 0x6d6268
const E_DARK = 0x2a2328
const E_PLATE = 0x9a8c90
const E_PAINT = 0xa3202f

export function buildEnemy(kind: string, glow: number, scale = 1): BuiltModel {
    const b = new ModelBuilder()
    switch (kind) {
        case 'mite':
            b.solid(new THREE.TetrahedronGeometry(0.7), E_PAINT, [0, 0, 0], [0.6, 0.3, 0])
            b.solid(wedge(0.2, 0.2, 1.2, 0.1, 0.1), E_DARK, [0.5, 0, 0], [0, 0, 0], [1, 1, 1], true)
            b.glow(octa(0.28), glow, 4)
            break
        case 'raider':
            b.solid(wedge(0.8, 0.5, 2.6, 0.2, 0.4), E_HULL, [0, 0, 0])
            b.solid(plate([[0.2, -0.9], [1.7, -0.2], [1.6, 0.9], [0.3, 0.8]], 0.08), E_PLATE, [0, 0, 0], [0, 0, -0.2], [1, 1, 1], true)
            b.solid(plate([[1.2, -0.45], [1.7, -0.2], [1.62, 0.5], [1.15, 0.4]], 0.1), E_PAINT, [0, 0.01, 0], [0, 0, -0.2], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.05, 0.05, 1.0), glow, 2, [1.62, -0.33, 0.35], [0, 0, 0], [1, 1, 1], true)
            b.solid(tube(0.06, 0.08, 0.9, 5), E_DARK, [1.2, -0.1, -0.5], [0, 0, 0], [1, 1, 1], true)
            b.glow(octa(0.2), glow, 2.5, [0, 0.2, -0.4], [0, 0, 0], [1, 0.6, 1.8])
            b.engine([0.3, 0, 1.3], 0.18, true, glow)
            break
        case 'lancer':
            b.solid(wedge(0.5, 0.5, 4.2, 0.1, 0.1), E_HULL)
            b.solid(tube(0.08, 0.12, 2.6, 6), E_DARK, [0, -0.3, -1.8])
            b.solid(plate([[0.1, 0.2], [1.2, 1.4], [1.1, 1.7], [0.1, 1.5]], 0.06), E_PLATE, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
            b.solid(plate([[0, 0.2], [0.5, 1.4], [0.4, 1.7], [0, 1.5]], 0.06), E_PLATE, [0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], true)
            b.glow(octa(0.14), glow, 4, [0, -0.3, -3.15])
            b.glow(new THREE.BoxGeometry(0.05, 0.05, 1.8), glow, 2, [0, 0.26, -0.2])
            b.solid(wedge(0.55, 0.2, 1.4, 0.4, 0.5), E_PAINT, [0, 0.24, 0.9])
            b.engine([0, 0, 2.1], 0.22, false, glow)
            break
        case 'bulwark':
            b.solid(new THREE.CylinderGeometry(1.4, 1.6, 3.2, 6).rotateX(Math.PI / 2), E_HULL)
            b.solid(new THREE.BoxGeometry(3.8, 0.6, 1.6), E_PLATE, [0, 0, 0.5])
            b.solid(new THREE.BoxGeometry(0.4, 1.2, 2.4), E_PAINT, [1.95, 0, 0.2], [0, 0, 0], [1, 1, 1], true)
            b.solid(new THREE.CylinderGeometry(2.2, 2.4, 0.4, 6).rotateX(Math.PI / 2), E_PLATE, [0, 0, -1.7])
            b.solid(tube(0.2, 0.25, 1.4, 6), E_DARK, [0.7, 0.8, -1.4], [0, 0, 0], [1, 1, 1], true)
            b.glow(ring(0.9, 0.08, 4, 6), glow, 2.5, [0, 0, -1.62])
            b.engine([0.8, 0, 1.8], 0.35, true, glow)
            break
        case 'minelayer':
            b.solid(ico(1.4, 0), E_HULL, [0, 0, 0], [0, 0, 0], [1.2, 0.8, 1.4])
            b.solid(new THREE.BoxGeometry(1.6, 0.9, 1.0), E_DARK, [0, -0.2, 1.4])
            b.solid(plate([[0.8, -0.6], [2.2, 0.4], [2.0, 0.8], [0.8, 0.6]], 0.1), E_PLATE, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(1.0, 0.5, 0.05), glow, 2.2, [0, -0.2, 1.92])
            b.solid(wedge(1.2, 0.3, 2.2, 0.5, 0.5), E_PAINT, [0, 0.95, 0])
            b.glow(octa(0.25), glow, 2.5, [0, 0.9, -0.4])
            break
        case 'leech':
            b.solid(ico(0.8, 0), E_HULL, [0, 0, 0], [0, 0, 0], [1, 0.8, 1.2])
            for (let i = 0; i < 4; i++) b.solid(tube(0.35 - i * 0.07, 0.3 - i * 0.07, 0.6, 6), i % 2 ? E_DARK : E_PLATE, [0, 0, 0.8 + i * 0.55])
            b.solid(wedge(0.15, 0.15, 1.2, 0.1, 0.1), E_DARK, [0.4, 0, -1.1], [0, 0.35, 0], [1, 1, 1], true)
            b.glow(octa(0.25), glow, 4, [0, 0, -0.7])
            b.solid(octa(0.5), E_PAINT, [0, 0.45, 0.1], [0, 0, 0], [0.8, 0.6, 1.4])
            break
        case 'blinker':
            b.solid(octa(1.0), E_HULL, [0, 0, 0], [0, 0, 0], [0.8, 1.2, 1.4])
            b.solid(octa(0.7), E_PAINT, [0, 0, -0.35], [0, 0, 0], [0.62, 0.9, 1.1])
            b.glow(ring(1.3, 0.06, 4, 20), glow, 2.2, [0, 0, 0], [Math.PI / 2, 0, 0])
            b.glow(ring(1.0, 0.05, 4, 20), glow, 1.6, [0, 0, 0], [0, 0, 0])
            b.glow(octa(0.3), glow, 4)
            break
        case 'carrier':
            b.solid(wedge(4.0, 2.4, 11, 0.4, 0.5), E_HULL)
            b.solid(new THREE.BoxGeometry(6.4, 1.4, 5.0), E_PLATE, [0, -0.2, 1.8])
            b.solid(new THREE.BoxGeometry(1.2, 2.2, 3.0), E_DARK, [0, 1.8, 2.0])
            b.solid(wedge(2.6, 0.3, 6, 0.3, 0.5), E_PAINT, [0, 1.22, -1.5])
            for (let i = 0; i < 3; i++) b.glow(new THREE.BoxGeometry(0.05, 0.8, 1.0), glow, 2.2, [3.22, -0.2, 0.6 + i * 1.3], [0, 0, 0], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(1.0, 0.1, 0.1), glow, 3, [0, 3.0, 1.0])
            b.engine([1.3, 0, 5.6], 0.7, true, glow)
            b.hardpoint([0, 1.2, -3], [0, 1, 0])
            break
        case 'sentinel':
            b.solid(ico(1.5, 1), E_HULL)
            b.solid(ring(2.2, 0.35, 4, 8), E_DARK, [0, 0, 0], [Math.PI / 2, 0, 0])
            b.solid(tube(0.25, 0.35, 2.0, 6), E_PLATE, [0, 0, -1.8])
            b.solid(ring(1.7, 0.18, 4, 8), E_PAINT, [0, 0, -0.9])
            b.glow(octa(0.35), glow, 4, [0, 0, -2.9])
            b.glow(ring(1.55, 0.06, 4, 16), glow, 1.8)
            break
        case 'freighter':
            // Smuggler hauler: long spine, stacked containers, fat engines.
            b.solid(wedge(2.4, 1.8, 3, 0.55, 0.6), E_HULL, [0, 0.2, -5.2])
            b.solid(new THREE.BoxGeometry(1.2, 1.0, 9), E_DARK, [0, 0, 0.6])
            for (let i = 0; i < 4; i++) {
                for (const side of [-1, 1]) {
                    b.solid(new THREE.BoxGeometry(1.5, 1.5, 1.9), i % 2 ? 0x8a5a2b : 0x5b6f8a, [side * 1.4, 0.2, -2.6 + i * 2.1])
                    b.solid(new THREE.BoxGeometry(1.55, 0.12, 1.95), E_DARK, [side * 1.4, 0.98, -2.6 + i * 2.1])
                }
                b.glow(new THREE.BoxGeometry(0.06, 0.3, 0.3), glow, 2, [2.2, 0.2, -2.6 + i * 2.1], [0, 0, 0], [1, 1, 1], true)
            }
            b.solid(new THREE.BoxGeometry(2.6, 2.0, 2.2), E_PLATE, [0, 0.3, 5.6])
            b.glow(new THREE.BoxGeometry(1.4, 0.2, 0.05), 0xffe6b0, 1.5, [0, 1.0, -6.72])
            b.engine([0.8, 0.3, 6.8], 0.7, true, glow)
            break
        case 'meteor':
            b.solid(ico(1.4, 1), 0x3a2a24, [0, 0, 0], [0.4, 0.2, 0.1], [1, 0.85, 1.1])
            b.glow(ico(1.45, 0), 0xff7a2e, 1.6, [0, 0, 0.1], [0.1, 0.7, 0], [0.9, 0.7, 1.05])
            break
        case 'vault':
            b.solid(new THREE.BoxGeometry(3.4, 2.6, 4.2), 0x4a525e)
            b.solid(new THREE.BoxGeometry(3.6, 0.4, 4.4), E_DARK, [0, 1.4, 0])
            b.solid(new THREE.BoxGeometry(3.6, 0.4, 4.4), E_DARK, [0, -1.4, 0])
            for (const z of [-2.12, 2.12]) b.glow(new THREE.BoxGeometry(2.6, 0.2, 0.05), glow, 3, [0, 0, z])
            b.glow(ring(0.8, 0.08, 4, 16), glow, 3, [1.72, 0, 0], [0, Math.PI / 2, 0], [1, 1, 1], true)
            break
        case 'mine':
            b.solid(ico(0.6, 0), E_DARK)
            for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]) {
                b.solid(new THREE.ConeGeometry(0.12, 0.6, 4), E_PLATE, [d[0] * 0.7, d[1] * 0.7, d[2] * 0.7], [d[2] * Math.PI / 2, 0, -d[0] * Math.PI / 2 + (d[1] < 0 ? Math.PI : 0)])
            }
            b.glow(octa(0.25), glow, 4)
            break
    }
    const built = b.build()
    built.group.scale.setScalar(scale)
    built.radius *= scale
    return built
}

/** The sector warden: a burning core cradled by armoured petals, inside a rotating ring of blades. */
export function buildWarden(tier: number, glow: number) {
    const arms = 3 + Math.min(3, tier)
    const shellB = new ModelBuilder()
    // Core
    shellB.glow(ico(2.6, 0), glow, 4.5)
    shellB.glow(ico(1.6, 0), 0xffffff, 3, [0, 0, 0], [0.5, 0.5, 0])
    // Petals: six armour plates wrapping the core, open at the front.
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        const x = Math.cos(a) * 3.6
        const y = Math.sin(a) * 3.6
        shellB.solid(wedge(3.2, 1.2, 9, 0.35, 0.5), 0x8a7880, [x, y, 1.2], [Math.sin(a) * 0.35, -Math.cos(a) * 0.35, a + Math.PI / 2])
        shellB.solid(wedge(2.2, 0.6, 7, 0.3, 0.5), 0x2b2328, [x * 1.12, y * 1.12, 1.6], [Math.sin(a) * 0.35, -Math.cos(a) * 0.35, a + Math.PI / 2])
        shellB.glow(new THREE.BoxGeometry(0.18, 0.18, 6.5), glow, 2.6, [x * 0.82, y * 0.82, 1.0], [Math.sin(a) * 0.35, -Math.cos(a) * 0.35, 0])
    }
    // Spine and engines behind.
    shellB.solid(tube(2.2, 3.4, 6, 8), 0x3a3036, [0, 0, 7])
    shellB.solid(ring(3.6, 0.5, 4, 8), 0x8a7880, [0, 0, 9.6])
    shellB.glow(new THREE.CircleGeometry(2.4, 8), glow, 3, [0, 0, 10.05])
    shellB.glow(ring(5.4, 0.1, 4, 36), glow, 2.2, [0, 0, -2.5])
    const shell = shellB.build()

    const rb = new ModelBuilder()
    rb.solid(ring(11, 0.8, 4, 6 * arms), 0x3a3036)
    rb.glow(ring(11, 0.18, 4, 6 * arms), glow, 1.8, [0, 0, -0.75])
    for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2
        const x = Math.cos(a) * 11
        const y = Math.sin(a) * 11
        rb.solid(wedge(2.2, 2.2, 7, 0.1, 0.35), 0x8a7880, [x, y, -2], [0, 0, a])
        rb.solid(new THREE.BoxGeometry(1.2, 4, 1.2), 0x2b2328, [x * 0.9, y * 0.9, 0], [0, 0, a + Math.PI / 2])
        rb.glow(octa(0.9), glow, 4.5, [x, y, -5.8])
        rb.hardpoint([x, y, -5.6], [Math.cos(a), Math.sin(a), 0])
    }
    const ringModel = rb.build()
    const group = new THREE.Group()
    group.add(shell.group)
    const ringGroup = ringModel.group
    ringGroup.name = 'ring'
    group.add(ringGroup)
    return { group, ring: ringGroup, emitters: ringModel.hardpoints.map(h => h.position), radius: 12 }
}

// ─── Structures ────────────────────────────────────────────────────────────

export function buildCrate(color: number) {
    const b = new ModelBuilder()
    b.solid(new THREE.BoxGeometry(2, 1.4, 2.8), 0x4a525e)
    b.solid(new THREE.BoxGeometry(2.1, 0.3, 2.9), DARK, [0, 0.4, 0])
    b.glow(new THREE.BoxGeometry(2.14, 0.12, 0.12), color, 3, [0, -0.2, 1.1])
    b.glow(new THREE.BoxGeometry(2.14, 0.12, 0.12), color, 3, [0, -0.2, -1.1])
    return b.build()
}
