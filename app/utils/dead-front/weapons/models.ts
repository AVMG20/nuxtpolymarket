import * as THREE from 'three'
import { DF_PAP_COLORS } from '#shared/utils/dead-front/weapons'
import type { DfAttachmentChoice, DfWeaponId } from '#shared/utils/dead-front/types'
import { dfModelGeometry, dfModelObject } from '../models'
import { dfDotTexture, dfOwnedGlowMat, dfPapMat, dfReticleTexture, dfTickPap, dfWeaponMat } from './materials'
import { DF_XRAY_SCHEMES } from './xray'
import type { DfVoxMaterial } from '../voxel/material'

// 1900s weapons in the comic style, built in Blender
// (`scripts/dead-front-models/weapons.py` -> `public/dead-front/models/weapons.glb`).
// A gun is one top-level node, origin at the right-hand grip, x right, y up,
// muzzle toward -z, metres. Under it:
//   <id>-<part>[@cond]      a group of meshes; its origin is the part's pivot
//   <id>-m-<marker>[@cond]  an empty: muzzle, sight, front, eject, dot0/1, scope0/1
// Parts are main and the moving ones (slide, bolt, pump, magazine, pan, barrel,
// lever). `cond` picks the variant for the fitted attachments and Pack-a-Punch
// (see `holds`). The sights, muzzle and ejection port come from the markers, so
// they sit on the modelled sights. Pack-a-Punch recolours the vertices by the
// finish their material name carries; what a gun does (reload style, action)
// is the table below.

export type DfReloadStyle = 'mag' | 'side' | 'top' | 'stripper' | 'shell' | 'capsule' | 'coil' | 'break' | 'fuel'

/** What moves between shots: a turned bolt, a lever (with the bolt riding it), or nothing. */
export type DfCycleAction = 'bolt' | 'lever' | null

export interface DfGunRig {
    id: DfWeaponId
    root: THREE.Group
    muzzle: THREE.Object3D
    /** The rear sight (notch top / scope eyepiece) on the sight line, gun space. ADS puts it on the camera axis. */
    sight: THREE.Vector3
    /** The front sight (post or bead top / scope objective) on the same sight line. */
    sightFront: THREE.Vector3
    /** Metres from the eye to `sight` while aiming. */
    eyeRelief: number
    /** Left (support) hand rest position, gun space. */
    left: THREE.Vector3
    /** Ejection port, gun space. */
    eject: THREE.Vector3
    slide: THREE.Object3D | null
    bolt: THREE.Object3D | null
    pump: THREE.Object3D | null
    mag: THREE.Object3D | null
    pan: THREE.Object3D | null
    /** Break actions: the barrel group (barrels, top strap, cylinder) that tips open on its hinge. */
    barrel: THREE.Object3D | null
    /** Lever actions: the finger lever, turning about its pivot. */
    lever: THREE.Object3D | null
    /** The per-shot cycle the viewmodel plays. */
    cycle: DfCycleAction
    /** Axis the pan turns about per shot: 'y' a Lewis pan on top, 'z' a revolver cylinder. */
    panSpin: 'y' | 'z'
    /** Chambers in a revolver cylinder (its turn per shot); 0 for a pan (turns by the magazine size). */
    chambers: number
    /** The magazine part only shows while reloading (speedloader, loose shells). */
    magHidden: boolean
    /** A flamethrower lance: no flash star or casings, a jet of fire and a pilot flame. */
    flame: boolean
    /** Glow material pulsed by the viewmodel (X-Ray, wonder weapon). */
    glow: DfVoxMaterial | null
    reload: DfReloadStyle
    /** Feeds from a drum: the reload plays the drum's wind and clatter. */
    drum: boolean
    scoped: boolean
    lens: THREE.Mesh | null
    long: boolean
}

/** One grid cell of the authoring grid (the lens and pilot offsets are in cells). */
const CELL = 0.011

function has(att: DfAttachmentChoice, slot: keyof DfAttachmentChoice, word: string): boolean {
    return (att[slot] ?? '').includes(word)
}

interface Meta {
    eyeRelief: number
    left: [number, number, number]
    long: boolean
    reload: DfReloadStyle | ((att: DfAttachmentChoice) => DfReloadStyle)
    cycle?: DfCycleAction
    /** A revolver: the pan is its cylinder, turning about the bore by one of this many chambers a shot. */
    chambers?: number
    magHidden?: boolean
    flame?: boolean
    glow?: boolean
    drum?: (att: DfAttachmentChoice) => boolean
}

const PISTOL_LEFT: [number, number, number] = [-0.025, -0.02, -0.03]

const META: Record<DfWeaponId, Meta> = {
    m1911: { eyeRelief: 0.3, left: PISTOL_LEFT, long: false, reload: 'mag' },
    c96: { eyeRelief: 0.32, left: PISTOL_LEFT, long: false, reload: att => has(att, 'magazine', 'box') ? 'mag' : 'stripper' },
    m1897: { eyeRelief: 0.3, left: [-0.012, 0, -0.4], long: true, reload: 'shell' },
    kar98k: { eyeRelief: 0.3, left: [-0.02, -0.005, -0.36], long: true, reload: att => has(att, 'magazine', 'trench') ? 'mag' : 'stripper', cycle: 'bolt' },
    thompson: { eyeRelief: 0.26, left: [-0.012, -0.04, -0.33], long: true, reload: 'mag', drum: att => has(att, 'magazine', 'drum') },
    mp18: { eyeRelief: 0.31, left: [-0.015, 0.005, -0.27], long: true, reload: 'side' },
    ppsh: { eyeRelief: 0.3, left: [-0.015, 0.008, -0.32], long: true, reload: 'mag', drum: att => !has(att, 'magazine', 'box') },
    bar: { eyeRelief: 0.24, left: [-0.02, -0.025, -0.42], long: true, reload: 'mag' },
    lewis: { eyeRelief: 0.28, left: [-0.03, -0.035, -0.3], long: true, reload: 'top' },
    webley: { eyeRelief: 0.32, left: PISTOL_LEFT, long: false, reload: 'break', chambers: 6, magHidden: true },
    sawnoff: { eyeRelief: 0.3, left: [-0.012, -0.015, -0.24], long: true, reload: 'break', magHidden: true },
    win1895: { eyeRelief: 0.34, left: [-0.02, -0.005, -0.36], long: true, reload: att => has(att, 'magazine', 'box') ? 'mag' : 'stripper', cycle: 'lever' },
    chauchat: { eyeRelief: 0.28, left: [-0.02, -0.04, -0.36], long: true, reload: 'mag' },
    flammen: { eyeRelief: 0.34, left: [-0.015, -0.03, -0.44], long: true, reload: 'fuel', flame: true },
    xray: { eyeRelief: 0.3, left: PISTOL_LEFT, long: false, reload: 'capsule', glow: true },
    granatwerfer: { eyeRelief: 0.34, left: [-0.02, -0.06, -0.3], long: true, reload: 'mag' },
    wunder: { eyeRelief: 0.3, left: [-0.02, 0.02, -0.33], long: true, reload: 'coil', glow: true }
}

/** Metres from the eye to a telescope's eyepiece. */
const SCOPE_RELIEF = 0.07

// ---------------------------------------------------------------- pack nodes

type PartName = 'main' | 'slide' | 'bolt' | 'pump' | 'mag' | 'pan' | 'barrel' | 'lever'

interface Node {
    /** A part name, or `m-<marker>`. */
    name: string
    terms: string[]
    obj: THREE.Object3D
}

/** `slot=word` (that slot's attachment contains the word), `pap`, or either negated with `!`. */
function holds(term: string, att: DfAttachmentChoice, tier: number): boolean {
    const neg = term.startsWith('!')
    const t = neg ? term.slice(1) : term
    let on = false
    if (t === 'pap') on = tier > 0
    else {
        const [slot, word] = t.split('=')
        on = !!slot && !!word && has(att, slot as keyof DfAttachmentChoice, word)
    }
    return on !== neg
}

const nodeCache = new Map<string, Node[]>()

function nodesOf(id: DfWeaponId, top: THREE.Object3D): Node[] {
    let list = nodeCache.get(id)
    if (list) return list
    list = []
    const prefix = `${id}-`
    for (const obj of top.children) {
        if (!obj.name.startsWith(prefix)) continue
        const [name, cond] = obj.name.slice(prefix.length).split('@')
        list.push({ name: name!, terms: cond ? cond.split('&') : [], obj })
    }
    nodeCache.set(id, list)
    return list
}

// ---------------------------------------------------------------- geometry

/** The finish a material name carries: it drives the Pack-a-Punch recolour. */
type Finish = 'metal' | 'trim' | 'wood' | 'brass' | 'glow' | 'other'

function finishOf(name: string, glow: number): Finish {
    if (glow > 0) return 'glow'
    if (name === 'steel-hi') return 'trim'
    if (name.startsWith('steel') || name === 'park' || name === 'black') return 'metal'
    if (name.startsWith('wood') || name === 'bakelite' || name === 'vulcan') return 'wood'
    if (name === 'brass' || name === 'copper' || name === 'coil') return 'brass'
    return 'other'
}

interface PartGeo {
    geo: THREE.BufferGeometry
    /** Material names, and each vertex's index into them. */
    mats: string[]
    vmat: Uint8Array
}

const partCache = new Map<string, PartGeo | null>()
const tmpM = new THREE.Matrix4()
const tmpN = new THREE.Matrix3()
const tmpV = new THREE.Vector3()
const tmpC = new THREE.Color()
const tmpE = new THREE.Color()

/** The groups' meshes merged into one toon-format geometry, relative to `pivot` in the gun's frame. */
function flatten(top: THREE.Object3D, groups: THREE.Object3D[], pivot: THREE.Vector3): PartGeo | null {
    const key = groups.map(g => g.name).join('|')
    if (partCache.has(key)) return partCache.get(key)!
    top.updateMatrixWorld(true)
    const inv = new THREE.Matrix4().copy(top.matrixWorld).invert()
    const shift = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)
    const pos: number[] = []
    const nor: number[] = []
    const col: number[] = []
    const glow: number[] = []
    const idx: number[] = []
    const vm: number[] = []
    const mats: string[] = []
    for (const grp of groups) {
        grp.traverse((o) => {
            const mesh = o as THREE.Mesh
            if (!mesh.isMesh || !mesh.geometry) return
            tmpM.multiplyMatrices(inv, mesh.matrixWorld).premultiply(shift)
            tmpN.getNormalMatrix(tmpM)
            const g = mesh.geometry
            const p = g.getAttribute('position')
            const n = g.getAttribute('normal')
            const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined
            const name = mat?.name ?? ''
            let mi = mats.indexOf(name)
            if (mi < 0) mi = mats.push(name) - 1
            tmpC.set(mat?.color ?? 0xffffff)
            let gl = 0
            if (mat?.emissive) {
                tmpE.copy(mat.emissive).multiplyScalar(mat.emissiveIntensity ?? 1)
                gl = Math.min(1, Math.max(tmpE.r, tmpE.g, tmpE.b))
            }
            const base = pos.length / 3
            for (let i = 0; i < p.count; i++) {
                tmpV.fromBufferAttribute(p, i).applyMatrix4(tmpM)
                pos.push(tmpV.x, tmpV.y, tmpV.z)
                if (n) {
                    tmpV.fromBufferAttribute(n, i).applyMatrix3(tmpN).normalize()
                    nor.push(tmpV.x, tmpV.y, tmpV.z)
                } else {
                    nor.push(0, 1, 0)
                }
                col.push(tmpC.r, tmpC.g, tmpC.b)
                glow.push(gl)
                vm.push(mi)
            }
            if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i))
            else for (let i = 0; i < p.count; i++) idx.push(base + i)
        })
    }
    let out: PartGeo | null = null
    if (pos.length) {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
        geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 1))
        geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1))
        out = { geo, mats, vmat: Uint8Array.from(vm) }
    }
    partCache.set(key, out)
    return out
}

/** A colour as its display (sRGB) values, the space the camo colours are mixed in. */
const shown = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace)

/**
 * Pack-a-Punch camo: the steel goes deep and tier-tinted (the material draws a
 * wavy damascus over it, `aPap`), bright steel fittings become glowing trim, the
 * wood turns to dark ebony and the brass takes a warm sheen of the tier colour.
 */
function papRecolor(part: PartGeo, geo: THREE.BufferGeometry, tier: number, glowToo: boolean): void {
    const hex = Number.parseInt(DF_PAP_COLORS[Math.max(1, Math.min(3, tier)) - 1]!.slice(1), 16)
    const tint = shown(hex)
    const dark = shown(hex).multiplyScalar(0.22)
    const trim = shown(hex).lerp(shown(0xffffff), 0.12)
    const ebony = shown(0x1a1216)
    const col = geo.getAttribute('color') as THREE.BufferAttribute
    const glow = geo.getAttribute('aGlow') as THREE.BufferAttribute
    const pap = new Float32Array(col.count)
    const c = new THREE.Color()
    for (let i = 0; i < col.count; i++) {
        const g = glow.getX(i)
        const f = finishOf(part.mats[part.vmat[i]!]!, g)
        if (f === 'other' || (f === 'glow' && !glowToo)) continue
        c.fromBufferAttribute(col, i).convertLinearToSRGB()
        if (f === 'glow') c.lerp(tint, 0.6)
        else if (f === 'trim') {
            c.copy(trim)
            glow.setX(i, 0.4)
        } else if (f === 'metal') {
            c.multiplyScalar(0.8).lerp(dark, 0.62)
            pap[i] = 1
        } else if (f === 'wood') c.lerp(ebony, 0.6).lerp(tint, 0.1)
        else {
            c.lerp(trim, 0.35)
            glow.setX(i, 0.2)
        }
        c.convertSRGBToLinear()
        col.setXYZ(i, c.r, c.g, c.b)
    }
    geo.setAttribute('aPap', new THREE.BufferAttribute(pap, 1))
}

/** X-Ray Pack-a-Punch: a whole new colour scheme per tier (core, glass, body, trim, grip). */
function xrayRecolor(part: PartGeo, geo: THREE.BufferGeometry, tier: number): void {
    const s = DF_XRAY_SCHEMES[Math.max(1, Math.min(3, tier))]!
    const to: Record<string, number> = { 'xray-core': s.core, 'xray-hot': s.hot, 'xray-glass': s.glass, 'brass': s.body, 'copper': s.trim, 'bakelite': s.grip }
    const col = geo.getAttribute('color') as THREE.BufferAttribute
    const c = new THREE.Color()
    for (let i = 0; i < col.count; i++) {
        const hex = to[part.mats[part.vmat[i]!]!]
        if (hex === undefined) continue
        c.set(hex)
        col.setXYZ(i, c.r, c.g, c.b)
    }
}

/** A geometry in the toon format for a pack model, or a plain box when the pack did not load. */
export function dfWeaponPackGeometry(name: string, size: [number, number, number], hex: number, glow = 0): THREE.BufferGeometry {
    return dfModelGeometry('weapons', name) ?? boxGeometry(size, hex, glow)
}

function boxGeometry(size: [number, number, number], hex: number, glow = 0): THREE.BufferGeometry {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2])
    const n = geo.getAttribute('position').count
    const c = new THREE.Color(hex)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1))
    geo.deleteAttribute('uv')
    return geo
}

// ---------------------------------------------------------------- rig

function buildRig(id: DfWeaponId, pap: number, attachments: DfAttachmentChoice): DfGunRig {
    const att = attachments ?? {}
    const meta = META[id]
    const root = new THREE.Group()
    root.name = `df-weapon-${id}`
    const tier = Math.max(0, Math.min(3, Math.floor(pap)))
    const glowMat = meta.glow ? dfOwnedGlowMat() : null
    const mat: THREE.Material = glowMat ?? (tier > 0 ? dfPapMat(tier) : dfWeaponMat())
    const top = dfModelObject('weapons', id)
    const nodes = top ? nodesOf(id, top).filter(n => n.terms.every(t => holds(t, att, tier))) : []

    const meshOf = (groups: THREE.Object3D[], pivot: THREE.Vector3): THREE.Mesh | null => {
        const part = top ? flatten(top, groups, pivot) : null
        if (!part) return null
        const geo = part.geo.clone()
        if (tier > 0) {
            if (id === 'xray') xrayRecolor(part, geo, tier)
            else papRecolor(part, geo, tier, id === 'wunder')
        }
        const me = new THREE.Mesh(geo, mat)
        if (tier > 0 && !glowMat) me.onBeforeRender = dfTickPap
        return me
    }
    const sub = (name: PartName): THREE.Object3D | null => {
        const groups = nodes.filter(n => n.name === name).map(n => n.obj)
        if (!groups.length) return null
        const me = meshOf(groups, groups[0]!.position)
        if (!me) return null
        if (name === 'main') {
            root.add(me)
            return me
        }
        const grp = new THREE.Group()
        grp.name = name
        grp.position.copy(groups[0]!.position)
        grp.add(me)
        root.add(grp)
        return grp
    }
    if (!sub('main')) {
        // the pack did not load: a plain block so the gun can still be held and fired
        root.add(new THREE.Mesh(boxGeometry([0.035, 0.05, meta.long ? 0.6 : 0.2], 0x46505f).translate(0, 0.04, meta.long ? -0.15 : -0.06), mat))
    }
    const slide = sub('slide')
    const bolt = sub('bolt')
    const pump = sub('pump')
    const pan = sub('pan')
    const barrel = sub('barrel')
    const lever = sub('lever')
    const mag = sub('mag') ?? pan
    // A break action carries its cylinder and its loader (or shells) as it tips open.
    if (barrel) {
        for (const o of [pan, mag]) {
            if (!o || o.parent === barrel) continue
            o.position.sub(barrel.position)
            barrel.add(o)
        }
    }
    if (mag && meta.magHidden) mag.visible = false

    /** A marker's position: of the variants that hold, the one with the most terms. */
    const mark = (name: string): THREE.Vector3 | null => {
        let best: Node | null = null
        for (const n of nodes) if (n.name === `m-${name}` && (!best || n.terms.length > best.terms.length)) best = n
        return best ? best.obj.position.clone() : null
    }
    const len = meta.long ? 0.5 : 0.16
    const muzzle = new THREE.Object3D()
    muzzle.position.copy(mark('muzzle') ?? new THREE.Vector3(0, 0.06, -len))
    root.add(muzzle)
    const dot0 = mark('dot0')
    const dot1 = mark('dot1')
    const scope0 = mark('scope0')
    const scope1 = mark('scope1')
    const scoped = !!(scope0 && scope1)
    const optic = scoped ? [scope0!, scope1!] : dot0 && dot1 ? [dot0, dot1] : null
    let lens: THREE.Mesh | null = null
    if (optic && !scoped) {
        // The red dot floats in the front glass; it only shows while aiming.
        const dm = new THREE.MeshBasicMaterial({ map: dfDotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
        dm.userData.dfOwned = true
        lens = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.03), dm)
        lens.position.copy(optic[0]!).setZ(optic[0]!.z + CELL * 0.5)
    } else if (optic) {
        const lm = new THREE.MeshBasicMaterial({ map: dfReticleTexture(), transparent: true, depthWrite: false, toneMapped: false })
        lm.userData.dfOwned = true
        lens = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), lm)
        lens.position.copy(optic[1]!).setZ(optic[1]!.z + CELL * 0.2)
    }
    if (lens) {
        lens.visible = false
        lens.renderOrder = 5
        root.add(lens)
    }
    // The sight line (6 o'clock hold): the top of the front post level with the tops of the
    // rear notch's ears, or the axis of the optic.
    const sightRear = optic ? optic[1]!.clone() : mark('sight') ?? new THREE.Vector3(0, 0.08, 0)
    const sightFront = optic ? optic[0]!.clone() : mark('front') ?? new THREE.Vector3(0, 0.08, -len)
    const r: DfGunRig = {
        id,
        root,
        muzzle,
        sight: sightRear,
        sightFront,
        eyeRelief: scoped ? SCOPE_RELIEF : meta.eyeRelief,
        left: new THREE.Vector3(meta.left[0], meta.left[1], id === 'm1897' && has(att, 'stock', 'sawn') ? -0.29 : meta.left[2]),
        eject: mark('eject') ?? new THREE.Vector3(CELL, 0.06, -0.05),
        slide,
        bolt,
        pump,
        mag,
        pan,
        barrel,
        lever,
        cycle: meta.cycle ?? null,
        panSpin: meta.chambers ? 'z' : 'y',
        chambers: meta.chambers ?? 0,
        magHidden: !!meta.magHidden,
        flame: !!meta.flame,
        glow: glowMat,
        reload: typeof meta.reload === 'function' ? meta.reload(att) : meta.reload,
        drum: !!meta.drum?.(att),
        scoped,
        lens,
        long: meta.long
    }
    for (const o of [r.slide, r.bolt, r.pump, r.mag, r.pan, r.barrel, r.lever]) {
        if (o) o.userData.rest = o.position.clone()
    }
    root.userData.dfSight = sightRear.clone()
    root.userData.dfSightFront = sightFront.clone()
    root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true
    })
    return r
}

export function dfBuildGunRig(id: DfWeaponId, pap = 0, attachments: DfAttachmentChoice = {}): DfGunRig {
    return buildRig(id, pap, attachments)
}

/**
 * World-space model (third-person hands, box float, pedestal, wall chalk,
 * armory preview). 1 unit = 1 metre, muzzle toward -z, origin at the grip.
 * Geometries belong to the group; materials are shared (do not dispose them).
 * Dispose with `disposeDfWeaponModel`.
 */
export function buildDfWeaponModelImpl(id: DfWeaponId, pap = 0, attachments: DfAttachmentChoice = {}): THREE.Group {
    const r = dfBuildGunRig(id, pap, attachments)
    if (r.lens) r.lens.visible = false
    r.root.userData.dfMuzzle = r.muzzle.position.clone()
    const glow = r.glow
    if (glow) {
        // Out of the hands (pedestal, box, armory) the coils breathe on their own.
        const main = r.root.children.find(o => (o as THREE.Mesh).isMesh) as THREE.Mesh | undefined
        const phase = Math.random() * 6
        if (main) main.onBeforeRender = () => {
            const t = performance.now() / 1000 + phase
            glow.userData.uGlow.value = 1.3 + 0.3 * Math.sin(t * 2.2) + (Math.random() < 0.03 ? 0.6 : 0)
        }
    }
    return r.root
}

/** Disposes a model's own geometries (and its few per-model materials); shared materials stay. */
export function disposeDfWeaponModel(group: THREE.Object3D): void {
    const owned = new Set<THREE.Material>()
    group.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.geometry.dispose()
        const mat = m.material as THREE.Material
        if (mat.userData.dfOwned) owned.add(mat)
    })
    for (const m of owned) m.dispose()
    group.removeFromParent()
}
