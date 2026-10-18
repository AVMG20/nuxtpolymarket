import type { DfZombieAnim } from '#shared/utils/dead-front/protocol'
import type { DfEnemyType } from '#shared/utils/dead-front/types'
import { P } from './models'

// Procedural zombie animation. A pose is an Euler rotation (x, y, z) per part
// plus a root offset and tilt; every animation state is a small function of
// time, gait phase and a few per-zombie quirks. Conventions (model faces +z):
// +x on the torso leans forward, -x on a limb swings it forward, +x on a knee
// or elbow bends it.

export const DF_POSE_ROOT = 13 * 3
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

/** Evaluates the pose for the current state into `out`. */
export function dfEvalPose(inp: DfPoseInput, out: DfPose): DfPose {
    out.fill(0)
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

/** Gait cycles per second for a ground speed. */
export function dfCadence(type: DfEnemyType, speed: number): number {
    const stride = type === 'brute' ? 1.5 : type === 'ghoul' ? 1.4 : type === 'bloater' ? 1.0 : 1.15
    return Math.max(0.35, speed / stride)
}
