import * as THREE from 'three'
import { DF_ENEMIES } from '#shared/utils/dead-front/enemies'
import { dfHash3 } from '#shared/utils/dead-front/voxel'
import type { DfEnemyType } from '#shared/utils/dead-front/types'
import { DfVoxModel, scaleHex } from '../../voxel/model'

// Blocky zombies. Every type shares one skeleton laid out in voxel units
// (feet 0, knees 6, hips 12, shoulders 20, head 20.5..25.5) and its own
// widths, colours and details; the voxel size is chosen per type so the head
// centre (23 voxels) lands exactly on DF_ENEMIES.headY, which keeps the shared
// hit test honest. Parts are separate voxel models, each meshed with its pivot
// at its joint and tagged with a part index for the GPU rig (rig.ts).

export const DF_ZOMBIE_TYPES: DfEnemyType[] = ['shambler', 'ghoul', 'brute', 'bloater']
export const DF_ZOMBIE_OUTFITS = 2

export const P = {
    pelvis: 0,
    torso: 1,
    head: 2,
    armUL: 3,
    armLL: 4,
    armUR: 5,
    armLR: 6,
    legUL: 7,
    legLL: 8,
    legUR: 9,
    legLR: 10,
    helmet: 11,
    eyes: 12
} as const
export const DF_ZOMBIE_PARTS = 13

/** Joint layout in voxel units. */
const HIP = 12
const KNEE = 6
const SHOULDER = 20
const HEAD_CENTRE = 23

export interface DfZombieDims {
    /** Metres per voxel. */
    v: number
    hipY: number
    thigh: number
    shin: number
    /** Spine base above the hip joint. */
    spine: number
    /** Torso length from spine base to the neck. */
    torso: number
    /** Head joint above the neck (the head cube floats half a voxel up). */
    shoulderX: number
    shoulderY: number
    upperArm: number
    legX: number
    headR: number
}

export interface DfZombiePartModel {
    model: DfVoxModel
    /** Joint (pivot) in model voxel coordinates. */
    pivot: [number, number, number]
}

export interface DfZombieBuild {
    type: DfEnemyType
    outfit: number
    dims: DfZombieDims
    parts: (DfZombiePartModel | null)[]
}

interface Look {
    skin: number
    cloth: number
    trousers: number
    puttee: number
    boot: number
    eye: number
    torsoW: number
    torsoD: number
    pelvisW: number
    limb: number
    arm: number
    legGap: number
    shirtless?: boolean
    belly?: boolean
    armour?: boolean
}

function look(type: DfEnemyType, outfit: number): Look {
    switch (type) {
        case 'ghoul':
            return outfit
                ? { skin: 0xa3a690, cloth: 0x6b5f50, trousers: 0x3f3a33, puttee: 0x4f4a40, boot: 0x241c15, eye: 0xffd040, torsoW: 6, torsoD: 3, pelvisW: 5, limb: 2, arm: 2, legGap: 1.5, shirtless: true }
                : { skin: 0xb5b7a1, cloth: 0xa59d86, trousers: 0x48443b, puttee: 0x5a5548, boot: 0x2a2018, eye: 0xffd040, torsoW: 6, torsoD: 3, pelvisW: 5, limb: 2, arm: 2, legGap: 1.5 }
        case 'brute':
            return { skin: 0x7e8a6a, cloth: outfit ? 0x4b4636 : 0x3e4234, trousers: 0x3a372d, puttee: 0x4a473b, boot: 0x1e1812, eye: 0xff4a24, torsoW: 8, torsoD: 5, pelvisW: 7, limb: 3, arm: 3, legGap: 2, armour: true }
        case 'bloater':
            return { skin: outfit ? 0x8e9871 : 0x9a9c76, cloth: 0x5f5848, trousers: 0x4a4436, puttee: 0x5a5444, boot: 0x241c15, eye: 0xc8ff50, torsoW: 9, torsoD: 7, pelvisW: 8, limb: 3, arm: 2, legGap: 2, belly: true }
        default:
            return outfit
                ? { skin: 0x9aa184, cloth: 0x5f6650, trousers: 0x50574a, puttee: 0x5c5a4c, boot: 0x251d16, eye: 0xffb030, torsoW: 7, torsoD: 4, pelvisW: 6, limb: 3, arm: 2, legGap: 1.5 }
                : { skin: 0x8f9b7c, cloth: 0x6c7d94, trousers: 0x5f6e83, puttee: 0x575c63, boot: 0x251d16, eye: 0xffb030, torsoW: 7, torsoD: 4, pelvisW: 6, limb: 3, arm: 2, legGap: 1.5 }
    }
}

export function dfZombieDims(type: DfEnemyType): DfZombieDims {
    const def = DF_ENEMIES[type]
    const v = def.headY / HEAD_CENTRE
    const l = look(type, 0)
    return {
        v,
        hipY: HIP * v,
        thigh: (HIP - KNEE) * v,
        shin: KNEE * v,
        spine: 2 * v,
        torso: (SHOULDER - HIP - 2) * v,
        shoulderX: (l.torsoW / 2 + l.arm / 2) * v,
        shoulderY: (SHOULDER - HIP - 2 - 0.5) * v,
        upperArm: 5 * v,
        legX: l.legGap * v,
        headR: def.headR
    }
}

/** Grime: blood, dirt and the odd torn-away voxel. */
function worn(m: DfVoxModel, base: number, seed: number): (i: number, j: number, k: number) => number {
    const a = m.c(scaleHex(base, 1.08))
    const b = m.c(base)
    const c = m.c(scaleHex(base, 0.88))
    const blood = m.c(0x5e1712)
    const dirt = m.c(scaleHex(base, 0.62))
    return (i, j, k) => {
        const h = dfHash3(i, j, k, seed)
        if (h < 0.035) return blood
        if (h < 0.07) return dirt
        const g = dfHash3(i >> 1, j, k >> 1, seed + 1)
        return g < 0.3 ? a : g < 0.75 ? b : c
    }
}

/** Removes some surface voxels from the edges (rags, missing chunks). */
function tear(m: DfVoxModel, seed: number, p: number, keepBelow = -1): void {
    const { sx, sy, sz } = m.vox
    m.vox.map((_v, i, j, k) => {
        if (j <= keepBelow) return -1
        const edge = (i === 0 || i === sx - 1 ? 1 : 0) + (k === 0 || k === sz - 1 ? 1 : 0) + (j === 0 || j === sy - 1 ? 1 : 0)
        return edge >= 2 && dfHash3(i, j, k, seed) < p ? 0 : -1
    })
}

export function dfBuildZombie(type: DfEnemyType, outfit: number): DfZombieBuild {
    const L = look(type, outfit)
    const dims = dfZombieDims(type)
    const seed = outfit * 31 + type.length * 7
    const parts: (DfZombiePartModel | null)[] = new Array(DF_ZOMBIE_PARTS).fill(null)
    const skinFill = (m: DfVoxModel, s: number) => worn(m, L.skin, s)

    // ---------------------------------------------------------------- pelvis (hip joint at the bottom centre)
    {
        const w = L.pelvisW
        const d = L.torsoD
        const m = new DfVoxModel(w, 2, d)
        m.box(0, 0, 0, w, 2, d, worn(m, L.trousers, seed + 1))
        m.box(0, 1, 0, w, 2, d, m.c(0x3a2a1c))
        m.set(Math.floor(w / 2), 1, d - 1, m.c(0x8f7432))
        parts[P.pelvis] = { model: m, pivot: [w / 2, 0, d / 2] }
    }

    // ---------------------------------------------------------------- torso (spine base at the bottom centre)
    {
        const w = L.torsoW
        const d = L.torsoD
        const h = SHOULDER - HIP - 2 + 1 // + the neck stub row
        const m = new DfVoxModel(w, h, d)
        const cloth = worn(m, L.cloth, seed + 2)
        const skin = skinFill(m, seed + 3)
        m.box(0, 0, 0, w, h - 1, d, L.shirtless ? skin : cloth)
        const cx = Math.floor(w / 2)
        if (L.shirtless) {
            // Ribs showing through.
            const rib = m.c(0xd6cdb0)
            for (let j = 1; j < h - 2; j += 2) m.box(cx - 2, j, d - 1, cx + 2, j + 1, d, rib)
            m.box(cx, 0, d - 1, cx + 1, h - 1, d, m.c(0x6e2a20))
        } else {
            // Collar, buttons, belt straps, a gaping wound.
            m.box(cx - 1, h - 3, d - 1, cx + 1, h - 1, d, skin)
            for (let j = 1; j < h - 2; j += 2) m.set(cx, j, d - 1, m.c(0xa88a3e))
            m.box(0, 0, 0, w, 1, d, m.c(0x3a2a1c))
            m.box(cx + 1, 2, d - 1, cx + 3, 4, d, m.c(0x4e120d))
            m.set(cx + 2, 3, d - 1, m.c(0xd0c4a4))
            tear(m, seed + 4, 0.35, 0)
        }
        if (L.belly) {
            // A swollen gut bulging forward with glowing pustules.
            const gut = worn(m, scaleHex(L.skin, 1.05), seed + 9)
            m.vox.ellipsoid(w / 2, 2.5, d - 2, w / 2 - 0.5, 3, 3.2, gut)
            const pus = m.c(0x9fff4a, 0.8)
            for (const [x, y] of [[1, 2], [w - 2, 3], [cx, 1], [2, 4], [w - 3, 1]] as const) m.set(x, y, d, pus).set(x, y, d - 1, pus)
        }
        if (L.armour) {
            // Trench armour: an iron breastplate.
            const iron = m.c(0x5a5c60)
            const rust = m.c(0x7a4a2a)
            m.box(1, 1, d - 1, w - 1, h - 2, d, (i, j, k) => (dfHash3(i, j, k, 5) < 0.18 ? rust : iron))
            for (const x of [1, w - 2]) m.set(x, h - 3, d - 1, m.c(0x2a2a2c))
        }
        // Neck stub, hidden inside the head.
        m.box(cx - 1, h - 1, Math.floor(d / 2) - 1, cx + 1, h, Math.floor(d / 2) + 1, skin)
        parts[P.torso] = { model: m, pivot: [w / 2, 0, d / 2] }
    }

    // ---------------------------------------------------------------- head (cube 5 voxels, floating half a voxel above the neck joint)
    {
        const m = new DfVoxModel(5, 5, 5)
        m.box(0, 0, 0, 5, 5, 5, skinFill(m, seed + 5))
        // Face on +z: dark sockets, a torn mouth with teeth, scraps of hair.
        const socket = m.c(0x14100c)
        m.set(1, 3, 4, socket).set(3, 3, 4, socket)
        m.box(1, 1, 4, 4, 2, 5, m.c(0x2a1410))
        m.set(1, 1, 4, m.c(0xd8d0b0)).set(3, 1, 4, m.c(0xd8d0b0))
        m.box(0, 4, 0, 5, 5, 4, m.c(type === 'ghoul' ? 0x3a352c : 0x2c241c))
        if (type === 'ghoul') m.box(0, 3, 0, 5, 4, 1, m.c(0x3a352c))
        m.set(4, 2, 4, m.c(0x5e1712)).set(0, 4, 4, 0)
        if (type !== 'brute' && dfHash3(outfit, 1, 2, 3) < 0.6) m.set(4, 4, 4, 0).set(4, 4, 3, m.c(0xc9bfa2))
        if (type === 'shambler' && outfit === 0) {
            // A crumpled Adrian kepi.
            m.box(0, 4, 0, 5, 5, 5, m.c(0x5f6e83))
        }
        parts[P.head] = { model: m, pivot: [2.5, -0.5, 2.5] }
        // Eyes: their own part so they can keep a minimum on-screen size at range.
        const e = new DfVoxModel(5, 1, 1)
        const glow = e.c(L.eye, 1)
        e.set(1, 0, 0, glow).set(3, 0, 0, glow)
        parts[P.eyes] = { model: e, pivot: [2.5, -3.5, -1.52] }
    }

    // ---------------------------------------------------------------- arms (upper arm from the shoulder, forearm + hand from the elbow)
    {
        const a = L.arm
        for (const side of [0, 1]) {
            const up = new DfVoxModel(a, 5, a)
            up.box(0, 0, 0, a, 5, a, L.shirtless ? skinFill(up, seed + 6 + side) : worn(up, L.cloth, seed + 6 + side))
            if (L.armour) up.box(0, 4, 0, a, 5, a, up.c(0x5a5c60))
            parts[side ? P.armUR : P.armUL] = { model: up, pivot: [a / 2, 5, a / 2] }
            const lo = new DfVoxModel(a, 6, a)
            const sleeve = L.shirtless ? skinFill(lo, seed + 8 + side) : worn(lo, L.cloth, seed + 8 + side)
            lo.box(0, 2, 0, a, 6, a, sleeve)
            lo.box(0, 0, 0, a, 2, a, skinFill(lo, seed + 10 + side))
            const claw = lo.c(0x2c2620)
            lo.box(0, 0, a - 1, a, 1, a, claw)
            if (type === 'ghoul') lo.set(0, 0, a - 1, lo.c(0x1a1612))
            if (!L.shirtless && dfHash3(side, outfit, 3, 9) < 0.5) lo.box(0, 2, 0, a, 3, a, skinFill(lo, seed + 12))
            parts[side ? P.armLR : P.armLL] = { model: lo, pivot: [a / 2, 6, a / 2] }
        }
    }

    // ---------------------------------------------------------------- legs (thigh from the hip, shin + boot from the knee)
    {
        const w = L.limb
        for (const side of [0, 1]) {
            const th = new DfVoxModel(w, 6, w)
            th.box(0, 0, 0, w, 6, w, worn(th, L.trousers, seed + 14 + side))
            parts[side ? P.legUR : P.legUL] = { model: th, pivot: [w / 2, 6, w / 2] }
            const sh = new DfVoxModel(w, 6, w + 1)
            sh.box(0, 1, 0, w, 6, w, worn(sh, L.puttee, seed + 16 + side))
            for (let j = 2; j < 6; j += 2) sh.box(0, j, 0, w, j + 1, w, sh.c(scaleHex(L.puttee, 0.8)))
            sh.box(0, 0, 0, w, 1, w + 1, sh.c(L.boot)).box(0, 1, w - 1, w, 2, w + 1, sh.c(L.boot))
            if (type === 'ghoul' && side === 0) sh.box(0, 0, 0, w, 1, w + 1, skinFill(sh, seed + 18))
            parts[side ? P.legLR : P.legLL] = { model: sh, pivot: [w / 2, 6, w / 2] }
        }
    }

    // ---------------------------------------------------------------- the brute's iron helmet (a trench helmet with a face plate)
    if (type === 'brute') {
        const m = new DfVoxModel(7, 6, 7)
        const iron = m.shade(0x4b4d50, 0.08, 3)
        const rust = m.c(0x7a4a2a)
        m.box(0, 2, 0, 7, 6, 7, (i, j, k) => (dfHash3(i, j, k, 11) < 0.12 ? rust : iron(i, j, k)))
        m.box(1, 6 - 1, 1, 6, 6, 6, iron)
        m.box(0, 0, 6, 7, 5, 7, iron)
        m.box(1, 3, 6, 6, 4, 7, m.c(0xff3a1a, 1))
        for (const x of [0, 6]) m.set(x, 4, 3, m.c(0x2a2a2c))
        m.box(1, 1, 1, 6, 5, 6, 0)
        parts[P.helmet] = { model: m, pivot: [3.5, 0, 3.5] }
    }
    return { type, outfit, dims, parts }
}

/** Rest-pose offsets of each part's joint from its parent joint (metres), shared by the rig and tests. */
export function dfZombieJoints(d: DfZombieDims): THREE.Vector3[] {
    const j: THREE.Vector3[] = []
    j[P.pelvis] = new THREE.Vector3(0, d.hipY, 0)
    j[P.torso] = new THREE.Vector3(0, d.spine, 0)
    j[P.head] = new THREE.Vector3(0, d.torso, 0)
    j[P.eyes] = new THREE.Vector3(0, 0, 0)
    j[P.helmet] = new THREE.Vector3(0, d.v * 0, 0)
    j[P.armUL] = new THREE.Vector3(-d.shoulderX, d.shoulderY, 0)
    j[P.armUR] = new THREE.Vector3(d.shoulderX, d.shoulderY, 0)
    j[P.armLL] = new THREE.Vector3(0, -d.upperArm, 0)
    j[P.armLR] = new THREE.Vector3(0, -d.upperArm, 0)
    j[P.legUL] = new THREE.Vector3(-d.legX, 0, 0)
    j[P.legUR] = new THREE.Vector3(d.legX, 0, 0)
    j[P.legLL] = new THREE.Vector3(0, -d.thigh, 0)
    j[P.legLR] = new THREE.Vector3(0, -d.thigh, 0)
    return j
}

/** Parent of each part (-1 = the root). */
export const DF_ZOMBIE_PARENT: number[] = [-1, P.pelvis, P.torso, P.torso, P.armUL, P.torso, P.armUR, P.pelvis, P.legUL, P.pelvis, P.legUR, P.head, P.head]
