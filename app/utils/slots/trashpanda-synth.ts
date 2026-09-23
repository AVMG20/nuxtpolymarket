// Trash Panda Heist sound design. Every effect is synthesized at play time on
// the shared SHAPEZZ synth voice (oscillators, filtered noise, envelopes,
// drive); there are no sample files. Played through
// app/composables/trashpanda-sound.ts.
//
// Palette: E minor blues for anything melodic (wins, pickups), plucky
// triangles and muted saws for a cartoon-caper feel, band-passed noise for
// lids, whooshes and brushes, pitch-dropping sines for thunks.
//
// Besides the one-shot recipes this file builds the two sustained layers the
// composable owns: the reel whir and the sneaky heist music loop.

import { ShapezzSynthVoice, shapezzNote, shapezzSynthWarmUp } from '~/utils/shapezz-synth'

export { ShapezzSynthVoice as TphSynthVoice }

export type TphSoundEvent
    = 'click' | 'bet-up' | 'bet-down' | 'toggle' | 'error'
        | 'spin-start' | 'reel-stop' | 'scatter-land' | 'bin-land' | 'anticipation'
        | 'win-small' | 'win-medium' | 'win-big' | 'way-show' | 'tick'
        | 'tier-up' | 'bigwin-end'
        | 'fs-trigger' | 'fs-spin' | 'fs-end' | 'wild-stick' | 'retrigger'
        | 'dive-trigger' | 'lid-rattle' | 'bin-open' | 'cash' | 'double' | 'donut' | 'dog-bark' | 'dog-eat' | 'key' | 'dive-end'
        | 'buy-bonus'

export const TPH_SOUND_LEVELS: Record<TphSoundEvent, number> = {
    'click': 0.22,
    'bet-up': 0.24,
    'bet-down': 0.24,
    'toggle': 0.22,
    'error': 0.3,
    'spin-start': 0.32,
    'reel-stop': 0.46,
    'scatter-land': 0.42,
    'bin-land': 0.4,
    'anticipation': 0.34,
    'win-small': 0.34,
    'win-medium': 0.4,
    'win-big': 0.46,
    'way-show': 0.2,
    'tick': 0.12,
    'tier-up': 0.5,
    'bigwin-end': 0.46,
    'fs-trigger': 0.52,
    'fs-spin': 0.26,
    'fs-end': 0.46,
    'wild-stick': 0.42,
    'retrigger': 0.48,
    'dive-trigger': 0.5,
    'lid-rattle': 0.3,
    'bin-open': 0.4,
    'cash': 0.38,
    'double': 0.44,
    'donut': 0.4,
    'dog-bark': 0.52,
    'dog-eat': 0.44,
    'key': 0.46,
    'dive-end': 0.44,
    'buy-bonus': 0.44
}

export const TPH_SOUND_COOLDOWNS: Record<TphSoundEvent, number> = {
    'click': 40,
    'bet-up': 40,
    'bet-down': 40,
    'toggle': 60,
    'error': 400,
    'spin-start': 120,
    'reel-stop': 35,
    'scatter-land': 60,
    'bin-land': 60,
    'anticipation': 500,
    'win-small': 200,
    'win-medium': 200,
    'win-big': 400,
    'way-show': 90,
    'tick': 42,
    'tier-up': 250,
    'bigwin-end': 600,
    'fs-trigger': 1200,
    'fs-spin': 150,
    'fs-end': 1200,
    'wild-stick': 60,
    'retrigger': 800,
    'dive-trigger': 1200,
    'lid-rattle': 200,
    'bin-open': 80,
    'cash': 60,
    'double': 200,
    'donut': 200,
    'dog-bark': 300,
    'dog-eat': 300,
    'key': 400,
    'dive-end': 1000,
    'buy-bonus': 400
}

export const TPH_SOUND_VOICE_CAPS: Partial<Record<TphSoundEvent, number>> = {
    'tick': 3,
    'reel-stop': 5,
    'wild-stick': 4,
    'tier-up': 2,
    'fs-trigger': 1,
    'dive-trigger': 1,
    'anticipation': 1
}

export const TPH_SOUND_DEFAULT_VOICE_CAP = 3
export const TPH_SOUND_MAX_VOICES = 36

export const TPH_SYNTH_JITTER: Partial<Record<TphSoundEvent, number>> = {
    'tick': 0.06,
    'reel-stop': 0.03,
    'lid-rattle': 0.08,
    'bin-open': 0.05,
    'dog-bark': 0.05,
    'win-small': 0,
    'win-medium': 0,
    'win-big': 0,
    'tier-up': 0,
    'bigwin-end': 0,
    'fs-trigger': 0,
    'fs-end': 0,
    'dive-trigger': 0,
    'way-show': 0,
    'cash': 0,
    'scatter-land': 0
}
export const TPH_SYNTH_DEFAULT_JITTER = 0.02

const note = shapezzNote

/** E minor blues, semitones above E4 (E G A Bb B D E …). */
const BLUES = [0, 3, 5, 6, 7, 10, 12, 15, 17, 18, 19, 22, 24, 27, 29]
/** E4 is 5 semitones below A4. */
const E = -5

type Recipe = (v: ShapezzSynthVoice, intensity: number) => void

function thump(v: ShapezzSynthVoice, from: number, to: number, dur: number, gain = 1, at = 0) {
    v.tone({ freq: from, to, glide: dur * 0.6, dur, gain, at })
}

/** Round plucky tone: triangle plus a soft octave. */
function pluck(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
    v.tone({ type: 'triangle', freq, dur, gain, at })
    v.tone({ freq: freq * 2, dur: dur * 0.4, gain: gain * 0.25, at })
}

/** Vibraphone-ish bell. */
function vibe(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.4) {
    v.tone({ freq, dur, gain, at, tremolo: { rate: 5.5, depth: 0.35 } })
    v.tone({ freq: freq * 4, dur: dur * 0.2, gain: gain * 0.12, at })
}

/** Muted brass stab: detuned saws through a closing low-pass. */
function brass(v: ShapezzSynthVoice, freqs: number[], at: number, dur: number, gain = 0.14, hold = 0, bright = 2800) {
    const filter = v.filter({ freq: bright, to: 500, at, glide: hold + dur, q: 2 })
    for (const freq of freqs) {
        v.tone({ type: 'sawtooth', freq, detune: -8, dur, hold, gain, at, attack: 0.015, dest: filter })
        v.tone({ type: 'sawtooth', freq, detune: 8, dur, hold, gain, at, attack: 0.015, dest: filter })
    }
}

function whoosh(v: ShapezzSynthVoice, from: number, to: number, dur: number, at = 0, gain = 0.5, q = 1.2) {
    v.noise({ filter: 'bandpass', freq: from, to, glide: dur, q, attack: dur * 0.4, dur: dur * 0.6, gain, at })
}

function cymbal(v: ShapezzSynthVoice, at: number, dur: number, gain = 0.2) {
    v.noise({ filter: 'highpass', freq: 5200, dur, gain, at })
    v.noise({ filter: 'bandpass', freq: 8200, q: 0.8, dur: dur * 0.6, gain: gain * 0.6, at })
}

/** Plucked run over blues steps. */
function run(v: ShapezzSynthVoice, steps: number[], at: number, gap: number, dur: number, gain: number, pl: 'pluck' | 'vibe' = 'pluck', octave = 0) {
    steps.forEach((s, i) => (pl === 'pluck' ? pluck : vibe)(v, blues(s, octave), at + i * gap, dur, gain))
}

function blues(step: number, octave = 0) {
    return note(E + BLUES[Math.max(0, Math.min(BLUES.length - 1, step))]! + octave)
}

/** Metal lid clank: inharmonic partials over a noise hit. */
function clank(v: ShapezzSynthVoice, at = 0, gain = 0.5, base = 520) {
    v.noise({ filter: 'bandpass', freq: 2600, q: 2, dur: 0.05, gain: gain * 0.8, at })
    v.tone({ type: 'triangle', freq: base * v.vary(0.05), dur: 0.35, gain: gain * 0.5, at })
    v.tone({ freq: base * 2.43, dur: 0.22, gain: gain * 0.25, at })
    v.tone({ freq: base * 3.87, dur: 0.14, gain: gain * 0.15, at })
}

function coinChing(v: ShapezzSynthVoice, at: number, gain = 0.4, lift = 1) {
    v.tone({ type: 'square', freq: 1976 * lift, dur: 0.05, gain: gain * 0.25, at })
    v.tone({ type: 'triangle', freq: 2637 * lift, dur: 0.4, gain, at: at + 0.05 })
    v.tone({ freq: 5274 * lift, dur: 0.15, gain: gain * 0.15, at: at + 0.05 })
}

const recipes: Record<TphSoundEvent, Recipe> = {
    // UI
    'click': (v) => {
        v.tone({ type: 'square', freq: 1400, to: 700, glide: 0.03, dur: 0.035, gain: 0.2 })
        v.noise({ filter: 'highpass', freq: 3800, dur: 0.012, gain: 0.25 })
    },
    'bet-up': (v) => {
        pluck(v, blues(4), 0, 0.09, 0.5)
        pluck(v, blues(6), 0.05, 0.1, 0.4)
    },
    'bet-down': (v) => {
        pluck(v, blues(6), 0, 0.09, 0.5)
        pluck(v, blues(4), 0.05, 0.1, 0.4)
    },
    'toggle': (v, on) => {
        pluck(v, blues(on ? 4 : 7), 0, 0.08, 0.4)
        pluck(v, blues(on ? 7 : 4), 0.06, 0.12, 0.4)
    },
    'error': (v) => {
        const lp = v.filter({ freq: 1100, q: 0.8 })
        v.tone({ type: 'square', freq: 196, dur: 0.12, gain: 0.3, dest: lp })
        v.tone({ type: 'square', freq: 147, dur: 0.2, gain: 0.3, at: 0.13, dest: lp })
    },

    // base game
    'spin-start': (v) => {
        thump(v, 160, 70, 0.12, 0.6)
        whoosh(v, 400, 2400, 0.28, 0.02, 0.32)
        v.tone({ type: 'triangle', freq: blues(0, -12), to: blues(7, -12), glide: 0.2, dur: 0.22, gain: 0.3 })
    },
    'reel-stop': (v, index) => {
        const k = 1 - Math.min(4, Math.max(0, index)) * 0.035
        thump(v, 150 * k * v.vary(0.03), 48, 0.16, 1)
        v.noise({ filter: 'bandpass', freq: 1800, q: 2, dur: 0.02, gain: 0.45 })
        v.noise({ color: 'pink', freq: 800, to: 160, glide: 0.07, dur: 0.07, gain: 0.4 })
    },
    'scatter-land': (v, count) => {
        const step = [0, 4, 6, 7, 9][Math.max(0, Math.min(4, Math.round(count)))]!
        clank(v, 0, 0.5, 700)
        vibe(v, blues(step + 4, 12), 0.02, 0.9, 0.4)
        v.tone({ type: 'triangle', freq: 90, to: 60, dur: 0.3, gain: 0.5 })
    },
    'bin-land': (v, count) => {
        clank(v, 0, 0.55, 380 + Math.round(count) * 60)
        v.noise({ color: 'pink', freq: 600, to: 120, dur: 0.18, gain: 0.35 })
        pluck(v, blues(2 + Math.round(count) * 2), 0.05, 0.3, 0.3)
    },
    'anticipation': (v) => {
        const dur = 1.8
        const bp = v.filter({ type: 'bandpass', freq: 300, to: 2400, glide: dur, q: 5 })
        v.tone({ type: 'sawtooth', freq: blues(0, -24), to: blues(0, -12), glide: dur, attack: dur * 0.8, dur: 0.35, gain: 0.3, dest: bp })
        v.noise({ filter: 'highpass', freq: 1800, to: 6800, glide: dur, attack: dur * 0.85, dur: 0.3, gain: 0.14 })
        // Tiptoe steps that speed up.
        const steps = [0, 0.4, 0.75, 1.05, 1.3, 1.5, 1.66]
        steps.forEach((t, i) => pluck(v, blues(i % 2 ? 3 : 0, -12), t, 0.12, 0.3 + i * 0.03))
    },
    'win-small': (v) => {
        pluck(v, blues(4), 0, 0.2, 0.4)
        pluck(v, blues(7), 0.08, 0.3, 0.36)
    },
    'win-medium': (v) => {
        run(v, [4, 6, 7, 9], 0, 0.07, 0.25, 0.36)
        brass(v, [blues(0), blues(4), blues(7)], 0.3, 0.5, 0.05, 0.1)
    },
    'win-big': (v) => {
        brass(v, [blues(0, -12), blues(4, -12), blues(7, -12)], 0, 0.4, 0.07, 0.05)
        run(v, [4, 6, 7, 9, 11, 12], 0.12, 0.06, 0.3, 0.3)
        brass(v, [blues(0), blues(4), blues(7), blues(9)], 0.55, 1.2, 0.06, 0.25, 3600)
        cymbal(v, 0.55, 1.2, 0.12)
    },
    'way-show': (v, i) => {
        pluck(v, blues(4 + (Math.round(i) % 6)), 0, 0.22, 0.34)
    },
    'tick': (v) => {
        v.tone({ type: 'triangle', freq: 2200 * v.vary(0.05), dur: 0.028, gain: 0.34 })
    },
    'tier-up': (v, tier) => {
        const t = Math.max(0, Math.min(4, Math.round(tier)))
        const root = [0, 2, 3, 5, 7][t]!
        whoosh(v, 600, 5000, 0.35, 0, 0.4, 0.9)
        brass(v, [blues(root, -12), blues(root + 2, -12), blues(root + 4, -12), blues(root + 6)], 0.28, 1.1, 0.07, 0.2, 4800)
        thump(v, 110, 36, 0.55, 1.1, 0.28)
        cymbal(v, 0.28, 1.5, 0.16)
    },
    'bigwin-end': (v) => {
        brass(v, [blues(0, -12), blues(4, -12), blues(7, -12), blues(9)], 0, 2, 0.06, 0.4, 3400)
        vibe(v, blues(12), 0.02, 1.6, 0.3)
        thump(v, 80, 34, 0.7, 0.9)
    },

    // free spins
    'fs-trigger': (v) => {
        // Alarm siren + vault door + fanfare.
        v.tone({ type: 'square', freq: 700, to: 1100, glide: 0.3, dur: 0.32, gain: 0.08, wobble: { rate: 3, depth: 200 } })
        v.tone({ type: 'square', freq: 1100, to: 700, glide: 0.3, dur: 0.32, gain: 0.08, at: 0.32 })
        clank(v, 0.6, 0.6, 260)
        thump(v, 70, 28, 1, 1.2, 0.6)
        run(v, [0, 4, 6, 7, 9, 12], 0.7, 0.07, 0.35, 0.3)
        brass(v, [blues(0, -12), blues(4, -12), blues(7, -12), blues(12, -12)], 1.15, 1.5, 0.07, 0.3, 5000)
        cymbal(v, 1.15, 1.8, 0.16)
    },
    'fs-spin': (v) => {
        whoosh(v, 500, 2200, 0.22, 0, 0.24)
        pluck(v, blues(0, -12), 0, 0.15, 0.25)
    },
    'fs-end': (v) => {
        run(v, [12, 9, 7, 6, 4, 0], 0, 0.07, 0.3, 0.28)
        brass(v, [blues(0, -12), blues(3, -12), blues(7, -12), blues(10)], 0.5, 1.6, 0.06, 0.2, 3000)
        thump(v, 80, 34, 0.6, 0.8, 0.5)
    },
    'wild-stick': (v, mult) => {
        const lift = mult >= 10 ? 1.5 : mult >= 5 ? 1.3 : mult >= 3 ? 1.15 : 1
        thump(v, 180, 60, 0.18, 0.8)
        v.noise({ filter: 'bandpass', freq: 1600, q: 1.5, dur: 0.08, gain: 0.35 })
        // Glue "thwack" then a rising sparkle.
        v.tone({ type: 'triangle', freq: 300 * lift, to: 1200 * lift, glide: 0.2, dur: 0.24, gain: 0.3, at: 0.04 })
        vibe(v, blues(7, 12) * lift, 0.18, 0.5, 0.22)
    },
    'retrigger': (v) => {
        clank(v, 0, 0.5, 600)
        run(v, [4, 8, 11, 14], 0.05, 0.08, 0.5, 0.3, 'vibe', 12)
        cymbal(v, 0.3, 1, 0.12)
    },

    // dumpster dive
    'dive-trigger': (v) => {
        clank(v, 0, 0.6, 330)
        clank(v, 0.18, 0.5, 410)
        v.noise({ color: 'pink', freq: 900, to: 200, dur: 0.5, gain: 0.35, at: 0.3 })
        run(v, [0, 3, 5, 6, 7], 0.4, 0.1, 0.25, 0.4, 'pluck', -12)
        brass(v, [blues(0, -12), blues(3, -12), blues(7, -12)], 0.95, 1.2, 0.07, 0.2, 3000)
    },
    'lid-rattle': (v) => {
        for (let i = 0; i < 4; i++) v.noise({ filter: 'bandpass', freq: 2400 * v.vary(0.2), q: 3, dur: 0.03, gain: 0.35, at: i * 0.05 })
    },
    'bin-open': (v) => {
        clank(v, 0, 0.5, 480)
        whoosh(v, 800, 3200, 0.2, 0.02, 0.3)
    },
    'cash': (v, tier) => {
        const t = Math.max(0, Math.min(4, Math.round(tier)))
        coinChing(v, 0, 0.4, 1 + t * 0.06)
        if (t >= 2) coinChing(v, 0.09, 0.3, 1.26)
        if (t >= 3) run(v, [7, 9, 11, 12], 0.15, 0.06, 0.3, 0.26)
    },
    'double': (v) => {
        v.tone({ freq: 300, to: 1600, glide: 0.3, dur: 0.34, gain: 0.3 })
        brass(v, [blues(0), blues(4), blues(7)], 0.3, 0.7, 0.07, 0.1, 4200)
        cymbal(v, 0.3, 0.8, 0.12)
    },
    'donut': (v) => {
        // Cartoon "boing" plus a happy chime.
        v.tone({ type: 'triangle', freq: 220, to: 660, glide: 0.12, dur: 0.3, gain: 0.4, wobble: { rate: 14, depth: 40 } })
        vibe(v, blues(9, 12), 0.15, 0.5, 0.3)
        vibe(v, blues(12, 12), 0.25, 0.6, 0.3)
    },
    'dog-bark': (v) => {
        for (const at of [0, 0.22]) {
            const bp = v.filter({ type: 'bandpass', freq: 900, q: 1.4, at })
            v.tone({ type: 'sawtooth', freq: 320 * v.vary(0.05), to: 180, glide: 0.12, dur: 0.14, gain: 0.7, at, dest: bp, drive: 3 })
            v.noise({ filter: 'bandpass', freq: 1400, q: 1, dur: 0.1, gain: 0.5, at })
        }
        // Sad trombone slide.
        brass(v, [blues(7, -12)], 0.6, 0.3, 0.12, 0.05, 1600)
        v.tone({ type: 'sawtooth', freq: blues(6, -12), to: blues(0, -24), glide: 0.8, dur: 0.9, attack: 0.05, gain: 0.08, at: 0.9, wobble: { rate: 6, depth: 6 } })
    },
    'dog-eat': (v) => {
        for (let i = 0; i < 4; i++) {
            v.noise({ color: 'pink', filter: 'lowpass', freq: 900, dur: 0.06, gain: 0.5, at: i * 0.11 })
            thump(v, 120, 60, 0.06, 0.4, i * 0.11)
        }
        v.tone({ type: 'triangle', freq: 500, to: 300, glide: 0.3, dur: 0.4, gain: 0.25, at: 0.5, wobble: { rate: 8, depth: 30 } })
    },
    'key': (v) => {
        run(v, [2, 6, 9, 14, 13], 0, 0.07, 0.8, 0.28, 'vibe', 12)
        cymbal(v, 0.1, 1.2, 0.1)
        v.tone({ freq: 2400, to: 3600, glide: 0.4, dur: 0.6, gain: 0.08, at: 0.2, tremolo: { rate: 16, depth: 0.6 } })
    },
    'dive-end': (v) => {
        run(v, [0, 4, 7, 9, 12], 0, 0.06, 0.3, 0.3)
        brass(v, [blues(0, -12), blues(4, -12), blues(7, -12)], 0.35, 1.3, 0.06, 0.2, 3000)
    },
    'buy-bonus': (v) => {
        coinChing(v, 0, 0.35)
        coinChing(v, 0.1, 0.3, 1.19)
        thump(v, 140, 50, 0.2, 0.6)
    }
}

export const TPH_SYNTH_RECIPES: Readonly<Record<TphSoundEvent, Recipe>> = recipes

export function tphSynthWarmUp(ctx: BaseAudioContext) {
    shapezzSynthWarmUp(ctx)
}

// Sustained layers ----------------------------------------------------------

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

/** Reel whir: a chopped band-passed noise bed over a low hum. */
export class TphReelWhir {
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

        const kit = shapezzSynthWarmUp(ctx)
        const noise = ctx.createBufferSource()
        noise.buffer = kit.white
        noise.loop = true
        const band = ctx.createBiquadFilter()
        band.type = 'bandpass'
        band.frequency.value = 1200
        band.Q.value = 1.1
        const chop = ctx.createGain()
        chop.gain.value = 0.3
        noise.connect(band).connect(chop).connect(this.output)
        const chopper = lfo(ctx, 20, 0.28, chop.gain, 'square')

        const hum = ctx.createOscillator()
        hum.type = 'sawtooth'
        hum.frequency.value = 55
        const humFilter = ctx.createBiquadFilter()
        humFilter.type = 'lowpass'
        humFilter.frequency.value = 220
        const humGain = ctx.createGain()
        humGain.gain.value = 0.3
        hum.connect(humFilter).connect(humGain).connect(this.output)

        this.sources = [noise, hum, chopper.osc]
        this.nodes = [band, chop, humFilter, humGain, chopper.amount, ...this.sources]
        noise.start(now, Math.random())
        hum.start(now)
        chopper.osc.start(now)
    }

    setLevel(share: number) {
        if (this.stopped) return
        this.output.gain.setTargetAtTime(this.level * Math.max(0, Math.min(1, share)), this.ctx.currentTime, 0.04)
    }

    stop(fade = 0.12) {
        if (this.stopped) return
        this.stopped = true
        const now = this.ctx.currentTime
        this.output.gain.cancelScheduledValues(now)
        this.output.gain.setValueAtTime(this.output.gain.value, now)
        this.output.gain.linearRampToValueAtTime(0, now + fade)
        for (const src of this.sources) {
            try {
                src.stop(now + fade + 0.02)
            } catch {
                // Already stopped.
            }
        }
        setTimeout(() => {
            for (const node of this.nodes) node.disconnect()
            this.output.disconnect()
        }, (fade + 0.1) * 1000)
    }
}

// Walking bass over two bars of eighths, semitones from E2. A sneaky chromatic
// creep: E G A B♭ B A G E | E G A B♭ B D E D.
const BASS = [
    [0, 3, 5, 6, 7, 5, 3, 0],
    [0, 3, 5, 6, 7, 10, 12, 10],
    [5, 8, 10, 11, 12, 10, 8, 5],
    [7, 6, 5, 3, 2, 3, 6, 7]
]
// Vibraphone answer phrases (blues steps, 16th-grid positions within a bar).
const LICKS: [number, number][][] = [
    [[2, 7], [5, 9], [6, 10], [10, 8]],
    [[0, 12], [3, 11], [6, 9], [12, 7]],
    [[2, 4], [4, 6], [6, 7], [8, 9], [12, 7]],
    [[0, 9], [6, 10], [10, 12]]
]

/**
 * Heist music: a swung walking bass, brushed hats and snare, and a vibraphone
 * answering every other bar. Scheduled ahead on the audio clock. Free-spin
 * mode speeds it up, adds a kick and a brass stab on each bar.
 */
export class TphMusic {
    private readonly output: GainNode
    private readonly timer: ReturnType<typeof setInterval>
    private step = 0
    private nextTime: number
    private bonus = false
    private stopped = false

    constructor(private readonly ctx: BaseAudioContext, destination: AudioNode, level: number) {
        const now = ctx.currentTime
        this.output = ctx.createGain()
        this.output.gain.setValueAtTime(0, now)
        this.output.gain.linearRampToValueAtTime(level, now + 1.5)
        this.output.connect(destination)
        this.nextTime = now + 0.15
        this.timer = setInterval(() => this.pump(), 60)
    }

    setBonus(on: boolean) {
        this.bonus = on
    }

    private sixteenth() {
        return 60 / (this.bonus ? 132 : 104) / 4
    }

    private pump() {
        if (this.stopped) return
        const ahead = this.ctx.currentTime + 0.25
        // Resync after the tab slept.
        if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05
        while (this.nextTime < ahead) {
            this.schedule(this.step, this.nextTime)
            // Swing: long-short sixteenth pairs.
            const d = this.sixteenth()
            this.nextTime += this.step % 2 === 0 ? d * 1.16 : d * 0.84
            this.step = (this.step + 1) % 64
        }
    }

    private voice(at: number, level: number, build: (v: ShapezzSynthVoice) => void) {
        const v = new ShapezzSynthVoice(this.ctx, this.output, { level, start: at })
        try {
            build(v)
        } catch {
            v.release(0)
        }
        v.seal()
    }

    private schedule(step: number, at: number) {
        const bar = Math.floor(step / 16)
        const pos = step % 16
        const d = this.sixteenth()
        // Bass on every eighth.
        if (pos % 2 === 0) {
            const semis = BASS[bar]![pos / 2]!
            this.voice(at, 0.5, (v) => {
                const f = note(E - 24 + semis)
                const lp = v.filter({ freq: this.bonus ? 1400 : 900, to: 220, glide: d * 2, q: 3 })
                v.tone({ type: 'sawtooth', freq: f, dur: d * 1.9, gain: 0.35, dest: lp, fixed: true })
                v.tone({ freq: f, dur: d * 2, gain: 0.5, fixed: true })
            })
        }
        // Brushed hats on the off-beats, a soft ride tick on the rest.
        if (pos % 4 === 2) this.voice(at, 0.08, v => v.noise({ filter: 'highpass', freq: 6500, dur: 0.07, gain: 1 }))
        else if (pos % 2 === 0) this.voice(at, 0.04, v => v.noise({ filter: 'bandpass', freq: 8000, q: 1.5, dur: 0.05, gain: 1 }))
        // Brush snare on 2 and 4.
        if (pos === 4 || pos === 12) this.voice(at, 0.12, v => v.noise({ filter: 'bandpass', freq: 2200, q: 0.8, attack: 0.01, dur: 0.14, gain: 1 }))
        if (this.bonus) {
            if (pos === 0 || pos === 8) this.voice(at, 0.5, v => v.tone({ freq: 120, to: 42, glide: 0.1, dur: 0.18, gain: 1, fixed: true }))
            if (pos === 0 && bar % 2 === 0) {
                this.voice(at, 0.1, v => brass(v, [note(E - 12), note(E - 9), note(E - 5)], 0, 0.35, 0.5, 0.05, 2400))
            }
        }
        // Vibes answer on odd bars.
        if (bar % 2 === 1) {
            const lick = LICKS[(Math.floor(step / 32) + (this.bonus ? 2 : 0)) % LICKS.length]!
            for (const [p, s] of lick) {
                if (p === pos) this.voice(at, 0.09, v => vibe(v, blues(s), 0, 0.5, 1))
            }
        }
    }

    stop(fade = 0.6) {
        if (this.stopped) return
        this.stopped = true
        clearInterval(this.timer)
        const now = this.ctx.currentTime
        this.output.gain.cancelScheduledValues(now)
        this.output.gain.setValueAtTime(this.output.gain.value, now)
        this.output.gain.linearRampToValueAtTime(0, now + fade)
        setTimeout(() => this.output.disconnect(), (fade + 0.6) * 1000)
    }
}
