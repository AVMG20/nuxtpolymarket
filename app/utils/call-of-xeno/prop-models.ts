// Call of Xeno — interactable prop, pickup and equipment meshes.
//
// Everything here is procedural: PBR (MeshStandardMaterial) hard surfaces with
// canvas-drawn albedo/bump maps, and unlit MeshBasicMaterial "glow" parts that
// the game tints (`PropModel.glow`) to show power state.
//
// Performance notes:
//  - Static geometry is merged per material and cached per builder key, so a
//    sentry/drone/power-up that is spawned mid-round costs a few Mesh objects.
//  - Every shared geometry, material and texture has its `dispose` neutered
//    (`keep`). The component calls `disposeObject` on dropped pickups and
//    projectiles; without this, that would free the GPU copies every other
//    instance is still using and force a recompile on the next spawn.
//  - Glow materials are per instance (the game recolours them per prop).
//
// Animation: `updatePropMaterials(time)` drives the scrolling PaP plasma,
// perk-sign flicker, marquee bulbs, mystery-box beam and pulsing lamps. Call
// it once per frame with the elapsed time in seconds. If the game never calls
// it, props tick themselves from `onBeforeRender` using `performance.now()`.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { buildWeaponModel } from './weapon-models'
import type { CallOfXenoEquipment, CallOfXenoPerk, CallOfXenoPowerUp, CallOfXenoWeapon } from '#shared/utils/gamelogic/call-of-xeno'

export interface PropModel {
    group: THREE.Group
    glow: (THREE.MeshBasicMaterial | THREE.MeshLambertMaterial)[]
    light?: THREE.PointLight
}

// ---------------------------------------------------------------------------
// Infrastructure: shared resources, canvas helpers, geometry kit
// ---------------------------------------------------------------------------

/** Makes a resource immune to `dispose()` so instances can share it safely. */
function keep<T extends { dispose: () => void }>(resource: T): T {
    resource.dispose = () => {}
    return resource
}

/** Small deterministic PRNG so canvas textures are the same every load. */
function rng(seed: number) {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = s
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function makeCanvas(w: number, h = w) {
    const el = document.createElement('canvas')
    el.width = w
    el.height = h
    return { el, ctx: el.getContext('2d')! }
}

function canvasTexture(el: HTMLCanvasElement, opts: { srgb?: boolean, repeat?: boolean } = {}) {
    const tex = new THREE.CanvasTexture(el)
    tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace
    if (opts.repeat) {
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
    }
    tex.anisotropy = 4
    return keep(tex)
}

const memoStore = new Map<string, unknown>()
function memo<T>(key: string, make: () => T): T {
    if (!memoStore.has(key)) memoStore.set(key, make())
    return memoStore.get(key) as T
}

const HEAVY = '"Impact","Haettenschweiler","Arial Black","Arial Narrow",sans-serif'
const CHALK_FONT = '"Chalkduster","Segoe Print","Bradley Hand","Marker Felt","Comic Sans MS",cursive'

function hexCss(color: number) {
    return '#' + color.toString(16).padStart(6, '0')
}

/** Draws `text` centred, shrinking the font until it fits `maxWidth`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, size: number, family = HEAVY) {
    let px = size
    ctx.font = `${px}px ${family}`
    while (ctx.measureText(text).width > maxWidth && px > 8) {
        px -= 2
        ctx.font = `${px}px ${family}`
    }
    ctx.fillText(text, x, y)
}

function clamp(v: number, lo: number, hi: number) {
    return Math.min(hi, Math.max(lo, v))
}

type V3 = [number, number, number]

interface Xf {
    x?: number
    y?: number
    z?: number
    rx?: number
    ry?: number
    rz?: number
    sx?: number
    sy?: number
    sz?: number
    q?: THREE.Quaternion
}

const KEEP_ATTRIBUTES = new Set(['position', 'normal', 'uv'])
const AXIS_Y = new THREE.Vector3(0, 1, 0)
const scratchM = new THREE.Matrix4()
const scratchQ = new THREE.Quaternion()
const scratchE = new THREE.Euler()
const scratchP = new THREE.Vector3()
const scratchS = new THREE.Vector3()

/**
 * Collects primitives, bakes their transforms and merges them per material.
 * `box()` rescales UVs to metres so wood/steel maps keep a constant texel
 * density however big the box is.
 */
class Kit {
    private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>()

    add(source: THREE.BufferGeometry, material: THREE.Material, t: Xf = {}) {
        const geo = source.index ? source.toNonIndexed() : source.clone()
        for (const name of Object.keys(geo.attributes)) {
            if (!KEEP_ATTRIBUTES.has(name)) geo.deleteAttribute(name)
        }
        if (!geo.attributes.uv) {
            geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position!.count * 2), 2))
        }
        if (t.q) scratchQ.copy(t.q)
        else scratchQ.setFromEuler(scratchE.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0))
        scratchP.set(t.x ?? 0, t.y ?? 0, t.z ?? 0)
        scratchS.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1)
        geo.applyMatrix4(scratchM.compose(scratchP, scratchQ, scratchS))
        let list = this.buckets.get(material)
        if (!list) {
            list = []
            this.buckets.set(material, list)
        }
        list.push(geo)
        source.dispose()
    }

    box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, t: Xf = {}) {
        const g = new THREE.BoxGeometry(w, h, d)
        const uv = g.attributes.uv!
        const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]
        for (let face = 0; face < 6; face++) {
            const [du, dv] = dims[face]!
            for (let i = 0; i < 4; i++) {
                const idx = face * 4 + i
                uv.setXY(idx, uv.getX(idx) * du, uv.getY(idx) * dv)
            }
        }
        this.add(g, m, { ...t, x, y, z })
    }

    rbox(w: number, h: number, d: number, r: number, m: THREE.Material, x = 0, y = 0, z = 0, t: Xf = {}) {
        this.add(new RoundedBoxGeometry(w, h, d, 2, r), m, { ...t, x, y, z })
    }

    cyl(rt: number, rb: number, h: number, seg: number, m: THREE.Material, x = 0, y = 0, z = 0, t: Xf = {}) {
        this.add(new THREE.CylinderGeometry(rt, rb, h, seg), m, { ...t, x, y, z })
    }

    sph(r: number, m: THREE.Material, x = 0, y = 0, z = 0, t: Xf = {}, ws = 10, hs = 8) {
        this.add(new THREE.SphereGeometry(r, ws, hs), m, { ...t, x, y, z })
    }

    /** A cylinder running from `a` to `b`. */
    strut(a: V3, b: V3, r: number, m: THREE.Material, seg = 6) {
        const from = new THREE.Vector3(...a)
        const to = new THREE.Vector3(...b)
        const dir = to.clone().sub(from)
        const len = dir.length()
        if (len < 1e-5) return
        const q = new THREE.Quaternion().setFromUnitVectors(AXIS_Y, dir.normalize())
        const mid = from.add(to).multiplyScalar(0.5)
        this.cyl(r, r, len, seg, m, mid.x, mid.y, mid.z, { q })
    }

    finish(): [THREE.BufferGeometry, THREE.Material][] {
        const out: [THREE.BufferGeometry, THREE.Material][] = []
        for (const [material, list] of this.buckets) {
            const merged = mergeGeometries(list, false)
            if (merged) out.push([keep(merged), material])
            for (const g of list) g.dispose()
        }
        this.buckets.clear()
        return out
    }
}

const kitCache = new Map<string, [THREE.BufferGeometry, THREE.Material][]>()

/** Builds (once) and instantiates a merged static kit into `target`. */
function buildKit(key: string, fill: (k: Kit) => void, target: THREE.Object3D) {
    let entries = kitCache.get(key)
    if (!entries) {
        const kit = new Kit()
        fill(kit)
        entries = kit.finish()
        kitCache.set(key, entries)
    }
    for (const [geo, material] of entries) {
        const mesh = new THREE.Mesh(geo, material)
        target.add(mesh)
    }
    return target.children.find(c => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined
}

function plane(w: number, h: number) {
    return memo(`plane:${w}x${h}`, () => keep(new THREE.PlaneGeometry(w, h)))
}

// ---------------------------------------------------------------------------
// Animation registry
// ---------------------------------------------------------------------------

interface Updater {
    root: THREE.Object3D
    fn: (time: number) => void
    seen: boolean
}

const updaters = new Set<Updater>()
let externalAt = -1e9
let lastAuto = -1e9

function track(root: THREE.Object3D, fn: (time: number) => void) {
    updaters.add({ root, fn, seen: false })
}

function tick(time: number) {
    const s = sharedOrNull()
    if (s) {
        s.energyTex.offset.y = -time * 0.42
        s.energyTex.offset.x = Math.sin(time * 0.7) * 0.1
        const pulse = 0.72 + 0.28 * Math.sin(time * 2.4)
        s.eyeRed.color.setRGB(pulse, 0.08 * pulse, 0.04 * pulse)
        s.tendrilGlow.color.setRGB(0.1 * pulse, 1 * pulse, 0.78 * pulse)
    }
    for (const u of updaters) {
        if (u.root.parent) u.seen = true
        else if (u.seen) {
            updaters.delete(u)
            continue
        }
        u.fn(time)
    }
}

/**
 * Advances every animated prop material: PaP plasma scroll, perk sign
 * flicker and marquee chase, mystery-box beam shimmer, pulsing lamps.
 * Call once per frame with the elapsed time in seconds. Optional: when it is
 * never called, props animate themselves via `onBeforeRender`.
 */
export function updatePropMaterials(time: number) {
    externalAt = performance.now()
    tick(time)
}

function autoTick() {
    const now = performance.now()
    if (now - externalAt < 1000 || now - lastAuto < 12) return
    lastAuto = now
    tick(now / 1000)
}

function hook(mesh: THREE.Mesh | undefined) {
    if (mesh) mesh.onBeforeRender = autoTick
}

/** Cosmetic neon flicker: mostly steady, with brief stuttering dropouts. */
function flicker(time: number, seed: number) {
    if (Math.sin(time * 0.83 + seed * 3.1) > 0.94) {
        return Math.sin(time * 47 + seed) > -0.15 ? 1 : 0.35
    }
    return 0.94 + 0.06 * Math.sin(time * 9 + seed)
}

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------

function grungeCanvas(seed: number, base = 190, size = 256) {
    const rand = rng(seed)
    const { el, ctx } = makeCanvas(size)
    ctx.fillStyle = `rgb(${base},${base},${base})`
    ctx.fillRect(0, 0, size, size)
    for (let i = 0; i < 46; i++) {
        const x = rand() * size
        const y = rand() * size
        const r = 14 + rand() * 60
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        const dark = rand() > 0.45
        g.addColorStop(0, dark ? `rgba(0,0,0,${0.05 + rand() * 0.1})` : `rgba(255,255,255,${0.03 + rand() * 0.06})`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${rand() * 0.06})` : `rgba(0,0,0,${rand() * 0.1})`
        ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2)
    }
    // Scratches and drips of grime.
    ctx.lineWidth = 1
    for (let i = 0; i < 40; i++) {
        const x = rand() * size
        const y = rand() * size
        const a = rand() * Math.PI
        const len = 8 + rand() * 40
        ctx.strokeStyle = rand() > 0.5 ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.2)'
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
        ctx.stroke()
    }
    for (let i = 0; i < 14; i++) {
        const x = rand() * size
        const g = ctx.createLinearGradient(0, 0, 0, size)
        g.addColorStop(0, 'rgba(0,0,0,0)')
        g.addColorStop(1, 'rgba(0,0,0,0.12)')
        ctx.fillStyle = g
        ctx.fillRect(x, 0, 1 + rand() * 3, size)
    }
    return el
}

function woodCanvas() {
    const rand = rng(77)
    const { el, ctx } = makeCanvas(256)
    const planks = 6
    const ph = 256 / planks
    for (let p = 0; p < planks; p++) {
        const tint = 0.78 + rand() * 0.3
        ctx.fillStyle = `rgb(${Math.round(122 * tint)},${Math.round(92 * tint)},${Math.round(58 * tint)})`
        ctx.fillRect(0, p * ph, 256, ph)
        for (let i = 0; i < 26; i++) {
            const y = p * ph + rand() * ph
            ctx.strokeStyle = rand() > 0.5 ? 'rgba(40,24,10,0.28)' : 'rgba(200,160,110,0.14)'
            ctx.lineWidth = 0.6 + rand()
            ctx.beginPath()
            ctx.moveTo(0, y)
            for (let x = 0; x <= 256; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.05 + p) * 2 + (rand() - 0.5) * 1.5)
            ctx.stroke()
        }
        if (rand() > 0.35) {
            const kx = rand() * 256
            const ky = p * ph + ph / 2
            const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, 10)
            g.addColorStop(0, 'rgba(30,16,6,0.7)')
            g.addColorStop(0.6, 'rgba(60,36,16,0.35)')
            g.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.fillStyle = g
            ctx.fillRect(kx - 10, ky - 10, 20, 20)
        }
        ctx.fillStyle = 'rgba(10,6,2,0.85)'
        ctx.fillRect(0, p * ph, 256, 2)
        for (const nx of [10, 246]) {
            ctx.fillStyle = 'rgba(20,14,8,0.8)'
            ctx.fillRect(nx, p * ph + ph / 2 - 1.5, 3, 3)
        }
    }
    for (let i = 0; i < 1800; i++) {
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'
        ctx.fillRect(rand() * 256, rand() * 256, 2, 1)
    }
    return el
}

function hazardCanvas() {
    const { el, ctx } = makeCanvas(128)
    ctx.fillStyle = '#15161a'
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = '#d6a516'
    for (let i = -4; i < 8; i++) {
        ctx.beginPath()
        ctx.moveTo(i * 32, 128)
        ctx.lineTo(i * 32 + 16, 128)
        ctx.lineTo(i * 32 + 16 + 128, 0)
        ctx.lineTo(i * 32 + 128, 0)
        ctx.closePath()
        ctx.fill()
    }
    const rand = rng(5)
    for (let i = 0; i < 700; i++) {
        ctx.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.05)'
        ctx.fillRect(rand() * 128, rand() * 128, 2, 2)
    }
    return el
}

/** Soft white radial falloff, for halos and pools of light. */
function radialCanvas(size = 128) {
    const { el, ctx } = makeCanvas(size)
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.2, 'rgba(255,255,255,0.6)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.16)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    return el
}

/** Vertical light shaft: bright at the bottom, fading up, soft on the sides. */
function beamCanvas() {
    const w = 64
    const h = 256
    const { el, ctx } = makeCanvas(w, h)
    const img = ctx.createImageData(w, h)
    for (let y = 0; y < h; y++) {
        const vy = y / (h - 1)
        const fadeY = Math.pow(Math.max(0, vy), 1.6) * (vy > 0.96 ? (1 - vy) / 0.04 : 1)
        for (let x = 0; x < w; x++) {
            const u = (x / (w - 1)) * 2 - 1
            const fadeX = Math.exp(-u * u * 3.2) * (1 - u * u * u * u)
            const i = (y * w + x) * 4
            img.data[i] = 255
            img.data[i + 1] = 255
            img.data[i + 2] = 255
            img.data[i + 3] = Math.round(255 * fadeX * fadeY)
        }
    }
    ctx.putImageData(img, 0, 0)
    return el
}

/** Tileable vertical energy streaks for the Pack-a-Punch plasma. */
function energyCanvas() {
    const rand = rng(31)
    const w = 128
    const h = 256
    const { el, ctx } = makeCanvas(w, h)
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 34; i++) {
        const x = rand() * w
        const phase = rand() * 6
        const amp = 2 + rand() * 6
        const bright = 0.25 + rand() * 0.75
        ctx.strokeStyle = `rgba(255,255,255,${bright})`
        ctx.lineWidth = 1 + rand() * 3
        for (const off of [-h, 0, h]) {
            ctx.beginPath()
            for (let y = 0; y <= h; y += 8) {
                const px = x + Math.sin(y * 0.045 + phase) * amp
                if (y === 0) ctx.moveTo(px, y + off)
                else ctx.lineTo(px, y + off)
            }
            ctx.stroke()
        }
    }
    for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.6})`
        const x = rand() * w
        const y = rand() * h
        ctx.fillRect(x, y, 2, 3)
    }
    return el
}

/** Accretion disc: hot white inner edge to violet, swirled arms, ragged fade. */
function accretionCanvas() {
    const size = 256
    const { el, ctx } = makeCanvas(size)
    const img = ctx.createImageData(size, size)
    const inner = 0.41
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (x + 0.5) / size * 2 - 1
            const dy = (y + 0.5) / size * 2 - 1
            const r = Math.min(1, Math.sqrt(dx * dx + dy * dy))
            const i = (y * size + x) * 4
            if (r < inner || r >= 1) {
                img.data[i + 3] = 0
                continue
            }
            const t = clamp((r - inner) / (1 - inner), 0, 1)
            const theta = Math.atan2(dy, dx)
            const swirl = theta * 3 + t * 9
            const arms = 0.55 + 0.3 * Math.sin(swirl) + 0.15 * Math.sin(swirl * 2.7 + 1.3)
            const edgeIn = clamp(t / 0.08, 0, 1)
            const edgeOut = Math.pow(Math.max(0, 1 - t), 1.2)
            const a = clamp(arms * edgeIn * edgeOut * 1.25, 0, 1)
            // Colour ramp white-hot -> violet -> deep blue.
            const cr = 255 - t * 190
            const cg = 235 - t * 215
            const cb = 255 - t * 60
            img.data[i] = cr
            img.data[i + 1] = cg
            img.data[i + 2] = cb
            img.data[i + 3] = Math.round(a * 255)
        }
    }
    ctx.putImageData(img, 0, 0)
    return el
}

function envCanvas() {
    const { el, ctx } = makeCanvas(256, 128)
    const g = ctx.createLinearGradient(0, 0, 0, 128)
    g.addColorStop(0, '#171a20')
    g.addColorStop(0.45, '#3b414b')
    g.addColorStop(0.55, '#2a2e35')
    g.addColorStop(1, '#0b0c0f')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 128)
    // Fluorescent tubes and a sodium lamp, so chrome has something to catch.
    ctx.fillStyle = '#f2f6ff'
    for (const [x, y, w] of [[20, 20, 70], [130, 22, 60], [200, 18, 40], [70, 34, 46]] as const) ctx.fillRect(x, y, w, 4)
    const sodium = ctx.createRadialGradient(180, 46, 0, 180, 46, 22)
    sodium.addColorStop(0, 'rgba(255,176,96,1)')
    sodium.addColorStop(1, 'rgba(255,176,96,0)')
    ctx.fillStyle = sodium
    ctx.fillRect(150, 20, 60, 50)
    const teal = ctx.createRadialGradient(40, 88, 0, 40, 88, 26)
    teal.addColorStop(0, 'rgba(51,255,208,0.5)')
    teal.addColorStop(1, 'rgba(51,255,208,0)')
    ctx.fillStyle = teal
    ctx.fillRect(10, 60, 60, 60)
    return el
}

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------

interface Shared {
    env: THREE.Texture
    grunge: THREE.Texture
    wood: THREE.Texture
    hazardTex: THREE.Texture
    haloTex: THREE.Texture
    beamTex: THREE.Texture
    energyTex: THREE.Texture
    accretionTex: THREE.Texture
    paint: THREE.MeshStandardMaterial
    steel: THREE.MeshStandardMaterial
    steelDark: THREE.MeshStandardMaterial
    purpleSteel: THREE.MeshStandardMaterial
    chrome: THREE.MeshStandardMaterial
    rubber: THREE.MeshStandardMaterial
    brass: THREE.MeshStandardMaterial
    woodMat: THREE.MeshStandardMaterial
    woodDark: THREE.MeshStandardMaterial
    hazard: THREE.MeshStandardMaterial
    glass: THREE.MeshStandardMaterial
    orange: THREE.MeshStandardMaterial
    olive: THREE.MeshStandardMaterial
    red: THREE.MeshStandardMaterial
    black: THREE.MeshStandardMaterial
    alien: THREE.MeshStandardMaterial
    tendrilGlow: THREE.MeshBasicMaterial
    eyeRed: THREE.MeshBasicMaterial
    ledGreen: THREE.MeshBasicMaterial
    cyanGlow: THREE.MeshBasicMaterial
    amberGlow: THREE.MeshBasicMaterial
    disc: THREE.MeshBasicMaterial
}

let sharedCache: Shared | null = null
function sharedOrNull() {
    return sharedCache
}

function S(): Shared {
    if (sharedCache) return sharedCache

    const env = canvasTexture(envCanvas())
    env.mapping = THREE.EquirectangularReflectionMapping
    const grunge = canvasTexture(grungeCanvas(11), { repeat: true })
    const wood = canvasTexture(woodCanvas(), { repeat: true })
    const hazardTex = canvasTexture(hazardCanvas(), { repeat: true })
    const haloTex = canvasTexture(radialCanvas())
    const beamTex = canvasTexture(beamCanvas())
    const energyTex = canvasTexture(energyCanvas(), { repeat: true })
    const accretionTex = canvasTexture(accretionCanvas())

    const metal = (color: number, rough: number, metalness: number, mapped = true) => keep(new THREE.MeshStandardMaterial({
        color,
        roughness: rough,
        metalness,
        map: mapped ? grunge : null,
        bumpMap: mapped ? grunge : null,
        bumpScale: 1.2,
        envMap: env,
        envMapIntensity: 0.9
    }))
    const flat = (color: number, rough = 0.9) => keep(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }))
    const basic = (color: number) => keep(new THREE.MeshBasicMaterial({ color }))

    sharedCache = {
        env,
        grunge,
        wood,
        hazardTex,
        haloTex,
        beamTex,
        energyTex,
        accretionTex,
        paint: metal(0x4a515b, 0.55, 0.45),
        steel: metal(0x707884, 0.42, 0.75),
        steelDark: metal(0x2b3038, 0.5, 0.7),
        purpleSteel: metal(0x3a2c4a, 0.45, 0.65),
        chrome: keep(new THREE.MeshStandardMaterial({ color: 0xe4e8ee, roughness: 0.16, metalness: 1, envMap: env, envMapIntensity: 1.1 })),
        rubber: flat(0x16171a, 0.95),
        brass: keep(new THREE.MeshStandardMaterial({ color: 0xb98d3e, roughness: 0.32, metalness: 0.9, envMap: env, envMapIntensity: 1 })),
        woodMat: keep(new THREE.MeshStandardMaterial({ color: 0xa88458, roughness: 0.85, map: wood, bumpMap: wood, bumpScale: 1.4 })),
        woodDark: keep(new THREE.MeshStandardMaterial({ color: 0x4a3823, roughness: 0.9, map: wood, bumpMap: wood, bumpScale: 1.2 })),
        hazard: keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1, map: hazardTex })),
        glass: keep(new THREE.MeshStandardMaterial({
            color: 0xa8dcec,
            roughness: 0.05,
            metalness: 0,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
            envMap: env,
            envMapIntensity: 1.4
        })),
        orange: metal(0xc8741a, 0.5, 0.4),
        olive: metal(0x4c5637, 0.6, 0.35),
        red: keep(new THREE.MeshStandardMaterial({ color: 0xcc2b1f, roughness: 0.3, metalness: 0.2, envMap: env, envMapIntensity: 0.9 })),
        black: flat(0x0a0a0c, 0.6),
        alien: keep(new THREE.MeshStandardMaterial({ color: 0x141c19, roughness: 0.35, metalness: 0.1, emissive: 0x073d36, emissiveIntensity: 0.7 })),
        tendrilGlow: basic(0x33ffd0),
        eyeRed: basic(0xff3322),
        ledGreen: basic(0x33ff66),
        cyanGlow: basic(0x38bdf8),
        amberGlow: basic(0xffb347),
        disc: keep(new THREE.MeshBasicMaterial({
            color: 0x9fe8ff,
            map: haloTex,
            transparent: true,
            opacity: 0.16,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }))
    }
    return sharedCache
}

/** Lit-from-inside sign plate: readable in the dark, still reacts to light. */
function plateMaterial(map: THREE.Texture, emissive = 0.55) {
    return keep(new THREE.MeshStandardMaterial({
        map,
        roughness: 0.75,
        metalness: 0.1,
        emissive: 0xffffff,
        emissiveMap: map,
        emissiveIntensity: emissive
    }))
}

function haloMaterial(color: number, opacity = 0.5) {
    return memo(`halo:${color}:${opacity}`, () => keep(new THREE.SpriteMaterial({
        color,
        map: S().haloTex,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    })))
}

function additiveMaterial(color: number, map: THREE.Texture, opacity: number, side: THREE.Side = THREE.DoubleSide) {
    return new THREE.MeshBasicMaterial({
        color,
        map,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side
    })
}

/** Reads the tinted glow colour the game applies, as "is it lit?". */
function glowLive(material: THREE.MeshBasicMaterial, threshold = 0.3) {
    const c = material.color
    return Math.max(c.r, c.g, c.b) > threshold
}

// ---------------------------------------------------------------------------
// Plates (labels) drawn to canvas
// ---------------------------------------------------------------------------

function plateTexture(key: string, w: number, h: number, title: string, subtitle: string | undefined, fg: string, bg: string, accent: string) {
    return memo(`plate:${key}:${title}:${subtitle ?? ''}`, () => {
        const { el, ctx } = makeCanvas(w, h)
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
        const g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, 'rgba(255,255,255,0.08)')
        g.addColorStop(1, 'rgba(0,0,0,0.25)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = accent
        ctx.lineWidth = Math.max(4, h * 0.05)
        ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.lineWidth = 2
        ctx.strokeRect(ctx.lineWidth * 6, ctx.lineWidth * 6, w - ctx.lineWidth * 12, h - ctx.lineWidth * 12)
        for (const [bx, by] of [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]] as const) {
            ctx.fillStyle = 'rgba(210,214,220,0.7)'
            ctx.beginPath()
            ctx.arc(bx, by, Math.max(3, h * 0.03), 0, Math.PI * 2)
            ctx.fill()
        }
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = fg
        ctx.shadowColor = accent
        ctx.shadowBlur = 8
        if (subtitle) {
            fitText(ctx, title.toUpperCase(), w / 2, h * 0.38, w * 0.8, h * 0.42)
            ctx.fillStyle = accent
            fitText(ctx, subtitle.toUpperCase(), w / 2, h * 0.76, w * 0.7, h * 0.24)
        } else {
            fitText(ctx, title.toUpperCase(), w / 2, h * 0.52, w * 0.84, h * 0.52)
        }
        return canvasTexture(el)
    })
}

// ---------------------------------------------------------------------------
// Perk machines
// ---------------------------------------------------------------------------

function drawBurst(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, ro: number, ri: number, fill: string, stroke: string, lw: number) {
    ctx.beginPath()
    for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? ro : ri
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = stroke
    ctx.lineWidth = lw
    ctx.lineJoin = 'round'
    ctx.stroke()
}

function drawBullet(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, body: string, casing: string) {
    const bw = s * 0.4
    ctx.fillStyle = casing
    ctx.beginPath()
    ctx.roundRect(cx - bw / 2, cy + s * 0.05, bw, s * 0.85, s * 0.05)
    ctx.fill()
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.moveTo(cx - bw / 2, cy + s * 0.08)
    ctx.lineTo(cx - bw / 2, cy - s * 0.2)
    ctx.quadraticCurveTo(cx - bw / 2, cy - s * 0.65, cx, cy - s * 0.9)
    ctx.quadraticCurveTo(cx + bw / 2, cy - s * 0.65, cx + bw / 2, cy - s * 0.2)
    ctx.lineTo(cx + bw / 2, cy + s * 0.08)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(cx - bw / 2, cy + s * 0.62, bw, s * 0.06)
}

/** One monochrome logo per perk. Drawn in greys; the game tints it. */
function drawPerkIcon(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, s: number) {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    switch (id) {
        case 'juggernog': {
            ctx.beginPath()
            ctx.moveTo(cx - s * 0.8, cy - s * 0.85)
            ctx.lineTo(cx + s * 0.8, cy - s * 0.85)
            ctx.lineTo(cx + s * 0.8, cy + s * 0.1)
            ctx.quadraticCurveTo(cx + s * 0.8, cy + s * 0.75, cx, cy + s)
            ctx.quadraticCurveTo(cx - s * 0.8, cy + s * 0.75, cx - s * 0.8, cy + s * 0.1)
            ctx.closePath()
            ctx.fillStyle = '#7a7a7a'
            ctx.fill()
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = s * 0.09
            ctx.stroke()
            ctx.fillStyle = '#ffffff'
            ctx.font = `${s * 1.5}px ${HEAVY}`
            ctx.fillText('J', cx, cy - s * 0.02)
            ctx.strokeStyle = '#d0d0d0'
            ctx.lineWidth = s * 0.05
            ctx.beginPath()
            ctx.moveTo(cx - s * 0.6, cy - s * 0.66)
            ctx.lineTo(cx + s * 0.6, cy - s * 0.66)
            ctx.stroke()
            break
        }
        case 'speedcola': {
            ctx.beginPath()
            for (let i = 0; i < 40; i++) {
                const r = i % 2 === 0 ? s : s * 0.88
                const a = (i / 40) * Math.PI * 2
                const x = cx + Math.cos(a) * r
                const y = cy + Math.sin(a) * r
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
            }
            ctx.closePath()
            ctx.fillStyle = '#dedede'
            ctx.fill()
            ctx.beginPath()
            ctx.arc(cx, cy, s * 0.72, 0, Math.PI * 2)
            ctx.fillStyle = '#1a1a1a'
            ctx.fill()
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = s * 0.05
            ctx.stroke()
            ctx.beginPath()
            const bolt: [number, number][] = [[0.2, -0.64], [-0.34, 0.1], [-0.03, 0.1], [-0.22, 0.68], [0.38, -0.12], [0.06, -0.12]]
            bolt.forEach(([bx, by], i) => {
                if (i === 0) ctx.moveTo(cx + bx * s, cy + by * s)
                else ctx.lineTo(cx + bx * s, cy + by * s)
            })
            ctx.closePath()
            ctx.fillStyle = '#ffffff'
            ctx.fill()
            break
        }
        case 'doubletap': {
            drawBullet(ctx, cx - s * 0.46, cy + s * 0.05, s, '#ffffff', '#b4b4b4')
            drawBullet(ctx, cx + s * 0.46, cy + s * 0.05, s, '#ffffff', '#b4b4b4')
            ctx.strokeStyle = '#d8d8d8'
            ctx.lineWidth = s * 0.07
            for (const dx of [-0.46, 0.46]) {
                ctx.beginPath()
                ctx.moveTo(cx + dx * s - s * 0.3, cy - s * 0.98)
                ctx.lineTo(cx + dx * s, cy - s * 1.1)
                ctx.lineTo(cx + dx * s + s * 0.3, cy - s * 0.98)
                ctx.stroke()
            }
            break
        }
        case 'quickrevive': {
            ctx.beginPath()
            ctx.moveTo(cx, cy + s * 0.75)
            ctx.bezierCurveTo(cx - s * 1.5, cy - s * 0.2, cx - s * 0.75, cy - s * 1.1, cx, cy - s * 0.4)
            ctx.bezierCurveTo(cx + s * 0.75, cy - s * 1.1, cx + s * 1.5, cy - s * 0.2, cx, cy + s * 0.75)
            ctx.closePath()
            ctx.fillStyle = '#f4f4f4'
            ctx.fill()
            ctx.fillStyle = '#161616'
            ctx.fillRect(cx - s * 0.13, cy - s * 0.5, s * 0.26, s * 0.78)
            ctx.fillRect(cx - s * 0.39, cy - s * 0.24, s * 0.78, s * 0.26)
            ctx.strokeStyle = '#c4c4c4'
            ctx.lineWidth = s * 0.07
            ctx.beginPath()
            ctx.moveTo(cx - s * 1.15, cy + s * 0.95)
            ctx.lineTo(cx - s * 0.4, cy + s * 0.95)
            ctx.lineTo(cx - s * 0.25, cy + s * 0.6)
            ctx.lineTo(cx, cy + s * 1.2)
            ctx.lineTo(cx + s * 0.2, cy + s * 0.95)
            ctx.lineTo(cx + s * 1.15, cy + s * 0.95)
            ctx.stroke()
            break
        }
        case 'deadshot': {
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = s * 0.1
            ctx.beginPath()
            ctx.arc(cx, cy, s * 0.78, 0, Math.PI * 2)
            ctx.stroke()
            ctx.strokeStyle = '#b8b8b8'
            ctx.lineWidth = s * 0.05
            ctx.beginPath()
            ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2)
            ctx.stroke()
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = s * 0.1
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                ctx.beginPath()
                ctx.moveTo(cx + dx * s * 0.62, cy + dy * s * 0.62)
                ctx.lineTo(cx + dx * s * 1.12, cy + dy * s * 1.12)
                ctx.stroke()
            }
            ctx.fillStyle = '#ffffff'
            ctx.beginPath()
            ctx.arc(cx, cy, s * 0.1, 0, Math.PI * 2)
            ctx.fill()
            break
        }
        default: {
            drawBurst(ctx, cx, cy, 14, s * 1.08, s * 0.7, '#dcdcdc', '#ffffff', s * 0.05)
            ctx.beginPath()
            ctx.arc(cx, cy, s * 0.62, 0, Math.PI * 2)
            ctx.fillStyle = '#1a1a1a'
            ctx.fill()
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = s * 0.05
            ctx.stroke()
            ctx.fillStyle = '#ffffff'
            ctx.font = `${s * 0.7}px ${HEAVY}`
            ctx.fillText('PhD', cx, cy + s * 0.04)
        }
    }
    ctx.restore()
}

function perkPanelTexture(perk: CallOfXenoPerk) {
    return memo(`perk-panel:${perk.id}`, () => {
        const w = 512
        const h = 432
        const { el, ctx } = makeCanvas(w, h)
        const bg = ctx.createRadialGradient(w / 2, 190, 10, w / 2, 190, 330)
        bg.addColorStop(0, '#6a6a6a')
        bg.addColorStop(1, '#1c1c1c')
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
        // Sunburst rays behind the logo.
        ctx.fillStyle = 'rgba(0,0,0,0.16)'
        for (let i = 0; i < 24; i += 2) {
            ctx.beginPath()
            ctx.moveTo(w / 2, 190)
            ctx.arc(w / 2, 190, 420, (i / 24) * Math.PI * 2, ((i + 1) / 24) * Math.PI * 2)
            ctx.closePath()
            ctx.fill()
        }
        ctx.strokeStyle = '#ececec'
        ctx.lineWidth = 10
        ctx.beginPath()
        ctx.roundRect(12, 12, w - 24, h - 24, 22)
        ctx.stroke()
        ctx.strokeStyle = '#8c8c8c'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.roundRect(30, 30, w - 60, h - 60, 14)
        ctx.stroke()

        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#bcbcbc'
        ctx.font = `26px ${HEAVY}`
        ctx.fillText('* PERK-A-COLA *', w / 2, 62)

        drawPerkIcon(ctx, perk.id, w / 2, 200, 112)

        ctx.fillStyle = '#0d0d0d'
        ctx.beginPath()
        ctx.roundRect(46, 330, w - 92, 70, 10)
        ctx.fill()
        ctx.strokeStyle = '#d8d8d8'
        ctx.lineWidth = 4
        ctx.stroke()
        ctx.fillStyle = '#ffffff'
        fitText(ctx, perk.name.toUpperCase(), w / 2, 367, w - 130, 56)
        return canvasTexture(el)
    })
}

function perkNameTexture(perk: CallOfXenoPerk) {
    return memo(`perk-name:${perk.id}`, () => {
        const w = 512
        const h = 144
        const { el, ctx } = makeCanvas(w, h)
        ctx.fillStyle = '#242424'
        ctx.fillRect(0, 0, w, h)
        const g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, 'rgba(255,255,255,0.22)')
        g.addColorStop(1, 'rgba(255,255,255,0.02)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 8
        ctx.strokeRect(8, 8, w - 16, h - 16)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#ffffff'
        ctx.shadowColor = '#ffffff'
        ctx.shadowBlur = 10
        fitText(ctx, perk.name.toUpperCase(), w / 2, h / 2 + 4, w - 80, 92)
        return canvasTexture(el)
    })
}

function windowBackTexture() {
    return memo('perk-window-back', () => {
        const { el, ctx } = makeCanvas(64)
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 40)
        g.addColorStop(0, '#9c9c9c')
        g.addColorStop(1, '#262626')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 64, 64)
        return canvasTexture(el)
    })
}

/** A glass bottle, vertex-shaded in greys so the flat glow tint still reads as round. */
function bottleGeometry() {
    return memo('perk-bottle', () => {
        const profile = [
            [0.001, 0], [0.046, 0], [0.052, 0.02], [0.052, 0.13], [0.044, 0.17], [0.024, 0.2], [0.02, 0.24], [0.026, 0.25], [0.026, 0.27], [0.001, 0.27]
        ].map(([r, y]) => new THREE.Vector2(r, y))
        const geo = new THREE.LatheGeometry(profile, 10)
        const pos = geo.attributes.position!
        const nor = geo.attributes.normal!
        const colors = new Float32Array(pos.count * 3)
        for (let i = 0; i < pos.count; i++) {
            const nz = nor.getZ(i)
            const y = pos.getY(i)
            let v = 0.32 + 0.6 * Math.max(0, nz) + 0.08 * Math.max(0, nor.getX(i))
            if (y > 0.255) v = 1 // the cap
            else if (y > 0.05 && y < 0.15) v *= 0.85 + 0.15 * Math.sin(y * 60) // label band
            colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = clamp(v, 0, 1)
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        return keep(geo)
    })
}

function perkCabinetGeometry(w: number, h: number, d: number, r: number) {
    const s = new THREE.Shape()
    s.moveTo(-w / 2, 0)
    s.lineTo(w / 2, 0)
    s.lineTo(w / 2, h - r)
    s.absarc(w / 2 - r, h - r, r, 0, Math.PI / 2, false)
    s.lineTo(-w / 2 + r, h)
    s.absarc(-w / 2 + r, h - r, r, Math.PI / 2, Math.PI, false)
    s.lineTo(-w / 2, 0)
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 10 })
    g.translate(0, 0, -d / 2)
    return g
}

export function buildPerkMachine(perk: CallOfXenoPerk): PropModel {
    const s = S()
    const group = new THREE.Group()
    const FZ = 0.47

    const paint = memo(`perk-paint:${perk.id}`, () => {
        const m = s.paint.clone()
        m.color.setHex(perk.color).multiplyScalar(0.5)
        m.roughness = 0.5
        m.metalness = 0.35
        return keep(m)
    })

    const body = buildKit(`perk:${perk.id}`, (k) => {
        k.box(1.26, 0.16, 1.02, s.steelDark, 0, 0.08, 0)
        k.add(perkCabinetGeometry(1.14, 2.14, 0.9, 0.24), paint, { y: 0.16 })
        // Chrome pilasters and horizontal bands down the front.
        for (const sx of [-1, 1]) {
            k.box(0.045, 1.95, 0.03, s.chrome, 0.53 * sx, 1.2, FZ + 0.005)
            for (let i = 0; i < 8; i++) k.sph(0.013, s.chrome, 0.53 * sx, 0.32 + i * 0.26, FZ + 0.024, {}, 6, 4)
        }
        k.box(1.06, 0.035, 0.03, s.chrome, 0, 0.62, FZ + 0.01)
        k.box(1.06, 0.035, 0.03, s.chrome, 0, 1.33, FZ + 0.01)
        // Big display: bezel and chrome frame.
        k.box(1.0, 0.86, 0.05, s.steelDark, 0, 1.75, FZ + 0.02)
        k.box(1.04, 0.04, 0.06, s.chrome, 0, 1.75 + 0.43, FZ + 0.045)
        k.box(1.04, 0.04, 0.06, s.chrome, 0, 1.75 - 0.43, FZ + 0.045)
        for (const sx of [-1, 1]) k.box(0.04, 0.9, 0.06, s.chrome, 0.51 * sx, 1.75, FZ + 0.045)
        // Bottle window: deep frame, shelves.
        k.box(0.92, 0.68, 0.03, s.black, 0, 0.96, FZ - 0.005)
        k.box(1.0, 0.05, 0.13, s.chrome, 0, 1.305, FZ + 0.05)
        k.box(1.0, 0.05, 0.13, s.chrome, 0, 0.615, FZ + 0.05)
        for (const sx of [-1, 1]) k.box(0.06, 0.74, 0.13, s.chrome, 0.49 * sx, 0.96, FZ + 0.05)
        k.box(0.92, 0.02, 0.12, s.steel, 0, 0.665, FZ + 0.055)
        k.box(0.92, 0.02, 0.12, s.steel, 0, 0.975, FZ + 0.055)
        // Dispenser tray, flap and handle.
        k.box(0.58, 0.32, 0.06, s.black, -0.12, 0.36, FZ + 0.01)
        k.box(0.52, 0.26, 0.03, s.steel, -0.12, 0.36, FZ + 0.05, { rx: -0.12 })
        k.box(0.3, 0.03, 0.04, s.chrome, -0.12, 0.47, FZ + 0.08)
        // Coin mech.
        k.box(0.22, 0.4, 0.04, s.steelDark, 0.32, 0.4, FZ + 0.025)
        k.box(0.13, 0.05, 0.03, s.chrome, 0.32, 0.5, FZ + 0.05)
        k.box(0.1, 0.012, 0.03, s.black, 0.32, 0.5, FZ + 0.066)
        k.cyl(0.03, 0.03, 0.02, 12, s.chrome, 0.32, 0.3, FZ + 0.05, { rx: Math.PI / 2 })
        k.cyl(0.018, 0.018, 0.03, 8, s.black, 0.32, 0.3, FZ + 0.055, { rx: Math.PI / 2 })
        // Crown: neck, housing, chrome frame.
        k.rbox(0.7, 0.16, 0.6, 0.04, s.steelDark, 0, 2.32, 0.1)
        k.rbox(1.06, 0.5, 0.5, 0.05, s.steelDark, 0, 2.55, 0.24)
        k.box(1.08, 0.035, 0.03, s.chrome, 0, 2.55 + 0.25, 0.495)
        k.box(1.08, 0.035, 0.03, s.chrome, 0, 2.55 - 0.25, 0.495)
        for (const sx of [-1, 1]) k.box(0.035, 0.5, 0.03, s.chrome, 0.535 * sx, 2.55, 0.495)
        // Vent louvres and rear pipe on the sides.
        for (const sx of [-1, 1]) {
            for (let i = 0; i < 6; i++) k.box(0.02, 0.02, 0.3, s.black, 0.585 * sx, 0.5 + i * 0.045, -0.15)
        }
        k.strut([0.3, 2.28, -0.3], [0.3, 2.9, -0.3], 0.03, s.steel, 6)
    }, group)
    hook(body)

    // --- Glow parts (per instance so the game can tint each machine). ---
    const dim = (m: THREE.MeshBasicMaterial) => {
        m.color.setHex(perk.color).multiplyScalar(0.14)
        return m
    }
    const panelMat = dim(new THREE.MeshBasicMaterial({ map: perkPanelTexture(perk) }))
    const nameMat = dim(new THREE.MeshBasicMaterial({ map: perkNameTexture(perk), transparent: true }))
    const backMat = dim(new THREE.MeshBasicMaterial({ map: windowBackTexture() }))
    const bottleMat = dim(new THREE.MeshBasicMaterial({ vertexColors: true }))
    const bulbMat = dim(new THREE.MeshBasicMaterial({ color: 0xffffff }))
    const ledMat = dim(new THREE.MeshBasicMaterial({ color: 0xffffff }))

    const panel = new THREE.Mesh(plane(0.92, 0.78), panelMat)
    panel.position.set(0, 1.75, FZ + 0.048)
    group.add(panel)

    const nameplate = new THREE.Mesh(plane(0.98, 0.42), nameMat)
    nameplate.position.set(0, 2.55, 0.5)
    group.add(nameplate)

    const back = new THREE.Mesh(plane(0.92, 0.68), backMat)
    back.position.set(0, 0.96, FZ + 0.012)
    group.add(back)

    const bottles = new THREE.InstancedMesh(bottleGeometry(), bottleMat, 10)
    const m4 = new THREE.Matrix4()
    let bi = 0
    for (const rowY of [0.678, 0.988]) {
        for (let col = 0; col < 5; col++) {
            m4.makeTranslation(-0.36 + col * 0.18, rowY, FZ + 0.06)
            bottles.setMatrixAt(bi++, m4)
        }
    }
    bottles.instanceMatrix.needsUpdate = true
    group.add(bottles)

    const glass = new THREE.Mesh(plane(0.92, 0.68), s.glass)
    glass.position.set(0, 0.96, FZ + 0.118)
    group.add(glass)

    const bulbCount = 7
    const bulbs = new THREE.InstancedMesh(memo('perk-bulb', () => keep(new THREE.SphereGeometry(0.03, 8, 6))), bulbMat, bulbCount)
    for (let i = 0; i < bulbCount; i++) {
        m4.makeTranslation(-0.42 + (i / (bulbCount - 1)) * 0.84, 2.83, 0.4)
        bulbs.setMatrixAt(i, m4)
        bulbs.setColorAt(i, new THREE.Color(1, 1, 1))
    }
    bulbs.instanceMatrix.needsUpdate = true
    group.add(bulbs)

    const led = new THREE.Mesh(memo('perk-led', () => keep(new THREE.BoxGeometry(0.05, 0.035, 0.02))), ledMat)
    led.position.set(0.32, 0.58, FZ + 0.06)
    group.add(led)

    const light = new THREE.PointLight(perk.color, 0, 5, 2)
    light.position.set(0, 1.4, 0.9)
    group.add(light)

    const seed = perk.color % 97
    let lastStep = -1
    const tmp = new THREE.Color()
    track(group, (time) => {
        const live = glowLive(panelMat)
        nameMat.opacity = live ? flicker(time, seed) : 1
        const step = live ? Math.floor(time * 5) : -2
        if (step !== lastStep) {
            lastStep = step
            for (let i = 0; i < bulbCount; i++) {
                const on = live ? (i + step) % 3 === 0 : true
                bulbs.setColorAt(i, tmp.setScalar(on ? 1 : 0.22))
            }
            if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true
        }
    })

    return { group, glow: [panelMat, nameMat, backMat, bottleMat, bulbMat, ledMat], light }
}

// ---------------------------------------------------------------------------
// Wall buys
// ---------------------------------------------------------------------------

const BOARD_W = 2.0
const BOARD_H = 1.25
const BOARD_PPM = 512

const HAND_MATERIALS = new Set(['glove', 'sleeve', 'strap'])
const HAND_COLORS = new Set([0x25272a, 0x2f362f, 0x14151a])

/** The first-person models carry gloved hands; a gun on a wall hook has none. */
function stripHands(gun: THREE.Object3D) {
    const rig = (gun.userData?.rig ?? gun.userData) as Record<string, THREE.Object3D | undefined> | undefined
    rig?.leftHand?.removeFromParent()
    rig?.rightHand?.removeFromParent()
    const doomed: THREE.Object3D[] = []
    gun.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const handish = mats.some((m) => {
            const std = m as THREE.MeshStandardMaterial
            return HAND_MATERIALS.has(m.name) || (std.isMeshStandardMaterial && std.metalness === 0 && HAND_COLORS.has(std.color.getHex()))
        })
        if (handish) doomed.push(mesh)
    })
    for (const obj of doomed) obj.removeFromParent()
}

/** Fills the gun's exact screen-space silhouette (every triangle) in white. */
function fillGunSilhouette(ctx: CanvasRenderingContext2D, gun: THREE.Object3D) {
    gun.updateMatrixWorld(true)
    const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
    const px = new Float32Array(6)
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    gun.traverseVisible((obj) => {
        const mesh = obj as THREE.Mesh
        const pos = mesh.geometry?.attributes?.position
        if (!mesh.isMesh || !pos) return
        const index = mesh.geometry.index
        const tris = (index ? index.count : pos.count) / 3
        ctx.beginPath()
        for (let t = 0; t < tris; t++) {
            for (let i = 0; i < 3; i++) {
                const vi = index ? index.getX(t * 3 + i) : t * 3 + i
                p[i]!.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld)
                px[i * 2] = (p[i]!.x + BOARD_W / 2) * BOARD_PPM
                px[i * 2 + 1] = (BOARD_H / 2 - p[i]!.y) * BOARD_PPM
            }
            const area = (px[2]! - px[0]!) * (px[5]! - px[1]!) - (px[4]! - px[0]!) * (px[3]! - px[1]!)
            if (Math.abs(area) < 0.05) continue
            // Uniform winding, so overlapping triangles never cancel out.
            const flip = area < 0
            ctx.moveTo(px[0]!, px[1]!)
            ctx.lineTo(flip ? px[4]! : px[2]!, flip ? px[5]! : px[3]!)
            ctx.lineTo(flip ? px[2]! : px[4]!, flip ? px[3]! : px[5]!)
            ctx.closePath()
        }
        ctx.fill()
        ctx.stroke()
    })
}

function wallBuyTexture(weapon: CallOfXenoWeapon, gun: THREE.Object3D, hooks: [number, number][]) {
    return memo(`wallbuy:${weapon.id}`, () => {
        const W = BOARD_W * BOARD_PPM
        const H = BOARD_H * BOARD_PPM
        const rand = rng(weapon.cost + weapon.name.length * 131)
        const { el, ctx } = makeCanvas(W, H)

        // Painted slate patch with a feathered edge (shadow trick: no ctx.filter).
        ctx.save()
        ctx.shadowColor = 'rgba(10,12,14,0.95)'
        ctx.shadowBlur = 38
        ctx.shadowOffsetX = 4000
        ctx.fillStyle = '#000'
        ctx.fillRect(48 - 4000, 44, W - 96, H - 88)
        ctx.restore()
        // Eraser smudges and dust.
        for (let i = 0; i < 16; i++) {
            ctx.strokeStyle = `rgba(230,230,220,${0.02 + rand() * 0.035})`
            ctx.lineWidth = 30 + rand() * 60
            ctx.lineCap = 'round'
            const y = 70 + rand() * (H - 140)
            ctx.beginPath()
            ctx.moveTo(70 + rand() * 200, y)
            ctx.quadraticCurveTo(W / 2, y + (rand() - 0.5) * 80, W - 70 - rand() * 200, y + (rand() - 0.5) * 50)
            ctx.stroke()
        }
        for (let i = 0; i < 1400; i++) {
            ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)'
            ctx.fillRect(60 + rand() * (W - 120), 56 + rand() * (H - 112), 2, 2)
        }

        // Chalk layer.
        const chalk = makeCanvas(W, H)
        const c = chalk.ctx
        const mask = makeCanvas(W, H)
        fillGunSilhouette(mask.ctx, gun)
        const ring = makeCanvas(W, H)
        const d = 7
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2
            ring.ctx.drawImage(mask.el, Math.cos(a) * d, Math.sin(a) * d)
        }
        ring.ctx.globalCompositeOperation = 'destination-out'
        ring.ctx.drawImage(mask.el, 0, 0)
        c.globalAlpha = 0.85
        c.drawImage(ring.el, 0, 0)
        c.globalAlpha = 0.45
        c.drawImage(ring.el, 2, -1.5)
        c.globalAlpha = 0.3
        c.drawImage(ring.el, -1.5, 2)
        c.globalAlpha = 1

        // Hook marks.
        c.strokeStyle = 'rgba(240,240,230,0.85)'
        c.lineWidth = 5
        for (const [hx, hy] of hooks) {
            c.beginPath()
            c.arc(hx, hy, 15, 0, Math.PI * 2)
            c.stroke()
        }

        // Name, price and underline.
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillStyle = 'rgba(244,244,232,0.93)'
        c.save()
        c.translate(W / 2, 470)
        c.rotate(-0.012)
        fitText(c, weapon.name.toUpperCase(), 0, 0, W - 260, 104, CHALK_FONT)
        c.restore()
        c.strokeStyle = 'rgba(244,244,232,0.8)'
        c.lineWidth = 6
        c.beginPath()
        c.moveTo(W / 2 - 300, 522)
        c.quadraticCurveTo(W / 2, 534, W / 2 + 300, 520)
        c.stroke()
        c.fillStyle = 'rgba(244,222,150,0.95)'
        c.save()
        c.translate(W / 2, 585)
        c.rotate(0.01)
        fitText(c, `${weapon.cost} pts`, 0, 0, 420, 62, CHALK_FONT)
        c.restore()
        // Tally marks in the corners.
        c.strokeStyle = 'rgba(244,244,232,0.55)'
        c.lineWidth = 4
        for (let i = 0; i < 4; i++) {
            c.beginPath()
            c.moveTo(120 + i * 16, 552)
            c.lineTo(122 + i * 16, 596)
            c.stroke()
        }
        c.beginPath()
        c.moveTo(108, 590)
        c.lineTo(180, 556)
        c.stroke()

        // Chalk grain: knock speckles out so strokes look dusty.
        c.globalCompositeOperation = 'destination-out'
        for (let i = 0; i < 9000; i++) {
            c.fillStyle = `rgba(0,0,0,${0.25 + rand() * 0.5})`
            c.fillRect(rand() * W, rand() * H, 1 + rand() * 2.5, 1 + rand() * 2.5)
        }
        ctx.drawImage(chalk.el, 0, 0)
        return canvasTexture(el)
    })
}

export function buildWallBuy(weapon: CallOfXenoWeapon): PropModel {
    const s = S()
    const group = new THREE.Group()

    // Mount the gun first: its final silhouette is what gets chalked.
    const gun = buildWeaponModel(weapon.id, 0, { hands: false })
    stripHands(gun)
    // View models point down -Z; lay the barrel along the wall (muzzle left).
    const native = new THREE.Box3().setFromObject(gun).getSize(new THREE.Vector3())
    gun.rotation.y = native.x > native.z * 1.2 ? 0 : Math.PI / 2
    gun.updateMatrixWorld(true)
    const raw = new THREE.Box3().setFromObject(gun)
    const length = Math.max(0.2, raw.max.x - raw.min.x)
    gun.scale.setScalar(clamp(1.5 / length, 1.05, 2.2))
    gun.updateMatrixWorld(true)
    const fitted = new THREE.Box3().setFromObject(gun)
    const center = fitted.getCenter(new THREE.Vector3())
    const depth = fitted.max.z - fitted.min.z
    const GUN_Y = 0.24
    gun.position.set(-center.x, GUN_Y - center.y, 0.11 + depth / 2 - center.z)
    group.add(gun)
    gun.updateMatrixWorld(true)
    const placed = new THREE.Box3().setFromObject(gun)

    const hookX = [-0.3, 0.3].map(f => f * (placed.max.x - placed.min.x))
    const hookY = placed.min.y + (placed.max.y - placed.min.y) * 0.4
    const hookPx: [number, number][] = hookX.map(x => [(x + BOARD_W / 2) * BOARD_PPM, (BOARD_H / 2 - (hookY - 0.09)) * BOARD_PPM])

    const board = new THREE.Mesh(plane(BOARD_W, BOARD_H), keep(new THREE.MeshStandardMaterial({
        map: wallBuyTexture(weapon, gun, hookPx),
        transparent: true,
        roughness: 1,
        metalness: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
    })))
    board.position.z = 0.014
    group.add(board)

    // Hooks: wall plate, arm out to the gun, and a lip that cradles the barrel.
    buildKit(`wallbuy-hook:${weapon.id}:${Math.round(placed.min.z * 1000)}`, (k) => {
        const armLen = Math.max(0.06, placed.min.z - 0.02)
        for (const x of hookX) {
            k.box(0.07, 0.11, 0.02, s.steelDark, x, hookY, 0.03)
            k.cyl(0.011, 0.011, armLen, 6, s.steel, x, hookY, 0.03 + armLen / 2, { rx: Math.PI / 2 })
            k.box(0.035, 0.05, 0.012, s.steel, x, hookY - 0.03, placed.min.z + 0.02)
            k.sph(0.012, s.chrome, x + 0.02, hookY + 0.035, 0.043, {}, 6, 4)
            k.sph(0.012, s.chrome, x - 0.02, hookY - 0.035, 0.043, {}, 6, 4)
        }
    }, group)

    return { group, glow: [] }
}

// ---------------------------------------------------------------------------
// Pack-a-Punch
// ---------------------------------------------------------------------------

function tendrilCurves(): V3[][] {
    const mirror = (pts: V3[]): V3[] => pts.map(([x, y, z]) => [-x, y, z])
    const a: V3[] = [[1.25, 0.5, 0.5], [1.6, 0.9, 0.6], [1.5, 1.6, 0.45], [1.0, 2.1, 0.2], [0.5, 2.4, 0], [0.3, 2.75, -0.1]]
    const b: V3[] = [[0.9, 1.7, -0.5], [1.15, 2.2, -0.4], [0.65, 2.6, -0.3], [0.32, 2.85, -0.2]]
    const c: V3[] = [[-1.0, 0.45, 0.86], [-1.3, 0.16, 1.05], [-1.7, 0.07, 0.9], [-1.95, 0.07, 0.6]]
    return [a, mirror(a), b, mirror(b), c]
}

export function buildPackAPunch(): PropModel {
    const s = S()
    const group = new THREE.Group()

    const body = buildKit('pap', (k) => {
        // Skid, hazard lip and the heavy main body.
        k.box(2.7, 0.16, 1.5, s.steelDark, 0, 0.08, 0)
        k.box(2.6, 0.1, 0.05, s.hazard, 0, 0.14, 0.775)
        k.rbox(2.4, 1.5, 1.25, 0.06, s.purpleSteel, 0, 0.93, 0)
        k.box(2.5, 0.1, 1.35, s.steelDark, 0, 1.72, 0)
        for (const sx of [-1, 1]) {
            for (const z of [-0.42, 0, 0.42]) k.box(0.06, 1.4, 0.12, s.steel, 1.22 * sx, 0.93, z)
            k.box(0.16, 1.5, 0.1, s.steel, 1.1 * sx, 0.93, 0.66)
        }
        for (let i = 0; i < 9; i++) {
            const x = -1.05 + i * 0.26
            k.sph(0.022, s.chrome, x, 1.62, 0.635, {}, 6, 4)
            k.sph(0.022, s.chrome, x, 0.26, 0.635, {}, 6, 4)
        }

        // The mouth: heavy frame, teeth, rollers.
        k.box(1.9, 0.14, 0.34, s.steelDark, 0, 1.14, 0.76)
        k.box(1.9, 0.14, 0.34, s.steelDark, 0, 0.56, 0.76)
        for (const sx of [-1, 1]) k.box(0.14, 0.7, 0.34, s.steelDark, 0.88 * sx, 0.85, 0.76)
        const tooth = new THREE.ConeGeometry(0.05, 0.17, 4)
        for (let i = 0; i < 11; i++) {
            const x = -0.7 + i * 0.14
            k.add(tooth, s.chrome, { x, y: 1.0, z: 0.86, rx: Math.PI })
            k.add(tooth, s.chrome, { x, y: 0.7, z: 0.86 })
        }
        k.cyl(0.075, 0.075, 1.6, 12, s.steel, 0, 1.03, 0.7, { rz: Math.PI / 2 })
        for (let i = 0; i < 4; i++) k.cyl(0.04, 0.04, 1.6, 8, s.chrome, 0, 0.68, 0.64 + i * 0.09, { rz: Math.PI / 2 })
        for (let i = 0; i < 9; i++) k.cyl(0.085, 0.085, 0.03, 12, s.steelDark, -0.7 + i * 0.175, 1.03, 0.7, { rz: Math.PI / 2 })

        // Sign frame on the upper front.
        k.box(2.0, 0.44, 0.06, s.steelDark, 0, 1.42, 0.66)

        // Reactor tower on top, behind the sign.
        k.cyl(0.55, 0.6, 0.16, 16, s.steelDark, 0, 1.8, -0.1)
        k.cyl(0.5, 0.5, 0.16, 16, s.steel, 0, 2.9, -0.1)
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2
            k.strut([Math.cos(a) * 0.44, 1.88, -0.1 + Math.sin(a) * 0.44], [Math.cos(a) * 0.44, 2.82, -0.1 + Math.sin(a) * 0.44], 0.025, s.chrome, 6)
            k.sph(0.03, s.chrome, Math.cos(a) * 0.52, 1.86, -0.1 + Math.sin(a) * 0.52, {}, 6, 4)
        }
        k.cyl(0.14, 0.14, 0.3, 10, s.steelDark, 0, 3.05, -0.1)

        // Feed pipes between the tower base and the body, with flanges.
        for (const sx of [-1, 1]) {
            k.strut([0.5 * sx, 1.82, -0.1], [1.0 * sx, 1.82, -0.1], 0.075, s.steel, 8)
            k.strut([1.0 * sx, 1.82, -0.1], [1.0 * sx, 1.72, -0.1], 0.075, s.steel, 8)
            for (const fx of [0.66, 0.9]) k.cyl(0.1, 0.1, 0.035, 8, s.chrome, fx * sx, 1.82, -0.1, { rz: Math.PI / 2 })
            // Side drum, bands and valve wheel.
            k.cyl(0.32, 0.32, 0.9, 14, s.steelDark, 1.6 * sx, 0.55, -0.1, { rx: Math.PI / 2 })
            for (const dz of [-0.32, 0.32]) k.cyl(0.335, 0.335, 0.06, 14, s.steel, 1.6 * sx, 0.55, -0.1 + dz, { rx: Math.PI / 2 })
            k.strut([1.2 * sx, 0.8, -0.1], [1.4 * sx, 0.8, -0.1], 0.06, s.steel, 8)
            k.add(new THREE.TorusGeometry(0.09, 0.014, 6, 12), s.red, { x: 1.6 * sx, y: 0.55, z: 0.4 })
            k.strut([1.6 * sx - 0.09, 0.55, 0.4], [1.6 * sx + 0.09, 0.55, 0.4], 0.012, s.red, 4)
            k.strut([1.6 * sx, 0.46, 0.4], [1.6 * sx, 0.64, 0.4], 0.012, s.red, 4)
            k.strut([1.6 * sx, 0.5, 0.3], [1.6 * sx, 0.55, 0.4], 0.02, s.steel, 5)
            // Beacon posts.
            k.cyl(0.05, 0.06, 0.16, 8, s.steelDark, 1.0 * sx, 1.83, 0.42)
        }
    }, group)
    hook(body)

    // Xeno-tech tendrils: alien flesh clamped over the machine.
    const tendrils = new THREE.Group()
    const nodulePositions: V3[] = []
    for (const pts of tendrilCurves()) {
        const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)))
        const tube = new THREE.Mesh(memo(`pap-tendril:${pts[0]!.join(',')}`, () => keep(new THREE.TubeGeometry(curve, 36, 0.05, 6, false))), s.alien)
        tendrils.add(tube)
        for (const t of [0.2, 0.42, 0.63, 0.85]) {
            const p = curve.getPoint(t)
            nodulePositions.push([p.x, p.y, p.z])
        }
    }
    group.add(tendrils)
    const nodules = new THREE.InstancedMesh(memo('pap-nodule', () => keep(new THREE.SphereGeometry(0.045, 8, 6))), s.tendrilGlow, nodulePositions.length)
    const m4 = new THREE.Matrix4()
    nodulePositions.forEach((p, i) => {
        m4.makeTranslation(p[0], p[1], p[2])
        nodules.setMatrixAt(i, m4)
    })
    nodules.instanceMatrix.needsUpdate = true
    group.add(nodules)

    // --- Glow parts, tinted by the game (purple when powered). ---
    const slotMat = new THREE.MeshBasicMaterial({ color: 0x2a0f3a, map: windowBackTexture() })
    const signMat = new THREE.MeshBasicMaterial({
        color: 0x2a0f3a,
        map: plateTexture('pap', 512, 96, 'Pack-a-Punch', undefined, '#ffffff', '#262626', '#ffffff')
    })
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x2a0f3a })
    const archMat = new THREE.MeshBasicMaterial({ color: 0x2a0f3a })

    const slot = new THREE.Mesh(plane(1.66, 0.56), slotMat)
    slot.position.set(0, 0.85, 0.625)
    group.add(slot)

    const sign = new THREE.Mesh(plane(1.9, 0.36), signMat)
    sign.position.set(0, 1.42, 0.7)
    group.add(sign)

    const core = new THREE.Mesh(memo('pap-core', () => keep(new THREE.CylinderGeometry(0.22, 0.22, 0.92, 14))), coreMat)
    core.position.set(0, 2.35, -0.1)
    group.add(core)
    const coreCap = new THREE.Mesh(memo('pap-corecap', () => keep(new THREE.SphereGeometry(0.24, 12, 8))), coreMat)
    coreCap.position.set(0, 2.35, -0.1)
    coreCap.scale.set(1, 0.3, 1)
    group.add(coreCap)

    // Tie-in strips along the mouth frame edges and pillars (the "arch" glow).
    const strips = new THREE.InstancedMesh(memo('pap-strip', () => keep(new THREE.BoxGeometry(0.03, 0.62, 0.02))), archMat, 2)
    for (const [i, sx] of [-1, 1].entries()) {
        m4.makeTranslation(0.82 * sx, 0.85, 0.935)
        strips.setMatrixAt(i, m4)
    }
    strips.instanceMatrix.needsUpdate = true
    group.add(strips)

    // Non-glow animated bits: plasma around the core, glass, beacons.
    const glass = new THREE.Mesh(memo('pap-glass', () => keep(new THREE.CylinderGeometry(0.38, 0.38, 0.96, 16, 1, true))), s.glass)
    glass.position.set(0, 2.35, -0.1)
    group.add(glass)

    const plasmaMat = additiveMaterial(0x35e6ff, s.energyTex, 0)
    const plasma = new THREE.Mesh(memo('pap-plasma', () => keep(new THREE.CylinderGeometry(0.31, 0.31, 0.9, 16, 1, true))), plasmaMat)
    plasma.position.set(0, 2.35, -0.1)
    group.add(plasma)

    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x330806 })
    const beaconGeo = memo('pap-beacon', () => keep(new THREE.SphereGeometry(0.09, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2)))
    const beacons = [-1, 1].map((sx) => {
        const b = new THREE.Mesh(beaconGeo, beaconMat)
        b.position.set(1.0 * sx, 1.91, 0.42)
        group.add(b)
        return b
    })

    const halo = new THREE.Sprite(haloMaterial(0x35e6ff, 0))
    halo.material = halo.material.clone()
    halo.material.opacity = 0
    halo.scale.set(2.4, 2.4, 1)
    halo.position.set(0, 2.35, 0.1)
    group.add(halo)

    const light = new THREE.PointLight(0xa855f7, 0, 8, 2)
    light.position.set(0, 1.4, 1.2)
    group.add(light)

    track(group, (time) => {
        const live = glowLive(slotMat)
        plasmaMat.opacity = live ? 0.62 + 0.18 * Math.sin(time * 3.1) : 0
        halo.material.opacity = live ? 0.38 + 0.14 * Math.sin(time * 2.2) : 0
        core.scale.setScalar(live ? 1 + 0.06 * Math.sin(time * 5) : 1)
        const blink = live ? (Math.sin(time * 6) > 0 ? 1 : 0.1) : 0.08
        beaconMat.color.setRGB(1 * blink, 0.16 * blink, 0.08 * blink)
        beacons.forEach((b, i) => b.scale.setScalar(live && Math.sin(time * 6 + i * Math.PI) > 0 ? 1.15 : 1))
    })

    return { group, glow: [slotMat, signMat, coreMat, archMat], light }
}

// ---------------------------------------------------------------------------
// Power lever
// ---------------------------------------------------------------------------

export interface PowerLeverModel extends PropModel {
    handle: THREE.Mesh
}

function screenTexture() {
    return memo('lever-screen', () => {
        const { el, ctx } = makeCanvas(256, 112)
        ctx.fillStyle = '#3a3a3a'
        ctx.fillRect(0, 0, 256, 112)
        ctx.fillStyle = '#ffffff'
        ctx.font = `20px ${HEAVY}`
        ctx.textBaseline = 'middle'
        ctx.fillText('GRID', 14, 20)
        ctx.font = `16px ${HEAVY}`
        ctx.fillStyle = '#d0d0d0'
        ctx.fillText('LOAD', 14, 92)
        // Bar meter and a waveform.
        for (let i = 0; i < 14; i++) {
            ctx.fillStyle = i < 9 ? '#ffffff' : '#666666'
            ctx.fillRect(84 + i * 12, 10, 8, 20 + Math.sin(i * 0.9) * 6)
        }
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.beginPath()
        for (let x = 14; x < 244; x += 4) {
            const y = 76 + Math.sin(x * 0.12) * 14 * Math.sin(x * 0.02)
            if (x === 14) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.strokeStyle = '#bbbbbb'
        ctx.strokeRect(4, 4, 248, 104)
        return canvasTexture(el)
    })
}

function hazardSignTexture() {
    return memo('lever-hazard', () => {
        const { el, ctx } = makeCanvas(128)
        ctx.fillStyle = '#d6a516'
        ctx.fillRect(0, 0, 128, 128)
        ctx.strokeStyle = '#111'
        ctx.lineWidth = 8
        ctx.strokeRect(4, 4, 120, 120)
        ctx.fillStyle = '#111'
        ctx.beginPath()
        ctx.moveTo(64, 20)
        ctx.lineTo(112, 100)
        ctx.lineTo(16, 100)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#d6a516'
        ctx.beginPath()
        ctx.moveTo(70, 42)
        ctx.lineTo(50, 74)
        ctx.lineTo(64, 74)
        ctx.lineTo(56, 94)
        ctx.lineTo(80, 60)
        ctx.lineTo(66, 60)
        ctx.closePath()
        ctx.fill()
        return canvasTexture(el)
    })
}

export function buildPowerLever(): PowerLeverModel {
    const s = S()
    const group = new THREE.Group()
    const CZ = -0.12 // cabinet front face
    const PZ = 0.55 // pedestal / lever pivot

    const body = buildKit('lever', (k) => {
        // Breaker cabinet with door seam, hinges and vents.
        k.rbox(1.5, 1.95, 0.36, 0.03, s.paint, 0, 0.975, -0.3)
        k.box(1.38, 1.8, 0.02, s.steelDark, 0, 0.98, CZ + 0.005)
        k.box(0.012, 1.8, 0.03, s.black, 0, 0.98, CZ + 0.012)
        for (const y of [0.3, 1.6]) k.cyl(0.025, 0.025, 0.16, 8, s.chrome, -0.68, y, CZ + 0.02)
        k.box(0.06, 0.24, 0.05, s.chrome, 0.1, 1.0, CZ + 0.035)
        for (let i = 0; i < 6; i++) k.box(0.3, 0.018, 0.02, s.black, 0.4, 1.94 - i * 0.04, CZ + 0.02)
        // Breaker board: plate and two rows of toggles.
        k.box(1.3, 0.46, 0.03, s.black, 0, 1.28, CZ + 0.025)
        for (let row = 0; row < 2; row++) {
            for (let i = 0; i < 12; i++) {
                const x = -0.55 + i * 0.1
                const y = 1.4 - row * 0.2
                const up = (i + row) % 3 !== 0
                k.box(0.06, 0.1, 0.02, s.steelDark, x, y, CZ + 0.05)
                k.box(0.03, 0.05, 0.035, i % 5 === 0 ? s.red : s.chrome, x, y + (up ? 0.02 : -0.02), CZ + 0.07)
            }
        }
        // Conduits climbing the wall and cable drops.
        for (const sx of [-1, 1]) {
            k.strut([0.5 * sx, 1.9, -0.32], [0.5 * sx, 3.0, -0.32], 0.04, s.steel, 8)
            k.cyl(0.055, 0.055, 0.05, 8, s.chrome, 0.5 * sx, 2.2, -0.32)
            k.cyl(0.055, 0.055, 0.05, 8, s.chrome, 0.5 * sx, 2.6, -0.32)
        }
        k.strut([0, 1.94, -0.3], [-0.2, 2.3, -0.36], 0.022, s.rubber, 5)
        k.strut([-0.2, 2.3, -0.36], [-0.7, 2.6, -0.4], 0.022, s.rubber, 5)

        // Free-standing lever pedestal: hazard base, housing, cheek plates.
        k.box(0.54, 0.14, 0.58, s.hazard, 0, 0.07, PZ)
        k.rbox(0.42, 1.02, 0.46, 0.03, s.orange, 0, 0.65, PZ)
        k.box(0.46, 0.06, 0.52, s.steelDark, 0, 1.17, PZ)
        for (const sx of [-1, 1]) {
            k.box(0.03, 0.5, 0.56, s.steel, 0.14 * sx, 1.42, PZ)
        }
        k.cyl(0.075, 0.075, 0.36, 14, s.chrome, 0, 1.3, PZ, { rz: Math.PI / 2 })
        for (const sx of [-1, 1]) k.cyl(0.03, 0.03, 0.03, 8, s.black, 0.195 * sx, 1.3, PZ, { rz: Math.PI / 2 })
        for (const sz of [-1, 1]) k.box(0.32, 0.05, 0.05, s.red, 0, 1.22, PZ + 0.5 * sz * 0.9)
    }, group)
    hook(body)

    // The lever: rod and knob, pivoting at the base (game drives rotation.x).
    const rod = new THREE.CylinderGeometry(0.022, 0.028, 0.5, 8)
    rod.translate(0, 0.32, 0)
    const collar = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10)
    collar.translate(0, 0.05, 0)
    const knob = new THREE.SphereGeometry(0.068, 12, 10)
    knob.translate(0, 0.6, 0)
    const handleGeo = mergeGeometries([rod, collar, knob].map(g => (g.index ? g.toNonIndexed() : g)), false)!
    const handle = new THREE.Mesh(keep(handleGeo), s.red)
    handle.position.set(0, 1.3, PZ)
    handle.rotation.x = 0.9
    group.add(handle)

    // Lit parts: one shared lamp colour (green when powered, dim red when off).
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x441111 })
    const lampGeo = memo('lever-lamp', () => keep(new THREE.SphereGeometry(0.045, 10, 8)))
    for (let i = 0; i < 4; i++) {
        const lamp = new THREE.Mesh(lampGeo, lampMat)
        lamp.position.set(0.05 + i * 0.2, 1.72, CZ + 0.03)
        group.add(lamp)
        const bezel = new THREE.Mesh(memo('lever-bezel', () => keep(new THREE.TorusGeometry(0.05, 0.012, 6, 12))), s.chrome)
        bezel.position.copy(lamp.position)
        bezel.position.z -= 0.01
        group.add(bezel)
    }
    const beacon = new THREE.Mesh(memo('lever-beacon', () => keep(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2))), lampMat)
    beacon.position.set(0, 1.97, -0.3)
    group.add(beacon)
    const beaconBase = new THREE.Mesh(memo('lever-beacon-base', () => keep(new THREE.CylinderGeometry(0.15, 0.17, 0.06, 12))), s.steelDark)
    beaconBase.position.set(0, 1.95, -0.3)
    group.add(beaconBase)

    const displayMat = new THREE.MeshBasicMaterial({ color: 0x441111, map: screenTexture() })
    const display = new THREE.Mesh(plane(0.5, 0.22), displayMat)
    display.position.set(-0.4, 1.72, CZ + 0.018)
    group.add(display)

    // Signage: hazard triangle and the switch label.
    const hazardSign = new THREE.Mesh(plane(0.34, 0.34), plateMaterial(hazardSignTexture(), 0.35))
    hazardSign.position.set(-0.5, 0.62, CZ + 0.02)
    group.add(hazardSign)
    const label = new THREE.Mesh(plane(0.5, 0.22), plateMaterial(plateTexture('lever', 384, 164, 'Main Power', 'Throw to restore', '#ffd27a', '#15100a', '#c98a2a'), 0.5))
    label.position.set(0.5, 0.62, CZ + 0.02)
    group.add(label)
    const pedestalLabel = new THREE.Mesh(plane(0.36, 0.14), plateMaterial(plateTexture('lever-ped', 256, 100, 'Power', undefined, '#ffd27a', '#15100a', '#c98a2a'), 0.5))
    pedestalLabel.position.set(0, 0.85, PZ + 0.236)
    group.add(pedestalLabel)

    return { group, glow: [lampMat, displayMat], handle }
}

// ---------------------------------------------------------------------------
// Mystery box
// ---------------------------------------------------------------------------

export interface MysteryBoxModel extends PropModel {
    lid: THREE.Object3D
    /** Where the prize weapon floats while the box is spinning. */
    mount: THREE.Object3D
    /** The price sign — hidden while the box is spinning or holding a prize. */
    sign: THREE.Object3D
}

function questionTexture() {
    return memo('box-question', () => {
        const { el, ctx } = makeCanvas(256, 128)
        ctx.fillStyle = '#2b2b2b'
        ctx.fillRect(0, 0, 256, 128)
        const g = ctx.createRadialGradient(128, 64, 4, 128, 64, 110)
        g.addColorStop(0, 'rgba(255,255,255,0.5)')
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 256, 128)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#ffffff'
        ctx.shadowColor = '#ffffff'
        ctx.shadowBlur = 14
        ctx.font = `120px ${HEAVY}`
        ctx.fillText('?', 128, 68)
        ctx.shadowBlur = 0
        ctx.strokeStyle = '#d8d8d8'
        ctx.lineWidth = 4
        ctx.strokeRect(6, 6, 244, 116)
        return canvasTexture(el)
    })
}

export function buildMysteryBox(cost: number): MysteryBoxModel {
    const s = S()
    const group = new THREE.Group()

    const body = buildKit('mystery-box', (k) => {
        // Steel pallet base: it stands on this rather than sinking into the floor.
        k.box(1.7, 0.08, 1.3, s.steelDark, 0, 0.1, 0)
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) k.box(0.18, 0.06, 0.18, s.rubber, 0.72 * sx, 0.03, 0.5 * sz)
        }
        // Weathered timber body, plank seams, banded iron.
        k.box(1.5, 0.92, 1.06, s.woodMat, 0, 0.6, 0)
        for (const y of [0.38, 0.6, 0.82]) k.box(1.52, 0.02, 1.08, s.woodDark, 0, y, 0)
        for (const y of [0.26, 0.94]) k.box(1.54, 0.09, 1.1, s.steelDark, 0, y, 0)
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                k.box(0.13, 0.98, 0.13, s.steelDark, 0.71 * sx, 0.6, 0.48 * sz)
                for (let i = 0; i < 4; i++) k.sph(0.014, s.chrome, 0.71 * sx, 0.3 + i * 0.22, 0.55 * sz, {}, 5, 4)
            }
            // Side carry handles.
            k.add(new THREE.TorusGeometry(0.11, 0.026, 6, 10, Math.PI), s.steelDark, { x: 0.78 * sx, y: 0.62, ry: Math.PI / 2, rz: Math.PI / 2 })
        }
        for (const x of [-0.36, 0.36]) k.box(0.08, 0.94, 0.03, s.steelDark, x, 0.6, 0.545)
        // Front framed panel for the glowing question mark.
        k.box(1.08, 0.52, 0.06, s.steelDark, 0, 0.66, 0.55)
        k.box(1.12, 0.035, 0.07, s.chrome, 0, 0.66 + 0.275, 0.55)
        k.box(1.12, 0.035, 0.07, s.chrome, 0, 0.66 - 0.275, 0.55)
        for (const sx of [-1, 1]) k.box(0.035, 0.56, 0.07, s.chrome, 0.555 * sx, 0.66, 0.55)
        // Hinges.
        for (const sx of [-1, 1]) k.cyl(0.045, 0.045, 0.34, 8, s.steelDark, 0.55 * sx, 1.12, -0.52, { rz: Math.PI / 2 })
        // Claw-mark scratches on the wood, deep and dark.
        for (let i = 0; i < 3; i++) k.box(0.02, 0.24, 0.01, s.black, -0.55 + i * 0.05, 0.42, 0.535, { rz: 0.35 })
    }, group)
    hook(body)

    // Arched lid on a rear hinge (the game rotates `lid.rotation.x`).
    const lid = new THREE.Group()
    lid.position.set(0, 1.1, -0.55)
    buildKit('mystery-lid', (k) => {
        const arch = new THREE.CylinderGeometry(0.59, 0.59, 1.6, 20, 1, false, 0, Math.PI)
        k.add(arch, s.woodMat, { z: 0.56, rz: Math.PI / 2, sx: 0.5 })
        k.box(1.6, 0.02, 1.18, s.woodDark, 0, 0.01, 0.56)
        for (const x of [-0.55, 0, 0.55]) {
            k.add(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 20, 1, true, 0, Math.PI), s.steelDark, { x, z: 0.56, rz: Math.PI / 2, sx: 0.51 })
        }
        k.box(0.2, 0.16, 0.08, s.steelDark, 0, 0.1, 1.17)
        k.cyl(0.03, 0.03, 0.03, 8, s.brass, 0, 0.08, 1.22, { rx: Math.PI / 2 })
    }, lid)
    group.add(lid)

    // Glowing parts.
    const seamMat = new THREE.MeshBasicMaterial({ color: 0x1a1206 })
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x1a1206, map: questionTexture() })
    const seam = new THREE.Mesh(memo('box-seam', () => keep(new THREE.BoxGeometry(1.56, 0.045, 1.12))), seamMat)
    seam.position.y = 1.08
    group.add(seam)
    const panel = new THREE.Mesh(plane(0.94, 0.42), glowMat)
    panel.position.set(0, 0.66, 0.586)
    group.add(panel)

    // Price sign on a post behind the prize (hidden while a spin runs).
    const signGroup = new THREE.Group()
    buildKit('mystery-sign-post', k => k.box(0.06, 0.62, 0.06, s.steelDark, 0, 1.4, -0.48), signGroup)
    const face = new THREE.Mesh(plane(1.5, 0.44), plateMaterial(plateTexture('box', 512, 150, 'Mystery Box', String(cost), '#ffd98a', '#100a04', '#c98a2a'), 0.6))
    face.position.set(0, 1.85, -0.46)
    signGroup.add(face)
    group.add(signGroup)

    const mount = new THREE.Group()
    mount.position.set(0, 1.5, 0)
    group.add(mount)

    // Beacon: crossed light shafts and a floor pool, always visible so the
    // box can be found from across the map; brighter when it holds a prize.
    const beamMat = additiveMaterial(0xffc457, S().beamTex, 0.3)
    const beamGeo = memo('box-beam', () => keep(new THREE.PlaneGeometry(1.2, 12)))
    const beams = new THREE.Group()
    for (const ry of [0, Math.PI / 2]) {
        const b = new THREE.Mesh(beamGeo, beamMat)
        b.rotation.y = ry
        b.position.y = 7.1
        beams.add(b)
    }
    group.add(beams)
    const poolMat = additiveMaterial(0xffc457, S().haloTex, 0.3, THREE.FrontSide)
    const pool = new THREE.Mesh(memo('box-pool', () => keep(new THREE.CircleGeometry(1.9, 24))), poolMat)
    pool.rotation.x = -Math.PI / 2
    pool.position.y = 0.03
    group.add(pool)
    const halo = new THREE.Sprite(haloMaterial(0xffc457, 0.0).clone())
    halo.scale.set(3, 3, 1)
    halo.position.y = 1.4
    group.add(halo)

    const light = new THREE.PointLight(0xffc457, 0, 7, 2)
    light.position.set(0, 1.6, 0)
    group.add(light)

    track(group, (time) => {
        const r = seamMat.color.r
        const state = r > 0.6 ? 2 : r > 0.1 ? 1 : 0
        const shimmer = 0.9 + 0.1 * Math.sin(time * 3.3) * Math.sin(time * 1.7)
        const target = state === 2 ? 0.75 : state === 1 ? 0.55 : 0.4
        beamMat.opacity = target * shimmer
        poolMat.opacity = target * 0.9 * shimmer
        halo.material.opacity = state === 0 ? 0.08 : state === 1 ? 0.35 : 0.55
        beams.rotation.y = time * 0.15
    })

    return { group, glow: [glowMat, seamMat], light, lid, mount, sign: signGroup }
}

// ---------------------------------------------------------------------------
// Power-ups
// ---------------------------------------------------------------------------

export interface PowerUpModel {
    group: THREE.Group
    light: THREE.PointLight
}

function drawPowerUpGlyph(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, s: number, color: string) {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#ffffff'
    switch (id) {
        case 'maxammo': {
            for (const dx of [-0.5, 0, 0.5]) drawBullet(ctx, cx + dx * s, cy + s * 0.15, s * 0.78, '#ffffff', color)
            ctx.font = `${s * 0.42}px ${HEAVY}`
            ctx.fillStyle = '#ffffff'
            ctx.fillText('MAX', cx, cy + s * 0.98)
            break
        }
        case 'instakill': {
            ctx.beginPath()
            ctx.arc(cx, cy - s * 0.1, s * 0.72, Math.PI * 0.95, Math.PI * 2.05)
            ctx.lineTo(cx + s * 0.5, cy + s * 0.5)
            ctx.lineTo(cx - s * 0.5, cy + s * 0.5)
            ctx.closePath()
            ctx.fill()
            ctx.fillStyle = '#0c0c0c'
            for (const dx of [-0.29, 0.29]) {
                ctx.beginPath()
                ctx.arc(cx + dx * s, cy - s * 0.12, s * 0.19, 0, Math.PI * 2)
                ctx.fill()
            }
            ctx.beginPath()
            ctx.moveTo(cx, cy + s * 0.05)
            ctx.lineTo(cx - s * 0.09, cy + s * 0.27)
            ctx.lineTo(cx + s * 0.09, cy + s * 0.27)
            ctx.closePath()
            ctx.fill()
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(cx - s * 0.36, cy + s * 0.5, s * 0.72, s * 0.34)
            ctx.fillStyle = '#0c0c0c'
            for (let i = 0; i < 4; i++) ctx.fillRect(cx - s * 0.36 + (i + 0.5) * (s * 0.72 / 4) - 2, cy + s * 0.5, 4, s * 0.34)
            break
        }
        case 'doublepoints': {
            ctx.beginPath()
            ctx.arc(cx, cy, s * 0.86, 0, Math.PI * 2)
            ctx.fillStyle = color
            ctx.globalAlpha = 0.35
            ctx.fill()
            ctx.globalAlpha = 1
            ctx.fillStyle = '#ffffff'
            ctx.font = `${s * 1.25}px ${HEAVY}`
            ctx.fillText('2X', cx, cy + s * 0.05)
            break
        }
        case 'nuke': {
            for (let i = 0; i < 3; i++) {
                const a0 = (i / 3) * Math.PI * 2 - Math.PI / 2 - Math.PI / 6
                ctx.beginPath()
                ctx.arc(cx, cy, s * 0.92, a0, a0 + Math.PI / 3)
                ctx.arc(cx, cy, s * 0.3, a0 + Math.PI / 3, a0, true)
                ctx.closePath()
                ctx.fill()
            }
            ctx.beginPath()
            ctx.arc(cx, cy, s * 0.17, 0, Math.PI * 2)
            ctx.fill()
            break
        }
        case 'carpenter': {
            // Hammer over a plank with nails.
            ctx.fillStyle = color
            ctx.fillRect(cx - s * 0.95, cy + s * 0.5, s * 1.9, s * 0.34)
            ctx.fillStyle = '#ffffff'
            for (const dx of [-0.6, 0.6]) ctx.fillRect(cx + dx * s - 3, cy + s * 0.5, 6, s * 0.34)
            ctx.save()
            ctx.translate(cx, cy - s * 0.05)
            ctx.rotate(-0.6)
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(-s * 0.07, -s * 0.2, s * 0.14, s * 1.05)
            ctx.fillRect(-s * 0.42, -s * 0.5, s * 0.84, s * 0.32)
            ctx.fillStyle = color
            ctx.fillRect(-s * 0.42, -s * 0.5, s * 0.14, s * 0.32)
            ctx.restore()
            break
        }
        default: {
            // Death machine: six-barrel rotary.
            ctx.lineWidth = s * 0.12
            ctx.beginPath()
            ctx.arc(cx, cy, s * 0.86, 0, Math.PI * 2)
            ctx.stroke()
            ctx.fillStyle = '#ffffff'
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2
                ctx.beginPath()
                ctx.arc(cx + Math.cos(a) * s * 0.5, cy + Math.sin(a) * s * 0.5, s * 0.17, 0, Math.PI * 2)
                ctx.fill()
            }
            ctx.beginPath()
            ctx.arc(cx, cy, s * 0.15, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    ctx.restore()
}

function powerUpIconMaterial(powerUp: CallOfXenoPowerUp) {
    return memo(`powerup-icon:${powerUp.id}`, () => {
        const size = 256
        const { el, ctx } = makeCanvas(size)
        const hex = hexCss(powerUp.color)
        ctx.shadowColor = hex
        ctx.shadowBlur = 22
        ctx.fillStyle = 'rgba(8,8,10,0.82)'
        ctx.beginPath()
        ctx.arc(size / 2, size / 2, 108, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.strokeStyle = hex
        ctx.lineWidth = 12
        ctx.stroke()
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(size / 2, size / 2, 96, 0, Math.PI * 2)
        ctx.stroke()
        ctx.shadowColor = hex
        ctx.shadowBlur = 12
        drawPowerUpGlyph(ctx, powerUp.id, size / 2, size / 2 - 4, 70, hex)
        return keep(new THREE.SpriteMaterial({ map: canvasTexture(el), transparent: true, depthWrite: false }))
    })
}

/**
 * The floor drop: a holographic icon (a billboard, so it reads whatever the
 * game tumbles the group to) inside a tumbling crystal cage, with a halo.
 */
export function buildPowerUp(powerUp: CallOfXenoPowerUp): PowerUpModel {
    const group = new THREE.Group()

    const cageMat = memo(`powerup-cage:${powerUp.color}`, () => keep(new THREE.MeshBasicMaterial({
        color: powerUp.color,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    })))
    const coreMat = memo(`powerup-core:${powerUp.color}`, () => keep(new THREE.MeshBasicMaterial({ color: powerUp.color, transparent: true, opacity: 0.85 })))
    const ringMat = memo(`powerup-ring:${powerUp.color}`, () => keep(new THREE.MeshBasicMaterial({
        color: powerUp.color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    })))

    const cage = new THREE.Mesh(memo('powerup-cage-geo', () => keep(new THREE.OctahedronGeometry(0.42, 0))), cageMat)
    group.add(cage)
    const inner = new THREE.Mesh(memo('powerup-inner-geo', () => keep(new THREE.OctahedronGeometry(0.11, 0))), coreMat)
    group.add(inner)
    const ringGeo = memo('powerup-ring-geo', () => keep(new THREE.TorusGeometry(0.4, 0.014, 5, 32)))
    for (const [rx, ry] of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2]] as const) {
        const ring = new THREE.Mesh(ringGeo, ringMat)
        ring.rotation.set(rx, ry, 0)
        group.add(ring)
    }

    const icon = new THREE.Sprite(powerUpIconMaterial(powerUp))
    icon.scale.set(0.9, 0.9, 1)
    icon.renderOrder = 3
    group.add(icon)

    const halo = new THREE.Sprite(haloMaterial(powerUp.color, 0.55))
    halo.scale.set(2.3, 2.3, 1)
    halo.renderOrder = 2
    group.add(halo)

    const light = new THREE.PointLight(powerUp.color, 4, 7, 2)
    group.add(light)

    return { group, light }
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

/** Glowing plasma bolt: white-hot core inside a coloured shell and halo. */
export function buildProjectile(color: number): THREE.Mesh {
    const shell = memo(`bolt-shell:${color}`, () => keep(new THREE.MeshBasicMaterial({ color })))
    const hot = memo('bolt-hot', () => keep(new THREE.MeshBasicMaterial({ color: 0xffffff })))
    const mesh = new THREE.Mesh(memo('bolt-shell-geo', () => keep(new THREE.IcosahedronGeometry(0.16, 1))), shell)
    const core = new THREE.Mesh(memo('bolt-core-geo', () => keep(new THREE.IcosahedronGeometry(0.09, 1))), hot)
    mesh.add(core)
    const halo = new THREE.Sprite(haloMaterial(color, 0.75))
    halo.scale.set(1.1, 1.1, 1)
    mesh.add(halo)
    return mesh
}

/** A small brass-and-lead round, nose along +Y (the game aligns +Y to velocity). */
export function buildBulletProjectile(): THREE.Mesh {
    const s = S()
    const geo = memo('bullet-geo', () => {
        const casing = new THREE.CylinderGeometry(0.03, 0.03, 0.07, 8)
        casing.translate(0, -0.03, 0)
        const nose = new THREE.LatheGeometry(
            [[0.03, 0], [0.028, 0.02], [0.02, 0.045], [0.009, 0.062], [0.001, 0.07]].map(([r, y]) => new THREE.Vector2(r, y)),
            8
        )
        nose.translate(0, 0.005, 0)
        return keep(mergeGeometries([casing.toNonIndexed(), nose.toNonIndexed()].map((g) => {
            for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRIBUTES.has(name)) g.deleteAttribute(name)
            return g
        }), false)!)
    })
    const mesh = new THREE.Mesh(geo, s.brass)
    const tail = new THREE.Mesh(memo('bullet-tail-geo', () => keep(new THREE.ConeGeometry(0.026, 0.3, 6, 1, true))), memo('bullet-tail-mat', () => keep(new THREE.MeshBasicMaterial({
        color: 0xffc46b,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    }))))
    tail.position.y = -0.22
    tail.rotation.x = Math.PI
    mesh.add(tail)
    return mesh
}

// ---------------------------------------------------------------------------
// Workbench
// ---------------------------------------------------------------------------

function pegboardTexture() {
    return memo('bench-pegboard', () => {
        const rand = rng(9)
        const W = 512
        const H = 308
        const { el, ctx } = makeCanvas(W, H)
        ctx.fillStyle = '#3d4438'
        ctx.fillRect(0, 0, W, H)
        for (let y = 12; y < H; y += 18) {
            for (let x = 12; x < W; x += 18) {
                ctx.fillStyle = 'rgba(0,0,0,0.6)'
                ctx.beginPath()
                ctx.arc(x, y, 2.6, 0, Math.PI * 2)
                ctx.fill()
            }
        }
        // Painted tool outlines: hammer, wrench, saw, pliers.
        ctx.strokeStyle = 'rgba(240,240,230,0.5)'
        ctx.lineWidth = 3
        ctx.strokeRect(50, 50, 16, 150)
        ctx.strokeRect(30, 40, 56, 30)
        ctx.beginPath()
        ctx.roundRect(140, 60, 22, 170, 6)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(151, 60, 20, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(230, 60)
        ctx.lineTo(400, 60)
        ctx.lineTo(400, 110)
        ctx.lineTo(230, 90)
        ctx.closePath()
        ctx.stroke()
        for (let x = 240; x < 400; x += 12) {
            ctx.beginPath()
            ctx.moveTo(x, 90 - (x - 230) / 170 * 30 + 0)
            ctx.lineTo(x + 6, 98 - (x - 230) / 170 * 30)
            ctx.stroke()
        }
        ctx.beginPath()
        ctx.moveTo(440, 60)
        ctx.lineTo(430, 220)
        ctx.moveTo(470, 60)
        ctx.lineTo(480, 220)
        ctx.stroke()
        // Grime.
        for (let i = 0; i < 900; i++) {
            ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)'
            ctx.fillRect(rand() * W, rand() * H, 2, 2)
        }
        const vg = ctx.createLinearGradient(0, 0, 0, H)
        vg.addColorStop(0, 'rgba(0,0,0,0)')
        vg.addColorStop(1, 'rgba(0,0,0,0.3)')
        ctx.fillStyle = vg
        ctx.fillRect(0, 0, W, H)
        return canvasTexture(el)
    })
}

function schematicTexture() {
    return memo('bench-schematic', () => {
        const { el, ctx } = makeCanvas(256, 176)
        ctx.fillStyle = '#4a4a4a'
        ctx.fillRect(0, 0, 256, 176)
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.lineWidth = 1
        for (let x = 0; x < 256; x += 16) {
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, 176)
            ctx.stroke()
        }
        for (let y = 0; y < 176; y += 16) {
            ctx.beginPath()
            ctx.moveTo(0, y)
            ctx.lineTo(256, y)
            ctx.stroke()
        }
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 3
        // Tripod turret, drone, singularity: the three things the bench builds.
        ctx.beginPath()
        ctx.moveTo(40, 130)
        ctx.lineTo(56, 80)
        ctx.lineTo(72, 130)
        ctx.moveTo(56, 80)
        ctx.lineTo(56, 60)
        ctx.moveTo(44, 60)
        ctx.lineTo(90, 60)
        ctx.stroke()
        ctx.beginPath()
        ctx.ellipse(128, 90, 26, 10, 0, 0, Math.PI * 2)
        ctx.moveTo(90, 68)
        ctx.lineTo(166, 68)
        ctx.moveTo(128, 80)
        ctx.lineTo(128, 68)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(208, 96, 14, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.ellipse(208, 96, 34, 12, -0.3, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#ffffff'
        ctx.font = `14px ${HEAVY}`
        ctx.fillText('SENTRY', 30, 150)
        ctx.fillText('DRONE', 106, 150)
        ctx.fillText('HOLE', 190, 150)
        ctx.fillRect(16, 14, 110, 8)
        ctx.fillRect(16, 28, 70, 5)
        return canvasTexture(el)
    })
}

/** The Workshop bench: heavy table, vice, tool wall, work lamp and a blueprint screen. */
export function buildWorkbench(): PropModel {
    const s = S()
    const group = new THREE.Group()

    const body = buildKit('workbench', (k) => {
        // Top and frame.
        k.box(1.6, 0.1, 1.0, s.woodMat, 0, 0.95, 0)
        k.box(1.64, 0.045, 1.04, s.steelDark, 0, 0.89, 0)
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) k.box(0.09, 0.9, 0.09, s.steel, 0.7 * sx, 0.45, 0.42 * sz)
        }
        k.box(1.4, 0.05, 0.8, s.woodDark, 0, 0.27, 0)
        k.strut([-0.7, 0.3, 0.42], [-0.7, 0.85, -0.42], 0.018, s.steel, 5)
        k.strut([0.7, 0.3, 0.42], [0.7, 0.85, -0.42], 0.018, s.steel, 5)
        // Drawer unit on the right, with handles.
        k.box(0.5, 0.55, 0.86, s.orange, 0.47, 0.6, 0)
        for (let i = 0; i < 3; i++) {
            k.box(0.46, 0.15, 0.02, s.steelDark, 0.47, 0.42 + i * 0.17, 0.44)
            k.box(0.22, 0.025, 0.03, s.chrome, 0.47, 0.44 + i * 0.17, 0.46)
        }
        // Toolbox and parts crate on the lower shelf.
        k.rbox(0.5, 0.2, 0.28, 0.02, s.red, -0.35, 0.4, 0.05)
        k.box(0.3, 0.02, 0.03, s.chrome, -0.35, 0.52, 0.05)
        k.box(0.36, 0.14, 0.26, s.olive, -0.2, 0.37, -0.22)

        // Vice on the left corner.
        k.box(0.24, 0.18, 0.2, s.steel, -0.55, 1.1, 0.3)
        k.box(0.1, 0.1, 0.16, s.chrome, -0.68, 1.1, 0.3)
        k.cyl(0.03, 0.03, 0.3, 8, s.chrome, -0.55, 1.1, 0.44, { rx: Math.PI / 2 })
        k.strut([-0.55, 1.1, 0.58], [-0.55 + 0.09, 1.1 + 0.05, 0.58 + 0.01], 0.014, s.chrome, 5)

        // Bench clutter: ammo cans and a stripped receiver.
        k.box(0.3, 0.16, 0.18, s.olive, 0.12, 1.08, 0.26)
        k.box(0.3, 0.13, 0.18, s.olive, 0.12, 1.22, 0.26)
        k.box(0.32, 0.03, 0.1, s.chrome, 0.12, 1.3, 0.26)
        k.box(0.46, 0.06, 0.08, s.steelDark, 0.2, 1.03, -0.06, { ry: 0.25 })
        k.cyl(0.018, 0.018, 0.34, 8, s.chrome, 0.44, 1.03, -0.16, { rz: Math.PI / 2, ry: 0.25 })
        k.box(0.08, 0.14, 0.05, s.steel, 0.02, 0.97, -0.1)
        k.box(0.18, 0.05, 0.05, s.brass, 0.32, 1.005, 0.1)

        // Tool wall: uprights, pegboard, and real tools hung on it.
        for (const sx of [-1, 1]) k.box(0.06, 2.1, 0.06, s.steel, 0.8 * sx, 1.05, -0.5)
        k.box(1.66, 0.06, 0.06, s.steel, 0, 2.08, -0.5)
        // Hammer.
        k.box(0.035, 0.34, 0.03, s.woodMat, -0.55, 1.62, -0.44)
        k.box(0.13, 0.06, 0.05, s.steel, -0.55, 1.83, -0.44)
        // Wrench.
        k.box(0.04, 0.3, 0.025, s.chrome, -0.3, 1.5, -0.44)
        k.cyl(0.05, 0.05, 0.025, 8, s.chrome, -0.3, 1.66, -0.44, { rx: Math.PI / 2 })
        // Saw.
        k.box(0.3, 0.07, 0.015, s.chrome, 0.05, 1.75, -0.445)
        k.box(0.08, 0.09, 0.03, s.woodDark, 0.23, 1.75, -0.44)
        // Pliers and screwdriver.
        k.box(0.03, 0.26, 0.025, s.red, 0.42, 1.5, -0.44, { rz: 0.08 })
        k.box(0.03, 0.26, 0.025, s.red, 0.46, 1.5, -0.44, { rz: -0.08 })
        k.box(0.025, 0.3, 0.025, s.orange, 0.6, 1.5, -0.44)
        k.box(0.012, 0.12, 0.012, s.chrome, 0.6, 1.27, -0.44)

        // Work lamp on the bench: base, arm, shade.
        k.cyl(0.07, 0.08, 0.03, 10, s.steelDark, 0.62, 1.015, -0.3)
        k.strut([0.62, 1.03, -0.3], [0.5, 1.4, -0.22], 0.012, s.steel, 5)
        k.strut([0.5, 1.4, -0.22], [0.36, 1.5, -0.1], 0.012, s.steel, 5)
        k.add(new THREE.ConeGeometry(0.1, 0.13, 10, 1, true), s.orange, { x: 0.33, y: 1.47, z: -0.07, rx: -0.5, rz: 0.4 })

        // Hanging chains for the sign.
        for (const sx of [-1, 1]) k.strut([0.6 * sx, 2.08, -0.44], [0.6 * sx, 2.32, -0.42], 0.008, s.chrome, 4)
    }, group)
    hook(body)

    const pegboard = new THREE.Mesh(plane(1.5, 0.9), keep(new THREE.MeshStandardMaterial({ map: pegboardTexture(), roughness: 0.9 })))
    pegboard.position.set(0, 1.6, -0.47)
    group.add(pegboard)

    const sign = new THREE.Mesh(plane(1.3, 0.42), plateMaterial(plateTexture('bench', 512, 166, 'Workbench', 'equipment', '#ffd27a', '#0c0905', '#c98a2a'), 0.6))
    sign.position.set(0, 2.42, -0.41)
    group.add(sign)

    // The bench's lit things: an amber under-strip, the lamp bulb and a screen.
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb347 })
    const strip = new THREE.Mesh(memo('bench-strip', () => keep(new THREE.BoxGeometry(1.5, 0.04, 0.04))), glowMat)
    strip.position.set(0, 0.86, 0.51)
    group.add(strip)
    const bulb = new THREE.Mesh(memo('bench-bulb', () => keep(new THREE.SphereGeometry(0.035, 8, 6))), glowMat)
    bulb.position.set(0.34, 1.44, -0.08)
    group.add(bulb)
    const screenMat = new THREE.MeshBasicMaterial({ color: 0xffa726, map: schematicTexture() })
    const screen = new THREE.Mesh(plane(0.44, 0.3), screenMat)
    screen.position.set(-0.25, 1.28, -0.14)
    screen.rotation.x = -0.18
    group.add(screen)
    const monitor = new THREE.Mesh(memo('bench-monitor', () => keep(new RoundedBoxGeometry(0.5, 0.36, 0.07, 2, 0.02))), s.steelDark)
    monitor.position.set(-0.25, 1.28, -0.19)
    monitor.rotation.x = -0.18
    group.add(monitor)
    const stand = new THREE.Mesh(memo('bench-stand', () => keep(new THREE.CylinderGeometry(0.03, 0.05, 0.12, 8))), s.steel)
    stand.position.set(-0.25, 1.06, -0.19)
    group.add(stand)
    const spill = new THREE.Sprite(haloMaterial(0xffa726, 0.22))
    spill.scale.set(1.2, 1.2, 1)
    spill.position.set(0.35, 1.45, -0.05)
    group.add(spill)

    const light = new THREE.PointLight(0xf59e0b, 2, 5, 2)
    light.position.set(0, 1.3, 0.6)
    group.add(light)

    return { group, glow: [glowMat, screenMat], light }
}

// ---------------------------------------------------------------------------
// Sentry, escort drone, singularity, equipment drop
// ---------------------------------------------------------------------------

export interface SentryModel {
    group: THREE.Group
    /** Yaw-driven gun head, separate so the tripod stays planted. */
    head: THREE.Group
}

/** Tripod auto-turret: planted legs, powered base, a gun head that swivels. */
export function buildSentry(): SentryModel {
    const s = S()
    const group = new THREE.Group()

    buildKit('sentry', (k) => {
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2
            const dx = Math.sin(a)
            const dz = Math.cos(a)
            const top: V3 = [dx * 0.1, 0.84, dz * 0.1]
            const knee: V3 = [dx * 0.3, 0.48, dz * 0.3]
            const foot: V3 = [dx * 0.55, 0.03, dz * 0.55]
            k.strut(top, knee, 0.036, s.steel, 6)
            k.strut(knee, foot, 0.026, s.chrome, 6)
            k.sph(0.05, s.steelDark, knee[0], knee[1], knee[2], {}, 8, 6)
            k.cyl(0.07, 0.09, 0.03, 8, s.rubber, foot[0], 0.015, foot[2])
            // Hydraulic ram alongside the upper leg.
            k.strut([top[0] + dz * 0.05, top[1] - 0.06, top[2] - dx * 0.05], [knee[0] + dz * 0.05, knee[1] + 0.06, knee[2] - dx * 0.05], 0.012, s.chrome, 5)
        }
        // Hub, hazard band, battery pack and ammo can.
        k.cyl(0.17, 0.19, 0.16, 8, s.steelDark, 0, 0.86, 0)
        k.cyl(0.192, 0.192, 0.035, 8, s.hazard, 0, 0.8, 0)
        k.rbox(0.18, 0.15, 0.18, 0.015, s.orange, 0, 0.7, 0)
        k.rbox(0.2, 0.18, 0.12, 0.015, s.olive, -0.26, 0.82, 0)
        k.strut([-0.18, 0.86, 0], [-0.08, 0.95, 0], 0.012, s.rubber, 5)
        k.cyl(0.02, 0.02, 0.05, 6, s.ledGreen, 0.13, 0.8, 0.13)
    }, group)

    const head = new THREE.Group()
    head.position.y = 1.02
    buildKit('sentry-head', (k) => {
        k.cyl(0.08, 0.1, 0.08, 8, s.steelDark, 0, 0.04, 0)
        k.rbox(0.3, 0.22, 0.36, 0.03, s.paint, 0, 0.15, 0)
        k.rbox(0.32, 0.05, 0.2, 0.015, s.orange, 0, 0.27, 0.03)
        for (const sx of [-1, 1]) k.rbox(0.025, 0.16, 0.22, 0.01, s.orange, 0.165 * sx, 0.15, 0)
        // Twin barrels in a shroud, muzzle brakes.
        k.box(0.16, 0.14, 0.14, s.steelDark, 0, 0.14, -0.2)
        k.cyl(0.05, 0.05, 0.24, 8, s.steel, 0, 0.14, -0.36, { rx: Math.PI / 2 })
        for (const sx of [-1, 1]) {
            k.cyl(0.022, 0.022, 0.55, 8, s.steelDark, 0.045 * sx, 0.14, -0.5, { rx: Math.PI / 2 })
            k.cyl(0.033, 0.033, 0.06, 8, s.chrome, 0.045 * sx, 0.14, -0.79, { rx: Math.PI / 2 })
            k.cyl(0.036, 0.036, 0.02, 8, s.orange, 0.045 * sx, 0.14, -0.72, { rx: Math.PI / 2 })
        }
        // Ammo box and a belt of brass rounds feeding the breech.
        k.rbox(0.13, 0.13, 0.18, 0.012, s.olive, 0.21, 0.21, 0.07)
        const belt: V3[] = [[0.17, 0.17, 0.0], [0.12, 0.13, -0.04], [0.08, 0.12, -0.08], [0.05, 0.13, -0.12]]
        for (const [bx, by, bz] of belt) k.box(0.028, 0.02, 0.05, s.brass, bx, by, bz, { ry: 0.5 })
        // Sensor dome and whip antenna.
        k.add(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), s.steelDark, { y: 0.26, z: 0.1 })
        k.strut([-0.12, 0.26, 0.1], [-0.13, 0.55, 0.12], 0.006, s.chrome, 4)
        k.cyl(0.02, 0.02, 0.05, 6, s.ledGreen, -0.1, 0.26, 0.15)
    }, head)
    const eye = new THREE.Mesh(memo('sentry-eye', () => keep(new THREE.SphereGeometry(0.035, 8, 6))), s.eyeRed)
    eye.position.set(0, 0.2, -0.185)
    head.add(eye)
    const tip = new THREE.Mesh(memo('sentry-tip', () => keep(new THREE.SphereGeometry(0.014, 6, 4))), s.eyeRed)
    tip.position.set(-0.13, 0.55, 0.12)
    head.add(tip)
    group.add(head)
    hook(head.children.find(c => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined)

    return { group, head }
}

export interface CompanionDroneModel {
    group: THREE.Group
    rotor: THREE.Object3D
    muzzle: THREE.Object3D
}

/** Player-flavoured escort: sleek hull, cyan sensor, ducted pods, under-slung gun. */
export function buildCompanionDrone(): CompanionDroneModel {
    const s = S()
    const group = new THREE.Group()
    const shell = memo('drone-shell', () => {
        const m = s.paint.clone()
        m.color.setHex(0x55697f)
        m.roughness = 0.35
        m.metalness = 0.6
        return keep(m)
    })

    buildKit('drone', (k) => {
        k.sph(1, shell, 0, 0, 0, { sx: 0.23, sy: 0.085, sz: 0.32 }, 16, 10)
        k.sph(1, s.steelDark, 0, 0.07, -0.05, { sx: 0.12, sy: 0.06, sz: 0.15 }, 12, 8)
        k.box(0.2, 0.035, 0.28, s.steelDark, 0, -0.09, 0)
        k.cyl(0.02, 0.02, 0.1, 6, s.steelDark, 0, 0.14, 0)
        for (const sx of [-1, 1]) {
            // Ducted pods on stub arms.
            k.box(0.16, 0.03, 0.06, s.steelDark, 0.17 * sx, 0.03, 0)
            k.cyl(0.055, 0.055, 0.3, 10, s.steelDark, 0.3 * sx, 0, -0.02, { rx: Math.PI / 2 })
            k.add(new THREE.TorusGeometry(0.058, 0.012, 6, 14), s.chrome, { x: 0.3 * sx, z: 0.14 })
            k.cyl(0.045, 0.045, 0.01, 12, s.cyanGlow, 0.3 * sx, 0, 0.145, { rx: Math.PI / 2 })
            k.box(0.012, 0.012, 0.24, s.cyanGlow, 0.2 * sx, 0.055, 0)
            // Landing skids.
            k.strut([0.16 * sx, -0.07, 0.15], [0.2 * sx, -0.19, 0.2], 0.008, s.chrome, 4)
            k.strut([0.16 * sx, -0.07, -0.12], [0.2 * sx, -0.19, -0.18], 0.008, s.chrome, 4)
            k.strut([0.2 * sx, -0.19, 0.2], [0.2 * sx, -0.19, -0.18], 0.008, s.chrome, 4)
        }
        // Sensor lens with chrome bezel, antenna.
        k.sph(0.045, s.cyanGlow, 0, 0.02, 0.29, {}, 10, 8)
        k.add(new THREE.TorusGeometry(0.05, 0.01, 6, 14), s.chrome, { y: 0.02, z: 0.285 })
        k.strut([0.1, 0.09, -0.2], [0.16, 0.3, -0.28], 0.006, s.chrome, 4)
        k.sph(0.014, s.cyanGlow, 0.16, 0.3, -0.28, {}, 6, 4)
        for (let i = 0; i < 3; i++) k.box(0.14, 0.008, 0.012, s.black, 0, 0.05 - 0.0, -0.22 + i * 0.03)
    }, group)

    const rotor = new THREE.Group()
    rotor.position.y = 0.2
    buildKit('drone-rotor', (k) => {
        k.cyl(0.035, 0.045, 0.05, 8, s.steelDark, 0, 0, 0)
        for (let i = 0; i < 2; i++) {
            k.box(0.8, 0.012, 0.06, s.rubber, 0, 0.02, 0, { ry: (i / 2) * Math.PI })
            k.box(0.05, 0.016, 0.062, s.cyanGlow, 0.38, 0.02, 0, { ry: (i / 2) * Math.PI })
            k.box(0.05, 0.016, 0.062, s.cyanGlow, -0.38, 0.02, 0, { ry: (i / 2) * Math.PI })
        }
    }, rotor)
    const disc = new THREE.Mesh(memo('drone-disc', () => keep(new THREE.CircleGeometry(0.42, 24))), s.disc)
    disc.rotation.x = -Math.PI / 2
    disc.position.y = 0.005
    rotor.add(disc)
    group.add(rotor)

    const under = new THREE.Sprite(haloMaterial(0x38bdf8, 0.45))
    under.scale.set(0.8, 0.8, 1)
    under.position.y = -0.12
    group.add(under)

    const muzzle = new THREE.Group()
    muzzle.position.set(0, -0.11, 0.1)
    buildKit('drone-gun', (k) => {
        k.rbox(0.06, 0.07, 0.2, 0.01, s.steelDark, 0, 0, 0)
        k.cyl(0.016, 0.016, 0.24, 6, s.steel, 0, 0, 0.18, { rx: Math.PI / 2 })
        k.cyl(0.024, 0.024, 0.04, 6, s.cyanGlow, 0, 0, 0.29, { rx: Math.PI / 2 })
    }, muzzle)
    group.add(muzzle)

    return { group, rotor, muzzle }
}

export interface BlackHoleModel {
    group: THREE.Group
    core: THREE.Mesh
    ring: THREE.Mesh
    light: THREE.PointLight
}

/**
 * The floor drop for workbench equipment: a banded supply case with a glowing
 * seam in the unit's colour, a stencilled icon and a halo, so it reads as
 * "pick me up" next to a power-up.
 */
function equipmentIconMaterial(equipment: CallOfXenoEquipment) {
    return memo(`equip-icon:${equipment.id}`, () => {
        const { el, ctx } = makeCanvas(256, 192)
        ctx.strokeStyle = 'rgba(250,250,240,0.92)'
        ctx.fillStyle = 'rgba(250,250,240,0.92)'
        ctx.lineWidth = 10
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        if (equipment.id === 'sentry') {
            ctx.beginPath()
            ctx.moveTo(70, 170)
            ctx.lineTo(128, 105)
            ctx.lineTo(186, 170)
            ctx.moveTo(128, 105)
            ctx.lineTo(128, 80)
            ctx.stroke()
            ctx.fillRect(96, 44, 62, 36)
            ctx.fillRect(158, 54, 66, 10)
        } else if (equipment.id === 'drone') {
            ctx.beginPath()
            ctx.ellipse(128, 110, 54, 22, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.beginPath()
            ctx.moveTo(48, 70)
            ctx.lineTo(208, 70)
            ctx.moveTo(128, 90)
            ctx.lineTo(128, 70)
            ctx.stroke()
            ctx.fillRect(112, 134, 32, 12)
        } else {
            ctx.beginPath()
            ctx.arc(128, 96, 26, 0, Math.PI * 2)
            ctx.fill()
            ctx.lineWidth = 8
            ctx.beginPath()
            ctx.ellipse(128, 96, 76, 26, -0.35, 0, Math.PI * 2)
            ctx.stroke()
            ctx.lineWidth = 5
            ctx.beginPath()
            ctx.ellipse(128, 96, 96, 40, -0.35, 0.4, Math.PI * 1.3)
            ctx.stroke()
        }
        return keep(new THREE.MeshBasicMaterial({ map: canvasTexture(el), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
    })
}

export function buildEquipmentDrop(equipment: CallOfXenoEquipment): { group: THREE.Group, light: THREE.PointLight } {
    const s = S()
    const group = new THREE.Group()
    const band = memo(`equip-band:${equipment.color}`, () => keep(new THREE.MeshBasicMaterial({ color: equipment.color })))

    buildKit(`equip-drop:${equipment.color}`, (k) => {
        k.rbox(0.44, 0.22, 0.34, 0.025, s.olive, 0, -0.1, 0)
        k.rbox(0.46, 0.1, 0.36, 0.025, s.olive, 0, 0.07, 0)
        k.box(0.462, 0.04, 0.362, band, 0, -0.01, 0)
        // Latches, corner guards and a carry handle.
        for (const sx of [-1, 1]) {
            k.box(0.05, 0.11, 0.02, s.chrome, 0.13 * sx, -0.01, 0.18)
            k.box(0.03, 0.2, 0.36, s.steelDark, 0.215 * sx, -0.02, 0)
        }
        k.add(new THREE.TorusGeometry(0.06, 0.012, 6, 10, Math.PI), s.chrome, { y: 0.12, rz: 0 })
    }, group)

    const lid = new THREE.Mesh(plane(0.3, 0.22), equipmentIconMaterial(equipment))
    lid.rotation.x = -Math.PI / 2
    lid.position.y = 0.122
    group.add(lid)

    const halo = new THREE.Sprite(haloMaterial(equipment.color, 0.5))
    halo.scale.set(1.6, 1.6, 1)
    group.add(halo)

    const light = new THREE.PointLight(equipment.color, 3, 6, 2)
    group.add(light)

    return { group, light }
}

/** The singularity: a void sphere in a swirling accretion disc, with lensing halo and jets. */
export function buildBlackHole(): BlackHoleModel {
    const s = S()
    const group = new THREE.Group()

    const core = new THREE.Mesh(
        memo('hole-core', () => keep(new THREE.SphereGeometry(0.55, 24, 16))),
        memo('hole-core-mat', () => keep(new THREE.MeshBasicMaterial({ color: 0x000000 })))
    )
    group.add(core)

    // Photon ring hugging the horizon.
    const photon = new THREE.Mesh(
        memo('hole-photon', () => keep(new THREE.TorusGeometry(0.6, 0.03, 8, 48))),
        memo('hole-photon-mat', () => keep(new THREE.MeshBasicMaterial({ color: 0xf1e2ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })))
    )
    photon.rotation.x = Math.PI / 2
    group.add(photon)

    // The disc lies flat; the game spins it about its own normal (rotation.z).
    const ring = new THREE.Mesh(
        memo('hole-disc', () => keep(new THREE.RingGeometry(0.7, 1.7, 64, 1))),
        memo('hole-disc-mat', () => keep(new THREE.MeshBasicMaterial({
            map: s.accretionTex,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            opacity: 0.95
        })))
    )
    ring.rotation.x = Math.PI / 2 - 0.3 // a slight tilt, so the disc never goes edge-on at eye level
    group.add(ring)

    // Slow counter-tilted echo of the disc for depth.
    const echo = new THREE.Mesh(ring.geometry, memo('hole-echo-mat', () => keep(new THREE.MeshBasicMaterial({
        map: s.accretionTex,
        color: 0x8a5cff,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    }))))
    echo.rotation.set(Math.PI / 2 + 0.35, 0.3, 0)
    echo.scale.setScalar(0.8)
    group.add(echo)

    // Polar jets: crossed soft shafts up and down.
    const jetGeo = memo('hole-jet', () => keep(new THREE.PlaneGeometry(0.5, 3.4)))
    const jetMat = memo('hole-jet-mat', () => keep(new THREE.MeshBasicMaterial({
        color: 0xb58cff,
        map: s.beamTex,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    })))
    for (const ry of [0, Math.PI / 2]) {
        const up = new THREE.Mesh(jetGeo, jetMat)
        up.position.y = 1.8
        up.rotation.y = ry
        const down = new THREE.Mesh(jetGeo, jetMat)
        down.position.y = -1.8
        down.rotation.set(Math.PI, ry, 0)
        group.add(up, down)
    }

    const halo = new THREE.Sprite(haloMaterial(0x7c3aed, 0.6))
    halo.scale.set(4.2, 4.2, 1)
    group.add(halo)

    const light = new THREE.PointLight(0xa855f7, 5, 16, 2)
    group.add(light)

    return { group, core, ring, light }
}
