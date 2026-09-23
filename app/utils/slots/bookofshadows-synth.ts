// Synthesized layers for Book of Shadows. The game's own samples (music,
// reels, button, bonus, big win, line draw, wild spawn) stay the backbone;
// these recipes cover the moments the samples don't: bet clicks, reel stops,
// book landings, the anticipation riser, count-up ticks and win-tier stings.
//
// Every recipe schedules nodes on the SHAPEZZ synth voice, which cleans up
// after itself. Palette: D minor for anything melodic, bells and glassy
// partials for magic, pitch-dropping sines for weight.

import { ShapezzSynthVoice, shapezzNote } from '~/utils/shapezz-synth'

export { ShapezzSynthVoice as BosSynthVoice }
export { shapezzSynthWarmUp as bosSynthWarmUp } from '~/utils/shapezz-synth'

export type BosSynthEvent
    = | 'bet-up'
        | 'bet-down'
        | 'toggle'
        | 'reel-stop'
        | 'book-land'
        | 'anticipation'
        | 'tick'
        | 'win-chime'
        | 'tier-up'
        | 'count-end'
        | 'roll-tick'
        | 'reveal'
        | 'column-boom'
        | 'whoosh'
        | 'rune'

/** `intensity` is a per-event hint: book count, tier index, count-up progress... */
type Recipe = (v: ShapezzSynthVoice, intensity: number) => void

// D minor, as semitone offsets from A4.
const D_MINOR = [-7, -5, -4, -2, 0, 1, 3]

function scale(step: number): number {
    const octave = Math.floor(step / D_MINOR.length)
    return shapezzNote(D_MINOR[((step % D_MINOR.length) + D_MINOR.length) % D_MINOR.length]! + octave * 12)
}

/** A struck bell: triangle fundamental plus inharmonic partials. */
function bell(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
    v.tone({ type: 'triangle', freq, dur, gain, at })
    v.tone({ freq: freq * 2.76, dur: dur * 0.45, gain: gain * 0.28, at })
    v.tone({ freq: freq * 5.4, dur: dur * 0.2, gain: gain * 0.1, at })
}

/** Glassy shimmer: a few quick high partials. */
function glitter(v: ShapezzSynthVoice, base: number, count: number, spread: number, at = 0, gain = 0.12) {
    for (let i = 0; i < count; i++) {
        const f = base * (1 + Math.random() * 1.5)
        v.tone({ freq: f, dur: 0.18 + Math.random() * 0.2, gain: gain * v.vary(0.4), at: at + Math.random() * spread })
    }
}

function thump(v: ShapezzSynthVoice, from: number, to: number, dur: number, gain = 1, at = 0) {
    v.tone({ freq: from, to, glide: dur * 0.7, dur, gain, at })
}

const recipes: Record<BosSynthEvent, Recipe> = {
    'bet-up': (v) => {
        v.tone({ type: 'triangle', freq: 880, to: 1320, glide: 0.04, dur: 0.07, gain: 0.5 })
        v.noise({ filter: 'bandpass', freq: 3200, q: 4, dur: 0.02, gain: 0.25 })
    },
    'bet-down': (v) => {
        v.tone({ type: 'triangle', freq: 1100, to: 700, glide: 0.04, dur: 0.07, gain: 0.5 })
        v.noise({ filter: 'bandpass', freq: 2600, q: 4, dur: 0.02, gain: 0.25 })
    },
    'toggle': (v) => {
        v.tone({ type: 'square', freq: 1400, dur: 0.025, gain: 0.12 })
        v.tone({ freq: 700, dur: 0.05, gain: 0.3, at: 0.005 })
    },
    // A heavy wooden reel settling: low knock plus a short click.
    'reel-stop': (v) => {
        thump(v, 150 * v.vary(0.05), 60, 0.12, 0.9)
        v.noise({ filter: 'bandpass', freq: 1800, q: 2.5, dur: 0.03, gain: 0.3 })
        v.noise({ color: 'pink', freq: 420, dur: 0.08, gain: 0.25 })
    },
    // Rises a step with every book on the board: 1st, 2nd, 3rd+.
    'book-land': (v, count) => {
        const step = 7 + Math.min(4, Math.max(0, count)) * 2
        const f = scale(step)
        bell(v, f, 0, 1.1, 0.5)
        bell(v, f * 1.5, 0.05, 0.8, 0.22)
        v.tone({ freq: f / 2, dur: 0.6, gain: 0.3, attack: 0.01 })
        glitter(v, f * 2, 6, 0.3, 0.02, 0.07)
        thump(v, 90, 40, 0.3, 0.7)
    },
    // Rising tension while a reel hangs: swelling filtered noise and a
    // trembling fifth that climbs with it.
    'anticipation': (v) => {
        const dur = 1.3
        v.noise({ filter: 'bandpass', freq: 400, to: 3600, glide: dur, q: 3, attack: dur * 0.8, dur: 0.35, gain: 0.5 })
        v.tone({ type: 'sawtooth', freq: scale(0) / 2, to: scale(4) / 2, glide: dur, attack: dur * 0.7, hold: 0.1, dur: 0.4, gain: 0.08, tremolo: { rate: 14, depth: 0.7 } })
        v.tone({ type: 'sawtooth', freq: scale(4) / 2, to: scale(7) / 2, glide: dur, attack: dur * 0.7, hold: 0.1, dur: 0.4, gain: 0.06, tremolo: { rate: 11, depth: 0.7 } })
        v.tone({ freq: 55, attack: dur * 0.6, dur: 0.6, gain: 0.35, wobble: { rate: 7, depth: 3 } })
    },
    // Count-up tick. `progress` 0..1 raises the pitch as the number climbs.
    'tick': (v, progress) => {
        const f = 1500 + Math.min(1, progress) * 1100
        v.tone({ type: 'triangle', freq: f, dur: 0.03, gain: 0.35 })
        v.tone({ freq: f * 2.02, dur: 0.02, gain: 0.1 })
    },
    // Small-win reveal: a quick rising arpeggio.
    'win-chime': (v, size) => {
        const base = 7 + Math.min(3, Math.max(0, size))
        for (let i = 0; i < 3; i++) bell(v, scale(base + i * 2), i * 0.06, 0.5, 0.28)
        glitter(v, scale(base + 7), 4, 0.25, 0.1, 0.06)
    },
    // Win tier escalation (big, mega, epic, legendary): impact and a brass-ish chord.
    'tier-up': (v, tier) => {
        const root = scale(tier * 2)
        thump(v, 120, 32, 0.7, 1.1)
        v.noise({ color: 'pink', freq: 1800, to: 150, glide: 0.5, dur: 0.6, gain: 0.5 })
        const lp = v.filter({ freq: 3200, to: 700, glide: 1.2, q: 1 })
        for (const semis of [0, 3, 7, 12]) {
            const f = root * Math.pow(2, semis / 12) / 2
            v.tone({ type: 'sawtooth', freq: f, detune: -8, attack: 0.02, hold: 0.25, dur: 0.9, gain: 0.07, dest: lp })
            v.tone({ type: 'sawtooth', freq: f, detune: 8, attack: 0.02, hold: 0.25, dur: 0.9, gain: 0.07, dest: lp })
        }
        glitter(v, root * 4, 10, 0.6, 0.05, 0.05)
    },
    // The count-up settles: coin chime.
    'count-end': (v) => {
        bell(v, scale(14), 0, 0.9, 0.35)
        bell(v, scale(18), 0.07, 1.1, 0.3)
        glitter(v, scale(21), 8, 0.4, 0.05, 0.06)
    },
    // Symbol draw carousel click.
    'roll-tick': (v) => {
        v.noise({ filter: 'bandpass', freq: 2400 * v.vary(0.1), q: 5, dur: 0.025, gain: 0.5 })
        v.tone({ type: 'triangle', freq: 520, dur: 0.04, gain: 0.25 })
    },
    // The drawn symbol lands.
    'reveal': (v) => {
        thump(v, 110, 36, 0.8, 1)
        v.noise({ color: 'pink', freq: 900, to: 120, dur: 0.9, gain: 0.35 })
        bell(v, scale(7), 0.02, 1.6, 0.45)
        bell(v, scale(11), 0.1, 1.4, 0.3)
        bell(v, scale(14), 0.18, 1.3, 0.25)
        glitter(v, scale(21), 12, 0.8, 0.1, 0.05)
    },
    // A reel locks into a wild column: sub boom under the wild-spawn sample.
    'column-boom': (v) => {
        thump(v, 90, 28, 0.9, 1.2)
        v.noise({ color: 'pink', freq: 1400, to: 90, glide: 0.6, dur: 0.7, gain: 0.45 })
        v.tone({ type: 'sawtooth', freq: 55, dur: 0.6, gain: 0.08, drive: 2 })
    },
    'whoosh': (v) => {
        v.noise({ filter: 'bandpass', freq: 300, to: 2400, glide: 0.35, q: 1.3, attack: 0.18, dur: 0.25, gain: 0.5 })
    },
    // Win thread sparkle when a connection finishes tracing.
    'rune': (v, step) => {
        const f = scale(10 + Math.min(6, Math.max(0, step)))
        v.tone({ type: 'triangle', freq: f, dur: 0.25, gain: 0.25 })
        v.tone({ freq: f * 3.01, dur: 0.12, gain: 0.06 })
    }
}

export const BOS_SYNTH_RECIPES: Readonly<Record<BosSynthEvent, Recipe>> = recipes

/** Mix levels relative to the SFX bus. */
export const BOS_SYNTH_LEVELS: Record<BosSynthEvent, number> = {
    'bet-up': 0.22,
    'bet-down': 0.22,
    'toggle': 0.25,
    'reel-stop': 0.3,
    'book-land': 0.42,
    'anticipation': 0.5,
    'tick': 0.14,
    'win-chime': 0.3,
    'tier-up': 0.5,
    'count-end': 0.36,
    'roll-tick': 0.3,
    'reveal': 0.5,
    'column-boom': 0.5,
    'whoosh': 0.22,
    'rune': 0.18
}

/** Minimum gap between two plays of the same event, in ms. */
export const BOS_SYNTH_COOLDOWNS: Record<BosSynthEvent, number> = {
    'bet-up': 40,
    'bet-down': 40,
    'toggle': 40,
    'reel-stop': 45,
    'book-land': 60,
    'anticipation': 400,
    'tick': 55,
    'win-chime': 150,
    'tier-up': 250,
    'count-end': 300,
    'roll-tick': 30,
    'reveal': 500,
    'column-boom': 200,
    'whoosh': 150,
    'rune': 60
}
