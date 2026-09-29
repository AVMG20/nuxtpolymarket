// Call of Xeno — level building kit.
//
// Shared plumbing for env-models.ts and level.ts: world-space UV baking, a
// geometry batcher that merges everything per material and per spatial chunk,
// quad helpers, and the handful of small shaders (light beams, sky dome, dust)
// the level uses. Kept separate so both files stay about what they draw.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export { makeRng } from './textures'

// ---------------------------------------------------------------------------
// UV baking
// ---------------------------------------------------------------------------

/**
 * Writes box-projected UVs measured in metres / `tile`, from the geometry's
 * current positions. Bake after transforming into world space and neighbouring
 * pieces tile seamlessly. The handedness matches what three derives its
 * tangent frame from, so normal maps are not mirrored.
 */
export function bakeUV(geo: THREE.BufferGeometry, tile: number, ou = 0, ov = 0) {
    if (!geo.attributes.normal) geo.computeVertexNormals()
    const pos = geo.attributes.position!
    const nor = geo.attributes.normal!
    const uv = new Float32Array(pos.count * 2)
    const inv = 1 / tile
    for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i)
        const py = pos.getY(i)
        const pz = pos.getZ(i)
        const nx = nor.getX(i)
        const ny = nor.getY(i)
        const nz = nor.getZ(i)
        const ax = Math.abs(nx)
        const ay = Math.abs(ny)
        const az = Math.abs(nz)
        let u: number
        let v: number
        if (ay >= ax && ay >= az) {
            u = px
            v = ny > 0 ? -pz : pz
        } else if (ax >= az) {
            u = nx > 0 ? -pz : pz
            v = py
        } else {
            u = nz > 0 ? px : -px
            v = py
        }
        uv[i * 2] = u * inv + ou
        uv[i * 2 + 1] = v * inv + ov
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    return geo
}

/** Scale a geometry's existing UVs (cylinders, spheres) into metres / tile. */
export function scaleUV(geo: THREE.BufferGeometry, su: number, sv: number) {
    const uv = geo.attributes.uv
    if (!uv) return geo
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
    return geo
}

function ensureIndexed(geo: THREE.BufferGeometry) {
    if (geo.index) return geo
    const count = geo.attributes.position!.count
    const index = new Uint32Array(count)
    for (let i = 0; i < count; i++) index[i] = i
    geo.setIndex(new THREE.BufferAttribute(index, 1))
    return geo
}

/** A flat quad from four corners, wound so its face points along `facing`. */
export function quadGeo(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, facing?: THREE.Vector3) {
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
    const flip = facing ? normal.dot(facing) < 0 : false
    const geo = new THREE.BufferGeometry()
    const p = [a, b, c, d]
    const n = flip ? normal.clone().negate() : normal
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap(v => [v.x, v.y, v.z]), 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 2, 3].flatMap(() => [n.x, n.y, n.z]), 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
    geo.setIndex(flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3])
    return geo
}

export type FaceMats = (THREE.Material | null)[]

const FACE_NORMALS = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
]

/** Geometry for one face of an axis-aligned box. Face order: +X -X +Y -Y +Z -Z. */
export function boxFaceGeo(face: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    let quad: THREE.Vector3[]
    switch (face) {
        case 0: quad = [v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)]; break
        case 1: quad = [v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0)]; break
        case 2: quad = [v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0)]; break
        case 3: quad = [v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)]; break
        case 4: quad = [v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)]; break
        default: quad = [v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0)]
    }
    return quadGeo(quad[0]!, quad[1]!, quad[2]!, quad[3]!, FACE_NORMALS[face])
}

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

interface Bucket {
    material: THREE.Material
    geos: THREE.BufferGeometry[]
}

/**
 * Collects world-space geometry and merges it per material per spatial chunk,
 * so the whole level is a few dozen draw calls and still frustum-culls.
 */
export class Batch {
    private buckets = new Map<string, Bucket>()
    private box = new THREE.Box3()
    constructor(private chunk = 18) {}

    /** Add geometry that is already in world space. Consumes `geo`. */
    add(geo: THREE.BufferGeometry, material: THREE.Material, bake = true) {
        const tile = (material.userData.tile as number | undefined) ?? 1
        if (bake) bakeUV(geo, tile)
        for (const name of Object.keys(geo.attributes)) {
            if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') geo.deleteAttribute(name)
        }
        if ((material as THREE.MeshStandardMaterial).vertexColors && !geo.attributes.color) {
            const count = geo.attributes.position!.count
            geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3))
        }
        if (!(material as THREE.MeshStandardMaterial).vertexColors && geo.attributes.color) geo.deleteAttribute('color')
        if (!geo.attributes.uv) {
            geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position!.count * 2), 2))
        }
        ensureIndexed(geo)
        geo.computeBoundingBox()
        this.box.copy(geo.boundingBox!)
        const cx = Math.floor((this.box.min.x + this.box.max.x) / 2 / this.chunk)
        const cz = Math.floor((this.box.min.z + this.box.max.z) / 2 / this.chunk)
        const cy = Math.floor((this.box.min.y + this.box.max.y) / 2 / 6)
        const key = `${material.uuid}|${cx}|${cy}|${cz}`
        let bucket = this.buckets.get(key)
        if (!bucket) {
            bucket = { material, geos: [] }
            this.buckets.set(key, bucket)
        }
        bucket.geos.push(geo)
    }

    /** An axis-aligned box, faces mapped per material (`null` skips a face). */
    boxFaces(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mats: FaceMats) {
        for (let f = 0; f < 6; f++) {
            const mat = mats[f]
            if (!mat) continue
            this.add(boxFaceGeo(f, x0, y0, z0, x1, y1, z1), mat)
        }
    }

    /** A solid box with one material on every face. */
    box6(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: THREE.Material) {
        this.boxFaces(x0, y0, z0, x1, y1, z1, [mat, mat, mat, mat, mat, mat])
    }

    /** Flatten a group of meshes (with baked local UVs) into the batch. */
    addGroup(root: THREE.Object3D, parentMatrix?: THREE.Matrix4) {
        root.updateMatrixWorld(true)
        root.traverse((object) => {
            const mesh = object as THREE.Mesh
            if (!mesh.isMesh || Array.isArray(mesh.material)) return
            const geo = mesh.geometry.clone()
            const matrix = parentMatrix ? parentMatrix.clone().multiply(mesh.matrixWorld) : mesh.matrixWorld
            geo.applyMatrix4(matrix)
            this.add(geo, mesh.material, false)
        })
    }

    flush(parent: THREE.Object3D, configure?: (mesh: THREE.Mesh, material: THREE.Material) => void) {
        const meshes: THREE.Mesh[] = []
        for (const bucket of this.buckets.values()) {
            const merged = bucket.geos.length === 1 ? bucket.geos[0]! : mergeGeometries(bucket.geos, false)
            if (!merged) continue
            if (bucket.geos.length > 1) for (const g of bucket.geos) g.dispose()
            merged.computeBoundingSphere()
            const mesh = new THREE.Mesh(merged, bucket.material)
            mesh.matrixAutoUpdate = false
            configure?.(mesh, bucket.material)
            parent.add(mesh)
            meshes.push(mesh)
        }
        this.buckets.clear()
        return meshes
    }
}

/** Merge a list of already-world-space geometries into one mesh. */
export function mergeInto(parent: THREE.Object3D, geos: THREE.BufferGeometry[], material: THREE.Material, bake = 0) {
    if (geos.length === 0) return null
    for (const geo of geos) {
        if (bake > 0) bakeUV(geo, bake)
        for (const name of Object.keys(geo.attributes)) {
            if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name)
        }
        if (!geo.attributes.uv) {
            geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position!.count * 2), 2))
        }
        ensureIndexed(geo)
    }
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false)
    if (!merged) return null
    merged.computeBoundingSphere()
    const mesh = new THREE.Mesh(merged, material)
    mesh.matrixAutoUpdate = false
    parent.add(mesh)
    return mesh
}

const tmpMatrix = new THREE.Matrix4()
const tmpQuat = new THREE.Quaternion()
const tmpScale = new THREE.Vector3()
const tmpPos = new THREE.Vector3()
const tmpEuler = new THREE.Euler()

/** `geo` transformed by position / yaw / scale, as a new geometry. */
export function placed(geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
    const g = geo.clone()
    tmpEuler.set(rx, ry, rz, 'YXZ')
    tmpQuat.setFromEuler(tmpEuler)
    tmpMatrix.compose(tmpPos.set(x, y, z), tmpQuat, tmpScale.set(sx, sy, sz))
    g.applyMatrix4(tmpMatrix)
    return g
}

// ---------------------------------------------------------------------------
// Shared clock and fog for the level's custom shaders
// ---------------------------------------------------------------------------

export const levelTime = { value: 0 }

function fogOf(scene: THREE.Scene): [number, number] {
    const fog = scene.fog as THREE.Fog | null
    return fog && 'near' in fog ? [fog.near, fog.far] : [1e5, 1e5 + 1]
}

/** Additive light cone / shaft. Alpha falls off toward the edge, the tail and the camera. */
export function makeBeamMaterial(color: THREE.ColorRepresentation, opacity: number, sharp = 1.6) {
    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uOpacity: { value: opacity },
            uSharp: { value: sharp },
            uFog: { value: new THREE.Vector2(1e5, 1e5 + 1) },
            uTime: levelTime
        },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            varying vec3 vN;
            varying vec3 vV;
            void main() {
                vUv = uv;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vN = normalize(normalMatrix * normal);
                vV = -mv.xyz;
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uSharp;
            uniform vec2 uFog;
            uniform float uTime;
            varying vec2 vUv;
            varying vec3 vN;
            varying vec3 vV;
            void main() {
                float depth = length(vV);
                float facing = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
                float edge = pow(facing, uSharp);
                float along = clamp(vUv.y, 0.0, 1.0);
                float tail = along * along * (0.4 + 0.6 * along);
                float near = clamp((depth - 0.6) / 3.0, 0.0, 1.0);
                float fog = 1.0 - clamp((depth - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);
                float shimmer = 0.94 + 0.06 * sin(uTime * 0.7 + vUv.x * 9.0);
                gl_FragColor = vec4(uColor, uOpacity * edge * tail * near * fog * shimmer);
            }`
    })
    return material
}

/** Keep a beam material's fog range in step with the scene's. */
export function syncBeamFog(material: THREE.ShaderMaterial, scene: THREE.Scene) {
    const [near, far] = fogOf(scene)
    ;(material.uniforms.uFog!.value as THREE.Vector2).set(near, far)
}

/** Night sky: gradient, stars, a moon and a couple of moonlit cloud banks. */
export function makeSkyMaterial(moonDir: THREE.Vector3) {
    return new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
            uMoon: { value: moonDir.clone().normalize() },
            uHorizon: { value: new THREE.Color(0x1b2a36) },
            uZenith: { value: new THREE.Color(0x03060b) },
            uFogColor: { value: new THREE.Color(0x0a1116) },
            uFogMix: { value: 0 },
            uDim: { value: 1 },
            uTime: levelTime
        },
        vertexShader: /* glsl */`
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 uMoon;
            uniform vec3 uHorizon;
            uniform vec3 uZenith;
            uniform vec3 uFogColor;
            uniform float uFogMix;
            uniform float uDim;
            uniform float uTime;
            varying vec3 vDir;
            float hash(vec2 p) {
                p = fract(p * vec2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return fract(p.x * p.y);
            }
            float vnoise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
            }
            void main() {
                vec3 d = normalize(vDir);
                float h = clamp(d.y, -1.0, 1.0);
                float up = clamp(h, 0.0, 1.0);
                vec3 col = mix(uHorizon, uZenith, sqrt(up));
                // A cold haze low down, and the ground glow below the horizon.
                col += uHorizon * 0.5 * exp(-up * 14.0);
                col = mix(col, uFogColor, clamp(-h * 6.0, 0.0, 1.0));

                // Stars: a hashed grid over the sphere, twinkling.
                vec2 sp = vec2(atan(d.z, d.x + 0.00001), asin(h));
                vec2 g = sp * vec2(120.0, 120.0);
                vec2 cell = floor(g);
                vec2 f = fract(g) - 0.5;
                float r = hash(cell);
                float star = step(0.985, r) * (1.0 - smoothstep(0.0, 0.26, length(f)));
                star *= 0.6 + 0.4 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
                col += vec3(0.75, 0.85, 1.0) * star * smoothstep(0.02, 0.3, h) * 1.1;

                // Moon: disc, halo and glow.
                float md = clamp(dot(d, normalize(uMoon)), 0.0, 1.0);
                float disc = smoothstep(0.9994, 0.9997, md);
                col += vec3(0.85, 0.92, 1.0) * disc * 2.2;
                col += vec3(0.35, 0.5, 0.7) * pow(md, 90.0) * 0.55;
                col += vec3(0.18, 0.26, 0.38) * pow(md, 6.0) * 0.28;

                // Cloud banks catching the moon.
                vec2 cp = d.xz / (h + 0.35) * 1.4 + vec2(uTime * 0.004, 0.0);
                float c = vnoise(cp * 1.6) * 0.6 + vnoise(cp * 3.7) * 0.3 + vnoise(cp * 8.0) * 0.1;
                float cloud = smoothstep(0.52, 0.85, c) * smoothstep(0.02, 0.28, h);
                vec3 cloudCol = mix(vec3(0.02, 0.03, 0.05), vec3(0.16, 0.2, 0.27), pow(md, 4.0) * 1.6 + 0.2);
                col = mix(col, cloudCol, cloud * 0.65);

                col *= uDim;
                col = mix(col, uFogColor, uFogMix);
                gl_FragColor = vec4(col, 1.0);
            }`
    })
}

/**
 * Drifting dust motes. Positions are given per point; the shader animates them
 * with a slow wander and holds a minimum on-screen size so distant motes do
 * not shimmer into sub-pixel flicker.
 */
export function makeDustMaterial(color: THREE.ColorRepresentation, opacity: number) {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uOpacity: { value: opacity },
            uScale: { value: 800 },
            uFog: { value: new THREE.Vector2(1e5, 1e5 + 1) },
            uTime: levelTime
        },
        vertexShader: /* glsl */`
            attribute float aSeed;
            attribute float aSize;
            uniform float uScale;
            uniform float uTime;
            varying float vAlpha;
            varying float vDepth;
            void main() {
                vec3 p = position;
                float t = uTime * 0.25 + aSeed * 40.0;
                p += vec3(sin(t * 1.3 + aSeed * 9.0), sin(t * 0.7 + aSeed * 3.0) * 0.6 - 0.05 * mod(uTime + aSeed * 30.0, 6.0), cos(t * 1.1 + aSeed * 5.0)) * 0.45;
                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                float depth = max(-mv.z, 0.05);
                float raw = aSize * uScale / depth;
                float px = max(raw, 1.6);
                gl_PointSize = px;
                float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 2.0) + aSeed * 60.0);
                vAlpha = min(1.0, (raw * raw) / (px * px)) * twinkle;
                vDepth = depth;
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform vec2 uFog;
            varying float vAlpha;
            varying float vDepth;
            void main() {
                vec2 c = gl_PointCoord - 0.5;
                float d = clamp(length(c) * 2.0, 0.0, 1.0);
                float soft = 1.0 - d * d;
                float fog = 1.0 - clamp((vDepth - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);
                gl_FragColor = vec4(uColor, uOpacity * vAlpha * soft * fog);
            }`
    })
}

/** Wire a custom-shader mesh to the scene's fog and (for points) the camera's pixel scale. */
export function bindShaderFrame(mesh: THREE.Object3D, material: THREE.ShaderMaterial, extra?: () => void) {
    mesh.onBeforeRender = (renderer, scene, camera) => {
        const [near, far] = fogOf(scene)
        ;(material.uniforms.uFog!.value as THREE.Vector2).set(near, far)
        if (material.uniforms.uScale) {
            const size = renderer.getDrawingBufferSize(new THREE.Vector2())
            const proj = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] ?? 1
            material.uniforms.uScale.value = size.y * 0.5 * proj
        }
        levelTime.value = performance.now() / 1000
        extra?.()
    }
}
