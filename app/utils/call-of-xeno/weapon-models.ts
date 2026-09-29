// Call of Xeno — first-person weapon models.
//
// Every gun is assembled from bevelled boxes, cylinders, capsules and
// extruded side profiles, merged per material so a model is a handful of
// draw calls. Moving parts (slide, bolt, pump, cylinder, magazine, trigger,
// hands) are their own small groups so `animateWeapon` can drive them.
// Materials and canvas textures are shared across every gun (cached) and
// their `dispose()` is neutered so the component's `disposeObject` can't
// pull them out from under the next model; `disposeWeaponCache()` frees them.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CallOfXenoWeaponId } from '#shared/utils/gamelogic/call-of-xeno'

// ---------------------------------------------------------------------------
// Shared resources
// ---------------------------------------------------------------------------

const GUN_METAL = 0x585f6b

/** Accent colour climbs the Pack-a-Punch ladder so a tier reads at a glance. */
export function papAccent(tier: number) {
    if (tier >= 3) return 0xff5ea8
    if (tier === 2) return 0x00e5ff
    if (tier === 1) return 0x9a3fd0
    return GUN_METAL
}

const realDisposers: (() => void)[] = []

/** Cached resources ignore `dispose()` from per-model cleanup. */
function shared<T extends { dispose: () => void }>(obj: T): T {
    realDisposers.push(obj.dispose.bind(obj))
    obj.dispose = () => {}
    return obj
}

const baseGeoCache = new Map<string, THREE.BufferGeometry>()
const matCache = new Map<string, THREE.MeshStandardMaterial>()
const basicCache = new Map<string, THREE.MeshBasicMaterial>()
const glowMats = new Set<THREE.MeshStandardMaterial>()
const camoMats: THREE.MeshStandardMaterial[] = []
const texCache = new Map<string, THREE.CanvasTexture>()
const papTime = { value: 0 }
let envTexture: THREE.Texture | null = null

/** Frees every cached material, texture and source geometry. */
export function disposeWeaponCache() {
    for (const dispose of realDisposers) dispose()
    realDisposers.length = 0
    baseGeoCache.clear()
    matCache.clear()
    basicCache.clear()
    glowMats.clear()
    camoMats.length = 0
    texCache.clear()
}

/**
 * Optional image-based lighting for the metals. The scene has no environment
 * map, so blued steel only catches the lamps; hand a PMREM texture (e.g. from
 * RoomEnvironment) in here and every gun material picks it up.
 */
export function setWeaponEnvMap(texture: THREE.Texture | null) {
    envTexture = texture
    for (const mat of matCache.values()) {
        mat.envMap = texture
        mat.needsUpdate = true
    }
}

function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
    const cached = texCache.get(key)
    if (cached) return cached
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    draw(canvas.getContext('2d')!, size)
    const tex = shared(new THREE.CanvasTexture(canvas))
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = 4
    texCache.set(key, tex)
    return tex
}

/** Cheap deterministic noise so the canvas textures are stable between builds. */
function hash(n: number) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
    return s - Math.floor(s)
}

function woodGrain() {
    return canvasTexture('wood', 128, (ctx, size) => {
        ctx.fillStyle = '#c9c0b4'
        ctx.fillRect(0, 0, size, size)
        for (let i = 0; i < 46; i++) {
            const y = hash(i) * size
            const light = 150 + hash(i + 40) * 90
            ctx.strokeStyle = `rgba(${light},${light * 0.9},${light * 0.78},${0.25 + hash(i + 9) * 0.3})`
            ctx.lineWidth = 0.6 + hash(i + 80) * 1.8
            ctx.beginPath()
            ctx.moveTo(0, y)
            ctx.bezierCurveTo(size * 0.3, y + hash(i + 3) * 8 - 4, size * 0.7, y + hash(i + 7) * 8 - 4, size, y + hash(i + 11) * 6 - 3)
            ctx.stroke()
        }
        for (let i = 0; i < 70; i++) {
            ctx.fillStyle = `rgba(20,10,4,${0.05 + hash(i + 200) * 0.09})`
            ctx.fillRect(hash(i + 300) * size, hash(i + 400) * size, 1 + hash(i + 500) * 6, 1)
        }
    })
}

function fabricWeave() {
    return canvasTexture('fabric', 64, (ctx, size) => {
        ctx.fillStyle = '#b8b8b8'
        ctx.fillRect(0, 0, size, size)
        for (let i = 0; i < size; i += 2) {
            ctx.fillStyle = 'rgba(0,0,0,0.22)'
            ctx.fillRect(i, 0, 1, size)
            ctx.fillStyle = 'rgba(255,255,255,0.10)'
            ctx.fillRect(0, i, size, 1)
        }
        for (let i = 0; i < 120; i++) {
            ctx.fillStyle = `rgba(0,0,0,${hash(i) * 0.12})`
            ctx.fillRect(hash(i + 1) * size, hash(i + 2) * size, 2, 2)
        }
    })
}

function metalWear() {
    return canvasTexture('wear', 128, (ctx, size) => {
        ctx.fillStyle = '#d6d6d6'
        ctx.fillRect(0, 0, size, size)
        for (let i = 0; i < 160; i++) {
            const v = 120 + hash(i) * 120
            ctx.fillStyle = `rgba(${v},${v},${v},${0.10 + hash(i + 30) * 0.25})`
            ctx.fillRect(hash(i + 60) * size, hash(i + 90) * size, 1 + hash(i + 120) * 12, 1 + hash(i + 150) * 2)
        }
    })
}

type MatId
    = | 'steel' | 'steelLt' | 'dark' | 'nickel' | 'wood' | 'woodDk' | 'poly' | 'plum'
      | 'brass' | 'copper' | 'olive' | 'oliveDk' | 'rubber' | 'glove' | 'sleeve' | 'strap'
      | 'alien' | 'chitin'

interface MatSpec {
    color: number
    metalness: number
    roughness: number
    map?: 'wood' | 'fabric' | 'wear'
}

// Metalness sits a little under the "real" 0.8: with no environment map,
// pure metals only reflect lamps and go black in an ambient-lit corridor.
const MAT_SPECS: Record<MatId, MatSpec> = {
    steel: { color: 0x3a4250, metalness: 0.68, roughness: 0.4, map: 'wear' },
    steelLt: { color: 0x555c57, metalness: 0.62, roughness: 0.5, map: 'wear' },
    dark: { color: 0x15171b, metalness: 0.5, roughness: 0.5 },
    nickel: { color: 0xb4bac2, metalness: 0.85, roughness: 0.28 },
    wood: { color: 0x9a6a3c, metalness: 0, roughness: 0.68, map: 'wood' },
    woodDk: { color: 0x5b3820, metalness: 0, roughness: 0.62, map: 'wood' },
    poly: { color: 0x25272b, metalness: 0.05, roughness: 0.62 },
    plum: { color: 0x6a2e22, metalness: 0.05, roughness: 0.55 },
    brass: { color: 0xc9994a, metalness: 0.85, roughness: 0.32 },
    copper: { color: 0xb5643a, metalness: 0.8, roughness: 0.4 },
    olive: { color: 0x4c5a3f, metalness: 0.32, roughness: 0.6, map: 'wear' },
    oliveDk: { color: 0x2a3326, metalness: 0.3, roughness: 0.65, map: 'wear' },
    rubber: { color: 0x1a1b1d, metalness: 0, roughness: 0.9 },
    glove: { color: 0x25272a, metalness: 0, roughness: 0.82, map: 'fabric' },
    sleeve: { color: 0x2f362f, metalness: 0, roughness: 0.95, map: 'fabric' },
    strap: { color: 0x14151a, metalness: 0, roughness: 0.75, map: 'fabric' },
    alien: { color: 0x2b4b49, metalness: 0.4, roughness: 0.42, map: 'wear' },
    chitin: { color: 0x0f1a1a, metalness: 0.5, roughness: 0.34 }
}

const CAMO_METAL = new Set<MatId>(['steel', 'steelLt', 'olive', 'alien'])
const CAMO_FURNITURE = new Set<MatId>(['wood', 'woodDk', 'poly', 'plum'])

function textureFor(kind: MatSpec['map']) {
    if (kind === 'wood') return woodGrain()
    if (kind === 'fabric') return fabricWeave()
    if (kind === 'wear') return metalWear()
    return null
}

/**
 * Animated Pack-a-Punch camo: an emissive hex-cell pattern injected into the
 * standard shader. Driven by object-space position so the pattern rides with
 * each moving part. No pow/log/sqrt anywhere: every input is clamped or
 * only ever fed to sin/fract/floor.
 */
function camoMaterial(spec: MatSpec, color: number, tier: number) {
    const mat = shared(new THREE.MeshStandardMaterial({
        color: new THREE.Color(spec.color).lerp(new THREE.Color(color), 0.16),
        metalness: spec.metalness,
        roughness: Math.max(0.3, spec.roughness - 0.1),
        map: textureFor(spec.map)
    }))
    const uniforms = {
        uPapTime: papTime,
        uPapColor: { value: new THREE.Color(color) },
        uPapTier: { value: tier }
    }
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vPapP;\nvarying vec3 vPapN;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPapP = position;\nvPapN = normal;')
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
uniform float uPapTime;
uniform vec3 uPapColor;
uniform float uPapTier;
varying vec3 vPapP;
varying vec3 vPapN;
vec3 papEmit() {
    vec3 an = abs(vPapN);
    vec2 uv = an.x > max(an.y, an.z) ? vPapP.zy : (an.y > an.z ? vPapP.zx : vPapP.xy);
    float t = uPapTime;
    uv = uv * 46.0 + vec2(t * 0.7, t * 0.3 * (1.0 + uPapTier * 0.4));
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 id = uv - g;
    vec2 q = abs(g);
    float d = max(dot(q, vec2(0.5, 0.8660254)), q.x);
    float line = 1.0 - clamp((0.5 - d) / 0.08, 0.0, 1.0);
    float cell = fract(sin(dot(floor(id * 2.0), vec2(12.9898, 78.233))) * 43758.5453);
    float thresh = 0.78 - uPapTier * 0.07;
    float pulse = 0.5 + 0.5 * sin(t * (1.1 + cell * 1.7) + cell * 6.2831);
    float lit = step(thresh, cell) * pulse;
    float sweep = 0.0;
    if (uPapTier > 1.5) {
        float s = fract((uv.x + uv.y * 0.55) * 0.045 - t * 0.28);
        sweep = clamp(1.0 - abs(s - 0.5) * 9.0, 0.0, 1.0);
    }
    float glow = line * (0.55 + 0.35 * pulse) + lit * 0.7 + sweep * (0.6 + line);
    vec3 hot = mix(uPapColor, vec3(1.0), clamp(sweep * 0.5 + lit * 0.25, 0.0, 0.6));
    return hot * glow * 0.95;
}`)
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += papEmit();')
    }
    mat.customProgramCacheKey = () => 'cox-pap'
    camoMats.push(mat)
    return mat
}

function material(id: MatId, tier: number) {
    const camo = tier > 0 ? (CAMO_METAL.has(id) ? 'm' : CAMO_FURNITURE.has(id) ? 'f' : '') : ''
    const key = camo ? `${id}|camo${tier}` : id
    const cached = matCache.get(key)
    if (cached) return cached
    const spec = MAT_SPECS[id]
    let mat: THREE.MeshStandardMaterial
    if (camo) {
        mat = camoMaterial(spec, papAccent(tier), tier)
    } else {
        mat = shared(new THREE.MeshStandardMaterial({
            color: spec.color,
            metalness: spec.metalness,
            roughness: spec.roughness,
            map: textureFor(spec.map)
        }))
    }
    // Named so callers can recognise the hand materials (glove / sleeve / strap).
    mat.name = id
    mat.envMap = envTexture
    matCache.set(key, mat)
    return mat
}

/** Emissive material for coils, sights and energy trim; pulsed by `updateWeaponMaterials`. */
function glow(color: number, intensity = 1.8) {
    const key = `glow|${color}|${intensity}`
    const cached = matCache.get(key)
    if (cached) return cached
    const mat = shared(new THREE.MeshStandardMaterial({
        color: 0x0c1012,
        emissive: color,
        emissiveIntensity: intensity,
        metalness: 0.2,
        roughness: 0.35
    }))
    mat.userData.baseIntensity = intensity
    matCache.set(key, mat)
    glowMats.add(mat)
    return mat
}

function basic(key: string, make: () => THREE.MeshBasicMaterial) {
    const cached = basicCache.get(key)
    if (cached) return cached
    const mat = shared(make())
    basicCache.set(key, mat)
    return mat
}

/** Drives the Pack-a-Punch camo scroll and the energy-coil pulse. Call once per frame. */
export function updateWeaponMaterials(time: number) {
    papTime.value = time
    const pulse = 0.82 + 0.18 * Math.sin(time * 5.2) + 0.08 * Math.sin(time * 13.1)
    for (const mat of glowMats) mat.emissiveIntensity = (mat.userData.baseIntensity as number) * pulse
}

// ---------------------------------------------------------------------------
// Geometry assembly
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _one = new THREE.Vector3(1, 1, 1)
const _up = new THREE.Vector3(0, 1, 0)

type Axis = 'x' | 'y' | 'z'
type Vec3 = [number, number, number]

function baseGeo(key: string, make: () => THREE.BufferGeometry) {
    let geo = baseGeoCache.get(key)
    if (!geo) {
        geo = make()
        if (geo.index) geo = geo.toNonIndexed()
        baseGeoCache.set(key, geo)
    }
    return geo.clone()
}

/**
 * Collects geometry per material and merges it into one mesh each. `sub()`
 * opens a child group with its own pivot (authoring coordinates stay in gun
 * space; the pivot is subtracted on the way in), which is how the moving parts
 * are split off.
 */
class Asm {
    readonly group = new THREE.Group()
    private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>()
    private subs: Asm[] = []

    constructor(readonly px = 0, readonly py = 0, readonly pz = 0) {
        this.group.position.set(px, py, pz)
        this.group.userData.rest = new THREE.Vector3(px, py, pz)
    }

    sub(px: number, py: number, pz: number) {
        const child = new Asm(px, py, pz)
        child.group.position.set(px - this.px, py - this.py, pz - this.pz)
        child.group.userData.rest = child.group.position.clone()
        this.subs.push(child)
        return child
    }

    private push(mat: THREE.Material, geo: THREE.BufferGeometry) {
        let list = this.buckets.get(mat)
        if (!list) {
            list = []
            this.buckets.set(mat, list)
        }
        list.push(geo)
    }

    put(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rot?: Vec3) {
        if (rot) _e.set(rot[0], rot[1], rot[2])
        else _e.set(0, 0, 0)
        _q.setFromEuler(_e)
        _m.compose(_v.set(x - this.px, y - this.py, z - this.pz), _q, _one)
        geo.applyMatrix4(_m)
        this.push(mat, geo)
    }

    putQ(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, q: THREE.Quaternion) {
        _m.compose(_v.set(x - this.px, y - this.py, z - this.pz), q, _one)
        geo.applyMatrix4(_m)
        this.push(mat, geo)
    }

    /** Bevelled box (plain hard box when radius is 0). */
    box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, r = 0.004, rot?: Vec3) {
        const key = `b|${w}|${h}|${d}|${r}`
        const geo = baseGeo(key, () => r > 0
            ? new RoundedBoxGeometry(w, h, d, r > 0.012 ? 2 : 1, r)
            : new THREE.BoxGeometry(w, h, d))
        this.put(mat, geo, x, y, z, rot)
    }

    /** Cylinder along an axis; `r` is the radius at the negative end, `r2` at the positive end. */
    cyl(mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: Axis = 'z', seg = 10, r2 = r) {
        const key = `c|${axis}|${r}|${r2}|${len}|${seg}`
        const geo = baseGeo(key, () => {
            const g = new THREE.CylinderGeometry(r2, r, len, seg, 1)
            if (axis === 'z') g.rotateX(Math.PI / 2)
            else if (axis === 'x') g.rotateZ(-Math.PI / 2)
            return g
        })
        this.put(mat, geo, x, y, z)
    }

    /** Capsule with a straight section of `len` between the two caps. */
    capsule(mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: Axis = 'z') {
        const key = `p|${axis}|${r}|${len}`
        const geo = baseGeo(key, () => {
            const g = new THREE.CapsuleGeometry(r, Math.max(0.0001, len), 2, 6)
            if (axis === 'z') g.rotateX(Math.PI / 2)
            else if (axis === 'x') g.rotateZ(Math.PI / 2)
            return g
        })
        this.put(mat, geo, x, y, z)
    }

    sphere(mat: THREE.Material, r: number, x: number, y: number, z: number, seg = 8) {
        const geo = baseGeo(`s|${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)))
        this.put(mat, geo, x, y, z)
    }

    torus(mat: THREE.Material, R: number, tube: number, x: number, y: number, z: number, axis: Axis = 'z', seg = 14) {
        const key = `t|${axis}|${R}|${tube}|${seg}`
        const geo = baseGeo(key, () => {
            const g = new THREE.TorusGeometry(R, tube, 6, seg)
            if (axis === 'x') g.rotateY(Math.PI / 2)
            else if (axis === 'y') g.rotateX(Math.PI / 2)
            return g
        })
        this.put(mat, geo, x, y, z)
    }

    cone(mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: Axis = 'z', seg = 10) {
        // Tip points toward the negative end.
        this.cyl(mat, 0.0005, len, x, y, z, axis, seg, r)
    }

    /**
     * Extruded side profile. Points are [z, y]; the profile is centred on x
     * and extruded `width` wide with a small bevel.
     */
    extrude(mat: THREE.Material, pts: [number, number][], width: number, x = 0, bevel = 0.003) {
        const key = `e|${pts.join(',')}|${width}|${bevel}`
        const geo = baseGeo(key, () => {
            const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])))
            const g = new THREE.ExtrudeGeometry(shape, {
                depth: Math.max(0.001, width - bevel * 2),
                bevelEnabled: bevel > 0,
                bevelThickness: bevel,
                bevelSize: bevel * 0.8,
                bevelSegments: 1,
                curveSegments: 1,
                steps: 1
            })
            g.translate(0, 0, -(width - bevel * 2) / 2)
            g.rotateY(-Math.PI / 2)
            const uv = g.getAttribute('uv') as THREE.BufferAttribute
            for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 4)
            return g
        })
        this.put(mat, geo, x, 0, 0)
    }

    /** Tapered cylinder-ish limb from a point along a direction (used for arms). */
    limb(mat: THREE.Material, from: THREE.Vector3, dir: THREE.Vector3, len: number, rStart: number, rEnd: number, seg = 8) {
        const geo = baseGeo(`l|${rStart}|${rEnd}|${len}|${seg}`, () => {
            const g = new THREE.CylinderGeometry(rEnd, rStart, len, seg, 1)
            g.translate(0, len / 2, 0)
            return g
        })
        _q.setFromUnitVectors(_up, dir)
        this.putQ(mat, geo, from.x, from.y, from.z, _q)
    }

    build() {
        for (const [mat, geos] of this.buckets) {
            const merged = mergeGeometries(geos, false)
            for (const g of geos) g.dispose()
            if (!merged) continue
            const mesh = new THREE.Mesh(merged, mat)
            mesh.frustumCulled = false
            this.group.add(mesh)
        }
        this.buckets.clear()
        for (const child of this.subs) this.group.add(child.build())
        return this.group
    }
}

// ---------------------------------------------------------------------------
// Gloved hands and sleeves
// ---------------------------------------------------------------------------

interface HandOpts {
    /** Centre of the cylinder the hand wraps (gun space). */
    x: number
    y: number
    z: number
    /** 'y' wraps a vertical grip, 'yL' the same rotated to come in from the left, 'z' wraps a barrel/handguard from below. */
    mode: 'y' | 'yL' | 'z'
    /** Side the fingers curl over (+1 = +x in local space). */
    s: 1 | -1
    /** Half width of the thing wrapped, and its half depth (or height for 'z'). */
    rx: number
    rz: number
    /** Index finger stretched forward instead of curled. */
    point?: boolean
    /** Forearm direction in gun space. */
    arm: Vec3
    armLen?: number
    /** Thumb placement: side (+1/-1 local x) and whether it lies along the local Y axis (barrel for 'z'). */
    thumbX?: number
    thumbAlong?: 'y' | 'z'
    /** Wrist position in local coordinates (defaults per mode). */
    wrist?: Vec3
    /** Fingers to draw. */
    fingers?: number
}

let withHands = true

function addHand(root: Asm, tier: number, o: HandOpts) {
    if (!withHands) return null
    const hand = root.sub(o.x, o.y, o.z)
    const glove = material('glove', 0)
    const rub = material('rubber', 0)
    const sleeve = material('sleeve', 0)
    const strap = material('strap', 0)
    void tier
    // Local frame (lx, ly, lz) -> gun space, plus how axes and box dims swap.
    const map = (lx: number, ly: number, lz: number): Vec3 => {
        if (o.mode === 'y') return [o.x + lx, o.y + ly, o.z + lz]
        if (o.mode === 'yL') return [o.x - lz, o.y + ly, o.z + lx]
        return [o.x + lx, o.y - lz, o.z + ly]
    }
    const ax = (a: Axis): Axis => {
        if (o.mode === 'y') return a
        if (o.mode === 'yL') return a === 'x' ? 'z' : a === 'z' ? 'x' : 'y'
        return a === 'y' ? 'z' : a === 'z' ? 'y' : 'x'
    }
    const dims = (w: number, h: number, d: number): Vec3 => {
        if (o.mode === 'y') return [w, h, d]
        if (o.mode === 'yL') return [d, h, w]
        return [w, d, h]
    }
    const s = o.s
    const fr = 0.0118
    const pitch = 0.0245
    const n = o.fingers ?? 4
    const { rx, rz } = o

    for (let i = 0; i < n; i++) {
        const ly = ((n - 1) / 2 - i) * pitch
        const xs = s * (rx + fr)
        if (i === 0 && o.point) {
            const len = 0.75 * rz + rz + 0.05 - 2 * fr
            const c = map(xs, ly, (0.75 * rz - rz - 0.05) / 2)
            hand.capsule(glove, fr * 0.92, len, c[0], c[1], c[2], ax('z'))
            const tip = map(xs, ly, -(rz + 0.05))
            hand.sphere(glove, fr * 0.92, tip[0], tip[1], tip[2], 6)
            continue
        }
        // Side segment from the palm forward to the front corner.
        const lenA = 0.6 * rz + rz + fr - 2 * fr
        const cA = map(xs, ly, (0.6 * rz - (rz + fr)) / 2)
        hand.capsule(glove, fr, lenA, cA[0], cA[1], cA[2], ax('z'))
        // Front segment across the face of the grip.
        const xEnd = -s * rx * 0.7
        const lenB = Math.abs(xs - xEnd) - 2 * fr
        const cB = map((xs + xEnd) / 2, ly, -(rz + fr))
        hand.capsule(glove, fr * 0.94, Math.max(0.004, lenB), cB[0], cB[1], cB[2], ax('x'))
        const j = map(xs, ly, -(rz + fr))
        hand.sphere(glove, fr, j[0], j[1], j[2], 6)
    }

    // Palm and back of the hand (the rubber strip is the knuckle guard).
    const span = n * pitch
    const palmC = map(s * 0.006, 0, rz + 0.018)
    const palmD = dims(2 * rx + 0.03, span + 0.006, 0.032)
    hand.box(glove, palmD[0], palmD[1], palmD[2], palmC[0], palmC[1], palmC[2], 0.012)
    const knuck = map(s * (rx + 2 * fr - 0.002), 0, 0.5 * rz)
    const knD = dims(0.008, span, 0.022)
    hand.box(rub, knD[0], knD[1], knD[2], knuck[0], knuck[1], knuck[2], 0.003)

    // Thumb.
    const tx = o.thumbX ?? -s
    const along = o.thumbAlong ?? 'z'
    const tTop = ((n - 1) / 2) * pitch + 0.008
    if (along === 'z') {
        const tc = map(tx * (rx + 0.014), tTop, -0.012)
        hand.capsule(glove, 0.0125, 0.05, tc[0], tc[1], tc[2], ax('z'))
        const base = map(tx * (rx + 0.012), tTop - 0.004, rz * 0.8)
        hand.sphere(glove, 0.017, base[0], base[1], base[2], 6)
    } else {
        const tc = map(tx * (rx + 0.014), tTop - 0.005, rz * 0.4)
        hand.capsule(glove, 0.0125, 0.045, tc[0], tc[1], tc[2], ax('y'))
        const base = map(tx * (rx + 0.012), tTop - 0.05, rz * 0.6)
        hand.sphere(glove, 0.016, base[0], base[1], base[2], 6)
    }

    // Cuff and sleeve running back toward the camera.
    const wl = o.wrist ?? (o.mode === 'z' ? [-s * (rx + 0.034), 0, rz * 0.4] : [s * 0.006, 0, rz + 0.05])
    const w = map(wl[0], wl[1], wl[2])
    const dir = new THREE.Vector3(o.arm[0], o.arm[1], o.arm[2]).normalize()
    const from = new THREE.Vector3(w[0], w[1], w[2])
    hand.limb(glove, from, dir, 0.05, 0.03, 0.034)
    hand.limb(strap, from.clone().addScaledVector(dir, 0.034), dir, 0.012, 0.0365, 0.0365)
    hand.limb(sleeve, from.clone().addScaledVector(dir, 0.046), dir, o.armLen ?? 0.42, 0.041, 0.052)
    return hand
}

// ---------------------------------------------------------------------------
// Rig plumbing
// ---------------------------------------------------------------------------

/** Everything `animateWeapon` needs; lives in `group.userData`. */
interface Rig {
    kind: string
    muzzle: THREE.Vector3
    slide?: THREE.Object3D
    bolt?: THREE.Object3D
    pump?: THREE.Object3D
    cylinder?: THREE.Object3D
    crane?: THREE.Object3D
    mag?: THREE.Object3D
    trigger?: THREE.Object3D
    hammer?: THREE.Object3D
    cover?: THREE.Object3D
    spin?: THREE.Object3D
    leftHand?: THREE.Object3D
    rightHand?: THREE.Object3D
    /** Unit vector pointing out of the magazine well, and how far it drops. */
    magAxis?: THREE.Vector3
    magDrop?: number
    /** Left-hand offset (from rest) that reaches the magazine / loading port. */
    handMag?: THREE.Vector3
    /** How far the slide / bolt / pump travels back (+z). */
    travel?: number
    /** Reload arrives in this many blocks (shotgun shells). */
    shells?: number
    muzzleFlashScale?: number
    /** The left hand stays put during reload (the magazine is not what it holds). */
    noHandFollow?: boolean
    fx: { lastKick: number, shotTime: number, shots: number, spin: number, lastTime: number, cyl: number, spd: number }
}

function newRig(kind: string, muzzle: Vec3): Rig {
    return {
        kind,
        muzzle: new THREE.Vector3(muzzle[0], muzzle[1], muzzle[2]),
        fx: { lastKick: 0, shotTime: -9, shots: 0, spin: 0, lastTime: 0, cyl: 0, spd: 0 }
    }
}

type C = (id: MatId) => THREE.MeshStandardMaterial

const sallyDecal = (tier: number) => basic(`sally${tier}`, () => new THREE.MeshBasicMaterial({
    color: papAccent(tier),
    map: canvasTexture('sally', 256, (ctx, size) => {
        ctx.clearRect(0, 0, size, size)
        ctx.font = '900 92px Impact, "Arial Black", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#ffffff'
        ctx.shadowColor = '#ff5ea8'
        ctx.shadowBlur = 16
        ctx.fillText('SALLY', size / 2, size / 2)
    }),
    transparent: true,
    depthWrite: false,
    toneMapped: false
}))

// ---------------------------------------------------------------------------
// Shared gun parts
// ---------------------------------------------------------------------------

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** Front post and rear notch pair, sat on top of a barrel. */
function ironSights(A: Asm, c: C, frontZ: number, rearZ: number, y: number, hood = false) {
    A.box(c('dark'), 0.008, 0.02, 0.01, 0, y + 0.01, frontZ, 0.001)
    if (hood) {
        A.box(c('dark'), 0.006, 0.024, 0.014, 0.014, y + 0.012, frontZ, 0.001)
        A.box(c('dark'), 0.006, 0.024, 0.014, -0.014, y + 0.012, frontZ, 0.001)
    }
    A.box(c('dark'), 0.009, 0.016, 0.012, 0.013, y + 0.008, rearZ, 0.001)
    A.box(c('dark'), 0.009, 0.016, 0.012, -0.013, y + 0.008, rearZ, 0.001)
}

/** Slanted pistol grip block (+ panels) whose axis leans back at `tilt` radians. */
function pistolGrip(A: Asm, frame: THREE.Material, panel: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, tilt: number, panelW = 0.007) {
    A.box(frame, w, h, d, x, y, z, 0.005, [tilt, 0, 0])
    A.box(panel, panelW, h * 0.92, d * 0.96, x + w / 2 + panelW / 2 - 0.002, y, z, 0.003, [tilt, 0, 0])
    A.box(panel, panelW, h * 0.92, d * 0.96, x - w / 2 - panelW / 2 + 0.002, y, z, 0.003, [tilt, 0, 0])
}

/** A belt of brass rounds lying across a bezier path (M60 / MAG feed). */
function belt(A: Asm, c: C, p0: Vec3, p1: Vec3, p2: Vec3, count: number, flip = false) {
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1)
        const a = 1 - t
        const x = a * a * p0[0] + 2 * a * t * p1[0] + t * t * p2[0]
        const y = a * a * p0[1] + 2 * a * t * p1[1] + t * t * p2[1]
        const z = a * a * p0[2] + 2 * a * t * p1[2] + t * t * p2[2]
        A.cyl(c('brass'), 0.0085, 0.05, x, y, z, 'x', 6)
        // Bullet noses point along +x when flipped (belt entering from the left).
        if (flip) A.cyl(c('copper'), 0.0085, 0.02, x + 0.033, y, z, 'x', 6, 0.0005)
        else A.cone(c('copper'), 0.0085, 0.02, x - 0.033, y, z, 'x', 6)
        A.box(c('dark'), 0.018, 0.005, 0.012, x, y, z, 0)
    }
}

// ---------------------------------------------------------------------------
// Pistols and revolver
// ---------------------------------------------------------------------------

function buildM1911(A: Asm, c: C, tier: number): Rig {
    const sally = tier > 0
    const rig = newRig('pistol', [0, 0.056, sally ? -0.36 : -0.3])
    rig.travel = 0.038
    rig.magAxis = V(0, -0.98, 0.199)
    rig.magDrop = 0.17
    rig.handMag = V(-0.005, -0.09, 0.03)

    // Slide: body, ejection port, serrations, sights.
    const slide = A.sub(0, 0.055, -0.15)
    rig.slide = slide.group
    slide.box(c('steel'), 0.05, 0.05, 0.27, 0, 0.056, -0.155, 0.008)
    slide.box(c('steel'), 0.024, 0.006, 0.25, 0, 0.083, -0.155, 0.002)
    for (const sx of [-1, 1]) slide.box(c('dark'), 0.006, 0.018, 0.05, sx * 0.0255, 0.064, -0.1, 0.002)
    for (let i = 0; i < 6; i++) slide.box(c('dark'), 0.0525, 0.038, 0.0035, 0, 0.055, -0.035 - i * 0.0085, 0)
    for (let i = 0; i < 3; i++) slide.box(c('dark'), 0.0525, 0.038, 0.0035, 0, 0.055, -0.235 - i * 0.0085, 0)
    slide.box(c('dark'), 0.008, 0.015, 0.012, 0, 0.092, -0.272, 0.001)
    slide.box(c('dark'), 0.011, 0.013, 0.014, 0.0115, 0.09, -0.032, 0.001)
    slide.box(c('dark'), 0.011, 0.013, 0.014, -0.0115, 0.09, -0.032, 0.001)
    slide.cyl(c('dark'), 0.0125, 0.02, 0, 0.052, -0.288, 'z', 10)

    // Frame, dust cover, trigger guard, beavertail.
    A.box(c('steelLt'), 0.046, 0.034, 0.2, 0, 0.011, -0.12, 0.006)
    A.box(c('steelLt'), 0.048, 0.02, 0.06, 0, 0.014, -0.2, 0.004)
    A.box(c('steelLt'), 0.011, 0.007, 0.078, 0, -0.011, -0.058, 0.002)
    A.box(c('steelLt'), 0.011, 0.028, 0.01, 0, 0.002, -0.097, 0.002)
    A.box(c('steelLt'), 0.036, 0.012, 0.034, 0, 0.034, 0.01, 0.004, [-0.3, 0, 0])
    A.box(c('dark'), 0.006, 0.022, 0.006, 0.0, -0.028, -0.05, 0.001)
    // Slide stop, thumb safety and grip safety.
    A.box(c('dark'), 0.006, 0.008, 0.03, -0.026, 0.028, -0.07, 0.002)
    A.box(c('dark'), 0.006, 0.014, 0.022, -0.026, 0.03, -0.025, 0.002)
    A.box(c('steelLt'), 0.014, 0.05, 0.012, 0, -0.02, 0.028, 0.003, [-0.2, 0, 0])
    // Grip with checkered wood panels and a mainspring housing.
    pistolGrip(A, c('steelLt'), c('woodDk'), 0.044, 0.13, 0.058, 0, -0.056, 0.006, -0.2)
    for (let i = 0; i < 6; i++) {
        const y = -0.022 - i * 0.017
        for (const sx of [-1, 1]) A.box(c('dark'), 0.0035, 0.0035, 0.05, sx * 0.0325, y, 0.003 + (y + 0.056) * -0.2, 0)
    }

    const trigger = A.sub(0, 0.002, -0.056)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.008, 0.024, 0.008, 0, -0.004, -0.056, 0.002, [0.15, 0, 0])

    const hammer = A.sub(0, 0.05, 0.02)
    rig.hammer = hammer.group
    hammer.box(c('steel'), 0.011, 0.022, 0.016, 0, 0.056, 0.024, 0.003, [-0.5, 0, 0])
    hammer.box(c('dark'), 0.013, 0.006, 0.012, 0, 0.066, 0.03, 0.001)

    // Magazine: the plate stays visible when it drops out of the well.
    const mag = A.sub(0, -0.12, 0.018)
    rig.mag = mag.group
    mag.box(c('dark'), 0.038, 0.11, 0.048, 0, -0.056, 0.006, 0.003, [-0.2, 0, 0])
    mag.box(c('steel'), 0.05, 0.011, 0.068, 0, -0.121, 0.0195, 0.003, [-0.2, 0, 0])

    if (sally) {
        // Sally: a grenade-bore compensator with glowing rings and a lit slide.
        const accent = papAccent(tier)
        A.cyl(c('steel'), 0.017, 0.07, 0, 0.055, -0.325, 'z', 12)
        for (const z of [-0.305, -0.335, -0.36]) A.cyl(glow(accent, 2.2), 0.0195, 0.006, 0, 0.055, z, 'z', 12)
        A.cyl(c('dark'), 0.009, 0.01, 0, 0.055, -0.362, 'z', 8)
        for (let i = 0; i < 3; i++) slide.box(glow(accent, 2.2), 0.014, 0.002, 0.018, 0, 0.0865, -0.1 - i * 0.03, 0)
        for (const sx of [-1, 1]) slide.box(glow(accent, 1.8), 0.002, 0.006, 0.2, sx * 0.0255, 0.042, -0.155, 0)
        const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.03), sallyDecal(tier))
        decal.position.set(-0.0262, 0.058 - 0.055, -0.16 + 0.15)
        decal.rotation.y = -Math.PI / 2
        slide.group.add(decal)
        const decalR = decal.clone()
        decalR.position.x = 0.0262
        decalR.rotation.y = Math.PI / 2
        slide.group.add(decalR)
    }

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.052, z: 0.012, mode: 'y', s: 1, rx: 0.03, rz: 0.03, point: true, arm: [0.08, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: -0.004, y: -0.085, z: -0.024, mode: 'y', s: -1, rx: 0.03, rz: 0.03, thumbX: -1, arm: [-0.55, -0.35, 0.75], fingers: 3 })?.group
    return rig
}

function buildMagnum(A: Asm, c: C, tier: number): Rig {
    const rig = newRig('revolver', [0, 0.06, -0.37])
    rig.handMag = V(-0.08, 0.12, -0.08)
    const accent = papAccent(tier)

    // Frame with a hammer shroud, top strap and rear sight.
    A.box(c('nickel'), 0.05, 0.085, 0.14, 0, 0.03, -0.075, 0.008)
    A.box(c('nickel'), 0.038, 0.02, 0.13, 0, 0.078, -0.06, 0.004)
    A.box(c('dark'), 0.016, 0.014, 0.014, 0, 0.094, -0.012, 0.002)
    A.box(c('dark'), 0.006, 0.006, 0.012, 0.0, 0.091, -0.03, 0.001)
    // Barrel with a heavy underlug, vent rib and a raised front sight.
    A.cyl(c('nickel'), 0.0175, 0.24, 0, 0.056, -0.27, 'z', 12)
    A.box(c('nickel'), 0.026, 0.026, 0.19, 0, 0.026, -0.235, 0.008)
    A.cyl(c('nickel'), 0.014, 0.19, 0, 0.026, -0.235, 'z', 10)
    A.box(c('dark'), 0.011, 0.01, 0.2, 0, 0.078, -0.26, 0.002)
    for (let i = 0; i < 7; i++) A.box(c('nickel'), 0.012, 0.011, 0.008, 0, 0.078, -0.18 - i * 0.03, 0.001)
    A.box(c('dark'), 0.01, 0.022, 0.016, 0, 0.092, -0.375, 0.002)
    A.cyl(c('dark'), 0.011, 0.012, 0, 0.056, -0.388, 'z', 10)
    A.box(c('dark'), 0.012, 0.012, 0.03, 0, 0.007, -0.315, 0.002)

    // Crane holds the cylinder: swings out on reload; the cylinder inside spins per shot.
    const crane = A.sub(-0.045, 0.02, -0.09)
    rig.crane = crane.group
    const cyl = crane.sub(0, 0.035, -0.09)
    rig.cylinder = cyl.group
    cyl.cyl(c('steel'), 0.036, 0.085, 0, 0.035, -0.09, 'z', 16)
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6
        const fx = Math.sin(a) * 0.034
        const fy = Math.cos(a) * 0.034
        cyl.box(c('dark'), 0.011, 0.011, 0.07, fx, 0.035 + fy, -0.09, 0.001, [0, 0, -a])
        const hx = Math.sin(a + Math.PI / 6) * 0.022
        const hy = Math.cos(a + Math.PI / 6) * 0.022
        cyl.cyl(c('dark'), 0.0095, 0.006, hx, 0.035 + hy, -0.048, 'z', 8)
        cyl.cyl(c('brass'), 0.0075, 0.004, hx, 0.035 + hy, -0.046, 'z', 8)
    }
    cyl.cyl(c('nickel'), 0.011, 0.015, 0, 0.035, -0.044, 'z', 8)
    crane.cyl(c('nickel'), 0.007, 0.05, 0, 0.0, -0.09, 'z', 6)

    // Hammer, trigger and guard.
    const hammer = A.sub(0, 0.075, -0.01)
    rig.hammer = hammer.group
    hammer.box(c('steel'), 0.012, 0.026, 0.016, 0, 0.085, 0.006, 0.003, [-0.6, 0, 0])
    hammer.box(c('dark'), 0.017, 0.006, 0.012, 0, 0.096, 0.016, 0.001)
    const trigger = A.sub(0, 0.0, -0.045)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.008, 0.026, 0.009, 0, -0.006, -0.048, 0.002, [0.2, 0, 0])
    A.box(c('nickel'), 0.011, 0.007, 0.09, 0, -0.026, -0.06, 0.002)
    A.box(c('nickel'), 0.011, 0.03, 0.009, 0, -0.011, -0.103, 0.002)

    // Wood grip and steel butt.
    A.box(c('steel'), 0.044, 0.07, 0.05, 0, -0.02, 0.008, 0.005)
    pistolGrip(A, c('nickel'), c('woodDk'), 0.036, 0.12, 0.06, 0, -0.078, 0.048, -0.3, 0.012)
    A.box(c('steel'), 0.05, 0.012, 0.068, 0, -0.143, 0.085, 0.004, [-0.3, 0, 0])
    if (tier > 0) {
        A.cyl(glow(accent, 2), 0.0195, 0.006, 0, 0.056, -0.34, 'z', 12)
        A.box(glow(accent, 2), 0.004, 0.004, 0.19, 0, 0.0865, -0.26, 0)
    }

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.08, z: 0.05, mode: 'y', s: 1, rx: 0.032, rz: 0.034, point: true, arm: [0.08, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: -0.004, y: -0.1, z: 0.0, mode: 'y', s: -1, rx: 0.032, rz: 0.034, thumbX: -1, arm: [-0.55, -0.35, 0.75], fingers: 3 })?.group
    return rig
}

function buildSkorpion(A: Asm, c: C, tier: number): Rig {
    const rig = newRig('smg', [0, 0.04, -0.3])
    rig.travel = 0.028
    rig.magAxis = V(0, -1, 0)
    rig.magDrop = 0.18
    rig.handMag = V(0, -0.02, 0.06)

    // Receiver, ribbed front, barrel and the folded wire stock along the top.
    A.box(c('steel'), 0.05, 0.072, 0.21, 0, 0.026, -0.105, 0.008)
    A.box(c('steelLt'), 0.038, 0.014, 0.19, 0, 0.068, -0.1, 0.004)
    for (let i = 0; i < 5; i++) A.box(c('dark'), 0.052, 0.05, 0.005, 0, 0.026, -0.17 - i * 0.012, 0)
    A.cyl(c('dark'), 0.012, 0.09, 0, 0.038, -0.255, 'z', 10)
    A.cyl(c('steel'), 0.017, 0.045, 0, 0.038, -0.29, 'z', 10)
    A.cyl(c('dark'), 0.0095, 0.012, 0, 0.038, -0.316, 'z', 8)
    for (const sx of [-1, 1]) {
        A.cyl(c('dark'), 0.004, 0.19, sx * 0.022, 0.082, -0.1, 'z', 5)
        A.cyl(c('dark'), 0.004, 0.044, sx * 0.011, 0.082, 0.0, 'x', 5)
    }
    A.box(c('rubber'), 0.05, 0.018, 0.012, 0, 0.078, 0.0, 0.003)
    A.box(c('dark'), 0.008, 0.02, 0.012, 0, 0.088, -0.245, 0.001)
    A.box(c('dark'), 0.024, 0.016, 0.012, 0, 0.09, -0.02, 0.001)

    const bolt = A.sub(0.03, 0.05, -0.02)
    rig.bolt = bolt.group
    bolt.box(c('nickel'), 0.014, 0.016, 0.02, 0.03, 0.05, -0.02, 0.004)
    bolt.cyl(c('nickel'), 0.005, 0.03, 0.03, 0.05, -0.04, 'z', 6)
    bolt.box(c('dark'), 0.004, 0.012, 0.09, 0.0255, 0.045, -0.08, 0.001)

    // Grip, guard, selector.
    pistolGrip(A, c('poly'), c('rubber'), 0.04, 0.11, 0.05, 0, -0.06, 0.008, -0.16, 0.006)
    A.box(c('steelLt'), 0.011, 0.007, 0.07, 0, -0.016, -0.06, 0.002)
    A.box(c('steelLt'), 0.011, 0.026, 0.008, 0, -0.005, -0.1, 0.002)
    const trigger = A.sub(0, 0, -0.05)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.008, 0.02, 0.008, 0, -0.003, -0.05, 0.002, [0.15, 0, 0])
    A.box(c('dark'), 0.006, 0.012, 0.026, -0.027, 0.018, -0.03, 0.002)

    // Straight 20-round magazine ahead of the grip.
    const mag = A.sub(0, -0.03, -0.07)
    rig.mag = mag.group
    mag.box(c('steel'), 0.034, 0.17, 0.062, 0, -0.1, -0.07, 0.004)
    for (let i = 0; i < 3; i++) mag.box(c('dark'), 0.036, 0.004, 0.058, 0, -0.06 - i * 0.05, -0.07, 0)
    mag.box(c('dark'), 0.04, 0.01, 0.068, 0, -0.188, -0.07, 0.003)

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.055, z: 0.012, mode: 'y', s: 1, rx: 0.026, rz: 0.028, point: true, arm: [0.1, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: 0, y: 0.026, z: -0.15, mode: 'z', s: 1, rx: 0.027, rz: 0.037, arm: [-0.55, -0.35, 0.75], thumbAlong: 'y' })?.group
    return rig
}

// ---------------------------------------------------------------------------
// Shotgun and SMG
// ---------------------------------------------------------------------------

function buildTrench(A: Asm, c: C, tier: number): Rig {
    const rig = newRig('pump', [0, 0.048, -0.6])
    rig.travel = 0.1
    rig.shells = 4
    rig.handMag = V(0.0, -0.045, 0.27)
    const accent = papAccent(tier)

    // Receiver, ejection port, exposed hammer.
    A.box(c('steel'), 0.056, 0.088, 0.16, 0, 0.03, -0.12, 0.008)
    A.box(c('dark'), 0.006, 0.022, 0.07, 0.0285, 0.05, -0.1, 0.002)
    A.box(c('dark'), 0.006, 0.022, 0.07, -0.0285, 0.05, -0.1, 0.002)
    A.box(c('steelLt'), 0.05, 0.012, 0.16, 0, 0.078, -0.12, 0.004)
    const hammer = A.sub(0, 0.075, -0.03)
    rig.hammer = hammer.group
    hammer.box(c('steel'), 0.014, 0.028, 0.02, 0, 0.09, -0.03, 0.003, [-0.5, 0, 0])
    hammer.box(c('dark'), 0.02, 0.006, 0.012, 0, 0.102, -0.022, 0.001)

    // Barrel, magazine tube, perforated heat shield, bayonet lug.
    A.cyl(c('dark'), 0.0175, 0.42, 0, 0.048, -0.4, 'z', 12)
    A.cyl(c('steel'), 0.0135, 0.38, 0, 0.0, -0.38, 'z', 10)
    A.cyl(c('steel'), 0.016, 0.014, 0, 0.0, -0.575, 'z', 10)
    A.box(c('steelLt'), 0.042, 0.02, 0.26, 0, 0.075, -0.34, 0.006)
    A.box(c('steelLt'), 0.01, 0.03, 0.26, 0.022, 0.06, -0.34, 0.003)
    A.box(c('steelLt'), 0.01, 0.03, 0.26, -0.022, 0.06, -0.34, 0.003)
    for (let i = 0; i < 9; i++) A.box(c('dark'), 0.02, 0.003, 0.014, 0, 0.0855, -0.235 - i * 0.026, 0)
    A.box(c('dark'), 0.014, 0.024, 0.03, 0, 0.026, -0.585, 0.002)
    A.box(c('brass'), 0.007, 0.018, 0.007, 0, 0.078, -0.6, 0.001)
    A.box(c('dark'), 0.012, 0.012, 0.012, 0, 0.08, -0.6, 0.001)

    // Pump forend with grooves; travels back and forth on the rack.
    const pump = A.sub(0, -0.006, -0.37)
    rig.pump = pump.group
    pump.box(c('woodDk'), 0.062, 0.056, 0.18, 0, -0.008, -0.37, 0.012)
    for (let i = 0; i < 6; i++) {
        pump.box(c('dark'), 0.0645, 0.05, 0.005, 0, -0.008, -0.31 - i * 0.026, 0)
    }
    pump.box(c('steelLt'), 0.012, 0.012, 0.16, 0.026, 0.03, -0.27, 0.002)
    pump.box(c('steelLt'), 0.012, 0.012, 0.16, -0.026, 0.03, -0.27, 0.002)

    // Stock: full profile with a straight wrist and buttplate.
    A.extrude(c('wood'), [[-0.04, 0.062], [0.08, 0.056], [0.29, 0.034], [0.31, -0.13], [0.26, -0.132], [0.12, -0.075], [0.03, -0.062], [-0.04, -0.04]], 0.05)
    A.box(c('rubber'), 0.052, 0.17, 0.012, 0, -0.048, 0.31, 0.003, [0.1, 0, 0])
    A.box(c('steel'), 0.012, 0.007, 0.08, 0, -0.038, -0.03, 0.002)
    A.box(c('steel'), 0.012, 0.03, 0.008, 0, -0.024, -0.075, 0.002)
    const trigger = A.sub(0, -0.02, -0.03)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.008, 0.024, 0.008, 0, -0.02, -0.03, 0.002, [0.15, 0, 0])
    if (tier > 0) {
        A.box(glow(accent, 2), 0.003, 0.004, 0.24, 0.0245, 0.075, -0.34, 0)
        A.box(glow(accent, 2), 0.003, 0.004, 0.24, -0.0245, 0.075, -0.34, 0)
    }

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.02, z: 0.075, mode: 'y', s: 1, rx: 0.026, rz: 0.03, point: true, arm: [0.08, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: 0, y: -0.008, z: -0.36, mode: 'z', s: 1, rx: 0.033, rz: 0.028, arm: [-0.55, -0.35, 0.75], thumbAlong: 'y' })?.group
    return rig
}

function buildMp40(A: Asm, c: C, tier: number): Rig {
    const rig = newRig('smg', [0, 0.02, -0.46])
    rig.travel = 0.05
    rig.magAxis = V(0, -1, 0)
    rig.magDrop = 0.2
    rig.handMag = V(0, -0.1, 0.05)
    const accent = papAccent(tier)

    // Receiver tube, end cap, perforated barrel shroud and nose.
    A.cyl(c('steel'), 0.03, 0.36, 0, 0.02, -0.15, 'z', 14)
    A.cyl(c('dark'), 0.033, 0.024, 0, 0.02, 0.04, 'z', 14)
    A.cyl(c('dark'), 0.0255, 0.14, 0, 0.02, -0.38, 'z', 12)
    for (let i = 0; i < 6; i++) {
        for (let k = 0; k < 4; k++) {
            const a = -1.2 + k * 0.8
            A.box(c('dark'), 0.009, 0.007, 0.011, Math.sin(a) * 0.026, 0.02 + Math.cos(a) * 0.026, -0.325 - i * 0.02, 0, [a, 0, 0])
        }
    }
    A.cyl(c('dark'), 0.014, 0.03, 0, 0.02, -0.455, 'z', 8)
    A.box(c('dark'), 0.008, 0.022, 0.01, 0, 0.056, -0.44, 0.001)
    A.box(c('dark'), 0.006, 0.02, 0.012, 0.012, 0.054, -0.44, 0.001)
    A.box(c('dark'), 0.006, 0.02, 0.012, -0.012, 0.054, -0.44, 0.001)
    A.box(c('dark'), 0.02, 0.014, 0.012, 0, 0.056, -0.11, 0.002)
    A.box(c('steelLt'), 0.02, 0.024, 0.01, 0, 0.06, -0.1, 0.001)
    // Magazine housing with the ejection slot on the right.
    A.box(c('dark'), 0.05, 0.075, 0.09, 0, -0.03, -0.05, 0.006)
    A.box(c('dark'), 0.004, 0.006, 0.08, 0.031, 0.02, -0.14, 0.001)

    // Cocking handle rides in the slot on the right.
    const bolt = A.sub(0.03, 0.03, -0.1)
    rig.bolt = bolt.group
    bolt.cyl(c('steelLt'), 0.0045, 0.05, 0.055, 0.03, -0.1, 'x', 6)
    bolt.sphere(c('steelLt'), 0.014, 0.084, 0.03, -0.1, 8)

    // Bakelite grip, guard and the folded wire stock under the tube.
    pistolGrip(A, c('poly'), c('rubber'), 0.044, 0.11, 0.052, 0, -0.08, 0.058, -0.3, 0.004)
    A.box(c('steel'), 0.011, 0.007, 0.08, 0, -0.03, 0.01, 0.002)
    A.box(c('steel'), 0.011, 0.026, 0.008, 0, -0.018, -0.03, 0.002)
    const trigger = A.sub(0, 0.0, 0.0)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.008, 0.022, 0.008, 0, -0.012, 0.0, 0.002, [0.15, 0, 0])
    for (const sx of [-1, 1]) {
        A.cyl(c('dark'), 0.0045, 0.3, sx * 0.024, -0.036, -0.13, 'z', 5)
        A.cyl(c('dark'), 0.0045, 0.05, sx * 0.012, -0.036, 0.02, 'x', 5)
    }
    A.box(c('steel'), 0.05, 0.05, 0.008, 0, -0.035, -0.29, 0.003)

    // Long straight magazine: the left hand's usual perch.
    const mag = A.sub(0, -0.07, -0.05)
    rig.mag = mag.group
    mag.box(c('steel'), 0.034, 0.22, 0.074, 0, -0.16, -0.05, 0.004)
    for (let i = 0; i < 5; i++) mag.box(c('dark'), 0.036, 0.004, 0.07, 0, -0.08 - i * 0.04, -0.05, 0)
    mag.box(c('dark'), 0.04, 0.01, 0.08, 0, -0.272, -0.05, 0.003)
    if (tier > 0) A.box(glow(accent, 2), 0.004, 0.004, 0.3, 0.031, 0.05, -0.15, 0)

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.075, z: 0.058, mode: 'y', s: 1, rx: 0.026, rz: 0.03, point: true, arm: [0.1, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: 0, y: -0.15, z: -0.05, mode: 'y', s: -1, rx: 0.018, rz: 0.038, thumbX: -1, arm: [-0.55, -0.35, 0.75], fingers: 3 })?.group
    return rig
}

// ---------------------------------------------------------------------------
// Rifles
// ---------------------------------------------------------------------------

/** Filled polygon (as [z, y] points) around a quadratic bezier centreline. */
function curvedStrip(p0: [number, number], p1: [number, number], p2: [number, number], thick: number, steps = 6) {
    const left: [number, number][] = []
    const right: [number, number][] = []
    for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const a = 1 - t
        const x = a * a * p0[0] + 2 * a * t * p1[0] + t * t * p2[0]
        const y = a * a * p0[1] + 2 * a * t * p1[1] + t * t * p2[1]
        const dx = 2 * a * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
        const dy = 2 * a * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
        const len = Math.max(1e-6, Math.hypot(dx, dy))
        const nx = -dy / len
        const ny = dx / len
        left.push([x + nx * thick / 2, y + ny * thick / 2])
        right.push([x - nx * thick / 2, y - ny * thick / 2])
    }
    return [...left, ...right.reverse()]
}

function buildAk(A: Asm, c: C, tier: number, rpk: boolean): Rig {
    const muzzleZ = rpk ? -0.76 : -0.62
    const rig = newRig('ak', [0, 0.03, muzzleZ - 0.02])
    rig.travel = 0.034
    rig.magAxis = V(0.0, -0.8, -0.35).normalize()
    rig.magDrop = 0.2
    rig.handMag = V(0, -0.14, 0.02)
    const accent = papAccent(tier)
    const hgFront = rpk ? -0.56 : -0.47

    // Stamped receiver with ribbed dust cover and rear sight.
    A.box(c('steel'), 0.05, 0.07, 0.22, 0, 0.02, -0.11, 0.007)
    A.box(c('steelLt'), 0.042, 0.03, 0.2, 0, 0.06, -0.11, 0.006)
    for (let i = 0; i < 3; i++) A.box(c('dark'), 0.044, 0.004, 0.01, 0, 0.0765, -0.05 - i * 0.05, 0)
    A.box(c('steelLt'), 0.026, 0.02, 0.055, 0, 0.082, -0.245, 0.003)
    A.box(c('dark'), 0.02, 0.014, 0.008, 0, 0.098, -0.25, 0.001, [0.3, 0, 0])
    A.box(c('dark'), 0.006, 0.008, 0.01, 0.0, 0.106, -0.255, 0.001)
    A.box(c('dark'), 0.004, 0.058, 0.13, 0.0265, 0.028, -0.09, 0.001)
    // Barrel, gas tube, wooden handguards, muzzle brake.
    A.cyl(c('dark'), rpk ? 0.0145 : 0.0115, hgFront + 0.6 - 0.02, 0, 0.028, (hgFront - 0.29) / 2 - 0.02, 'z', 10)
    A.box(c('wood'), 0.052, 0.046, hgFront * -1 - 0.29 + 0.0, 0, 0.012, (-0.29 + hgFront) / 2, 0.01)
    A.box(c('wood'), 0.044, 0.028, hgFront * -1 - 0.31 + 0.0, 0, 0.053, (-0.3 + hgFront) / 2, 0.008)
    for (let i = 0; i < 4; i++) A.box(c('dark'), 0.054, 0.03, 0.004, 0, 0.012, hgFront + 0.04 + i * 0.03, 0)
    A.box(c('steel'), 0.056, 0.05, 0.012, 0, 0.026, hgFront - 0.005, 0.003)
    const gasZ = hgFront - 0.03
    A.box(c('steel'), 0.024, 0.05, 0.036, 0, 0.055, gasZ, 0.004)
    A.box(c('dark'), 0.007, 0.03, 0.008, 0, 0.098, gasZ + 0.008, 0.001)
    A.box(c('dark'), 0.006, 0.02, 0.012, 0.011, 0.088, gasZ + 0.008, 0.001)
    A.box(c('dark'), 0.006, 0.02, 0.012, -0.011, 0.088, gasZ + 0.008, 0.001)
    A.cyl(c('dark'), 0.0175, 0.065, 0, 0.03, muzzleZ + 0.005, 'z', 10)
    for (let i = 0; i < 3; i++) A.box(c('steel'), 0.038, 0.006, 0.006, 0, 0.03, muzzleZ - 0.012 + i * 0.02, 0)
    A.cyl(c('dark'), 0.0095, 0.02, 0, 0.03, muzzleZ - 0.03, 'z', 8)
    if (rpk) {
        // Folded bipod under the muzzle end.
        for (const sx of [-1, 1]) A.cyl(c('dark'), 0.005, 0.17, sx * 0.028, -0.005, muzzleZ + 0.13, 'z', 5)
        A.box(c('steel'), 0.07, 0.02, 0.02, 0, 0.006, muzzleZ + 0.06, 0.003)
    }

    // Wooden stock, pistol grip, guard.
    A.extrude(c('wood'), [[0.0, 0.062], [0.14, 0.058], [0.3, 0.038], [0.315, -0.095], [0.27, -0.097], [0.12, -0.045], [0.0, -0.035]], 0.05)
    A.box(c('rubber'), 0.052, 0.13, 0.012, 0, -0.03, 0.312, 0.003, [0.1, 0, 0])
    pistolGrip(A, c('plum'), c('plum'), 0.04, 0.105, 0.05, 0, -0.08, 0.04, -0.35, 0.0)
    A.box(c('steel'), 0.011, 0.007, 0.09, 0, -0.026, -0.02, 0.002)
    A.box(c('steel'), 0.011, 0.028, 0.008, 0, -0.012, -0.065, 0.002)
    const trigger = A.sub(0, -0.005, -0.015)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.008, 0.022, 0.008, 0, -0.012, -0.02, 0.002, [0.15, 0, 0])

    // Charging handle on the right of the bolt carrier.
    const bolt = A.sub(0.03, 0.04, -0.09)
    rig.bolt = bolt.group
    bolt.box(c('steel'), 0.014, 0.016, 0.03, 0.036, 0.042, -0.085, 0.003)
    bolt.box(c('steelLt'), 0.02, 0.008, 0.012, 0.03, 0.04, -0.07, 0.002)

    // Curved magazine (plum polymer for the 74, black 40-rounder on the RPK).
    const mag = A.sub(0, -0.02, -0.11)
    rig.mag = mag.group
    const magMat = rpk ? c('poly') : c('plum')
    const magPts = rpk
        ? curvedStrip([-0.1, -0.005], [-0.115, -0.2], [-0.23, -0.28], 0.068, 7)
        : curvedStrip([-0.1, -0.005], [-0.115, -0.14], [-0.18, -0.2], 0.056, 6)
    mag.extrude(magMat, magPts, 0.036, 0, 0.003)
    for (let i = 0; i < 3; i++) {
        const t = 0.25 + i * 0.22
        const my = -0.005 + (rpk ? -0.28 : -0.2) * t
        mag.box(c('dark'), 0.038, 0.005, 0.05, 0, my, -0.1 - (rpk ? 0.13 : 0.08) * t * t - 0.012, 0.0, [0.5 * t, 0, 0])
    }
    if (tier > 0) A.box(glow(accent, 2), 0.003, 0.004, 0.2, 0.0265, 0.05, -0.1, 0)

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.08, z: 0.045, mode: 'y', s: 1, rx: 0.025, rz: 0.03, point: true, arm: [0.08, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: 0, y: 0.012, z: (hgFront - 0.29) / 2, mode: 'z', s: 1, rx: 0.028, rz: 0.024, arm: [-0.55, -0.35, 0.75], thumbAlong: 'y' })?.group
    return rig
}

function buildBar(A: Asm, c: C, tier: number): Rig {
    const rig = newRig('ak', [0, 0.035, -0.79])
    rig.travel = 0.04
    rig.magAxis = V(0, -1, 0)
    rig.magDrop = 0.2
    rig.handMag = V(0, -0.12, 0.02)
    const accent = papAccent(tier)

    // Receiver, dust cover, ring sights.
    A.box(c('steel'), 0.06, 0.09, 0.3, 0, 0.02, -0.16, 0.008)
    A.box(c('steelLt'), 0.05, 0.02, 0.24, 0, 0.076, -0.15, 0.005)
    for (let i = 0; i < 5; i++) A.box(c('dark'), 0.062, 0.004, 0.012, 0, 0.032, -0.06 - i * 0.05, 0)
    A.box(c('steelLt'), 0.03, 0.024, 0.04, 0, 0.096, -0.07, 0.003)
    A.torus(c('dark'), 0.012, 0.003, 0, 0.114, -0.07, 'z', 10)
    A.box(c('dark'), 0.008, 0.016, 0.01, 0, 0.096, -0.68, 0.001)
    A.box(c('dark'), 0.05, 0.02, 0.02, 0, 0.07, -0.66, 0.003)
    // Barrel, gas cylinder, flash hider.
    A.cyl(c('dark'), 0.0185, 0.4, 0, 0.038, -0.5, 'z', 12)
    A.cyl(c('steel'), 0.014, 0.28, 0, -0.006, -0.42, 'z', 10)
    for (const z of [-0.36, -0.54]) A.cyl(c('steel'), 0.024, 0.014, 0, 0.032, z, 'z', 12)
    A.cyl(c('dark'), 0.023, 0.1, 0, 0.038, -0.74, 'z', 12)
    for (const sy of [-1, 1]) A.box(c('steel'), 0.005, 0.012, 0.07, 0, 0.038 + sy * 0.023, -0.74, 0)
    A.cyl(c('dark'), 0.012, 0.02, 0, 0.038, -0.795, 'z', 8)
    // Forearm and folded bipod.
    A.box(c('wood'), 0.068, 0.056, 0.23, 0, 0.0, -0.4, 0.012)
    A.box(c('steel'), 0.072, 0.06, 0.014, 0, 0.0, -0.29, 0.003)
    for (const sx of [-1, 1]) A.cyl(c('dark'), 0.0055, 0.14, sx * 0.032, -0.035, -0.53, 'z', 5)
    A.box(c('steel'), 0.08, 0.02, 0.02, 0, -0.03, -0.6, 0.003)
    // Stock and grip.
    A.extrude(c('wood'), [[-0.02, 0.07], [0.12, 0.064], [0.34, 0.048], [0.355, -0.12], [0.3, -0.124], [0.14, -0.062], [0.05, -0.06], [-0.02, -0.03]], 0.06)
    A.box(c('rubber'), 0.062, 0.17, 0.012, 0, -0.04, 0.35, 0.003, [0.1, 0, 0])
    pistolGrip(A, c('woodDk'), c('woodDk'), 0.045, 0.11, 0.055, 0, -0.085, 0.045, -0.3, 0.0)
    A.box(c('steel'), 0.012, 0.007, 0.1, 0, -0.03, -0.02, 0.002)
    A.box(c('steel'), 0.012, 0.03, 0.008, 0, -0.016, -0.07, 0.002)
    const trigger = A.sub(0, -0.005, -0.02)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.008, 0.024, 0.008, 0, -0.014, -0.02, 0.002, [0.15, 0, 0])
    const bolt = A.sub(0.035, 0.055, -0.12)
    rig.bolt = bolt.group
    bolt.box(c('steel'), 0.014, 0.016, 0.03, 0.04, 0.056, -0.12, 0.003)

    const mag = A.sub(0, -0.03, -0.15)
    rig.mag = mag.group
    mag.box(c('steel'), 0.042, 0.14, 0.09, 0, -0.1, -0.15, 0.004)
    for (let i = 0; i < 4; i++) mag.box(c('dark'), 0.044, 0.004, 0.086, 0, -0.06 - i * 0.03, -0.15, 0)
    mag.box(c('dark'), 0.05, 0.01, 0.1, 0, -0.174, -0.15, 0.003)
    if (tier > 0) A.box(glow(accent, 2), 0.003, 0.004, 0.24, 0.0305, 0.078, -0.15, 0)

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.085, z: 0.045, mode: 'y', s: 1, rx: 0.028, rz: 0.03, point: true, arm: [0.08, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: 0, y: 0.0, z: -0.4, mode: 'z', s: 1, rx: 0.034, rz: 0.028, arm: [-0.55, -0.35, 0.75], thumbAlong: 'y' })?.group
    return rig
}

function buildMosin(A: Asm, c: C, tier: number): Rig {
    const rig = newRig('mosin', [0, 0.044, -0.74])
    rig.travel = 0.09
    rig.shells = 4
    rig.handMag = V(0, 0.06, 0.28)
    const accent = papAccent(tier)

    // Full-length wood, upper handguard, bands.
    A.extrude(c('wood'), [[-0.5, 0.008], [-0.1, 0.014], [0.02, 0.034], [0.16, 0.048], [0.31, 0.03], [0.325, -0.125], [0.27, -0.128], [0.13, -0.052], [0.02, -0.058], [-0.1, -0.04], [-0.5, -0.03]], 0.048)
    A.box(c('wood'), 0.04, 0.02, 0.22, 0, 0.056, -0.31, 0.006)
    A.box(c('steel'), 0.052, 0.062, 0.012, 0, 0.012, -0.42, 0.003)
    A.box(c('steel'), 0.052, 0.062, 0.012, 0, 0.018, -0.2, 0.003)
    A.box(c('steel'), 0.054, 0.05, 0.01, 0, -0.005, -0.5, 0.002)
    // Barrel, receiver and sights.
    A.cyl(c('steel'), 0.0115, 0.66, 0, 0.044, -0.4, 'z', 10, 0.0155)
    A.cyl(c('steel'), 0.021, 0.14, 0, 0.044, -0.01, 'z', 12)
    A.box(c('steel'), 0.03, 0.03, 0.14, 0, 0.03, -0.01, 0.005)
    A.box(c('dark'), 0.012, 0.03, 0.014, 0, 0.078, -0.72, 0.002)
    A.box(c('dark'), 0.006, 0.02, 0.014, 0.013, 0.07, -0.72, 0.001)
    A.box(c('dark'), 0.006, 0.02, 0.014, -0.013, 0.07, -0.72, 0.001)
    A.box(c('steelLt'), 0.02, 0.02, 0.05, 0, 0.078, -0.17, 0.003)
    A.box(c('dark'), 0.014, 0.008, 0.06, 0, 0.09, -0.17, 0.001, [0.15, 0, 0])
    A.cyl(c('steel'), 0.013, 0.05, 0, 0.044, -0.74, 'z', 8)
    // Internal magazine bulge, guard, buttplate, sling swivel.
    A.box(c('steel'), 0.034, 0.03, 0.11, 0, -0.045, -0.02, 0.005)
    A.box(c('steel'), 0.012, 0.007, 0.09, 0, -0.078, 0.02, 0.002)
    A.box(c('steel'), 0.05, 0.135, 0.008, 0, -0.045, 0.328, 0.003)
    A.torus(c('steel'), 0.009, 0.0025, 0.0, -0.13, 0.22, 'x', 8)
    const trigger = A.sub(0, -0.06, 0.0)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.007, 0.022, 0.008, 0, -0.065, 0.0, 0.002, [0.15, 0, 0])

    // Bolt: body slides back; handle lifts by rolling the whole bolt.
    const bolt = A.sub(0, 0.044, 0.03)
    rig.bolt = bolt.group
    bolt.cyl(c('nickel'), 0.0105, 0.12, 0, 0.044, 0.02, 'z', 10)
    bolt.cyl(c('nickel'), 0.0045, 0.05, 0.03, 0.044, 0.045, 'x', 6)
    bolt.sphere(c('nickel'), 0.014, 0.06, 0.038, 0.045, 8)
    bolt.box(c('dark'), 0.012, 0.012, 0.03, 0, 0.056, 0.09, 0.002)
    if (tier > 0) A.box(glow(accent, 2), 0.003, 0.004, 0.24, 0.0225, 0.056, -0.31, 0)

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.01, z: 0.1, mode: 'y', s: 1, rx: 0.024, rz: 0.03, point: true, arm: [0.08, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: 0, y: 0.0, z: -0.3, mode: 'z', s: 1, rx: 0.026, rz: 0.024, arm: [-0.55, -0.35, 0.75], thumbAlong: 'y' })?.group
    return rig
}

// ---------------------------------------------------------------------------
// Machine guns
// ---------------------------------------------------------------------------

function buildM60(A: Asm, c: C, tier: number): Rig {
    const rig = newRig('lmg', [0, 0.03, -0.94])
    rig.magAxis = V(0, -1, 0)
    rig.magDrop = 0.2
    rig.handMag = V(0, -0.08, 0.32)
    const accent = papAccent(tier)

    // Receiver, ejection port and rear leaf sight.
    A.box(c('steel'), 0.07, 0.092, 0.36, 0, 0.02, -0.14, 0.008)
    A.box(c('dark'), 0.004, 0.03, 0.09, 0.036, 0.036, -0.1, 0.001)
    A.box(c('dark'), 0.05, 0.008, 0.16, 0, 0.069, -0.17, 0.002)
    for (let i = 0; i < 3; i++) A.box(c('dark'), 0.072, 0.006, 0.014, 0, -0.012, -0.1 - i * 0.07, 0)
    A.box(c('dark'), 0.02, 0.016, 0.03, 0, 0.076, -0.01, 0.002)
    A.box(c('steelLt'), 0.008, 0.03, 0.008, 0, 0.096, -0.014, 0.001, [-0.3, 0, 0])

    // Feed cover hinges at the back and lifts at the front on reload.
    const cover = A.sub(0, 0.068, -0.06)
    rig.cover = cover.group
    cover.box(c('steelLt'), 0.068, 0.026, 0.2, 0, 0.08, -0.17, 0.006)
    for (let i = 0; i < 3; i++) cover.box(c('dark'), 0.07, 0.004, 0.012, 0, 0.094, -0.11 - i * 0.05, 0)
    cover.box(c('dark'), 0.02, 0.02, 0.012, 0, 0.078, -0.275, 0.002)

    // Barrel, jacket, gas cylinder, carry handle and flash hider.
    A.cyl(c('dark'), 0.0165, 0.62, 0, 0.03, -0.62, 'z', 12)
    A.cyl(c('steel'), 0.026, 0.14, 0, 0.03, -0.39, 'z', 12)
    for (const z of [-0.5, -0.53]) A.cyl(c('steel'), 0.021, 0.008, 0, 0.03, z, 'z', 12)
    A.cyl(c('steel'), 0.0125, 0.3, 0, -0.002, -0.47, 'z', 8)
    A.box(c('poly'), 0.05, 0.04, 0.14, 0, -0.014, -0.52, 0.006)
    for (const z of [-0.36, -0.54]) A.box(c('steelLt'), 0.012, 0.04, 0.012, 0, 0.076, z, 0.001)
    A.box(c('steelLt'), 0.016, 0.012, 0.2, 0, 0.1, -0.45, 0.004)
    A.box(c('dark'), 0.018, 0.012, 0.03, 0, 0.052, -0.78, 0.001)
    A.box(c('dark'), 0.006, 0.026, 0.008, 0, 0.07, -0.78, 0.001)
    for (const sx of [-1, 1]) A.box(c('dark'), 0.005, 0.02, 0.012, sx * 0.011, 0.062, -0.78, 0.001)
    A.cyl(c('steel'), 0.02, 0.07, 0, 0.03, -0.895, 'z', 10)
    for (let i = 0; i < 2; i++) {
        A.box(c('dark'), 0.043, 0.005, 0.018, 0, 0.03, -0.875 - i * 0.026, 0)
        A.box(c('dark'), 0.005, 0.043, 0.018, 0, 0.03, -0.875 - i * 0.026, 0)
    }
    A.cyl(c('dark'), 0.011, 0.008, 0, 0.03, -0.932, 'z', 8)
    // Folded bipod.
    A.box(c('steel'), 0.07, 0.02, 0.03, 0, -0.024, -0.6, 0.003)
    for (const sx of [-1, 1]) {
        A.cyl(c('dark'), 0.0055, 0.25, sx * 0.03, -0.034, -0.725, 'z', 5)
        A.box(c('rubber'), 0.012, 0.012, 0.03, sx * 0.03, -0.034, -0.85, 0.002)
    }

    // Poly stock, pistol grip and guard.
    A.extrude(c('poly'), [[0.02, 0.058], [0.14, 0.056], [0.3, 0.04], [0.32, -0.105], [0.28, -0.108], [0.15, -0.05], [0.02, -0.038]], 0.048)
    A.box(c('rubber'), 0.05, 0.15, 0.012, 0, -0.033, 0.322, 0.003, [0.1, 0, 0])
    pistolGrip(A, c('poly'), c('poly'), 0.042, 0.1, 0.05, 0, -0.08, 0.04, -0.3, 0)
    A.box(c('steel'), 0.011, 0.007, 0.09, 0, -0.03, -0.02, 0.002)
    A.box(c('steel'), 0.011, 0.03, 0.008, 0, -0.015, -0.065, 0.002)
    const trigger = A.sub(0, -0.005, -0.015)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.008, 0.022, 0.008, 0, -0.012, -0.02, 0.002, [0.15, 0, 0])

    // Ammo box on the left with the belt running up into the feed tray.
    const mag = A.sub(0, -0.06, -0.19)
    rig.mag = mag.group
    mag.box(c('oliveDk'), 0.075, 0.115, 0.14, -0.015, -0.09, -0.19, 0.008)
    mag.box(c('olive'), 0.078, 0.012, 0.145, -0.015, -0.035, -0.19, 0.004)
    mag.box(c('dark'), 0.02, 0.012, 0.06, -0.015, -0.028, -0.19, 0.003)
    mag.box(c('brass'), 0.077, 0.006, 0.02, -0.015, -0.1, -0.19, 0)
    for (const sz of [-0.15, -0.23]) mag.box(c('steel'), 0.078, 0.02, 0.012, -0.015, -0.055, sz, 0.002)
    belt(mag, c, [-0.045, -0.03, -0.2], [-0.06, 0.0, -0.17], [-0.02, 0.048, -0.17], 5, true)
    if (tier > 0) {
        A.box(glow(accent, 2), 0.003, 0.004, 0.16, 0.0365, 0.04, -0.15, 0)
        A.cyl(glow(accent, 2), 0.0175, 0.006, 0, 0.03, -0.44, 'z', 12)
    }

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.08, z: 0.04, mode: 'y', s: 1, rx: 0.027, rz: 0.03, point: true, arm: [0.08, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: 0, y: -0.014, z: -0.52, mode: 'z', s: 1, rx: 0.029, rz: 0.026, arm: [-0.55, -0.35, 0.75], thumbAlong: 'y' })?.group
    return rig
}

function buildFnMag(A: Asm, c: C, tier: number): Rig {
    const rig = newRig('lmg', [0, 0.03, -0.99])
    rig.magAxis = V(0, -1, 0)
    rig.magDrop = 0.2
    rig.handMag = V(0, -0.08, 0.34)
    const accent = papAccent(tier)

    // Long receiver with a railed, hinged cover.
    A.box(c('steelLt'), 0.066, 0.09, 0.4, 0, 0.02, -0.16, 0.008)
    A.box(c('dark'), 0.004, 0.03, 0.1, 0.034, 0.036, -0.12, 0.001)
    A.box(c('dark'), 0.05, 0.008, 0.16, 0, 0.066, -0.18, 0.002)
    A.box(c('dark'), 0.02, 0.016, 0.03, 0, 0.074, -0.01, 0.002)
    A.box(c('steelLt'), 0.008, 0.028, 0.008, 0, 0.092, -0.014, 0.001, [-0.3, 0, 0])
    const cover = A.sub(0, 0.066, -0.06)
    rig.cover = cover.group
    cover.box(c('steel'), 0.062, 0.024, 0.24, 0, 0.078, -0.19, 0.006)
    cover.box(c('dark'), 0.02, 0.006, 0.24, 0, 0.093, -0.19, 0.001)
    for (let i = 0; i < 8; i++) cover.box(c('dark'), 0.026, 0.005, 0.008, 0, 0.094, -0.09 - i * 0.03, 0)

    // Vented gas jacket, regulator, folded carry handle, barrel and flash hider.
    A.cyl(c('steel'), 0.025, 0.34, 0, 0.03, -0.5, 'z', 12)
    for (let i = 0; i < 7; i++) {
        const z = -0.36 - i * 0.04
        A.box(c('dark'), 0.012, 0.004, 0.014, 0, 0.0555, z, 0)
        for (const sx of [-1, 1]) A.box(c('dark'), 0.004, 0.012, 0.014, sx * 0.0255, 0.03, z, 0)
    }
    A.box(c('steel'), 0.03, 0.03, 0.05, 0, 0.0, -0.66, 0.004)
    A.cyl(c('dark'), 0.0135, 0.62, 0, 0.03, -0.64, 'z', 12)
    for (const z of [-0.4, -0.56]) A.box(c('dark'), 0.01, 0.03, 0.01, 0, 0.072, z, 0.001)
    A.box(c('dark'), 0.014, 0.012, 0.18, 0, 0.088, -0.48, 0.004)
    A.box(c('dark'), 0.018, 0.012, 0.03, 0, 0.05, -0.83, 0.001)
    A.box(c('dark'), 0.006, 0.026, 0.008, 0, 0.068, -0.83, 0.001)
    A.cyl(c('dark'), 0.019, 0.05, 0, 0.03, -0.965, 'z', 10)
    for (const sx of [-1, 1]) A.box(c('steel'), 0.004, 0.04, 0.05, sx * 0.02, 0.03, -0.965, 0)
    A.box(c('steel'), 0.04, 0.004, 0.05, 0, 0.05, -0.965, 0)
    A.cyl(c('dark'), 0.01, 0.008, 0, 0.03, -0.99, 'z', 8)
    // Folded bipod under the jacket.
    A.box(c('steel'), 0.07, 0.02, 0.03, 0, -0.026, -0.62, 0.003)
    for (const sx of [-1, 1]) {
        A.cyl(c('dark'), 0.005, 0.25, sx * 0.03, -0.036, -0.74, 'z', 5)
        A.box(c('rubber'), 0.012, 0.012, 0.03, sx * 0.03, -0.036, -0.865, 0.002)
    }

    // Olive polymer stock with a cheek rise, grip and guard.
    A.extrude(c('olive'), [[0.02, 0.058], [0.14, 0.056], [0.3, 0.048], [0.335, 0.04], [0.335, -0.11], [0.29, -0.112], [0.24, -0.06], [0.12, -0.045], [0.02, -0.038]], 0.05)
    A.box(c('rubber'), 0.052, 0.15, 0.012, 0, -0.035, 0.34, 0.003, [0.05, 0, 0])
    pistolGrip(A, c('olive'), c('olive'), 0.042, 0.1, 0.05, 0, -0.08, 0.04, -0.3, 0)
    A.box(c('steel'), 0.011, 0.007, 0.09, 0, -0.03, -0.02, 0.002)
    A.box(c('steel'), 0.011, 0.03, 0.008, 0, -0.015, -0.065, 0.002)
    const trigger = A.sub(0, -0.005, -0.015)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.008, 0.022, 0.008, 0, -0.012, -0.02, 0.002, [0.15, 0, 0])

    // Black ammo box, belt entering from the left.
    const mag = A.sub(0, -0.06, -0.17)
    rig.mag = mag.group
    mag.box(c('poly'), 0.08, 0.11, 0.12, -0.02, -0.088, -0.17, 0.008)
    mag.box(c('steelLt'), 0.083, 0.012, 0.125, -0.02, -0.036, -0.17, 0.004)
    mag.box(c('steel'), 0.02, 0.012, 0.05, -0.02, -0.028, -0.17, 0.003)
    for (const sz of [-0.13, -0.21]) mag.box(c('steel'), 0.083, 0.02, 0.012, -0.02, -0.06, sz, 0.002)
    belt(mag, c, [-0.05, -0.03, -0.18], [-0.065, 0.0, -0.15], [-0.02, 0.046, -0.15], 5, true)
    if (tier > 0) {
        A.box(glow(accent, 2), 0.003, 0.004, 0.2, 0.0345, 0.04, -0.15, 0)
        A.cyl(glow(accent, 2), 0.0265, 0.006, 0, 0.03, -0.36, 'z', 12)
    }

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.08, z: 0.04, mode: 'y', s: 1, rx: 0.027, rz: 0.03, point: true, arm: [0.08, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: 0, y: 0.03, z: -0.5, mode: 'z', s: 1, rx: 0.029, rz: 0.03, arm: [-0.55, -0.35, 0.75], thumbAlong: 'y' })?.group
    return rig
}

// ---------------------------------------------------------------------------
// Bazooka, wonder weapon, Death Machine
// ---------------------------------------------------------------------------

function buildBazooka(A: Asm, c: C, tier: number): Rig {
    const y = 0.03
    const rig = newRig('rocket', [0, y, -0.99])
    rig.magAxis = V(0, 0, 1)
    rig.magDrop = 0.16
    rig.handMag = V(0, 0.03, 0.42)
    rig.noHandFollow = true
    const accent = papAccent(tier)

    // Launch tube, flared muzzle lip, exhaust cone and reinforcing bands.
    A.cyl(c('olive'), 0.062, 1.0, 0, y, -0.3, 'z', 18)
    A.cyl(c('oliveDk'), 0.078, 0.07, 0, y, -0.8, 'z', 18, 0.063)
    A.torus(c('steel'), 0.077, 0.006, 0, y, -0.835, 'z', 18)
    A.cyl(c('oliveDk'), 0.063, 0.09, 0, y, 0.245, 'z', 18, 0.09)
    A.cyl(c('dark'), 0.085, 0.004, 0, y, 0.288, 'z', 18)
    A.torus(c('steel'), 0.09, 0.006, 0, y, 0.29, 'z', 18)
    for (const z of [-0.68, -0.34, -0.06, 0.14]) A.cyl(c('steel'), 0.0665, 0.014, 0, y, z, 'z', 18)
    if (tier > 0) A.cyl(glow(accent, 2), 0.0655, 0.02, 0, y, -0.5, 'z', 18)
    else A.cyl(c('brass'), 0.0645, 0.03, 0, y, -0.5, 'z', 18)
    for (let i = 0; i < 4; i++) A.box(c('dark'), 0.05, 0.004, 0.03, 0, y + 0.0632, -0.2 + i * 0.05, 0)

    // Ladder sight, ring front sight and the firing battery box on the right.
    A.box(c('dark'), 0.02, 0.008, 0.14, 0, 0.096, -0.25, 0.002)
    for (const sx of [-1, 1]) A.box(c('dark'), 0.006, 0.05, 0.008, sx * 0.018, 0.12, -0.08, 0.001)
    A.box(c('dark'), 0.042, 0.008, 0.01, 0, 0.145, -0.08, 0.001)
    A.torus(c('dark'), 0.011, 0.003, 0, 0.128, -0.08, 'z', 10)
    A.box(c('dark'), 0.006, 0.05, 0.006, 0, 0.12, -0.7, 0.001)
    A.torus(c('dark'), 0.02, 0.003, 0, 0.16, -0.7, 'z', 12)
    A.box(c('dark'), 0.034, 0.05, 0.14, 0.07, 0.03, -0.14, 0.006)
    A.cyl(c('brass'), 0.006, 0.02, 0.07, 0.03, -0.225, 'z', 6)
    A.cyl(c('rubber'), 0.004, 0.16, 0.065, 0.02, -0.05, 'z', 5)

    // Twin grips, mounts and the wooden shoulder stock.
    A.box(c('steel'), 0.05, 0.03, 0.11, 0, -0.045, 0.0, 0.006)
    pistolGrip(A, c('poly'), c('poly'), 0.042, 0.095, 0.05, 0, -0.09, 0.02, -0.25, 0)
    A.box(c('steel'), 0.011, 0.007, 0.07, 0, -0.058, -0.04, 0.002)
    A.box(c('steel'), 0.011, 0.024, 0.008, 0, -0.048, -0.075, 0.002)
    const trigger = A.sub(0, -0.05, -0.02)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.008, 0.022, 0.008, 0, -0.06, -0.025, 0.002, [0.15, 0, 0])
    A.box(c('steel'), 0.05, 0.028, 0.08, 0, -0.045, -0.22, 0.005)
    A.box(c('poly'), 0.04, 0.09, 0.045, 0, -0.09, -0.22, 0.006)
    A.extrude(c('wood'), [[0.06, -0.034], [0.18, -0.038], [0.3, -0.06], [0.32, -0.15], [0.27, -0.15], [0.06, -0.08]], 0.05)
    A.box(c('rubber'), 0.052, 0.1, 0.012, 0, -0.1, 0.318, 0.003, [0.1, 0, 0])

    // The rocket: its nose sits in the muzzle and slides back on reload.
    const rocket = A.sub(0, y, -0.86)
    rig.mag = rocket.group
    rocket.cone(c('copper'), 0.05, 0.16, 0, y, -0.9, 'z', 14)
    rocket.cyl(c('oliveDk'), 0.05, 0.04, 0, y, -0.82, 'z', 14)
    rocket.cyl(tier > 0 ? glow(accent, 2) : c('brass'), 0.0505, 0.01, 0, y, -0.845, 'z', 14)

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.09, z: 0.02, mode: 'y', s: 1, rx: 0.026, rz: 0.03, point: true, arm: [0.08, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: 0, y: -0.09, z: -0.22, mode: 'y', s: -1, rx: 0.024, rz: 0.026, thumbX: -1, arm: [-0.55, -0.35, 0.75], fingers: 3 })?.group
    return rig
}

function buildXenoRay(A: Asm, c: C, tier: number): Rig {
    const rig = newRig('wonder', [0, 0.05, -0.64])
    const dir = V(-1, -0.3, 0).normalize()
    rig.magAxis = dir
    rig.magDrop = 0.14
    rig.handMag = V(-0.06, 0.02, 0.1)
    const color = tier > 0 ? papAccent(tier) : 0x44ffcc
    const hot = glow(color, 2.4)
    const dim = glow(color, 1.3)

    // Organic body with a chitin underside and ribbed spine.
    A.box(c('alien'), 0.088, 0.1, 0.3, 0, 0.02, -0.08, 0.012)
    A.box(c('chitin'), 0.09, 0.05, 0.16, 0, -0.005, -0.2, 0.008)
    for (let i = 0; i < 5; i++) A.box(c('chitin'), 0.094, 0.018, 0.014, 0, 0.05, 0.03 - i * 0.05, 0.004)
    for (let i = 0; i < 3; i++) A.box(c('alien'), 0.006, 0.05 - i * 0.008, 0.06, 0, 0.09, -0.02 - i * 0.07, 0.002)
    A.box(dim, 0.004, 0.004, 0.2, 0.0445, 0.03, -0.06, 0)
    A.box(dim, 0.004, 0.004, 0.2, -0.0445, 0.03, -0.06, 0)

    // Barrel core wrapped in glowing coils with linking rods.
    A.cyl(c('chitin'), 0.03, 0.44, 0, 0.05, -0.36, 'z', 12)
    for (let i = 0; i < 5; i++) A.torus(hot, 0.043, 0.007, 0, 0.05, -0.22 - i * 0.075, 'z', 14)
    for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4
        A.cyl(dim, 0.0045, 0.36, Math.sin(a) * 0.043, 0.05 + Math.cos(a) * 0.043, -0.36, 'z', 5)
    }
    // Flared emitter dish with a glowing throat.
    A.cyl(c('alien'), 0.07, 0.09, 0, 0.05, -0.585, 'z', 14, 0.032)
    A.cyl(hot, 0.055, 0.006, 0, 0.05, -0.628, 'z', 14)
    A.sphere(hot, 0.026, 0, 0.05, -0.6, 8)
    for (let k = 0; k < 3; k++) {
        const a = k * Math.PI * 2 / 3 + Math.PI / 2
        A.box(c('chitin'), 0.008, 0.008, 0.05, Math.sin(a) * 0.072, 0.05 + Math.cos(a) * 0.072, -0.62, 0.002)
    }

    // A ring of energy blades that spins round the barrel.
    const spin = A.sub(0, 0.05, -0.36)
    rig.spin = spin.group
    for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2
        spin.box(hot, 0.006, 0.014, 0.05, Math.sin(a) * 0.052, 0.05 + Math.cos(a) * 0.052, -0.36, 0.001, [0, 0, -a])
    }

    // Side-mounted energy cell.
    const cell = A.sub(-0.06, 0.03, -0.1)
    rig.mag = cell.group
    cell.cyl(dim, 0.022, 0.13, -0.06, 0.03, -0.1, 'z', 10)
    for (const sz of [-0.035, -0.165]) cell.cyl(c('chitin'), 0.025, 0.02, -0.06, 0.03, sz, 'z', 10)
    A.box(c('alien'), 0.03, 0.055, 0.11, -0.046, 0.03, -0.1, 0.004)

    // Stock, grip, guard and trigger.
    A.extrude(c('alien'), [[0.06, 0.055], [0.16, 0.05], [0.26, 0.03], [0.275, -0.09], [0.225, -0.092], [0.12, -0.045], [0.06, -0.04]], 0.044)
    A.box(dim, 0.004, 0.004, 0.14, 0.0235, 0.03, 0.16, 0)
    A.box(dim, 0.004, 0.004, 0.14, -0.0235, 0.03, 0.16, 0)
    pistolGrip(A, c('chitin'), c('rubber'), 0.042, 0.1, 0.05, 0, -0.075, 0.04, -0.3, 0.004)
    A.box(c('chitin'), 0.011, 0.007, 0.08, 0, -0.03, -0.01, 0.002)
    A.box(c('chitin'), 0.011, 0.028, 0.008, 0, -0.016, -0.05, 0.002)
    const trigger = A.sub(0, -0.005, -0.015)
    rig.trigger = trigger.group
    trigger.box(hot, 0.008, 0.02, 0.008, 0, -0.012, -0.02, 0.002, [0.15, 0, 0])

    rig.rightHand = addHand(A, tier, { x: 0, y: -0.075, z: 0.04, mode: 'y', s: 1, rx: 0.026, rz: 0.03, point: true, arm: [0.08, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: 0, y: -0.005, z: -0.2, mode: 'z', s: 1, rx: 0.045, rz: 0.028, arm: [-0.55, -0.35, 0.75], thumbAlong: 'y' })?.group
    return rig
}

function buildDeathMachine(A: Asm, c: C, tier: number): Rig {
    const rig = newRig('minigun', [0, 0.03, -0.76])
    const hotColor = tier > 0 ? papAccent(tier) : 0xff7a20
    const hot = glow(hotColor, 1.8)

    // Motor housing, rear cap and gear nose.
    A.cyl(c('steelLt'), 0.058, 0.22, 0, 0.03, -0.1, 'z', 16)
    A.cyl(c('dark'), 0.062, 0.03, 0, 0.03, 0.02, 'z', 16)
    for (let i = 0; i < 4; i++) A.cyl(c('steel'), 0.0605, 0.008, 0, 0.03, -0.03 - i * 0.05, 'z', 16)
    A.cyl(c('steel'), 0.045, 0.05, 0, 0.03, -0.235, 'z', 14)
    A.box(hot, 0.008, 0.008, 0.03, 0, 0.092, -0.05, 0.002)
    // Carry handle.
    A.box(c('dark'), 0.02, 0.012, 0.18, 0, 0.112, -0.1, 0.004)
    for (const z of [-0.17, -0.03]) A.box(c('dark'), 0.014, 0.04, 0.014, 0, 0.09, z, 0.002)

    // The six-barrel cluster spins as one.
    const spin = A.sub(0, 0.03, -0.24)
    rig.spin = spin.group
    for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3
        const bx = Math.sin(a) * 0.03
        const by = 0.03 + Math.cos(a) * 0.03
        spin.cyl(c('dark'), 0.011, 0.46, bx, by, -0.5, 'z', 8)
        spin.cyl(c('steel'), 0.0135, 0.02, bx, by, -0.745, 'z', 8)
    }
    spin.cyl(c('steel'), 0.045, 0.012, 0, 0.03, -0.4, 'z', 14)
    spin.cyl(c('steel'), 0.045, 0.012, 0, 0.03, -0.66, 'z', 14)
    spin.cyl(hot, 0.0455, 0.004, 0, 0.03, -0.668, 'z', 14)
    spin.cyl(c('dark'), 0.03, 0.05, 0, 0.03, -0.3, 'z', 10)

    // Feed chute, belt and the ammo box on the left.
    A.box(c('steel'), 0.05, 0.05, 0.08, -0.07, 0.0, -0.08, 0.006)
    const mag = A.sub(-0.1, -0.05, -0.1)
    rig.mag = mag.group
    mag.box(c('oliveDk'), 0.1, 0.13, 0.13, -0.1, -0.11, -0.1, 0.008)
    mag.box(c('olive'), 0.103, 0.012, 0.135, -0.1, -0.05, -0.1, 0.004)
    mag.box(c('brass'), 0.102, 0.006, 0.02, -0.1, -0.11, -0.1, 0)
    belt(mag, c, [-0.08, -0.05, -0.1], [-0.1, -0.02, -0.09], [-0.075, -0.005, -0.08], 4, true)

    // Two vertical spade grips off a cross-bar; trigger on the right.
    A.box(c('steel'), 0.15, 0.03, 0.05, 0, -0.015, 0.03, 0.006)
    for (const sx of [-1, 1]) pistolGrip(A, c('poly'), c('poly'), 0.036, 0.1, 0.046, sx * 0.062, -0.06, 0.04, -0.15, 0)
    const trigger = A.sub(0.062, -0.02, -0.005)
    rig.trigger = trigger.group
    trigger.box(c('nickel'), 0.008, 0.024, 0.008, 0.062, -0.03, -0.005, 0.002, [0.15, 0, 0])

    rig.rightHand = addHand(A, tier, { x: 0.062, y: -0.06, z: 0.04, mode: 'y', s: 1, rx: 0.018, rz: 0.023, point: true, arm: [0.1, -0.42, 0.85] })?.group
    rig.leftHand = addHand(A, tier, { x: -0.062, y: -0.06, z: 0.04, mode: 'y', s: -1, rx: 0.018, rz: 0.023, thumbX: 1, arm: [-0.1, -0.42, 0.85] })?.group
    return rig
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type WeaponModelId = CallOfXenoWeaponId | 'deathmachine'

export interface WeaponModelOptions {
    /** Gloved hands and sleeves (default true). Pass false for wall-buy / mystery-box previews. */
    hands?: boolean
}

const RIG_KEYS = ['slide', 'bolt', 'pump', 'cylinder', 'crane', 'mag', 'trigger', 'hammer', 'cover', 'spin', 'leftHand', 'rightHand'] as const

/**
 * Builds a weapon viewmodel pointing down -Z with the grip near the origin.
 * `group.userData.muzzle` is the muzzle position (Vector3, group space); moving
 * parts are exposed as `userData.slide | bolt | pump | cylinder | crane | mag |
 * trigger | hammer | cover | spin | leftHand | rightHand` where the gun has them.
 * Drive them with `animateWeapon`.
 */
export function buildWeaponModel(id: WeaponModelId, tier: number, opts: WeaponModelOptions = {}): THREE.Group {
    const t = Math.max(0, Math.min(3, Math.floor(tier || 0)))
    withHands = opts.hands !== false
    const A = new Asm()
    const c: C = m => material(m, t)
    let rig: Rig
    switch (id) {
        case 'm1911': rig = buildM1911(A, c, t); break
        case 'skorpion': rig = buildSkorpion(A, c, t); break
        case 'magnum': rig = buildMagnum(A, c, t); break
        case 'trench': rig = buildTrench(A, c, t); break
        case 'mp40': rig = buildMp40(A, c, t); break
        case 'ak74': rig = buildAk(A, c, t, false); break
        case 'rpk': rig = buildAk(A, c, t, true); break
        case 'bar': rig = buildBar(A, c, t); break
        case 'mosin': rig = buildMosin(A, c, t); break
        case 'm60': rig = buildM60(A, c, t); break
        case 'fnmag': rig = buildFnMag(A, c, t); break
        case 'bazooka': rig = buildBazooka(A, c, t); break
        case 'xenoray': rig = buildXenoRay(A, c, t); break
        case 'deathmachine': rig = buildDeathMachine(A, c, t); break
        default: rig = buildM1911(A, c, t)
    }
    withHands = true
    const group = A.build()
    group.userData.rig = rig
    group.userData.kind = rig.kind
    group.userData.muzzle = rig.muzzle
    for (const key of RIG_KEYS) {
        if (rig[key]) group.userData[key] = rig[key]
    }
    return group
}

/** Death Machine drop viewmodel (same conventions as `buildWeaponModel`). */
export function buildDeathMachineModel(tier = 0, opts: WeaponModelOptions = {}) {
    return buildWeaponModel('deathmachine', tier, opts)
}

export interface WeaponAnimState {
    /** 0..1 recoil impulse (1 on the frame a shot goes off, decaying). */
    fireKick: number
    /** Reload progress 0..1, or -1 when not reloading. */
    reload: number
    /** Monotonic seconds (used for spin and shot timing). */
    time: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (t: number) => t * t * (3 - 2 * t)
const ramp = (t: number, a: number, b: number) => smoothstep(clamp01((t - a) / (b - a)))
/** Rises 0 to 1 over a..b and falls back to 0 over c..d. */
const pulse = (t: number, a: number, b: number, c: number, d: number) => ramp(t, a, b) - ramp(t, c, d)

function setPos(obj: THREE.Object3D | undefined, x: number, y: number, z: number) {
    if (!obj) return
    const rest = obj.userData.rest as THREE.Vector3
    obj.position.set(rest.x + x, rest.y + y, rest.z + z)
}

/**
 * Moves a model's parts from the current recoil and reload state: slide / bolt
 * blowback, pump rack, bolt-action cycle, revolver cylinder and crane, magazine
 * drop-and-insert with the left hand, LMG feed cover, minigun / wonder-weapon
 * spin. Call once per frame after `buildWeaponModel`.
 */
export function animateWeapon(group: THREE.Object3D, state: WeaponAnimState) {
    const rig = group.userData.rig as Rig | undefined
    if (!rig) return
    const fx = rig.fx
    const time = state.time
    const dt = Math.min(0.1, Math.max(0, time - fx.lastTime))
    fx.lastTime = time
    const kick = clamp01(state.fireKick)
    if (kick > fx.lastKick + 0.02) {
        fx.shotTime = time
        fx.shots++
        fx.cyl += Math.PI / 3
    }
    fx.lastKick = kick
    const since = time - fx.shotTime
    const rl = state.reload
    const reloading = rl >= 0
    const travel = rig.travel ?? 0
    const kind = rig.kind

    let boltZ = 0
    let roll = 0
    let pumpZ = 0
    let hx = 0
    let hy = 0
    let hz = 0
    let magD = 0
    let magScale = 1
    let cover = 0
    let crane = 0

    if (kind === 'pump' || kind === 'mosin') {
        const n = rig.shells ?? 3
        const hm = rig.handMag
        if (kind === 'pump') {
            if (reloading) {
                if (rl < 0.8 && hm) {
                    const u = (rl / 0.8) * n
                    const f = Math.sin(Math.PI * (u - Math.floor(u)))
                    hx = hm.x * f
                    hy = hm.y * f
                    hz = hm.z * f
                }
                pumpZ = travel * pulse(rl, 0.82, 0.9, 0.9, 0.98)
            } else {
                pumpZ = travel * pulse(since, 0.28, 0.4, 0.42, 0.58)
            }
            hz += pumpZ
        } else if (reloading) {
            roll = 1.25 * pulse(rl, 0, 0.05, 0.92, 0.99)
            boltZ = travel * pulse(rl, 0.05, 0.13, 0.8, 0.9)
            if (rl > 0.14 && rl < 0.78 && hm) {
                const u = ((rl - 0.14) / 0.64) * n
                const f = Math.sin(Math.PI * (u - Math.floor(u)))
                hx = hm.x * f
                hy = hm.y * f
                hz = hm.z * f
            }
        } else {
            const u = since - 0.3
            roll = 1.25 * pulse(u, 0, 0.12, 0.5, 0.62)
            boltZ = travel * pulse(u, 0.12, 0.26, 0.3, 0.42)
        }
    } else if (kind === 'revolver') {
        fx.spin += (fx.cyl - fx.spin) * Math.min(1, dt * 28)
        if (reloading) {
            crane = pulse(rl, 0.04, 0.2, 0.66, 0.82)
            if (rl > 0.3 && rl < 0.62) fx.cyl += dt * 6
            const h = pulse(rl, 0, 0.15, 0.84, 0.98)
            if (rig.handMag) {
                hx = rig.handMag.x * h
                hy = rig.handMag.y * h
                hz = rig.handMag.z * h
            }
        }
    } else {
        boltZ = travel * kick
        if (reloading && rig.magAxis && rig.magDrop !== undefined) {
            const h = pulse(rl, 0, 0.2, 0.64, 0.84)
            magD = rl < 0.41 ? ramp(rl, 0.2, 0.4) : 1 - ramp(rl, 0.42, 0.62)
            magScale = rl > 0.395 && rl < 0.425 ? 0.001 : 1
            if (rig.handMag) {
                hx = rig.handMag.x * h
                hy = rig.handMag.y * h
                hz = rig.handMag.z * h
            }
            if (!rig.noHandFollow) {
                hx += rig.magAxis.x * rig.magDrop * magD
                hy += rig.magAxis.y * rig.magDrop * magD
                hz += rig.magAxis.z * rig.magDrop * magD
            }
            boltZ = Math.max(boltZ, travel * pulse(rl, 0.84, 0.9, 0.9, 0.97))
            if (kind === 'lmg') cover = pulse(rl, 0, 0.12, 0.85, 0.97)
        }
    }

    setPos(rig.slide, 0, 0, boltZ)
    setPos(rig.bolt, 0, 0, boltZ)
    if (rig.bolt) rig.bolt.rotation.z = roll
    setPos(rig.pump, 0, 0, pumpZ)
    setPos(rig.leftHand, hx, hy, hz)
    if (rig.mag) {
        if (rig.magAxis && rig.magDrop !== undefined) {
            const d = rig.magDrop * magD
            setPos(rig.mag, rig.magAxis.x * d, rig.magAxis.y * d, rig.magAxis.z * d)
        }
        rig.mag.scale.setScalar(magScale)
    }
    if (rig.trigger) rig.trigger.rotation.x = -0.6 * clamp01(kick * 3)
    if (rig.hammer) rig.hammer.rotation.x = 0.6 * pulse(since, 0, 0.03, 0.18, 0.4)
    if (rig.cover) rig.cover.rotation.x = 1.0 * cover
    if (rig.crane) {
        setPos(rig.crane, -0.07 * crane, -0.02 * crane, 0)
        rig.crane.rotation.z = 0.5 * crane
    }
    if (rig.cylinder) rig.cylinder.rotation.z = fx.spin
    if (rig.spin) {
        const target = kind === 'minigun'
            ? (since < 0.3 || kick > 0.05 ? 36 : 0)
            : 1.5 + (since < 0.4 ? 14 : 0)
        fx.spd += (target - fx.spd) * Math.min(1, dt * 4)
        rig.spin.rotation.z += dt * fx.spd
    }
}
