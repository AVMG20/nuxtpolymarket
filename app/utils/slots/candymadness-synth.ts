// Candy Madness sound effects, synthesized at play time on the shared synth
// voice (app/utils/shapezz-synth.ts). Nothing is fetched.
//
// Palette: C major pentatonic for anything melodic, sine "bloops" that glide
// up for popping candies, band-passed noise ticks for sugar rattle, detuned
// saws through a closing low-pass for the brassy fanfares and inharmonic
// triangle partials for glass bells.

import { ShapezzSynthVoice, shapezzNote } from '~/utils/shapezz-synth'

export { ShapezzSynthVoice as CandySynthVoice }

export type CandySoundEvent
  = | 'click' | 'bet-up' | 'bet-down' | 'bet-max' | 'toggle'
    | 'spin' | 'drop' | 'scatter-land' | 'anticipation'
    | 'cluster' | 'pop' | 'tumble' | 'spot' | 'spot-up' | 'mult-apply'
    | 'tick' | 'win-small' | 'win-medium' | 'win-big'
    | 'bigwin-tier' | 'bigwin-end'
    | 'bonus-trigger' | 'bonus-start' | 'bonus-spin' | 'bonus-end' | 'buy'

/** C major pentatonic step → semitones from A4. Step 0 is C5. */
function penta(step: number): number {
  const scale = [0, 2, 4, 7, 9]
  const octave = Math.floor(step / 5)
  return 3 + octave * 12 + scale[((step % 5) + 5) % 5]!
}

const note = (step: number) => shapezzNote(penta(step))

type Recipe = (v: ShapezzSynthVoice, intensity: number) => void

function chime(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
  v.tone({ type: 'triangle', freq, dur, gain, at })
  v.tone({ freq: freq * 2.01, dur: dur * 0.5, gain: gain * 0.35, at })
}

function glass(v: ShapezzSynthVoice, freq: number, at: number, dur: number, gain = 0.5) {
  v.tone({ freq, dur, gain, at })
  v.tone({ type: 'triangle', freq: freq * 2.76, dur: dur * 0.45, gain: gain * 0.28, at })
  v.tone({ freq: freq * 5.4, dur: dur * 0.2, gain: gain * 0.12, at })
}

function sparkle(v: ShapezzSynthVoice, count: number, spread: number, at = 0, gain = 0.12) {
  for (let i = 0; i < count; i++) {
    const f = note(12 + Math.floor(Math.random() * 8))
    v.tone({ freq: f, dur: 0.12, gain: gain * v.vary(0.4), at: at + Math.random() * spread })
  }
}

function rattle(v: ShapezzSynthVoice, count: number, spread: number, at = 0, gain = 0.25) {
  for (let i = 0; i < count; i++) {
    v.noise({ filter: 'bandpass', freq: 2400 + Math.random() * 3000, q: 4, dur: 0.02 + Math.random() * 0.025, gain: gain * v.vary(0.4), at: at + Math.random() * spread })
  }
}

function brass(v: ShapezzSynthVoice, freqs: number[], at: number, dur: number, gain = 0.16, hold = 0) {
  const filter = v.filter({ freq: 3200, to: 700, at, glide: hold + dur, q: 1.1 })
  for (const freq of freqs) {
    v.tone({ type: 'sawtooth', freq, detune: -8, dur, hold, gain, at, attack: 0.015, dest: filter })
    v.tone({ type: 'sawtooth', freq, detune: 8, dur, hold, gain, at, attack: 0.015, dest: filter })
  }
}

function bloop(v: ShapezzSynthVoice, freq: number, at = 0, gain = 0.8) {
  v.tone({ freq: freq * 0.55, to: freq * 1.7, glide: 0.06, dur: 0.11, gain, at })
  v.tone({ type: 'triangle', freq: freq * 2, to: freq * 3, glide: 0.04, dur: 0.05, gain: gain * 0.25, at })
}

function arpeggio(v: ShapezzSynthVoice, steps: number[], gap: number, dur: number, gain = 0.45, at = 0) {
  steps.forEach((s, i) => chime(v, note(s), at + i * gap, dur, gain))
}

const recipes: Record<CandySoundEvent, Recipe> = {
  'click': (v) => {
    v.tone({ type: 'triangle', freq: 1400, to: 900, dur: 0.04, gain: 0.5 })
    v.noise({ filter: 'highpass', freq: 4000, dur: 0.015, gain: 0.15 })
  },
  'bet-up': (v, i) => {
    const f = note(5 + Math.min(10, i))
    v.tone({ type: 'triangle', freq: f, to: f * 1.5, glide: 0.06, dur: 0.1, gain: 0.5 })
  },
  'bet-down': (v, i) => {
    const f = note(8 + Math.min(10, i))
    v.tone({ type: 'triangle', freq: f, to: f * 0.66, glide: 0.06, dur: 0.1, gain: 0.5 })
  },
  'bet-max': (v) => {
    arpeggio(v, [5, 7, 9, 10], 0.04, 0.16, 0.4)
    rattle(v, 5, 0.15, 0, 0.15)
  },
  'toggle': (v, on) => {
    const a = on ? note(7) : note(9)
    const b = on ? note(9) : note(7)
    v.tone({ type: 'square', freq: a, dur: 0.05, gain: 0.12 })
    v.tone({ type: 'square', freq: b, dur: 0.07, gain: 0.12, at: 0.05 })
  },
  'spin': (v) => {
    v.noise({ filter: 'bandpass', freq: 500, to: 3200, glide: 0.28, q: 1.4, attack: 0.08, dur: 0.24, gain: 0.5 })
    v.tone({ type: 'triangle', freq: 260, to: 780, glide: 0.2, dur: 0.24, gain: 0.3 })
    rattle(v, 8, 0.3, 0.02, 0.18)
  },
  'drop': (v, col) => {
    // wooden candy jar "tok", pitched a touch higher per column
    const f = 180 * Math.pow(1.045, col)
    v.tone({ type: 'triangle', freq: f * 1.6, to: f, glide: 0.05, dur: 0.09, gain: 0.55 })
    v.noise({ filter: 'bandpass', freq: 1500, q: 2.5, dur: 0.035, gain: 0.3 })
    rattle(v, 3, 0.08, 0.02, 0.14)
  },
  'scatter-land': (v, i) => {
    const base = 10 + Math.min(6, i) * 2
    glass(v, note(base), 0, 0.7, 0.45)
    glass(v, note(base + 2), 0.07, 0.6, 0.3)
    sparkle(v, 6, 0.4, 0.05, 0.1)
  },
  'anticipation': (v) => {
    v.tone({ type: 'triangle', freq: note(0), to: note(10), glide: 1.4, attack: 0.3, dur: 1.2, gain: 0.3, tremolo: { rate: 14, depth: 0.6 } })
    v.noise({ filter: 'bandpass', freq: 800, to: 5000, glide: 1.4, q: 1.2, attack: 1, dur: 0.5, gain: 0.25 })
  },
  'cluster': (v, chain) => {
    const s = Math.min(12, chain - 1) * 1
    arpeggio(v, [s + 3, s + 5, s + 7], 0.05, 0.28, 0.35)
  },
  'pop': (v, chain) => {
    const f = 420 * Math.pow(2, Math.min(14, chain - 1) * 2 / 12)
    bloop(v, f, 0, 0.8)
    bloop(v, f * 1.26, 0.045, 0.5)
    bloop(v, f * 1.5, 0.09, 0.35)
    v.noise({ filter: 'highpass', freq: 3000, dur: 0.03, gain: 0.3 })
    rattle(v, 6, 0.2, 0.03, 0.14)
  },
  'tumble': (v) => {
    v.noise({ filter: 'bandpass', freq: 3000, to: 700, glide: 0.25, q: 1.2, attack: 0.03, dur: 0.22, gain: 0.3 })
    rattle(v, 7, 0.28, 0.05, 0.16)
  },
  'spot': (v, k) => {
    glass(v, note(8 + Math.min(12, k)), 0, 0.35, 0.4)
  },
  'spot-up': (v, k) => {
    const f = note(8 + Math.min(14, k))
    glass(v, f, 0, 0.3, 0.35)
    glass(v, f * 1.5, 0.05, 0.35, 0.3)
  },
  'mult-apply': (v) => {
    v.noise({ filter: 'bandpass', freq: 600, to: 5000, glide: 0.35, q: 1.3, attack: 0.25, dur: 0.12, gain: 0.35 })
    v.tone({ freq: 90, to: 40, glide: 0.3, dur: 0.35, gain: 0.8, at: 0.36 })
    brass(v, [note(0), note(2), note(3)].map(f => f / 2), 0.36, 0.5, 0.1, 0.1)
    arpeggio(v, [10, 12, 13, 15], 0.035, 0.35, 0.3, 0.38)
  },
  'tick': (v, i) => {
    v.tone({ freq: 1500 + (i % 5) * 120, dur: 0.025, gain: 0.35 })
  },
  'win-small': (v) => {
    arpeggio(v, [5, 7], 0.07, 0.3, 0.4)
  },
  'win-medium': (v) => {
    arpeggio(v, [5, 7, 8, 10], 0.07, 0.4, 0.4)
    sparkle(v, 5, 0.4, 0.2)
  },
  'win-big': (v) => {
    arpeggio(v, [5, 6, 7, 8, 9, 10], 0.06, 0.5, 0.38)
    brass(v, [note(0), note(2), note(3)], 0.36, 0.9, 0.08, 0.2)
    sparkle(v, 10, 0.8, 0.3)
  },
  'bigwin-tier': (v, tier) => {
    const t = Math.min(4, Math.max(0, tier))
    v.tone({ freq: 70, to: 35, glide: 0.35, dur: 0.4, gain: 0.9 })
    v.noise({ filter: 'highpass', freq: 5000, attack: 0.005, dur: 0.9, gain: 0.25 })
    brass(v, [note(t * 2), note(t * 2 + 2), note(t * 2 + 3)], 0, 0.9, 0.12, 0.35)
    arpeggio(v, [t * 2 + 5, t * 2 + 7, t * 2 + 8, t * 2 + 10], 0.05, 0.5, 0.3, 0.05)
    sparkle(v, 12, 1, 0.1)
  },
  'bigwin-end': (v) => {
    brass(v, [note(0), note(2), note(3), note(5)], 0, 1.3, 0.1, 0.4)
    glass(v, note(15), 0.05, 1.4, 0.35)
    sparkle(v, 14, 1.2, 0.1)
  },
  'bonus-trigger': (v) => {
    arpeggio(v, [0, 1, 2, 3, 4, 5, 6, 7, 8, 10], 0.055, 0.45, 0.38)
    brass(v, [note(0), note(2), note(3), note(5)], 0.56, 1.2, 0.09, 0.4)
    sparkle(v, 18, 1.4, 0.5)
    v.noise({ filter: 'highpass', freq: 4500, at: 0.55, attack: 0.01, dur: 1.2, gain: 0.2 })
  },
  'bonus-start': (v) => {
    v.noise({ filter: 'bandpass', freq: 400, to: 4000, glide: 0.5, q: 1.5, attack: 0.4, dur: 0.15, gain: 0.4 })
    v.tone({ freq: 80, to: 36, glide: 0.4, dur: 0.5, gain: 0.9, at: 0.5 })
    brass(v, [note(3), note(5), note(7)], 0.5, 1, 0.1, 0.25)
    glass(v, note(13), 0.5, 1, 0.3)
  },
  'bonus-spin': (v, round) => {
    glass(v, note(5 + Math.min(10, round)), 0, 0.4, 0.3)
    v.noise({ filter: 'bandpass', freq: 700, to: 2800, glide: 0.2, q: 1.3, attack: 0.05, dur: 0.18, gain: 0.3 })
  },
  'bonus-end': (v) => {
    arpeggio(v, [10, 8, 7, 5, 7, 10], 0.09, 0.5, 0.34)
    brass(v, [note(0), note(2), note(3)], 0.55, 1.1, 0.09, 0.3)
  },
  'buy': (v) => {
    glass(v, note(12), 0, 0.5, 0.35)
    glass(v, note(14), 0.07, 0.6, 0.35)
    rattle(v, 10, 0.3, 0, 0.2)
    v.tone({ freq: 120, to: 60, glide: 0.15, dur: 0.2, gain: 0.5 })
  }
}

export const CANDY_SYNTH_RECIPES: Readonly<Record<CandySoundEvent, Recipe>> = recipes

/** Per-event mix levels relative to the player's volume setting. */
export const CANDY_SOUND_LEVELS: Record<CandySoundEvent, number> = {
  'click': 0.22,
  'bet-up': 0.26,
  'bet-down': 0.26,
  'bet-max': 0.3,
  'toggle': 0.26,
  'spin': 0.34,
  'drop': 0.26,
  'scatter-land': 0.42,
  'anticipation': 0.4,
  'cluster': 0.3,
  'pop': 0.42,
  'tumble': 0.26,
  'spot': 0.26,
  'spot-up': 0.28,
  'mult-apply': 0.5,
  'tick': 0.1,
  'win-small': 0.34,
  'win-medium': 0.4,
  'win-big': 0.46,
  'bigwin-tier': 0.55,
  'bigwin-end': 0.5,
  'bonus-trigger': 0.55,
  'bonus-start': 0.5,
  'bonus-spin': 0.3,
  'bonus-end': 0.5,
  'buy': 0.42
}

/** Minimum ms between plays of the same event. */
export const CANDY_SOUND_COOLDOWNS: Record<CandySoundEvent, number> = {
  'click': 40,
  'bet-up': 40,
  'bet-down': 40,
  'bet-max': 120,
  'toggle': 60,
  'spin': 150,
  'drop': 35,
  'scatter-land': 60,
  'anticipation': 800,
  'cluster': 80,
  'pop': 90,
  'tumble': 120,
  'spot': 45,
  'spot-up': 45,
  'mult-apply': 400,
  'tick': 55,
  'win-small': 200,
  'win-medium': 300,
  'win-big': 600,
  'bigwin-tier': 300,
  'bigwin-end': 800,
  'bonus-trigger': 1500,
  'bonus-start': 1000,
  'bonus-spin': 200,
  'bonus-end': 1000,
  'buy': 300
}

/** Most voices of one event at once; the oldest is stolen past this. */
export const CANDY_SOUND_VOICE_CAPS: Partial<Record<CandySoundEvent, number>> = {
  'drop': 4,
  'spot': 4,
  'spot-up': 4,
  'tick': 2,
  'pop': 3
}

export const CANDY_SOUND_DEFAULT_VOICE_CAP = 2
export const CANDY_SOUND_MAX_VOICES = 32

/** Pitch jitter (±) per event; melodic cues stay in tune. */
export const CANDY_SYNTH_JITTER: Partial<Record<CandySoundEvent, number>> = {
  'drop': 0.05,
  'click': 0.04,
  'tumble': 0.06,
  'spin': 0.03
}
