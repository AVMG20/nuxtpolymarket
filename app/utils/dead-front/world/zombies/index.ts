import * as THREE from 'three'
import { DF_BLOATER, DF_ENEMIES } from '#shared/utils/dead-front/enemies'
import { DF_MAP } from '#shared/utils/dead-front/map'
import { dfBuildCollision, dfRaycast } from '#shared/utils/dead-front/physics'
import type { DfEnemyDef } from '#shared/utils/dead-front/enemies'
import type { DfEvent, DfZombieAnim, DfZombieSnap } from '#shared/utils/dead-front/protocol'
import type { DfEnemyType, Vec3 } from '#shared/utils/dead-front/types'
import type { DfRenderContext, DfZombieView } from '../../context'
import { dfVoxMaterial } from '../../voxel/material'
import { DF_WORLD_SOUNDS, dfAttackSound, dfDeathSound, dfGroanSound } from '../sound-names'
import { createDfDebris } from './debris'
import { createDfGasClouds } from './gas'
import { DF_ZOMBIE_PARENT, DF_ZOMBIE_PARTS, DF_ZOMBIE_TYPES, P, dfZombieJoints, dfZombieOutfitCount } from './models'
import type { DfZombieDims } from './models'
import { DF_POSE_ROOT, dfCadence, dfEvalPose, dfLerpPose, dfNewPose } from './pose'
import type { DfPose, DfPoseInput } from './pose'
import { DfZombieBatch } from './rig'
import { DfZombieVoices } from './voices'

// The zombie view: blocky voxel zombies drawn through the GPU rig (one draw
// per type and outfit), posed procedurally from the interpolated snapshot.
// Hits knock voxel chips off, kills burst into cubes (a headshot pops the
// whole head), corpses fall, lie still, then sink and crumble away. Voices go
// through a small budget so the horde groans now and then, nearest first.
//
// Facing: the server's yaw is atan2(dx, dz), so a zombie at `yaw` faces
// (sin yaw, 0, cos yaw); the models are built facing +z, so root yaw = yaw.

export { DF_ZOMBIE_TYPES } from './models'

const BLEND_SECONDS = 0.2
const DESPAWN_GRACE = 0.35
const CAP = 40
/** Part draw order: parents first. */
const ORDER = [P.pelvis, P.torso, P.head, P.eyes, P.helmet, P.armUL, P.armLL, P.armUR, P.armLR, P.legUL, P.legLL, P.legUR, P.legLR]

// Additive spring channels for flinches.
const S_TORSO_X = 0
const S_TORSO_Y = 1
const S_TORSO_Z = 2
const S_HEAD_X = 3
const S_HEAD_Z = 4
const S_ARM_L = 5
const S_ARM_R = 6
const S_ROOT_Z = 7
const S_COUNT = 8
const SPRING_K = 170
const SPRING_C = 13

/** Head-tracking weight per animation. */
const TRACK: Record<DfZombieAnim, number> = {
    rise: 0.2, walk: 1, run: 0.8, sprint: 0.45, attack: 0.9, tear: 0.3, climb: 0.2, spit: 0.7, stagger: 0.2, crawl: 0.6
}

interface Helmet {
    pos: THREE.Vector3
    vel: THREE.Vector3
    quat: THREE.Quaternion
    spin: THREE.Vector3
    t: number
    floor: number
}

interface Live {
    id: number
    type: DfEnemyType
    def: DfEnemyDef
    batch: DfZombieBatch
    slot: number
    dims: DfZombieDims
    joints: THREE.Vector3[]
    base: DfPose
    pose: DfPose
    from: DfPose
    target: DfPose
    blend: number
    anim: DfZombieAnim
    animTime: number
    input: DfPoseInput
    x: number
    y: number
    z: number
    yaw: number
    lastX: number
    lastZ: number
    speed: number
    phase: number
    speedMul: number
    limpBase: number
    hitLimp: number
    springs: Float32Array
    headYaw: number
    headPitch: number
    groanAt: number
    attackAt: number
    tearAt: number
    gurgleAt: number
    leakAt: number
    sparkAt: number
    flickerAt: number
    seen: number
    missing: number
    armored: boolean
    shocked: boolean
    hp: number
    hitAt: number
    hitX: number
    hitZ: number
    fleshAt: number
    voice: number
    riseFx: number
    flash: number
    helmet: Helmet | null
    helmetGone: boolean
    dist: number
    /** Per-zombie tint (grime, pallor) on top of the outfit. */
    tr: number
    tg: number
    tb: number
}

interface Corpse {
    batch: DfZombieBatch
    slot: number
    dims: DfZombieDims
    joints: THREE.Vector3[]
    type: DfEnemyType
    pose: DfPose
    start: DfPose
    x: number
    y: number
    z: number
    yaw: number
    /** +1 falls forward, -1 backward. */
    dir: number
    t: number
    crumple: boolean
    twitch: number
    landed: boolean
    headGone: boolean
    helmet: boolean
    fast: boolean
    crumbled: number
    /** Facing at death and the facing it twists to as it falls along the push. */
    yaw0: number
    yawT: number
    /** Knockback slide along the ground, decaying as it falls. */
    vx: number
    vz: number
}

/** One flying limb of a gibbed zombie (a rigid part of its rig instance). */
interface Limb {
    part: number
    pos: THREE.Vector3
    vel: THREE.Vector3
    quat: THREE.Quaternion
    spin: THREE.Vector3
    landed: boolean
}

/** A gibbed zombie: the limbs that flew off keep the instance until they sink away. */
interface Gib {
    batch: DfZombieBatch
    slot: number
    limbs: Limb[]
    floor: number
    t: number
}

const LIMBS = [P.armUL, P.armLL, P.armUR, P.armLR, P.legUL, P.legLL, P.legUR, P.legLR]
const GIB_LIFE = 3.6

function rnd(a: number, b: number): number {
    return a + Math.random() * (b - a)
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v
}

function smooth(x: number): number {
    const t = clamp(x, 0, 1)
    return t * t * (3 - 2 * t)
}

function angleLerp(a: number, b: number, t: number): number {
    let d = (b - a) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    return a + d * t
}

function newInput(type: DfEnemyType): DfPoseInput {
    return {
        type, anim: 'walk', t: 0, phase: 0, move: 0, limp: 0, limpSide: 1, arms: 2, hunch: 0, tilt: 0, seed: 0,
        swing: -1, windup: 0.5, spit: -1, spitWindup: 0.6, tearPeriod: 1, height: DF_ENEMIES[type].height, tell: 0
    }
}

export function createDfZombieView(ctx: DfRenderContext): DfZombieView {
    const { scene, camera, fx, audio } = ctx
    const shadows = ctx.quality === 'high'
    const batches = new Map<string, DfZombieBatch>()
    for (const t of DF_ZOMBIE_TYPES) {
        for (let o = 0; o < dfZombieOutfitCount(t); o++) {
            const b = new DfZombieBatch(t, o, CAP, shadows)
            scene.add(b.mesh)
            batches.set(`${t}:${o}`, b)
        }
    }
    const jointsOf = new Map<DfZombieBatch, THREE.Vector3[]>()
    const pointsOf = new Map<DfZombieBatch, { x: number, y: number, z: number, color: number }[][]>()
    for (const b of batches.values()) {
        jointsOf.set(b, dfZombieJoints(b.build.dims))
        pointsOf.set(b, b.build.parts.map(p => (p ? p.model.points(b.build.dims.v, p.pivot) : [])))
    }
    const debrisMat = dfVoxMaterial()
    // Every door open: only walls stop a corpse sliding.
    const collision = dfBuildCollision(DF_MAP, new Set(DF_MAP.doors.map(d => d.id)))
    const voices = new DfZombieVoices()
    const alive = new Map<number, Live>()
    const deadIds = new Map<number, number>()
    const corpses: Corpse[] = []
    const gibs: Gib[] = []
    const spareLives: Live[] = []
    let time = 0
    let frame = 0
    let decalAt = 0
    let fallSoundAt = 0
    /** The round's last few zombies: they glow faintly so they can be found. */
    const highlighted = new Set<number>()

    const camPos = new THREE.Vector3()
    const bufSize = new THREE.Vector2()
    const world = Array.from({ length: DF_ZOMBIE_PARTS }, () => new THREE.Matrix4())
    const m4 = new THREE.Matrix4()
    const m4b = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const v3 = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)
    const tint = new THREE.Color()

    const debris = createDfDebris(scene, debrisMat, (x, y, z) => {
        if (time - decalAt > 0.25 && Math.random() < 0.3) {
            decalAt = time
            fx.decal({ x, y: y + 0.01, z }, { x: 0, y: 1, z: 0 }, 'blood')
        }
    })
    const gas = createDfGasClouds(scene, fx)

    function sound(name: string, x: number, y: number, z: number, volume = 1, rate = 1): void {
        audio.play(name, { pos: { x, y, z }, volume, rate })
    }

    function distTo(x: number, y: number, z: number): number {
        return Math.hypot(camPos.x - x, camPos.y - y, camPos.z - z)
    }

    function towardCamera(p: Vec3): Vec3 {
        const dx = camPos.x - p.x
        const dy = camPos.y - p.y
        const dz = camPos.z - p.z
        const l = Math.hypot(dx, dy, dz) || 1
        return { x: dx / l, y: dy / l, z: dz / l }
    }

    // ------------------------------------------------------------ rig matrices

    /**
     * Writes all part matrices of one instance. `tilt` pitches the whole body
     * about the feet (corpses), `eyeScale` grows the eyes at range.
     */
    function writeRig(b: DfZombieBatch, slot: number, joints: THREE.Vector3[], dims: DfZombieDims, pose: DfPose, x: number, y: number, z: number, yaw: number, opts: { headGone?: boolean, helmet?: boolean, eyeScale?: number, scale?: number, helmetMatrix?: THREE.Matrix4 | null }): void {
        // root = T(feet) * Ry(yaw) * T(offset) * Rx(pitch) * Rz(roll): offsets stay level when the body tips over.
        const r = DF_POSE_ROOT
        q.setFromAxisAngle(v3.set(0, 1, 0), yaw + pose[r + 5]!)
        m4.compose(v3.set(x, y, z), q, one.set(1, 1, 1))
        m4.multiply(m4b.makeTranslation(pose[r]!, pose[r + 1]!, pose[r + 2]!))
        e.set(pose[r + 3]!, 0, pose[r + 4]!, 'XYZ')
        const rootM = m4.multiply(m4b.makeRotationFromEuler(e))
        if (opts.scale !== undefined && opts.scale !== 1) rootM.multiply(m4b.makeScale(opts.scale, opts.scale, opts.scale))
        for (const p of ORDER) {
            const parent = DF_ZOMBIE_PARENT[p]!
            const j = joints[p]!
            e.set(pose[p * 3]!, pose[p * 3 + 1]!, pose[p * 3 + 2]!, 'XYZ')
            q.setFromEuler(e)
            const w = world[p]!
            w.compose(j, q, one.set(1, 1, 1))
            w.premultiply(parent < 0 ? rootM : world[parent]!)
            if (p === P.eyes && opts.eyeScale && opts.eyeScale !== 1) {
                const k = opts.eyeScale
                const cy = 4 * dims.v
                const cz = 2 * dims.v
                w.multiply(m4b.makeTranslation(0, cy, cz)).multiply(m4b.makeScale(k, k, k)).multiply(m4b.makeTranslation(0, -cy, -cz))
            }
        }
        for (let p = 0; p < DF_ZOMBIE_PARTS; p++) {
            const hidden = (opts.headGone && (p === P.head || p === P.eyes || p === P.helmet)) || (p === P.helmet && !opts.helmet && !opts.helmetMatrix)
            if (hidden) b.hidePart(slot, p)
            else if (p === P.helmet && opts.helmetMatrix) b.setPart(slot, p, opts.helmetMatrix)
            else b.setPart(slot, p, world[p]!)
        }
    }

    // ------------------------------------------------------------ debris helpers

    function partWorldPoint(L: { batch: DfZombieBatch }, part: number, pt: { x: number, y: number, z: number }, out: THREE.Vector3): THREE.Vector3 {
        return out.set(pt.x, pt.y, pt.z).applyMatrix4(world[part]!)
    }

    /** Bursts a part's voxels as cubes (uses the matrices of the last writeRig call). */
    function burstPart(b: DfZombieBatch, part: number, floor: number, power: number, step: number, cx: number, cy: number, cz: number, push: Vec3 | null): void {
        const pts = pointsOf.get(b)![part] ?? []
        const v = b.build.dims.v
        for (let i = 0; i < pts.length; i += step) {
            const pt = pts[i]!
            partWorldPoint({ batch: b }, part, pt, v3)
            let dx = v3.x - cx
            let dy = v3.y - cy
            let dz = v3.z - cz
            const l = Math.hypot(dx, dy, dz) || 1
            dx /= l
            dy /= l
            dz /= l
            const sp = power * rnd(0.5, 1.2)
            debris.spawn(v3.x, v3.y, v3.z, dx * sp + (push?.x ?? 0) * rnd(0.5, 1.5), dy * sp + rnd(1, 3) * power * 0.4, dz * sp + (push?.z ?? 0) * rnd(0.5, 1.5), v * (step > 1 ? 1.15 : 0.95), pt.color, floor)
        }
    }

    function chips(L: Live, part: number, at: Vec3, n: number): void {
        const pts = pointsOf.get(L.batch)![part] ?? []
        if (!pts.length) return
        const toCam = towardCamera(at)
        for (let i = 0; i < n; i++) {
            const pt = pts[Math.floor(Math.random() * pts.length)]!
            const sp = rnd(1.5, 3.5)
            debris.spawn(at.x + rnd(-0.06, 0.06), at.y + rnd(-0.06, 0.06), at.z + rnd(-0.06, 0.06),
                toCam.x * sp + rnd(-1.2, 1.2), toCam.y * sp + rnd(0.8, 2.5), toCam.z * sp + rnd(-1.2, 1.2),
                L.dims.v * rnd(0.55, 0.85), Math.random() < 0.35 ? 0x5e1712 : pt.color, L.y, rnd(1.2, 2.2))
        }
    }

    // ------------------------------------------------------------ live zombies

    function makeLive(s: DfZombieSnap): Live | null {
        const def = DF_ENEMIES[s.type]
        let batch: DfZombieBatch | undefined
        let slot = -1
        const outfits = dfZombieOutfitCount(s.type)
        const first = Math.floor(Math.random() * outfits)
        for (let o = 0; o < outfits && slot < 0; o++) {
            batch = batches.get(`${s.type}:${(first + o) % outfits}`)!
            slot = batch.acquire()
        }
        if (!batch || slot < 0) {
            // Out of slots: free the oldest corpse (or flying limbs) of this type and retry.
            const c = corpses.find(k => k.type === s.type)
            const g = c ? null : gibs.find(k => k.batch.type === s.type)
            if (c) removeCorpse(c)
            else if (g) removeGib(g)
            else return null
            batch = (c ?? g)!.batch
            slot = batch.acquire()
            if (slot < 0) return null
        }
        const L: Live = spareLives.pop() ?? {
            id: 0, type: s.type, def, batch, slot, dims: batch.build.dims, joints: [], base: dfNewPose(), pose: dfNewPose(), from: dfNewPose(), target: dfNewPose(),
            blend: 1, anim: 'walk', animTime: 0, input: newInput(s.type), x: 0, y: 0, z: 0, yaw: 0, lastX: 0, lastZ: 0, speed: 0, phase: 0, speedMul: 1,
            limpBase: 0, hitLimp: 0, springs: new Float32Array(S_COUNT * 2), headYaw: 0, headPitch: 0, groanAt: 0, attackAt: 0, tearAt: 0, gurgleAt: 0, leakAt: 0, sparkAt: 0,
            flickerAt: 0, seen: 0, missing: 0, armored: false, shocked: false, hp: 1, hitAt: -10, hitX: 0, hitZ: 0, fleshAt: 0, voice: 1, riseFx: 0, flash: 0,
            helmet: null, helmetGone: false, dist: 0, tr: 1, tg: 1, tb: 1
        }
        L.id = s.id
        L.type = s.type
        L.def = def
        L.batch = batch
        L.slot = slot
        L.dims = batch.build.dims
        L.joints = jointsOf.get(batch)!
        L.anim = s.anim
        L.animTime = 0
        L.blend = 1
        L.x = s.pos.x
        L.y = s.pos.y
        L.z = s.pos.z
        L.yaw = s.yaw
        L.lastX = s.pos.x
        L.lastZ = s.pos.z
        L.speed = 0
        L.phase = Math.random()
        L.speedMul = rnd(0.9, 1.1)
        L.limpBase = s.type === 'shambler' ? rnd(0.1, 0.8) : s.type === 'ghoul' ? rnd(0, 0.2) : rnd(0.05, 0.3)
        L.hitLimp = 0
        L.springs.fill(0)
        L.headYaw = 0
        L.headPitch = 0
        // Long, staggered first groans so a fresh wave doesn't all speak at once.
        L.groanAt = time + rnd(3, 12)
        L.attackAt = 0
        L.tearAt = 0
        L.gurgleAt = time + rnd(2, 6)
        L.leakAt = time + rnd(1, 3)
        L.sparkAt = 0
        L.flickerAt = 0
        L.seen = frame
        L.missing = 0
        L.armored = s.armored === true
        L.shocked = false
        L.hp = s.hp
        L.hitAt = -10
        L.fleshAt = 0
        L.voice = rnd(0.88, 1.12)
        L.riseFx = 0
        L.flash = 0
        L.helmet = null
        L.helmetGone = s.type === 'brute' && s.armored !== true
        L.dist = distTo(L.x, L.y, L.z)
        // A little variety inside each outfit: pallid, grimy, bruised.
        const bright = rnd(0.84, 1.06)
        const warm = rnd(-0.05, 0.05)
        L.tr = bright * (1 + warm)
        L.tg = bright * (1 - Math.abs(warm) * 0.3)
        L.tb = bright * (1 - warm)
        const inp = L.input
        Object.assign(inp, newInput(s.type))
        inp.tell = s.tell === 'lunge' ? 1 : s.tell === 'charge' ? 2 : 0
        inp.limpSide = Math.random() < 0.5 ? 1 : -1
        const r = Math.random()
        inp.arms = s.type === 'shambler' ? (r < 0.3 ? 0 : r < 0.6 ? 1 : 2) : s.type === 'bloater' ? 0 : 2
        inp.hunch = rnd(-0.05, 0.1)
        inp.tilt = rnd(-0.25, 0.25)
        inp.seed = Math.random()
        inp.windup = def.windup
        inp.tearPeriod = def.tearTime
        inp.spitWindup = DF_BLOATER.spitWindup
        batch.setColor(slot, tint.setRGB(L.tr, L.tg, L.tb))
        enterAnim(L, s.anim, true)
        poseLive(L, 0)
        return L
    }

    function enterAnim(L: Live, anim: DfZombieAnim, fresh: boolean): void {
        if (!fresh) {
            L.from.set(L.base)
            L.blend = 0
        }
        L.anim = anim
        L.animTime = 0
        const hy = L.y + L.def.headY
        if (anim === 'rise') {
            if (voices.take('rise', time, L.dist)) sound(DF_WORLD_SOUNDS.rise, L.x, L.y + 0.2, L.z, 1, L.voice)
            fx.burst('dust', { x: L.x, y: L.y + 0.05, z: L.z }, { normal: { x: 0, y: 1, z: 0 }, count: 12, scale: 1.2 })
            L.riseFx = 3
            for (let i = 0; i < 10; i++) {
                const a = Math.random() * Math.PI * 2
                debris.spawn(L.x + Math.cos(a) * 0.3, L.y + 0.05, L.z + Math.sin(a) * 0.3, Math.cos(a) * rnd(0.8, 2), rnd(2, 4), Math.sin(a) * rnd(0.8, 2), rnd(0.07, 0.14), Math.random() < 0.5 ? 0x4d3d2d : 0x3f3227, L.y, rnd(0.8, 1.6))
            }
        } else if (anim === 'climb') {
            if (L.dist < 20) sound(DF_WORLD_SOUNDS.climb, L.x, L.y + 0.6, L.z, 0.8, L.voice)
        } else if (anim === 'attack' && L.input.tell) {
            L.input.swing = -1
            const big = L.type === 'brute'
            // The telegraph always speaks: it is the cue to dodge.
            sound(dfAttackSound(L.type), L.x, hy, L.z, big ? 1.25 : 0.9, L.voice * (big ? 0.72 : 1.3))
            if (big) {
                fx.burst('dust', { x: L.x, y: L.y + 0.05, z: L.z }, { normal: { x: 0, y: 1, z: 0 }, count: 14, scale: 1.4 })
                if (L.dist < 12) fx.shake(0.12 * (1 - L.dist / 12))
            } else {
                fx.burst('dust', { x: L.x, y: L.y + 0.05, z: L.z }, { normal: { x: 0, y: 1, z: 0 }, count: 6, scale: 0.7 })
            }
        } else if (anim === 'attack') {
            L.input.swing = 0
            if (time >= L.attackAt && voices.take('attack', time, L.dist)) {
                sound(dfAttackSound(L.type), L.x, hy, L.z, 0.85, L.voice)
                L.attackAt = time + rnd(2.5, 4.5)
            }
        } else if (anim === 'spit') {
            L.input.spit = 0
            if (L.dist < 22) sound(DF_WORLD_SOUNDS.bloaterGurgle, L.x, L.y + 1.1, L.z, 0.9, L.voice * 1.15)
        } else if (anim === 'stagger' && Math.random() < 0.4 && voices.take('stagger', time, L.dist)) {
            sound(dfGroanSound(L.type), L.x, hy, L.z, 0.7, L.voice * 1.1)
        }
    }

    function spring(L: Live, ch: number, impulse: number): void {
        L.springs[ch * 2 + 1] = (L.springs[ch * 2 + 1] ?? 0) + impulse
    }

    function sp(L: Live, ch: number): number {
        return L.springs[ch * 2] ?? 0
    }

    function poseLive(L: Live, dt: number): void {
        const inp = L.input
        const cad = dfCadence(L.type, L.speed) * L.speedMul
        L.phase += cad * dt
        inp.anim = L.anim
        inp.t = L.animTime
        inp.phase = L.phase
        inp.move = clamp(L.speed / Math.max(0.5, L.def.speeds.run), 0, 1)
        inp.limp = clamp(L.limpBase + (1 - L.hp) * 0.4 + L.hitLimp, 0, 1)
        dfEvalPose(inp, L.target)
        if (L.blend < 1) {
            L.blend = Math.min(1, L.blend + dt / BLEND_SECONDS)
            dfLerpPose(L.from, L.target, smooth(L.blend), L.base)
        } else {
            L.base.set(L.target)
        }
        const p = L.pose
        p.set(L.base)
        const s = L.springs
        for (let c = 0; c < S_COUNT; c++) {
            const x = s[c * 2]!
            const v = s[c * 2 + 1]! + (-SPRING_K * x - SPRING_C * s[c * 2 + 1]!) * dt
            s[c * 2 + 1] = v
            s[c * 2] = x + v * dt
        }
        p[P.torso * 3] = p[P.torso * 3]! + sp(L, S_TORSO_X)
        p[P.torso * 3 + 1] = p[P.torso * 3 + 1]! + sp(L, S_TORSO_Y)
        p[P.torso * 3 + 2] = p[P.torso * 3 + 2]! + sp(L, S_TORSO_Z)
        p[P.head * 3] = p[P.head * 3]! + sp(L, S_HEAD_X)
        p[P.head * 3 + 2] = p[P.head * 3 + 2]! + sp(L, S_HEAD_Z)
        p[P.armUL * 3] = p[P.armUL * 3]! + sp(L, S_ARM_L)
        p[P.armUR * 3] = p[P.armUR * 3]! + sp(L, S_ARM_R)
        p[DF_POSE_ROOT + 2] = p[DF_POSE_ROOT + 2]! + sp(L, S_ROOT_Z)

        // Head tracking toward the local player.
        const dx = camPos.x - L.x
        const dz = camPos.z - L.z
        const cy = Math.cos(L.yaw)
        const sy = Math.sin(L.yaw)
        const lx = dx * cy - dz * sy
        const lz = dx * sy + dz * cy
        const dist = Math.hypot(lx, lz)
        let ty = Math.atan2(lx, lz)
        let tp = -Math.atan2(camPos.y - (L.y + L.def.headY), Math.max(0.3, dist))
        let w = TRACK[L.anim] * (dist < 16 ? 1 : Math.max(0, 1 - (dist - 16) / 8))
        if (Math.abs(ty) > 1.9) w = 0
        ty = clamp(ty, -1.0, 1.0) * w
        tp = clamp(tp, -0.55, 0.5) * w
        const k = 1 - Math.exp(-dt * 5)
        L.headYaw += (ty - L.headYaw) * k
        L.headPitch += (tp - L.headPitch) * k
        p[P.head * 3 + 1] = p[P.head * 3 + 1]! + L.headYaw * 0.7
        p[P.head * 3] = p[P.head * 3]! + L.headPitch * 0.8
        p[P.torso * 3 + 1] = p[P.torso * 3 + 1]! + L.headYaw * 0.2
    }

    function eyeScale(L: { x: number, y: number, z: number, dims: DfZombieDims }, pxPerUnit: number): number {
        const d = Math.max(0.1, distTo(L.x, L.y + 1.5, L.z))
        const px = L.dims.v / d * pxPerUnit
        return px < 1.8 ? Math.min(3, 1.8 / px) : 1
    }

    function writeLive(L: Live, pxPerUnit: number): void {
        let helmetMatrix: THREE.Matrix4 | null = null
        if (L.helmet) {
            const h = L.helmet
            helmetMatrix = m4b.compose(h.pos, h.quat, one.set(1, 1, 1)).clone()
        }
        writeRig(L.batch, L.slot, L.joints, L.dims, L.pose, L.x, L.y, L.z, L.yaw, { helmet: L.type === 'brute' && !L.helmetGone, helmetMatrix, eyeScale: eyeScale(L, pxPerUnit) })
    }

    function knockHelmet(L: Live): void {
        if (L.type !== 'brute' || L.helmetGone) return
        L.helmetGone = true
        writeLive(L, 1000)
        const hm = world[P.helmet]!
        const pos = new THREE.Vector3().setFromMatrixPosition(hm)
        const quat = new THREE.Quaternion().setFromRotationMatrix(hm)
        const fwdX = Math.sin(L.yaw)
        const fwdZ = Math.cos(L.yaw)
        L.helmet = { pos, vel: new THREE.Vector3(-fwdX * rnd(1, 2.2) + rnd(-0.8, 0.8), rnd(3, 4.2), -fwdZ * rnd(1, 2.2) + rnd(-0.8, 0.8)), quat, spin: new THREE.Vector3(rnd(-12, 12), rnd(-6, 6), rnd(-12, 12)), t: 0, floor: L.y }
        sound(DF_WORLD_SOUNDS.helmetClang, pos.x, pos.y, pos.z, 1, rnd(0.95, 1.05))
        fx.burst('sparks', pos, { normal: towardCamera(pos), count: 18 })
        spring(L, S_HEAD_X, -9)
        spring(L, S_HEAD_Z, rnd(-5, 5))
    }

    function stepHelmet(L: Live, dt: number): void {
        const h = L.helmet
        if (!h) return
        h.t += dt
        h.vel.y -= 14 * dt
        h.pos.addScaledVector(h.vel, dt)
        e.set(h.spin.x * dt, h.spin.y * dt, h.spin.z * dt)
        h.quat.multiply(q.setFromEuler(e))
        if (h.pos.y < h.floor + 0.12) {
            h.pos.y = h.floor + 0.12
            if (h.vel.y < -1) {
                h.vel.y *= -0.35
                if (Math.random() < 0.6) sound(DF_WORLD_SOUNDS.helmetClang, h.pos.x, h.pos.y, h.pos.z, 0.35, rnd(1.2, 1.4))
            } else h.vel.y = 0
            h.vel.x *= 0.6
            h.vel.z *= 0.6
            h.spin.multiplyScalar(0.5)
        }
        if (h.t > 6) L.helmet = null
    }

    function onHit(L: Live, ev: Extract<DfEvent, { k: 'hit' }>): void {
        L.hitX = ev.pos.x
        L.hitZ = ev.pos.z
        L.hitAt = time
        L.flash = 1
        const cy = Math.cos(L.yaw)
        const sy = Math.sin(L.yaw)
        const hx = ev.pos.x - L.x
        const hz = ev.pos.z - L.z
        const lx = hx * cy - hz * sy
        const lz = hx * sy + hz * cy
        const side = lx >= 0 ? 1 : -1
        const front = lz >= 0 ? 1 : -1
        const str = clamp(ev.dmg / 120, 0.45, 1.4) * (L.type === 'brute' ? 0.6 : 1)
        const normal = towardCamera(ev.pos)
        const relY = ev.pos.y - L.y
        const onHelmet = L.type === 'brute' && L.armored && ev.zone === 'head'
        const onPlate = L.type === 'brute' && ev.zone === 'body' && front > 0 && relY > L.def.height * 0.48 && relY < L.def.height * 0.85
        if (onHelmet || onPlate) {
            fx.burst('sparks', ev.pos, { normal, count: 10 })
            if (time - L.fleshAt > 0.07) {
                L.fleshAt = time
                sound(DF_WORLD_SOUNDS.helmetClang, ev.pos.x, ev.pos.y, ev.pos.z, 0.3, rnd(1.5, 1.8))
            }
        } else {
            fx.burst('blood', ev.pos, { normal, count: 8 })
            const part = ev.zone === 'head' ? P.head : ev.zone === 'body' ? P.torso : relY > L.def.height * 0.5 ? (side > 0 ? P.armLR : P.armLL) : (side > 0 ? P.legUR : P.legUL)
            chips(L, part, ev.pos, ev.zone === 'head' ? 5 : 4)
            if (time - L.fleshAt > 0.07) {
                L.fleshAt = time
                sound(DF_WORLD_SOUNDS.flesh, ev.pos.x, ev.pos.y, ev.pos.z, 0.35, rnd(0.9, 1.15))
            }
        }
        // Flinch away from the shot (shots from the front push the torso back: -x).
        if (ev.zone === 'head') {
            spring(L, S_HEAD_X, -10 * str * front)
            spring(L, S_HEAD_Z, side * 4 * str)
            spring(L, S_TORSO_X, -2 * str * front)
        } else if (ev.zone === 'body') {
            spring(L, S_TORSO_X, -5 * str * front)
            spring(L, S_TORSO_Y, -side * 6 * str * front)
            spring(L, S_ROOT_Z, -0.5 * str * front)
            spring(L, S_HEAD_X, -3 * str * front)
        } else if (relY > L.def.height * 0.5) {
            spring(L, side > 0 ? S_ARM_R : S_ARM_L, 9 * str * front)
            spring(L, S_TORSO_Y, -side * 4 * str * front)
            spring(L, S_TORSO_Z, side * 2.5 * str)
        } else {
            spring(L, S_TORSO_Z, -side * 3 * str)
            L.hitLimp = Math.min(0.6, L.hitLimp + 0.35)
        }
    }

    function kill(L: Live, ev: Extract<DfEvent, { k: 'kill' }>): void {
        alive.delete(L.id)
        deadIds.set(L.id, time + 5)
        camera.getWorldPosition(camPos)
        writeLive(L, 1000)
        const headM = world[P.head]!
        v3.set(0, 2.5 * L.dims.v, 0).applyMatrix4(headM)
        const hx = v3.x
        const hy = v3.y
        const hz = v3.z
        const recent = time - L.hitAt < 0.6
        let dx = L.x - (recent ? L.hitX : camPos.x)
        let dz = L.z - (recent ? L.hitZ : camPos.z)
        let len = Math.hypot(dx, dz)
        if (len < 0.05) {
            dx = L.x - camPos.x
            dz = L.z - camPos.z
            len = Math.hypot(dx, dz) || 1
        }
        dx /= len
        dz /= len
        const push = { x: dx * 2, y: 0, z: dz * 2 }
        const cx = L.x
        const cyy = L.y + L.def.height * 0.55
        const cz = L.z

        if (ev.gib) {
            // The body bursts into cubes and some limbs fly off whole, tumbling.
            const g: Gib = { batch: L.batch, slot: L.slot, limbs: [], floor: L.y, t: 0 }
            for (let p = 0; p < DF_ZOMBIE_PARTS; p++) {
                if (p === P.helmet && L.helmetGone) continue
                if (LIMBS.includes(p as typeof LIMBS[number]) && Math.random() < 0.65) {
                    const w = world[p]!
                    const pos = new THREE.Vector3().setFromMatrixPosition(w)
                    const ox = pos.x - cx
                    const oz = pos.z - cz
                    const ol = Math.hypot(ox, oz) || 1
                    const sp = rnd(2.5, 5.5)
                    g.limbs.push({
                        part: p,
                        pos,
                        vel: new THREE.Vector3(ox / ol * sp + push.x * rnd(0.6, 1.4), rnd(3, 6.5), oz / ol * sp + push.z * rnd(0.6, 1.4)),
                        quat: new THREE.Quaternion().setFromRotationMatrix(w),
                        spin: new THREE.Vector3(rnd(-14, 14), rnd(-8, 8), rnd(-14, 14)),
                        landed: false
                    })
                    continue
                }
                burstPart(L.batch, p, L.y, rnd(3.5, 6), L.type === 'brute' ? 2 : 1, cx, L.y + 0.6, cz, push)
            }
            fx.burst('blood-mist', { x: cx, y: cyy, z: cz }, { scale: 1.4 })
            fx.burst('gib', { x: cx, y: cyy, z: cz }, { scale: 1.2 })
            sound(DF_WORLD_SOUNDS.gib, cx, cyy, cz, 1, rnd(0.92, 1.08))
            fx.decal({ x: cx, y: L.y + 0.01, z: cz }, { x: 0, y: 1, z: 0 }, 'blood')
            if (g.limbs.length) {
                for (let p = 0; p < DF_ZOMBIE_PARTS; p++) L.batch.hidePart(L.slot, p)
                L.batch.setColor(L.slot, tint.setRGB(0.9, 0.85, 0.85))
                gibs.push(g)
                if (gibs.length > 6) removeGib(gibs[0]!)
            } else {
                L.batch.release(L.slot)
            }
            recycle(L)
            return
        }

        const headshot = ev.zone === 'head'
        if (headshot) {
            // Pop the head into cubes (and the helmet with it).
            burstPart(L.batch, P.head, L.y, rnd(2.5, 4), 1, hx, hy - L.dims.v, hz, push)
            if (L.type === 'brute' && !L.helmetGone) burstPart(L.batch, P.helmet, L.y, rnd(2, 3), 1, hx, hy - L.dims.v, hz, push)
            fx.burst('blood-mist', { x: hx, y: hy, z: hz }, { normal: { x: dx, y: 0.4, z: dz }, scale: 1.1 })
            sound(DF_WORLD_SOUNDS.headPop, hx, hy, hz, 1, rnd(0.9, 1.1))
        } else {
            if (voices.take('death', time, L.dist)) sound(dfDeathSound(L.type), hx, hy, hz, 0.85, L.voice)
            chips(L, P.torso, { x: cx, y: cyy, z: cz }, 10)
        }
        const twitch = ev.weapon === 'arc' ? 0.75 : L.shocked ? 0.3 : 0
        if (twitch > 0) fx.burst('electric', { x: cx, y: cyy, z: cz }, { count: 12 })
        const explosive = ev.weapon === 'grenade'
        const crumple = !explosive && (headshot ? Math.random() < 0.55 : ev.weapon === 'knife' ? Math.random() < 0.7 : Math.random() < 0.3)
        // Fall away from the shooter unless the knees buckle (then forward).
        const fwdX = Math.sin(L.yaw)
        const fwdZ = Math.cos(L.yaw)
        const dir = crumple ? 1 : (fwdX * dx + fwdZ * dz >= 0 ? 1 : -1)
        // Knocked back along the shot: shotguns and blasts throw them, a knife barely moves them.
        const heavy = L.type === 'brute' ? 0.45 : L.type === 'bloater' ? 0.6 : 1
        let kick = (explosive ? 4.2 : ev.weapon === 'm1897' ? 3.2 : ev.weapon === 'knife' ? 0.6 : crumple ? 0.5 : headshot ? 1.3 : 1.7) * heavy
        // Stop short of walls: the slide covers about kick / 4.5 metres.
        const wall = dfRaycast(collision, { x: L.x, y: L.y + 0.4, z: L.z }, { x: dx, y: 0, z: dz }, kick / 4.5 + 1.2)
        if (wall) kick = Math.max(0, Math.min(kick, (wall.dist - 1.0) * 4.5))
        // Turn the body so it topples along the push (falling backward when shot from the front).
        const along = Math.atan2(dx, dz)
        const yaw = crumple ? L.yaw + rnd(-0.35, 0.35) : (dir > 0 ? along : along + Math.PI) + rnd(-0.3, 0.3)
        const c: Corpse = {
            batch: L.batch, slot: L.slot, dims: L.dims, joints: L.joints, type: L.type, pose: dfNewPose(), start: dfNewPose(),
            x: L.x, y: L.y, z: L.z, yaw: L.yaw, yaw0: L.yaw, yawT: yaw, dir, t: 0, crumple, twitch, landed: false, headGone: headshot,
            helmet: L.type === 'brute' && !L.helmetGone && !headshot, fast: explosive, crumbled: 0,
            vx: dx * kick, vz: dz * kick
        }
        c.start.set(L.pose)
        c.pose.set(L.pose)
        L.batch.setColor(L.slot, tint.setRGB(0.92, 0.92, 0.92))
        corpses.push(c)
        if (corpses.length > 16) removeCorpse(corpses[0]!)
        recycle(L)
    }

    function despawn(L: Live): void {
        alive.delete(L.id)
        const c: Corpse = {
            batch: L.batch, slot: L.slot, dims: L.dims, joints: L.joints, type: L.type, pose: dfNewPose(), start: dfNewPose(),
            x: L.x, y: L.y, z: L.z, yaw: L.yaw, yaw0: L.yaw, yawT: L.yaw, dir: 1, t: 4.2, crumple: false, twitch: 0, landed: true, headGone: false, helmet: L.type === 'brute' && !L.helmetGone, fast: false, crumbled: 0,
            vx: 0, vz: 0
        }
        c.start.set(L.pose)
        c.pose.set(L.pose)
        corpses.push(c)
        recycle(L)
    }

    function recycle(L: Live): void {
        L.helmet = null
        spareLives.push(L)
    }

    function removeGib(g: Gib): void {
        const i = gibs.indexOf(g)
        if (i >= 0) gibs.splice(i, 1)
        g.batch.release(g.slot)
    }

    /** Tumbles a gib's limbs: gravity, a bounce or two, blood where they land, then they sink. */
    function stepGib(g: Gib, dt: number): boolean {
        g.t += dt
        if (g.t > GIB_LIFE) return false
        const sink = Math.max(0, g.t - (GIB_LIFE - 0.8)) / 0.8
        for (const l of g.limbs) {
            if (!l.landed || l.vel.lengthSq() > 0.01) {
                l.vel.y -= 16 * dt
                l.pos.addScaledVector(l.vel, dt)
                e.set(l.spin.x * dt, l.spin.y * dt, l.spin.z * dt)
                l.quat.multiply(q.setFromEuler(e))
                const rest = g.floor + 0.06
                if (l.pos.y < rest) {
                    l.pos.y = rest
                    if (!l.landed) {
                        l.landed = true
                        if (time - decalAt > 0.06) {
                            decalAt = time
                            fx.decal({ x: l.pos.x, y: g.floor + 0.01, z: l.pos.z }, { x: 0, y: 1, z: 0 }, 'blood')
                        }
                        fx.burst('blood', l.pos, { normal: { x: 0, y: 1, z: 0 }, count: 4 })
                    }
                    l.vel.y = l.vel.y < -2 ? -l.vel.y * 0.3 : 0
                    l.vel.x *= 0.55
                    l.vel.z *= 0.55
                    l.spin.multiplyScalar(0.45)
                }
            }
            v3.copy(l.pos)
            v3.y -= sink * 0.35
            g.batch.setPart(g.slot, l.part, m4.compose(v3, l.quat, one.set(1, 1, 1)))
        }
        return true
    }

    function removeCorpse(c: Corpse): void {
        const i = corpses.indexOf(c)
        if (i >= 0) corpses.splice(i, 1)
        c.batch.release(c.slot)
    }

    const LIE = 4.2
    const SINK = 1.4
    function stepCorpse(c: Corpse, dt: number, pxPerUnit: number): boolean {
        c.t += dt
        if (c.vx !== 0 || c.vz !== 0) {
            c.x += c.vx * dt
            c.z += c.vz * dt
            const k = Math.exp(-dt * (c.landed ? 9 : 4.5))
            c.vx *= k
            c.vz *= k
            if (Math.abs(c.vx) + Math.abs(c.vz) < 0.02) c.vx = c.vz = 0
        }
        if (c.t < 0.3) c.yaw = angleLerp(c.yaw0, c.yawT, smooth(c.t / 0.25))
        const fall = c.fast ? 0.35 : c.crumple ? 0.75 : 0.55
        const p = c.pose
        const r = DF_POSE_ROOT
        if (c.t < LIE) {
            // Knees buckle (crumple) then the body topples about the feet with a small bounce.
            const u = clamp(c.t / fall, 0, 1)
            const pre = c.crumple ? smooth(c.t / 0.3) : 0
            const k = c.crumple ? smooth((c.t - 0.2) / fall) : u * u
            const bounce = u >= 1 ? Math.sin(Math.min(1, (c.t - fall) / 0.25) * Math.PI) * 0.06 * Math.exp(-(c.t - fall) * 4) : 0
            const ang = (Math.PI / 2 - 0.05) * k - bounce
            p.set(c.start)
            p[r + 3] = c.dir * ang
            p[r + 1] = Math.sin(ang) * c.dims.v * 2.2 - pre * c.dims.v * 3
            // Limbs go slack.
            const slack = smooth(c.t / 0.5)
            for (const part of [P.armUL, P.armUR]) p[part * 3] = p[part * 3]! * (1 - slack) + (c.dir > 0 ? -2.6 : 0.4) * slack
            for (const part of [P.legLL, P.legLR]) p[part * 3] = p[part * 3]! * (1 - slack) + (pre * 1.2 + 0.2) * slack
            p[P.torso * 3] = p[P.torso * 3]! * (1 - slack)
            p[P.head * 3 + 2] = (p[P.head * 3 + 2] ?? 0) + slack * 0.4
            if (c.twitch > 0 && c.t < 2.5 && Math.random() < dt * 8 * c.twitch) {
                p[P.armLL * 3] = p[P.armLL * 3]! - rnd(0, 0.6)
                p[P.legLR * 3] = p[P.legLR * 3]! + rnd(0, 0.5)
                fx.burst('electric', { x: c.x + rnd(-0.3, 0.3), y: c.y + 0.3, z: c.z + rnd(-0.3, 0.3) }, { count: 5 })
            }
            if (!c.landed && c.t >= fall) {
                c.landed = true
                const heavy = c.type === 'brute' ? 1.3 : c.type === 'bloater' ? 1.15 : 1
                const fx2 = c.x + Math.sin(c.yaw) * c.dir * 0.9
                const fz2 = c.z + Math.cos(c.yaw) * c.dir * 0.9
                if (time - fallSoundAt > 0.06) {
                    fallSoundAt = time
                    sound(DF_WORLD_SOUNDS.bodyFall, fx2, c.y + 0.2, fz2, 0.8 * heavy, rnd(0.9, 1.08) / heavy)
                }
                fx.burst('dust', { x: fx2, y: c.y + 0.05, z: fz2 }, { normal: { x: 0, y: 1, z: 0 }, count: 8, scale: heavy })
                if (time - decalAt > 0.05 && Math.random() < 0.7) {
                    decalAt = time
                    fx.decal({ x: fx2, y: c.y + 0.01, z: fz2 }, { x: 0, y: 1, z: 0 }, 'blood')
                }
            }
            writeRig(c.batch, c.slot, c.joints, c.dims, p, c.x, c.y, c.z, c.yaw, { headGone: c.headGone, helmet: c.helmet, eyeScale: 1 })
            void pxPerUnit
            return true
        }
        // Sink into the ground, shedding cubes as it crumbles away.
        const u = (c.t - LIE) / SINK
        if (u >= 1) return false
        const sink = smooth(u)
        p[r + 1] = c.dims.v * 2.2 - sink * 0.6
        const want = Math.floor(u * 6)
        while (c.crumbled < want) {
            c.crumbled++
            for (let i = 0; i < 3; i++) {
                const a = Math.random() * Math.PI * 2
                debris.spawn(c.x + Math.sin(c.yaw) * c.dir * rnd(0.2, 1.4) + Math.cos(a) * 0.2, c.y + 0.15, c.z + Math.cos(c.yaw) * c.dir * rnd(0.2, 1.4) + Math.sin(a) * 0.2, Math.cos(a) * 0.5, rnd(0.8, 1.6), Math.sin(a) * 0.5, c.dims.v * 0.8, 0x4a4436, c.y, 0.8)
            }
        }
        writeRig(c.batch, c.slot, c.joints, c.dims, p, c.x, c.y, c.z, c.yaw, { headGone: c.headGone, helmet: c.helmet, eyeScale: 1, scale: 1 - sink * 0.35 })
        return true
    }

    // ------------------------------------------------------------ per frame

    function updateLive(L: Live, s: DfZombieSnap, dt: number): void {
        L.seen = frame
        L.missing = 0
        L.x = s.pos.x
        L.y = s.pos.y
        L.z = s.pos.z
        L.hp = s.hp
        L.dist = distTo(L.x, L.y + 1, L.z)
        const tell = s.tell === 'lunge' ? 1 : s.tell === 'charge' ? 2 : 0
        if (tell !== L.input.tell) {
            L.input.tell = tell
            // A tell that starts while already in `attack` re-enters it for the cue.
            if (tell && s.anim === L.anim) enterAnim(L, s.anim, false)
        }
        if (s.anim !== L.anim) enterAnim(L, s.anim, false)
        else L.animTime += dt
        if (L.armored && s.armored !== true) knockHelmet(L)
        L.armored = s.armored === true
        L.shocked = s.shocked === true
        if (dt > 0) {
            let inst = Math.hypot(L.x - L.lastX, L.z - L.lastZ) / dt
            if (inst > 12) inst = L.speed
            L.speed += (inst - L.speed) * (1 - Math.exp(-dt / 0.15))
        }
        L.lastX = L.x
        L.lastZ = L.z
        L.yaw = angleLerp(L.yaw, s.yaw, 1 - Math.exp(-dt * 14))
        L.hitLimp = Math.max(0, L.hitLimp - dt * 0.15)
        const inp = L.input
        if (inp.swing >= 0) {
            const prev = inp.swing
            inp.swing += dt
            const mark = inp.windup * 0.9
            if (prev < mark && inp.swing >= mark && L.dist < 25) sound(DF_WORLD_SOUNDS.swipe, L.x, L.y + L.def.height * 0.6, L.z, 0.75, rnd(0.9, 1.1))
            if (inp.swing > inp.windup + 1.2) inp.swing = -1
        }
        if (inp.spit >= 0) {
            const prev = inp.spit
            inp.spit += dt
            if (prev < inp.spitWindup && inp.spit >= inp.spitWindup && voices.take('spit', time, L.dist)) sound(DF_WORLD_SOUNDS.spit, L.x, L.y + L.def.headY, L.z, 1, L.voice)
            if (inp.spit > inp.spitWindup + 1) inp.spit = -1
        }
        const prevPhase = L.phase
        poseLive(L, dt)
        stepHelmet(L, dt)
        // Brute footfalls twice per gait cycle; the odd bloater gurgle.
        if (L.type === 'brute' && L.speed > 0.4 && (L.anim === 'walk' || L.anim === 'run' || L.anim === 'sprint') && Math.floor(prevPhase * 2) !== Math.floor(L.phase * 2) && L.dist < 30) {
            sound(DF_WORLD_SOUNDS.bruteStep, L.x, L.y, L.z, 0.8, L.voice)
            if (L.dist < 8) fx.shake(0.02 * (1 - L.dist / 8))
        }
        if (L.type === 'bloater' && time >= L.gurgleAt) {
            L.gurgleAt = time + rnd(4, 8)
            if (L.dist < 20) sound(DF_WORLD_SOUNDS.bloaterGurgle, L.x, L.y + 1.1, L.z, 0.6, L.voice)
        }

        if (L.anim === 'tear' && time >= L.tearAt) {
            L.tearAt = time + rnd(1.8, 3.5)
            if (voices.take('tear', time, L.dist)) sound(dfAttackSound(L.type), L.x, L.y + L.def.headY, L.z, 0.45, L.voice)
        } else if (L.anim === 'rise' && L.riseFx > 0 && L.animTime > (4 - L.riseFx) * 0.3) {
            L.riseFx--
            fx.burst('dust', { x: L.x + rnd(-0.25, 0.25), y: L.y + 0.05, z: L.z + rnd(-0.25, 0.25) }, { normal: { x: 0, y: 1, z: 0 }, count: 6 })
        }

        if (L.type === 'bloater' && time >= L.leakAt) {
            L.leakAt = time + rnd(1.8, 4)
            fx.burst('gas', { x: L.x + Math.sin(L.yaw) * 0.35 + rnd(-0.15, 0.15), y: L.y + L.def.height * 0.5 + rnd(-0.1, 0.2), z: L.z + Math.cos(L.yaw) * 0.35 + rnd(-0.15, 0.15) }, { count: 2, scale: 0.4 })
        }

        // Tint: hit flash, shock flicker.
        L.flash = Math.max(0, L.flash - dt * 9)
        let tr = 1 + L.flash * 0.9
        let tg = 1 + L.flash * 0.5
        let tb = 1 + L.flash * 0.4
        // A bloater rearing to spit swells sickly green (pustules flare): the cue to move.
        if (L.anim === 'spit' && inp.spit >= 0 && inp.spit < inp.spitWindup + 0.15) {
            const u = clamp(inp.spit / inp.spitWindup, 0, 1)
            const pulse = u * (0.75 + 0.25 * Math.sin(time * 30))
            tr += pulse * 0.15
            tg += pulse * 0.9
            tb += pulse * 0.1
        }
        if (L.shocked) {
            if (time >= L.flickerAt) {
                L.flickerAt = time + rnd(0.04, 0.12)
                spring(L, S_HEAD_Z, rnd(-2, 2))
                spring(L, S_TORSO_Y, rnd(-2, 2))
            }
            const on = Math.sin(time * 60 + L.id) > 0
            if (on) {
                tr = 1.6
                tg = 2.0
                tb = 3.2
            }
            if (time >= L.sparkAt) {
                L.sparkAt = time + rnd(0.7, 1.6)
                fx.burst('electric', { x: L.x + rnd(-0.25, 0.25), y: L.y + rnd(0.4, L.def.height), z: L.z + rnd(-0.25, 0.25) }, { count: 5 })
            }
        }
        if (highlighted.has(L.id)) {
            // A slow ember glow that reads through the dark (the eyes flare with it).
            const h = 0.35 + 0.25 * Math.sin(time * 3.2 + L.id)
            tr += h * 1.1
            tg += h * 0.45
            tb += h * 0.2
        }
        L.batch.setColor(L.slot, tint.setRGB(tr * L.tr, tg * L.tg, tb * L.tb))
    }

    /** Idle groans: the nearest due zombie may speak; everyone else waits a while. */
    function groans(): void {
        let best: Live | null = null
        for (const L of alive.values()) {
            if (time < L.groanAt) continue
            if (L.anim === 'attack' || L.anim === 'rise') {
                L.groanAt = time + rnd(1, 3)
                continue
            }
            if (!best || L.dist < best.dist) best = L
        }
        if (!best) return
        if (voices.take('groan', time, best.dist)) {
            sound(dfGroanSound(best.type), best.x, best.y + best.def.headY, best.z, best.type === 'brute' ? 0.9 : 0.7, best.voice)
            best.groanAt = time + rnd(7, 16)
        } else {
            best.groanAt = time + rnd(1.5, 4.5)
        }
    }

    return {
        update(dt, zombies) {
            const step = Math.min(Math.max(dt, 0), 0.1)
            time += step
            frame++
            camera.getWorldPosition(camPos)
            if (frame % 60 === 0) {
                for (const [id, until] of deadIds) {
                    if (time > until) deadIds.delete(id)
                }
            }
            ctx.renderer.getDrawingBufferSize(bufSize)
            const pxPerUnit = bufSize.y * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)

            for (const s of zombies) {
                if (deadIds.has(s.id)) continue
                let L = alive.get(s.id)
                if (L && L.type !== s.type) {
                    despawn(L)
                    L = undefined
                }
                if (!L) {
                    const made = makeLive(s)
                    if (!made) continue
                    L = made
                    alive.set(s.id, L)
                }
                updateLive(L, s, step)
            }
            for (const L of alive.values()) {
                if (L.seen === frame) continue
                L.missing += step
                if (L.missing > DESPAWN_GRACE) despawn(L)
            }
            groans()
            for (const L of alive.values()) writeLive(L, pxPerUnit)
            for (let i = corpses.length - 1; i >= 0; i--) {
                const c = corpses[i]!
                if (!stepCorpse(c, step, pxPerUnit)) removeCorpse(c)
            }
            for (let i = gibs.length - 1; i >= 0; i--) {
                const g = gibs[i]!
                if (!stepGib(g, step)) removeGib(g)
            }
            for (const b of batches.values()) b.commit()
            debris.update(step)
            gas.update(step)
        },
        onEvent(ev) {
            switch (ev.k) {
                case 'hit': {
                    const L = alive.get(ev.z)
                    if (L) onHit(L, ev)
                    break
                }
                case 'zhit': {
                    const L = alive.get(ev.z)
                    if (L) {
                        spring(L, S_TORSO_X, 5)
                        spring(L, S_HEAD_X, 3)
                    }
                    break
                }
                case 'kill': {
                    const L = alive.get(ev.z)
                    if (L) kill(L, ev)
                    else deadIds.set(ev.z, time + 5)
                    break
                }
                case 'gas': {
                    gas.spawn(ev.pos.x, ev.pos.y, ev.pos.z, ev.radius, ev.seconds)
                    sound(DF_WORLD_SOUNDS.gas, ev.pos.x, ev.pos.y + 0.5, ev.pos.z, 1)
                    fx.burst('gas', { x: ev.pos.x, y: ev.pos.y + 0.6, z: ev.pos.z }, { count: 16, scale: ev.radius * 0.5 })
                    break
                }
                default:
                    break
            }
        },
        highlight(ids) {
            highlighted.clear()
            for (const id of ids) highlighted.add(id)
        },
        unkill(id) {
            // the engine predicted this kill but the server kept the zombie: let it show again
            deadIds.delete(id)
        },
        dispose() {
            alive.clear()
            highlighted.clear()
            corpses.length = 0
            gibs.length = 0
            for (const b of batches.values()) b.dispose()
            batches.clear()
            debris.dispose()
            gas.dispose()
            debrisMat.dispose()
        }
    }
}
