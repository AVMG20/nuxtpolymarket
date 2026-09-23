// Procedural Aether Gates sound effects. Every effect is a recipe scheduled
// on a synth voice (the ShapezzSynthVoice SHAPEZZ and Pirate Raid use:
// oscillators, filtered noise, envelopes, drive), which cleans its nodes up
// once every source ended. Nothing is fetched.
//
// Palette: D major for anything melodic (bells, harp, brass), high-passed
// noise and sine pings for shattering gems, square-wobbled saws and white
// noise for lightning, pitch-dropping sines for stone and thunder.

import type { AetherSoundEvent } from '~/utils/slots/aethergates-sounds'
import { ShapezzSynthVoice, shapezzNote, shapezzSynthWarmUp } from '~/utils/shapezz-synth'

export { ShapezzSynthVoice as AetherSynthVoice }

export function aetherSynthWarmUp(ctx: BaseAudioContext) {
    shapezzSynthWarmUp(ctx)
}

type Recipe = (v: ShapezzSynthVoice, intensity: number) => void

const MAJOR = [0, 2, 4, 5, 7, 9, 11]

/** Frequency of scale step `step` of D major, step 0 = D4. */
function d(step: number): number {
    const octave = Math.floor(step / 7)
    return shapezzNote(-7 + octave * 12 + MAJOR[((step % 7) + 7) % 7]!)
}

// Shared layers ------------------------------------------------------------

function thump(v: ShapezzSynthVoice, from: number, to: number, dur: number, gain = 1, at = 0) {
    v.tone({ freq: from, to, glide: dur * 0.7, dur, gain, at })
}

/** A struck bell: triangle fundamental plus the inharmonic partials of a real bell. */
function bell(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
    v.tone({ type: 'triangle', freq, dur, gain, at })
    v.tone({ freq: freq * 2.76, dur: dur * 0.45, gain: gain * 0.28, at })
    v.tone({ freq: freq * 5.4, dur: dur * 0.2, gain: gain * 0.1, at })
}

/** Short glassy ping. */
function chime(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
    v.tone({ type: 'triangle', freq, dur, gain, at })
    v.tone({ freq: freq * 2.01, dur: dur * 0.5, gain: gain * 0.35, at })
}

/** Plucked harp string: bright triangle with a fast-closing filter. */
function harp(v: ShapezzSynthVoice, freq: number, at: number, dur = 0.5, gain = 0.4) {
    const lp = v.filter({ freq: freq * 6, to: freq * 1.5, glide: dur * 0.6, at })
    v.tone({ type: 'triangle', freq, dur, gain, at, dest: lp })
    v.tone({ type: 'sawtooth', freq, detune: 4, dur: dur * 0.4, gain: gain * 0.25, at, dest: lp })
}

/** Brassy stab: detuned saws through a closing low-pass. */
function brass(v: ShapezzSynthVoice, freqs: number[], at: number, dur: number, gain = 0.18, hold = 0, bright = 2800) {
    const filter = v.filter({ freq: bright, to: 700, at, glide: hold + dur, q: 1.1 })
    for (const freq of freqs) {
        v.tone({ type: 'sawtooth', freq, detune: -7, dur, hold, gain, at, attack: 0.025, dest: filter })
        v.tone({ type: 'sawtooth', freq, detune: 7, dur, hold, gain, at, attack: 0.025, dest: filter })
    }
}

/** Airy choir-like pad: detuned saws through a vowel-ish band. */
function choir(v: ShapezzSynthVoice, freqs: number[], at: number, dur: number, gain = 0.08, hold = 0.3) {
    const formant = v.filter({ type: 'bandpass', freq: 900, q: 0.9, at })
    const lp = v.filter({ freq: 2400, at, dest: formant })
    for (const freq of freqs) {
        for (const detune of [-11, 0, 12]) {
            v.tone({ type: 'sawtooth', freq, detune, attack: 0.18, hold, dur, gain, at, dest: lp, wobble: { rate: 5.2, depth: freq * 0.006 } })
        }
    }
}

function cymbal(v: ShapezzSynthVoice, at: number, dur = 0.9, gain = 0.25) {
    v.noise({ filter: 'highpass', freq: 5200, dur, gain, at })
    v.noise({ filter: 'bandpass', freq: 8000, q: 2, dur: dur * 0.5, gain: gain * 0.6, at })
}

function timpani(v: ShapezzSynthVoice, at: number, gain = 0.9, freq = 92) {
    v.tone({ freq, to: freq * 0.82, glide: 0.4, dur: 0.6, gain, at })
    v.noise({ color: 'pink', freq: 420, dur: 0.12, gain: gain * 0.4, at })
}

/** Thunder: a crack, then a rolling low-passed rumble. */
function thunder(v: ShapezzSynthVoice, at: number, size = 1, gain = 1) {
    v.noise({ filter: 'highpass', freq: 1800, dur: 0.08, gain: 0.6 * gain, at, drive: 2 })
    v.noise({ color: 'pink', freq: 1400, to: 90, glide: 0.9 * size, dur: 1.2 * size, gain: 0.9 * gain, at: at + 0.02 })
    v.noise({ color: 'pink', freq: 300, to: 60, attack: 0.25, dur: 1.1 * size, gain: 0.55 * gain, at: at + 0.15, tremolo: { rate: 6, depth: 0.6 } })
    thump(v, 70, 30, 0.9 * size, 0.8 * gain, at)
}

/** Electric crackle: square-wobbled saw and chopped noise. */
function crackle(v: ShapezzSynthVoice, at: number, dur: number, gain = 0.5) {
    const hp = v.filter({ type: 'highpass', freq: 800, at })
    v.tone({ type: 'sawtooth', freq: 120 * v.vary(0.2), dur, gain: gain * 0.6, at, wobble: { rate: 57, depth: 140, type: 'square' }, dest: hp })
    v.noise({ filter: 'bandpass', freq: 3600 * v.vary(0.2), q: 2.5, dur, gain, at, tremolo: { rate: 40 * v.vary(0.3), depth: 1, type: 'square' } })
}

function whoosh(v: ShapezzSynthVoice, from: number, to: number, dur: number, at = 0, gain = 0.6) {
    v.noise({ filter: 'bandpass', freq: from, to, glide: dur, q: 1.3, attack: dur * 0.4, dur: dur * 0.6, gain, at })
}

/** Rising sparkle run up the scale. */
function sparkle(v: ShapezzSynthVoice, from: number, count: number, at: number, step = 0.04, gain = 0.18) {
    for (let i = 0; i < count; i++) chime(v, d(from + i), at + i * step, 0.18, gain)
}

// Recipes -----------------------------------------------------------------

const recipes: Record<AetherSoundEvent, Recipe> = {
    'click': (v) => {
        v.tone({ type: 'triangle', freq: 1900, to: 1300, dur: 0.035, gain: 0.5 })
        v.noise({ filter: 'bandpass', freq: 3500, q: 3, dur: 0.02, gain: 0.25 })
    },
    'bet-up': (v) => {
        chime(v, d(11), 0, 0.09, 0.4)
        chime(v, d(14), 0.05, 0.14, 0.4)
    },
    'bet-down': (v) => {
        chime(v, d(14), 0, 0.09, 0.35)
        chime(v, d(11), 0.05, 0.14, 0.35)
    },
    'bet-max': (v) => {
        for (let i = 0; i < 5; i++) chime(v, d(9 + i * 2), i * 0.045, 0.16, 0.32)
        v.noise({ filter: 'highpass', freq: 7000, attack: 0.1, dur: 0.3, gain: 0.08 })
    },
    'toggle': (v) => {
        v.tone({ type: 'triangle', freq: 880, dur: 0.05, gain: 0.4 })
        v.tone({ type: 'triangle', freq: 1320, dur: 0.07, gain: 0.3, at: 0.04 })
    },
    'spin': (v) => {
        whoosh(v, 300, 3200, 0.32, 0, 0.8)
        whoosh(v, 2800, 500, 0.4, 0.2, 0.35)
        thump(v, 110, 40, 0.4, 0.55, 0.02)
        for (let i = 0; i < 6; i++) chime(v, d(14 + i), 0.04 + i * 0.03, 0.14, 0.09)
    },
    'reel-land': (v, col) => {
        thump(v, 150 - col * 4, 52, 0.12, 0.8)
        v.noise({ color: 'pink', freq: 900, to: 300, dur: 0.06, gain: 0.4 })
        chime(v, d(14 + (col % 3)), 0.005, 0.07, 0.07)
    },
    'scatter-land': (v, count) => {
        const n = Math.max(1, Math.min(5, count))
        const note = d(9 + (n - 1) * 2)
        bell(v, note, 0, 1.2, 0.55)
        bell(v, note * 2, 0.02, 0.7, 0.18)
        whoosh(v, 600, 4000, 0.3, 0, 0.35)
        if (n >= 3) {
            thunder(v, 0.05, 0.6, 0.5)
            choir(v, [d(7), d(9), d(11)], 0.02, 0.8, 0.05, 0.2)
        }
    },
    'anticipation': (v) => {
        const lp = v.filter({ freq: 300, to: 3200, glide: 1.6, q: 5 })
        v.tone({ type: 'sawtooth', freq: d(0) / 2, to: d(4) / 2, glide: 1.6, attack: 0.3, hold: 1.1, dur: 0.4, gain: 0.3, dest: lp, tremolo: { rate: 9, depth: 0.5 } })
        v.tone({ type: 'sawtooth', freq: d(0) / 2 * 1.005, to: d(4) / 2, glide: 1.6, attack: 0.3, hold: 1.1, dur: 0.4, gain: 0.25, dest: lp })
        v.noise({ filter: 'bandpass', freq: 400, to: 5000, glide: 1.6, q: 1.2, attack: 1.2, dur: 0.5, gain: 0.35 })
        for (let i = 0; i < 4; i++) thump(v, 85, 45, 0.18, 0.7, i * 0.38)
    },
    'win-cluster': (v, chain) => {
        const base = 7 + Math.min(8, Math.max(0, chain - 1)) * 2
        harp(v, d(base), 0, 0.45, 0.4)
        harp(v, d(base + 2), 0.05, 0.45, 0.38)
        harp(v, d(base + 4), 0.1, 0.6, 0.36)
        chime(v, d(base + 7), 0.14, 0.4, 0.16)
    },
    'shatter': (v) => {
        v.noise({ filter: 'highpass', freq: 3000, dur: 0.12, gain: 0.8, drive: 1.5 })
        v.noise({ filter: 'bandpass', freq: 1400 * v.vary(0.1), q: 2, dur: 0.07, gain: 0.5, drive: 2.5 })
        for (let i = 0; i < 9; i++) {
            v.tone({ freq: 2800 + Math.random() * 4200, dur: 0.04 + Math.random() * 0.12, gain: 0.12 * v.vary(0.4), at: Math.random() * 0.14 })
        }
    },
    'tumble': (v) => {
        thump(v, 120, 50, 0.1, 0.6)
        thump(v, 105, 45, 0.1, 0.45, 0.07)
        v.noise({ color: 'pink', freq: 700, dur: 0.05, gain: 0.2 })
    },
    'orb-land': (v, value) => {
        const tier = value >= 100 ? 4 : value >= 25 ? 3 : value >= 10 ? 2 : value >= 5 ? 1 : 0
        v.tone({ freq: 180, to: 520 + tier * 120, glide: 0.12, dur: 0.22, gain: 0.5 })
        chime(v, d(11 + tier * 2), 0.05, 0.5, 0.35)
        chime(v, d(15 + tier * 2), 0.09, 0.4, 0.2)
        if (tier >= 2) crackle(v, 0.02, 0.18, 0.25)
    },
    'orb-charge': (v, value) => {
        const top = 1200 + Math.min(4, Math.log2(Math.max(2, value))) * 250
        v.tone({ freq: 260, to: top, glide: 0.32, attack: 0.28, dur: 0.06, gain: 0.35, tremolo: { rate: 24, depth: 0.5 } })
        v.noise({ filter: 'bandpass', freq: 800, to: 5000, glide: 0.32, q: 3, attack: 0.28, dur: 0.05, gain: 0.25 })
    },
    'orb-zap': (v) => {
        v.noise({ filter: 'highpass', freq: 2400, dur: 0.07, gain: 0.9, drive: 2 })
        crackle(v, 0, 0.22, 0.55)
        thump(v, 160, 45, 0.18, 0.7)
    },
    'meter-hit': (v, meter) => {
        const lift = Math.min(6, Math.floor(Math.log2(Math.max(2, meter))))
        thump(v, 120, 38, 0.35, 1.1)
        v.noise({ color: 'pink', freq: 1800, to: 200, dur: 0.25, gain: 0.45 })
        bell(v, d(7 + lift), 0.01, 0.9, 0.4)
        bell(v, d(11 + lift), 0.03, 0.7, 0.25)
        cymbal(v, 0.01, 0.35, 0.1)
    },
    'tick': (v, progress) => {
        const p = Math.max(0, Math.min(1, progress))
        v.tone({ type: 'triangle', freq: 1500 + p * 1400, dur: 0.035, gain: 0.5 })
        v.tone({ freq: (1500 + p * 1400) * 2, dur: 0.02, gain: 0.12 })
    },
    'win-small': (v) => {
        harp(v, d(7), 0, 0.4, 0.4)
        harp(v, d(9), 0.06, 0.4, 0.4)
        harp(v, d(11), 0.12, 0.4, 0.4)
        chime(v, d(14), 0.18, 0.6, 0.3)
    },
    'win-medium': (v) => {
        for (let i = 0; i < 5; i++) harp(v, d(7 + i * 2), i * 0.06, 0.5, 0.36)
        brass(v, [d(0), d(4), d(7)], 0.3, 0.55, 0.12, 0.15)
        chime(v, d(21), 0.32, 0.7, 0.22)
    },
    'win-big': (v) => {
        timpani(v, 0, 0.9)
        brass(v, [d(0), d(4)], 0, 0.2, 0.14)
        brass(v, [d(4), d(7)], 0.18, 0.2, 0.14)
        brass(v, [d(0) * 2, d(4) * 2, d(7) * 2], 0.36, 0.9, 0.13, 0.35)
        timpani(v, 0.36, 1)
        cymbal(v, 0.36, 1.1, 0.22)
        sparkle(v, 14, 8, 0.4, 0.035)
        choir(v, [d(7), d(11), d(14)], 0.36, 0.9, 0.05, 0.4)
    },
    'win-mega': (v) => {
        thunder(v, 0, 1, 0.6)
        for (let i = 0; i < 4; i++) timpani(v, i * 0.1, 0.6 + i * 0.1, 88 + i * 3)
        brass(v, [d(0), d(4), d(7)], 0.1, 0.25, 0.12)
        brass(v, [d(3), d(5), d(8)], 0.4, 0.25, 0.12)
        brass(v, [d(4), d(6), d(8)], 0.65, 0.25, 0.12)
        brass(v, [d(7), d(11), d(14)], 0.9, 1.2, 0.13, 0.5)
        cymbal(v, 0.9, 1.4, 0.26)
        timpani(v, 0.9, 1.1)
        sparkle(v, 14, 10, 0.95, 0.03)
        choir(v, [d(7), d(11), d(14)], 0.9, 1.2, 0.06, 0.6)
    },
    'win-epic': (v) => {
        thunder(v, 0, 1.4, 0.8)
        for (let i = 0; i < 6; i++) timpani(v, i * 0.08, 0.5 + i * 0.1, 84 + i * 3)
        brass(v, [d(0), d(4), d(7)], 0.1, 0.22, 0.12)
        brass(v, [d(1), d(5), d(8)], 0.35, 0.22, 0.12)
        brass(v, [d(2), d(6), d(9)], 0.6, 0.22, 0.12)
        brass(v, [d(3), d(7), d(10)], 0.85, 0.22, 0.12)
        brass(v, [d(7), d(11), d(14), d(16)], 1.1, 1.6, 0.13, 0.7)
        cymbal(v, 1.1, 1.8, 0.3)
        timpani(v, 1.1, 1.2, 80)
        sparkle(v, 14, 14, 1.15, 0.028, 0.2)
        choir(v, [d(0), d(7), d(11), d(14)], 1.1, 1.6, 0.06, 0.8)
    },
    'tier-up': (v, tier) => {
        whoosh(v, 400, 5000, 0.28, 0, 0.5)
        brass(v, [d(7 + tier * 2), d(11 + tier * 2)], 0.26, 0.45, 0.13, 0.1, 3400)
        cymbal(v, 0.26, 0.7, 0.2)
        timpani(v, 0.26, 0.8)
    },
    'bonus-trigger': (v) => {
        thunder(v, 0, 1.5, 1)
        for (let i = 0; i < 7; i++) bell(v, d(7 + i), 0.25 + i * 0.07, 0.9, 0.3)
        brass(v, [d(0), d(4), d(7)], 0.8, 0.28, 0.13)
        brass(v, [d(7), d(11), d(14)], 1.1, 1.3, 0.13, 0.5)
        choir(v, [d(7), d(11), d(14), d(18)], 0.7, 1.5, 0.06, 0.8)
        cymbal(v, 1.1, 1.6, 0.25)
        timpani(v, 1.1, 1.1)
    },
    'bonus-start': (v) => {
        whoosh(v, 200, 4200, 0.9, 0, 0.7)
        v.tone({ freq: d(-14), to: d(-7), glide: 0.9, attack: 0.8, dur: 0.6, gain: 0.5 })
        thunder(v, 0.85, 0.8, 0.5)
        bell(v, d(14), 0.9, 1.4, 0.4)
        bell(v, d(18), 0.95, 1.2, 0.25)
        choir(v, [d(7), d(11), d(14)], 0.85, 1.1, 0.05, 0.4)
    },
    'retrigger': (v) => {
        bell(v, d(11), 0, 1, 0.45)
        bell(v, d(14), 0.12, 1, 0.45)
        bell(v, d(18), 0.24, 1.3, 0.45)
        brass(v, [d(7), d(11), d(14)], 0.3, 0.8, 0.12, 0.25)
        thunder(v, 0.3, 0.7, 0.4)
    },
    'free-spin': (v, round) => {
        whoosh(v, 500, 2800, 0.25, 0, 0.4)
        chime(v, d(14 + (round % 5)), 0.08, 0.3, 0.3)
    },
    'bonus-end': (v) => {
        brass(v, [d(3), d(5), d(7)], 0, 0.35, 0.13, 0.1)
        brass(v, [d(4), d(6), d(8)], 0.4, 0.35, 0.13, 0.1)
        brass(v, [d(0), d(4), d(7), d(14)], 0.8, 1.6, 0.13, 0.6)
        timpani(v, 0.8, 1.1)
        cymbal(v, 0.8, 1.6, 0.25)
        for (let i = 0; i < 6; i++) bell(v, d(14 + i), 0.85 + i * 0.08, 1, 0.22)
        choir(v, [d(0), d(7), d(11)], 0.8, 1.5, 0.06, 0.7)
    },
    'buy-bonus': (v) => {
        for (let i = 0; i < 12; i++) chime(v, d(10 + (i % 6) * 2) * v.vary(0.004), i * 0.035, 0.14, 0.22)
        v.tone({ freq: 200, to: 1600, glide: 0.45, attack: 0.4, dur: 0.08, gain: 0.3 })
        brass(v, [d(7), d(11), d(14)], 0.45, 0.5, 0.12, 0.1)
        thump(v, 140, 45, 0.3, 0.9, 0.45)
    }
}

export const AETHER_SYNTH_RECIPES: Readonly<Record<AetherSoundEvent, Recipe>> = recipes

export interface AetherLoopHandle {
    stop: (fade?: number) => void
}

/**
 * Free-spins pad: a slow D-major drone of detuned saws under a breathing
 * low-pass, with a quiet shimmer of band-passed noise on top.
 */
export function aetherBonusPad(ctx: BaseAudioContext, destination: AudioNode, level: number): AetherLoopHandle {
    const kit = shapezzSynthWarmUp(ctx)
    const now = ctx.currentTime
    const output = ctx.createGain()
    output.gain.setValueAtTime(0, now)
    output.gain.linearRampToValueAtTime(level, now + 2.5)
    output.connect(destination)

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 700
    lp.Q.value = 2
    lp.connect(output)

    const sources: AudioScheduledSourceNode[] = []
    const nodes: AudioNode[] = [lp]
    for (const [freq, detune] of [[d(-7), -9], [d(-7), 9], [d(-3), 0], [d(0), -5], [d(4), 6]] as const) {
        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = freq
        osc.detune.value = detune
        const g = ctx.createGain()
        g.gain.value = 0.11
        osc.connect(g).connect(lp)
        sources.push(osc)
        nodes.push(g)
    }

    const sweep = ctx.createOscillator()
    sweep.frequency.value = 0.08
    const sweepDepth = ctx.createGain()
    sweepDepth.gain.value = 380
    sweep.connect(sweepDepth).connect(lp.frequency)
    sources.push(sweep)
    nodes.push(sweepDepth)

    const air = ctx.createBufferSource()
    air.buffer = kit.pink
    air.loop = true
    const airBand = ctx.createBiquadFilter()
    airBand.type = 'bandpass'
    airBand.frequency.value = 3200
    airBand.Q.value = 0.8
    const airGain = ctx.createGain()
    airGain.gain.value = 0.06
    air.connect(airBand).connect(airGain).connect(output)
    sources.push(air)
    nodes.push(airBand, airGain)

    for (const src of sources) src.start(now)

    let stopped = false
    return {
        stop(fade = 0.8) {
            if (stopped) return
            stopped = true
            const t = ctx.currentTime
            output.gain.cancelScheduledValues(t)
            output.gain.setValueAtTime(output.gain.value, t)
            output.gain.linearRampToValueAtTime(0, t + fade)
            for (const src of sources) {
                try {
                    src.stop(t + fade + 0.05)
                } catch { /* already stopped */ }
            }
            setTimeout(() => {
                for (const node of [...nodes, ...sources, output]) node.disconnect()
            }, (fade + 0.2) * 1000)
        }
    }
}
