/*
 * Extra RIFTBORN sound effects: spells, ability and slot unlocks, and elite
 * affix cues. Same voice contract as audio.ts: each voice schedules its notes
 * from time `t` into `out`, scales every frequency by the pitch factor `p`,
 * and returns its length in seconds.
 */
import { hz } from './audio-kit'
import type { Kit } from './audio-kit'
import type { SfxName } from './types'

export type Voice = (k: Kit, out: AudioNode, t: number, p: number) => number

export interface Rule {
    /** Overlapping voices allowed */
    max: number
    /** Minimum seconds between two starts */
    gap: number
    /** Random detune, fraction of the pitch */
    jitter: number
    volume: number
    /** Reverb send */
    wet?: number
    /** Dropped first when the mix is crowded */
    spam?: boolean
}

export const EXTRA_RULES: Partial<Record<SfxName, Rule>> = {
    cast: { max: 3, gap: 0.06, jitter: 0.03, volume: 0.45, wet: 0.25, spam: true },
    castHeavy: { max: 2, gap: 0.2, jitter: 0.03, volume: 0.6, wet: 0.2 },
    blink: { max: 2, gap: 0.12, jitter: 0.04, volume: 0.45, wet: 0.2 },
    shield: { max: 2, gap: 0.3, jitter: 0, volume: 0.5, wet: 0.35 },
    shieldBreak: { max: 1, gap: 0.4, jitter: 0.02, volume: 0.7, wet: 0.4 },
    nova: { max: 1, gap: 0.4, jitter: 0.02, volume: 0.75, wet: 0.3 },
    timeSlow: { max: 1, gap: 1, jitter: 0, volume: 0.6, wet: 0.4 },
    gravity: { max: 1, gap: 0.8, jitter: 0.02, volume: 0.7, wet: 0.2 },
    beam: { max: 2, gap: 0.3, jitter: 0.03, volume: 0.45, wet: 0.1 },
    quake: { max: 1, gap: 0.6, jitter: 0.03, volume: 0.8, wet: 0.2 },
    turret: { max: 2, gap: 0.25, jitter: 0.02, volume: 0.5, wet: 0.1 },
    abilityReady: { max: 2, gap: 0.15, jitter: 0, volume: 0.35, wet: 0.1, spam: true },
    abilityUnlock: { max: 1, gap: 1, jitter: 0, volume: 0.75, wet: 0.4 },
    slotUnlock: { max: 1, gap: 1, jitter: 0, volume: 0.7, wet: 0.3 },
    affixShield: { max: 3, gap: 0.06, jitter: 0.06, volume: 0.4, spam: true },
    affixVamp: { max: 2, gap: 0.2, jitter: 0.04, volume: 0.45, spam: true },
    affixSplit: { max: 2, gap: 0.15, jitter: 0.06, volume: 0.5 },
    affixHaste: { max: 2, gap: 0.2, jitter: 0.04, volume: 0.4, spam: true },
    affixBlast: { max: 1, gap: 0.5, jitter: 0.02, volume: 0.6 }
}

export const EXTRA_SOUNDS: Partial<Record<SfxName, Voice>> = {
    cast(k, out, t, p) {
        k.noise({ out, t, dur: 0.28, gain: 0.35, attack: 0.05, filter: { type: 'bandpass', f: 800 * p, f2: 5000 * p, q: 1.2 } })
        k.tone({ out, t, dur: 0.25, f: 900 * p, f2: 2400 * p, gain: 0.12, type: 'triangle' })
        k.bell(out, t + 0.18, 2637 * p, 0.12, 0.2, 3.5, 1)
        return 0.3
    },
    castHeavy(k, out, t, p) {
        k.tone({ out, t, dur: 0.35, f: 110 * p, f2: 45 * p, gain: 0.6 })
        k.tone({ out, t, dur: 0.5, f: 80 * p, f2: 220 * p, gain: 0.2, type: 'sawtooth', filter: { type: 'lowpass', f: 400, f2: 1400, q: 1.2 } })
        k.noise({ out, t, dur: 0.12, gain: 0.4, filter: { type: 'bandpass', f: 600 * p, q: 1 } })
        return 0.6
    },
    blink(k, out, t, p) {
        k.tone({ out, t, dur: 0.12, f: 200 * p, f2: 2400 * p, sweep: 0.1, gain: 0.4 })
        k.noise({ out, t, dur: 0.08, gain: 0.12, attack: 0.005, filter: { type: 'highpass', f: 3000 } })
        k.bell(out, t + 0.12, 2349 * p, 0.12, 0.18, 4, 1.5)
        return 0.25
    },
    shield(k, out, t, p) {
        for (const n of [60, 64, 67]) {
            k.tone({ out, t, dur: 0.7, f: hz(n) * p, gain: 0.14, type: 'triangle', attack: 0.22, hold: 0.1, filter: { type: 'lowpass', f: 1200, f2: 2400 } })
        }
        k.bell(out, t + 0.2, hz(84) * p, 0.5, 0.15, 5.4, 2)
        k.bell(out, t + 0.3, hz(91) * p, 0.45, 0.12, 5.4, 2)
        return 0.7
    },
    shieldBreak(k, out, t, p) {
        k.noise({ out, t, dur: 0.25, gain: 0.5, filter: { type: 'highpass', f: 4000 } })
        k.noise({ out, t: t + 0.02, dur: 0.14, gain: 0.4, attack: 0.001, filter: { type: 'highpass', f: 7000 } })
        k.noise({ out, t: t + 0.09, dur: 0.2, gain: 0.3, filter: { type: 'bandpass', f: 5000, q: 0.8 } })
        for (let i = 0; i < 5; i++) {
            const n = 84 + Math.floor(Math.random() * 12)
            k.bell(out, t + 0.02 + i * 0.05 + Math.random() * 0.02, hz(n) * p, 0.3, 0.1, 3.5, 1)
        }
        k.tone({ out, t, dur: 0.3, f: 110 * p, f2: 40 * p, gain: 0.6 })
        return 0.6
    },
    nova(k, out, t, p) {
        k.tone({ out, t, dur: 0.8, f: 110 * p, f2: 30 * p, attack: 0.005, gain: 0.6 })
        k.noise({ out, t, dur: 0.7, gain: 0.4, attack: 0.02, filter: { type: 'bandpass', f: 6000 * p, f2: 300 * p, q: 0.7 } })
        k.bell(out, t + 0.04, hz(91) * p, 0.6, 0.18, 3.5, 1.5)
        k.bell(out, t + 0.04, hz(98) * p, 0.5, 0.1, 3.5, 1)
        return 0.8
    },
    timeSlow(k, out, t, p) {
        k.tone({ out, t, dur: 1.2, f: 660 * p, f2: 180 * p, sweep: 1.1, gain: 0.35, type: 'triangle', attack: 0.05, hold: 0.2, vibrato: { rate: 5, depth: 25 } })
        k.noise({ out, t, dur: 0.7, gain: 0.25, attack: 0.5, filter: { type: 'bandpass', f: 300, f2: 1500, q: 1 } })
        for (let i = 0; i < 6; i++) {
            const tick = t + 0.1 + i * 0.18
            k.noise({ out, t: tick, dur: 0.015, gain: 0.22, filter: { type: 'highpass', f: 4000 } })
            k.tone({ out, t: tick, dur: 0.02, f: 1800 * p, gain: 0.1, type: 'square', filter: { type: 'lowpass', f: 3000 } })
        }
        return 1.2
    },
    gravity(k, out, t, p) {
        k.tone({ out, t, dur: 1, f: 90 * p, f2: 45 * p, gain: 0.55, attack: 0.1, hold: 0.3, vibrato: { rate: 9, depth: 60 } })
        k.tone({ out, t, dur: 1, f: 180 * p, f2: 90 * p, gain: 0.2, type: 'triangle', attack: 0.1, hold: 0.3, vibrato: { rate: 4, depth: 30 } })
        k.noise({ out, t, dur: 1, gain: 0.45, attack: 0.15, hold: 0.2, filter: { type: 'lowpass', f: 900, f2: 200, q: 1.2 } })
        return 1
    },
    beam(k, out, t, p) {
        for (const d of [-12, 0, 12]) {
            k.tone({ out, t, dur: 0.5, f: 165 * p, f2: 220 * p, gain: 0.16, type: 'sawtooth', detune: d, attack: 0.08, hold: 0.2, filter: { type: 'bandpass', f: 400, f2: 2400, q: 3 } })
        }
        k.noise({ out, t, dur: 0.5, gain: 0.06, attack: 0.1, filter: { type: 'highpass', f: 5000 } })
        return 0.5
    },
    quake(k, out, t, p) {
        k.tone({ out, t, dur: 0.45, f: 70 * p, f2: 30 * p, gain: 0.8, drive: true, filter: { type: 'lowpass', f: 400 } })
        k.noise({ out, t, dur: 0.9, gain: 0.5, attack: 0.01, hold: 0.15, filter: { type: 'lowpass', f: 300, f2: 80, q: 0.8 } })
        for (let i = 0; i < 6; i++) {
            k.noise({ out, t: t + 0.08 + i * 0.1 + Math.random() * 0.03, dur: 0.02, gain: 0.2, filter: { type: 'highpass', f: 2500 } })
        }
        return 0.9
    },
    turret(k, out, t, p) {
        k.tone({ out, t, dur: 0.02, f: 1400 * p, gain: 0.18, type: 'square', filter: { type: 'lowpass', f: 3000 } })
        k.noise({ out, t, dur: 0.02, gain: 0.25, filter: { type: 'highpass', f: 3000 } })
        k.tone({ out, t: t + 0.05, dur: 0.02, f: 1000 * p, gain: 0.18, type: 'square', filter: { type: 'lowpass', f: 3000 } })
        k.noise({ out, t: t + 0.05, dur: 0.02, gain: 0.25, filter: { type: 'highpass', f: 3000 } })
        k.tone({ out, t: t + 0.12, dur: 0.3, f: 200 * p, f2: 900 * p, gain: 0.2, type: 'sawtooth', filter: { type: 'lowpass', f: 2000 } })
        k.tone({ out, t: t + 0.12, dur: 0.3, f: 400 * p, f2: 1800 * p, gain: 0.08 })
        k.tone({ out, t: t + 0.4, dur: 0.1, f: 150 * p, f2: 90 * p, gain: 0.35 })
        return 0.45
    },
    abilityReady(k, out, t, p) {
        k.tone({ out, t, dur: 0.14, f: hz(84) * p, gain: 0.16, type: 'triangle', attack: 0.005 })
        k.tone({ out, t: t + 0.07, dur: 0.18, f: hz(91) * p, gain: 0.16, type: 'triangle', attack: 0.005 })
        return 0.25
    },
    abilityUnlock(k, out, t, p) {
        const notes = [67, 72, 76, 84]
        notes.forEach((n, i) => {
            k.tone({ out, t: t + i * 0.1, dur: 0.4, f: hz(n) * p, gain: 0.2, type: 'triangle', attack: 0.005 })
            k.tone({ out, t: t + i * 0.1, dur: 0.3, f: hz(n) * p, gain: 0.07, type: 'square', filter: { type: 'lowpass', f: 3000 } })
        })
        for (const n of [72, 76, 79]) k.tone({ out, t: t + 0.4, dur: 0.6, f: hz(n) * p, gain: 0.07, attack: 0.01, hold: 0.1 })
        k.bell(out, t + 0.4, hz(96) * p, 0.8, 0.2, 3.5, 1)
        return 1
    },
    slotUnlock(k, out, t, p) {
        k.tone({ out, t, dur: 0.18, f: 120 * p, f2: 50 * p, gain: 0.6 })
        k.noise({ out, t, dur: 0.08, gain: 0.35, filter: { type: 'lowpass', f: 1200 } })
        k.tone({ out, t, dur: 0.05, f: 400 * p, gain: 0.1, type: 'square', filter: { type: 'lowpass', f: 1500 } })
        const notes = [72, 76, 79, 83, 86, 91]
        notes.forEach((n, i) => k.bell(out, t + 0.25 + i * 0.07, hz(n) * p, 0.4, 0.1, 3.5, 1))
        k.noise({ out, t: t + 0.3, dur: 0.5, gain: 0.06, attack: 0.3, filter: { type: 'highpass', f: 7000 } })
        return 1
    },
    affixShield(k, out, t, p) {
        k.tone({ out, t, dur: 0.12, f: 320 * p, f2: 240 * p, gain: 0.25, type: 'square', filter: { type: 'lowpass', f: 1200, q: 2 } })
        k.bell(out, t, 620 * p, 0.12, 0.12, 1.41, 3)
        return 0.15
    },
    affixVamp(k, out, t, p) {
        k.noise({ out, t, dur: 0.3, gain: 0.4, attack: 0.03, filter: { type: 'bandpass', f: 1600 * p, f2: 300 * p, q: 2 } })
        k.tone({ out, t, dur: 0.3, f: 110 * p, f2: 70 * p, gain: 0.3, attack: 0.02 })
        k.tone({ out, t: t + 0.12, dur: 0.12, f: 300 * p, f2: 480 * p, gain: 0.08 })
        return 0.35
    },
    affixSplit(k, out, t, p) {
        k.tone({ out, t, dur: 0.1, f: 500 * p, f2: 110 * p, gain: 0.45, type: 'triangle', filter: { type: 'lowpass', f: 900, q: 2 } })
        k.noise({ out, t, dur: 0.05, gain: 0.2, filter: { type: 'bandpass', f: 900, q: 1 } })
        k.tone({ out, t: t + 0.1, dur: 0.07, f: 760 * p, f2: 560 * p, gain: 0.18, type: 'triangle' })
        k.tone({ out, t: t + 0.17, dur: 0.08, f: 760 * p, f2: 1040 * p, gain: 0.18, type: 'triangle' })
        return 0.3
    },
    affixHaste(k, out, t, p) {
        k.noise({ out, t, dur: 0.3, gain: 0.35, attack: 0.05, filter: { type: 'bandpass', f: 400 * p, f2: 4000 * p, q: 1.2 } })
        k.tone({ out, t, dur: 0.3, f: 180 * p, f2: 360 * p, gain: 0.15, type: 'square', vibrato: { rate: 22, depth: 120 }, filter: { type: 'lowpass', f: 1800 } })
        return 0.35
    },
    affixBlast(k, out, t, p) {
        k.tone({ out, t, dur: 0.5, f: 440 * p, f2: 880 * p, gain: 0.25, type: 'triangle' })
        k.tone({ out, t, dur: 0.5, f: 330 * p, f2: 660 * p, gain: 0.15, type: 'square', filter: { type: 'lowpass', f: 2000, q: 1 } })
        k.noise({ out, t, dur: 0.5, gain: 0.25, attack: 0.01, filter: { type: 'highpass', f: 5000 } })
        for (let i = 0; i < 8; i++) {
            k.noise({ out, t: t + i * 0.06 + Math.random() * 0.02, dur: 0.02, gain: 0.15, filter: { type: 'highpass', f: 6000 } })
        }
        k.tone({ out, t: t + 0.5, dur: 0.08, f: 1000 * p, gain: 0.2 })
        return 0.6
    }
}
