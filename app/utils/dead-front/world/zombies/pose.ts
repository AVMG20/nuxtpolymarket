import { DF_ENEMIES } from '#shared/utils/dead-front/enemies'
import type { DfZombieAnim } from '#shared/utils/dead-front/protocol'
import type { DfEnemyType } from '#shared/utils/dead-front/types'
import { DF_ZOMBIE_PARTS, P } from './models'

// Procedural zombie animation. A pose is an Euler rotation (x, y, z) per part
// plus a root offset and tilt; every animation state is a small function of
// time, gait phase and a few per-zombie quirks. Conventions (model faces +z):
// +x on the torso leans forward, -x on a limb swings it forward, +x on a knee
// or elbow bends it.
//
// Crawlers (legs blown off) lie face down along their facing and drag
// themselves by the arms; every anim has a prone variant. The body lands where
// `dfCrawlGeometry` puts the shared hitboxes.

export const DF_POSE_ROOT = DF_ZOMBIE_PARTS * 3
/** rootX, rootY, rootZ, pitch, roll, yaw offset. */
export const DF_POSE_LEN = DF_POSE_ROOT + 6

export type DfPose = Float32Array

export function dfNewPose(): DfPose {
    return new Float32Array(DF_POSE_LEN)
}

export interface DfPoseInput {
    type: DfEnemyType
    anim: DfZombieAnim
    /** Seconds in the current anim. */
    t: number
    /** Gait phase in cycles. */
    phase: number
    /** 0..1 how fast it is moving relative to a run. */
    move: number
    /** 0..1 limp. */
    limp: number
    limpSide: number
    /** 0 arms hang, 1 one arm reaches, 2 both reach. */
    arms: number
    hunch: number
    tilt: number
    seed: number
    /** Seconds since the swing started (-1 none), its windup and the spit clock. */
    swing: number
    windup: number
    spit: number
    spitWindup: number
    tearPeriod: number
    height: number
    /** Special-attack telegraph: 0 none, 1 ghoul crouch before a leap, 2 brute roar before a charge. */
    tell: number
    /** Legs blown off: prone, dragging itself (every anim has a crawling variant). */
    crawl?: boolean
    /** Seconds since the legs came off: it topples onto its front over the first `DF_CRAWL_FALL`. */
    down?: number
}

const TAU = Math.PI * 2

function set(p: DfPose, part: number, x: number, y = 0, z = 0): void {
    p[part * 3] = x
    p[part * 3 + 1] = y
    p[part * 3 + 2] = z
}

function add(p: DfPose, part: number, x: number, y = 0, z = 0): void {
    p[part * 3] = p[part * 3]! + x
    p[part * 3 + 1] = p[part * 3 + 1]! + y
    p[part * 3 + 2] = p[part * 3 + 2]! + z
}

function smooth(x: number): number {
    const t = Math.max(0, Math.min(1, x))
    return t * t * (3 - 2 * t)
}

function bump(u: number, a: number, b: number, ramp = 0.15): number {
    return smooth((u - a) / ramp) * (1 - smooth((u - (b - ramp)) / ramp))
}

/** Locomotion: walk / run / sprint blended by `move`. */
function gait(p: DfPose, inp: DfPoseInput, kind: 'walk' | 'run' | 'sprint'): void {
    const ph = inp.phase * TAU
    const s = Math.sin(ph)
    const c = Math.cos(ph)
    const amp = 0.25 + inp.move * 0.75
    const big = kind === 'walk' ? 0.42 : kind === 'run' ? 0.7 : 0.9
    const knee = kind === 'walk' ? 0.65 : kind === 'run' ? 1.1 : 1.35
    const lean = (kind === 'walk' ? 0.16 : kind === 'run' ? 0.34 : 0.5) + inp.hunch + (inp.type === 'ghoul' ? 0.25 : 0)
    const limpL = inp.limpSide > 0 ? 1 - inp.limp * 0.6 : 1
    const limpR = inp.limpSide > 0 ? 1 : 1 - inp.limp * 0.6
    set(p, P.legUL, -s * big * amp * limpL - 0.05)
    set(p, P.legUR, s * big * amp * limpR - 0.05)
    set(p, P.legLL, Math.max(0, c) * knee * amp + 0.08)
    set(p, P.legLR, Math.max(0, -c) * knee * amp + 0.08)
    set(p, P.pelvis, 0, s * 0.12 * amp, -s * 0.05 * amp + inp.limp * 0.08 * inp.limpSide)
    set(p, P.torso, lean, -s * 0.1 * amp, s * 0.07 * amp + inp.tilt * 0.3)
    p[DF_POSE_ROOT + 1] = Math.abs(c) * 0.035 * amp * (kind === 'walk' ? 1 : 1.6) - inp.limp * Math.max(0, -s * inp.limpSide) * 0.04
    // Arms: zombie reach, one-arm reach, or hanging; pumping when sprinting.
    const sway = s * 0.12
    if (kind === 'sprint' && inp.type !== 'ghoul') {
        set(p, P.armUL, s * 0.9 - 0.3, 0, -0.15)
        set(p, P.armUR, -s * 0.9 - 0.3, 0, 0.15)
        set(p, P.armLL, -1.1)
        set(p, P.armLR, -1.1)
    } else if (inp.arms >= 2 || inp.type === 'ghoul') {
        const reach = inp.type === 'ghoul' ? -1.0 - lean * 0.6 : -1.35
        set(p, P.armUL, reach + sway, 0.1, -0.12)
        set(p, P.armUR, reach - sway * 1.2, -0.1, 0.12)
        set(p, P.armLL, -0.25 - Math.max(0, s) * 0.2)
        set(p, P.armLR, -0.2 - Math.max(0, -s) * 0.2)
    } else if (inp.arms === 1) {
        set(p, P.armUL, s * 0.3 * amp, 0, -0.08)
        set(p, P.armUR, -1.3 - sway, -0.1, 0.1)
        set(p, P.armLL, -0.15)
        set(p, P.armLR, -0.3)
    } else {
        set(p, P.armUL, s * 0.35 * amp - 0.1, 0, -0.1)
        set(p, P.armUR, -s * 0.35 * amp - 0.1, 0, 0.1)
        set(p, P.armLL, -0.2)
        set(p, P.armLR, -0.2)
    }
    set(p, P.head, -lean * 0.6 - 0.05 + Math.abs(s) * 0.05, s * 0.08, inp.tilt)
}

/** The ghoul's tell: sinks into a deep, trembling crouch, arms swept back, head low and forward. */
function crouch(p: DfPose, t: number, seed: number): void {
    const k = smooth(t / 0.22)
    const tremble = Math.sin(t * 47 + seed * 20) * 0.04 * k
    set(p, P.torso, 0.85 * k + tremble, 0, 0)
    set(p, P.head, -0.9 * k, tremble * 2, 0)
    set(p, P.legUL, -1.25 * k, 0, -0.12 * k)
    set(p, P.legUR, -1.05 * k, 0, 0.12 * k)
    set(p, P.legLL, 2.0 * k)
    set(p, P.legLR, 1.8 * k)
    set(p, P.armUL, 0.9 * k, 0, -0.5 * k)
    set(p, P.armUR, 0.9 * k, 0, 0.5 * k)
    set(p, P.armLL, -0.6 * k)
    set(p, P.armLR, -0.6 * k)
    p[DF_POSE_ROOT + 1] = -0.32 * k
    p[DF_POSE_ROOT + 2] = -0.08 * k
}

/** The brute's tell: rears back, arms flung wide, and bellows at the sky, shaking. */
function roar(p: DfPose, t: number, seed: number): void {
    const k = smooth(t / 0.25)
    const shake = Math.sin(t * 38 + seed * 13) * 0.05 * k
    set(p, P.torso, -0.35 * k + shake, shake, 0)
    set(p, P.head, -0.55 * k, shake * 2, shake)
    set(p, P.armUL, -0.5 * k, 0, -1.35 * k + shake)
    set(p, P.armUR, -0.5 * k, 0, 1.35 * k - shake)
    set(p, P.armLL, -1.1 * k)
    set(p, P.armLR, -1.1 * k)
    set(p, P.legUL, -0.3 * k, 0, -0.2 * k)
    set(p, P.legUR, 0.2 * k, 0, 0.2 * k)
    set(p, P.legLL, 0.45 * k)
    set(p, P.legLR, 0.3 * k)
    p[DF_POSE_ROOT + 1] = -0.06 * k
}

// ---------------------------------------------------------------- crawlers

/**
 * The prone body in voxels from the feet position (forward along the facing,
 * up): the hip joint, the chest lift off the ground and the head's forward
 * lean from vertical. `dfCrawlGeometry` (the hitboxes) is built to the same
 * layout; the zombie-models test keeps the two together.
 */
const CRAWL = {
    hipZ: -0.9,
    hipY: 2.3,
    chest: 0.28,
    headLean: 0.62,
    /** Hand plant range ahead of the shoulder, its height, and the lift while reaching. */
    front: 10,
    back: 4.2,
    plant: 0.9,
    lift: 2.4,
    /** Share of each arm's cycle spent planted and pulling. */
    pull: 0.55
} as const

/** Seconds a zombie takes to topple onto its front when its legs come off. */
export const DF_CRAWL_FALL = 0.5

/** Ground covered per crawl cycle (both arms pull once), in voxels. */
const CRAWL_STRIDE = 2 * (CRAWL.front - CRAWL.back)

/** Shoulder joint out from the spine, in voxels (near enough for every type). */
const SHOULDER_X = 4.5
const UPPER_ARM = 5
const FOREARM = 6
const HALF_PI = Math.PI / 2

const ik = { a: 0, e: 0 }
/** The last crawl pose's shoulder height (voxels). */
let shoulderY = 0

/**
 * Two-bone arm IK in the body's side plane: hand target `fwd` ahead of and
 * `up` above the shoulder (voxels). Sets `ik.a` (the upper arm's absolute
 * pitch: 0 hangs down, -pi/2 points forward) and `ik.e` (elbow bend). The
 * elbows ride high, the zombie crawl.
 */
function armIk(fwd: number, up: number): void {
    const d = Math.max(FOREARM - UPPER_ARM + 0.3, Math.min(UPPER_ARM + FOREARM - 0.05, Math.hypot(fwd, up)))
    const base = Math.atan2(-fwd, -up)
    const alpha = Math.acos(Math.max(-1, Math.min(1, (UPPER_ARM * UPPER_ARM + d * d - FOREARM * FOREARM) / (2 * UPPER_ARM * d))))
    const gamma = Math.acos(Math.max(-1, Math.min(1, (UPPER_ARM * UPPER_ARM + FOREARM * FOREARM - d * d) / (2 * UPPER_ARM * FOREARM))))
    ik.a = base - alpha
    ik.e = Math.PI - gamma
}

/** Places the root so the hip joint sits `hz` ahead of and `hy` above the feet (voxels), the body pitched forward by `pitch`. */
function placeHip(p: DfPose, v: number, hz: number, hy: number, pitch: number): void {
    // root = T(offset) * Rx(pitch): the hip joint (0, 12, 0) lands at (0, 12 cos, 12 sin)
    p[DF_POSE_ROOT + 1] = (hy - 12 * Math.cos(pitch)) * v
    p[DF_POSE_ROOT + 2] = (hz - 12 * Math.sin(pitch)) * v
    p[DF_POSE_ROOT + 3] = pitch
}

/** One arm planted at (fwd, up) from the shoulder; `chest` is the torso's lift, `spread` swings the arm out sideways. */
function crawlArm(p: DfPose, upper: number, lower: number, fwd: number, up: number, chest: number, spread: number): void {
    // the arm splayed out sideways reaches less far in the side plane
    const k = 1 / Math.cos(spread)
    armIk(fwd * k, up * k)
    // absolute pitch = root (pi/2) + torso (-chest) + arm
    set(p, upper, ik.a - HALF_PI + chest, 0, spread)
    set(p, lower, ik.e)
}

/**
 * The crawl: face down, chest a little off the ground, head up and looking
 * ahead; the arms take turns reaching out, clawing in and dragging the body
 * forward while the thigh stumps trail and wag behind. `rear` lifts the chest
 * further (the swipe). Returns the chest lift.
 */
function crawlPose(p: DfPose, inp: DfPoseInput, rear: number): number {
    const v = DF_ENEMIES[inp.type].headY / 23
    const ph = inp.phase * TAU
    const s = Math.sin(ph)
    const hy = (inp.type === 'ghoul' ? CRAWL.hipY - 0.4 : CRAWL.hipY) + Math.abs(s) * 0.25
    const chest = CRAWL.chest + Math.abs(Math.cos(ph)) * 0.05 + rear
    placeHip(p, v, CRAWL.hipZ, hy, HALF_PI)
    // the shoulders roll and swing toward the pulling arm, the hips the other way
    set(p, P.pelvis, 0, 0, -s * 0.1)
    const roll = s * 0.1
    set(p, P.torso, -chest, roll, s * 0.14 + inp.tilt * 0.15)
    set(p, P.head, CRAWL.headLean - (HALF_PI - chest) - rear * 0.3, -s * 0.12, inp.tilt * 0.5)
    // shoulder height in voxels (the roll lifts one shoulder, drops the other)
    const sy = hy + 5.5 * Math.sin(chest)
    shoulderY = sy
    const lean = SHOULDER_X * Math.sin(roll)
    for (const side of [0, 1]) {
        const u = (inp.phase + side * 0.5 + inp.seed) % 1
        let fwd: number
        let y: number
        if (u < CRAWL.pull) {
            const k = u / CRAWL.pull
            fwd = CRAWL.front + (CRAWL.back - CRAWL.front) * k
            y = CRAWL.plant
        } else {
            const k = (u - CRAWL.pull) / (1 - CRAWL.pull)
            fwd = CRAWL.back + (CRAWL.front - CRAWL.back) * smooth(k)
            y = CRAWL.plant + CRAWL.lift * Math.sin(k * Math.PI)
        }
        crawlArm(p, side ? P.armUR : P.armUL, side ? P.armLR : P.armLL, fwd, y - sy - (side ? lean : -lean), chest, side ? 0.22 : -0.22)
    }
    // thigh stumps trail behind, splayed, drooping to the ground and dragging
    set(p, P.legUL, -0.06 + s * 0.06, 0, -0.18 - s * 0.06)
    set(p, P.legUR, -0.06 - s * 0.06, 0, 0.18 - s * 0.06)
    return chest
}

/** Every anim's prone variant, toppling onto the front first when the legs just came off. */
function crawlAnim(p: DfPose, inp: DfPoseInput): void {
    const t = inp.t
    if (inp.anim === 'attack') {
        // Rears its chest up and claws down at the ankles with one arm.
        const w = Math.max(0.15, inp.windup)
        const u = inp.swing >= 0 ? inp.swing / w : 2
        const raise = smooth(u / 0.85) * (1 - smooth((u - 1) / 0.12))
        const strike = u >= 1 ? 1 - smooth((u - 1.15) / 0.8) : 0
        const chest = crawlPose(p, inp, 0.22 * raise + 0.08 * strike)
        const right = Math.floor(inp.seed * 10) % 2 === 0
        const a = right ? P.armUR : P.armUL
        const b = right ? P.armLR : P.armLL
        // absolute arm pitch: up and forward on the windup, slammed down ahead on the strike
        const base = p[a * 3]! + HALF_PI - chest
        const elbow = p[b * 3]!
        // the strike lands on the ground at full stretch
        const k = 1 / Math.cos(0.3)
        armIk(CRAWL.front * k, (CRAWL.plant + 1 - shoulderY) * k)
        const abs = (base + (-2.7 - base) * raise) * (1 - strike) + ik.a * strike
        set(p, a, abs - HALF_PI + chest, 0, right ? 0.3 : -0.3)
        set(p, b, (elbow + (0.9 - elbow) * raise) * (1 - strike) + ik.e * strike)
        add(p, P.head, -0.1 * raise + 0.15 * strike)
    } else if (inp.anim === 'stagger') {
        // Writhes: rolls and thrashes, head thrown back.
        crawlPose(p, inp, 0)
        const k = Math.exp(-t * 2.5)
        const wob = Math.sin(t * 13) * k
        add(p, P.torso, 0, wob * 0.35, wob * 0.2)
        add(p, P.head, -0.5 * k, -wob * 0.3, wob * 0.3)
        add(p, P.armUL, -0.6 * k + wob * 0.3, 0, -0.4 * k)
        add(p, P.armUR, -0.4 * k - wob * 0.3, 0, 0.4 * k)
        add(p, P.legUL, wob * 0.3)
        add(p, P.legUR, -wob * 0.3)
    } else {
        crawlPose(p, inp, 0)
    }
    const down = inp.down ?? DF_CRAWL_FALL
    if (down >= DF_CRAWL_FALL) return
    // Legs gone: it drops onto the stumps and topples forward, arms thrown out to catch itself.
    const v = DF_ENEMIES[inp.type].headY / 23
    const k = Math.max(0, down / DF_CRAWL_FALL) ** 2
    // prone, the root's height offset is the hip height (cos pi/2 = 0)
    const hy = p[DF_POSE_ROOT + 1]! / v
    placeHip(p, v, CRAWL.hipZ * k, 6 + (hy - 6) * k, HALF_PI * k)
    for (const [part, x] of FALL_START) p[part * 3] = x + (p[part * 3]! - x) * k
}

/** The limbs' pitch the moment the legs come off (the fall eases from these into the crawl). */
const FALL_START: [number, number][] = [
    [P.torso, 0.3], [P.head, 0.15], [P.armUL, -1.5], [P.armUR, -1.5], [P.armLL, -0.3], [P.armLR, -0.3], [P.legUL, 0], [P.legUR, 0]
]

/** Evaluates the pose for the current state into `out`. */
export function dfEvalPose(inp: DfPoseInput, out: DfPose): DfPose {
    out.fill(0)
    if (inp.crawl) {
        crawlAnim(out, inp)
        return out
    }
    const t = inp.t
    switch (inp.anim) {
        case 'walk':
            gait(out, inp, 'walk')
            break
        case 'run':
            gait(out, inp, 'run')
            break
        case 'sprint':
            gait(out, inp, 'sprint')
            break
        case 'attack': {
            if (inp.tell === 1) {
                crouch(out, t, inp.seed)
                break
            }
            if (inp.tell === 2) {
                roar(out, t, inp.seed)
                break
            }
            gait(out, { ...inp, move: inp.move * 0.4 }, 'walk')
            const w = Math.max(0.15, inp.windup)
            const u = inp.swing >= 0 ? inp.swing / w : 2
            // Wind up overhead, slash down across the body, recover.
            const raise = smooth(u / 0.85) * (1 - smooth((u - 1) / 0.12))
            const strike = u >= 1 ? 1 - smooth((u - 1.15) / 0.8) : 0
            const right = Math.floor(inp.seed * 10) % 2 === 0
            const a = right ? P.armUR : P.armUL
            const b = right ? P.armLR : P.armLL
            set(out, a, -2.7 * raise - 0.7 * strike, (right ? -0.4 : 0.4) * raise, (right ? 0.3 : -0.3) * raise)
            set(out, b, -0.5 * raise)
            add(out, P.torso, -0.15 * raise + 0.45 * strike, (right ? 0.35 : -0.35) * raise - (right ? 0.5 : -0.5) * strike, 0)
            add(out, P.head, 0.15 * strike - 0.2 * raise)
            const o = right ? P.armUL : P.armUR
            set(out, o, -1.0, 0, right ? -0.2 : 0.2)
            break
        }
        case 'tear': {
            const period = Math.max(0.4, inp.tearPeriod)
            const u = (t / period + inp.seed * 0.3) % 1
            const l = Math.sin(u * TAU)
            set(out, P.torso, 0.45 + Math.max(0, l) * 0.1, l * 0.2, 0)
            set(out, P.armUL, -1.75 + l * 0.6, 0.2, -0.1)
            set(out, P.armUR, -1.75 - l * 0.6, -0.2, 0.1)
            set(out, P.armLL, -0.4 - Math.max(0, -l) * 0.6)
            set(out, P.armLR, -0.4 - Math.max(0, l) * 0.6)
            set(out, P.legUL, -0.25)
            set(out, P.legUR, 0.15)
            set(out, P.legLL, 0.35)
            set(out, P.legLR, 0.2)
            set(out, P.head, -0.4, l * 0.15)
            out[DF_POSE_ROOT + 1] = -0.04
            break
        }
        case 'climb': {
            const u = Math.min(1, t / 1.1)
            const step = Math.sin(u * Math.PI)
            set(out, P.torso, 0.75 - u * 0.4, 0, 0)
            set(out, P.legUL, -1.3 * step - 0.2, 0, 0)
            set(out, P.legLL, 1.6 * step + 0.2)
            set(out, P.legUR, 0.3 - 0.9 * smooth((u - 0.4) / 0.5))
            set(out, P.legLR, 0.4 + 1.2 * bump(u, 0.4, 1))
            set(out, P.armUL, -1.0 - step * 0.4, 0, -0.2)
            set(out, P.armUR, -1.2 - step * 0.3, 0, 0.2)
            set(out, P.armLL, -0.6)
            set(out, P.armLR, -0.5)
            set(out, P.head, -0.5)
            out[DF_POSE_ROOT + 1] = step * 0.35
            break
        }
        case 'spit': {
            const w = Math.max(0.2, inp.spitWindup)
            const u = inp.spit >= 0 ? inp.spit / w : 2
            const back = smooth(u) * (1 - smooth((u - 1) / 0.1))
            const lunge = u >= 1 ? 1 - smooth((u - 1.1) / 0.7) : 0
            const quiver = Math.sin(t * 31) * 0.035 * back
            set(out, P.torso, -0.6 * back + 0.65 * lunge + quiver, 0, quiver)
            set(out, P.head, -0.7 * back + 0.6 * lunge, 0, 0)
            out[DF_POSE_ROOT + 1] = -0.05 * back
            set(out, P.armUL, -0.4 - 0.6 * back, 0, -0.5 * back)
            set(out, P.armUR, -0.4 - 0.6 * back, 0, 0.5 * back)
            set(out, P.armLL, -0.6)
            set(out, P.armLR, -0.6)
            set(out, P.legUL, -0.15)
            set(out, P.legUR, 0.15)
            set(out, P.legLL, 0.25)
            set(out, P.legLR, 0.25)
            break
        }
        case 'stagger': {
            const k = Math.exp(-t * 2.5)
            const wob = Math.sin(t * 13) * k
            set(out, P.torso, -0.45 * k, wob * 0.3, wob * 0.25)
            set(out, P.head, -0.4 * k, -wob * 0.3, wob * 0.3)
            set(out, P.armUL, -0.6 * k - 0.3, 0, -0.9 * k)
            set(out, P.armUR, -0.4 * k - 0.3, 0, 0.9 * k)
            set(out, P.armLL, -0.5)
            set(out, P.armLR, -0.5)
            set(out, P.legUL, 0.4 * k)
            set(out, P.legUR, -0.2 * k)
            set(out, P.legLL, 0.4 * k)
            set(out, P.legLR, 0.2 * k)
            break
        }
        case 'rise': {
            const u = Math.min(1, t / 1.6)
            const e = smooth(u)
            const claw = Math.sin(t * 9 + inp.seed * 7)
            set(out, P.armUL, -2.6 + e * 1.6 + claw * 0.2, 0, -0.2)
            set(out, P.armUR, -2.6 + e * 1.4 - claw * 0.2, 0, 0.2)
            set(out, P.armLL, -0.4 - claw * 0.2)
            set(out, P.armLR, -0.4 + claw * 0.2)
            set(out, P.torso, 0.5 * (1 - e) + 0.15, Math.sin(t * 3) * 0.2 * (1 - e), 0)
            set(out, P.head, -0.5 * (1 - e), 0, inp.tilt)
            set(out, P.legLL, 0.8 * (1 - e))
            set(out, P.legLR, 0.8 * (1 - e))
            out[DF_POSE_ROOT + 1] = -inp.height * (1 - smooth(u / 0.85)) * 0.95
            break
        }
    }
    return out
}

/** out = a + (b - a) * t */
export function dfLerpPose(a: DfPose, b: DfPose, t: number, out: DfPose): DfPose {
    for (let i = 0; i < DF_POSE_LEN; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t
    return out
}

/** Gait cycles per second for a ground speed (a crawler's cycle is one pull of each arm). */
export function dfCadence(type: DfEnemyType, speed: number, crawl = false): number {
    if (crawl) return speed / (CRAWL_STRIDE * DF_ENEMIES[type].headY / 23)
    const stride = type === 'brute' ? 1.5 : type === 'ghoul' ? 1.4 : type === 'bloater' ? 1.0 : 1.15
    return Math.max(0.35, speed / stride)
}
