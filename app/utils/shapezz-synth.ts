// Procedural SHAPEZZ sound effects. Every effect is a recipe that schedules a
// handful of Web Audio nodes (oscillators, filtered noise, envelopes) on a
// ShapezzSynthVoice; the voice cleans its nodes up once every source ended.
//
// Palette: A minor pentatonic for anything melodic, low-passed noise for
// blasts, pitch-dropping sines for thumps, detuned saws for synth stabs.

import type { ShapezzSoundEvent } from '~/utils/shapezz-sounds'

interface SynthKit {
    white: AudioBuffer
    pink: AudioBuffer
    curves: Map<number, Float32Array<ArrayBuffer>>
}

const kits = new WeakMap<BaseAudioContext, SynthKit>()

function makeNoise(ctx: BaseAudioContext, pink: boolean): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 2)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1
        if (!pink) {
            data[i] = white
            continue
        }
        // Paul Kellet's pink filter.
        b0 = 0.99886 * b0 + white * 0.0555179
        b1 = 0.99332 * b1 + white * 0.0750759
        b2 = 0.96900 * b2 + white * 0.1538520
        b3 = 0.86650 * b3 + white * 0.3104856
        b4 = 0.55000 * b4 + white * 0.5329522
        b5 = -0.7616 * b5 - white * 0.0168980
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
        b6 = white * 0.115926
    }
    return buffer
}

/** Build (once per context) the noise buffers the recipes share. */
export function shapezzSynthWarmUp(ctx: BaseAudioContext): SynthKit {
    let kit = kits.get(ctx)
    if (!kit) {
        kit = { white: makeNoise(ctx, false), pink: makeNoise(ctx, true), curves: new Map() }
        kits.set(ctx, kit)
    }
    return kit
}

function driveCurve(kit: SynthKit, amount: number): Float32Array<ArrayBuffer> {
    let curve = kit.curves.get(amount)
    if (!curve) {
        curve = new Float32Array(1024)
        const norm = Math.tanh(amount)
        for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1
            curve[i] = Math.tanh(x * amount) / norm
        }
        kit.curves.set(amount, curve)
    }
    return curve
}

/** Frequency of a note `semis` semitones from A4 (440 Hz). */
export function shapezzNote(semis: number): number {
    return 440 * Math.pow(2, semis / 12)
}

const PENTATONIC = [0, 3, 5, 7, 10]

/** Semitone offset of step `step` on the A minor pentatonic scale. */
export function shapezzPentatonic(step: number): number {
    const octave = Math.floor(step / 5)
    return octave * 12 + PENTATONIC[((step % 5) + 5) % 5]!
}

interface Envelope {
    /** Seconds after the voice start. */
    at?: number
    attack?: number
    /** Seconds held at peak before the decay. */
    hold?: number
    /** Exponential decay time to silence. */
    dur: number
    gain?: number
    dest?: AudioNode
    /** WaveShaper drive (tanh amount) before the envelope. */
    drive?: number
}

export interface ShapezzToneSpec extends Envelope {
    type?: OscillatorType
    freq: number
    /** Exponential sweep target. */
    to?: number
    /** Sweep time, defaults to the full sound. */
    glide?: number
    detune?: number
    /** Pitch LFO: rate in Hz, depth in Hz. */
    wobble?: { rate: number, depth: number, type?: OscillatorType }
    /** Amplitude LFO: rate in Hz, depth 0..1. */
    tremolo?: { rate: number, depth: number }
    /** Ignore the voice pitch multiplier. */
    fixed?: boolean
}

export interface ShapezzNoiseSpec extends Envelope {
    color?: 'white' | 'pink'
    filter?: BiquadFilterType
    freq: number
    to?: number
    glide?: number
    q?: number
    /** Amplitude LFO: rate in Hz, depth 0..1 (square for crackle). */
    tremolo?: { rate: number, depth: number, type?: OscillatorType }
}

export interface ShapezzFilterSpec {
    type?: BiquadFilterType
    freq: number
    to?: number
    at?: number
    glide?: number
    q?: number
    dest?: AudioNode
}

export interface ShapezzVoiceSetup {
    /** Output gain of the voice. */
    level: number
    pan?: number
    pitch?: number
    /** Context time the recipe starts at. */
    start: number
}

/** One playing sound: owns every node its recipe created. */
export class ShapezzSynthVoice {
    readonly t: number
    readonly pitch: number
    readonly output: GainNode
    onDone: (() => void) | null = null
    private readonly kit: SynthKit
    private readonly nodes: AudioNode[] = []
    private readonly sources: AudioScheduledSourceNode[] = []
    private pending = 0
    private sealed = false
    private done = false

    constructor(readonly ctx: BaseAudioContext, destination: AudioNode, setup: ShapezzVoiceSetup) {
        this.kit = shapezzSynthWarmUp(ctx)
        this.t = setup.start
        this.pitch = setup.pitch ?? 1
        this.output = this.track(ctx.createGain())
        this.output.gain.value = setup.level
        const pan = Math.max(-1, Math.min(1, setup.pan ?? 0))
        if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
            const panner = this.track(ctx.createStereoPanner())
            panner.pan.value = pan
            this.output.connect(panner)
            panner.connect(destination)
        } else {
            this.output.connect(destination)
        }
    }

    /** Random factor 1 ± amount (cosmetic variation). */
    vary(amount: number): number {
        return 1 + (Math.random() * 2 - 1) * amount
    }

    tone(spec: ShapezzToneSpec): OscillatorNode {
        const { start, end } = this.span(spec)
        const osc = this.track(this.ctx.createOscillator())
        osc.type = spec.type ?? 'sine'
        const scale = spec.fixed ? 1 : this.pitch
        osc.frequency.setValueAtTime(this.hz(spec.freq * scale), start)
        if (spec.to !== undefined) {
            osc.frequency.exponentialRampToValueAtTime(this.hz(spec.to * scale), start + (spec.glide ?? end - start))
        }
        if (spec.detune) osc.detune.value = spec.detune
        if (spec.wobble) this.lfo(spec.wobble.rate, spec.wobble.depth * scale, osc.frequency, start, end, spec.wobble.type)
        let head: AudioNode = this.envelope(spec, start)
        if (spec.drive) head = this.shaper(spec.drive, head)
        if (spec.tremolo) head = this.tremolo(spec.tremolo.rate, spec.tremolo.depth, head, start, end)
        osc.connect(head)
        this.schedule(osc, start, end)
        return osc
    }

    noise(spec: ShapezzNoiseSpec): AudioBufferSourceNode {
        const { start, end } = this.span(spec)
        const src = this.track(this.ctx.createBufferSource())
        const buffer = spec.color === 'pink' ? this.kit.pink : this.kit.white
        src.buffer = buffer
        src.loop = true
        let head: AudioNode = this.envelope(spec, start)
        if (spec.drive) head = this.shaper(spec.drive, head)
        if (spec.tremolo) head = this.tremolo(spec.tremolo.rate, spec.tremolo.depth, head, start, end, spec.tremolo.type)
        const filter = this.filter({
            type: spec.filter ?? 'lowpass',
            freq: spec.freq,
            to: spec.to,
            at: spec.at,
            glide: spec.glide ?? end - start,
            q: spec.q,
            dest: head
        })
        src.connect(filter)
        this.schedule(src, start, end, Math.random() * (buffer.duration - 0.1))
        return src
    }

    filter(spec: ShapezzFilterSpec): BiquadFilterNode {
        const start = this.t + (spec.at ?? 0)
        const filter = this.track(this.ctx.createBiquadFilter())
        filter.type = spec.type ?? 'lowpass'
        filter.frequency.setValueAtTime(this.hz(spec.freq * this.pitch), start)
        if (spec.to !== undefined) {
            filter.frequency.exponentialRampToValueAtTime(this.hz(spec.to * this.pitch), start + (spec.glide ?? 0.2))
        }
        filter.Q.value = spec.q ?? 0.7
        filter.connect(spec.dest ?? this.output)
        return filter
    }

    shaper(amount: number, dest: AudioNode = this.output): WaveShaperNode {
        const shaper = this.track(this.ctx.createWaveShaper())
        shaper.curve = driveCurve(this.kit, amount)
        shaper.connect(dest)
        return shaper
    }

    gain(value: number, dest: AudioNode = this.output): GainNode {
        const gain = this.track(this.ctx.createGain())
        gain.gain.value = value
        gain.connect(dest)
        return gain
    }

    lfo(rate: number, depth: number, param: AudioParam, start: number, end: number, type: OscillatorType = 'sine') {
        const osc = this.track(this.ctx.createOscillator())
        osc.type = type
        osc.frequency.value = rate
        const amount = this.track(this.ctx.createGain())
        amount.gain.value = depth
        osc.connect(amount)
        amount.connect(param)
        this.schedule(osc, start, end)
    }

    /** Fade out quickly and stop every source (voice stealing / stop()). */
    release(fade = 0.015) {
        if (this.done) return
        const now = this.ctx.currentTime
        const gain = this.output.gain
        gain.cancelScheduledValues(now)
        gain.setValueAtTime(gain.value, now)
        gain.linearRampToValueAtTime(0, now + fade)
        for (const src of this.sources) {
            try {
                src.stop(now + fade + 0.005)
            } catch {
                // Already stopped.
            }
        }
    }

    /** Call once the recipe finished scheduling. */
    seal() {
        this.sealed = true
        if (this.pending === 0) this.finish()
    }

    private track<T extends AudioNode>(node: T): T {
        this.nodes.push(node)
        return node
    }

    private hz(freq: number): number {
        return Math.max(10, Math.min(this.ctx.sampleRate / 2 - 100, freq))
    }

    private span(env: Envelope) {
        const start = this.t + (env.at ?? 0)
        const end = start + (env.attack ?? 0.002) + (env.hold ?? 0) + env.dur
        return { start, end }
    }

    private envelope(env: Envelope, start: number): GainNode {
        const attack = env.attack ?? 0.002
        const hold = env.hold ?? 0
        const peak = Math.max(0.0002, env.gain ?? 1)
        const node = this.track(this.ctx.createGain())
        const p = node.gain
        p.setValueAtTime(0, start)
        p.linearRampToValueAtTime(peak, start + attack)
        if (hold > 0) p.setValueAtTime(peak, start + attack + hold)
        p.exponentialRampToValueAtTime(0.0001, start + attack + hold + env.dur)
        node.connect(env.dest ?? this.output)
        return node
    }

    private tremolo(rate: number, depth: number, dest: AudioNode, start: number, end: number, type: OscillatorType = 'sine'): GainNode {
        const node = this.gain(1 - depth / 2, dest)
        this.lfo(rate, depth / 2, node.gain, start, end, type)
        return node
    }

    private schedule(src: AudioScheduledSourceNode, start: number, end: number, offset?: number) {
        this.sources.push(src)
        this.pending++
        src.onended = () => {
            this.pending--
            if (this.sealed && this.pending === 0) this.finish()
        }
        if (offset !== undefined && src instanceof AudioBufferSourceNode) src.start(start, offset)
        else src.start(start)
        src.stop(end + 0.02)
    }

    private finish() {
        if (this.done) return
        this.done = true
        for (const src of this.sources) src.onended = null
        for (const node of this.nodes) node.disconnect()
        this.sources.length = 0
        this.nodes.length = 0
        this.onDone?.()
    }
}

type Recipe = (v: ShapezzSynthVoice) => void

// Shared layers ------------------------------------------------------------

/** Pitch-dropping sine thump. */
function thump(v: ShapezzSynthVoice, from: number, to: number, dur: number, gain = 1, at = 0) {
    v.tone({ freq: from, to, glide: dur * 0.7, dur, gain, at })
}

/** Low-passed noise blast with a sub thump and a bright crackle. */
function boom(v: ShapezzSynthVoice, size: number, at = 0, gain = 1) {
    v.noise({ color: 'pink', freq: 2600 * v.vary(0.1), to: 160, glide: 0.4 * size, dur: 0.45 * size, gain, at })
    thump(v, 130 * v.vary(0.06), 36, 0.36 * size, 1.1 * gain, at)
    v.noise({ filter: 'highpass', freq: 3200, dur: 0.1 * size, gain: 0.2 * gain, drive: 3, tremolo: { rate: 38, depth: 0.9, type: 'square' }, at })
}

/** Short bell ping: sine plus an inharmonic partial. */
function chime(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
    v.tone({ type: 'triangle', freq, dur, gain, at })
    v.tone({ freq: freq * 2.01, dur: dur * 0.5, gain: gain * 0.35, at })
}

/** Detuned saw pair through a sweeping low-pass: the synthwave stab. */
function stab(v: ShapezzSynthVoice, freqs: number[], at: number, dur: number, gain = 0.3, hold = 0, bright = 3200) {
    const filter = v.filter({ freq: bright, to: 500, at, glide: hold + dur, q: 2 })
    for (const freq of freqs) {
        v.tone({ type: 'sawtooth', freq, detune: -8, dur, hold, gain, at, attack: 0.005, dest: filter })
        v.tone({ type: 'sawtooth', freq, detune: 8, dur, hold, gain, at, attack: 0.005, dest: filter })
    }
}

// Recipes -----------------------------------------------------------------

const recipes: Record<ShapezzSoundEvent, Recipe> = {
    // Kept to three nodes: fires up to 18/s.
    'shoot-blaster': (v) => {
        const filter = v.filter({ freq: 3600, q: 1 })
        v.tone({ type: 'square', freq: 1150 * v.vary(0.05), to: 240, glide: 0.07, dur: 0.075, gain: 0.55, dest: filter })
    },
    'shoot-launcher': (v) => {
        thump(v, 170, 42, 0.3, 1.2)
        v.tone({ type: 'square', freq: 90, to: 50, dur: 0.05, gain: 0.25 })
        v.noise({ filter: 'bandpass', freq: 2400, to: 450, q: 1.2, attack: 0.03, dur: 0.38, gain: 0.5 })
        v.noise({ color: 'pink', freq: 900, to: 200, dur: 0.18, gain: 0.5 })
    },
    'shoot-shotgun': (v) => {
        v.noise({ freq: 5200, to: 700, dur: 0.2, gain: 0.8 })
        v.noise({ filter: 'bandpass', freq: 1300 * v.vary(0.1), q: 1, dur: 0.09, gain: 0.5, drive: 4 })
        thump(v, 140, 48, 0.14, 0.8)
        v.tone({ type: 'sawtooth', freq: 320, to: 80, dur: 0.08, gain: 0.2 })
    },
    'shoot-arc': (v) => {
        const hp = v.filter({ type: 'highpass', freq: 700 })
        v.tone({ type: 'sawtooth', freq: 95 * v.vary(0.1), dur: 0.16, gain: 0.65, wobble: { rate: 47, depth: 70, type: 'square' }, dest: hp })
        v.noise({ filter: 'bandpass', freq: 3200 * v.vary(0.15), q: 2.5, dur: 0.1, gain: 0.9, tremolo: { rate: 60, depth: 1, type: 'square' } })
    },
    'drone-shoot': (v) => {
        v.tone({ freq: 2300 * v.vary(0.04), to: 1400, dur: 0.045, gain: 0.6 })
    },
    'enemy-shoot': (v) => {
        const lp = v.filter({ freq: 1100, q: 1.5 })
        v.tone({ type: 'triangle', freq: 440 * v.vary(0.05), to: 130, dur: 0.13, gain: 0.8, dest: lp })
        thump(v, 190, 70, 0.1, 0.5)
    },
    'enemy-shoot-heavy': (v) => {
        const lp = v.filter({ freq: 1000, to: 300, glide: 0.25, q: 3 })
        v.tone({ type: 'sawtooth', freq: 220, to: 70, dur: 0.24, gain: 0.5, dest: lp })
        v.tone({ type: 'sawtooth', freq: 224, to: 72, dur: 0.24, gain: 0.4, dest: lp })
        thump(v, 120, 40, 0.26, 0.9)
        v.noise({ color: 'pink', freq: 1300, to: 250, dur: 0.14, gain: 0.35 })
    },
    'sniper-charge': (v) => {
        v.tone({ freq: 300, to: 1900, glide: 0.6, attack: 0.55, dur: 0.08, gain: 0.5, tremolo: { rate: 22, depth: 0.4 } })
        v.tone({ type: 'triangle', freq: 151, to: 952, glide: 0.6, attack: 0.55, dur: 0.08, gain: 0.3 })
        v.noise({ filter: 'bandpass', freq: 500, to: 4000, glide: 0.6, q: 4, attack: 0.55, dur: 0.06, gain: 0.15 })
    },
    'sniper-fire': (v) => {
        v.noise({ filter: 'highpass', freq: 2200, dur: 0.06, gain: 0.9 })
        v.tone({ type: 'square', freq: 3000, to: 180, glide: 0.1, dur: 0.12, gain: 0.25 })
        thump(v, 170, 48, 0.16, 0.9)
    },
    // Two nodes: plays on nearly every bullet that lands.
    'hit-enemy': (v) => {
        v.tone({ type: 'triangle', freq: 1500 * v.vary(0.12), to: 800, dur: 0.035, gain: 0.7 })
    },
    'hit-crit': (v) => {
        v.tone({ freq: 2640 * v.vary(0.03), dur: 0.14, gain: 0.5 })
        v.tone({ freq: 2640 * 2.76, dur: 0.06, gain: 0.15 })
        v.tone({ type: 'triangle', freq: 1300, to: 600, dur: 0.025, gain: 0.5 })
    },
    'hit-armor': (v) => {
        const lp = v.filter({ freq: 1000, q: 5 })
        v.tone({ type: 'square', freq: 250 * v.vary(0.06), dur: 0.08, gain: 0.5, dest: lp })
        v.tone({ type: 'triangle', freq: 353, dur: 0.06, gain: 0.35 })
    },
    'explosion': (v) => {
        boom(v, 1)
    },
    'explosion-big': (v) => {
        v.noise({ color: 'pink', freq: 3000, to: 110, glide: 0.9, hold: 0.05, dur: 1.1, gain: 1 })
        v.tone({ freq: 95, to: 28, glide: 0.7, dur: 0.95, gain: 1.3, drive: 1.5 })
        v.noise({ filter: 'bandpass', freq: 800, q: 0.8, dur: 0.3, gain: 0.5 })
        v.noise({ color: 'pink', freq: 600, to: 90, at: 0.08, attack: 0.05, dur: 0.9, gain: 0.6 })
        v.noise({ filter: 'highpass', freq: 3000, dur: 0.25, gain: 0.18, drive: 3, tremolo: { rate: 27, depth: 1, type: 'square' } })
    },
    'enemy-death': (v) => {
        v.tone({ freq: 620 * v.vary(0.08), to: 150, dur: 0.07, gain: 0.8 })
        v.noise({ filter: 'highpass', freq: 4200, dur: 0.14, gain: 0.3 })
        const step = Math.floor(Math.random() * 5)
        chime(v, shapezzNote(24 + shapezzPentatonic(step)), 0.01, 0.12, 0.22)
    },
    'elite-death': (v) => {
        boom(v, 0.8, 0, 0.8)
        v.noise({ filter: 'highpass', freq: 5000, dur: 0.3, gain: 0.3 })
        chime(v, shapezzNote(12), 0.04, 0.35, 0.3)
        chime(v, shapezzNote(15), 0.09, 0.35, 0.3)
        chime(v, shapezzNote(19), 0.14, 0.5, 0.3)
    },
    'enemy-split': (v) => {
        v.tone({ freq: 300 * v.vary(0.08), to: 950, glide: 0.06, dur: 0.08, gain: 0.6 })
        v.tone({ freq: 460 * v.vary(0.08), to: 1350, glide: 0.06, dur: 0.08, gain: 0.45, at: 0.03 })
        v.noise({ filter: 'bandpass', freq: 2600, q: 6, dur: 0.05, gain: 0.35 })
    },
    'bomber-fuse': (v) => {
        const lp = v.filter({ freq: 3500 })
        for (let i = 0; i < 3; i++) {
            v.tone({ type: 'square', freq: 1760, dur: 0.035, hold: 0.015, gain: 0.35, at: i * 0.08, dest: lp })
        }
    },
    'enemy-spawn-elite': (v) => {
        for (const detune of [-14, 0, 13]) {
            v.tone({ freq: shapezzNote(15), detune, attack: 0.15, dur: 0.4, gain: 0.2, tremolo: { rate: 11, depth: 0.6 } })
        }
        const lp = v.filter({ freq: 600, to: 2400, glide: 0.4, q: 3 })
        v.tone({ type: 'sawtooth', freq: 220, to: 440, glide: 0.45, attack: 0.1, dur: 0.4, gain: 0.25, dest: lp })
    },
    'boss-spawn': (v) => {
        const lp = v.filter({ freq: 260, to: 1500, glide: 1.1, q: 4 })
        const drive = v.shaper(2, lp)
        for (const [freq, detune] of [[55, -7], [55, 7], [82.4, 0], [110, 5]] as const) {
            v.tone({ type: 'sawtooth', freq, detune, attack: 0.18, hold: 0.8, dur: 0.55, gain: 0.12, dest: drive })
        }
        v.tone({ freq: 55, attack: 0.1, hold: 0.9, dur: 0.5, gain: 0.55 })
        v.noise({ filter: 'bandpass', freq: 300, to: 3200, glide: 1.25, q: 1.5, attack: 1.2, dur: 0.25, gain: 0.35 })
        v.tone({ type: 'sawtooth', freq: 220, to: 440, glide: 1.2, attack: 1.1, dur: 0.3, gain: 0.1, at: 0.1 })
    },
    'boss-attack': (v) => {
        v.tone({ freq: 80, to: 320, glide: 0.25, attack: 0.25, dur: 0.03, gain: 0.5 })
        v.noise({ freq: 300, to: 2200, glide: 0.25, attack: 0.25, dur: 0.04, gain: 0.25 })
        thump(v, 210, 38, 0.4, 1.2, 0.26)
        v.noise({ color: 'pink', freq: 1600, to: 140, glide: 0.3, dur: 0.32, gain: 0.6, at: 0.26 })
    },
    'boss-laser': (v) => {
        const drive = v.shaper(2.5)
        const lp = v.filter({ freq: 1500, q: 6, dest: drive })
        const cutoffEnd = v.t + 1.05
        v.lfo(8, 600, lp.frequency, v.t, cutoffEnd)
        v.tone({ type: 'sawtooth', freq: 110, attack: 0.05, hold: 0.8, dur: 0.2, gain: 0.3, dest: lp, tremolo: { rate: 30, depth: 0.3 } })
        v.tone({ type: 'sawtooth', freq: 110.9, attack: 0.05, hold: 0.8, dur: 0.2, gain: 0.3, dest: lp })
        v.tone({ type: 'square', freq: 55, attack: 0.05, hold: 0.8, dur: 0.2, gain: 0.25, dest: lp })
        v.noise({ filter: 'bandpass', freq: 2600, q: 2, attack: 0.05, hold: 0.8, dur: 0.2, gain: 0.15 })
    },
    'boss-phase': (v) => {
        const lp = v.filter({ freq: 2200, to: 500, glide: 0.9 })
        const drive = v.shaper(4, lp)
        v.tone({ type: 'sawtooth', freq: 92, to: 58, glide: 0.9, attack: 0.05, dur: 0.85, gain: 0.35, wobble: { rate: 7, depth: 6 }, dest: drive })
        v.tone({ type: 'sawtooth', freq: 96, to: 61, glide: 0.9, attack: 0.05, dur: 0.85, gain: 0.35, wobble: { rate: 6, depth: 6 }, dest: drive })
        const alarm = v.filter({ freq: 2400 })
        for (let i = 0; i < 4; i++) {
            v.tone({ type: 'square', freq: i % 2 ? 660 : 880, hold: 0.09, dur: 0.03, gain: 0.18, at: i * 0.13, dest: alarm })
        }
        thump(v, 120, 35, 0.5, 0.9)
    },
    'boss-death': (v) => {
        boom(v, 1.6, 0, 0.9)
        boom(v, 1.2, 0.28, 0.7)
        boom(v, 2, 0.6, 0.9)
        v.tone({ freq: 70, to: 24, glide: 1.8, dur: 1.9, gain: 1 })
        const lp = v.filter({ freq: 3000, to: 200, glide: 1.8, q: 2 })
        v.tone({ type: 'sawtooth', freq: 440, to: 40, glide: 1.8, attack: 0.02, hold: 0.3, dur: 1.5, gain: 0.25, dest: lp })
        v.tone({ type: 'sawtooth', freq: 443, to: 41, glide: 1.8, attack: 0.02, hold: 0.3, dur: 1.5, gain: 0.25, dest: lp })
        v.noise({ filter: 'highpass', freq: 5000, dur: 0.6, gain: 0.2, at: 0.05 })
    },
    'player-hurt': (v) => {
        v.tone({ type: 'square', freq: 1200, to: 180, glide: 0.12, dur: 0.12, gain: 0.35, drive: 3 })
        v.noise({ filter: 'highpass', freq: 1600, dur: 0.08, gain: 0.35 })
        const lp = v.filter({ freq: 1300 })
        v.tone({ type: 'sawtooth', freq: 220, attack: 0.01, hold: 0.12, dur: 0.18, gain: 0.22, dest: lp })
        v.tone({ type: 'sawtooth', freq: 233, attack: 0.01, hold: 0.12, dur: 0.18, gain: 0.22, dest: lp })
    },
    'player-death': (v) => {
        boom(v, 1.3)
        const lp = v.filter({ freq: 3200, to: 180, glide: 1.3, q: 3 })
        v.tone({ type: 'sawtooth', freq: 660, to: 40, glide: 1.3, attack: 0.02, hold: 0.2, dur: 1.1, gain: 0.3, dest: lp })
        v.tone({ type: 'square', freq: 330, to: 20, glide: 1.3, detune: 12, attack: 0.02, hold: 0.2, dur: 1.1, gain: 0.15, dest: lp })
    },
    'shield-gain': (v) => {
        const steps = [5, 7, 8, 9, 10]
        steps.forEach((step, i) => chime(v, shapezzNote(12 + shapezzPentatonic(step)), i * 0.045, 0.3, 0.3))
        v.tone({ freq: 600, to: 1800, glide: 0.25, attack: 0.22, dur: 0.15, gain: 0.15 })
        v.noise({ filter: 'highpass', freq: 6500, attack: 0.18, dur: 0.3, gain: 0.08 })
    },
    'shield-hit': (v) => {
        v.tone({ freq: 2350 * v.vary(0.04), dur: 0.15, gain: 0.35 })
        v.tone({ freq: 3310, dur: 0.1, gain: 0.2 })
        v.tone({ type: 'triangle', freq: 1200, to: 2400, dur: 0.05, gain: 0.35 })
        v.noise({ filter: 'highpass', freq: 5200, dur: 0.04, gain: 0.25 })
    },
    'dash': (v) => {
        v.noise({ filter: 'bandpass', freq: 600, to: 3200, glide: 0.18, q: 1.5, attack: 0.05, dur: 0.2, gain: 1.8 })
        v.tone({ freq: 320, to: 640, dur: 0.12, gain: 0.12 })
    },
    'land': (v) => {
        thump(v, 150, 48, 0.13, 0.9)
        v.noise({ color: 'pink', freq: 450, dur: 0.07, gain: 0.35 })
    },
    'pickup-coin': (v) => {
        v.tone({ type: 'triangle', freq: shapezzNote(7), dur: 0.04, hold: 0.01, gain: 0.45 })
        v.tone({ type: 'triangle', freq: shapezzNote(12), dur: 0.18, gain: 0.5, at: 0.05 })
        v.tone({ freq: shapezzNote(24), dur: 0.08, gain: 0.15, at: 0.05 })
    },
    'pickup-health': (v) => {
        for (const [freq, at] of [[shapezzNote(0), 0], [shapezzNote(7), 0.1]] as const) {
            v.tone({ freq, attack: 0.02, dur: 0.3, gain: 0.4, at })
            v.tone({ type: 'triangle', freq, detune: 7, attack: 0.02, dur: 0.25, gain: 0.25, at })
        }
    },
    'singularity': (v) => {
        v.noise({ color: 'pink', freq: 200, to: 2600, glide: 0.45, attack: 0.45, dur: 0.05, gain: 0.5 })
        v.tone({ freq: 40, to: 95, glide: 0.45, attack: 0.45, dur: 0.05, gain: 0.5, wobble: { rate: 9, depth: 6 } })
        v.tone({ freq: 130, to: 28, glide: 0.5, dur: 0.65, gain: 1.3, at: 0.46 })
        v.noise({ color: 'pink', freq: 700, to: 90, dur: 0.5, gain: 0.4, at: 0.46 })
    },
    'chain-lightning': (v) => {
        v.noise({ filter: 'bandpass', freq: 3000 * v.vary(0.15), q: 3, dur: 0.22, gain: 1.1, tremolo: { rate: 35 * v.vary(0.3), depth: 1, type: 'square' } })
        const hp = v.filter({ type: 'highpass', freq: 600 })
        v.tone({ type: 'sawtooth', freq: 150, dur: 0.24, gain: 0.5, wobble: { rate: 61, depth: 120, type: 'square' }, dest: hp })
    },
    'execute': (v) => {
        v.noise({ filter: 'bandpass', freq: 6500, to: 2000, glide: 0.08, q: 2, dur: 0.09, gain: 0.7 })
        v.tone({ type: 'sawtooth', freq: 2100, to: 380, glide: 0.06, dur: 0.06, gain: 0.2 })
        thump(v, 120, 38, 0.24, 1.2, 0.02)
    },
    'lance': (v) => {
        v.noise({ filter: 'highpass', freq: 2500, dur: 0.05, gain: 0.7 })
        const lp = v.filter({ freq: 5000, to: 700, glide: 0.7, q: 3 })
        v.tone({ type: 'sawtooth', freq: 880, detune: -10, attack: 0.01, hold: 0.25, dur: 0.42, gain: 0.25, dest: lp })
        v.tone({ type: 'sawtooth', freq: 880, detune: 10, attack: 0.01, hold: 0.25, dur: 0.42, gain: 0.25, dest: lp })
        v.tone({ type: 'square', freq: 440, attack: 0.01, hold: 0.25, dur: 0.42, gain: 0.2, dest: lp, tremolo: { rate: 24, depth: 0.3 } })
        thump(v, 90, 38, 0.5, 1)
        v.noise({ filter: 'bandpass', freq: 3000, to: 900, glide: 0.6, q: 1.5, dur: 0.5, gain: 0.3 })
    },
    'combo-milestone': (v) => {
        const lp = v.filter({ freq: 3200 })
        for (let i = 0; i < 4; i++) {
            const freq = shapezzNote(12 + shapezzPentatonic(i + 1))
            v.tone({ type: 'square', freq, dur: 0.12, gain: 0.22, at: i * 0.05, dest: lp })
            v.tone({ type: 'triangle', freq: freq * 2, dur: 0.1, gain: 0.28, at: i * 0.05 })
        }
    },
    'checkpoint': (v) => {
        // Major lift: A, C#, E, A.
        const notes = [0, 4, 7, 12]
        notes.forEach((semis, i) => stab(v, [shapezzNote(semis)], i * 0.08, 0.22, 0.14, 0, 3800))
        stab(v, [shapezzNote(4), shapezzNote(7), shapezzNote(12)], 0.32, 0.55, 0.09, 0.2, 3000)
        chime(v, shapezzNote(24), 0.32, 0.5, 0.2)
    },
    'upgrade': (v) => {
        const lp = v.filter({ freq: 400, to: 5000, glide: 0.4, q: 4 })
        v.tone({ type: 'sawtooth', freq: 110, to: 880, glide: 0.4, detune: -9, attack: 0.36, dur: 0.05, gain: 0.25, dest: lp })
        v.tone({ type: 'sawtooth', freq: 110, to: 880, glide: 0.4, detune: 9, attack: 0.36, dur: 0.05, gain: 0.25, dest: lp })
        stab(v, [shapezzNote(12), shapezzNote(19)], 0.4, 0.28, 0.15, 0, 4000)
        thump(v, 160, 55, 0.18, 0.8, 0.4)
        chime(v, shapezzNote(24), 0.4, 0.3, 0.18)
    },
    'run-start': (v) => {
        v.tone({ freq: 60, to: 1200, glide: 0.5, attack: 0.48, dur: 0.04, gain: 0.25 })
        v.noise({ filter: 'bandpass', freq: 200, to: 4000, glide: 0.5, q: 2, attack: 0.48, dur: 0.04, gain: 0.3 })
        stab(v, [shapezzNote(-12), shapezzNote(-5), shapezzNote(0), shapezzNote(3)], 0.5, 0.42, 0.1, 0.05, 3400)
        thump(v, 150, 45, 0.3, 1, 0.5)
    },
    'cash-out': (v) => {
        for (let i = 0; i < 8; i++) {
            const at = i * 0.05
            v.tone({ type: 'triangle', freq: shapezzNote(12 + shapezzPentatonic(i)), dur: 0.12, gain: 0.3, at })
            v.tone({ freq: shapezzNote(24 + shapezzPentatonic(i)), dur: 0.06, gain: 0.08, at })
        }
        stab(v, [shapezzNote(-12), shapezzNote(4), shapezzNote(7), shapezzNote(12)], 0.45, 0.7, 0.09, 0.3, 3200)
        chime(v, shapezzNote(24), 0.45, 0.8, 0.22)
        thump(v, 140, 45, 0.3, 0.9, 0.45)
    }
}

export const SHAPEZZ_SYNTH_RECIPES: Readonly<Record<ShapezzSoundEvent, Recipe>> = recipes

/** Per-play random pitch spread; melodic cues stay close to the scale. */
export const SHAPEZZ_SYNTH_JITTER: Partial<Record<ShapezzSoundEvent, number>> = {
    'pickup-coin': 0.005,
    'pickup-health': 0.005,
    'combo-milestone': 0,
    'checkpoint': 0,
    'upgrade': 0,
    'run-start': 0,
    'cash-out': 0,
    'shield-gain': 0.005,
    'enemy-spawn-elite': 0.01,
    'boss-spawn': 0.01,
    'bomber-fuse': 0.01
}

export const SHAPEZZ_SYNTH_DEFAULT_JITTER = 0.045
