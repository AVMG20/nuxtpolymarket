// Synthesized Spiñata moments that have no sample: payline plucks, confetti
// poppers, the whoosh of a wild or piñata flying to its meter, sparkles and a
// soft thud for the piñata stick. Recipes run on the same synth voice SHAPEZZ
// and Pirate Raid use; the voice frees its nodes once every source ended.
//
// Palette: nylon-string plucks and marimba bars in D major, so they sit in
// key with the fiesta music.

import type { SpinataSynthEvent } from '~/utils/spinata-sounds'
import { ShapezzSynthVoice, shapezzNote, shapezzSynthWarmUp } from '~/utils/shapezz-synth'

export { ShapezzSynthVoice as SpinataSynthVoice }

export function spinataSynthWarmUp(ctx: BaseAudioContext) {
    shapezzSynthWarmUp(ctx)
}

type Recipe = (v: ShapezzSynthVoice, intensity: number) => void

/** D major, two octaves, from D4. */
const D_MAJOR = [-7, -5, -3, -2, 0, 2, 4, 5, 7, 9, 10, 12, 14, 15]

/** Plucked nylon string: a bright triangle attack that darkens quickly. */
function pluck(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain: number) {
    const lp = v.filter({ freq: freq * 7, to: freq * 1.6, glide: dur * 0.6, q: 1.1, at })
    v.tone({ type: 'triangle', freq, dur, gain, at, dest: lp })
    v.tone({ type: 'sawtooth', freq: freq * 2, dur: dur * 0.3, gain: gain * 0.18, at, dest: lp })
    v.noise({ filter: 'bandpass', freq: freq * 4, q: 2, dur: 0.02, gain: gain * 0.25, at })
}

/** Marimba bar: sine with a quick fourth-harmonic knock. */
function marimba(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain: number) {
    v.tone({ freq, dur, gain, at })
    v.tone({ freq: freq * 4, dur: dur * 0.12, gain: gain * 0.35, at })
}

const recipes: Record<SpinataSynthEvent, Recipe> = {
    // One pluck per payline, climbing the scale as more lines are shown.
    line: (v, intensity) => {
        const step = Math.max(0, Math.round(intensity)) % D_MAJOR.length
        const freq = shapezzNote(D_MAJOR[step]!)
        pluck(v, freq, 0, 0.55, 0.8)
        marimba(v, freq * 2, 0.03, 0.35, 0.28)
    },
    // Confetti popper: a paper crack, a puff of air and a scatter of paper.
    pop: (v, intensity) => {
        const size = 0.8 + Math.min(1, intensity) * 0.5
        v.noise({ filter: 'bandpass', freq: 1800 * v.vary(0.15), q: 0.9, dur: 0.05 * size, gain: 1, drive: 2.5 })
        v.tone({ freq: 180 * v.vary(0.1), to: 60, glide: 0.08, dur: 0.1, gain: 0.7 })
        v.noise({ color: 'pink', freq: 5000, to: 1500, dur: 0.25 * size, gain: 0.3, at: 0.02 })
        for (let i = 0; i < 6; i++) {
            v.noise({ filter: 'highpass', freq: 3500 + Math.random() * 3000, dur: 0.015, gain: 0.25 * v.vary(0.4), at: 0.06 + Math.random() * 0.3 })
        }
    },
    // Something flying across the cabinet.
    whoosh: (v, intensity) => {
        const up = intensity > 0
        v.noise({ filter: 'bandpass', freq: up ? 700 : 2400, to: up ? 3200 : 800, glide: 0.32, q: 1.6, attack: 0.12, dur: 0.22, gain: 0.9 })
    },
    // Small glittering chime cluster.
    sparkle: (v) => {
        const notes = [12, 16, 19, 24]
        notes.forEach((semis, i) => {
            v.tone({ type: 'triangle', freq: shapezzNote(semis + 7), dur: 0.35, gain: 0.35, at: i * 0.045 })
            v.tone({ freq: shapezzNote(semis + 19), dur: 0.2, gain: 0.12, at: i * 0.045 })
        })
    },
    // Stick hitting the piñata.
    thud: (v) => {
        v.tone({ freq: 140 * v.vary(0.08), to: 55, glide: 0.12, dur: 0.18, gain: 1 })
        v.noise({ filter: 'bandpass', freq: 900, q: 1.4, dur: 0.07, gain: 0.5, drive: 2 })
    }
}

export const SPINATA_SYNTH_RECIPES: Readonly<Record<SpinataSynthEvent, Recipe>> = recipes

export const SPINATA_SYNTH_JITTER: Partial<Record<SpinataSynthEvent, number>> = {
    line: 0,
    sparkle: 0.02
}

export const SPINATA_SYNTH_DEFAULT_JITTER = 0.05
