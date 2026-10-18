import type { DfSoundOpts } from '../../context'

// Low-level building blocks shared by every world sound: cached noise buffers,
// shaper curves, impulse responses and envelope helpers. Everything big is
// cached per AudioContext so a synth call only allocates small nodes.

export type NoiseKind = 'white' | 'pink' | 'brown'

/** Render handle passed through the recipes: where, when, how loud, how high. */
export interface Rt {
    ctx: BaseAudioContext
    out: AudioNode
    t: number
    vol: number
    rate: number
}

export function rt(ctx: BaseAudioContext, out: AudioNode, opts: DfSoundOpts): Rt {
    return { ctx, out, t: ctx.currentTime + 0.005, vol: 1, rate: opts.rate ?? 1 }
}

/** Same handle, shifted in time. */
export function at(r: Rt, dt: number): Rt {
    return { ...r, t: r.t + dt }
}

/** Same handle, routed into another node. */
export function into(r: Rt, out: AudioNode): Rt {
    return { ...r, out }
}

/** Cosmetic randomness (variation between calls), never gameplay. */
export function rnd(a: number, b: number): number {
    return a + Math.random() * (b - a)
}

export function rndPick<T>(arr: readonly T[]): T {
    const v = arr[Math.floor(Math.random() * arr.length)]
    if (v === undefined) throw new Error('rndPick on an empty list')
    return v
}

export function mtof(m: number): number {
    return 440 * 2 ** ((m - 69) / 12)
}

export function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v
}

// ---------------------------------------------------------------- noise buffers

const NOISE_SECONDS = 4
const noiseCache = new WeakMap<BaseAudioContext, Partial<Record<NoiseKind, AudioBuffer>>>()

function fillNoise(kind: NoiseKind, n: number): Float32Array {
    const d = new Float32Array(n)
    let b0 = 0
    let b1 = 0
    let b2 = 0
    let b3 = 0
    let b4 = 0
    let b5 = 0
    let b6 = 0
    let last = 0
    for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1
        if (kind === 'white') {
            d[i] = w
        } else if (kind === 'pink') {
            b0 = 0.99886 * b0 + w * 0.0555179
            b1 = 0.99332 * b1 + w * 0.0750759
            b2 = 0.969 * b2 + w * 0.153852
            b3 = 0.8665 * b3 + w * 0.3104856
            b4 = 0.55 * b4 + w * 0.5329522
            b5 = -0.7616 * b5 - w * 0.016898
            d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
            b6 = w * 0.115926
        } else {
            last = (last + 0.02 * w) / 1.02
            d[i] = last
        }
    }
    return d
}

/** Looping mono noise buffer (seamless loop point, peak normalised to ~0.9). */
export function noiseBuffer(ctx: BaseAudioContext, kind: NoiseKind): AudioBuffer {
    let set = noiseCache.get(ctx)
    if (!set) {
        set = {}
        noiseCache.set(ctx, set)
    }
    const cached = set[kind]
    if (cached) return cached
    const len = Math.floor(ctx.sampleRate * NOISE_SECONDS)
    const fade = Math.floor(ctx.sampleRate * 0.05)
    const raw = fillNoise(kind, len + fade)
    // Crossfade the overflow into the head so the loop point is continuous.
    for (let i = 0; i < fade; i++) {
        const k = i / fade
        raw[i] = (raw[i] ?? 0) * k + (raw[len + i] ?? 0) * (1 - k)
    }
    let peak = 0
    let mean = 0
    for (let i = 0; i < len; i++) mean += raw[i] ?? 0
    mean /= len
    for (let i = 0; i < len; i++) {
        const v = (raw[i] ?? 0) - mean
        raw[i] = v
        if (Math.abs(v) > peak) peak = Math.abs(v)
    }
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const ch = buf.getChannelData(0)
    const norm = peak > 0 ? 0.9 / peak : 1
    for (let i = 0; i < len; i++) ch[i] = (raw[i] ?? 0) * norm
    set[kind] = buf
    return buf
}

/** A looping noise source starting at a random offset, playing from `t` for `dur` seconds. */
export function noise(ctx: BaseAudioContext, kind: NoiseKind, t: number, dur: number, dest: AudioNode): AudioBufferSourceNode {
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, kind)
    src.loop = true
    src.connect(dest)
    src.start(t, Math.random() * (NOISE_SECONDS - 0.5))
    src.stop(t + dur)
    return src
}

// ---------------------------------------------------------------- nodes

/** Connect to a node or an AudioParam (modulation). */
export function link(src: AudioNode, dest: AudioNode | AudioParam): void {
    if ('connect' in dest) src.connect(dest)
    else src.connect(dest)
}

export function gainNode(ctx: BaseAudioContext, value: number, dest?: AudioNode | AudioParam): GainNode {
    const g = ctx.createGain()
    g.gain.value = value
    if (dest) link(g, dest)
    return g
}

export function filterNode(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.707, dest?: AudioNode): BiquadFilterNode {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = clamp(freq, 10, ctx.sampleRate * 0.45)
    f.Q.value = q
    if (dest) f.connect(dest)
    return f
}

export function oscNode(ctx: BaseAudioContext, type: OscillatorType, freq: number, t: number, dur: number, dest: AudioNode): OscillatorNode {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    o.connect(dest)
    o.start(t)
    o.stop(t + dur)
    return o
}

/** Oscillator using a custom (cached) periodic wave. */
export function waveNode(ctx: BaseAudioContext, wave: PeriodicWave, freq: number, t: number, dur: number, dest: AudioNode): OscillatorNode {
    const o = ctx.createOscillator()
    o.setPeriodicWave(wave)
    o.frequency.setValueAtTime(freq, t)
    o.connect(dest)
    o.start(t)
    o.stop(t + dur)
    return o
}

// ---------------------------------------------------------------- envelopes

const FLOOR = 0.00001

/** 0 -> peak (linear) -> exponential decay to silence at t + dur. */
export function decayEnv(p: AudioParam, t: number, peak: number, attack: number, dur: number): void {
    const pk = Math.max(FLOOR * 10, peak)
    const a = Math.max(0.0008, attack)
    const end = Math.max(t + a + 0.004, t + dur)
    p.setValueAtTime(0, t)
    p.linearRampToValueAtTime(pk, t + a)
    p.exponentialRampToValueAtTime(Math.max(FLOOR, pk * 0.0005), end)
    p.linearRampToValueAtTime(0, end + 0.01)
}

/** 0 -> peak (linear attack) -> hold -> linear-ish release. */
export function holdEnv(p: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): void {
    const pk = Math.max(FLOOR * 10, peak)
    const a = Math.max(0.0008, attack)
    p.setValueAtTime(0, t)
    p.linearRampToValueAtTime(pk, t + a)
    p.setValueAtTime(pk, t + a + Math.max(0, hold))
    p.exponentialRampToValueAtTime(Math.max(FLOOR, pk * 0.001), t + a + Math.max(0, hold) + Math.max(0.005, release))
    p.linearRampToValueAtTime(0, t + a + Math.max(0, hold) + Math.max(0.005, release) + 0.01)
}

/** Linear ramps through [timeOffset, value] points (first point is set). */
export function rampPoints(p: AudioParam, t: number, pts: readonly (readonly [number, number])[]): void {
    let first = true
    for (const [dt, v] of pts) {
        if (first) {
            p.setValueAtTime(v, t + dt)
            first = false
        } else {
            p.linearRampToValueAtTime(v, t + dt)
        }
    }
}

/** Exponential ramps through [timeOffset, value] points (values must be > 0). */
export function expPoints(p: AudioParam, t: number, pts: readonly (readonly [number, number])[]): void {
    let first = true
    for (const [dt, v] of pts) {
        const val = Math.max(FLOOR, v)
        if (first) {
            p.setValueAtTime(val, t + dt)
            first = false
        } else {
            p.exponentialRampToValueAtTime(val, t + dt)
        }
    }
}

/** A smooth random walk (for jitter / flutter curves). */
export function randomWalk(n: number, step: number, spring = 0.15): Float32Array<ArrayBuffer> {
    const out = new Float32Array(Math.max(2, n))
    let v = 0
    let vel = 0
    for (let i = 0; i < out.length; i++) {
        vel = vel * 0.7 + (Math.random() * 2 - 1) * step
        v += vel - v * spring
        out[i] = v
    }
    return out
}

// ---------------------------------------------------------------- shapers

const shaperCache = new WeakMap<BaseAudioContext, Map<number, Float32Array<ArrayBuffer>>>()

/** Soft-clip (tanh) waveshaper; `drive` 0 is near-linear, 3+ is heavy. Curves are cached. */
export function shaperNode(ctx: BaseAudioContext, drive: number, dest?: AudioNode): WaveShaperNode {
    const key = Math.round(drive * 10) / 10
    let map = shaperCache.get(ctx)
    if (!map) {
        map = new Map()
        shaperCache.set(ctx, map)
    }
    let curve = map.get(key)
    if (!curve) {
        const n = 2048
        const k = 1 + key * 3
        const norm = Math.tanh(k)
        curve = new Float32Array(n)
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1
            curve[i] = Math.tanh(k * x) / norm
        }
        map.set(key, curve)
    }
    const s = ctx.createWaveShaper()
    s.curve = curve
    s.oversample = '2x'
    if (dest) s.connect(dest)
    return s
}

// ---------------------------------------------------------------- reverb

const irCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>()

/** Stereo decaying-noise impulse response, cached per (seconds, decay, dark). */
export function impulse(ctx: BaseAudioContext, seconds: number, decay: number, dark = 0.5): AudioBuffer {
    const key = `${seconds}:${decay}:${dark}`
    let map = irCache.get(ctx)
    if (!map) {
        map = new Map()
        irCache.set(ctx, map)
    }
    const hit = map.get(key)
    if (hit) return hit
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c)
        let lp = 0
        for (let i = 0; i < len; i++) {
            const k = i / len
            // Darken the tail: a one-pole lowpass whose coefficient closes over time.
            const a = 1 - dark * (0.3 + 0.65 * k)
            lp += a * ((Math.random() * 2 - 1) - lp)
            const pre = i < 64 ? i / 64 : 1
            d[i] = lp * (1 - k) ** decay * pre * 0.5
        }
    }
    map.set(key, buf)
    return buf
}

/**
 * Dry + convolution send into `dest`. Returns the input node. Use on rare,
 * long sounds only (jingles, stingers, the ambience bus), never per zombie hit.
 */
export function reverbSend(ctx: BaseAudioContext, dest: AudioNode, wet: number, seconds = 2, decay = 3, dark = 0.5): GainNode {
    const input = gainNode(ctx, 1, dest)
    const conv = ctx.createConvolver()
    conv.buffer = impulse(ctx, seconds, decay, dark)
    input.connect(conv)
    conv.connect(gainNode(ctx, wet, dest))
    return input
}

// ---------------------------------------------------------------- waves

const pulseCache = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>()

/** Band-limited pulse wave with the given duty cycle (0.5 = square). */
export function pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave {
    let map = pulseCache.get(ctx)
    if (!map) {
        map = new Map()
        pulseCache.set(ctx, map)
    }
    const hit = map.get(duty)
    if (hit) return hit
    const n = 40
    const real = new Float32Array(n)
    const imag = new Float32Array(n)
    for (let i = 1; i < n; i++) real[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty)
    const wave = ctx.createPeriodicWave(real, imag)
    map.set(duty, wave)
    return wave
}
