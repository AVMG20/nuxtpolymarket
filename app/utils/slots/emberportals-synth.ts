// Ember Portals sound design. Every effect is synthesized at play time on the
// shared SHAPEZZ synth voice (oscillators, filtered noise, envelopes, drive);
// there are no sample files. Played through app/composables/emberportals-sound.ts.
//
// Palette: D Phrygian dominant for anything melodic, so it sounds old and
// arcane. Glassy sines with high partials for crystal chimes, crackling
// square-tremolo noise for fire, swept band-passed noise for portal whooshes,
// detuned saws through slow filters for drones.
//
// Besides the one-shot recipes this file builds the music loop the composable
// owns: a slow arcane drone with a harp arpeggio, which gains drums and a
// faster pulse in free spins.

import { ShapezzSynthVoice, shapezzNote, shapezzSynthWarmUp } from '~/utils/shapezz-synth'

export { ShapezzSynthVoice as EpSynthVoice }

export type EpSoundEvent
    = 'spin' | 'drop' | 'land' | 'click' | 'bet-up' | 'bet-down'
        | 'win-small' | 'win' | 'win-big' | 'burn' | 'tumble'
        | 'portal-open' | 'portal-grow' | 'portal-merge'
        | 'scatter' | 'tease' | 'bonus-trigger' | 'fs-start' | 'fs-end' | 'retrigger'
        | 'count' | 'count-end' | 'bigwin' | 'ante-on' | 'ante-off' | 'buy' | 'error'

export const EP_SOUND_LEVELS: Record<EpSoundEvent, number> = {
    'spin': 0.32,
    'drop': 0.3,
    'land': 0.4,
    'click': 0.22,
    'bet-up': 0.24,
    'bet-down': 0.24,
    'win-small': 0.34,
    'win': 0.4,
    'win-big': 0.46,
    'burn': 0.36,
    'tumble': 0.3,
    'portal-open': 0.44,
    'portal-grow': 0.42,
    'portal-merge': 0.5,
    'scatter': 0.44,
    'tease': 0.36,
    'bonus-trigger': 0.54,
    'fs-start': 0.46,
    'fs-end': 0.46,
    'retrigger': 0.48,
    'count': 0.12,
    'count-end': 0.4,
    'bigwin': 0.5,
    'ante-on': 0.3,
    'ante-off': 0.26,
    'buy': 0.44,
    'error': 0.3
}

export const EP_SOUND_COOLDOWNS: Record<EpSoundEvent, number> = {
    'spin': 120,
    'drop': 60,
    'land': 30,
    'click': 40,
    'bet-up': 40,
    'bet-down': 40,
    'win-small': 150,
    'win': 200,
    'win-big': 400,
    'burn': 90,
    'tumble': 90,
    'portal-open': 70,
    'portal-grow': 70,
    'portal-merge': 150,
    'scatter': 50,
    'tease': 500,
    'bonus-trigger': 1200,
    'fs-start': 800,
    'fs-end': 1200,
    'retrigger': 800,
    'count': 42,
    'count-end': 400,
    'bigwin': 250,
    'ante-on': 80,
    'ante-off': 80,
    'buy': 400,
    'error': 400
}

export const EP_SOUND_VOICE_CAPS: Partial<Record<EpSoundEvent, number>> = {
    'count': 3,
    'land': 7,
    'scatter': 7,
    'portal-open': 4,
    'portal-grow': 4,
    'bigwin': 2,
    'bonus-trigger': 1,
    'tease': 1
}

export const EP_SOUND_DEFAULT_VOICE_CAP = 3
export const EP_SOUND_MAX_VOICES = 40

export const EP_SYNTH_JITTER: Partial<Record<EpSoundEvent, number>> = {
    'count': 0.06,
    'land': 0.03,
    'burn': 0.06,
    'win-small': 0,
    'win': 0,
    'win-big': 0,
    'bigwin': 0,
    'bonus-trigger': 0,
    'fs-start': 0,
    'fs-end': 0,
    'retrigger': 0,
    'scatter': 0,
    'count-end': 0,
    'portal-grow': 0,
    'portal-merge': 0
}
export const EP_SYNTH_DEFAULT_JITTER = 0.02

const note = shapezzNote

/** D Phrygian dominant, semitones above D: D E♭ F♯ G A B♭ C. */
const SCALE = [0, 1, 4, 5, 7, 8, 10]
/** D4 is 7 semitones below A4. */
const D = -7

/** Frequency of scale step `step` (any integer) above D4, shifted by `octave` semitones. */
function arc(step: number, octave = 0) {
    const o = Math.floor(step / SCALE.length)
    const i = ((step % SCALE.length) + SCALE.length) % SCALE.length
    return note(D + o * 12 + SCALE[i]! + octave)
}

type Recipe = (v: ShapezzSynthVoice, intensity: number) => void

function thump(v: ShapezzSynthVoice, from: number, to: number, dur: number, gain = 1, at = 0) {
    v.tone({ freq: from, to, glide: dur * 0.6, dur, gain, at })
}

/** Glassy crystal chime: sine with inharmonic bell partials. */
function chime(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.4) {
    v.tone({ freq, dur, gain, at })
    v.tone({ freq: freq * 2.76, dur: dur * 0.45, gain: gain * 0.22, at })
    v.tone({ freq: freq * 5.4, dur: dur * 0.2, gain: gain * 0.1, at })
}

/** Plucked harp: triangle plus a quick octave. */
function harp(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.4) {
    v.tone({ type: 'triangle', freq, dur, gain, at })
    v.tone({ freq: freq * 2, dur: dur * 0.3, gain: gain * 0.2, at })
}

/** Dark detuned-saw pad through a closing low-pass. */
function drone(v: ShapezzSynthVoice, freqs: number[], at: number, dur: number, gain = 0.12, hold = 0, bright = 2400, attack = 0.04) {
    const filter = v.filter({ freq: bright, to: 400, at, glide: hold + dur, q: 1.5 })
    for (const freq of freqs) {
        v.tone({ type: 'sawtooth', freq, detune: -9, dur, hold, gain, at, attack, dest: filter })
        v.tone({ type: 'sawtooth', freq, detune: 9, dur, hold, gain, at, attack, dest: filter })
    }
}

function whoosh(v: ShapezzSynthVoice, from: number, to: number, dur: number, at = 0, gain = 0.5, q = 1.2) {
    v.noise({ filter: 'bandpass', freq: from, to, glide: dur, q, attack: dur * 0.4, dur: dur * 0.6, gain, at })
}

/** Fire crackle: pink noise chopped by a fast square tremolo, plus pops. */
function crackle(v: ShapezzSynthVoice, at: number, dur: number, gain = 0.3) {
    v.noise({ color: 'pink', filter: 'bandpass', freq: 1800, q: 0.7, dur, gain, at, tremolo: { rate: 31, depth: 0.9, type: 'square' } })
    v.noise({ filter: 'lowpass', freq: 700, dur: dur * 1.2, gain: gain * 0.6, at })
    for (let i = 0; i < 4; i++) {
        v.noise({ filter: 'highpass', freq: 3000 * v.vary(0.3), dur: 0.015, gain: gain * 0.9, at: at + dur * (i / 4) * v.vary(0.3) })
    }
}

function shimmer(v: ShapezzSynthVoice, at: number, dur: number, gain = 0.18) {
    v.noise({ filter: 'highpass', freq: 6000, dur, gain, at })
    v.tone({ freq: 3520, to: 4700, glide: dur, dur, gain: gain * 0.3, at, tremolo: { rate: 18, depth: 0.7 } })
}

/** Rising chime run over scale steps. */
function run(v: ShapezzSynthVoice, steps: number[], at: number, gap: number, dur: number, gain: number, kind: 'chime' | 'harp' = 'harp', octave = 0) {
    steps.forEach((s, i) => (kind === 'chime' ? chime : harp)(v, arc(s, octave), at + i * gap, dur, gain))
}

/** Portal whoosh: a resonant swept band with a sub swell. */
function portal(v: ShapezzSynthVoice, at: number, dur: number, gain: number, up = true) {
    const [a, b] = up ? [300, 3600] : [3600, 300]
    v.noise({ filter: 'bandpass', freq: a, to: b, glide: dur, q: 4, attack: dur * 0.5, dur: dur * 0.5, gain, at })
    v.tone({ freq: up ? 60 : 140, to: up ? 140 : 50, glide: dur, attack: dur * 0.6, dur: dur * 0.5, gain: gain * 0.8, at })
}

const recipes: Record<EpSoundEvent, Recipe> = {
    // UI
    'click': (v) => {
        v.tone({ type: 'triangle', freq: 1600, to: 900, glide: 0.03, dur: 0.04, gain: 0.25 })
        v.noise({ filter: 'highpass', freq: 4200, dur: 0.012, gain: 0.25 })
    },
    'bet-up': (v) => {
        chime(v, arc(4), 0, 0.12, 0.4)
        chime(v, arc(7), 0.05, 0.16, 0.35)
    },
    'bet-down': (v) => {
        chime(v, arc(7), 0, 0.12, 0.4)
        chime(v, arc(4), 0.05, 0.16, 0.35)
    },
    'ante-on': (v) => {
        crackle(v, 0, 0.25, 0.25)
        run(v, [4, 7, 9], 0.02, 0.06, 0.3, 0.3, 'chime')
    },
    'ante-off': (v) => {
        run(v, [9, 7, 4], 0, 0.06, 0.2, 0.28, 'chime')
        v.noise({ filter: 'lowpass', freq: 900, to: 200, dur: 0.2, gain: 0.25 })
    },
    'buy': (v) => {
        portal(v, 0, 0.4, 0.4)
        chime(v, arc(11), 0.2, 0.7, 0.3)
        chime(v, arc(14), 0.3, 0.8, 0.28)
        thump(v, 140, 45, 0.25, 0.6, 0.2)
    },
    'error': (v) => {
        const lp = v.filter({ freq: 1000, q: 0.8 })
        v.tone({ type: 'square', freq: arc(1, -12), dur: 0.12, gain: 0.3, dest: lp })
        v.tone({ type: 'square', freq: arc(0, -12), dur: 0.22, gain: 0.3, at: 0.13, dest: lp })
    },

    // grid
    'spin': (v) => {
        whoosh(v, 3000, 400, 0.3, 0, 0.3)
        thump(v, 120, 50, 0.15, 0.5, 0.05)
        v.tone({ type: 'triangle', freq: arc(0, -12), to: arc(4, -12), glide: 0.2, dur: 0.22, gain: 0.2 })
    },
    'drop': (v) => {
        whoosh(v, 600, 2600, 0.22, 0, 0.3, 1.6)
    },
    // Intensity: column index 0..6.
    'land': (v, col) => {
        const k = 1 - Math.min(6, Math.max(0, col)) * 0.03
        thump(v, 140 * k * v.vary(0.03), 45, 0.14, 0.9)
        v.noise({ filter: 'bandpass', freq: 1400, q: 2, dur: 0.025, gain: 0.35 })
        v.tone({ freq: arc(Math.round(col), 12) * 2, dur: 0.06, gain: 0.05 })
    },
    'burn': (v) => {
        crackle(v, 0, 0.35, 0.35)
        whoosh(v, 800, 3200, 0.25, 0, 0.3)
        v.tone({ type: 'sawtooth', freq: 180, to: 60, dur: 0.2, gain: 0.08 })
    },
    'tumble': (v) => {
        for (let i = 0; i < 3; i++) thump(v, 110 * v.vary(0.08), 50, 0.08, 0.35, i * 0.05)
        whoosh(v, 1600, 500, 0.2, 0, 0.2)
    },
    // Intensity: 0..1 win size.
    'win-small': (v, x) => {
        const s = Math.round(Math.max(0, Math.min(1, x)) * 3)
        harp(v, arc(4 + s), 0, 0.25, 0.4)
        harp(v, arc(7 + s), 0.07, 0.35, 0.35)
    },
    'win': (v) => {
        run(v, [4, 6, 7, 9], 0, 0.06, 0.3, 0.34)
        chime(v, arc(11), 0.26, 0.8, 0.3)
        drone(v, [arc(0, -12), arc(4, -12), arc(7, -12)], 0.24, 0.5, 0.04, 0.1)
    },
    'win-big': (v) => {
        drone(v, [arc(0, -24), arc(4, -12), arc(7, -12)], 0, 0.5, 0.07, 0.1)
        run(v, [4, 6, 7, 9, 11, 14], 0.1, 0.06, 0.4, 0.3, 'chime')
        crackle(v, 0.4, 0.5, 0.2)
        shimmer(v, 0.45, 1.1, 0.14)
    },

    // portals
    'portal-open': (v) => {
        portal(v, 0, 0.35, 0.45)
        chime(v, arc(7, 12), 0.25, 0.6, 0.3)
        crackle(v, 0.2, 0.25, 0.18)
    },
    // Intensity: 0..1 multiplier size.
    'portal-grow': (v, x) => {
        const t = Math.max(0, Math.min(1, x))
        const lift = 1 + t * 0.6
        v.tone({ type: 'triangle', freq: 260 * lift, to: 1100 * lift, glide: 0.18, dur: 0.22, gain: 0.3 })
        chime(v, arc(9 + Math.round(t * 5)), 0.14, 0.5, 0.3)
        thump(v, 150, 55, 0.18, 0.6)
    },
    'portal-merge': (v, x) => {
        const t = Math.max(0, Math.min(1, x))
        portal(v, 0, 0.3, 0.4, false)
        thump(v, 90, 30, 0.5, 1.1, 0.28)
        drone(v, [arc(0, -12), arc(4, -12), arc(7, -12)], 0.28, 0.6, 0.06, 0.05, 3200)
        run(v, [7, 9, 11, 14].map(s => s + Math.round(t * 3)), 0.3, 0.05, 0.5, 0.26, 'chime')
        shimmer(v, 0.3, 0.8, 0.12)
    },

    // scatters & bonus
    // Intensity: scatter index (0, 1, 2 …) for a rising pitch.
    'scatter': (v, index) => {
        const i = Math.max(0, Math.min(8, Math.round(index)))
        chime(v, arc(7 + i * 2), 0, 1, 0.42)
        chime(v, arc(11 + i * 2), 0.03, 0.8, 0.22)
        thump(v, 100, 50, 0.3, 0.5)
        shimmer(v, 0, 0.35, 0.1)
    },
    // Intensity: tease length in seconds (defaults to 1.8).
    'tease': (v, seconds) => {
        const dur = seconds > 0 ? seconds : 1.8
        const bp = v.filter({ type: 'bandpass', freq: 250, to: 2200, glide: dur, q: 6 })
        v.tone({ type: 'sawtooth', freq: arc(0, -24), to: arc(0, -12), glide: dur, attack: dur * 0.8, dur: 0.35, gain: 0.32, dest: bp })
        v.tone({ type: 'sawtooth', freq: arc(1, -24), to: arc(1, -12), glide: dur, attack: dur * 0.8, dur: 0.35, gain: 0.18, dest: bp })
        v.noise({ filter: 'highpass', freq: 1600, to: 7000, glide: dur, attack: dur * 0.85, dur: 0.3, gain: 0.14 })
        const k = dur / 1.8
        const beats = [0, 0.45, 0.8, 1.08, 1.3, 1.48, 1.62]
        beats.forEach((t, i) => chime(v, arc(i % 2 ? 1 : 0, 12), t * k, 0.2, 0.18 + i * 0.03))
    },
    'bonus-trigger': (v) => {
        portal(v, 0, 0.6, 0.5)
        thump(v, 70, 26, 1.1, 1.2, 0.55)
        crackle(v, 0.55, 0.9, 0.3)
        run(v, [0, 2, 4, 5, 7, 9, 11, 14], 0.6, 0.06, 0.5, 0.3, 'chime')
        drone(v, [arc(0, -24), arc(2, -12), arc(4, -12), arc(7, -12)], 1.05, 1.6, 0.07, 0.4, 4200)
        shimmer(v, 1.05, 1.6, 0.16)
    },
    'fs-start': (v) => {
        portal(v, 0, 0.4, 0.4)
        chime(v, arc(7), 0.3, 0.6, 0.3)
        chime(v, arc(11), 0.38, 0.8, 0.28)
        thump(v, 110, 40, 0.3, 0.7, 0.3)
    },
    'fs-end': (v) => {
        run(v, [14, 11, 9, 7, 4, 0], 0, 0.07, 0.4, 0.28, 'chime')
        drone(v, [arc(0, -24), arc(2, -12), arc(4, -12), arc(7, -12)], 0.45, 1.8, 0.06, 0.3, 3000, 0.1)
        thump(v, 80, 32, 0.6, 0.8, 0.45)
    },
    'retrigger': (v) => {
        portal(v, 0, 0.35, 0.4)
        run(v, [7, 11, 14, 18], 0.2, 0.08, 0.6, 0.3, 'chime')
        shimmer(v, 0.3, 1, 0.14)
    },

    // counting / big wins
    'count': (v) => {
        v.tone({ freq: 2600 * v.vary(0.05), dur: 0.03, gain: 0.3 })
        v.tone({ freq: 7000 * v.vary(0.05), dur: 0.015, gain: 0.08 })
    },
    'count-end': (v) => {
        chime(v, arc(14), 0, 0.8, 0.34)
        chime(v, arc(18), 0.05, 0.9, 0.2)
        thump(v, 100, 40, 0.3, 0.5)
    },
    // Intensity: tier index 0..4.
    'bigwin': (v, tier) => {
        const t = Math.max(0, Math.min(4, Math.round(tier)))
        const root = [0, 1, 3, 4, 6][t]!
        portal(v, 0, 0.35, 0.4)
        drone(v, [arc(root, -24), arc(root + 2, -12), arc(root + 4, -12), arc(root + 7)], 0.28, 1.2, 0.07, 0.2, 5000)
        thump(v, 100, 32, 0.6, 1.1, 0.28)
        crackle(v, 0.28, 0.8, 0.22)
        shimmer(v, 0.28, 1.5, 0.16)
    }
}

export const EP_SYNTH_RECIPES: Readonly<Record<EpSoundEvent, Recipe>> = recipes

export function epSynthWarmUp(ctx: BaseAudioContext) {
    shapezzSynthWarmUp(ctx)
}

// Music -----------------------------------------------------------------------

// Harp arpeggio figures (scale steps on a 16th grid of 16 steps per bar), one
// per chord. Chords: i (D) – ♭II (E♭) – i – v° (A) in Phrygian dominant.
const CHORDS: number[][] = [
    [0, 2, 4, 7],
    [1, 3, 5, 8],
    [0, 2, 4, 7],
    [4, 6, 8, 11]
]
const ARP = [0, 1, 2, 3, 2, 1, 2, 3]
/** Crystal melody answers (step in bar, scale step), one list per bar. */
const MELODY: [number, number][][] = [
    [[0, 11], [6, 9], [10, 8]],
    [[0, 8], [4, 9], [8, 11], [12, 12]],
    [[0, 14], [6, 12], [10, 11]],
    [[0, 11], [8, 10], [12, 9]]
]

/**
 * Arcane music: a low drone per chord, a plucked harp arpeggio and a crystal
 * melody every other bar, scheduled ahead on the audio clock. Free-spin mode
 * speeds up, adds frame-drum kicks, a crackling shaker and a brighter drone.
 */
export class EpMusic {
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
        this.output.gain.linearRampToValueAtTime(level, now + 2)
        this.output.connect(destination)
        this.nextTime = now + 0.15
        this.timer = setInterval(() => this.pump(), 60)
    }

    setBonus(on: boolean) {
        this.bonus = on
    }

    private sixteenth() {
        return 60 / (this.bonus ? 118 : 84) / 4
    }

    private pump() {
        if (this.stopped) return
        const ahead = this.ctx.currentTime + 0.25
        if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05
        while (this.nextTime < ahead) {
            this.schedule(this.step, this.nextTime)
            this.nextTime += this.sixteenth()
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
        const chord = CHORDS[bar]!
        // Drone at the top of every bar, held through it.
        if (pos === 0) {
            const bright = this.bonus ? 1600 : 900
            this.voice(at, 0.16, v => drone(v, [arc(chord[0]!, -24), arc(chord[2]!, -24)], 0, d * 6, 0.5, d * 12, bright, d * 3))
        }
        // Harp arpeggio on eighths (sixteenths in bonus).
        if (pos % 2 === 0 || this.bonus) {
            const i = this.bonus ? pos % 8 : (pos / 2) % 8
            this.voice(at, 0.1, v => harp(v, arc(chord[ARP[i]!]!, -12), 0, d * 5, 1))
        }
        // Crystal melody on odd bars.
        if (bar % 2 === 1 || this.bonus) {
            for (const [p, s] of MELODY[(bar + (this.bonus ? 1 : 0)) % MELODY.length]!) {
                if (p === pos) this.voice(at, 0.07, v => chime(v, arc(s), 0, 1.2, 1))
            }
        }
        // Soft ember crackle texture.
        if (pos === 6 || pos === 14) this.voice(at, 0.04, v => v.noise({ color: 'pink', filter: 'bandpass', freq: 2200, q: 0.8, dur: 0.25, gain: 1, tremolo: { rate: 27, depth: 0.9, type: 'square' } }))
        if (this.bonus) {
            // Frame drum: kick on 1 and the "and" of 2, 3; shaker on off-beats.
            if (pos === 0 || pos === 6 || pos === 8) this.voice(at, 0.45, v => v.tone({ freq: 110, to: 40, glide: 0.12, dur: 0.22, gain: 1, fixed: true }))
            if (pos === 4 || pos === 12) this.voice(at, 0.14, v => v.noise({ filter: 'bandpass', freq: 1800, q: 0.9, dur: 0.14, gain: 1 }))
            if (pos % 2 === 1) this.voice(at, 0.05, v => v.noise({ filter: 'highpass', freq: 7000, dur: 0.05, gain: 1 }))
        } else if (pos === 0 || pos === 10) {
            this.voice(at, 0.28, v => v.tone({ freq: 80, to: 36, glide: 0.2, dur: 0.4, gain: 1, fixed: true }))
        }
    }

    stop(fade = 0.8) {
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
