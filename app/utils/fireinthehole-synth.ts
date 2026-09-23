// Procedural Fire in the Hole sound effects. Every effect is a recipe
// scheduled on the synth voice SHAPEZZ and Pirate Raid use (oscillators,
// filtered noise, envelopes, drive), which cleans its nodes up once every
// source ended. Nothing is fetched.
//
// Palette: low-passed pink noise and pitch-dropping sines for dynamite, dry
// band-passed noise bursts for rock and gravel, struck-bell partials for gems
// and coins, a crackling high-passed hiss for fuses, and E minor pentatonic
// with brassy saw stabs for anything melodic (a dusty frontier feel).
//
// Besides the one-shot recipes this file builds the mine ambience loop the
// composable owns: a deep rumble with a slow draught of air through the shaft.

import type { FithSoundEvent } from '~/utils/fireinthehole-sounds'
import { ShapezzSynthVoice, shapezzNote, shapezzSynthWarmUp } from '~/utils/shapezz-synth'

export { ShapezzSynthVoice as FithSynthVoice }

export function fithSynthWarmUp(ctx: BaseAudioContext) {
    shapezzSynthWarmUp(ctx)
}

/** Frequency of a note `semis` semitones from A4 (440 Hz). */
const note = shapezzNote

/** E minor pentatonic, as semitones from A4. */
const SCALE = [-5, -2, 0, 2, 5]
function scaleNote(step: number): number {
    const octave = Math.floor(step / SCALE.length)
    return note(octave * 12 + SCALE[((step % SCALE.length) + SCALE.length) % SCALE.length]!)
}

/** Recipes receive the event's intensity hint (chain, scatter count...), 0 when absent. */
type Recipe = (v: ShapezzSynthVoice, intensity: number) => void

// Shared layers ------------------------------------------------------------

function thump(v: ShapezzSynthVoice, from: number, to: number, dur: number, gain = 1, at = 0) {
    v.tone({ freq: from, to, glide: dur * 0.7, dur, gain, at })
}

/** Dynamite: a sharp crack, a pink-noise blast, a sub drop and a crackling tail. */
function blast(v: ShapezzSynthVoice, size: number, at = 0, gain = 1) {
    v.noise({ filter: 'highpass', freq: 1800, dur: 0.04, gain: 0.7 * gain, drive: 4, at })
    v.noise({ color: 'pink', freq: 3200 * v.vary(0.1), to: 120, glide: 0.5 * size, dur: 0.6 * size, gain: 1.1 * gain, drive: 1.6, at })
    thump(v, 120 * v.vary(0.06), 28, 0.5 * size, 1.3 * gain, at)
    v.noise({ filter: 'highpass', freq: 3200, dur: 0.18 * size, gain: 0.16 * gain, drive: 3, tremolo: { rate: 38, depth: 0.95, type: 'square' }, at: at + 0.04 })
}

/** Gravel and rock chips raining down after a blast or crumble. */
function gravel(v: ShapezzSynthVoice, count: number, spread: number, at = 0, gain = 0.35) {
    for (let i = 0; i < count; i++) {
        const when = at + Math.random() * spread
        v.noise({ filter: 'bandpass', freq: 1400 + Math.random() * 3200, q: 4, dur: 0.02 + Math.random() * 0.04, gain: gain * v.vary(0.4), drive: 2, at: when })
    }
}

/** Heavy stone crunch. */
function crunch(v: ShapezzSynthVoice, size: number, at = 0, gain = 1) {
    v.noise({ filter: 'bandpass', freq: 700 * v.vary(0.2), q: 1.4, dur: 0.12 * size, gain: 0.9 * gain, drive: 3.5, at })
    v.tone({ type: 'triangle', freq: 180 * v.vary(0.12), to: 60, dur: 0.12 * size, gain: 0.6 * gain, at })
}

/** Struck bell: triangle fundamental plus inharmonic partials. */
function bell(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
    v.tone({ type: 'triangle', freq, dur, gain, at })
    v.tone({ freq: freq * 2.76, dur: dur * 0.45, gain: gain * 0.3, at })
    v.tone({ freq: freq * 5.4, dur: dur * 0.2, gain: gain * 0.12, at })
}

/** A gold coin clink: two close metallic partials. */
function clink(v: ShapezzSynthVoice, freq: number, at: number, gain = 0.4) {
    v.tone({ freq, dur: 0.16, gain, at })
    v.tone({ freq: freq * 1.49, dur: 0.12, gain: gain * 0.6, at })
    v.tone({ freq: freq * 2.63, dur: 0.07, gain: gain * 0.3, at })
    v.noise({ filter: 'highpass', freq: 6000, dur: 0.015, gain: gain * 0.5, at })
}

/** A pile of coins pouring out. */
function coinShower(v: ShapezzSynthVoice, count: number, spread: number, at = 0, gain = 0.3) {
    for (let i = 0; i < count; i++) {
        clink(v, 2400 + Math.random() * 2400, at + (i / count) * spread + Math.random() * 0.03, gain * v.vary(0.35))
    }
}

/** Brassy stab: detuned saws through a closing low-pass. */
function brass(v: ShapezzSynthVoice, freqs: number[], at: number, dur: number, gain = 0.18, hold = 0, bright = 2800) {
    const filter = v.filter({ freq: bright, to: 700, at, glide: hold + dur, q: 1.2 })
    for (const freq of freqs) {
        v.tone({ type: 'sawtooth', freq, detune: -8, dur, hold, gain, at, attack: 0.02, dest: filter })
        v.tone({ type: 'sawtooth', freq, detune: 8, dur, hold, gain, at, attack: 0.02, dest: filter })
    }
}

/** Slot-machine bleep arpeggio: square blips through a soft low-pass. */
function arpeggio(v: ShapezzSynthVoice, steps: number[], at: number, gap: number, gain = 0.16, dur = 0.14) {
    const lp = v.filter({ freq: 3600, q: 0.8, at })
    steps.forEach((step, i) => {
        v.tone({ type: 'square', freq: scaleNote(step), dur, gain, at: at + i * gap, dest: lp })
        v.tone({ type: 'triangle', freq: scaleNote(step) * 2, dur: dur * 0.8, gain: gain * 0.6, at: at + i * gap })
    })
}

/** Fuse: a crackling high hiss with a sizzle wobble. */
function hiss(v: ShapezzSynthVoice, dur: number, at = 0, gain = 0.5) {
    v.noise({ filter: 'highpass', freq: 4200, attack: 0.02, hold: dur * 0.7, dur: dur * 0.3, gain, tremolo: { rate: 23, depth: 0.7, type: 'square' }, at })
    v.noise({ filter: 'bandpass', freq: 2600, q: 3, attack: 0.02, hold: dur * 0.7, dur: dur * 0.3, gain: gain * 0.5, tremolo: { rate: 9, depth: 0.5 }, at })
    for (let i = 0; i < Math.round(dur * 22); i++) {
        v.noise({ filter: 'highpass', freq: 5000, dur: 0.01, gain: gain * 0.7 * Math.random(), at: at + Math.random() * dur })
    }
}

/** Whoosh: a band-pass sweep. */
function whoosh(v: ShapezzSynthVoice, from: number, to: number, dur: number, at = 0, gain = 0.5) {
    v.noise({ filter: 'bandpass', freq: from, to, glide: dur, q: 1.3, attack: dur * 0.4, dur: dur * 0.6, gain, at })
}

/** Rising sparkle of short sine pings. */
function sparkle(v: ShapezzSynthVoice, count: number, spread: number, at = 0, gain = 0.18, low = 1800) {
    for (let i = 0; i < count; i++) {
        const freq = low * (1 + (i / count) * 1.4) * v.vary(0.05)
        v.tone({ freq, dur: 0.12, gain: gain * v.vary(0.3), at: at + (i / count) * spread })
    }
}

/** A victory fanfare phrase: brass chords under a bell melody. */
function fanfare(v: ShapezzSynthVoice, melody: number[], gap: number, at: number, gain = 0.4) {
    melody.forEach((step, i) => {
        const last = i === melody.length - 1
        bell(v, scaleNote(step + 10), at + i * gap, last ? 1.4 : 0.5, gain * 0.55)
    })
    const root = melody[0]!
    brass(v, [scaleNote(root), scaleNote(root + 2), scaleNote(root + 4)], at, gap * melody.length, gain * 0.28, 0.05)
    const lastAt = at + gap * (melody.length - 1)
    const top = melody.at(-1)!
    brass(v, [scaleNote(top - 5), scaleNote(top - 3), scaleNote(top)], lastAt, 1.3, gain * 0.34, 0.25, 3400)
}

// Recipes -----------------------------------------------------------------

const recipes: Record<FithSoundEvent, Recipe> = {
    'click': (v) => {
        v.tone({ type: 'triangle', freq: 1400 * v.vary(0.03), to: 900, glide: 0.03, dur: 0.05, gain: 0.8 })
        v.noise({ filter: 'bandpass', freq: 3000, q: 2, dur: 0.02, gain: 0.3 })
    },
    'toggle': (v) => {
        v.tone({ type: 'square', freq: 660, dur: 0.05, gain: 0.25 })
        v.tone({ type: 'square', freq: 990, dur: 0.07, gain: 0.25, at: 0.05 })
    },
    'bet-up': (v) => {
        clink(v, 2100 * v.vary(0.03), 0, 0.5)
        v.tone({ type: 'triangle', freq: 620, to: 880, glide: 0.06, dur: 0.09, gain: 0.35 })
    },
    'bet-down': (v) => {
        clink(v, 1700 * v.vary(0.03), 0, 0.45)
        v.tone({ type: 'triangle', freq: 820, to: 560, glide: 0.06, dur: 0.09, gain: 0.35 })
    },
    'bet-max': (v) => {
        coinShower(v, 9, 0.35, 0, 0.35)
        arpeggio(v, [5, 7, 9, 10], 0, 0.06, 0.14)
    },
    'spin': (v) => {
        // Lever pull, then the mine cart of rocks tipping in.
        v.noise({ filter: 'bandpass', freq: 900, q: 6, dur: 0.05, gain: 0.5, drive: 2 })
        v.tone({ type: 'triangle', freq: 240, to: 120, glide: 0.08, dur: 0.1, gain: 0.5 })
        whoosh(v, 400, 2400, 0.32, 0.03, 0.55)
        gravel(v, 8, 0.3, 0.12, 0.22)
    },
    'land': (v, intensity) => {
        // One column of rock settling; lower columns land heavier.
        const weight = 0.8 + Math.min(1, intensity) * 0.4
        thump(v, 150 * v.vary(0.08), 55, 0.13 * weight, 1)
        v.noise({ color: 'pink', freq: 1200 * v.vary(0.15), to: 300, dur: 0.1, gain: 0.55 })
        gravel(v, 3, 0.08, 0.02, 0.16)
    },
    'crumble': (v, intensity) => {
        const size = 0.8 + Math.min(2, intensity) * 0.3
        crunch(v, size, 0, 0.9)
        crunch(v, size * 0.8, 0.05, 0.6)
        gravel(v, 10, 0.35, 0.03, 0.26)
        v.noise({ color: 'pink', freq: 500, to: 120, attack: 0.02, dur: 0.4, gain: 0.3, at: 0.04 })
    },
    'gem-win': (v, intensity) => {
        // Rising two-note chime; each cascade climbs the scale.
        const chain = Math.max(0, Math.min(8, Math.round(intensity)))
        const base = 8 + chain
        bell(v, scaleNote(base), 0, 0.5, 0.45)
        bell(v, scaleNote(base + 2), 0.08, 0.7, 0.4)
        sparkle(v, 5, 0.25, 0.05, 0.1, 2400 + chain * 150)
    },
    'fuse': (v) => {
        v.noise({ filter: 'bandpass', freq: 5200, q: 4, dur: 0.03, gain: 0.6 })
        hiss(v, 0.36, 0.02, 0.5)
    },
    'explosion': (v, intensity) => {
        const size = 1 + Math.min(1.5, intensity) * 0.25
        blast(v, size, 0, 1)
        gravel(v, 14, 0.7, 0.08, 0.26)
        v.noise({ color: 'pink', freq: 400, to: 70, at: 0.08, attack: 0.05, dur: 0.9, gain: 0.35 })
    },
    'row-unlock': (v) => {
        // Timber supports giving way, then a deep rumble as the shaft opens.
        v.noise({ filter: 'bandpass', freq: 1300, q: 2, dur: 0.1, gain: 0.8, drive: 3 })
        v.noise({ filter: 'bandpass', freq: 900, q: 2, dur: 0.14, gain: 0.7, drive: 3, at: 0.09 })
        v.tone({ type: 'sawtooth', freq: 70, to: 38, glide: 1.1, dur: 1.2, gain: 0.35, drive: 1.5, at: 0.05 })
        v.noise({ color: 'pink', freq: 600, to: 60, attack: 0.1, dur: 1.3, gain: 0.7, at: 0.05 })
        gravel(v, 16, 1, 0.1, 0.2)
        arpeggio(v, [5, 7, 9], 0.35, 0.09, 0.12, 0.2)
    },
    'scatter': (v, intensity) => {
        // Lantern bell; each extra lantern rings a step higher.
        const count = Math.max(1, Math.min(3, Math.round(intensity)))
        const base = 5 + (count - 1) * 3
        bell(v, scaleNote(base + 5), 0, 1.1, 0.55)
        bell(v, scaleNote(base + 7), 0.09, 1.3, 0.45)
        if (count >= 2) sparkle(v, 6 + count * 2, 0.4, 0.1, 0.12, 2000 + count * 300)
    },
    'anticipation': (v) => {
        // Tension swell: a rising tremolo drone with a fuse hiss on top.
        v.tone({ type: 'sawtooth', freq: note(-24), to: note(-12), glide: 1.8, attack: 0.3, hold: 1.2, dur: 0.5, gain: 0.3, tremolo: { rate: 9, depth: 0.6 } })
        v.tone({ type: 'sawtooth', freq: note(-17), to: note(-5), glide: 1.8, attack: 0.3, hold: 1.2, dur: 0.5, gain: 0.2, tremolo: { rate: 11, depth: 0.6 } })
        hiss(v, 1.6, 0.1, 0.22)
    },
    'bonus-trigger': (v) => {
        blast(v, 1.4, 0, 0.8)
        gravel(v, 12, 0.8, 0.1, 0.2)
        fanfare(v, [0, 2, 4, 5, 7], 0.13, 0.35, 0.5)
        coinShower(v, 14, 0.9, 0.9, 0.25)
    },
    'bonus-spin': (v) => {
        whoosh(v, 600, 3000, 0.25, 0, 0.35)
        clink(v, 2600, 0.05, 0.3)
    },
    'coin': (v, intensity) => {
        const value = Math.max(0, intensity)
        const pitch = 2200 + Math.min(1, value / 10) * 1400
        clink(v, pitch * v.vary(0.04), 0, 0.6)
        clink(v, pitch * 1.25, 0.05, 0.35)
        v.tone({ type: 'triangle', freq: 220, to: 110, dur: 0.08, gain: 0.3 })
    },
    'boost': (v) => {
        // Pickaxe on a gold seam and an upward glint.
        v.noise({ filter: 'bandpass', freq: 3400, q: 5, dur: 0.05, gain: 0.7, drive: 2 })
        bell(v, scaleNote(12), 0.02, 0.5, 0.4)
        v.tone({ type: 'triangle', freq: 600, to: 1800, glide: 0.25, dur: 0.3, gain: 0.3, at: 0.03 })
        sparkle(v, 6, 0.3, 0.1, 0.12, 2200)
    },
    'double': (v) => {
        v.tone({ type: 'square', freq: scaleNote(7), dur: 0.12, gain: 0.25 })
        v.tone({ type: 'square', freq: scaleNote(12), dur: 0.3, gain: 0.25, at: 0.1 })
        brass(v, [scaleNote(2), scaleNote(7)], 0.1, 0.5, 0.18, 0.05)
        sparkle(v, 10, 0.4, 0.15, 0.14, 2400)
    },
    'collector': (v) => {
        // Magnet hum and a sweep that pulls everything in.
        v.tone({ type: 'sawtooth', freq: 90, to: 180, glide: 0.6, attack: 0.05, hold: 0.35, dur: 0.3, gain: 0.25, wobble: { rate: 14, depth: 10 } })
        whoosh(v, 3200, 500, 0.55, 0, 0.45)
        v.tone({ freq: 1200, to: 300, glide: 0.5, dur: 0.55, gain: 0.2 })
    },
    'transfer': (v, intensity) => {
        const step = Math.max(0, Math.min(10, Math.round(intensity)))
        v.tone({ freq: scaleNote(10 + step), dur: 0.1, gain: 0.5 })
        v.tone({ type: 'triangle', freq: scaleNote(12 + step), dur: 0.08, gain: 0.3, at: 0.03 })
    },
    'tick': (v, intensity) => {
        const p = Math.max(0, Math.min(1, intensity))
        v.tone({ type: 'square', freq: 1400 + p * 900, dur: 0.025, gain: 0.35 })
        v.tone({ freq: 2800 + p * 1800, dur: 0.02, gain: 0.2 })
    },
    'win-small': (v, intensity) => {
        const lift = Math.max(0, Math.min(4, Math.round(intensity)))
        arpeggio(v, [5 + lift, 7 + lift, 10 + lift], 0, 0.07, 0.14)
        coinShower(v, 4, 0.2, 0.12, 0.25)
    },
    'win-big': (v) => {
        fanfare(v, [0, 2, 4, 7], 0.12, 0, 0.45)
        coinShower(v, 12, 0.8, 0.3, 0.26)
    },
    'win-mega': (v) => {
        blast(v, 0.9, 0, 0.5)
        fanfare(v, [0, 2, 4, 5, 7, 9], 0.11, 0.05, 0.48)
        coinShower(v, 20, 1.2, 0.35, 0.26)
    },
    'win-epic': (v) => {
        blast(v, 1.3, 0, 0.7)
        blast(v, 1, 0.25, 0.45)
        fanfare(v, [0, 2, 4, 5, 7, 9, 10], 0.1, 0.1, 0.5)
        coinShower(v, 28, 1.6, 0.3, 0.26)
    },
    'win-motherlode': (v) => {
        blast(v, 1.6, 0, 0.8)
        blast(v, 1.2, 0.22, 0.55)
        blast(v, 1.4, 0.45, 0.5)
        fanfare(v, [0, 2, 4, 5, 7, 9, 10, 12], 0.1, 0.2, 0.55)
        coinShower(v, 40, 2.2, 0.3, 0.26)
        v.tone({ freq: 48, to: 30, glide: 1.8, dur: 2, gain: 0.8, drive: 1.3 })
    },
    'bonus-end': (v) => {
        fanfare(v, [4, 2, 4, 7], 0.16, 0, 0.42)
        coinShower(v, 10, 0.7, 0.4, 0.22)
    },
    'buy-bonus': (v) => {
        // Cash register ding, a coin drop, then the fuse lights.
        bell(v, scaleNote(14), 0, 0.6, 0.5)
        bell(v, scaleNote(19), 0.06, 0.8, 0.35)
        coinShower(v, 8, 0.3, 0.05, 0.3)
        hiss(v, 0.6, 0.3, 0.3)
    }
}

export const FITH_SYNTH_RECIPES = recipes

/** Pitch jitter per event, as a fraction; melodic events stay in tune. */
export const FITH_SYNTH_JITTER: Partial<Record<FithSoundEvent, number>> = {
    'land': 0.08,
    'crumble': 0.1,
    'explosion': 0.08,
    'fuse': 0.06,
    'coin': 0.03,
    'click': 0.04,
    'spin': 0.05,
    'gem-win': 0,
    'scatter': 0,
    'transfer': 0,
    'tick': 0,
    'win-small': 0,
    'win-big': 0,
    'win-mega': 0,
    'win-epic': 0,
    'win-motherlode': 0,
    'bonus-trigger': 0,
    'bonus-end': 0,
    'double': 0,
    'boost': 0,
    'toggle': 0,
    'bet-up': 0.02,
    'bet-down': 0.02,
    'bet-max': 0
}

export const FITH_SYNTH_DEFAULT_JITTER = 0.03

// Mine ambience ------------------------------------------------------------

export interface FithLoopHandle {
    stop(fade?: number): void
    /** 0 base game, 1 free spins: brightens the air and adds a slow pulse. */
    setHeat(heat: number): void
}

function noiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource()
    src.buffer = shapezzSynthWarmUp(ctx).pink
    src.loop = true
    return src
}

/**
 * Deep rumble of the mountain, a slow draught of air through the shaft and,
 * during free spins, a low pulsing drone.
 */
export function fithMineLoop(ctx: BaseAudioContext, destination: AudioNode, level: number): FithLoopHandle {
    const output = ctx.createGain()
    output.gain.setValueAtTime(0, ctx.currentTime)
    output.gain.linearRampToValueAtTime(level, ctx.currentTime + 1.2)
    output.connect(destination)

    const rumble = noiseSource(ctx)
    const rumbleFilter = ctx.createBiquadFilter()
    rumbleFilter.type = 'lowpass'
    rumbleFilter.frequency.value = 110
    rumbleFilter.Q.value = 0.9
    const rumbleGain = ctx.createGain()
    rumbleGain.gain.value = 0.9
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(output)

    const draught = noiseSource(ctx)
    const draughtFilter = ctx.createBiquadFilter()
    draughtFilter.type = 'bandpass'
    draughtFilter.frequency.value = 500
    draughtFilter.Q.value = 0.8
    const draughtGain = ctx.createGain()
    draughtGain.gain.value = 0.14
    draught.connect(draughtFilter).connect(draughtGain).connect(output)
    const sweepOsc = ctx.createOscillator()
    sweepOsc.frequency.value = 0.07
    const sweepAmount = ctx.createGain()
    sweepAmount.gain.value = 260
    sweepOsc.connect(sweepAmount).connect(draughtFilter.frequency)

    const drone = ctx.createOscillator()
    drone.type = 'sawtooth'
    drone.frequency.value = note(-29)
    const droneFilter = ctx.createBiquadFilter()
    droneFilter.type = 'lowpass'
    droneFilter.frequency.value = 220
    droneFilter.Q.value = 3
    const droneGain = ctx.createGain()
    droneGain.gain.value = 0
    const pulseOsc = ctx.createOscillator()
    pulseOsc.frequency.value = 1.6
    const pulseAmount = ctx.createGain()
    pulseAmount.gain.value = 0
    pulseOsc.connect(pulseAmount).connect(droneGain.gain)
    drone.connect(droneFilter).connect(droneGain).connect(output)

    const sources: AudioScheduledSourceNode[] = [rumble, draught, sweepOsc, drone, pulseOsc]
    const start = ctx.currentTime
    rumble.start(start, Math.random() * 1.5)
    draught.start(start, Math.random() * 1.5)
    for (const src of [sweepOsc, drone, pulseOsc]) src.start(start)
    const nodes: AudioNode[] = [rumbleFilter, rumbleGain, draughtFilter, draughtGain, sweepAmount, droneFilter, droneGain, pulseAmount, ...sources]

    let stopped = false
    return {
        setHeat(heat: number) {
            if (stopped) return
            const h = Math.max(0, Math.min(1, heat))
            const now = ctx.currentTime
            droneGain.gain.setTargetAtTime(h * 0.12, now, 0.6)
            pulseAmount.gain.setTargetAtTime(h * 0.1, now, 0.6)
            droneFilter.frequency.setTargetAtTime(220 + h * 260, now, 0.8)
            draughtGain.gain.setTargetAtTime(0.14 + h * 0.08, now, 0.8)
        },
        stop(fade = 0.5) {
            if (stopped) return
            stopped = true
            const now = ctx.currentTime
            output.gain.cancelScheduledValues(now)
            output.gain.setValueAtTime(output.gain.value, now)
            output.gain.linearRampToValueAtTime(0, now + fade)
            for (const src of sources) {
                try {
                    src.stop(now + fade + 0.05)
                } catch {
                    // Already stopped.
                }
            }
            setTimeout(() => {
                for (const node of nodes) node.disconnect()
                output.disconnect()
            }, (fade + 0.2) * 1000)
        }
    }
}

/** A water drip somewhere in the shaft. */
export function fithDrip(v: ShapezzSynthVoice) {
    const freq = 900 + Math.random() * 900
    v.tone({ freq, to: freq * 2.2, glide: 0.04, dur: 0.07, gain: 0.8 })
    v.tone({ freq: freq * 1.6, to: freq * 2.8, glide: 0.03, dur: 0.05, gain: 0.3, at: 0.05 })
}

/** A timber support creaking under the weight of the mountain. */
export function fithCreak(v: ShapezzSynthVoice) {
    const freq = 90 + Math.random() * 60
    const bp = v.filter({ type: 'bandpass', freq: freq * 6, q: 9 })
    v.tone({ type: 'sawtooth', freq, to: freq * 0.8, glide: 0.7, attack: 0.2, dur: 0.5, gain: 0.5, wobble: { rate: 12, depth: freq * 0.08 }, dest: bp })
}
