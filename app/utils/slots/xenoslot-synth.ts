// Xeno Slot sound design. Every effect is synthesized at play time on the
// shared SHAPEZZ synth voice (oscillators, filtered noise, envelopes, drive);
// there are no sample files. Played through app/composables/xenoslot-sound.ts.
//
// Palette: A Lydian for anything bright (wins, coins, fanfares), A minor 9
// for the ambient pad, pitch-dropping sines for reel thunks, band-passed
// noise sweeps for whooshes and beams, square-tremolo saws for electric zaps.
//
// Besides the one-shot recipes this file builds the sustained layers the
// composable owns: the reel whir and the ambient music bed.

import { ShapezzSynthVoice, shapezzNote, shapezzSynthWarmUp } from '~/utils/shapezz-synth'

export { ShapezzSynthVoice as XenoSynthVoice }

export type XenoSoundEvent
    = 'click' | 'bet-up' | 'bet-down' | 'toggle' | 'error'
        | 'spin-start' | 'reel-stop' | 'scatter-land' | 'anticipation'
        | 'win-small' | 'win-medium' | 'win-big' | 'line-show' | 'tick'
        | 'tier-up' | 'bigwin-end'
        | 'bonus-trigger' | 'bonus-end' | 'bonus-spin'
        | 'coin-land' | 'cell-stop' | 'core-land' | 'core-zap'
        | 'ufo-land' | 'ufo-beam' | 'collect-coin' | 'board-clear'
        | 'buy-bonus'

/** Per-event mix levels relative to the player's volume. */
export const XENO_SOUND_LEVELS: Record<XenoSoundEvent, number> = {
    'click': 0.22,
    'bet-up': 0.24,
    'bet-down': 0.24,
    'toggle': 0.22,
    'error': 0.3,
    'spin-start': 0.34,
    'reel-stop': 0.5,
    'scatter-land': 0.42,
    'anticipation': 0.34,
    'win-small': 0.34,
    'win-medium': 0.4,
    'win-big': 0.46,
    'line-show': 0.2,
    'tick': 0.12,
    'tier-up': 0.5,
    'bigwin-end': 0.46,
    'bonus-trigger': 0.52,
    'bonus-end': 0.46,
    'bonus-spin': 0.26,
    'coin-land': 0.34,
    'cell-stop': 0.16,
    'core-land': 0.36,
    'core-zap': 0.34,
    'ufo-land': 0.4,
    'ufo-beam': 0.34,
    'collect-coin': 0.26,
    'board-clear': 0.3,
    'buy-bonus': 0.44
}

/** Minimum ms between plays of the same event. */
export const XENO_SOUND_COOLDOWNS: Record<XenoSoundEvent, number> = {
    'click': 40,
    'bet-up': 40,
    'bet-down': 40,
    'toggle': 60,
    'error': 400,
    'spin-start': 120,
    'reel-stop': 35,
    'scatter-land': 60,
    'anticipation': 500,
    'win-small': 200,
    'win-medium': 200,
    'win-big': 400,
    'line-show': 90,
    'tick': 42,
    'tier-up': 250,
    'bigwin-end': 600,
    'bonus-trigger': 1200,
    'bonus-end': 1200,
    'bonus-spin': 150,
    'coin-land': 30,
    'cell-stop': 25,
    'core-land': 80,
    'core-zap': 60,
    'ufo-land': 120,
    'ufo-beam': 300,
    'collect-coin': 40,
    'board-clear': 300,
    'buy-bonus': 400
}

/** Most voices of one event allowed at once; a new play past the cap steals the oldest. */
export const XENO_SOUND_VOICE_CAPS: Partial<Record<XenoSoundEvent, number>> = {
    'tick': 3,
    'reel-stop': 5,
    'coin-land': 6,
    'cell-stop': 5,
    'collect-coin': 5,
    'tier-up': 2,
    'bonus-trigger': 1,
    'bonus-end': 1,
    'anticipation': 1,
    'ufo-beam': 2
}

export const XENO_SOUND_DEFAULT_VOICE_CAP = 3
export const XENO_SOUND_MAX_VOICES = 36

/** Random pitch spread per event (cosmetic); ticks and pings vary more. */
export const XENO_SYNTH_JITTER: Partial<Record<XenoSoundEvent, number>> = {
    'tick': 0.06,
    'reel-stop': 0.03,
    'cell-stop': 0.08,
    'coin-land': 0.03,
    'collect-coin': 0,
    'scatter-land': 0,
    'win-small': 0,
    'win-medium': 0,
    'win-big': 0,
    'tier-up': 0,
    'bigwin-end': 0,
    'bonus-trigger': 0,
    'bonus-end': 0,
    'line-show': 0
}
export const XENO_SYNTH_DEFAULT_JITTER = 0.02

const note = shapezzNote

/** A Lydian, semitones above A4, climbing past the octave. */
const LYDIAN = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26, 28]

type Recipe = (v: ShapezzSynthVoice, intensity: number) => void

// Shared layers ------------------------------------------------------------

function thump(v: ShapezzSynthVoice, from: number, to: number, dur: number, gain = 1, at = 0) {
    v.tone({ freq: from, to, glide: dur * 0.6, dur, gain, at })
}

/** Glassy ping: triangle plus a quiet octave-and-a-fifth partial. */
function ping(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
    v.tone({ type: 'triangle', freq, dur, gain, at })
    v.tone({ freq: freq * 3.01, dur: dur * 0.35, gain: gain * 0.16, at })
}

/** Struck metal: fundamental plus inharmonic partials. */
function bell(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
    v.tone({ type: 'triangle', freq, dur, gain, at })
    v.tone({ freq: freq * 2.76, dur: dur * 0.5, gain: gain * 0.28, at })
    v.tone({ freq: freq * 5.4, dur: dur * 0.22, gain: gain * 0.12, at })
}

/** Bright synth chord: detuned saws through a closing low-pass. */
function stab(v: ShapezzSynthVoice, freqs: number[], at: number, dur: number, gain = 0.16, hold = 0, bright = 3200) {
    const filter = v.filter({ freq: bright, to: 700, at, glide: hold + dur, q: 1.4 })
    for (const freq of freqs) {
        v.tone({ type: 'sawtooth', freq, detune: -9, dur, hold, gain, at, attack: 0.012, dest: filter })
        v.tone({ type: 'sawtooth', freq, detune: 9, dur, hold, gain, at, attack: 0.012, dest: filter })
    }
}

/** Band-pass noise sweep. */
function whoosh(v: ShapezzSynthVoice, from: number, to: number, dur: number, at = 0, gain = 0.5, q = 1.2) {
    v.noise({ filter: 'bandpass', freq: from, to, glide: dur, q, attack: dur * 0.4, dur: dur * 0.6, gain, at })
}

/** High shimmering sparkle cloud. */
function sparkle(v: ShapezzSynthVoice, count: number, spread: number, at = 0, gain = 0.14, base = 24) {
    for (let i = 0; i < count; i++) {
        const step = LYDIAN[Math.floor(Math.random() * 8)]!
        v.tone({ type: 'triangle', freq: note(base + step), dur: 0.18, gain: gain * v.vary(0.3), at: at + Math.random() * spread, fixed: true })
    }
}

/** Arpeggio over A Lydian. */
function arp(v: ShapezzSynthVoice, steps: number[], at: number, gap: number, dur: number, gain = 0.3, octave = 0) {
    steps.forEach((s, i) => ping(v, note(LYDIAN[s]! + octave), at + i * gap, dur, gain))
}

/** Crash cymbal: long high-passed white noise. */
function cymbal(v: ShapezzSynthVoice, at: number, dur: number, gain = 0.2) {
    v.noise({ filter: 'highpass', freq: 5200, dur, gain, at })
    v.noise({ filter: 'bandpass', freq: 8200, q: 0.8, dur: dur * 0.6, gain: gain * 0.6, at })
}

// Recipes -----------------------------------------------------------------

const recipes: Record<XenoSoundEvent, Recipe> = {
    // UI
    'click': (v) => {
        v.tone({ type: 'square', freq: 1500, to: 780, glide: 0.03, dur: 0.035, gain: 0.22 })
        v.noise({ filter: 'highpass', freq: 3800, dur: 0.012, gain: 0.25 })
    },
    'bet-up': (v) => {
        v.tone({ type: 'triangle', freq: note(7), to: note(14), glide: 0.05, dur: 0.09, gain: 0.5 })
        v.tone({ type: 'square', freq: note(19), dur: 0.03, gain: 0.08, at: 0.04 })
    },
    'bet-down': (v) => {
        v.tone({ type: 'triangle', freq: note(14), to: note(5), glide: 0.05, dur: 0.09, gain: 0.5 })
        v.tone({ type: 'square', freq: note(2), dur: 0.03, gain: 0.08, at: 0.04 })
    },
    'toggle': (v, on) => {
        const a = on ? 7 : 14
        const b = on ? 14 : 7
        ping(v, note(a), 0, 0.08, 0.4)
        ping(v, note(b), 0.06, 0.12, 0.4)
    },
    'error': (v) => {
        const lp = v.filter({ freq: 1200, q: 0.8 })
        v.tone({ type: 'square', freq: 196, dur: 0.12, gain: 0.3, dest: lp })
        v.tone({ type: 'square', freq: 147, dur: 0.2, gain: 0.3, at: 0.13, dest: lp })
    },

    // base game
    'spin-start': (v) => {
        thump(v, 170, 70, 0.14, 0.7)
        v.noise({ filter: 'bandpass', freq: 3000, q: 2.5, dur: 0.025, gain: 0.45 })
        whoosh(v, 380, 2600, 0.32, 0.02, 0.35)
        const lp = v.filter({ freq: 500, to: 2200, glide: 0.3, q: 4 })
        v.tone({ type: 'sawtooth', freq: 110, to: 220, glide: 0.3, attack: 0.05, dur: 0.28, gain: 0.18, dest: lp })
    },
    'reel-stop': (v, index) => {
        const k = 1 - Math.min(4, Math.max(0, index)) * 0.035
        // Body: pitch-dropping sine thunk.
        thump(v, 165 * k * v.vary(0.03), 52, 0.17, 1.1)
        // Latch: short band-passed click.
        v.noise({ filter: 'bandpass', freq: 2300, q: 2.2, dur: 0.02, gain: 0.5 })
        // Felt stop: low-passed pink puff.
        v.noise({ color: 'pink', freq: 900, to: 180, glide: 0.08, dur: 0.08, gain: 0.45 })
        // Faint metallic ring of the reel housing.
        v.tone({ type: 'triangle', freq: 1320 * k, dur: 0.07, gain: 0.05, at: 0.005 })
    },
    'scatter-land': (v, count) => {
        const step = [0, 4, 7, 9, 11][Math.max(0, Math.min(4, Math.round(count)))]!
        const f = note(LYDIAN[step]! + 12)
        bell(v, f, 0, 1.1, 0.42)
        v.tone({ freq: f * 2, dur: 0.6, gain: 0.08, at: 0.02, wobble: { rate: 7, depth: 6 } })
        thump(v, 120, 50, 0.2, 0.5)
        sparkle(v, 4, 0.35, 0.05, 0.08, 36)
    },
    'anticipation': (v) => {
        const dur = 1.9
        const bp = v.filter({ type: 'bandpass', freq: 300, to: 2800, glide: dur, q: 5 })
        v.tone({ type: 'sawtooth', freq: note(-24), to: note(-12), glide: dur, attack: dur * 0.8, dur: 0.35, gain: 0.34, dest: bp })
        v.tone({ type: 'sawtooth', freq: note(-17), to: note(-5), glide: dur, attack: dur * 0.8, dur: 0.35, gain: 0.26, dest: bp, detune: 8 })
        v.noise({ filter: 'highpass', freq: 1800, to: 7000, glide: dur, attack: dur * 0.85, dur: 0.3, gain: 0.16 })
        // Heartbeat that quickens.
        const beats = [0, 0.5, 0.9, 1.22, 1.48, 1.68, 1.84]
        beats.forEach((t, i) => thump(v, 95, 42, 0.16, 0.45 + i * 0.07, t))
    },
    'win-small': (v) => {
        arp(v, [0, 2, 4], 0, 0.075, 0.26, 0.34, 12)
        ping(v, note(LYDIAN[7]! + 12), 0.24, 0.5, 0.26)
    },
    'win-medium': (v) => {
        arp(v, [0, 2, 4, 6, 7], 0, 0.07, 0.3, 0.32, 12)
        stab(v, [note(0), note(4), note(7), note(11)], 0.36, 0.7, 0.05, 0.1)
        sparkle(v, 6, 0.6, 0.36, 0.08, 36)
    },
    'win-big': (v) => {
        stab(v, [note(-12), note(-5), note(0), note(4)], 0, 0.45, 0.07, 0.05, 2600)
        arp(v, [0, 2, 4, 6, 7, 9, 11, 14], 0.1, 0.06, 0.3, 0.3, 12)
        stab(v, [note(0), note(4), note(7), note(11), note(14)], 0.62, 1.4, 0.06, 0.25, 4200)
        cymbal(v, 0.62, 1.4, 0.12)
        thump(v, 90, 38, 0.5, 0.9, 0.62)
    },
    'line-show': (v, line) => {
        const f = note(LYDIAN[2 + (Math.round(line) % 5)]! + 12)
        ping(v, f, 0, 0.22, 0.3)
        v.tone({ freq: f * 2, dur: 0.12, gain: 0.08, at: 0.01 })
    },
    'tick': (v) => {
        v.tone({ type: 'triangle', freq: 2350 * v.vary(0.05), dur: 0.028, gain: 0.34 })
        v.tone({ freq: 3900, dur: 0.018, gain: 0.12 })
    },
    'tier-up': (v, tier) => {
        const t = Math.max(0, Math.min(3, Math.round(tier)))
        const root = [0, 2, 4, 7][t]!
        whoosh(v, 600, 5200, 0.35, 0, 0.4, 0.9)
        stab(v, [note(root - 12), note(root - 5), note(root), note(root + 4), note(root + 7)], 0.28, 1.1, 0.07, 0.2, 5000)
        thump(v, 110, 36, 0.55, 1.1, 0.28)
        cymbal(v, 0.28, 1.6, 0.16)
        arp(v, [7, 9, 11, 14], 0.3, 0.05, 0.4, 0.2 + t * 0.03, 12)
    },
    'bigwin-end': (v) => {
        stab(v, [note(-12), note(-5), note(0), note(4), note(11)], 0, 2.2, 0.06, 0.4, 3600)
        bell(v, note(24), 0.02, 1.8, 0.24)
        sparkle(v, 10, 1.2, 0.05, 0.08, 36)
        thump(v, 80, 34, 0.7, 0.9)
    },

    // bonus
    'bonus-trigger': (v) => {
        thump(v, 70, 28, 1.2, 1.2)
        whoosh(v, 200, 4200, 0.8, 0, 0.45, 0.8)
        arp(v, [0, 2, 4, 6, 7, 9, 11, 14, 16], 0.1, 0.06, 0.4, 0.28, 0)
        stab(v, [note(-12), note(-5), note(2), note(6), note(9)], 0.72, 1.8, 0.07, 0.3, 5200)
        cymbal(v, 0.72, 2, 0.16)
        // Saucer warble over the top.
        v.tone({ freq: 880, to: 1320, glide: 1.4, dur: 1.6, attack: 0.3, gain: 0.12, at: 0.7, wobble: { rate: 9, depth: 80 } })
        sparkle(v, 14, 1.6, 0.8, 0.07, 36)
    },
    'bonus-end': (v) => {
        arp(v, [14, 11, 9, 7, 4, 2, 0], 0, 0.07, 0.36, 0.26, 0)
        stab(v, [note(-12), note(-8), note(-5), note(0), note(4)], 0.5, 1.8, 0.06, 0.2, 3000)
        bell(v, note(12), 0.5, 1.8, 0.24)
        thump(v, 80, 34, 0.6, 0.8, 0.5)
    },
    'bonus-spin': (v) => {
        whoosh(v, 500, 2200, 0.22, 0, 0.24)
        v.tone({ type: 'triangle', freq: note(-5), to: note(7), glide: 0.18, dur: 0.2, gain: 0.2 })
    },
    'coin-land': (v, tier) => {
        const t = Math.max(0, Math.min(3, Math.round(tier)))
        const f = [1500, 1900, 2300, 2800][t]!
        bell(v, f, 0, 0.35 + t * 0.12, 0.34)
        thump(v, 150, 60, 0.1, 0.45)
        v.noise({ filter: 'bandpass', freq: 4200, q: 3, dur: 0.03, gain: 0.3 })
        if (t >= 2) sparkle(v, 3 + t, 0.25, 0.04, 0.07, 36)
    },
    'cell-stop': (v) => {
        v.tone({ freq: 240 * v.vary(0.1), to: 110, dur: 0.06, gain: 0.5 })
        v.noise({ filter: 'bandpass', freq: 1900, q: 2, dur: 0.015, gain: 0.25 })
    },
    'core-land': (v, mult) => {
        const lift = mult >= 10 ? 1.5 : mult >= 5 ? 1.25 : 1
        v.tone({ freq: 180 * lift, to: 1400 * lift, glide: 0.28, dur: 0.32, gain: 0.34 })
        v.tone({ type: 'square', freq: 90 * lift, to: 700 * lift, glide: 0.28, dur: 0.3, gain: 0.06 })
        v.noise({ filter: 'highpass', freq: 3000, dur: 0.25, gain: 0.1, tremolo: { rate: 30, depth: 0.9, type: 'square' } })
        thump(v, 120, 50, 0.2, 0.5, 0.26)
    },
    'core-zap': (v) => {
        const lp = v.filter({ freq: 4200, to: 600, glide: 0.2, q: 3 })
        v.tone({ type: 'sawtooth', freq: 1600, to: 180, glide: 0.16, dur: 0.2, gain: 0.3, dest: lp, tremolo: { rate: 48, depth: 0.8 } })
        v.noise({ filter: 'highpass', freq: 2600, dur: 0.12, gain: 0.26, drive: 2, tremolo: { rate: 60, depth: 0.9, type: 'square' } })
        ping(v, 2640, 0.06, 0.25, 0.14)
    },
    'ufo-land': (v) => {
        whoosh(v, 3000, 400, 0.4, 0, 0.4, 1)
        v.tone({ freq: 1180, to: 560, glide: 0.4, dur: 0.6, attack: 0.02, gain: 0.3, wobble: { rate: 11, depth: 90 } })
        v.tone({ type: 'triangle', freq: 280, to: 140, dur: 0.5, gain: 0.22, wobble: { rate: 6, depth: 18 } })
        thump(v, 110, 40, 0.3, 0.7, 0.32)
    },
    'ufo-beam': (v) => {
        const dur = 1.1
        const lp = v.filter({ freq: 400, to: 2400, glide: dur, q: 6 })
        v.tone({ type: 'sawtooth', freq: 82, attack: 0.08, hold: dur * 0.6, dur: 0.4, gain: 0.3, dest: lp, tremolo: { rate: 14, depth: 0.5 } })
        v.tone({ type: 'sawtooth', freq: 123, attack: 0.08, hold: dur * 0.6, dur: 0.4, gain: 0.2, dest: lp, detune: 7 })
        v.tone({ freq: 660, to: 1760, glide: dur, attack: 0.2, hold: dur * 0.4, dur: 0.4, gain: 0.08, wobble: { rate: 12, depth: 30 } })
    },
    'collect-coin': (v, index) => {
        const step = Math.min(LYDIAN.length - 1, Math.max(0, Math.round(index)))
        const f = note(LYDIAN[step]! + 12)
        ping(v, f, 0, 0.3, 0.4)
        v.tone({ freq: f * 2, dur: 0.12, gain: 0.1, at: 0.015 })
    },
    'board-clear': (v) => {
        whoosh(v, 4200, 300, 0.5, 0, 0.35, 0.9)
        sparkle(v, 8, 0.4, 0.05, 0.07, 36)
    },
    'buy-bonus': (v) => {
        v.noise({ filter: 'bandpass', freq: 3200, q: 1.5, dur: 0.05, gain: 0.5 })
        bell(v, note(19), 0.04, 0.7, 0.3)
        bell(v, note(26), 0.13, 0.9, 0.3)
        for (let i = 0; i < 6; i++) v.tone({ type: 'triangle', freq: 2200 + Math.random() * 1800, dur: 0.05, gain: 0.12, at: 0.08 + Math.random() * 0.25 })
        thump(v, 140, 50, 0.2, 0.6)
    }
}

export const XENO_SYNTH_RECIPES: Readonly<Record<XenoSoundEvent, Recipe>> = recipes

export function xenoSynthWarmUp(ctx: BaseAudioContext) {
    shapezzSynthWarmUp(ctx)
}

// Sustained layers ----------------------------------------------------------

export interface XenoLoopHandle {
    stop: (fade?: number) => void
}

function noiseSource(ctx: BaseAudioContext, pink = true) {
    const kit = shapezzSynthWarmUp(ctx)
    const src = ctx.createBufferSource()
    src.buffer = pink ? kit.pink : kit.white
    src.loop = true
    return src
}

function lfo(ctx: BaseAudioContext, rate: number, depth: number, param: AudioParam, type: OscillatorType = 'sine') {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = rate
    const amount = ctx.createGain()
    amount.gain.value = depth
    osc.connect(amount)
    amount.connect(param)
    return { osc, amount }
}

function teardown(ctx: BaseAudioContext, output: GainNode, sources: AudioScheduledSourceNode[], nodes: AudioNode[], fade: number) {
    const now = ctx.currentTime
    output.gain.cancelScheduledValues(now)
    output.gain.setValueAtTime(output.gain.value, now)
    output.gain.linearRampToValueAtTime(0, now + fade)
    for (const src of sources) {
        try {
            src.stop(now + fade + 0.02)
        } catch {
            // Already stopped.
        }
    }
    setTimeout(() => {
        for (const node of nodes) node.disconnect()
        output.disconnect()
    }, (fade + 0.1) * 1000)
}

/**
 * Reel whir while the reels spin: a band-passed noise bed chopped by a fast
 * square LFO (symbols clicking past) over a low motor hum. `setLevel` scales
 * it down as reels stop.
 */
export class XenoReelWhir implements XenoLoopHandle {
    private readonly output: GainNode
    private readonly sources: AudioScheduledSourceNode[]
    private readonly nodes: AudioNode[]
    private stopped = false

    constructor(private readonly ctx: BaseAudioContext, destination: AudioNode, private readonly level: number) {
        const now = ctx.currentTime
        this.output = ctx.createGain()
        this.output.gain.setValueAtTime(0, now)
        this.output.gain.linearRampToValueAtTime(level, now + 0.12)
        this.output.connect(destination)

        const noise = noiseSource(ctx, false)
        const band = ctx.createBiquadFilter()
        band.type = 'bandpass'
        band.frequency.value = 1400
        band.Q.value = 1.1
        const chop = ctx.createGain()
        chop.gain.value = 0.3
        noise.connect(band).connect(chop).connect(this.output)
        const chopper = lfo(ctx, 22, 0.28, chop.gain, 'square')

        const hum = ctx.createOscillator()
        hum.type = 'sawtooth'
        hum.frequency.value = 58
        const humFilter = ctx.createBiquadFilter()
        humFilter.type = 'lowpass'
        humFilter.frequency.value = 240
        const humGain = ctx.createGain()
        humGain.gain.value = 0.35
        hum.connect(humFilter).connect(humGain).connect(this.output)
        const wow = lfo(ctx, 5.5, 3, hum.frequency)

        this.sources = [noise, hum, chopper.osc, wow.osc]
        this.nodes = [band, chop, humFilter, humGain, chopper.amount, wow.amount, ...this.sources]
        noise.start(now, Math.random())
        for (const src of [hum, chopper.osc, wow.osc]) src.start(now)
    }

    /** 0..1 share of reels still spinning. */
    setLevel(share: number) {
        if (this.stopped) return
        const target = this.level * Math.max(0, Math.min(1, share))
        this.output.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04)
    }

    stop(fade = 0.12) {
        if (this.stopped) return
        this.stopped = true
        teardown(this.ctx, this.output, [], this.nodes, fade)
    }
}

// Chords of the ambient bed, semitones from A4 (A minor 9 → F maj 7 → C add 9 → E minor 7).
const PAD_CHORDS = [
    [0, 7, 10, 14],
    [-4, 3, 7, 12],
    [3, 10, 14, 19],
    [-5, 2, 7, 10]
]
const PAD_BONUS_CHORDS = [
    [0, 7, 11, 18],
    [2, 9, 14, 18],
    [-3, 4, 11, 14],
    [2, 9, 12, 18]
]

/**
 * Ambient music bed: sparse glassy plinks on the current chord, sent through a
 * feedback delay. There is no sustained pad or bass, so nothing hums under the
 * game. Bonus mode swaps to Lydian voicings and plinks faster.
 */
export class XenoAmbient implements XenoLoopHandle {
    private readonly output: GainNode
    private readonly delay: DelayNode
    private readonly feedback: GainNode
    private readonly nodes: AudioNode[] = []
    private chordTimer: ReturnType<typeof setTimeout> | null = null
    private plinkTimer: ReturnType<typeof setTimeout> | null = null
    private chord = 0
    private bonus = false
    private stopped = false

    constructor(private readonly ctx: BaseAudioContext, destination: AudioNode, level: number) {
        const now = ctx.currentTime
        this.output = ctx.createGain()
        this.output.gain.setValueAtTime(0, now)
        this.output.gain.linearRampToValueAtTime(level, now + 3)
        this.output.connect(destination)

        this.delay = ctx.createDelay(1)
        this.delay.delayTime.value = 0.42
        this.feedback = ctx.createGain()
        this.feedback.gain.value = 0.42
        const wet = ctx.createGain()
        wet.gain.value = 0.5
        this.delay.connect(this.feedback).connect(this.delay)
        this.delay.connect(wet).connect(this.output)
        this.nodes.push(this.delay, this.feedback, wet)

        this.scheduleChord()
        this.schedulePlink()
    }

    setBonus(bonus: boolean) {
        if (this.stopped || this.bonus === bonus) return
        this.bonus = bonus
    }

    private chords() {
        return this.bonus ? PAD_BONUS_CHORDS : PAD_CHORDS
    }

    private scheduleChord() {
        this.chordTimer = setTimeout(() => {
            if (this.stopped) return
            this.chord++
            this.scheduleChord()
        }, this.bonus ? 4000 : 8000)
    }

    private schedulePlink() {
        const delay = (this.bonus ? 600 : 1800) + Math.random() * (this.bonus ? 900 : 3200)
        this.plinkTimer = setTimeout(() => {
            if (this.stopped) return
            this.plink()
            this.schedulePlink()
        }, delay)
    }

    private plink() {
        const chord = this.chords()[this.chord % this.chords().length]!
        const semis = chord[Math.floor(Math.random() * chord.length)]! + 12 + (Math.random() < 0.4 ? 12 : 0)
        const voice = new ShapezzSynthVoice(this.ctx, this.delay, { level: 0.1, start: this.ctx.currentTime + 0.01 })
        voice.output.connect(this.output)
        voice.tone({ type: 'triangle', freq: note(semis), dur: 0.9, gain: 0.5 })
        voice.tone({ freq: note(semis) * 2, dur: 0.4, gain: 0.12 })
        voice.seal()
    }

    stop(fade = 0.8) {
        if (this.stopped) return
        this.stopped = true
        if (this.chordTimer) clearTimeout(this.chordTimer)
        if (this.plinkTimer) clearTimeout(this.plinkTimer)
        teardown(this.ctx, this.output, [], this.nodes, fade)
    }
}
