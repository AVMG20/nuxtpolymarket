import { at, clamp, gainNode, filterNode, noise, oscNode, randomWalk, rnd } from './noise'
import type { Rt } from './noise'
import {
    bubbles, clickTrain, creak, crack, metal, noiseBurst, noiseSwell, scatter, thud
} from './parts'

// Zombie body sounds: swipes, hits, pops, gibs, falls, helmet hits, rising
// from the mud, spitting, gas, climbing through windows.

/** Claw swipe: a fast filtered whoosh with a cloth flutter. */
export function swipe(r: Rt): void {
    const dur = rnd(0.2, 0.3)
    const f = rnd(450, 650)
    noiseSwell(r, { kind: 'pink', type: 'bandpass', freq: f, freqEnd: f * rnd(3.5, 5), q: 1.1, gain: 0.5, dur, peakAt: 0.55 })
    noiseSwell(r, { kind: 'white', type: 'bandpass', freq: 1800, freqEnd: 1100, q: 2, gain: 0.08, dur: dur * 0.9, peakAt: 0.6 })
}

/** Wet flesh impact. */
export function flesh(r: Rt): void {
    const k = rnd(0.85, 1.2)
    thud(r, { freq: 110 * k, freqEnd: 55 * k, dur: 0.16, gain: 0.45, body: 0.5, bodyFreq: 700, click: 0.2 })
    noiseBurst(r, { kind: 'pink', type: 'bandpass', freq: 1300 * k, freqEnd: 380, q: 2.2, gain: 0.45, dur: rnd(0.08, 0.14) })
    if (Math.random() < 0.6) bubbles(at(r, rnd(0.02, 0.05)), scatter(3, 0.12), 300, 700, 0.12, 0.025)
}

/** Headshot: a wet pop, a bony crunch and a splatter. */
export function headPop(r: Rt): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const o = oscNode(ctx, 'sine', 380 * r.rate, t, 0.1, g)
    o.frequency.exponentialRampToValueAtTime(70 * r.rate, t + 0.07)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.5 * r.vol, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09)
    noiseBurst(r, { type: 'bandpass', freq: 1600, q: 1.2, gain: 0.45, dur: 0.045 })
    clickTrain(at(r, 0.01), scatter(9, 0.09, 1.3), { freq: 2300, q: 1.4, gain: 0.35, len: 0.008, jitter: 0.5 })
    clickTrain(at(r, 0.015), scatter(6, 0.08, 1.2), { freq: 700, q: 2, gain: 0.4, len: 0.012 })
    noiseBurst(at(r, 0.02), { kind: 'pink', type: 'lowpass', freq: 1400, freqEnd: 350, q: 1.2, gain: 0.35, dur: 0.3 })
    bubbles(at(r, 0.08), scatter(5, 0.35, 1.5), 260, 600, 0.12, 0.03)
}

/** Gib: a heavy splatter with chunks landing around. */
export function gib(r: Rt): void {
    thud(r, { freq: 95, freqEnd: 45, dur: 0.3, gain: 0.5, body: 0.8, bodyFreq: 600, click: 0.2 })
    noiseBurst(r, { kind: 'pink', type: 'lowpass', freq: 2200, freqEnd: 400, q: 1, gain: 0.5, attack: 0.004, dur: 0.4 })
    noiseBurst(r, { kind: 'white', type: 'bandpass', freq: 1100, freqEnd: 500, q: 1.5, gain: 0.25, dur: 0.18 })
    const chunks = scatter(7, 0.6, 1.1).map(v => v + 0.12)
    for (const c of chunks) {
        const k = rnd(0.8, 1.4)
        noiseBurst(at(r, c), { kind: 'pink', type: 'bandpass', freq: 900 * k, freqEnd: 300 * k, q: 2, gain: rnd(0.08, 0.2), dur: rnd(0.05, 0.1) })
    }
    bubbles(at(r, 0.1), scatter(12, 0.7, 1.4), 220, 650, 0.14, 0.03)
}

/** A body collapsing: heavy thud, limbs and webbing, cloth. */
export function bodyFall(r: Rt): void {
    const k = rnd(0.85, 1.15)
    thud(r, { freq: 80 * k, freqEnd: 38 * k, dur: 0.38, gain: 0.55, body: 0.9, bodyFreq: 450, click: 0.15 })
    noiseSwell(r, { kind: 'pink', type: 'bandpass', freq: 1400, freqEnd: 900, q: 0.8, gain: 0.12, dur: 0.32, peakAt: 0.25 })
    const limb = rnd(0.12, 0.22)
    thud(at(r, limb), { freq: 120 * k, freqEnd: 60 * k, dur: 0.16, gain: 0.25, body: 0.6, bodyFreq: 600, click: 0.15 })
    // Webbing buckles and a canteen.
    clickTrain(at(r, 0.02), scatter(6, 0.3, 1.6), { freq: 2600, q: 5, gain: 0.08, len: 0.01 })
    noiseSwell(at(r, limb), { kind: 'brown', type: 'lowpass', freq: 600, q: 0.7, gain: 0.18, dur: 0.4, peakAt: 0.1 })
}

/** Bullet off a steel helmet: a bright metallic clang with inharmonic ring. */
export function helmetClang(r: Rt): void {
    const base = rnd(430, 540)
    metal(r, { base, ratios: [1, 1.52, 2.31, 3.17, 4.08, 5.24], decay: rnd(0.7, 1), gain: 0.32, strike: 0.5, spread: 0.015 })
    metal(r, { base: base * 0.51, ratios: [1, 2.76], decay: 0.25, gain: 0.18, strike: 0 })
    // Sometimes a ricochet whine (short, kept dull so it's not shrill).
    if (Math.random() < 0.5) return
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 3000, 0.7, g)
    const o = oscNode(ctx, 'sine', rnd(1800, 2300) * r.rate, t + 0.02, 0.35, lp)
    o.frequency.exponentialRampToValueAtTime(rnd(700, 900) * r.rate, t + 0.32)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.05 * r.vol, t + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0003, t + 0.32)
    g.gain.linearRampToValueAtTime(0, t + 0.34)
}

/** Clawing out of the mud: dirt crumbles and stones (the groan comes from the vocal governor). */
export function rise(r: Rt): void {
    noiseSwell(r, { kind: 'brown', type: 'lowpass', freq: 700, freqEnd: 400, q: 0.8, gain: 0.45, dur: 1.4, peakAt: 0.3 })
    noiseSwell(r, { kind: 'pink', type: 'bandpass', freq: 1200, q: 0.8, gain: 0.1, dur: 1.1, peakAt: 0.35 })
    clickTrain(r, scatter(40, 1.3, 1.3), { freq: 1500, q: 1, gain: 0.22, len: 0.012, jitter: 0.7 })
    clickTrain(r, scatter(18, 1.1, 1.2), { freq: 500, q: 1.5, gain: 0.3, len: 0.025, kind: 'pink', jitter: 0.6 })
    thud(at(r, rnd(0.15, 0.3)), { freq: 70, freqEnd: 40, dur: 0.25, gain: 0.3, body: 0.8, bodyFreq: 400, click: 0 })
    // A wet breath as the head comes out of the earth.
    noiseSwell(at(r, rnd(0.4, 0.6)), { kind: 'pink', type: 'bandpass', freq: 600, freqEnd: 420, q: 1.6, gain: 0.08, dur: 0.6, peakAt: 0.3 })
}

/** The Ironclad Brute's footfall: a heavy, low stomp in the mud with a plate rattle. */
export function bruteStep(r: Rt): void {
    const k = rnd(0.9, 1.1)
    thud(r, { freq: 62 * k, freqEnd: 32 * k, dur: 0.32, gain: 0.6, body: 0.9, bodyFreq: 260, click: 0.05 })
    noiseBurst(at(r, 0.01), { kind: 'brown', type: 'lowpass', freq: 520, freqEnd: 180, q: 0.8, gain: 0.3, dur: 0.22 })
    // Mud squelch as the boot sinks.
    noiseBurst(at(r, 0.03), { kind: 'pink', type: 'bandpass', freq: 750 * k, freqEnd: 380, q: 2.2, gain: 0.1, dur: 0.12 })
    // Iron plates and buckles shifting.
    if (Math.random() < 0.6) {
        clickTrain(at(r, rnd(0.04, 0.08)), scatter(4, 0.1, 1.2), { freq: 1900, q: 4, gain: 0.05, len: 0.01, jitter: 0.5 })
        metal(at(r, 0.05), { base: rnd(380, 460), ratios: [1, 1.7, 2.6], decay: 0.25, gain: 0.04, strike: 0 })
    }
}

/** The bloater's swollen gut churning: low wet bubbling and a sloshing burble. */
export function bloaterGurgle(r: Rt): void {
    const dur = rnd(0.9, 1.3)
    bubbles(r, scatter(Math.round(rnd(9, 14)), dur, 1.1), 140, 360, 0.2, 0.05)
    noiseSwell(r, { kind: 'brown', type: 'lowpass', freq: 380, freqEnd: 260, q: 2, gain: 0.25, dur, peakAt: 0.4 })
    if (Math.random() < 0.5) thud(at(r, dur * rnd(0.3, 0.6)), { freq: 90, freqEnd: 60, dur: 0.18, gain: 0.12, body: 0.5, bodyFreq: 300, click: 0 })
}

/** Wet hawk and spit (bloater / ghoul ranged attack). */
export function spit(r: Rt): void {
    const { ctx, t } = r
    // Throat rattle building up.
    const dur = rnd(0.32, 0.42)
    const g = gainNode(ctx, 0, r.out)
    const fl = gainNode(ctx, 1, g)
    const bp = filterNode(ctx, 'bandpass', 950 * r.rate, 2.2, fl)
    noise(ctx, 'pink', t, dur + 0.05, bp)
    bp.frequency.setValueAtTime(700 * r.rate, t)
    bp.frequency.exponentialRampToValueAtTime(1400 * r.rate, t + dur)
    const curve = new Float32Array(Math.ceil(dur * 240))
    for (let i = 0; i < curve.length; i++) curve[i] = 0.5 + 0.5 * Math.sin(i * 0.8 + Math.random())
    fl.gain.setValueCurveAtTime(curve, t, dur)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.4 * r.vol, t + dur * 0.85)
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02)
    // "Ptoo": a wet burst.
    const p = at(r, dur)
    noiseBurst(p, { kind: 'white', type: 'bandpass', freq: 2200, freqEnd: 600, q: 1.4, gain: 0.45, dur: 0.12 })
    noiseBurst(p, { kind: 'pink', type: 'lowpass', freq: 1000, q: 1, gain: 0.25, dur: 0.2 })
    bubbles(p, scatter(5, 0.18), 300, 700, 0.15, 0.025)
}

/** Gas venting (bloater cloud). */
export function gas(r: Rt): void {
    const { ctx, t } = r
    const dur = rnd(1.1, 1.5)
    const g = gainNode(ctx, 0, r.out)
    const sputter = gainNode(ctx, 1, g)
    const lp = filterNode(ctx, 'lowpass', 3000 * r.rate, 0.7, sputter)
    const hp = filterNode(ctx, 'highpass', 1100 * r.rate, 0.7, lp)
    noise(ctx, 'pink', t, dur + 0.05, hp)
    const low = filterNode(ctx, 'bandpass', 500 * r.rate, 0.8, gainNode(ctx, 0.6, sputter))
    noise(ctx, 'pink', t, dur + 0.05, low)
    const w = randomWalk(Math.ceil(dur * 30), 0.2, 0.25)
    for (let i = 0; i < w.length; i++) w[i] = clamp(0.8 + (w[i] ?? 0), 0.4, 1.1)
    sputter.gain.setValueCurveAtTime(w, t, dur)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.22 * r.vol, t + 0.04)
    g.gain.linearRampToValueAtTime(0.14 * r.vol, t + dur * 0.6)
    g.gain.linearRampToValueAtTime(0, t + dur)
}

/** Climbing through a window: scrape on wood, a creak, then a thump onto the floor. */
export function climb(r: Rt): void {
    noiseSwell(r, { kind: 'pink', type: 'bandpass', freq: 900, freqEnd: 1500, q: 3, gain: 0.25, dur: 0.38, peakAt: 0.5 })
    clickTrain(r, scatter(10, 0.35), { freq: 1800, q: 2, gain: 0.08, len: 0.01 })
    creak(at(r, 0.05), { dur: 0.3, from: 45, to: 70, res: [520, 1150], gain: 0.12 })
    crack(at(r, 0.02), { gain: 0.15, freq: 650 })
    const land = rnd(0.42, 0.52)
    thud(at(r, land), { freq: 90, freqEnd: 45, dur: 0.28, gain: 0.5, body: 0.8, bodyFreq: 500, click: 0.2 })
    noiseSwell(at(r, land), { kind: 'brown', type: 'lowpass', freq: 800, q: 0.7, gain: 0.15, dur: 0.3, peakAt: 0.1 })
}
