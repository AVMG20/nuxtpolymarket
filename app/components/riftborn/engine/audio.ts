/*
 * RIFTBORN audio: every sound effect is synthesised on the fly with WebAudio
 * (no files), plus the procedural soundtrack from audio-music.ts.
 *
 * Signal flow: voices -> panner -> sfx bus ─┐
 *              music layers -> music bus ───┼-> glue compressor -> limiter -> master -> out
 *              reverb / echo returns ───────┘
 *
 * Voice limiting keeps a 200-hits-a-second fight from clipping: each sound
 * has a max number of overlapping voices, a minimum retrigger interval and a
 * touch of random detune so repeats don't phase. Spammy sounds steal their
 * oldest voice instead of dropping the newest, and duck themselves as their
 * rate climbs, so 30 kills a second stays crunchy instead of turning to mush.
 * A kill streak layers a sub thump and a rising sparkle on top.
 */
import { Kit, hz } from './audio-kit'
import { Music } from './audio-music'
import { EXTRA_RULES, EXTRA_SOUNDS } from './audio-sfx-extra'
import type { MusicMode, Sfx, SfxName, SfxOptions } from './types'

interface Rule {
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
    /** At the voice cap, fade the oldest voice out instead of skipping the new one */
    steal?: boolean
}

const BASE_RULES: Partial<Record<SfxName, Rule>> = {
    shoot: { max: 4, gap: 0.04, jitter: 0.05, volume: 0.32, spam: true, steal: true },
    shootHeavy: { max: 3, gap: 0.06, jitter: 0.04, volume: 0.5 },
    swing: { max: 3, gap: 0.05, jitter: 0.06, volume: 0.45, spam: true, steal: true },
    arrow: { max: 4, gap: 0.04, jitter: 0.06, volume: 0.35, spam: true, steal: true },
    fire: { max: 3, gap: 0.06, jitter: 0.06, volume: 0.4, spam: true, steal: true },
    zap: { max: 4, gap: 0.04, jitter: 0.07, volume: 0.35, spam: true, steal: true },
    frost: { max: 3, gap: 0.06, jitter: 0.04, volume: 0.4, wet: 0.3 },
    laser: { max: 3, gap: 0.05, jitter: 0.03, volume: 0.35 },
    summon: { max: 2, gap: 0.1, jitter: 0.03, volume: 0.5, wet: 0.4 },
    hit: { max: 6, gap: 0.018, jitter: 0.09, volume: 0.3, spam: true, steal: true },
    crit: { max: 4, gap: 0.03, jitter: 0.05, volume: 0.42 },
    kill: { max: 8, gap: 0.02, jitter: 0.12, volume: 0.4, spam: true, steal: true },
    killBig: { max: 3, gap: 0.05, jitter: 0.05, volume: 0.6, wet: 0.15 },
    explosion: { max: 4, gap: 0.05, jitter: 0.08, volume: 0.6, wet: 0.2 },
    xp: { max: 6, gap: 0.022, jitter: 0.004, volume: 0.34, spam: true, steal: true },
    shard: { max: 3, gap: 0.05, jitter: 0.01, volume: 0.45, wet: 0.3 },
    coin: { max: 4, gap: 0.03, jitter: 0.005, volume: 0.4, wet: 0.1, steal: true },
    heal: { max: 2, gap: 0.15, jitter: 0, volume: 0.5, wet: 0.3 },
    magnet: { max: 1, gap: 0.3, jitter: 0, volume: 0.6, wet: 0.2 },
    levelUp: { max: 1, gap: 0.3, jitter: 0, volume: 0.7, wet: 0.35 },
    cardReveal: { max: 4, gap: 0.05, jitter: 0.02, volume: 0.45, wet: 0.3 },
    cardSelect: { max: 2, gap: 0.08, jitter: 0, volume: 0.55, wet: 0.15 },
    legendary: { max: 1, gap: 0.5, jitter: 0, volume: 0.75, wet: 0.6 },
    reroll: { max: 1, gap: 0.2, jitter: 0, volume: 0.5 },
    chestDrop: { max: 2, gap: 0.2, jitter: 0, volume: 0.7, wet: 0.15 },
    chestOpen: { max: 1, gap: 0.3, jitter: 0, volume: 0.7, wet: 0.4 },
    chestReward: { max: 3, gap: 0.08, jitter: 0, volume: 0.55, wet: 0.4 },
    hurt: { max: 2, gap: 0.12, jitter: 0.05, volume: 0.7 },
    dash: { max: 2, gap: 0.08, jitter: 0.05, volume: 0.5 },
    ultimateReady: { max: 1, gap: 0.5, jitter: 0, volume: 0.6, wet: 0.4 },
    ultimate: { max: 1, gap: 0.3, jitter: 0, volume: 0.9, wet: 0.4 },
    comboUp: { max: 2, gap: 0.05, jitter: 0, volume: 0.4 },
    streak: { max: 1, gap: 0.2, jitter: 0, volume: 0.55, wet: 0.3 },
    spawnElite: { max: 2, gap: 0.3, jitter: 0, volume: 0.6, wet: 0.3 },
    telegraph: { max: 3, gap: 0.08, jitter: 0.05, volume: 0.35 },
    enemyShot: { max: 4, gap: 0.045, jitter: 0.08, volume: 0.25, spam: true, steal: true },
    bossWarning: { max: 1, gap: 1, jitter: 0, volume: 0.8, wet: 0.3 },
    bossRoar: { max: 1, gap: 0.6, jitter: 0, volume: 1, wet: 0.4 },
    bossDeath: { max: 1, gap: 1, jitter: 0, volume: 1, wet: 0.5 },
    victory: { max: 1, gap: 1, jitter: 0, volume: 0.8, wet: 0.4 },
    defeat: { max: 1, gap: 1, jitter: 0, volume: 0.8, wet: 0.4 },
    revive: { max: 1, gap: 0.5, jitter: 0, volume: 0.8, wet: 0.5 },
    uiHover: { max: 2, gap: 0.04, jitter: 0.02, volume: 0.2 },
    uiClick: { max: 2, gap: 0.03, jitter: 0.02, volume: 0.35 },
    uiBuy: { max: 2, gap: 0.08, jitter: 0, volume: 0.5, wet: 0.2 },
    uiError: { max: 1, gap: 0.15, jitter: 0, volume: 0.45 },
    countTick: { max: 2, gap: 0.03, jitter: 0, volume: 0.25 }
}

const RULES = { ...BASE_RULES, ...EXTRA_RULES } as Record<SfxName, Rule>

const MAX_VOICES = 48
const CROWDED = 34

const PENTA = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93]

type Voice = (k: Kit, out: AudioNode, t: number, p: number) => number

/** Each returns its length in seconds */
const BASE_SOUNDS: Partial<Record<SfxName, Voice>> = {
    shoot(k, out, t, p) {
        k.tone({ out, t, dur: 0.07, f: 900 * p, f2: 420 * p, gain: 0.25, type: 'square', filter: { type: 'lowpass', f: 3200 } })
        k.noise({ out, t, dur: 0.025, gain: 0.15, filter: { type: 'highpass', f: 3000 } })
        return 0.08
    },
    shootHeavy(k, out, t, p) {
        k.tone({ out, t, dur: 0.18, f: 260 * p, f2: 70 * p, gain: 0.35, type: 'sawtooth', filter: { type: 'lowpass', f: 1800, f2: 300 } })
        k.tone({ out, t, dur: 0.2, f: 120 * p, f2: 40 * p, gain: 0.5 })
        k.noise({ out, t, dur: 0.08, gain: 0.3, filter: { type: 'lowpass', f: 1200 } })
        return 0.22
    },
    swing(k, out, t, p) {
        k.noise({ out, t, dur: 0.16, gain: 0.5, attack: 0.03, filter: { type: 'bandpass', f: 500 * p, f2: 3000 * p, q: 1.5 } })
        k.tone({ out, t, dur: 0.12, f: 300 * p, f2: 700 * p, gain: 0.08 })
        return 0.18
    },
    arrow(k, out, t, p) {
        k.tone({ out, t, dur: 0.09, f: 1400 * p, f2: 700 * p, gain: 0.22, type: 'triangle' })
        k.noise({ out, t, dur: 0.12, gain: 0.2, attack: 0.01, filter: { type: 'bandpass', f: 5000 * p, f2: 1500 * p, q: 1 } })
        k.tone({ out, t, dur: 0.07, f: 220 * p, gain: 0.15, type: 'triangle' })
        return 0.13
    },
    fire(k, out, t, p) {
        k.noise({ out, t, dur: 0.3, gain: 0.45, attack: 0.02, filter: { type: 'lowpass', f: 800 * p, f2: 3200 * p, q: 1 } })
        k.tone({ out, t, dur: 0.3, f: 90 * p, f2: 60 * p, gain: 0.14, type: 'sawtooth', filter: { type: 'lowpass', f: 400 } })
        for (let i = 0; i < 4; i++) k.noise({ out, t: t + 0.03 + Math.random() * 0.22, dur: 0.012, gain: 0.25, filter: { type: 'highpass', f: 4000 } })
        return 0.32
    },
    zap(k, out, t, p) {
        k.tone({ out, t, dur: 0.14, f: 1800 * p, f2: 300 * p, gain: 0.16, type: 'square', vibrato: { rate: 70, depth: 700 }, filter: { type: 'lowpass', f: 5000 } })
        k.noise({ out, t, dur: 0.05, gain: 0.2, filter: { type: 'highpass', f: 6000 } })
        k.tone({ out, t, dur: 0.06, f: 3200 * p, f2: 900 * p, gain: 0.07, type: 'sawtooth' })
        return 0.16
    },
    frost(k, out, t, p) {
        k.bell(out, t, 2093 * p, 0.35, 0.18, 2.76, 1.5)
        k.bell(out, t + 0.03, 3136 * p, 0.3, 0.11, 2.76, 1.2)
        k.noise({ out, t, dur: 0.15, gain: 0.12, attack: 0.02, filter: { type: 'highpass', f: 8000 } })
        return 0.4
    },
    laser(k, out, t, p) {
        k.tone({ out, t, dur: 0.25, f: 1600 * p, f2: 180 * p, gain: 0.2, type: 'sawtooth', filter: { type: 'bandpass', f: 1400, f2: 300, q: 6 } })
        k.tone({ out, t, dur: 0.2, f: 800 * p, f2: 90 * p, gain: 0.08, type: 'square' })
        return 0.27
    },
    summon(k, out, t, p) {
        for (const d of [-14, 14]) k.tone({ out, t, dur: 0.55, f: 220 * p, f2: 660 * p, gain: 0.16, detune: d, attack: 0.08, vibrato: { rate: 6, depth: 35 } })
        k.noise({ out, t, dur: 0.5, gain: 0.08, attack: 0.25, filter: { type: 'bandpass', f: 1000, f2: 3000, q: 2 } })
        return 0.58
    },
    hit(k, out, t, p) {
        k.tone({ out, t, dur: 0.07, f: 230 * p, f2: 70 * p, gain: 0.5 })
        k.noise({ out, t, dur: 0.03, gain: 0.25, filter: { type: 'bandpass', f: 2500 * p, q: 1 } })
        return 0.08
    },
    crit(k, out, t, p) {
        k.noise({ out, t, dur: 0.05, gain: 0.5, filter: { type: 'highpass', f: 2500 } })
        k.tone({ out, t, dur: 0.06, f: 1700 * p, f2: 700 * p, gain: 0.16, type: 'square' })
        k.tone({ out, t: t + 0.005, dur: 0.1, f: 2600 * p, gain: 0.14 })
        k.tone({ out, t, dur: 0.1, f: 170 * p, f2: 60 * p, gain: 0.5 })
        return 0.12
    },
    kill(k, out, t, p) {
        // three timbres picked at random so a 30-a-second massacre never
        // machine-guns the same sample
        const v = Math.floor(Math.random() * 3)
        k.noise({ out, t, dur: 0.012, gain: 0.35, attack: 0.001, filter: { type: 'highpass', f: 2500 } })
        if (v === 0) {
            k.tone({ out, t, dur: 0.1, f: 700 * p, f2: 160 * p, gain: 0.5 })
            k.tone({ out, t: t + 0.012, dur: 0.06, f: 1100 * p, f2: 1700 * p, gain: 0.14, type: 'triangle' })
        } else if (v === 1) {
            k.tone({ out, t, dur: 0.09, f: 560 * p, f2: 140 * p, gain: 0.5, type: 'triangle' })
            k.noise({ out, t, dur: 0.06, gain: 0.22, filter: { type: 'bandpass', f: 1400 * p, q: 2 } })
        } else {
            k.tone({ out, t, dur: 0.11, f: 820 * p, f2: 200 * p, gain: 0.42 })
            k.tone({ out, t: t + 0.01, dur: 0.05, f: 1600 * p, f2: 2400 * p, gain: 0.08, type: 'square', filter: { type: 'lowpass', f: 5000 } })
        }
        k.noise({ out, t, dur: 0.04, gain: 0.15, filter: { type: 'lowpass', f: 2000 } })
        return 0.12
    },
    killBig(k, out, t, p) {
        k.tone({ out, t, dur: 0.35, f: 140 * p, f2: 38 * p, gain: 0.8 })
        k.tone({ out, t, dur: 0.15, f: 500 * p, f2: 120 * p, gain: 0.15, type: 'square', filter: { type: 'lowpass', f: 1500 } })
        k.noise({ out, t, dur: 0.3, gain: 0.4, filter: { type: 'lowpass', f: 1500, f2: 200 } })
        k.tone({ out, t: t + 0.02, dur: 0.1, f: 900 * p, f2: 1500 * p, gain: 0.12, type: 'triangle' })
        return 0.38
    },
    explosion(k, out, t, p) {
        k.noise({ out, t, dur: 0.7, gain: 0.8, filter: { type: 'lowpass', f: 3000 * p, f2: 150, q: 0.7 } })
        k.tone({ out, t, dur: 0.5, f: 100 * p, f2: 30 * p, gain: 0.8, drive: true, filter: { type: 'lowpass', f: 600 } })
        k.noise({ out, t, dur: 0.15, gain: 0.3, filter: { type: 'bandpass', f: 900, q: 1 } })
        return 0.75
    },
    xp(k, out, t, p) {
        const f = 1320 * p
        k.tone({ out, t, dur: 0.14, f, gain: 0.3, attack: 0.002 })
        k.tone({ out, t, dur: 0.08, f: f * 2, gain: 0.1, attack: 0.002 })
        k.tone({ out, t, dur: 0.05, f: f * 3, gain: 0.04, type: 'triangle', attack: 0.002 })
        return 0.15
    },
    shard(k, out, t, p) {
        k.bell(out, t, 1760 * p, 0.5, 0.22, 3, 1)
        k.bell(out, t + 0.07, 2637 * p, 0.5, 0.18, 3, 1)
        k.noise({ out, t, dur: 0.1, gain: 0.08, filter: { type: 'highpass', f: 9000 } })
        return 0.6
    },
    coin(k, out, t, p) {
        k.tone({ out, t, dur: 0.08, f: 988 * p, gain: 0.12, type: 'square', filter: { type: 'lowpass', f: 4500 } })
        k.tone({ out, t: t + 0.07, dur: 0.35, f: 1319 * p, gain: 0.12, type: 'square', hold: 0.04, filter: { type: 'lowpass', f: 4500 } })
        return 0.45
    },
    heal(k, out, t, p) {
        const notes = [523, 659, 784, 1047]
        notes.forEach((f, i) => k.tone({ out, t: t + i * 0.05, dur: 0.3, f: f * p, gain: 0.16, attack: 0.01 }))
        k.noise({ out, t, dur: 0.4, gain: 0.05, attack: 0.1, filter: { type: 'highpass', f: 7000 } })
        return 0.5
    },
    magnet(k, out, t, p) {
        k.tone({ out, t, dur: 0.5, f: 250 * p, f2: 1400 * p, sweep: 0.45, gain: 0.18, attack: 0.05 })
        k.tone({ out, t, dur: 0.5, f: 125 * p, f2: 700 * p, sweep: 0.45, gain: 0.08, type: 'triangle', attack: 0.05 })
        k.noise({ out, t, dur: 0.5, gain: 0.15, attack: 0.2, filter: { type: 'bandpass', f: 300, f2: 4000, q: 1.2 } })
        return 0.55
    },
    levelUp(k, out, t, p) {
        const notes = [72, 76, 79, 84, 88, 91]
        notes.forEach((n, i) => {
            k.tone({ out, t: t + i * 0.06, dur: 0.25, f: hz(n) * p, gain: 0.11, type: 'square', filter: { type: 'lowpass', f: 3500 } })
            k.tone({ out, t: t + i * 0.06, dur: 0.3, f: hz(n + 12) * p, gain: 0.06 })
        })
        for (const n of [84, 88, 91]) {
            for (const d of [-8, 8]) k.tone({ out, t: t + 0.36, dur: 0.9, f: hz(n) * p, gain: 0.05, type: 'sawtooth', detune: d, attack: 0.02, hold: 0.25, filter: { type: 'lowpass', f: 2800 } })
        }
        k.bell(out, t + 0.36, hz(96) * p, 0.9, 0.12, 3, 1)
        k.noise({ out, t: t + 0.3, dur: 0.6, gain: 0.06, attack: 0.05, filter: { type: 'highpass', f: 8000 } })
        return 1.3
    },
    cardReveal(k, out, t, p) {
        k.noise({ out, t, dur: 0.2, gain: 0.2, attack: 0.06, filter: { type: 'bandpass', f: 800, f2: 4000, q: 1.5 } })
        k.bell(out, t + 0.12, 1568 * p, 0.4, 0.14, 3, 1)
        return 0.55
    },
    cardSelect(k, out, t, p) {
        k.tone({ out, t, dur: 0.1, f: 784 * p, gain: 0.22, type: 'triangle' })
        k.tone({ out, t: t + 0.06, dur: 0.25, f: 1175 * p, gain: 0.22, type: 'triangle' })
        k.tone({ out, t, dur: 0.1, f: 150, f2: 60, gain: 0.4 })
        return 0.32
    },
    legendary(k, out, t, p) {
        const chord = [60, 67, 72, 76, 79, 83]
        for (const n of chord) {
            for (const d of [-10, 0, 10]) {
                k.tone({ out, t, dur: 2.2, f: hz(n) * p, gain: 0.028, type: 'sawtooth', detune: d, attack: 0.15, hold: 0.7, vibrato: { rate: 5, depth: 14 }, filter: { type: 'bandpass', f: 900, q: 1.6 } })
            }
            k.tone({ out, t, dur: 2.2, f: hz(n) * p, gain: 0.03, attack: 0.15, hold: 0.7 })
        }
        for (let i = 0; i < 9; i++) {
            const n = PENTA[(i * 3) % PENTA.length]! + 12
            k.bell(out, t + 0.1 + i * 0.08, hz(n) * p, 0.8, 0.07, 3, 1)
        }
        k.tone({ out, t, dur: 2, f: hz(36) * p, gain: 0.2, attack: 0.3, hold: 0.8 })
        k.noise({ out, t, dur: 1.5, gain: 0.05, attack: 0.4, filter: { type: 'highpass', f: 7000 } })
        return 2.3
    },
    reroll(k, out, t, p) {
        for (let i = 0; i < 7; i++) k.tone({ out, t: t + i * 0.035, dur: 0.03, f: (600 + i * 120) * p, gain: 0.12, type: 'square', filter: { type: 'lowpass', f: 4000 } })
        k.tone({ out, t: t + 0.26, dur: 0.15, f: 1400 * p, gain: 0.15, type: 'triangle' })
        return 0.45
    },
    chestDrop(k, out, t, p) {
        k.tone({ out, t, dur: 0.3, f: 120 * p, f2: 45 * p, gain: 0.9 })
        k.noise({ out, t, dur: 0.2, gain: 0.5, filter: { type: 'lowpass', f: 800 } })
        k.bell(out, t + 0.05, 2349 * p, 0.25, 0.08, 3.5, 1)
        k.bell(out, t + 0.1, 2794 * p, 0.25, 0.07, 3.5, 1)
        return 0.4
    },
    chestOpen(k, out, t, p) {
        k.tone({ out, t, dur: 0.25, f: 90 * p, f2: 140 * p, gain: 0.1, type: 'sawtooth', vibrato: { rate: 18, depth: 90 }, filter: { type: 'bandpass', f: 600, q: 6 } })
        k.noise({ out, t: t + 0.15, dur: 0.45, gain: 0.25, attack: 0.2, filter: { type: 'bandpass', f: 400, f2: 5000, q: 1.2 } })
        const notes = [84, 88, 91, 96, 100]
        notes.forEach((n, i) => k.bell(out, t + 0.35 + i * 0.05, hz(n) * p, 0.45, 0.11, 3, 1))
        k.tone({ out, t: t + 0.35, dur: 0.6, f: hz(60) * p, gain: 0.15, type: 'triangle', attack: 0.01 })
        return 1
    },
    chestReward(k, out, t, p) {
        for (let i = 0; i < 10; i++) k.bell(out, t + i * 0.045, hz(PENTA[Math.floor(Math.random() * PENTA.length)]! + 12) * p, 0.35, 0.09, 3, 1)
        for (const n of [72, 76, 79]) k.tone({ out, t, dur: 0.6, f: hz(n) * p, gain: 0.07, attack: 0.01, hold: 0.1 })
        return 0.9
    },
    hurt(k, out, t, p) {
        k.tone({ out, t, dur: 0.2, f: 220 * p, f2: 80 * p, gain: 0.3, type: 'sawtooth', drive: true, filter: { type: 'lowpass', f: 1500 } })
        k.noise({ out, t, dur: 0.12, gain: 0.4, filter: { type: 'lowpass', f: 1500 } })
        k.tone({ out, t, dur: 0.2, f: 90 * p, f2: 50 * p, gain: 0.5 })
        return 0.22
    },
    dash(k, out, t, p) {
        k.noise({ out, t, dur: 0.16, gain: 0.5, attack: 0.01, filter: { type: 'bandpass', f: 300 * p, f2: 3500 * p, q: 1.2 } })
        k.tone({ out, t, dur: 0.1, f: 400 * p, f2: 900 * p, gain: 0.1 })
        return 0.18
    },
    ultimateReady(k, out, t, p) {
        k.tone({ out, t, dur: 0.5, f: 220 * p, f2: 440 * p, gain: 0.1, type: 'sawtooth', attack: 0.1, filter: { type: 'lowpass', f: 400, f2: 4000 } })
        k.bell(out, t + 0.35, 1760 * p, 0.6, 0.2, 3, 1)
        k.bell(out, t + 0.42, 2637 * p, 0.5, 0.15, 3, 1)
        return 1
    },
    ultimate(k, out, t, p) {
        k.tone({ out, t, dur: 1, f: 80 * p, f2: 30 * p, gain: 0.9, drive: true, filter: { type: 'lowpass', f: 700 } })
        k.noise({ out, t, dur: 1.2, gain: 0.55, filter: { type: 'lowpass', f: 4000, f2: 200 } })
        for (const n of [57, 64, 69, 76]) k.tone({ out, t, dur: 0.8, f: hz(n) * p, gain: 0.08, type: 'sawtooth', attack: 0.01, hold: 0.1, filter: { type: 'lowpass', f: 3200, f2: 500 } })
        k.noise({ out, t, dur: 0.35, gain: 0.2, filter: { type: 'highpass', f: 5000 } })
        return 1.3
    },
    comboUp(k, out, t, p) {
        k.tone({ out, t, dur: 0.06, f: 880 * p, gain: 0.18, type: 'triangle' })
        k.tone({ out, t: t + 0.04, dur: 0.1, f: 1320 * p, gain: 0.18, type: 'triangle' })
        return 0.16
    },
    streak(k, out, t, p) {
        const notes = [784, 988, 1319]
        notes.forEach((f, i) => k.tone({ out, t: t + i * 0.05, dur: 0.15, f: f * p, gain: 0.12, type: 'square', filter: { type: 'lowpass', f: 3500 } }))
        k.bell(out, t + 0.15, 2637 * p, 0.4, 0.12, 3, 1)
        return 0.45
    },
    spawnElite(k, out, t, p) {
        for (const f of [110, 116.5]) k.tone({ out, t, dur: 0.7, f: f * p, gain: 0.14, type: 'sawtooth', attack: 0.04, filter: { type: 'lowpass', f: 700 } })
        k.bell(out, t, 440 * p, 0.9, 0.14, 1.41, 4)
        return 1
    },
    telegraph(k, out, t, p) {
        k.tone({ out, t, dur: 0.18, f: 520 * p, f2: 780 * p, gain: 0.18, vibrato: { rate: 14, depth: 40 } })
        return 0.2
    },
    enemyShot(k, out, t, p) {
        k.tone({ out, t, dur: 0.09, f: 600 * p, f2: 280 * p, gain: 0.2, type: 'triangle' })
        k.noise({ out, t, dur: 0.03, gain: 0.08, filter: { type: 'bandpass', f: 1200, q: 1 } })
        return 0.1
    },
    bossWarning(k, out, t, p) {
        for (let i = 0; i < 3; i++) {
            const s = t + i * 0.5
            k.tone({ out, t: s, dur: 0.26, f: 440 * p, f2: 660 * p, gain: 0.14, type: 'sawtooth', attack: 0.01, hold: 0.15, filter: { type: 'lowpass', f: 2200 } })
            k.tone({ out, t: s + 0.25, dur: 0.26, f: 660 * p, f2: 440 * p, gain: 0.14, type: 'sawtooth', attack: 0.01, hold: 0.15, filter: { type: 'lowpass', f: 2200 } })
        }
        k.tone({ out, t, dur: 1.6, f: 55 * p, gain: 0.4, attack: 0.1, hold: 1 })
        k.noise({ out, t, dur: 1.6, gain: 0.3, attack: 0.2, filter: { type: 'lowpass', f: 200 } })
        return 1.7
    },
    bossRoar(k, out, t, p) {
        for (const f of [55, 58.3, 82.4]) {
            k.tone({ out, t, dur: 1.8, f: f * p, f2: f * 0.7 * p, sweep: 1.6, gain: 0.22, type: 'sawtooth', attack: 0.08, hold: 0.5, vibrato: { rate: 7, depth: 60 }, drive: true, filter: { type: 'lowpass', f: 900, f2: 300, q: 2 } })
        }
        k.noise({ out, t, dur: 1.6, gain: 0.5, attack: 0.1, hold: 0.4, filter: { type: 'bandpass', f: 400, f2: 200, q: 1.5 } })
        k.tone({ out, t, dur: 1.8, f: 40 * p, gain: 0.6, attack: 0.05, hold: 0.6 })
        return 1.9
    },
    bossDeath(k, out, t, p) {
        k.noise({ out, t, dur: 1.6, gain: 0.9, filter: { type: 'lowpass', f: 4000, f2: 100, q: 0.7 } })
        k.tone({ out, t, dur: 1.2, f: 90 * p, f2: 25 * p, gain: 0.9, drive: true, filter: { type: 'lowpass', f: 500 } })
        k.tone({ out, t, dur: 2, f: 200 * p, f2: 30 * p, gain: 0.15, type: 'sawtooth', vibrato: { rate: 6, depth: 80 }, filter: { type: 'lowpass', f: 1200 } })
        for (const n of [72, 76, 79, 84]) k.tone({ out, t: t + 1.1, dur: 2, f: hz(n) * p, gain: 0.05, attack: 0.1, hold: 0.6 })
        for (let i = 0; i < 6; i++) k.bell(out, t + 1.1 + i * 0.09, hz(PENTA[i + 3]!) * p, 0.9, 0.06, 3, 1)
        return 3.2
    },
    victory(k, out, t, p) {
        const notes = [67, 72, 76, 79]
        notes.forEach((n, i) => {
            for (const d of [-6, 6]) k.tone({ out, t: t + i * 0.12, dur: 0.2, f: hz(n) * p, gain: 0.07, type: 'sawtooth', detune: d, attack: 0.02, filter: { type: 'lowpass', f: 2600 } })
        })
        for (const n of [60, 64, 67, 72, 76]) {
            for (const d of [-6, 6]) k.tone({ out, t: t + 0.5, dur: 1.6, f: hz(n) * p, gain: 0.045, type: 'sawtooth', detune: d, attack: 0.03, hold: 0.8, filter: { type: 'lowpass', f: 2800, f2: 1200 } })
        }
        for (let i = 0; i < 6; i++) k.bell(out, t + 0.5 + i * 0.1, hz([84, 88, 91, 96][i % 4]!) * p, 0.8, 0.06, 3, 1)
        return 2.2
    },
    defeat(k, out, t, p) {
        const notes = [69, 67, 65, 62]
        notes.forEach((n, i) => k.tone({ out, t: t + i * 0.25, dur: 0.45, f: hz(n) * p, gain: 0.14, type: 'triangle', attack: 0.02, vibrato: { rate: 5, depth: 15 } }))
        k.tone({ out, t, dur: 1.6, f: hz(38) * p, gain: 0.14, type: 'sawtooth', attack: 0.1, hold: 0.8, filter: { type: 'lowpass', f: 300 } })
        return 1.8
    },
    revive(k, out, t, p) {
        const notes = [69, 73, 76, 81]
        notes.forEach((n, i) => k.tone({ out, t: t + i * 0.1, dur: 1.4, f: hz(n) * p * 0.5, f2: hz(n) * p, sweep: 0.4, gain: 0.08, attack: 0.1, hold: 0.5 }))
        k.noise({ out, t, dur: 1.2, gain: 0.08, attack: 0.4, filter: { type: 'highpass', f: 6000 } })
        k.bell(out, t + 0.5, hz(93) * p, 1, 0.12, 3, 1)
        return 1.6
    },
    uiHover(k, out, t, p) {
        k.tone({ out, t, dur: 0.025, f: 1800 * p, gain: 0.1 })
        return 0.03
    },
    uiClick(k, out, t, p) {
        k.tone({ out, t, dur: 0.03, f: 1100 * p, gain: 0.1, type: 'square', filter: { type: 'lowpass', f: 4000 } })
        k.tone({ out, t, dur: 0.04, f: 300 * p, f2: 120 * p, gain: 0.2 })
        return 0.05
    },
    uiBuy(k, out, t, p) {
        k.tone({ out, t, dur: 0.06, f: 1319 * p, gain: 0.1, type: 'square', filter: { type: 'lowpass', f: 5000 } })
        k.tone({ out, t: t + 0.06, dur: 0.25, f: 1760 * p, gain: 0.1, type: 'square', filter: { type: 'lowpass', f: 5000 } })
        k.noise({ out, t: t + 0.04, dur: 0.1, gain: 0.1, filter: { type: 'highpass', f: 6000 } })
        return 0.35
    },
    uiError(k, out, t, p) {
        k.tone({ out, t, dur: 0.09, f: 160 * p, gain: 0.14, type: 'square', filter: { type: 'lowpass', f: 1200 } })
        k.tone({ out, t: t + 0.12, dur: 0.09, f: 150 * p, gain: 0.14, type: 'square', filter: { type: 'lowpass', f: 1200 } })
        return 0.25
    },
    countTick(k, out, t, p) {
        k.tone({ out, t, dur: 0.03, f: 2200 * p, gain: 0.15 })
        k.tone({ out, t, dur: 0.015, f: 4400 * p, gain: 0.05, type: 'triangle' })
        return 0.04
    }
}

const SOUNDS = { ...BASE_SOUNDS, ...EXTRA_SOUNDS } as Record<SfxName, Voice>

/** Streak layers on top of the kill sound, not exposed as SfxNames */
function killThump(k: Kit, out: AudioNode, t: number, heat: number): number {
    k.tone({ out, t, dur: 0.16, f: 95, f2: 42, gain: 0.35 + heat * 0.2 })
    k.noise({ out, t, dur: 0.05, gain: 0.1, filter: { type: 'lowpass', f: 600 } })
    return 0.18
}

function killSparkle(k: Kit, out: AudioNode, t: number, rung: number): number {
    const n = PENTA[rung % PENTA.length]! + 12 * Math.floor(rung / PENTA.length)
    k.bell(out, t, hz(Math.min(n, 100)), 0.3, 0.1, 3, 0.8)
    return 0.32
}

interface Graph {
    ctx: AudioContext
    kit: Kit
    master: GainNode
    sfxBus: GainNode
    reverbIn: GainNode
    music: Music
}

export function createSfx(): Sfx {
    let graph: Graph | null = null
    let muted = false
    let volume = 0.8
    let wantedMode: MusicMode = 'off'
    let wantedIntensity = 0
    let destroyed = false
    interface Live {
        end: number
        out: GainNode
    }
    const live = new Map<SfxName, Live[]>()
    const lastStart = new Map<SfxName, number>()
    let allEnds: number[] = []
    /** Recent start times per spammy sound, for self-ducking */
    const recent = new Map<SfxName, number[]>()
    let killTimes: number[] = []
    let killCount = 0
    let sparkleRung = 0
    let lastSparkle = 0
    let lastLayer = 0

    function level(): number {
        return muted ? 0 : volume
    }

    function build(): Graph | null {
        if (graph || destroyed) return graph
        if (typeof window === 'undefined') return null
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return null
        const ctx = new Ctor({ latencyHint: 'interactive' })
        const kit = new Kit(ctx)

        const master = ctx.createGain()
        master.gain.value = level()
        master.connect(ctx.destination)

        const limiter = ctx.createDynamicsCompressor()
        limiter.threshold.value = -2
        limiter.knee.value = 0
        limiter.ratio.value = 20
        limiter.attack.value = 0.001
        limiter.release.value = 0.08
        limiter.connect(master)

        const glue = ctx.createDynamicsCompressor()
        glue.threshold.value = -16
        glue.knee.value = 10
        glue.ratio.value = 4
        glue.attack.value = 0.004
        glue.release.value = 0.18
        glue.connect(limiter)

        const sfxBus = ctx.createGain()
        sfxBus.gain.value = 0.9
        sfxBus.connect(glue)

        const musicBus = ctx.createGain()
        musicBus.gain.value = 0.5
        musicBus.connect(glue)

        const reverb = ctx.createConvolver()
        reverb.buffer = kit.impulse(2.4, 3)
        const reverbIn = ctx.createGain()
        reverbIn.gain.value = 0.5
        reverbIn.connect(reverb)
        const reverbOut = ctx.createGain()
        reverbOut.gain.value = 0.6
        reverb.connect(reverbOut)
        reverbOut.connect(glue)

        // music-only reverb send and tempo-ish echo
        const musicReverb = ctx.createGain()
        musicReverb.gain.value = 0.7
        musicReverb.connect(reverb)
        const delay = ctx.createDelay(1)
        delay.delayTime.value = 0.39
        const feedback = ctx.createGain()
        feedback.gain.value = 0.38
        const damp = ctx.createBiquadFilter()
        damp.type = 'lowpass'
        damp.frequency.value = 2400
        const delayIn = ctx.createGain()
        delayIn.gain.value = 0.6
        delayIn.connect(delay)
        delay.connect(damp)
        damp.connect(feedback)
        feedback.connect(delay)
        damp.connect(musicBus)

        const music = new Music(kit, musicBus, musicReverb, delayIn)
        music.setIntensity(wantedIntensity)
        graph = { ctx, kit, master, sfxBus, reverbIn, music }
        return graph
    }

    function voicesFor(name: SfxName, now: number): Live[] {
        const list = (live.get(name) ?? []).filter(v => v.end > now)
        live.set(name, list)
        return list
    }

    /** Starts per second of `name` over the last half second */
    function rateOf(name: SfxName, now: number): number {
        const list = (recent.get(name) ?? []).filter(x => x > now - 0.5)
        list.push(now)
        recent.set(name, list)
        return list.length * 2
    }

    function layer(g: Graph, fn: (k: Kit, out: AudioNode, t: number) => number, vol: number): void {
        const { ctx, kit, sfxBus } = g
        const now = ctx.currentTime
        if (allEnds.length >= MAX_VOICES) return
        const out = ctx.createGain()
        out.gain.value = vol
        out.connect(sfxBus)
        const dur = fn(kit, out, now + 0.004)
        allEnds.push(now + dur)
        setTimeout(() => {
            try {
                out.disconnect()
            } catch {
                // already gone
            }
        }, (dur + 0.4) * 1000)
    }

    /** Kill streak: a sub thump every few kills and a climbing sparkle when it's a massacre */
    function streakLayers(g: Graph, now: number, vol: number): void {
        killTimes = killTimes.filter(x => x > now - 1)
        killTimes.push(now)
        killCount++
        const rate = killTimes.length
        if (rate < 7) {
            if (now - lastSparkle > 1.2) sparkleRung = 0
            return
        }
        const heat = Math.min(1, (rate - 7) / 20)
        if (killCount % 3 === 0 && now - lastLayer > 0.07) {
            lastLayer = now
            layer(g, (k, out, t) => killThump(k, out, t, heat), 0.22 * vol)
        }
        if (rate >= 14 && killCount % 4 === 0 && now - lastSparkle > 0.09) {
            lastSparkle = now
            const rung = sparkleRung++
            layer(g, (k, out, t) => killSparkle(k, out, t, rung), 0.18 * vol * (0.6 + heat * 0.4))
        }
    }

    return {
        play(name: SfxName, opts?: SfxOptions) {
            try {
                if (!graph || destroyed || muted) return
                const { ctx, kit, sfxBus, reverbIn } = graph
                if (ctx.state !== 'running') return
                const rule = RULES[name]
                const voice = SOUNDS[name]
                if (!rule || !voice) return
                const now = ctx.currentTime
                if (now - (lastStart.get(name) ?? -1) < rule.gap) return
                const mine = voicesFor(name, now)
                if (mine.length >= rule.max) {
                    if (!rule.steal) return
                    // fade the oldest voice out fast and reuse its slot
                    const old = mine.shift()!
                    try {
                        old.out.gain.cancelScheduledValues(now)
                        old.out.gain.setValueAtTime(old.out.gain.value, now)
                        old.out.gain.linearRampToValueAtTime(0, now + 0.018)
                    } catch {
                        // ignore
                    }
                }
                allEnds = allEnds.filter(e => e > now)
                if (allEnds.length >= MAX_VOICES || (rule.spam && allEnds.length >= CROWDED && !rule.steal)) return
                lastStart.set(name, now)

                const pitch = Math.max(0.1, Math.min(8, opts?.pitch ?? 1)) * (1 + (Math.random() * 2 - 1) * rule.jitter)
                let vol = Math.max(0, Math.min(1.5, opts?.volume ?? 1)) * rule.volume
                // spammy sounds duck themselves as their rate climbs (~-6 dB at 20/s)
                if (rule.spam) vol /= Math.sqrt(1 + rateOf(name, now) / 7)
                if (rule.spam && allEnds.length >= CROWDED) vol *= 0.7
                if (vol <= 0.001) return
                if (name === 'kill') streakLayers(graph, now, Math.max(0.4, Math.min(1, opts?.volume ?? 1)))
                const out = ctx.createGain()
                out.gain.value = vol
                const nodes: AudioNode[] = [out]
                const pan = opts?.pan
                if (pan && ctx.createStereoPanner) {
                    const panner = ctx.createStereoPanner()
                    panner.pan.value = Math.max(-1, Math.min(1, pan))
                    out.connect(panner)
                    panner.connect(sfxBus)
                    nodes.push(panner)
                } else {
                    out.connect(sfxBus)
                }
                if (rule.wet) {
                    const send = ctx.createGain()
                    send.gain.value = rule.wet
                    out.connect(send)
                    send.connect(reverbIn)
                    nodes.push(send)
                }
                const dur = voice(kit, out, now + 0.004, pitch)
                mine.push({ end: now + dur, out })
                allEnds.push(now + dur)
                setTimeout(() => {
                    for (const n of nodes) {
                        try {
                            n.disconnect()
                        } catch {
                            // already gone
                        }
                    }
                }, (dur + 0.4) * 1000)
            } catch {
                // audio must never break the game
            }
        },
        unlock() {
            try {
                const g = build()
                if (!g) return
                if (g.ctx.state === 'suspended') void g.ctx.resume().catch(() => {})
                if (g.music.mode !== wantedMode) g.music.play(wantedMode)
            } catch {
                // ignore
            }
        },
        music(mode: MusicMode) {
            wantedMode = mode
            try {
                if (graph && !destroyed) graph.music.play(mode)
            } catch {
                // ignore
            }
        },
        setIntensity(value: number) {
            wantedIntensity = value
            try {
                graph?.music.setIntensity(value)
            } catch {
                // ignore
            }
        },
        setMuted(value: boolean) {
            muted = value
            try {
                if (!graph) return
                const now = graph.ctx.currentTime
                graph.master.gain.cancelScheduledValues(now)
                graph.master.gain.setValueAtTime(graph.master.gain.value, now)
                graph.master.gain.linearRampToValueAtTime(level(), now + 0.08)
            } catch {
                // ignore
            }
        },
        get muted() {
            return muted
        },
        setVolume(value: number) {
            volume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.8))
            try {
                if (!graph) return
                const now = graph.ctx.currentTime
                graph.master.gain.cancelScheduledValues(now)
                graph.master.gain.setValueAtTime(graph.master.gain.value, now)
                graph.master.gain.linearRampToValueAtTime(level(), now + 0.05)
            } catch {
                // ignore
            }
        },
        destroy() {
            destroyed = true
            try {
                graph?.music.destroy()
                void graph?.ctx.close().catch(() => {})
            } catch {
                // ignore
            }
            graph = null
        }
    }
}
