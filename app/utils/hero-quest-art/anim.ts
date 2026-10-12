// Keyframed pose animation.
//
// A pose is a fixed-length Float32Array of parameters (hand position, weapon angle, lean…).
// A clip is a list of keyframes over those parameters; sampling eases between keys and then
// the drawer rounds to whole pixels. Sampling time is quantized to ANIM_FPS first, 30 fps: smooth
// enough that big motions glide, while whole pixels and held poses keep the pixel feel.
//
// Sampling writes into a caller-owned pose and never allocates.

/** Frame rate every sprite animation is sampled and exported at: 30 (10 until 2026-09-27). The art gallery can change it to compare. */
// a live binding on purpose: every importer reads the rate the gallery last set
// eslint-disable-next-line import/no-mutable-exports
export let ANIM_FPS = 30

/**
 * The rate art with a fixed frame count was authored at, and still plays at: world backgrounds
 * (a 16-frame loop), UI and feedback loops. They stay at 10 whatever ANIM_FPS is, or a higher
 * rate squeezes their loops and they run too fast.
 */
export const AUTHORED_FPS = 10

/** Resample every animation at `fps`. Dev comparison only; assets built before the call keep their old rate, so rebuild them (`resetArt`). */
export function setAnimFps(fps: number): void {
    ANIM_FPS = fps
}

export const enum Ease { Linear, InOut, Out, In, Back, Hold }

function ease(kind: Ease, u: number): number {
    switch (kind) {
        case Ease.Linear: return u
        case Ease.InOut: return u * u * (3 - 2 * u)
        case Ease.Out: return 1 - (1 - u) * (1 - u)
        case Ease.In: return u * u
        case Ease.Back: { const s = 1.7; const v = u - 1; return 1 + v * v * ((s + 1) * v + s) }
        case Ease.Hold: return 0
    }
}

/**
 * The action phases every attack and cast is authored in. A looping preview walks
 * Idle → Charge → Cast → Recover → Idle; the game fires its hit at the Cast boundary.
 */
export const enum Phase { Idle, Charge, Cast, Recover }

export interface Clip {
    readonly name: string
    readonly dur: number
    readonly loop: boolean
    readonly times: Float32Array
    readonly values: Float32Array
    readonly eases: Uint8Array
    readonly phases: Uint8Array
    readonly np: number
    /** Seconds at which the strike lands / the projectile leaves (start of the Cast phase). */
    readonly impact: number
}

export type KeySpec<P extends string> = readonly [t: number, pose: Partial<Record<P, number>>, ease?: Ease, phase?: Phase]

/**
 * Compile keyframes. Each key inherits every parameter it doesn't name from the key before
 * it (the first from `rest`), so a key only has to state what moves.
 */
export function compileClip<P extends string>(
    name: string, index: Readonly<Record<P, number>>, rest: Float32Array,
    dur: number, loop: boolean, keys: readonly KeySpec<P>[]
): Clip {
    const np = rest.length
    const times = new Float32Array(keys.length)
    const values = new Float32Array(keys.length * np)
    const eases = new Uint8Array(keys.length)
    const phases = new Uint8Array(keys.length)
    let prev = rest
    let impact = -1
    keys.forEach(([t, pose, e, ph], k) => {
        times[k] = t
        const row = values.subarray(k * np, (k + 1) * np)
        row.set(prev)
        for (const [p, v] of Object.entries(pose) as [P, number][]) row[index[p]] = v
        eases[k] = e ?? Ease.InOut
        phases[k] = ph ?? (k > 0 ? phases[k - 1]! : Phase.Idle)
        if (impact < 0 && phases[k] === Phase.Cast) impact = t
        prev = row
    })
    return { name, dur, loop, times, values, eases, phases, np, impact: impact < 0 ? dur * 0.5 : impact }
}

/** Quantize a clock to the animation frame grid. */
export function frameTime(t: number): number {
    return Math.floor(t * ANIM_FPS + 1e-6) / ANIM_FPS
}

export function frameCount(clip: Clip): number {
    return Math.max(1, Math.round(clip.dur * ANIM_FPS))
}

/** Sample `clip` at time `t` (already quantized or not) into `out`. */
export function sample(clip: Clip, t: number, out: Float32Array, quantize = true): void {
    if (quantize) t = frameTime(t)
    const n = clip.times.length
    const np = clip.np
    if (clip.loop && clip.dur > 0) t = ((t % clip.dur) + clip.dur) % clip.dur
    if (n === 1 || t <= clip.times[0]!) { for (let p = 0; p < np; p++) out[p] = clip.values[p]!; return }
    if (t >= clip.times[n - 1]!) { const o = (n - 1) * np; for (let p = 0; p < np; p++) out[p] = clip.values[o + p]!; return }
    let k = 0
    while (k < n - 2 && t >= clip.times[k + 1]!) k++
    const t0 = clip.times[k]!
    const t1 = clip.times[k + 1]!
    const u = ease(clip.eases[k + 1]! as Ease, t1 > t0 ? (t - t0) / (t1 - t0) : 1)
    const a = k * np
    const b = (k + 1) * np
    for (let p = 0; p < np; p++) out[p] = clip.values[a + p]! + (clip.values[b + p]! - clip.values[a + p]!) * u
}

export function phaseAt(clip: Clip, t: number): Phase {
    const n = clip.times.length
    let k = 0
    while (k < n - 1 && t >= clip.times[k + 1]!) k++
    return clip.phases[k]! as Phase
}

/** Build a pose-parameter index from names: { lean: 0, crouch: 1, … }. */
export function paramIndex<const N extends readonly string[]>(names: N): Readonly<Record<N[number], number>> {
    return Object.fromEntries(names.map((n, i) => [n, i])) as Record<N[number], number>
}

/** A rest pose from a partial spec. */
export function restPose<P extends string>(index: Readonly<Record<P, number>>, spec: Partial<Record<P, number>>): Float32Array {
    const out = new Float32Array(Object.keys(index).length)
    for (const [p, v] of Object.entries(spec) as [P, number][]) out[index[p]] = v
    return out
}

/** Whole-pixel sine sampled on the frame grid, for idle loops that aren't keyframed. */
export function wave(t: number, period: number, amp: number, phase = 0): number {
    return Math.round(Math.sin((frameTime(t) / period + phase) * Math.PI * 2) * amp)
}

/** Frame counter: which of `n` frames at `fps` is showing at `t`. */
export function step(t: number, fps: number, n: number): number {
    return Math.floor(t * fps + 1e-6) % n
}
