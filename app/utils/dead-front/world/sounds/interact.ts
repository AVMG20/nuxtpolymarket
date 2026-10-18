import { DF_MACHINE_TIMES } from '#shared/utils/dead-front/constants'
import { at, filterNode, gainNode, mtof, oscNode, reverbSend, rnd } from './noise'
import type { Rt } from './noise'
import {
    clickTrain, crack, creak, fmBell, metal, noiseBurst, noiseSwell, scatter, thud
} from './parts'

// Barricades, doors, debris and the mystery box mechanics.

/** A nail pulling out of wood: a short, dull screech (lowpassed so it never gets shrill). */
function nailScreech(r: Rt, dur: number, gainV: number): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 2600 * r.rate, 0.7, g)
    const bp = filterNode(ctx, 'bandpass', 1500 * r.rate, 4, lp)
    const f0 = rnd(1250, 1600)
    const o = oscNode(ctx, 'sawtooth', f0 * r.rate, t, dur + 0.05, bp)
    o.frequency.exponentialRampToValueAtTime(f0 * rnd(0.6, 0.75) * r.rate, t + dur)
    const vib = gainNode(ctx, 60, o.detune)
    oscNode(ctx, 'sine', rnd(28, 40), t, dur + 0.05, vib)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gainV * r.vol, t + 0.03)
    g.gain.linearRampToValueAtTime(gainV * 0.6 * r.vol, t + dur * 0.7)
    g.gain.linearRampToValueAtTime(0, t + dur)
}

/** A zombie tears a board off the window. */
export function boardRip(r: Rt): void {
    creak(r, { dur: 0.18, from: 35, to: 80, res: [480, 1100, 1900], gain: 0.22, attack: 0.03 })
    const c = at(r, rnd(0.14, 0.19))
    crack(c, { gain: 0.55, freq: rnd(650, 900), snap: 2800 })
    crack(at(c, rnd(0.03, 0.06)), { gain: 0.3, freq: rnd(900, 1300), snap: 3400 })
    thud(c, { freq: 140, freqEnd: 70, dur: 0.14, gain: 0.3, body: 0.5, bodyFreq: 900, click: 0 })
    // Splinters.
    clickTrain(c, scatter(14, 0.22, 1.5), { freq: 3000, q: 1.3, gain: 0.22, len: 0.006, jitter: 0.6 })
    clickTrain(c, scatter(7, 0.2, 1.3), { freq: 1200, q: 2.5, gain: 0.2, len: 0.012 })
    nailScreech(at(c, 0.02), rnd(0.2, 0.3), 0.06)
    // The board clatters away.
    const fall = at(c, rnd(0.32, 0.4))
    crack(fall, { gain: 0.2, freq: 520, snap: 1800 })
    crack(at(fall, 0.09), { gain: 0.1, freq: 600, snap: 1800 })
}

/** Nailing a board back on: a hammer bang, a second tap, the board rattling into place. */
export function boardSlam(r: Rt): void {
    thud(r, { freq: 160, freqEnd: 75, dur: 0.18, gain: 0.45, body: 0.6, bodyFreq: 1000, click: 0.3 })
    crack(r, { gain: 0.45, freq: rnd(600, 800), snap: 2400 })
    metal(r, { base: rnd(2300, 2600), ratios: [1, 1.48], decay: 0.12, gain: 0.07, strike: 0 })
    const tap = at(r, rnd(0.13, 0.17))
    crack(tap, { gain: 0.25, freq: rnd(700, 900), snap: 2600 })
    metal(tap, { base: rnd(2400, 2700), ratios: [1, 1.52], decay: 0.1, gain: 0.05, strike: 0 })
    clickTrain(at(r, 0.03), [0, 0.04, 0.075, 0.11, 0.14, 0.17, 0.2, 0.23], {
        freq: 900, q: 3, gain: 0.18, len: 0.014, gains: [1, 0.8, 0.7, 0.55, 0.45, 0.35, 0.25, 0.15]
    })
}

/** Rubble and timber collapsing when a debris door is cleared (~1.5 s). */
export function debrisCrash(r: Rt): void {
    creak(r, { dur: 0.3, from: 25, to: 60, res: [300, 720, 1400], gain: 0.22, attack: 0.05 })
    const c = at(r, 0.22)
    crack(c, { gain: 0.6, freq: 520, snap: 2000, dur: 0.05 })
    thud(c, { freq: 70, freqEnd: 32, dur: 0.6, gain: 0.6, body: 1, bodyFreq: 380, click: 0.2 })
    noiseSwell(c, { kind: 'brown', type: 'lowpass', freq: 900, freqEnd: 300, q: 0.7, gain: 0.55, dur: 1.3, peakAt: 0.15 })
    noiseSwell(c, { kind: 'pink', type: 'bandpass', freq: 1600, freqEnd: 900, q: 0.6, gain: 0.12, dur: 1.2, peakAt: 0.2 })
    // Beams and stones landing, thinning out.
    const hits = scatter(14, 1.1, 1.6)
    hits.forEach((h, i) => {
        const k = rnd(0.7, 1.4)
        const fade = 1 - i / hits.length * 0.7
        const p = at(c, 0.05 + h)
        if (i % 3 === 0) crack(p, { gain: 0.25 * fade, freq: 450 * k, snap: 1600 })
        thud(p, { freq: 110 * k, freqEnd: 55 * k, dur: 0.15, gain: 0.3 * fade, body: 0.6, bodyFreq: 700, click: 0.1 })
    })
    clickTrain(c, scatter(45, 1.25, 1.5), { freq: 1800, q: 1.2, gain: 0.2, len: 0.01, jitter: 0.7 })
    clickTrain(c, scatter(20, 1.2, 1.4), { freq: 600, q: 2, gain: 0.25, len: 0.02, kind: 'pink', jitter: 0.6 })
    // Dust settling.
    noiseSwell(at(c, 0.4), { kind: 'pink', type: 'highpass', freq: 2500, q: 0.6, gain: 0.04, dur: 0.9, peakAt: 0.3 })
}

/** A wooden door bursts open and swings on its hinges, banging into the wall. */
export function doorOpen(r: Rt): void {
    crack(r, { gain: 0.5, freq: 600, snap: 2400, dur: 0.045 })
    thud(r, { freq: 110, freqEnd: 50, dur: 0.3, gain: 0.45, body: 0.7, bodyFreq: 600, click: 0.2 })
    clickTrain(r, scatter(10, 0.15, 1.4), { freq: 2600, q: 1.3, gain: 0.18, len: 0.006 })
    metal(at(r, 0.01), { base: 820, ratios: [1, 2.3, 3.9], decay: 0.25, gain: 0.07, strike: 0 })
    // Hinge creak as it swings.
    creak(at(r, 0.08), { dur: rnd(0.75, 0.95), from: rnd(60, 80), to: rnd(110, 150), res: [780, 1350, 2300], q: 11, gain: 0.18, attack: 0.06 })
    const bang = at(r, rnd(0.95, 1.08))
    thud(bang, { freq: 95, freqEnd: 50, dur: 0.3, gain: 0.4, body: 0.8, bodyFreq: 500, click: 0.15 })
    crack(bang, { gain: 0.25, freq: 500, snap: 1800 })
}

/** Box lid unlatched and creaking open. */
export function boxOpen(r: Rt): void {
    metal(r, { base: rnd(1700, 1900), ratios: [1, 1.71, 2.6], decay: 0.12, gain: 0.12, strike: 0.6 })
    clickTrain(r, [0, 0.035], { freq: 2400, q: 3, gain: 0.25, len: 0.008 })
    creak(at(r, 0.06), { dur: 0.55, from: 30, to: 55, res: [520, 1250, 2050], q: 10, gain: 0.2, attack: 0.05 })
    thud(at(r, 0.62), { freq: 120, freqEnd: 70, dur: 0.15, gain: 0.2, body: 0.5, bodyFreq: 800, click: 0.1 })
}

/** Ratchet ticks of the weapon wheel, decelerating over the whole roll. */
export function boxRoll(r: Rt): void {
    const dur = DF_MACHINE_TIMES.boxRoll
    const times: number[] = []
    let tt = 0
    while (tt < dur - 0.05) {
        times.push(tt)
        const k = tt / dur
        tt += 0.055 + k * k * 0.3 + rnd(-0.008, 0.008)
    }
    const gains = times.map(v => 1 - v / dur * 0.45)
    clickTrain(r, times, { freq: 3000, q: 3, gain: 0.2, len: 0.007, gains, jitter: 0.15 })
    clickTrain(r, times.map(v => v + 0.004), { freq: 850, q: 4, gain: 0.22, len: 0.016, gains, jitter: 0.15 })
    // Faint mechanism whir.
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const bp = filterNode(ctx, 'bandpass', 420 * r.rate, 2, g)
    const o = oscNode(ctx, 'sawtooth', 38 * r.rate, t, dur + 0.05, bp)
    o.frequency.linearRampToValueAtTime(14 * r.rate, t + dur)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.05 * r.vol, t + 0.2)
    g.gain.linearRampToValueAtTime(0, t + dur)
}

/** Lid slammed shut. */
export function boxClose(r: Rt): void {
    creak(r, { dur: 0.18, from: 50, to: 30, res: [520, 1250], gain: 0.12, attack: 0.03 })
    const s = at(r, 0.16)
    thud(s, { freq: 95, freqEnd: 50, dur: 0.3, gain: 0.5, body: 0.8, bodyFreq: 550, click: 0.2 })
    crack(s, { gain: 0.3, freq: 520, snap: 1800 })
    metal(at(s, 0.04), { base: 1800, ratios: [1, 1.7], decay: 0.1, gain: 0.08, strike: 0.4 })
}

/** The box leaves: rattling chains, a creak and a mocking descending chime. */
export function boxMove(r: Rt): void {
    // Chain links: dense metallic ticks swelling and fading, plus a few rings.
    const links = scatter(70, 1.6, 1).map(v => v + 0.05)
    const gains = links.map(v => Math.sin(Math.PI * Math.min(1, v / 1.65)) ** 0.7)
    clickTrain(r, links, { freq: 3400, q: 4, gain: 0.18, len: 0.01, gains, jitter: 0.6 })
    clickTrain(r, links.map(v => v + 0.003), { freq: 1700, q: 3, gain: 0.1, len: 0.014, gains, jitter: 0.6 })
    for (let i = 0; i < 6; i++) {
        metal(at(r, rnd(0.1, 1.5)), { base: rnd(1900, 2900), ratios: [1, 1.63, 2.42], decay: 0.18, gain: 0.05, strike: 0.2 })
    }
    creak(at(r, 0.2), { dur: 1.2, from: 22, to: 40, res: [400, 900, 1700], gain: 0.15, attack: 0.2 })
    // Mocking chime: a slow diminished slide down, with an echoing tail.
    const send = reverbSend(r.ctx, r.out, 0.45, 2.2, 3, 0.4)
    const chime = { ...r, out: send, t: r.t + 0.75 }
    const notes = [83, 80, 77, 74, 68]
    notes.forEach((m, i) => {
        fmBell(at(chime, i * 0.24 + (i === notes.length - 1 ? 0.12 : 0)), {
            freq: mtof(m), dur: i === notes.length - 1 ? 1.6 : 0.8, gain: 0.12, ratio: 3.01, index: 1.1, detune: rnd(-10, 10)
        })
    })
    // A low, sour bong under the last note.
    fmBell(at(chime, 1.08), { freq: mtof(50), dur: 1.8, gain: 0.12, ratio: 1.41, index: 2, bite: 0.6 })
}

/** The box thumps down at its new spot. */
export function boxLand(r: Rt): void {
    thud(r, { freq: 65, freqEnd: 32, dur: 0.6, gain: 0.65, body: 1, bodyFreq: 350, click: 0.25 })
    crack(r, { gain: 0.35, freq: 420, snap: 1600 })
    noiseSwell(r, { kind: 'brown', type: 'lowpass', freq: 700, freqEnd: 300, q: 0.7, gain: 0.3, dur: 0.6, peakAt: 0.08 })
    noiseBurst(at(r, 0.02), { kind: 'pink', type: 'highpass', freq: 2000, q: 0.6, gain: 0.04, dur: 0.6 })
    clickTrain(at(r, 0.06), [0, 0.05, 0.09, 0.14, 0.2, 0.27], {
        freq: 3000, q: 4, gain: 0.12, len: 0.01, gains: [1, 0.8, 0.6, 0.45, 0.3, 0.2]
    })
}
