// Procedural Pirate Raid sound effects. Every effect is a recipe scheduled on
// a synth voice (the same ShapezzSynthVoice SHAPEZZ uses: oscillators,
// filtered noise, envelopes, drive), which cleans its nodes up once every
// source ended. Nothing is fetched.
//
// Palette: pitch-dropping sines and low-passed pink noise for gunpowder,
// band-passed noise through a shaper for splintering timber, detuned saws
// through a resonant band-pass for creaking hulls and rope, sine blips that
// glide upward for bubbles, and D major / A minor for anything melodic.
//
// Besides the one-shot recipes this file builds the three sustained layers the
// composable owns: the sea ambience, the Kraken's Maw whirlpool loop and the
// battle drum bed.

import type { PirateSoundEvent } from '~/utils/pirate-sounds'
import { ShapezzSynthVoice, shapezzNote, shapezzSynthWarmUp } from '~/utils/shapezz-synth'

export { ShapezzSynthVoice as PirateSynthVoice }

export function pirateSynthWarmUp(ctx: BaseAudioContext) {
    shapezzSynthWarmUp(ctx)
}

/** Frequency of a note `semis` semitones from A4 (440 Hz). */
export const pirateNote = shapezzNote

/** Recipes receive the event's intensity hint (cannon size, rarity index...), 0 when absent. */
type Recipe = (v: ShapezzSynthVoice, intensity: number) => void

// Shared layers ------------------------------------------------------------

/** Pitch-dropping sine thump. */
function thump(v: ShapezzSynthVoice, from: number, to: number, dur: number, gain = 1, at = 0) {
    v.tone({ freq: from, to, glide: dur * 0.7, dur, gain, at })
}

/** Gunpowder: low-passed pink blast, a sub thump and a crackling tail. */
function boom(v: ShapezzSynthVoice, size: number, at = 0, gain = 1) {
    v.noise({ color: 'pink', freq: 2200 * v.vary(0.1), to: 140, glide: 0.45 * size, dur: 0.5 * size, gain, at })
    thump(v, 110 * v.vary(0.06), 32, 0.42 * size, 1.15 * gain, at)
    v.noise({ filter: 'highpass', freq: 2800, dur: 0.12 * size, gain: 0.18 * gain, drive: 3, tremolo: { rate: 34, depth: 0.9, type: 'square' }, at })
}

/** Scattered timber and spray falling after a blast. */
function debris(v: ShapezzSynthVoice, count: number, spread: number, at = 0, gain = 0.35) {
    for (let i = 0; i < count; i++) {
        const when = at + 0.05 + Math.random() * spread
        v.noise({ filter: 'bandpass', freq: 900 + Math.random() * 2200, q: 3, dur: 0.03 + Math.random() * 0.05, gain: gain * v.vary(0.3), drive: 2.5, at: when })
    }
}

/** Splintering wood: a driven band-passed crunch with a knock. */
function crunch(v: ShapezzSynthVoice, size: number, at = 0, gain = 1) {
    v.noise({ filter: 'bandpass', freq: 1100 * v.vary(0.15), q: 1.8, dur: 0.09 * size, gain: 0.8 * gain, drive: 3, at })
    v.tone({ type: 'triangle', freq: 320 * v.vary(0.1), to: 110, dur: 0.07 * size, gain: 0.5 * gain, at })
}

/** A creaking timber or taut rope: a slow-wobbling saw through a narrow band-pass. */
function creak(v: ShapezzSynthVoice, freq: number, dur: number, at = 0, gain = 0.3) {
    const bp = v.filter({ type: 'bandpass', freq: freq * 6, q: 9, at })
    v.tone({ type: 'sawtooth', freq: freq * v.vary(0.1), to: freq * 0.82, glide: dur, attack: dur * 0.3, dur: dur * 0.7, gain, at, wobble: { rate: 11 * v.vary(0.3), depth: freq * 0.08 }, dest: bp })
}

/** Rising sine blips: air escaping a sinking hull. */
function bubbles(v: ShapezzSynthVoice, count: number, spread: number, at = 0, gain = 0.25, low = 260) {
    for (let i = 0; i < count; i++) {
        const freq = low + Math.random() * low * 1.8
        v.tone({ freq, to: freq * 1.9, glide: 0.05, dur: 0.06, gain: gain * v.vary(0.4), at: at + Math.random() * spread })
    }
}

/** Water thrown up: a band-passed noise spray. */
function spray(v: ShapezzSynthVoice, dur: number, at = 0, gain = 0.4, freq = 2400) {
    v.noise({ filter: 'bandpass', freq, to: freq * 0.35, q: 0.9, attack: 0.01, dur, gain, at })
}

/** Whoosh of something thrown: a band-pass sweep. */
function whoosh(v: ShapezzSynthVoice, from: number, to: number, dur: number, at = 0, gain = 0.6) {
    v.noise({ filter: 'bandpass', freq: from, to, glide: dur, q: 1.4, attack: dur * 0.35, dur: dur * 0.65, gain, at })
}

/** A struck bell: triangle fundamental plus the inharmonic partials of a real bell. */
function bell(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
    v.tone({ type: 'triangle', freq, dur, gain, at })
    v.tone({ freq: freq * 2.76, dur: dur * 0.45, gain: gain * 0.3, at })
    v.tone({ freq: freq * 5.4, dur: dur * 0.2, gain: gain * 0.12, at })
}

/** Short bright ping. */
function chime(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
    v.tone({ type: 'triangle', freq, dur, gain, at })
    v.tone({ freq: freq * 2.01, dur: dur * 0.5, gain: gain * 0.35, at })
}

/** Brassy stab: detuned saws through a closing low-pass. */
function brass(v: ShapezzSynthVoice, freqs: number[], at: number, dur: number, gain = 0.2, hold = 0, bright = 2600) {
    const filter = v.filter({ freq: bright, to: 600, at, glide: hold + dur, q: 1.2 })
    for (const freq of freqs) {
        v.tone({ type: 'sawtooth', freq, detune: -7, dur, hold, gain, at, attack: 0.02, dest: filter })
        v.tone({ type: 'sawtooth', freq, detune: 7, dur, hold, gain, at, attack: 0.02, dest: filter })
    }
}

/** A cannon report. `size` 1 = standard gun. */
function cannonShot(v: ShapezzSynthVoice, size: number) {
    thump(v, 105 * v.vary(0.08) / Math.sqrt(size), 34, 0.3 * size, 1.2)
    v.noise({ color: 'pink', freq: 1900 * v.vary(0.12), to: 180, glide: 0.25 * size, dur: 0.3 * size, gain: 0.9 })
    v.noise({ filter: 'highpass', freq: 2600, dur: 0.035, gain: 0.45 })
}

// Recipes -----------------------------------------------------------------

const recipes: Record<PirateSoundEvent, Recipe> = {
    // guns — kept lean, eight ports fire in quick succession.
    'cannon': (v, intensity) => {
        cannonShot(v, 0.85 + Math.min(1, intensity) * 0.35)
    },
    'cannon-heavy': (v, intensity) => {
        cannonShot(v, 1.25 + Math.min(1, intensity) * 0.35)
        v.noise({ color: 'pink', freq: 500, to: 80, at: 0.04, attack: 0.03, dur: 0.45, gain: 0.45 })
    },
    'cannon-gem': (v) => {
        cannonShot(v, 1)
        v.tone({ type: 'triangle', freq: 2400 * v.vary(0.05), to: 1200, glide: 0.12, dur: 0.14, gain: 0.35 })
        v.tone({ freq: 3620, dur: 0.18, gain: 0.14, at: 0.01 })
    },
    'enemy-cannon': (v) => {
        const lp = v.filter({ freq: 900, q: 0.8 })
        v.tone({ freq: 90 * v.vary(0.1), to: 38, glide: 0.18, dur: 0.24, gain: 1, dest: lp })
        v.noise({ color: 'pink', freq: 800 * v.vary(0.15), to: 150, dur: 0.22, gain: 0.7, dest: lp })
    },
    'titan-fire': (v) => {
        boom(v, 1.6, 0, 1)
        v.tone({ freq: 62, to: 24, glide: 0.9, dur: 1, gain: 1.2, drive: 1.6 })
        v.noise({ color: 'pink', freq: 600, to: 90, at: 0.07, attack: 0.04, dur: 0.9, gain: 0.5 })
        debris(v, 5, 0.5, 0.05, 0.2)
    },
    'impact': (v) => {
        crunch(v, 1)
    },
    'impact-crit': (v) => {
        crunch(v, 1.5, 0, 1.2)
        thump(v, 150, 50, 0.18, 0.8)
        debris(v, 3, 0.18, 0, 0.3)
    },
    'miss-splash': (v) => {
        v.tone({ freq: 700 * v.vary(0.15), to: 190, glide: 0.07, dur: 0.08, gain: 0.6 })
        spray(v, 0.26, 0.01, 0.45, 1800)
    },
    'ship-hit': (v) => {
        boom(v, 0.6, 0, 0.8)
        crunch(v, 1.8, 0.01, 1)
        creak(v, 120, 0.4, 0.06, 0.35)
    },
    'shield-hit': (v) => {
        v.tone({ freq: 2250 * v.vary(0.04), dur: 0.18, gain: 0.35 })
        v.tone({ freq: 3310, dur: 0.13, gain: 0.2 })
        v.tone({ freq: 4700, dur: 0.08, gain: 0.12, at: 0.01 })
        v.noise({ filter: 'highpass', freq: 5200, dur: 0.05, gain: 0.25 })
    },
    'enemy-sunk': (v) => {
        creak(v, 85, 0.7, 0, 0.35)
        v.noise({ color: 'pink', freq: 450, to: 90, attack: 0.05, dur: 0.8, gain: 0.55 })
        bubbles(v, 6, 0.7, 0.15, 0.22)
        crunch(v, 1.2, 0, 0.6)
    },
    'boss-sunk': (v) => {
        boom(v, 1.6, 0, 0.9)
        boom(v, 1.2, 0.3, 0.7)
        boom(v, 2, 0.65, 0.8)
        v.tone({ freq: 55, to: 20, glide: 2.2, dur: 2.4, gain: 1, drive: 1.4 })
        creak(v, 60, 1.6, 0.4, 0.4)
        v.noise({ color: 'pink', freq: 700, to: 70, at: 0.6, attack: 0.3, dur: 1.8, gain: 0.5 })
        bubbles(v, 12, 1.8, 0.8, 0.2, 180)
        debris(v, 7, 1.1, 0.1, 0.25)
    },
    'player-sunk': (v) => {
        boom(v, 1.2, 0, 0.9)
        creak(v, 70, 1.2, 0.1, 0.35)
        const lp = v.filter({ freq: 1400, q: 0.8 })
        const phrase = [0, -3, -7, -12]
        phrase.forEach((semis, i) => {
            v.tone({ type: 'triangle', freq: pirateNote(semis - 12), attack: 0.05, hold: 0.12, dur: i === 3 ? 1.1 : 0.32, gain: 0.35, at: 0.25 + i * 0.3, dest: lp, tremolo: { rate: 5, depth: 0.3 } })
        })
        bubbles(v, 10, 1.4, 0.5, 0.18, 200)
        v.noise({ color: 'pink', freq: 500, to: 80, at: 0.3, attack: 0.3, dur: 1.5, gain: 0.4 })
    },

    // pickups
    'crate-spawn': (v) => {
        bell(v, pirateNote(12), 0, 1.1, 0.4)
        bell(v, pirateNote(12), 0.42, 1.2, 0.3)
        spray(v, 0.3, 0, 0.12, 1400)
    },
    'crate-pickup': (v, intensity) => {
        const rarity = Math.max(0, Math.min(4, Math.round(intensity)))
        // D major pentatonic, climbing higher and longer with rarity.
        const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]
        const count = 2 + rarity
        const base = -7 + rarity * 2
        for (let i = 0; i < count; i++) {
            chime(v, pirateNote(base + 12 + scale[i]!), i * 0.055, 0.22 + rarity * 0.04, 0.32)
        }
        thump(v, 180, 70, 0.1, 0.4)
        if (rarity >= 3) {
            v.noise({ filter: 'highpass', freq: 6500, attack: 0.1, dur: 0.6, gain: 0.1 + (rarity - 3) * 0.08, at: count * 0.05 })
            v.tone({ freq: pirateNote(base + 36), dur: 0.5, gain: 0.1, at: count * 0.055, tremolo: { rate: 14, depth: 0.7 } })
        }
        if (rarity === 4) {
            // Legendary: a sparkling arpeggio cascading back down over the top.
            for (let i = 0; i < 6; i++) {
                chime(v, pirateNote(base + 36 - scale[i]!), 0.35 + i * 0.045, 0.25, 0.14)
            }
            brass(v, [pirateNote(base), pirateNote(base + 4), pirateNote(base + 7)], count * 0.055, 0.5, 0.08, 0.15, 3200)
        }
    },
    'repair-pickup': (v) => {
        for (let i = 0; i < 3; i++) {
            v.noise({ filter: 'bandpass', freq: 2600 * v.vary(0.1), q: 3, dur: 0.035, gain: 0.5, at: i * 0.11 })
            v.tone({ type: 'triangle', freq: 880 * v.vary(0.05), to: 600, dur: 0.05, gain: 0.35, at: i * 0.11 })
        }
        chime(v, pirateNote(5), 0.36, 0.45, 0.3)
        chime(v, pirateNote(9), 0.44, 0.55, 0.28)
    },

    // hazards
    'mine-explode': (v) => {
        boom(v, 1.3)
        v.tone({ type: 'square', freq: 220, to: 90, dur: 0.05, gain: 0.25 })
        spray(v, 0.9, 0.05, 0.5, 2200)
        debris(v, 5, 0.5, 0.05, 0.3)
    },
    'explosion': (v, intensity) => {
        boom(v, 0.9 + Math.min(1, intensity) * 0.5)
        debris(v, 3, 0.35, 0, 0.28)
    },

    // player abilities
    'keg-throw': (v) => {
        whoosh(v, 400, 1800, 0.35, 0, 0.7)
        v.noise({ filter: 'highpass', freq: 5000, dur: 0.6, gain: 0.18, tremolo: { rate: 26, depth: 0.9, type: 'square' } })
    },
    'keg-explode': (v) => {
        boom(v, 1.5)
        boom(v, 1, 0.06, 0.6)
        v.noise({ filter: 'highpass', freq: 3500, at: 0.08, dur: 0.6, gain: 0.14, drive: 2, tremolo: { rate: 18, depth: 1, type: 'square' } })
        debris(v, 6, 0.6, 0.05, 0.3)
    },
    'warhead-launch': (v) => {
        v.tone({ freq: 650 * v.vary(0.05), to: 2400, glide: 0.4, dur: 0.45, gain: 0.35, attack: 0.03 })
        v.noise({ filter: 'bandpass', freq: 1400, to: 4000, glide: 0.4, q: 2, dur: 0.4, gain: 0.35 })
    },
    'warhead-hit': (v) => {
        v.noise({ filter: 'highpass', freq: 2400, dur: 0.05, gain: 0.8 })
        boom(v, 0.9)
        v.tone({ type: 'sawtooth', freq: 900, to: 200, glide: 0.08, dur: 0.08, gain: 0.15 })
    },
    'consort-summon': (v) => {
        for (const [semis, detune] of [[-12, -9], [-9, 6], [-5, -4], [0, 10]] as const) {
            v.tone({ type: 'triangle', freq: pirateNote(semis), detune, attack: 0.45, hold: 0.2, dur: 0.9, gain: 0.18, wobble: { rate: 4.5, depth: 3 } })
        }
        v.noise({ filter: 'bandpass', freq: 300, to: 2400, glide: 0.8, q: 1.6, attack: 0.5, dur: 0.6, gain: 0.35 })
        thump(v, 90, 40, 0.5, 0.6, 0.45)
        spray(v, 0.6, 0.45, 0.25, 1600)
    },
    'maelstrom-open': (v) => {
        v.noise({ color: 'pink', filter: 'bandpass', freq: 180, to: 900, glide: 0.9, q: 1.3, attack: 0.35, hold: 0.2, dur: 0.9, gain: 1.2, tremolo: { rate: 6, depth: 0.6 } })
        v.tone({ freq: 55, attack: 0.2, hold: 0.4, dur: 0.8, gain: 0.8, wobble: { rate: 3, depth: 8 } })
        v.noise({ filter: 'highpass', freq: 2500, attack: 0.3, dur: 0.8, gain: 0.15 })
        bubbles(v, 6, 1, 0.2, 0.15, 160)
    },
    'maelstrom-loop-start': (v) => {
        v.noise({ color: 'pink', filter: 'bandpass', freq: 260, to: 520, glide: 0.5, q: 1.2, attack: 0.4, dur: 0.3, gain: 0.6 })
    },
    'maelstrom-loop-stop': (v) => {
        v.noise({ color: 'pink', filter: 'bandpass', freq: 900, to: 140, glide: 0.8, q: 1.4, attack: 0.02, dur: 0.85, gain: 0.8 })
        bubbles(v, 8, 0.8, 0.1, 0.2, 150)
    },
    'hellfire-call': (v) => {
        v.noise({ color: 'pink', freq: 320, to: 110, attack: 0.25, hold: 0.3, dur: 1.4, gain: 0.9 })
        v.tone({ freq: 48, attack: 0.3, dur: 1.2, gain: 0.5, wobble: { rate: 5, depth: 4 } })
        for (let i = 0; i < 3; i++) {
            v.tone({ freq: 2100 * v.vary(0.08), to: 650, glide: 0.8, attack: 0.1, dur: 0.75, gain: 0.14, at: 0.25 + i * 0.22 })
        }
    },
    'hellfire-impact': (v) => {
        boom(v, 1.3)
        v.noise({ filter: 'highpass', freq: 3000, at: 0.05, dur: 0.45, gain: 0.12, tremolo: { rate: 20, depth: 1, type: 'square' } })
        debris(v, 4, 0.4, 0.04, 0.25)
    },
    'wave-roll': (v) => {
        v.noise({ color: 'pink', freq: 380, to: 2600, glide: 0.6, attack: 0.45, hold: 0.35, dur: 1.2, gain: 1.1 })
        v.noise({ filter: 'highpass', freq: 3000, attack: 0.3, at: 0.35, dur: 0.9, gain: 0.35 })
        v.tone({ freq: 62, attack: 0.4, hold: 0.3, dur: 0.8, gain: 0.7, wobble: { rate: 2.5, depth: 6 } })
        spray(v, 1, 0.6, 0.4, 2800)
    },
    'lightning': (v) => {
        v.noise({ filter: 'bandpass', freq: 3000 * v.vary(0.15), q: 3, dur: 0.2, gain: 1, tremolo: { rate: 38 * v.vary(0.3), depth: 1, type: 'square' } })
        const hp = v.filter({ type: 'highpass', freq: 600 })
        v.tone({ type: 'sawtooth', freq: 140, dur: 0.2, gain: 0.45, wobble: { rate: 61, depth: 110, type: 'square' }, dest: hp })
        v.noise({ color: 'pink', freq: 400, to: 90, at: 0.08, attack: 0.05, dur: 0.6, gain: 0.35 })
    },
    'ability-ready': (v) => {
        chime(v, pirateNote(19), 0, 0.18, 0.35)
        chime(v, pirateNote(24), 0.08, 0.35, 0.35)
    },

    // enemy abilities
    'sniper-charge': (v) => {
        v.tone({ freq: 300, to: 1800, glide: 0.6, attack: 0.55, dur: 0.08, gain: 0.5, tremolo: { rate: 22, depth: 0.4 } })
        v.tone({ type: 'triangle', freq: 151, to: 905, glide: 0.6, attack: 0.55, dur: 0.08, gain: 0.3 })
    },
    'sniper-fire': (v) => {
        v.noise({ filter: 'highpass', freq: 2200, dur: 0.07, gain: 0.9 })
        v.tone({ type: 'square', freq: 2600, to: 160, glide: 0.1, dur: 0.12, gain: 0.2 })
        thump(v, 160, 44, 0.22, 1)
        v.noise({ color: 'pink', freq: 1500, to: 200, dur: 0.3, gain: 0.5 })
    },
    'harpoon-fire': (v) => {
        const lp = v.filter({ freq: 3200, to: 400, glide: 0.3, q: 3 })
        v.tone({ type: 'sawtooth', freq: 175 * v.vary(0.05), dur: 0.32, gain: 0.5, wobble: { rate: 18, depth: 8 }, dest: lp })
        whoosh(v, 1600, 600, 0.28, 0.02, 0.5)
        thump(v, 140, 60, 0.1, 0.5)
    },
    'harpoon-hit': (v) => {
        thump(v, 210, 60, 0.13, 1)
        v.noise({ filter: 'bandpass', freq: 700, q: 2, dur: 0.06, gain: 0.7, drive: 2 })
        creak(v, 110, 0.5, 0.06, 0.45)
    },
    'mortar-launch': (v) => {
        v.tone({ freq: 230 * v.vary(0.06), to: 85, glide: 0.16, dur: 0.2, gain: 1 })
        v.noise({ filter: 'bandpass', freq: 520, q: 4, dur: 0.14, gain: 0.7 })
        v.tone({ type: 'triangle', freq: 460, dur: 0.1, gain: 0.2 })
        v.noise({ color: 'pink', freq: 700, to: 150, dur: 0.3, gain: 0.35, at: 0.02 })
    },
    'bomb-throw': (v) => {
        whoosh(v, 500, 1600, 0.3, 0, 0.6)
        v.noise({ filter: 'highpass', freq: 5200, dur: 0.4, gain: 0.12, tremolo: { rate: 24, depth: 0.9, type: 'square' } })
    },
    'skiff-launch': (v) => {
        v.tone({ freq: 500, to: 160, glide: 0.08, dur: 0.1, gain: 0.5 })
        v.noise({ filter: 'bandpass', freq: 800, to: 2400, glide: 0.25, q: 1.2, attack: 0.05, dur: 0.22, gain: 0.6 })
    },
    'ward-cast': (v) => {
        for (const freq of [880, 1320, 1760]) {
            v.tone({ freq: freq * v.vary(0.01), attack: 0.15, dur: 0.7, gain: 0.14, wobble: { rate: 5, depth: freq * 0.012 } })
        }
        v.noise({ filter: 'bandpass', freq: 600, to: 2800, glide: 0.6, q: 2.5, attack: 0.2, dur: 0.5, gain: 0.3 })
    },
    'fireship-ignite': (v) => {
        v.noise({ color: 'pink', freq: 200, to: 2400, glide: 0.15, attack: 0.08, dur: 0.6, gain: 1 })
        v.noise({ filter: 'highpass', freq: 3200, at: 0.05, dur: 0.8, gain: 0.2, tremolo: { rate: 17, depth: 1, type: 'square' } })
        thump(v, 90, 40, 0.3, 0.7)
    },

    // bosses
    'boss-horn': (v) => {
        const lp = v.filter({ freq: 380, to: 900, glide: 1, q: 1.5 })
        const drive = v.shaper(1.6, lp)
        for (const [freq, detune] of [[55, -6], [55, 6], [82.4, 0]] as const) {
            v.tone({ type: 'sawtooth', freq, detune, attack: 0.25, hold: 1.1, dur: 0.6, gain: 0.16, dest: drive })
        }
        v.tone({ freq: 55, attack: 0.2, hold: 1, dur: 0.6, gain: 0.5 })
        thump(v, 95, 38, 0.5, 1.1)
        thump(v, 95, 38, 0.5, 1, 1.35)
        v.noise({ color: 'pink', freq: 300, to: 80, dur: 0.5, gain: 0.35, at: 1.35 })
    },
    'kraken-roar': (v) => {
        const lp = v.filter({ freq: 650, q: 4 })
        const drive = v.shaper(2.5, lp)
        v.tone({ type: 'sawtooth', freq: 68 * v.vary(0.05), to: 52, glide: 1.4, attack: 0.2, hold: 0.9, dur: 0.6, gain: 0.35, wobble: { rate: 7, depth: 12 }, dest: drive })
        v.tone({ type: 'sawtooth', freq: 71, to: 50, glide: 1.4, attack: 0.25, hold: 0.9, dur: 0.6, gain: 0.3, wobble: { rate: 5.5, depth: 10 }, dest: drive })
        v.noise({ color: 'pink', filter: 'bandpass', freq: 320, q: 1.5, attack: 0.2, hold: 0.8, dur: 0.6, gain: 0.8, tremolo: { rate: 9, depth: 0.7 } })
        v.tone({ freq: 38, attack: 0.3, hold: 0.8, dur: 0.6, gain: 0.7 })
    },
    'tentacle-slam': (v) => {
        thump(v, 120, 32, 0.4, 1.2)
        v.noise({ color: 'pink', freq: 2200, to: 280, glide: 0.4, dur: 0.5, gain: 0.9 })
        spray(v, 0.6, 0.03, 0.45, 2600)
    },
    'kraken-dive': (v) => {
        v.noise({ color: 'pink', freq: 800, to: 110, glide: 1.2, attack: 0.1, dur: 1.3, gain: 1 })
        v.tone({ freq: 70, to: 30, glide: 1.2, dur: 1.2, gain: 0.8 })
        bubbles(v, 14, 1.2, 0.1, 0.2, 140)
    },
    'ink-splash': (v) => {
        v.noise({ color: 'pink', freq: 900, dur: 0.22, gain: 0.8, drive: 2 })
        v.tone({ freq: 300, to: 80, glide: 0.14, dur: 0.16, gain: 0.8 })
        v.noise({ filter: 'bandpass', freq: 400, to: 1300, glide: 0.12, q: 6, dur: 0.14, gain: 0.5 })
    },
    'phantom-blink': (v) => {
        v.noise({ filter: 'bandpass', freq: 300, to: 3200, glide: 0.35, q: 2, attack: 0.33, dur: 0.04, gain: 0.8 })
        v.tone({ type: 'triangle', freq: 1300, to: 280, glide: 0.25, dur: 0.3, gain: 0.3, at: 0.33, wobble: { rate: 9, depth: 30 } })
    },
    'phantom-spiral': (v) => {
        v.tone({ type: 'triangle', freq: 620, attack: 0.08, hold: 0.3, dur: 0.5, gain: 0.3, wobble: { rate: 14, depth: 220 }, tremolo: { rate: 16, depth: 0.6 } })
        v.noise({ filter: 'bandpass', freq: 1800, q: 5, attack: 0.1, hold: 0.3, dur: 0.4, gain: 0.25, tremolo: { rate: 16, depth: 0.8 } })
    },
    'phantom-summon': (v) => {
        for (const [semis, detune] of [[-12, -8], [-9, 5], [-6, -3], [-3, 9]] as const) {
            v.tone({ freq: pirateNote(semis), detune, attack: 0.4, hold: 0.4, dur: 0.8, gain: 0.18, wobble: { rate: 3.5, depth: 4 } })
        }
        v.noise({ filter: 'bandpass', freq: 900, q: 6, attack: 0.4, dur: 0.8, gain: 0.2, tremolo: { rate: 7, depth: 0.8 } })
    },

    // voyage + UI
    'low-hull': (v) => {
        bell(v, pirateNote(3), 0, 0.5, 0.45)
        bell(v, pirateNote(3), 0.42, 0.7, 0.45)
        v.tone({ freq: pirateNote(-21), attack: 0.02, dur: 0.9, gain: 0.25 })
    },
    'voyage-start': (v) => {
        // Bosun's pipe: a swoop up, a held trill, a fall.
        v.tone({ freq: 1500, to: 2300, glide: 0.18, attack: 0.03, hold: 0.35, dur: 0.12, gain: 0.3, wobble: { rate: 12, depth: 50 } })
        v.tone({ freq: 2300, to: 1700, glide: 0.2, attack: 0.02, dur: 0.22, gain: 0.25, at: 0.5 })
        bell(v, pirateNote(5), 0.8, 1.2, 0.35)
        bell(v, pirateNote(5), 1.05, 1.2, 0.3)
    },
    'voyage-complete': (v) => {
        // D major fanfare.
        const d = -7
        const notes = [0, 4, 7, 12]
        notes.forEach((semis, i) => brass(v, [pirateNote(d + semis)], i * 0.12, 0.25, 0.11, 0, 3000))
        brass(v, [pirateNote(d - 12), pirateNote(d + 4), pirateNote(d + 7), pirateNote(d + 12)], 0.5, 0.9, 0.08, 0.4, 3200)
        bell(v, pirateNote(d + 24), 0.5, 1.2, 0.2)
        thump(v, 120, 45, 0.35, 0.9, 0.5)
    },
    'defeat': (v) => {
        const lp = v.filter({ freq: 1600, q: 0.8 })
        const phrase = [0, -2, -5, -9]
        phrase.forEach((semis, i) => {
            const at = i * 0.3
            v.tone({ type: 'triangle', freq: pirateNote(semis), attack: 0.03, dur: i === 3 ? 1.2 : 0.35, gain: 0.35, at, dest: lp })
            v.tone({ type: 'square', freq: pirateNote(semis - 12), attack: 0.03, dur: i === 3 ? 1.2 : 0.35, gain: 0.08, at, dest: lp })
        })
        thump(v, 90, 35, 0.8, 0.8, 0.9)
    },
    'menu': (v) => {
        v.tone({ type: 'triangle', freq: 1100 * v.vary(0.05), to: 700, dur: 0.03, gain: 0.6 })
        v.noise({ filter: 'bandpass', freq: 2500, q: 2, dur: 0.015, gain: 0.35 })
    }
}

export const PIRATE_SYNTH_RECIPES: Readonly<Record<PirateSoundEvent, Recipe>> = recipes

/** Per-play random pitch spread; melodic cues stay in tune. */
export const PIRATE_SYNTH_JITTER: Partial<Record<PirateSoundEvent, number>> = {
    'crate-spawn': 0,
    'crate-pickup': 0,
    'repair-pickup': 0.005,
    'ability-ready': 0,
    'low-hull': 0,
    'voyage-start': 0,
    'voyage-complete': 0,
    'defeat': 0,
    'player-sunk': 0,
    'consort-summon': 0.01,
    'phantom-summon': 0.01,
    'ward-cast': 0.01,
    'boss-horn': 0.01
}

export const PIRATE_SYNTH_DEFAULT_JITTER = 0.05

// Ambient one-shots --------------------------------------------------------

/** A distant gull: two or three falling chirps. */
export function pirateGull(v: ShapezzSynthVoice) {
    const calls = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < calls; i++) {
        const at = i * (0.22 + Math.random() * 0.08)
        const lp = v.filter({ freq: 3200, at })
        v.tone({ type: 'triangle', freq: 1500, to: 2300, glide: 0.05, attack: 0.02, dur: 0.05, gain: 0.3, at, dest: lp })
        v.tone({ type: 'triangle', freq: 2300, to: 1100, glide: 0.16, attack: 0.01, dur: 0.18, gain: 0.35, at: at + 0.06, wobble: { rate: 40, depth: 60 }, dest: lp })
    }
}

/** A hull timber settling under load. */
export function pirateCreak(v: ShapezzSynthVoice) {
    creak(v, 70 + Math.random() * 60, 0.5 + Math.random() * 0.6, 0, 0.35)
}

// Sustained layers ----------------------------------------------------------

export interface PirateLoopHandle {
    stop: (fade?: number) => void
}

function noiseSource(ctx: BaseAudioContext) {
    const kit = shapezzSynthWarmUp(ctx)
    const src = ctx.createBufferSource()
    src.buffer = kit.pink
    src.loop = true
    return src
}

/** LFO wired into a param, returning the oscillator so it can be stopped. */
function lfo(ctx: BaseAudioContext, rate: number, depth: number, param: AudioParam) {
    const osc = ctx.createOscillator()
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
 * The open sea: two pink-noise layers — a low swell rolling in and out on a
 * slow LFO and a softer high wash — fading in over two seconds.
 */
export function pirateSeaLoop(ctx: BaseAudioContext, destination: AudioNode, level: number): PirateLoopHandle {
    const output = ctx.createGain()
    output.gain.setValueAtTime(0, ctx.currentTime)
    output.gain.linearRampToValueAtTime(level, ctx.currentTime + 2)
    output.connect(destination)

    const swell = noiseSource(ctx)
    const swellFilter = ctx.createBiquadFilter()
    swellFilter.type = 'lowpass'
    swellFilter.frequency.value = 420
    const swellGain = ctx.createGain()
    swellGain.gain.value = 0.55
    swell.connect(swellFilter).connect(swellGain).connect(output)
    const swellLfo = lfo(ctx, 0.11, 0.35, swellGain.gain)
    const swellSweep = lfo(ctx, 0.07, 160, swellFilter.frequency)

    const wash = noiseSource(ctx)
    const washFilter = ctx.createBiquadFilter()
    washFilter.type = 'bandpass'
    washFilter.frequency.value = 1800
    washFilter.Q.value = 0.5
    const washGain = ctx.createGain()
    washGain.gain.value = 0.12
    wash.connect(washFilter).connect(washGain).connect(output)
    const washLfo = lfo(ctx, 0.17, 0.08, washGain.gain)

    const sources = [swell, wash, swellLfo.osc, swellSweep.osc, washLfo.osc]
    const start = ctx.currentTime
    swell.start(start, Math.random() * 1.5)
    wash.start(start, Math.random() * 1.5)
    for (const osc of [swellLfo.osc, swellSweep.osc, washLfo.osc]) osc.start(start)
    const nodes: AudioNode[] = [swellFilter, swellGain, washFilter, washGain, swellLfo.amount, swellSweep.amount, washLfo.amount, ...sources]

    let stopped = false
    return {
        stop(fade = 0.4) {
            if (stopped) return
            stopped = true
            teardown(ctx, output, sources, nodes, fade)
        }
    }
}

/** Kraken's Maw: a churning whirl of band-passed noise with a wobbling sub under it. */
export function pirateMaelstromLoop(ctx: BaseAudioContext, destination: AudioNode, level: number): PirateLoopHandle {
    const output = ctx.createGain()
    output.gain.setValueAtTime(0, ctx.currentTime)
    output.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.5)
    output.connect(destination)

    const churn = noiseSource(ctx)
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 380
    band.Q.value = 1.6
    const churnGain = ctx.createGain()
    churnGain.gain.value = 0.8
    churn.connect(band).connect(churnGain).connect(output)
    const sweep = lfo(ctx, 0.7, 220, band.frequency)
    const pulse = lfo(ctx, 5, 0.3, churnGain.gain)

    const sub = ctx.createOscillator()
    sub.frequency.value = 48
    const subGain = ctx.createGain()
    subGain.gain.value = 0.45
    sub.connect(subGain).connect(output)
    const subWobble = lfo(ctx, 1.3, 7, sub.frequency)

    const sources = [churn, sub, sweep.osc, pulse.osc, subWobble.osc]
    const start = ctx.currentTime
    churn.start(start, Math.random() * 1.5)
    for (const src of sources.slice(1)) src.start(start)
    const nodes: AudioNode[] = [band, churnGain, subGain, sweep.amount, pulse.amount, subWobble.amount, ...sources]

    let stopped = false
    return {
        stop(fade = 0.5) {
            if (stopped) return
            stopped = true
            teardown(ctx, output, sources, nodes, fade)
        }
    }
}

/**
 * Battle drums: a low tom pattern and a droning pulse under the fight. A
 * lookahead timer schedules each 16th a little ahead of the clock; the higher
 * the tension, the busier the pattern and the louder the bed. Silent (and
 * scheduling nothing) at zero.
 */
export class PirateDrumBed {
    private output: GainNode
    private drone: OscillatorNode
    private droneGain: GainNode
    private droneFilter: BiquadFilterNode
    private timer: ReturnType<typeof setInterval> | null = null
    private nextAt = 0
    private step = 0
    private tension = 0
    private stopped = false

    /** Hits per 16-step bar and the tension each needs before it plays. */
    private static readonly PATTERN: { step: number, min: number, accent: number }[] = [
        { step: 0, min: 0.01, accent: 1 },
        { step: 3, min: 0.55, accent: 0.5 },
        { step: 6, min: 0.3, accent: 0.7 },
        { step: 8, min: 0.01, accent: 0.9 },
        { step: 10, min: 0.75, accent: 0.45 },
        { step: 11, min: 0.55, accent: 0.5 },
        { step: 14, min: 0.3, accent: 0.65 },
        { step: 15, min: 0.85, accent: 0.4 }
    ]

    private static readonly STEP_S = 60 / 96 / 4

    constructor(private ctx: AudioContext, destination: AudioNode, private level: number) {
        this.output = ctx.createGain()
        this.output.gain.value = 0
        this.output.connect(destination)
        this.drone = ctx.createOscillator()
        this.drone.type = 'sawtooth'
        this.drone.frequency.value = 55
        this.droneFilter = ctx.createBiquadFilter()
        this.droneFilter.type = 'lowpass'
        this.droneFilter.frequency.value = 180
        this.droneFilter.Q.value = 2
        this.droneGain = ctx.createGain()
        this.droneGain.gain.value = 0
        this.drone.connect(this.droneFilter).connect(this.droneGain).connect(this.output)
        this.drone.start()
    }

    setTension(value: number) {
        if (this.stopped) return
        this.tension = Math.max(0, Math.min(1, value))
        const now = this.ctx.currentTime
        this.output.gain.setTargetAtTime(this.tension > 0.01 ? this.level * (0.45 + this.tension * 0.55) : 0, now, 0.6)
        this.droneGain.gain.setTargetAtTime(Math.max(0, this.tension - 0.4) * 0.25, now, 0.8)
        this.droneFilter.frequency.setTargetAtTime(160 + this.tension * 220, now, 0.8)
        if (this.tension > 0.01 && !this.timer) {
            this.nextAt = now + 0.05
            this.step = 0
            this.timer = setInterval(() => this.schedule(), 60)
        }
    }

    private schedule() {
        if (this.stopped) return
        if (this.ctx.state !== 'running') return
        const now = this.ctx.currentTime
        if (this.nextAt < now) this.nextAt = now + 0.02
        while (this.nextAt < now + 0.15) {
            if (this.tension <= 0.01) {
                // Let the fade finish, then stop scheduling until tension returns.
                if (this.output.gain.value < 0.001 && this.timer) {
                    clearInterval(this.timer)
                    this.timer = null
                }
                return
            }
            const hit = PirateDrumBed.PATTERN.find(entry => entry.step === this.step)
            if (hit && this.tension >= hit.min) this.hit(this.nextAt, hit.accent, this.step % 8 === 0)
            this.step = (this.step + 1) % 16
            this.nextAt += PirateDrumBed.STEP_S
        }
    }

    private hit(at: number, accent: number, low: boolean) {
        const voice = new ShapezzSynthVoice(this.ctx, this.output, { level: 0.6 * accent, start: at, pitch: low ? 1 : 1.35 })
        voice.tone({ freq: 95, to: 48, glide: 0.18, dur: 0.32, gain: 1 })
        voice.noise({ color: 'pink', freq: 900, to: 200, dur: 0.12, gain: 0.35 })
        voice.seal()
    }

    stop(fade = 0.5) {
        if (this.stopped) return
        this.stopped = true
        if (this.timer) clearInterval(this.timer)
        this.timer = null
        teardown(this.ctx, this.output, [this.drone], [this.droneFilter, this.droneGain, this.drone], fade)
    }
}
