import {
    clamp, decayEnv, filterNode, gainNode, holdEnv, noise, oscNode, randomWalk, rnd
} from './noise'
import type { NoiseKind, Rt } from './noise'

// Reusable sound "parts": thuds, cracks, click trains, creaks, metal rings,
// bells, whooshes. Frequencies are multiplied by r.rate and gains by r.vol.

export interface BurstOpts {
    kind?: NoiseKind
    type?: BiquadFilterType
    freq: number
    /** Exponential sweep target over the burst. */
    freqEnd?: number
    q?: number
    gain: number
    attack?: number
    dur: number
}

/** Filtered noise burst with a decaying envelope. */
export function noiseBurst(r: Rt, o: BurstOpts): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const f = filterNode(ctx, o.type ?? 'bandpass', o.freq * r.rate, o.q ?? 1, g)
    f.frequency.setValueAtTime(clamp(o.freq * r.rate, 20, 20000), t)
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(clamp(o.freqEnd * r.rate, 20, 20000), t + o.dur)
    noise(ctx, o.kind ?? 'white', t, o.dur + 0.05, f)
    decayEnv(g.gain, t, o.gain * r.vol, o.attack ?? 0.002, o.dur)
}

export interface SwellOpts extends BurstOpts {
    /** Fraction of dur where the swell peaks (0..1). */
    peakAt?: number
}

/** Filtered noise that swells up and fades out (whooshes, hisses, rumbles). */
export function noiseSwell(r: Rt, o: SwellOpts): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const f = filterNode(ctx, o.type ?? 'bandpass', o.freq * r.rate, o.q ?? 1, g)
    f.frequency.setValueAtTime(clamp(o.freq * r.rate, 20, 20000), t)
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(clamp(o.freqEnd * r.rate, 20, 20000), t + o.dur)
    noise(ctx, o.kind ?? 'white', t, o.dur + 0.05, f)
    const pk = o.dur * clamp(o.peakAt ?? 0.4, 0.02, 0.98)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(o.gain * r.vol, t + pk)
    g.gain.linearRampToValueAtTime(0, t + o.dur)
}

export interface ThudOpts {
    freq: number
    freqEnd?: number
    dur: number
    gain: number
    /** Brown-noise body relative level. */
    body?: number
    bodyFreq?: number
    /** High click relative level. */
    click?: number
}

/** Low impact: pitched sine drop + noise body + transient click. */
export function thud(r: Rt, o: ThudOpts): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const o1 = oscNode(ctx, 'sine', o.freq * r.rate, t, o.dur + 0.05, g)
    o1.frequency.exponentialRampToValueAtTime(Math.max(20, (o.freqEnd ?? o.freq * 0.5) * r.rate), t + o.dur * 0.7)
    decayEnv(g.gain, t, o.gain * r.vol, 0.002, o.dur)
    if ((o.body ?? 0.6) > 0) {
        noiseBurst(r, {
            kind: 'brown', type: 'lowpass', freq: o.bodyFreq ?? 500, q: 0.7,
            gain: o.gain * (o.body ?? 0.6) * 1.4, dur: o.dur * 0.8, attack: 0.002
        })
    }
    if ((o.click ?? 0.3) > 0) {
        noiseBurst(r, { type: 'bandpass', freq: 2200, q: 0.8, gain: o.gain * (o.click ?? 0.3), dur: 0.018 })
    }
}

export interface CrackOpts {
    gain: number
    /** Body resonance of the wood. */
    freq?: number
    /** Brightness of the snap. */
    snap?: number
    dur?: number
}

/** Wood crack: a short bright snap exciting a ringing resonant body. */
export function crack(r: Rt, o: CrackOpts): void {
    const { ctx, t } = r
    const gate = gainNode(ctx, 0)
    noise(ctx, 'white', t, 0.08, gate)
    decayEnv(gate.gain, t, 1, 0.0008, o.dur ?? 0.035)
    const outG = gainNode(ctx, o.gain * r.vol, r.out)
    const wide = filterNode(ctx, 'bandpass', (o.snap ?? 2600) * r.rate, 0.9, outG)
    const body = filterNode(ctx, 'bandpass', (o.freq ?? rnd(700, 1100)) * r.rate, 14)
    const bodyG = gainNode(ctx, 3.5, outG)
    body.connect(bodyG)
    const low = filterNode(ctx, 'bandpass', (o.freq ?? 900) * 0.37 * r.rate, 6)
    const lowG = gainNode(ctx, 2.5, outG)
    low.connect(lowG)
    gate.connect(wide)
    gate.connect(body)
    gate.connect(low)
}

export interface ClickOpts {
    freq: number
    q?: number
    gain: number
    /** Length of each click in seconds. */
    len?: number
    type?: BiquadFilterType
    kind?: NoiseKind
    /** Random gain reduction per click (0..1). */
    jitter?: number
    /** Gain multiplier per click (same order as `times`). */
    gains?: readonly number[]
}

/** Many tiny clicks from ONE noise source and gain automation (cheap rattles, ratchets, crumbles). */
export function clickTrain(r: Rt, times: readonly number[], o: ClickOpts): void {
    if (times.length === 0) return
    const { ctx, t } = r
    const len = o.len ?? 0.006
    const idx = times.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
    const first = idx[0]?.[0] ?? 0
    const last = idx[idx.length - 1]?.[0] ?? 0
    const g = gainNode(ctx, 0, r.out)
    const f = filterNode(ctx, o.type ?? 'bandpass', o.freq * r.rate, o.q ?? 2, g)
    noise(ctx, o.kind ?? 'white', t + Math.max(0, first), last - first + len + 0.05, f)
    g.gain.setValueAtTime(0, t)
    let free = t
    for (const [dt, i] of idx) {
        const s = t + Math.max(0, dt)
        if (s < free) continue
        const pk = o.gain * r.vol * (o.gains?.[i] ?? 1) * (1 - Math.random() * (o.jitter ?? 0.4))
        if (pk <= 0) continue
        g.gain.setValueAtTime(0, s)
        g.gain.linearRampToValueAtTime(pk, s + 0.0006)
        g.gain.exponentialRampToValueAtTime(Math.max(0.00001, pk * 0.01), s + len)
        g.gain.linearRampToValueAtTime(0, s + len + 0.0015)
        free = s + len + 0.0016
    }
}

/** Random times in [0, dur) with density shaped by `curve` (1 = even, >1 bunches at the start). */
export function scatter(count: number, dur: number, curve = 1): number[] {
    const out: number[] = []
    for (let i = 0; i < count; i++) out.push(Math.random() ** curve * dur)
    return out.sort((a, b) => a - b)
}

export interface CreakOpts {
    dur: number
    /** Stick-slip rate in Hz at the start and the end. */
    from: number
    to: number
    /** Resonances of the wood. */
    res: readonly number[]
    q?: number
    gain: number
    attack?: number
}

/** Wood / hinge creak: an irregular stick-slip pulse train through resonant bandpasses. */
export function creak(r: Rt, o: CreakOpts): void {
    const { ctx, t } = r
    const env = gainNode(ctx, 0, r.out)
    const flutter = gainNode(ctx, 1, env)
    const sum = gainNode(ctx, 1 / Math.max(1, o.res.length) * 2.2)
    const src = oscNode(ctx, 'sawtooth', o.from * r.rate, t, o.dur + 0.05, sum)
    src.frequency.exponentialRampToValueAtTime(Math.max(5, o.to * r.rate), t + o.dur)
    // Stick-slip irregularity: wobble the slip rate and the grip.
    const wob = randomWalk(Math.ceil(o.dur * 30), 25, 0.1)
    src.detune.setValueCurveAtTime(wob, t, o.dur)
    const fl = randomWalk(Math.ceil(o.dur * 40), 0.25, 0.25)
    for (let i = 0; i < fl.length; i++) fl[i] = clamp(0.75 + (fl[i] ?? 0), 0.15, 1.3)
    flutter.gain.setValueCurveAtTime(fl, t, o.dur)
    for (const f of o.res) {
        const bp = filterNode(ctx, 'bandpass', f * r.rate * rnd(0.95, 1.05), o.q ?? 9, flutter)
        sum.connect(bp)
    }
    holdEnv(env.gain, t, o.gain * r.vol, o.attack ?? 0.04, o.dur - (o.attack ?? 0.04) - 0.08, 0.08)
}

export interface MetalOpts {
    base: number
    ratios: readonly number[]
    decay: number
    gain: number
    /** Strike noise level (0..1). */
    strike?: number
    /** Spread of random detune on the partials. */
    spread?: number
}

/** Struck metal: inharmonic sine partials with their own decays plus a strike transient. */
export function metal(r: Rt, o: MetalOpts): void {
    const { ctx, t } = r
    const bus = gainNode(ctx, o.gain * r.vol, r.out)
    let norm = 0
    o.ratios.forEach((_, i) => {
        norm += 1 / (1 + i * 0.6)
    })
    o.ratios.forEach((ratio, i) => {
        const amp = 1 / (1 + i * 0.6) / norm
        const g = gainNode(ctx, 0, bus)
        const sp = o.spread ?? 0.01
        oscNode(ctx, 'sine', o.base * ratio * r.rate * rnd(1 - sp, 1 + sp), t, o.decay + 0.05, g)
        decayEnv(g.gain, t, amp, 0.0008, o.decay / (1 + i * 0.45))
    })
    if ((o.strike ?? 0.4) > 0) {
        noiseBurst(r, { type: 'highpass', freq: 1800, q: 0.7, gain: o.gain * (o.strike ?? 0.4), dur: 0.02 })
    }
}

// Risset-style bell partials: ratio, relative amp, relative duration.
const BELL: readonly (readonly [number, number, number])[] = [
    [0.56, 1, 1], [0.56, 0.67, 0.9], [0.92, 1, 0.65], [0.92, 1.8, 0.55], [1.19, 2.67, 0.325],
    [1.7, 1.67, 0.35], [2, 1.46, 0.25], [2.74, 1.33, 0.2], [3, 1.33, 0.15], [3.76, 1, 0.1], [4.07, 1.33, 0.075]
]
const BELL_DETUNE = [0, 1, 0, 1.7, 0, 0, 0, 0, 0, 0, 0]

export interface BellOpts {
    freq: number
    dur: number
    gain: number
    /** 0..1 how much of the upper partials to keep (lower = darker, farther). */
    bright?: number
}

/** Church / hand bell from inharmonic partials with beating pairs. */
export function bell(r: Rt, o: BellOpts): void {
    const { ctx, t } = r
    const bus = gainNode(ctx, o.gain * r.vol / 7, r.out)
    const bright = o.bright ?? 1
    BELL.forEach(([ratio, amp, d], i) => {
        const keep = i < 5 ? 1 : bright
        if (keep <= 0.01) return
        const g = gainNode(ctx, 0, bus)
        oscNode(ctx, 'sine', o.freq * ratio * r.rate + (BELL_DETUNE[i] ?? 0), t, o.dur * d + 0.05, g)
        decayEnv(g.gain, t, amp * keep * 0.6, 0.002, o.dur * d)
    })
}

export interface FmBellOpts {
    freq: number
    dur: number
    gain: number
    ratio?: number
    index?: number
    /** Index decay time (brightness of the attack). */
    bite?: number
    detune?: number
}

/** Two-operator FM bell / chime with a decaying modulation index. */
export function fmBell(r: Rt, o: FmBellOpts): void {
    const { ctx, t } = r
    const f = o.freq * r.rate
    const g = gainNode(ctx, 0, r.out)
    const car = oscNode(ctx, 'sine', f, t, o.dur + 0.05, g)
    if (o.detune) car.detune.setValueAtTime(o.detune, t)
    const modG = gainNode(ctx, 0, car.frequency)
    oscNode(ctx, 'sine', f * (o.ratio ?? 3.5), t, o.dur + 0.05, modG)
    const idx = f * (o.index ?? 1.6)
    modG.gain.setValueAtTime(idx, t)
    modG.gain.exponentialRampToValueAtTime(Math.max(0.01, idx * 0.02), t + (o.bite ?? Math.min(0.5, o.dur * 0.4)))
    decayEnv(g.gain, t, o.gain * r.vol, 0.002, o.dur)
}

/** A plain pitched tone with a decay envelope (pings, beeps, glass). */
export function ping(r: Rt, freq: number, dur: number, gainV: number, type: OscillatorType = 'sine'): OscillatorNode {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const o = oscNode(ctx, type, freq * r.rate, t, dur + 0.05, g)
    decayEnv(g.gain, t, gainV * r.vol, 0.001, dur)
    return o
}

/** Wet bubble pops from one oscillator: each pop is an upward pitch blip. */
export function bubbles(r: Rt, times: readonly number[], fMin: number, fMax: number, gainV: number, len = 0.035): void {
    if (times.length === 0) return
    const { ctx, t } = r
    const sorted = [...times].sort((a, b) => a - b)
    const last = sorted[sorted.length - 1] ?? 0
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 1800 * r.rate, 0.7, g)
    const o = oscNode(ctx, 'sine', fMin * r.rate, t, last + len + 0.05, lp)
    g.gain.setValueAtTime(0, t)
    let free = t
    for (const dt of sorted) {
        const s = t + dt
        if (s < free) continue
        const f = rnd(fMin, fMax) * r.rate
        const pk = gainV * r.vol * rnd(0.5, 1)
        o.frequency.setValueAtTime(f, s)
        o.frequency.exponentialRampToValueAtTime(f * rnd(1.6, 2.4), s + len)
        g.gain.setValueAtTime(0, s)
        g.gain.linearRampToValueAtTime(pk, s + 0.003)
        g.gain.exponentialRampToValueAtTime(Math.max(0.00001, pk * 0.01), s + len)
        g.gain.linearRampToValueAtTime(0, s + len + 0.002)
        free = s + len + 0.003
    }
}

/** Electric crackle: a gated noise + buzz with random sparks over `dur`. */
export function crackle(r: Rt, dur: number, gainV: number, density = 60): void {
    const n = Math.max(3, Math.round(dur * density))
    const times = scatter(n, dur, 1.3)
    clickTrain(r, times, { freq: 2400, q: 0.9, gain: gainV, len: 0.004, jitter: 0.7 })
    clickTrain(r, scatter(Math.round(n * 0.5), dur, 1.5), { freq: 900, q: 1.2, gain: gainV * 0.8, len: 0.012, jitter: 0.6 })
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const bp = filterNode(ctx, 'bandpass', 1400 * r.rate, 1.5, g)
    const o = oscNode(ctx, 'sawtooth', 100 * r.rate, t, dur + 0.05, bp)
    o.detune.setValueCurveAtTime(randomWalk(Math.ceil(dur * 50), 200, 0.2), t, dur)
    const fl = randomWalk(Math.ceil(dur * 60), 0.5, 0.3)
    for (let i = 0; i < fl.length; i++) fl[i] = clamp(Math.abs(fl[i] ?? 0) * 1.5, 0, 1) * gainV * r.vol * 0.5
    g.gain.setValueCurveAtTime(fl, t, dur)
}
