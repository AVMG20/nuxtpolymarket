import type { DfEnemyType } from '#shared/utils/dead-front/types'
import { rnd, rndPick } from './noise'
import type { Rt } from './noise'
import { bubbles, noiseBurst, noiseSwell, scatter } from './parts'
import { dfVoice } from './voice'
import type { Vowel } from './voice'

// Zombie vocals per enemy type: idle groans, attack screeches, death cries.
// Each call re-rolls pitch, length and vowel path so a horde never repeats.

type VowelPath = readonly (readonly [number, Vowel])[]

function moanPath(): VowelPath {
    return rndPick<VowelPath>([
        [[0, 'u'], [0.35, 'a'], [0.75, 'o'], [1, 'u']],
        [[0, 'uh'], [0.4, 'aw'], [1, 'u']],
        [[0, 'o'], [0.3, 'a'], [0.6, 'aw'], [1, 'uh']],
        [[0, 'u'], [0.5, 'o'], [0.8, 'aw'], [1, 'o']]
    ])
}

// ---------------------------------------------------------------- groans

function shamblerGroan(r: Rt): void {
    const p = rnd(78, 112)
    const dur = rnd(1.1, 1.9)
    const sigh = Math.random() < 0.35
    dfVoice(r, {
        dur,
        pitch: sigh
            ? [[0, p * 1.15], [0.3, p * 1.2], [1, p * 0.7]]
            : [[0, p * 0.88], [0.25, p * 1.08], [0.6, p * 1.0], [1, p * 0.74]],
        vowels: moanPath(),
        tract: rnd(0.78, 0.9),
        vibRate: rnd(4, 6),
        vibDepth: rnd(15, 30),
        jitter: rnd(40, 80),
        detune: rnd(12, 25),
        sub: rnd(0, 0.2),
        breath: rnd(0.2, 0.35),
        rasp: rnd(0.45, 0.75),
        attack: rnd(0.18, 0.3),
        release: rnd(0.45, 0.7),
        gain: 0.4,
        lowpass: rnd(1700, 2200)
    })
}

function ghoulGroan(r: Rt): void {
    const p = rnd(170, 240)
    const dur = rnd(0.6, 1.15)
    // Short inhaled gasp, then the hissing exhale screech.
    noiseSwell(r, { kind: 'pink', type: 'bandpass', freq: 1900, freqEnd: 2600, q: 1.2, gain: 0.06, dur: 0.22, peakAt: 0.8 })
    dfVoice({ ...r, t: r.t + 0.18 }, {
        dur,
        pitch: [[0, p * 0.9], [0.2, p * 1.3], [0.55, p * 1.1], [1, p * 0.8]],
        vowels: rndPick<VowelPath>([
            [[0, 'i'], [0.4, 'e'], [1, 'a']],
            [[0, 'e'], [0.5, 'a'], [1, 'uh']],
            [[0, 'i'], [0.6, 'a'], [1, 'e']]
        ]),
        tract: rnd(1, 1.12),
        vibRate: rnd(7, 10),
        vibDepth: rnd(30, 55),
        jitter: rnd(90, 150),
        detune: rnd(20, 35),
        breath: rnd(0.55, 0.75),
        hiss: rnd(0.05, 0.09),
        rasp: rnd(0.7, 1),
        attack: 0.06,
        release: rnd(0.25, 0.4),
        gain: 0.3,
        lowpass: rnd(2600, 3200)
    })
}

function bruteGroan(r: Rt): void {
    const p = rnd(52, 72)
    const dur = rnd(1.3, 2)
    dfVoice(r, {
        dur,
        pitch: [[0, p * 0.85], [0.3, p * 1.12], [0.7, p * 1.0], [1, p * 0.72]],
        vowels: rndPick<VowelPath>([
            [[0, 'o'], [0.4, 'a'], [1, 'u']],
            [[0, 'u'], [0.35, 'aw'], [0.8, 'o'], [1, 'u']]
        ]),
        tract: rnd(0.62, 0.72),
        vibRate: rnd(2.5, 4),
        vibDepth: rnd(20, 35),
        jitter: rnd(60, 100),
        detune: rnd(20, 35),
        sub: rnd(0.5, 0.75),
        breath: rnd(0.3, 0.45),
        rasp: rnd(0.9, 1.3),
        attack: rnd(0.2, 0.35),
        release: rnd(0.45, 0.7),
        gain: 0.5,
        lowpass: rnd(1300, 1700)
    })
}

function bloaterGroan(r: Rt): void {
    const p = rnd(92, 130)
    const dur = rnd(1, 1.8)
    dfVoice(r, {
        dur,
        pitch: [[0, p], [0.4, p * 1.1], [1, p * 0.78]],
        vowels: rndPick<VowelPath>([
            [[0, 'u'], [0.5, 'uh'], [1, 'u']],
            [[0, 'o'], [0.4, 'u'], [1, 'uh']]
        ]),
        tract: rnd(0.8, 0.9),
        vibRate: rnd(3, 5),
        vibDepth: 25,
        jitter: rnd(50, 90),
        detune: 18,
        sub: 0.15,
        breath: 0.3,
        rasp: rnd(0.35, 0.6),
        attack: 0.18,
        release: 0.45,
        gain: 0.42,
        lowpass: rnd(1400, 1800),
        flutter: { rate: rnd(8, 13), depth: rnd(0.45, 0.7) },
        gurgle: rnd(9, 15)
    })
}

// ---------------------------------------------------------------- attacks

function shamblerAttack(r: Rt): void {
    const p = rnd(125, 165)
    dfVoice(r, {
        dur: rnd(0.6, 0.85),
        pitch: [[0, p * 0.8], [0.12, p * 1.25], [0.5, p * 1.1], [1, p * 0.75]],
        vowels: [[0, 'uh'], [0.15, 'a'], [0.7, 'a'], [1, 'aw']],
        tract: rnd(0.82, 0.92),
        vibRate: 6,
        vibDepth: 30,
        jitter: 90,
        detune: 25,
        sub: 0.2,
        breath: 0.45,
        rasp: 1.15,
        attack: 0.03,
        release: 0.25,
        gain: 0.48,
        lowpass: 2500
    })
}

function ghoulAttack(r: Rt): void {
    const p = rnd(310, 400)
    dfVoice(r, {
        dur: rnd(0.6, 0.8),
        pitch: [[0, p * 0.75], [0.1, p * 1.2], [0.45, p * 1.05], [1, p * 0.6]],
        vowels: [[0, 'e'], [0.2, 'a'], [1, 'uh']],
        tract: rnd(1.02, 1.12),
        vibRate: 11,
        vibDepth: 60,
        jitter: 160,
        detune: 40,
        breath: 0.6,
        hiss: 0.1,
        rasp: 1.25,
        attack: 0.02,
        release: 0.25,
        gain: 0.3,
        lowpass: 3000
    })
}

function bruteAttack(r: Rt): void {
    const p = rnd(68, 92)
    dfVoice(r, {
        dur: rnd(0.8, 1.1),
        pitch: [[0, p * 0.8], [0.15, p * 1.3], [0.6, p * 1.15], [1, p * 0.7]],
        vowels: [[0, 'o'], [0.2, 'a'], [0.8, 'aw'], [1, 'o']],
        tract: rnd(0.66, 0.74),
        vibRate: 5,
        vibDepth: 30,
        jitter: 110,
        detune: 35,
        sub: 0.8,
        breath: 0.5,
        rasp: 1.6,
        attack: 0.04,
        release: 0.3,
        gain: 0.5,
        lowpass: 1900
    })
}

function bloaterAttack(r: Rt): void {
    const p = rnd(135, 170)
    dfVoice(r, {
        dur: rnd(0.65, 0.9),
        pitch: [[0, p * 0.85], [0.15, p * 1.2], [1, p * 0.75]],
        vowels: [[0, 'u'], [0.2, 'a'], [1, 'uh']],
        tract: 0.86,
        vibRate: 6,
        vibDepth: 35,
        jitter: 100,
        detune: 25,
        sub: 0.25,
        breath: 0.45,
        rasp: 1.2,
        attack: 0.03,
        release: 0.25,
        gain: 0.45,
        lowpass: 2200,
        flutter: { rate: rnd(12, 16), depth: 0.5 },
        gurgle: 14
    })
}

// ---------------------------------------------------------------- deaths

function shamblerDeath(r: Rt): void {
    const p = rnd(115, 150)
    const dur = rnd(1.1, 1.6)
    dfVoice(r, {
        dur,
        pitch: [[0, p * 1.1], [0.15, p * 1.2], [0.6, p * 0.75], [1, p * 0.42]],
        vowels: [[0, 'a'], [0.4, 'aw'], [0.75, 'o'], [1, 'u']],
        tract: rnd(0.8, 0.9),
        vibRate: 5,
        vibDepth: 30,
        jitter: 90,
        detune: 25,
        sub: 0.2,
        breath: 0.4,
        rasp: 1.2,
        attack: 0.03,
        release: 0.6,
        gain: 0.46,
        lowpass: 2600,
        flutter: { rate: rnd(14, 20), depth: 0.35 }
    })
}

function ghoulDeath(r: Rt): void {
    const p = rnd(280, 340)
    const dur = rnd(0.9, 1.25)
    dfVoice(r, {
        dur,
        pitch: [[0, p], [0.12, p * 1.15], [0.55, p * 0.7], [1, p * 0.38]],
        vowels: [[0, 'e'], [0.3, 'a'], [1, 'uh']],
        tract: 1.06,
        vibRate: 9,
        vibDepth: 60,
        jitter: 150,
        detune: 35,
        breath: 0.65,
        hiss: 0.1,
        rasp: 1.15,
        attack: 0.02,
        release: 0.5,
        gain: 0.3,
        lowpass: 2900,
        flutter: { rate: 18, depth: 0.3 }
    })
}

function bruteDeath(r: Rt): void {
    const p = rnd(70, 88)
    const dur = rnd(1.5, 2)
    dfVoice(r, {
        dur,
        pitch: [[0, p * 1.1], [0.2, p * 1.25], [0.6, p * 0.8], [1, p * 0.45]],
        vowels: [[0, 'a'], [0.3, 'aw'], [0.7, 'o'], [1, 'u']],
        tract: 0.68,
        vibRate: 3.5,
        vibDepth: 35,
        jitter: 110,
        detune: 35,
        sub: 0.75,
        breath: 0.45,
        rasp: 1.8,
        attack: 0.04,
        release: 0.8,
        gain: 0.5,
        lowpass: 2100,
        flutter: { rate: rnd(7, 10), depth: 0.3 }
    })
}

function bloaterDeath(r: Rt): void {
    const p = rnd(110, 140)
    const dur = rnd(1.2, 1.6)
    dfVoice(r, {
        dur,
        pitch: [[0, p * 1.1], [0.2, p * 1.15], [1, p * 0.5]],
        vowels: [[0, 'a'], [0.4, 'uh'], [1, 'u']],
        tract: 0.84,
        vibRate: 5,
        vibDepth: 35,
        jitter: 90,
        detune: 25,
        sub: 0.3,
        breath: 0.4,
        rasp: 0.9,
        attack: 0.03,
        release: 0.6,
        gain: 0.42,
        lowpass: 1900,
        flutter: { rate: rnd(15, 20), depth: 0.65 },
        gurgle: 22
    })
    // The swollen gut gives out: a wet squelch and a trickle.
    noiseBurst({ ...r, t: r.t + dur * 0.55 }, { kind: 'pink', type: 'lowpass', freq: 900, freqEnd: 300, q: 1.5, gain: 0.25, dur: 0.35 })
    bubbles({ ...r, t: r.t + dur * 0.6 }, scatter(10, 0.7, 1.4), 220, 520, 0.18, 0.035)
}

type Recipe = (r: Rt) => void

const VOICES: Record<DfEnemyType, { groan: Recipe, attack: Recipe, death: Recipe }> = {
    shambler: { groan: shamblerGroan, attack: shamblerAttack, death: shamblerDeath },
    ghoul: { groan: ghoulGroan, attack: ghoulAttack, death: ghoulDeath },
    brute: { groan: bruteGroan, attack: bruteAttack, death: bruteDeath },
    bloater: { groan: bloaterGroan, attack: bloaterAttack, death: bloaterDeath }
}

export const DF_ENEMY_VOICE_TYPES = Object.keys(VOICES) as DfEnemyType[]

export type DfVoiceKind = 'groan' | 'attack' | 'death'

export function zombieVoice(type: DfEnemyType, kind: DfVoiceKind): Recipe {
    return VOICES[type][kind]
}
