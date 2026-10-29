/*
 * RIFTBORN's procedural soundtrack: a 16th-note step sequencer driven by a
 * lookahead clock. Each mode is a "song" with its own fade bus so modes
 * crossfade; intensity layers in hats, arps and a lead on top.
 */
import { hz } from './audio-kit'
import type { Kit } from './audio-kit'
import type { MusicMode } from './types'

/** What a song's step() gets to play with */
export interface Stage {
    kit: Kit
    /** Dry, reverb and echo inputs of this song's fade bus */
    dry: AudioNode
    wet: AudioNode
    echo: AudioNode
    /** 0..1, smoothed */
    intensity: number
    /** Seconds per 16th (a song may change it to shift tempo) */
    step: number
    /** Seconds since the run started (boss fights included), 0 outside a run */
    age: number
}

interface Song {
    bpm: number
    /** Steps per loop (16 per bar) */
    length: number
    loop: boolean
    play(s: Stage, step: number, t: number): void
}

// ─── Instruments ─────────────────────────────────────────────────────────

function kick(s: Stage, t: number, gain = 0.9): void {
    s.kit.tone({ out: s.dry, t, dur: 0.32, f: 160, f2: 42, sweep: 0.11, gain })
    s.kit.noise({ out: s.dry, t, dur: 0.02, gain: gain * 0.25, filter: { type: 'highpass', f: 3000 } })
}

function snare(s: Stage, t: number, gain = 0.45): void {
    s.kit.noise({ out: s.dry, t, dur: 0.2, gain, filter: { type: 'bandpass', f: 1900, q: 0.7 } })
    s.kit.noise({ out: s.wet, t, dur: 0.25, gain: gain * 0.4, filter: { type: 'highpass', f: 1200 } })
    s.kit.tone({ out: s.dry, t, dur: 0.1, f: 210, f2: 160, gain: gain * 0.6, type: 'triangle' })
}

function clap(s: Stage, t: number, gain = 0.35): void {
    for (let i = 0; i < 3; i++) s.kit.noise({ out: i === 2 ? s.wet : s.dry, t: t + i * 0.012, dur: 0.09 + i * 0.05, gain, filter: { type: 'bandpass', f: 1400, q: 1.2 } })
}

function hat(s: Stage, t: number, open: boolean, gain = 0.12): void {
    s.kit.noise({ out: s.dry, t, dur: open ? 0.2 : 0.045, gain, filter: { type: 'highpass', f: 7500, q: 0.8 } })
}

function tom(s: Stage, t: number, f: number, gain = 0.5): void {
    s.kit.tone({ out: s.dry, t, dur: 0.28, f, f2: f * 0.55, gain })
    s.kit.noise({ out: s.dry, t, dur: 0.05, gain: gain * 0.2, filter: { type: 'lowpass', f: 2500 } })
}

function crash(s: Stage, t: number, gain = 0.18): void {
    s.kit.noise({ out: s.wet, t, dur: 1.6, gain, filter: { type: 'highpass', f: 5000, f2: 3000 } })
    s.kit.noise({ out: s.dry, t, dur: 0.9, gain: gain * 0.7, filter: { type: 'highpass', f: 6000 } })
}

function bass(s: Stage, t: number, midi: number, dur: number, gain = 0.22, drive = false): void {
    const f = hz(midi)
    const cut = 280 + s.intensity * 1100 + (drive ? 500 : 0)
    s.kit.tone({ out: s.dry, t, dur, f, gain, type: 'sawtooth', filter: { type: 'lowpass', f: cut * 3, f2: cut, q: 4 }, drive })
    s.kit.tone({ out: s.dry, t, dur, f: f / 2, gain: gain * 0.7, type: 'square', detune: 6, filter: { type: 'lowpass', f: cut, q: 1 } })
}

function pad(s: Stage, t: number, notes: number[], dur: number, gain = 0.05, bright = 0.5): void {
    const cut = 500 + bright * 2200 + s.intensity * 800
    for (const n of notes) {
        for (const d of [-9, 9]) {
            s.kit.tone({ out: s.wet, t, dur, f: hz(n), gain, type: 'sawtooth', detune: d, attack: dur * 0.3, hold: dur * 0.4, filter: { type: 'lowpass', f: cut, q: 0.7 } })
        }
        s.kit.tone({ out: s.dry, t, dur, f: hz(n), gain: gain * 0.8, type: 'triangle', attack: dur * 0.3, hold: dur * 0.4 })
    }
}

function choir(s: Stage, t: number, notes: number[], dur: number, gain = 0.035): void {
    for (const n of notes) {
        for (const d of [-12, 0, 12]) {
            s.kit.tone({ out: s.wet, t, dur, f: hz(n), gain, type: 'sawtooth', detune: d, attack: dur * 0.25, hold: dur * 0.5, filter: { type: 'bandpass', f: 900, q: 2.5 }, vibrato: { rate: 5, depth: 12 } })
        }
    }
}

function pluck(s: Stage, t: number, midi: number, gain = 0.07, type: OscillatorType = 'square'): void {
    const cut = 1200 + s.intensity * 3000
    s.kit.tone({ out: s.dry, t, dur: 0.16, f: hz(midi), gain, type, filter: { type: 'lowpass', f: cut, f2: cut * 0.3, q: 3 } })
    s.kit.tone({ out: s.echo, t, dur: 0.16, f: hz(midi), gain: gain * 0.6, type, filter: { type: 'lowpass', f: cut * 0.8, q: 1 } })
}

function lead(s: Stage, t: number, midi: number, dur: number, gain = 0.06): void {
    const f = hz(midi)
    for (const d of [-7, 7]) {
        s.kit.tone({ out: s.dry, t, dur, f, gain, type: 'sawtooth', detune: d, attack: 0.02, hold: dur * 0.6, filter: { type: 'lowpass', f: 2600, q: 2 }, vibrato: { rate: 5.5, depth: 14 } })
    }
    s.kit.tone({ out: s.echo, t, dur, f, gain: gain * 0.8, type: 'square', attack: 0.02, hold: dur * 0.5, filter: { type: 'lowpass', f: 2000 } })
    s.kit.tone({ out: s.wet, t, dur, f: f * 2, gain: gain * 0.25, type: 'sine', attack: 0.03, hold: dur * 0.5 })
}

function brass(s: Stage, t: number, notes: number[], dur: number, gain = 0.06): void {
    for (const n of notes) {
        for (const d of [-6, 6]) {
            s.kit.tone({ out: s.dry, t, dur, f: hz(n), gain, type: 'sawtooth', detune: d, attack: 0.015, hold: dur * 0.3, filter: { type: 'lowpass', f: 3200, f2: 700, q: 2 }, drive: false })
        }
    }
    for (const n of notes) s.kit.tone({ out: s.wet, t, dur, f: hz(n), gain: gain * 0.5, type: 'sawtooth', attack: 0.015, filter: { type: 'lowpass', f: 1500 } })
}

function bell(s: Stage, t: number, midi: number, gain = 0.06, dur = 1.4): void {
    s.kit.bell(s.wet, t, hz(midi), dur, gain, 3.01, 1.2)
    s.kit.bell(s.echo, t, hz(midi), dur * 0.5, gain * 0.5, 3.01, 0.8)
}

function sub(s: Stage, t: number, midi: number, dur: number, gain = 0.25): void {
    s.kit.tone({ out: s.dry, t, dur, f: hz(midi), gain, attack: 0.08, hold: dur * 0.6 })
}

// ─── Songs ───────────────────────────────────────────────────────────────

type Note = [step: number, midi: number, len: number]

// RUN: dark synthwave that evolves over the 15 minutes. Sections change on
// 8-bar boundaries by run age; intensity (horde size) layers in hats, arps,
// counter-melodies and the lead inside each section.

interface Section {
    name: string
    /** Run age in seconds the section starts at */
    from: number
    bpm: number
    roots: number[]
    pads: number[][]
    arps: number[][]
    lead: Note[][]
}

const ARP_ORDER = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2]
const ARP_RUSH = [0, 2, 1, 3, 2, 3, 1, 2, 3, 2, 0, 2, 1, 3, 2, 3]

const LEAD_A: Note[][] = [
    [[0, 76, 4], [4, 74, 2], [6, 72, 2], [8, 74, 6], [14, 72, 2]],
    [[0, 69, 6], [8, 72, 4], [12, 74, 4]],
    [[0, 76, 4], [4, 79, 4], [8, 76, 2], [10, 74, 2], [12, 72, 4]],
    [[0, 74, 8], [8, 71, 4], [12, 74, 4]],
    [[0, 81, 4], [4, 79, 2], [6, 76, 2], [8, 79, 6], [14, 76, 2]],
    [[0, 77, 6], [8, 76, 4], [12, 72, 4]],
    [[0, 72, 4], [4, 74, 4], [8, 76, 4], [12, 79, 4]],
    [[0, 74, 8], [8, 71, 8]]
]

const LEAD_B: Note[][] = [
    [[0, 76, 3], [3, 77, 1], [4, 76, 2], [6, 72, 2], [8, 69, 4], [12, 72, 4]],
    [[0, 74, 6], [6, 77, 2], [8, 81, 4], [12, 77, 4]],
    [[0, 77, 2], [2, 76, 2], [4, 77, 2], [6, 79, 2], [8, 81, 6], [14, 79, 2]],
    [[0, 80, 4], [4, 76, 4], [8, 71, 4], [12, 68, 4]],
    [[0, 81, 4], [4, 79, 2], [6, 77, 2], [8, 76, 8]],
    [[0, 77, 4], [4, 74, 4], [8, 77, 2], [10, 81, 2], [12, 86, 4]],
    [[0, 84, 4], [4, 81, 4], [8, 77, 4], [12, 81, 4]],
    [[0, 80, 8], [8, 83, 4], [12, 88, 4]]
]

const LEAD_C: Note[][] = [
    [[0, 78, 4], [4, 81, 2], [6, 83, 2], [8, 78, 6], [14, 76, 2]],
    [[0, 79, 6], [8, 83, 4], [12, 86, 4]],
    [[0, 85, 2], [2, 86, 2], [4, 85, 4], [8, 81, 4], [12, 78, 4]],
    [[0, 76, 8], [8, 81, 4], [12, 85, 4]],
    [[0, 86, 4], [4, 85, 2], [6, 83, 2], [8, 81, 6], [14, 83, 2]],
    [[0, 79, 4], [4, 83, 4], [8, 86, 4], [12, 91, 4]],
    [[0, 90, 4], [4, 86, 4], [8, 81, 4], [12, 78, 4]],
    [[0, 81, 8], [8, 85, 8]]
]

const LEAD_D: Note[][] = [
    [[0, 72, 8], [8, 75, 4], [12, 79, 4]],
    [[0, 77, 8], [8, 73, 8]],
    [[0, 72, 4], [4, 75, 4], [8, 79, 4], [12, 84, 4]],
    [[0, 82, 8], [8, 77, 8]]
]

const SECTIONS: Section[] = [
    {
        name: 'intro', from: 0, bpm: 112,
        roots: [45, 41, 48, 43],
        pads: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
        arps: [[69, 72, 76, 81], [65, 69, 72, 77], [67, 72, 76, 79], [67, 71, 74, 79]],
        lead: LEAD_A
    },
    {
        name: 'a', from: 20, bpm: 116,
        roots: [45, 41, 48, 43],
        pads: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
        arps: [[69, 72, 76, 81], [65, 69, 72, 77], [67, 72, 76, 79], [67, 71, 74, 79]],
        lead: LEAD_A
    },
    {
        name: 'b', from: 170, bpm: 118,
        roots: [45, 50, 41, 40],
        pads: [[57, 60, 64], [57, 62, 65], [57, 60, 65], [56, 59, 64]],
        arps: [[69, 72, 76, 81], [69, 74, 77, 81], [69, 72, 77, 81], [68, 71, 76, 80]],
        lead: LEAD_B
    },
    {
        name: 'c', from: 340, bpm: 122,
        roots: [47, 43, 50, 45],
        pads: [[59, 62, 66], [59, 62, 67], [57, 62, 66], [57, 61, 64]],
        arps: [[71, 74, 78, 83], [71, 74, 79, 83], [69, 74, 78, 81], [69, 73, 76, 81]],
        lead: LEAD_C
    },
    {
        name: 'd', from: 520, bpm: 124,
        roots: [48, 49, 48, 46],
        pads: [[60, 63, 67], [61, 65, 68], [60, 63, 67], [58, 62, 65]],
        arps: [[72, 75, 79, 84], [73, 77, 80, 85], [72, 75, 79, 84], [70, 74, 77, 82]],
        lead: LEAD_D
    },
    {
        name: 'e', from: 700, bpm: 128,
        roots: [45, 41, 48, 43],
        pads: [[57, 60, 64, 69], [53, 57, 60, 65], [55, 60, 64, 67], [55, 59, 62, 67]],
        arps: [[69, 72, 76, 81], [65, 69, 72, 77], [67, 72, 76, 79], [67, 71, 74, 79]],
        lead: LEAD_A
    }
]

function sectionFor(age: number): number {
    let i = 0
    while (i + 1 < SECTIONS.length && age >= SECTIONS[i + 1]!.from) i++
    return i
}

function riser(s: Stage, t: number, dur: number, gain = 0.06): void {
    s.kit.noise({ out: s.wet, t, dur, gain, attack: dur * 0.9, filter: { type: 'bandpass', f: 400, f2: 6000, q: 1.2 } })
    s.kit.tone({ out: s.dry, t, dur, f: 110, f2: 440, gain: gain * 0.5, type: 'sawtooth', attack: dur * 0.9, filter: { type: 'lowpass', f: 500, f2: 4000 } })
}

function createRun(): Song {
    let sec = 0
    let barsIn = 0
    return {
        bpm: 112,
        length: 16 * 64,
        loop: true,
        play(s, step, t) {
            const bar = Math.floor(step / 16)
            const st = step % 16
            if (st === 0) {
                // change section only on 8-bar phrases
                const want = sectionFor(s.age)
                if (bar % 8 === 0 && want !== sec) {
                    sec = want
                    barsIn = 0
                    crash(s, t, 0.16)
                    s.step = 60 / SECTIONS[sec]!.bpm / 4
                } else if (bar > 0) {
                    barsIn++
                }
                if (bar === 0) s.step = 60 / SECTIONS[sec]!.bpm / 4
            }
            const S = SECTIONS[sec]!
            const ch = bar % 4
            const I = s.intensity
            const root = S.roots[ch]!
            const name = S.name
            const nextChanges = bar % 8 === 7 && sectionFor(s.age) !== sec

            // harmony
            if (st === 0) {
                if (name === 'd') choir(s, t, S.pads[ch]!, s.step * 16, 0.03)
                else pad(s, t, S.pads[ch]!, s.step * 16, name === 'intro' ? 0.045 : 0.04, name === 'e' ? 0.6 : 0.3)
                if (name === 'intro' || name === 'd') sub(s, t, root - 12, s.step * 15, 0.16)
                if (bar % 8 === 0 && I > 0.3 && barsIn > 0) crash(s, t, 0.12)
            }
            if (name === 'e' && (st === 0 || st === 6 || st === 10) && bar % 2 === 0) brass(s, t, S.pads[ch]!, s.step * (st === 10 ? 4 : 2), 0.035)
            if (nextChanges && st === 0) riser(s, t, s.step * 16, 0.05)

            // bass
            if (name === 'intro') {
                if (st % 4 === 0) bass(s, t, root, s.step * 3, 0.16)
            } else if (name === 'b') {
                const pat = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1]
                if (pat[st]) bass(s, t, st % 8 === 6 ? root + 12 : root, s.step * 0.9, st % 4 === 0 ? 0.2 : 0.14)
            } else if (name === 'c') {
                if (st % 2 === 1) bass(s, t, st % 8 === 7 ? root + 12 : root, s.step * 1.4, 0.18)
            } else if (name === 'd') {
                if (GALLOP[st]) bass(s, t, root + (st === 14 ? 12 : 0), s.step * 0.85, 0.16, true)
            } else {
                bass(s, t, st % 4 === 2 ? root + 12 : root, s.step * 0.9, st % 4 === 0 ? 0.2 : 0.14, name === 'e' && I > 0.6)
            }

            // drums
            if (name === 'intro') {
                if (st === 0 || (st === 8 && barsIn >= 2)) kick(s, t, 0.7)
                if (barsIn >= 4 && st % 2 === 0) hat(s, t, false, 0.05)
                if (bar % 8 === 7 && st >= 8 && st % 2 === 0) snare(s, t, 0.1 + (st - 8) * 0.03)
            } else if (name === 'd') {
                if (st === 0 || st === 10 || (I > 0.6 && st === 3)) kick(s, t, 0.9)
                if (st === 8) {
                    snare(s, t, 0.42)
                    clap(s, t, 0.2)
                }
                if (st % 4 === 2) hat(s, t, true, 0.06)
                if (bar % 4 === 3 && st >= 12) tom(s, t, [200, 170, 140, 110][st - 12]!, 0.4)
            } else {
                const four = name === 'c' || name === 'e'
                if (st % 4 === 0) kick(s, t, 0.85)
                if (name === 'b' && st === 14) kick(s, t, 0.55)
                if (name === 'e' && I > 0.7 && (st === 7 || st === 15)) kick(s, t, 0.5)
                if (st === 4 || st === 12) {
                    snare(s, t, four ? 0.36 : 0.32)
                    clap(s, t, four ? 0.22 : 0.18)
                }
                if (bar % 8 === 7 && st >= 12) snare(s, t, 0.14 + (st - 12) * 0.06)
                if (four) {
                    if (st % 4 === 2) hat(s, t, true, 0.07)
                    else if (I > 0.35 || name === 'e') hat(s, t, false, st % 2 === 0 ? 0.06 : 0.035)
                } else if (I > 0.18) {
                    if (st % 2 === 0) hat(s, t, I > 0.5 && st % 4 === 2, 0.08)
                    else if (I > 0.45) hat(s, t, false, 0.045)
                }
            }

            // arps and counter-melodies
            const arp = S.arps[ch]!
            if (name === 'c' || name === 'e') {
                pluck(s, t, arp[ARP_RUSH[st]!]!, 0.03 + I * 0.03)
            } else if (name !== 'intro' && I > 0.32) {
                pluck(s, t, arp[ARP_ORDER[st]!]!, 0.032 + (I - 0.32) * 0.05)
            } else if (name === 'intro' && barsIn >= 2 && st % 4 === 0) {
                bell(s, t, arp[(st / 4) % 4]! + 12, 0.035, 1.2)
            }
            if (name === 'b' && st % 8 === 4 && I > 0.25) bell(s, t, arp[(bar + st / 8) % 4]! + 12, 0.03, 1)
            if (name === 'd' && st % 4 === 0 && I > 0.4) pluck(s, t, arp[(st / 4 + bar) % 4]! + 12, 0.03, 'sawtooth')

            // lead: needs a hot fight, except in the finale where it always sings
            const leadOn = name === 'e' ? true : name === 'intro' ? false : I > (name === 'a' ? 0.62 : 0.5)
            if (leadOn) {
                const phrase = S.lead[bar % S.lead.length]!
                for (const [ns, n, len] of phrase) {
                    if (ns !== st) continue
                    lead(s, t, n, s.step * len, 0.045)
                    if (name === 'e' || (name === 'c' && I > 0.75)) lead(s, t, n - 5, s.step * len, 0.022)
                }
            }
        }
    }
}

// BOSS: E harmonic minor, heavier and faster. 16 bars: riff, main, a
// half-time breakdown and a double-time climb back in.
const BOSS_ROOTS = [40, 36, 38, 35]
const BOSS_CH = [[52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 51, 54]]
const BOSS_ARP = [[64, 67, 71, 76], [60, 64, 67, 72], [62, 66, 69, 74], [59, 63, 66, 71]]
const GALLOP = [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1]
const BOSS_LEAD: Note[][] = [
    [[0, 76, 2], [2, 79, 2], [4, 83, 4], [8, 81, 2], [10, 79, 2], [12, 78, 4]],
    [[0, 76, 6], [6, 79, 2], [8, 84, 8]],
    [[0, 81, 4], [4, 78, 4], [8, 74, 4], [12, 78, 4]],
    [[0, 75, 8], [8, 78, 4], [12, 81, 4]]
]
const BOSS_LEAD_HI: Note[][] = [
    [[0, 88, 2], [2, 86, 2], [4, 84, 2], [6, 83, 2], [8, 84, 4], [12, 88, 4]],
    [[0, 91, 4], [4, 88, 4], [8, 84, 8]],
    [[0, 86, 2], [2, 90, 2], [4, 93, 4], [8, 90, 4], [12, 86, 4]],
    [[0, 87, 4], [4, 90, 4], [8, 93, 4], [12, 95, 4]]
]

const BOSS: Song = {
    bpm: 146,
    length: 16 * 16,
    loop: true,
    play(s, step, t) {
        const bar = Math.floor(step / 16)
        const st = step % 16
        const ch = bar % 4
        const part = bar < 4 ? 'riff' : bar < 8 ? 'main' : bar < 12 ? 'break' : 'climb'
        const I = Math.max(0.5, s.intensity)
        if (st === 0) {
            choir(s, t, BOSS_CH[ch]!.map(n => n + 12), s.step * 16, part === 'break' ? 0.04 : 0.025)
            if (ch === 0) crash(s, t, 0.16)
            if (part === 'break') sub(s, t, BOSS_ROOTS[ch]! - 12, s.step * 16, 0.22)
        }
        if (bar === 11 && st === 0) riser(s, t, s.step * 16, 0.07)
        // bass
        if (part === 'break') {
            if (st === 0 || st === 8) bass(s, t, BOSS_ROOTS[ch]!, s.step * 6, 0.18, true)
        } else if (GALLOP[st]) {
            bass(s, t, BOSS_ROOTS[ch]! + (st === 14 ? 12 : 0), s.step * 0.85, 0.17, true)
        }
        if (part !== 'break' && (st === 0 || st === 3 || st === 6 || st === 10)) brass(s, t, BOSS_CH[ch]!, s.step * (st === 10 ? 4 : 2), part === 'climb' ? 0.05 : 0.04)
        // drums
        if (part === 'break') {
            if (st === 0 || st === 10) kick(s, t, 0.95)
            if (st === 8) {
                snare(s, t, 0.45)
                clap(s, t, 0.22)
            }
            if (st % 4 === 2) hat(s, t, true, 0.05)
            if (ch === 3 && st >= 8) tom(s, t, [240, 220, 200, 180, 160, 140, 120, 100][st - 8]!, 0.35)
        } else {
            if (st % 4 === 0) kick(s, t, 0.9)
            if (I > 0.6 && (st === 7 || st === 14)) kick(s, t, 0.6)
            if (part === 'climb' && st % 2 === 0) kick(s, t, 0.45)
            if (ch === 3 && st >= 8 && st % 2 === 0) kick(s, t, 0.55)
            if (st === 4 || st === 12) {
                snare(s, t, 0.4)
                clap(s, t, 0.2)
            }
            if (ch === 3 && st >= 12) tom(s, t, [220, 180, 150, 120][st - 12]!, 0.4)
            hat(s, t, st % 4 === 2, st % 2 === 0 ? 0.09 : 0.05)
        }
        // arp and leads
        if (part !== 'riff' || st % 2 === 0) pluck(s, t, BOSS_ARP[ch]![ARP_ORDER[st]!]! + 12, 0.03, 'sawtooth')
        if (part === 'main' || (part === 'climb' && s.intensity > 0.4)) {
            for (const [ns, n, len] of BOSS_LEAD[ch]!) if (ns === st) lead(s, t, n, s.step * len, 0.05)
        }
        if (part === 'climb') {
            for (const [ns, n, len] of BOSS_LEAD_HI[ch]!) if (ns === st) lead(s, t, n, s.step * len, 0.03)
        }
        if (part === 'break' && st % 4 === 0) bell(s, t, BOSS_ARP[ch]![(st / 4) % 4]! + 12, 0.04, 1.6)
    }
}

// LOBBY: calm and mysterious, A minor colours with long bells
const LOBBY_CH = [[57, 60, 64, 67, 71], [53, 57, 60, 64], [50, 53, 57, 60, 64], [52, 55, 59, 62]]
const LOBBY_ROOTS = [45, 41, 38, 40]
const LOBBY_BELLS = [[0, -1, 2, 1, -1, 3, -1, 2], [1, -1, -1, 3, 2, -1, 0, -1], [0, 2, -1, 1, -1, -1, 3, -1], [2, -1, 1, -1, 3, -1, -1, 0]]

const LOBBY: Song = {
    bpm: 72,
    length: 16 * 4,
    loop: true,
    play(s, step, t) {
        const bar = Math.floor(step / 16)
        const st = step % 16
        const chord = LOBBY_CH[bar]!
        if (st === 0) {
            pad(s, t, chord, s.step * 17, 0.03, 0.15)
            sub(s, t, LOBBY_ROOTS[bar]!, s.step * 15, 0.18)
        }
        if (st % 2 === 0) {
            const idx = LOBBY_BELLS[bar]![st / 2]!
            if (idx >= 0) bell(s, t, chord[idx % chord.length]! + 12, 0.04, 2)
        }
        if (st === 8 && bar % 2 === 1) s.kit.noise({ out: s.wet, t, dur: s.step * 8, gain: 0.025, attack: s.step * 4, filter: { type: 'bandpass', f: 600, f2: 2400, q: 1.5 } })
        if (st === 0 || st === 10) kick(s, t, 0.18)
    }
}

const VICTORY: Song = {
    bpm: 132,
    length: 32,
    loop: false,
    play(s, step, t) {
        const arp = [67, 72, 76, 79]
        if (step < 8 && step % 2 === 0) brass(s, t, [arp[step / 2]!], s.step * 2.2, 0.07)
        if (step >= 4 && step < 8) snare(s, t, 0.12 + (step - 4) * 0.05)
        if (step === 8) {
            brass(s, t, [60, 64, 67, 72, 76], s.step * 14, 0.05)
            pad(s, t, [60, 64, 67, 72], s.step * 20, 0.04, 0.8)
            kick(s, t, 1)
            crash(s, t, 0.25)
            sub(s, t, 36, s.step * 16, 0.3)
        }
        if (step > 8 && step < 24 && step % 2 === 0) bell(s, t, [84, 88, 91, 96][(step / 2) % 4]!, 0.05, 1.6)
    }
}

const DEFEAT: Song = {
    bpm: 70,
    length: 24,
    loop: false,
    play(s, step, t) {
        if (step === 0) {
            pad(s, t, [50, 53, 57], s.step * 22, 0.045, 0.1)
            sub(s, t, 38, s.step * 20, 0.3)
            kick(s, t, 0.7)
            s.kit.noise({ out: s.wet, t, dur: 2.5, gain: 0.12, filter: { type: 'lowpass', f: 900, f2: 120 } })
        }
        const mel: Note[] = [[0, 69, 4], [4, 65, 4], [8, 62, 4], [12, 61, 2], [14, 62, 10]]
        for (const [ns, n, len] of mel) if (ns === step) s.kit.tone({ out: s.wet, t, dur: s.step * len * 1.2, f: hz(n), gain: 0.09, type: 'triangle', attack: 0.03, hold: s.step * len * 0.5, vibrato: { rate: 4.5, depth: 18 } })
    }
}

const SONGS: Partial<Record<MusicMode, () => Song>> = {
    run: createRun,
    boss: () => BOSS,
    lobby: () => LOBBY,
    victory: () => VICTORY,
    defeat: () => DEFEAT
}

// ─── Sequencer ───────────────────────────────────────────────────────────

interface Playing {
    song: Song
    stage: Stage
    buses: GainNode[]
    step: number
    next: number
    /** Scheduling stops after this time (fading out) */
    stopAt: number
}

export class Music {
    private playing: Playing[] = []
    private timer: ReturnType<typeof setInterval> | null = null
    private target = 0
    private intensity = 0
    /** AudioContext time the current run started, -1 outside a run */
    private runStart = -1
    mode: MusicMode = 'off'

    constructor(private kit: Kit, private out: AudioNode, private reverb: AudioNode, private delay: AudioNode) {}

    setIntensity(v: number): void {
        this.target = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
    }

    play(mode: MusicMode): void {
        if (mode === this.mode) return
        const ctx = this.kit.ctx
        const now = ctx.currentTime
        if (mode === 'run' && this.mode !== 'boss') this.runStart = now
        else if (mode !== 'run' && mode !== 'boss') this.runStart = -1
        this.mode = mode
        const fade = mode === 'boss' || mode === 'victory' || mode === 'defeat' ? 0.6 : 1.6
        for (const p of this.playing) {
            if (p.stopAt <= now) continue
            p.stopAt = now + fade
            for (const b of p.buses) {
                b.gain.cancelScheduledValues(now)
                b.gain.setValueAtTime(b.gain.value, now)
                b.gain.linearRampToValueAtTime(0, now + fade)
            }
        }
        const song = SONGS[mode]?.()
        if (song) {
            const mk = (dest: AudioNode, level: number) => {
                const g = ctx.createGain()
                g.gain.setValueAtTime(0, now)
                g.gain.linearRampToValueAtTime(level, now + (song.loop ? Math.min(fade, 1.2) : 0.05))
                g.connect(dest)
                return g
            }
            const dry = mk(this.out, 1)
            const wet = mk(this.reverb, 1)
            const echo = mk(this.delay, 1)
            const stage: Stage = { kit: this.kit, dry, wet, echo, intensity: this.intensity, step: 60 / song.bpm / 4, age: this.age(now) }
            this.playing.push({ song, stage, buses: [dry, wet, echo], step: 0, next: now + 0.08, stopAt: Infinity })
        }
        this.ensureTimer()
    }

    private ensureTimer(): void {
        if (this.timer) return
        this.timer = setInterval(() => this.tick(), 25)
    }

    private tick(): void {
        const ctx = this.kit.ctx
        if (ctx.state !== 'running') return
        const now = ctx.currentTime
        this.intensity += (this.target - this.intensity) * 0.04
        const ahead = now + 0.14
        for (const p of this.playing) {
            p.stage.intensity = this.intensity
            p.stage.age = this.age(now)
            // after a stall (tab hidden), skip ahead instead of bursting notes
            if (p.next < now - 0.25) p.next = now + 0.02
            while (p.next < ahead && p.next < p.stopAt) {
                if (!p.song.loop && p.step >= p.song.length) {
                    p.stopAt = p.next
                    break
                }
                try {
                    p.song.play(p.stage, p.step % p.song.length, p.next)
                } catch {
                    // never let a bad note stop the clock
                }
                p.step++
                p.next += p.stage.step
            }
        }
        const done = this.playing.filter(p => p.stopAt + 3 < now)
        for (const p of done) for (const b of p.buses) b.disconnect()
        this.playing = this.playing.filter(p => !done.includes(p))
    }

    private age(now: number): number {
        return this.runStart < 0 ? 0 : now - this.runStart
    }

    destroy(): void {
        if (this.timer) clearInterval(this.timer)
        this.timer = null
        for (const p of this.playing) for (const b of p.buses) b.disconnect()
        this.playing = []
    }
}
