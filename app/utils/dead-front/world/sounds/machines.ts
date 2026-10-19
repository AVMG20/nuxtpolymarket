import { DF_MACHINE_TIMES } from '#shared/utils/dead-front/constants'
import {
    at, clamp, decayEnv, filterNode, gainNode, mtof, noise, oscNode, pulseWave, randomWalk, reverbSend, rnd, rndPick, waveNode
} from './noise'
import type { Rt } from './noise'
import {
    bell, clickTrain, crack, crackle, creak, fmBell, metal, noiseBurst, noiseSwell, ping, thud
} from './parts'

// Machines and electrics: the Pack-a-Punch press, perk machines, the power
// switch, fuses, the generator, zaps, souls and the easter-egg stinger.

/** A press stamp: heavy thud, a short iron clank. */
function stamp(r: Rt, k = 1): void {
    thud(r, { freq: 75 * k, freqEnd: 40 * k, dur: 0.3, gain: 0.55, body: 0.8, bodyFreq: 450, click: 0.25 })
    metal(r, { base: 310 * k, ratios: [1, 2.13, 3.4, 4.9], decay: 0.3, gain: 0.14, strike: 0.4 })
    clickTrain(at(r, 0.02), [0, 0.03, 0.06], { freq: 1500, q: 3, gain: 0.12, len: 0.012, gains: [1, 0.5, 0.25] })
}

/** A short steam hiss (relief valve). */
function steam(r: Rt, dur: number, gainV: number): void {
    noiseSwell(r, { kind: 'white', type: 'highpass', freq: 2600, freqEnd: 3800, q: 0.6, gain: gainV, dur, peakAt: 0.12 })
    noiseSwell(r, { kind: 'pink', type: 'bandpass', freq: 1200, q: 0.8, gain: gainV * 0.5, dur: dur * 0.8, peakAt: 0.1 })
}

/** Pack-a-Punch working: the dynamo whines up, the press stamps four times, steam, then the bell. */
export function papWork(r: Rt): void {
    const { ctx, t } = r
    const dur = DF_MACHINE_TIMES.papWork
    // Dynamo whine: a geared saw + sine pair spinning up, holding, winding down.
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 1800 * r.rate, 1, g)
    const curve: (readonly [number, number])[] = [[0, 50], [0.9, 380], [dur - 0.5, 400], [dur, 120]]
    for (const [type, mul, lvl] of [['sawtooth', 1, 0.35], ['sine', 2, 0.6], ['sine', 3.02, 0.2]] as const) {
        const o = oscNode(ctx, type, 50, t, dur + 0.05, gainNode(ctx, lvl, lp))
        let first = true
        for (const [dt, f] of curve) {
            if (first) o.frequency.setValueAtTime(f * mul * r.rate, t + dt)
            else o.frequency.exponentialRampToValueAtTime(f * mul * r.rate, t + dt)
            first = false
        }
    }
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.09 * r.vol, t + 0.6)
    g.gain.setValueAtTime(0.09 * r.vol, t + dur - 0.5)
    g.gain.linearRampToValueAtTime(0, t + dur)
    // Belt chatter.
    const chatter: number[] = []
    for (let x = 0.2; x < dur - 0.3; x += 0.07 + rnd(0, 0.02)) chatter.push(x)
    clickTrain(r, chatter, { freq: 1100, q: 2, gain: 0.05, len: 0.01, jitter: 0.5 })
    // Press stamps with steam after each.
    const stamps = [0.95, 1.5, 2.05, 2.6]
    stamps.forEach((s, i) => {
        stamp(at(r, s), 1 - i * 0.04)
        steam(at(r, s + 0.07), 0.32, 0.06)
    })
    // Done: bell ding.
    bell(at(r, dur - 0.35), { freq: 880, dur: 1.6, gain: 0.3, bright: 0.5 })
}

/** Pack-a-Punch ready: two bright dings and a relief hiss. */
export function papReady(r: Rt): void {
    bell(r, { freq: 880, dur: 1.4, gain: 0.28, bright: 0.45 })
    bell(at(r, 0.16), { freq: 1175, dur: 1.4, gain: 0.22, bright: 0.4 })
    steam(at(r, 0.05), 0.7, 0.07)
}

/** Glass bottle clink. */
function clink(r: Rt, gainV: number): void {
    const f = rnd(2300, 2700)
    for (const [ratio, d, g] of [[1, 0.22, 1], [1.58, 0.15, 0.6], [2.42, 0.1, 0.35]] as const) {
        ping(r, f * ratio, d, gainV * g)
    }
    noiseBurst(r, { type: 'highpass', freq: 4000, q: 0.7, gain: gainV * 0.5, dur: 0.008 })
}

/** Perk bought: coin mechanism, a clunking dispense and the bottle clinking in the tray. */
export function perkBuy(r: Rt): void {
    clickTrain(r, [0, 0.05, 0.09], { freq: 2200, q: 3, gain: 0.15, len: 0.012, gains: [1, 0.6, 0.8] })
    const c = at(r, 0.16)
    thud(c, { freq: 120, freqEnd: 60, dur: 0.25, gain: 0.45, body: 0.6, bodyFreq: 700, click: 0.2 })
    metal(c, { base: 260, ratios: [1, 2.4, 3.9], decay: 0.3, gain: 0.12, strike: 0.3 })
    noiseSwell(at(r, 0.25), { kind: 'pink', type: 'bandpass', freq: 900, q: 1.5, gain: 0.08, dur: 0.25, peakAt: 0.5 })
    clink(at(r, 0.48), 0.12)
    clink(at(r, 0.6), 0.07)
    clink(at(r, 0.68), 0.04)
}

/** Electric machine hum spinning up (mains 50 Hz with harmonics and a buzzy relay). */
export function perkHum(r: Rt): void {
    const { ctx, t } = r
    const dur = 1.8
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 300, 0.9, g)
    lp.frequency.setValueAtTime(200, t)
    lp.frequency.exponentialRampToValueAtTime(1600, t + 1)
    const o = waveNode(ctx, pulseWave(ctx, 0.3), 18 * r.rate, t, dur + 0.05, lp)
    o.frequency.exponentialRampToValueAtTime(50 * r.rate, t + 0.9)
    const o2 = oscNode(ctx, 'sine', 36 * r.rate, t, dur + 0.05, gainNode(ctx, 1.2, lp))
    o2.frequency.exponentialRampToValueAtTime(100 * r.rate, t + 0.9)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.12 * r.vol, t + 0.7)
    g.gain.setValueAtTime(0.12 * r.vol, t + dur - 0.6)
    g.gain.linearRampToValueAtTime(0, t + dur)
    clickTrain(r, [0, 0.02], { freq: 1600, q: 2, gain: 0.15, len: 0.01 })
    crackle(at(r, 0.5), 0.25, 0.04, 40)
}

/** Lights buzzing: a 100 Hz buzz through a bright band with flicker. */
function lightBuzz(r: Rt, dur: number, gainV: number): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const flick = gainNode(ctx, 1, g)
    const bp = filterNode(ctx, 'bandpass', 2400 * r.rate, 1.4, flick)
    waveNode(ctx, pulseWave(ctx, 0.1), 100 * r.rate, t, dur + 0.05, bp)
    const fl = randomWalk(Math.ceil(dur * 30), 0.6, 0.3)
    for (let i = 0; i < fl.length; i++) fl[i] = clamp(1 - Math.abs(fl[i] ?? 0), 0.1, 1)
    flick.gain.setValueCurveAtTime(fl, t, dur)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gainV * r.vol, t + 0.1)
    g.gain.setValueAtTime(gainV * r.vol, t + dur - 0.5)
    g.gain.linearRampToValueAtTime(0, t + dur)
}

/** The power comes on: a low thump, a rising hum, relays clacking, the lights buzzing up. */
export function power(r: Rt): void {
    const { ctx, t } = r
    const send = reverbSend(ctx, r.out, 0.35, 2.4, 3, 0.55)
    const w = { ...r, out: send }
    thud(w, { freq: 55, freqEnd: 28, dur: 0.9, gain: 0.7, body: 1, bodyFreq: 260, click: 0.15 })
    // Rising hum.
    const dur = 2.5
    const g = gainNode(ctx, 0, send)
    const lp = filterNode(ctx, 'lowpass', 150, 0.9, g)
    lp.frequency.setValueAtTime(150, t)
    lp.frequency.exponentialRampToValueAtTime(1400, t + 1.7)
    for (const [type, mul, lvl] of [['sawtooth', 1, 0.5], ['sine', 2, 0.8], ['sawtooth', 1.005, 0.4]] as const) {
        const o = oscNode(ctx, type, 22 * mul * r.rate, t, dur + 0.05, gainNode(ctx, lvl, lp))
        o.frequency.exponentialRampToValueAtTime(50 * mul * r.rate, t + 1.6)
    }
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.16 * r.vol, t + 1.5)
    g.gain.setValueAtTime(0.16 * r.vol, t + 1.9)
    g.gain.linearRampToValueAtTime(0, t + dur)
    // Relays clacking along the line.
    for (const s of [0.3, 0.52, 0.78, 1.02, 1.3, 1.45]) {
        clickTrain(at(w, s), [0, 0.012], { freq: rnd(1800, 2600), q: 2.5, gain: 0.3, len: 0.01, gains: [1, 0.5] })
        metal(at(w, s), { base: rnd(900, 1300), ratios: [1, 2.3], decay: 0.08, gain: 0.05, strike: 0 })
    }
    crackle(at(w, 0.6), 0.5, 0.06, 50)
    lightBuzz(at(w, 0.8), 1.7, 0.035)
    // The big contactor closes.
    thud(at(w, 1.6), { freq: 90, freqEnd: 45, dur: 0.5, gain: 0.45, body: 0.7, bodyFreq: 400, click: 0.3 })
    metal(at(w, 1.6), { base: 220, ratios: [1, 2.7, 4.4], decay: 0.6, gain: 0.14, strike: 0.5 })
}

/** Heavy lever thrown: a grinding pull with ratchet teeth, then a big clunk. */
export function lever(r: Rt): void {
    noiseSwell(r, { kind: 'pink', type: 'bandpass', freq: 400, freqEnd: 950, q: 3, gain: 0.22, dur: 0.38, peakAt: 0.6 })
    creak(r, { dur: 0.36, from: 30, to: 60, res: [300, 760], q: 7, gain: 0.12 })
    clickTrain(r, [0.04, 0.11, 0.17, 0.22, 0.27, 0.31], { freq: 1800, q: 3, gain: 0.18, len: 0.01 })
    const c = at(r, 0.4)
    thud(c, { freq: 85, freqEnd: 42, dur: 0.45, gain: 0.6, body: 0.8, bodyFreq: 400, click: 0.3 })
    metal(c, { base: 185, ratios: [1, 2.62, 4.2, 5.9], decay: 0.7, gain: 0.2, strike: 0.5 })
}

/** Picking up a fuse: a glassy shimmer. */
export function fuse(r: Rt): void {
    const send = reverbSend(r.ctx, r.out, 0.4, 1.8, 3, 0.4)
    const s = { ...r, out: send }
    const base = rndPick([76, 79])
    const notes = [base, base + 7, base + 12, base + 16]
    notes.forEach((m, i) => {
        fmBell(at(s, i * 0.06), { freq: mtof(m), dur: 1.1 - i * 0.12, gain: 0.08, ratio: 5.01, index: 0.5, bite: 0.08, detune: rnd(-6, 6) })
        ping(at(s, i * 0.06 + 0.01), mtof(m) * 1.003, 0.9 - i * 0.1, 0.03)
    })
    noiseSwell(s, { kind: 'white', type: 'highpass', freq: 5000, q: 0.7, gain: 0.025, dur: 0.6, peakAt: 0.2 })
}

/** Fuse seated: a firm click, a zap, then a short hum. */
export function fuseInstall(r: Rt): void {
    clickTrain(r, [0, 0.018], { freq: 2000, q: 2.5, gain: 0.35, len: 0.012, gains: [1, 0.6] })
    metal(r, { base: 1450, ratios: [1, 1.9], decay: 0.1, gain: 0.08, strike: 0.3 })
    zap(at(r, 0.08), 0.55)
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 900, 0.8, g)
    oscNode(ctx, 'sawtooth', 100 * r.rate, t, 0.9, lp)
    g.gain.setValueAtTime(0, t + 0.15)
    g.gain.linearRampToValueAtTime(0.05 * r.vol, t + 0.3)
    g.gain.linearRampToValueAtTime(0, t + 0.85)
}

/** The generator: a ~2.1 s chugging hum with linear fade edges so back-to-back plays crossfade. */
export function genHum(r: Rt): void {
    const { ctx, t } = r
    const dur = 2.1
    const fade = 0.12
    const env = gainNode(ctx, 0, r.out)
    const chug = gainNode(ctx, 0.75, env)
    const lp = filterNode(ctx, 'lowpass', 520 * r.rate, 0.8, chug)
    // Engine firing (pulse ~25 Hz) + 50 Hz dynamo + harmonics.
    waveNode(ctx, pulseWave(ctx, 0.2), 25 * r.rate, t, dur + 0.05, gainNode(ctx, 0.6, lp))
    oscNode(ctx, 'sine', 50 * r.rate, t, dur + 0.05, gainNode(ctx, 0.9, lp))
    oscNode(ctx, 'sawtooth', 100.4 * r.rate, t, dur + 0.05, gainNode(ctx, 0.15, lp))
    const mech = filterNode(ctx, 'bandpass', 1300 * r.rate, 1.2, gainNode(ctx, 0.12, chug))
    noise(ctx, 'pink', t, dur + 0.05, mech)
    // Piston chug: amplitude modulation at ~8 Hz with a random phase.
    const lfoG = gainNode(ctx, 0.25, chug.gain)
    const lfo = oscNode(ctx, 'sine', 8.3, t, dur + 0.05, lfoG)
    lfo.detune.setValueAtTime(rnd(-30, 30), t)
    const pk = 0.16 * r.vol
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(pk, t + fade)
    env.gain.setValueAtTime(pk, t + dur - fade)
    env.gain.linearRampToValueAtTime(0, t + dur)
}

/** Short electric crackle (traps, fuses, the wonder weapon fizzing). */
export function zap(r: Rt, scale = 1): void {
    const dur = rnd(0.22, 0.32)
    crackle(r, dur, 0.25 * scale, 90)
    noiseBurst(r, { type: 'bandpass', freq: 2400, q: 0.7, gain: 0.18 * scale, dur: 0.03 })
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const bp = filterNode(ctx, 'bandpass', 800 * r.rate, 2, g)
    const o = waveNode(ctx, pulseWave(ctx, 0.15), 120 * r.rate, t, dur + 0.05, bp)
    o.frequency.exponentialRampToValueAtTime(60 * r.rate, t + dur)
    decayEnv(g.gain, t, 0.12 * scale * r.vol, 0.002, dur)
}

/** A soul flying to the collector: a ghostly rising whoosh with a choir-like whisper. */
export function soul(r: Rt): void {
    const { ctx, t } = r
    const send = reverbSend(ctx, r.out, 0.5, 2, 2.5, 0.4)
    const dur = rnd(1.1, 1.4)
    noiseSwell({ ...r, out: send }, { kind: 'pink', type: 'bandpass', freq: 350, freqEnd: 2600, q: 5, gain: 0.35, dur, peakAt: 0.6 })
    const g = gainNode(ctx, 0, send)
    const lp = filterNode(ctx, 'lowpass', 2500, 0.7, g)
    const base = rnd(260, 320)
    for (const [mul, det] of [[1, -12], [1.5, 9], [2.01, 4]] as const) {
        const o = oscNode(ctx, 'sine', base * mul * r.rate, t, dur + 0.05, lp)
        o.detune.setValueAtTime(det, t)
        o.frequency.exponentialRampToValueAtTime(base * mul * 2.6 * r.rate, t + dur)
        const vib = gainNode(ctx, 25, o.detune)
        oscNode(ctx, 'sine', rnd(5, 7), t, dur + 0.05, vib)
    }
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.06 * r.vol, t + dur * 0.5)
    g.gain.linearRampToValueAtTime(0, t + dur)
    fmBell(at({ ...r, out: send }, dur * 0.92), { freq: 1568, dur: 0.9, gain: 0.06, ratio: 3.5, index: 0.6, bite: 0.1 })
}

/** Easter-egg step: an eerie stinger (low boom, a dissonant swell, a far bell). */
export function eggStep(r: Rt): void {
    const { ctx, t } = r
    const send = reverbSend(ctx, r.out, 0.6, 3, 2.5, 0.5)
    const w = { ...r, out: send }
    thud(w, { freq: 48, freqEnd: 26, dur: 1.4, gain: 0.55, body: 0.9, bodyFreq: 200, click: 0 })
    noiseSwell(w, { kind: 'pink', type: 'bandpass', freq: 300, freqEnd: 1200, q: 2, gain: 0.15, dur: 0.6, peakAt: 0.95 })
    // Cluster: tritones and a minor second, swelling and decaying.
    const chord = [36, 42, 47, 53, 58, 59]
    const g = gainNode(ctx, 0, send)
    const lp = filterNode(ctx, 'lowpass', 1600, 0.7, g)
    chord.forEach((m, i) => {
        const o = oscNode(ctx, i < 2 ? 'sawtooth' : 'triangle', mtof(m) * r.rate, t, 3.2, gainNode(ctx, i < 2 ? 0.35 : 0.7, lp))
        o.detune.setValueAtTime(rnd(-8, 8), t)
        const vib = gainNode(ctx, 6, o.detune)
        oscNode(ctx, 'sine', rnd(0.3, 0.8), t, 3.2, vib)
    })
    lp.frequency.setValueAtTime(400, t)
    lp.frequency.exponentialRampToValueAtTime(1800, t + 0.5)
    lp.frequency.exponentialRampToValueAtTime(500, t + 3)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.06 * r.vol, t + 0.45)
    g.gain.exponentialRampToValueAtTime(0.0002, t + 3.1)
    g.gain.linearRampToValueAtTime(0, t + 3.15)
    bell(at(w, 0.12), { freq: 196, dur: 3, gain: 0.3, bright: 0.5 })
    crack(at(w, 0.02), { gain: 0.08, freq: 400, snap: 1200 })
}

/** A lightning-rod knife switch thrown home: a ratchet, a heavy iron clunk, then the contacts spit. */
export function rodLever(r: Rt): void {
    clickTrain(r, [0, 0.05, 0.09, 0.12], { freq: 1500, q: 3, gain: 0.16, len: 0.012 })
    const c = at(r, 0.16)
    thud(c, { freq: 70, freqEnd: 36, dur: 0.5, gain: 0.65, body: 0.9, bodyFreq: 340, click: 0.35 })
    metal(c, { base: 150, ratios: [1, 2.71, 4.4, 6.3], decay: 0.9, gain: 0.22, strike: 0.6 })
    zap(at(r, 0.2), 0.7)
}

/** A charged mast: a long sizzling crackle with a high whine and a sharp crack on top. */
export function rodCrackle(r: Rt): void {
    const send = reverbSend(r.ctx, r.out, 0.45, 2.2, 3, 0.5)
    const s = { ...r, out: send }
    crack(s, { gain: 0.5, dur: 0.25, freq: 2600 })
    crackle(s, rnd(0.9, 1.3), 0.3, 110)
    const { ctx, t } = r
    const g = gainNode(ctx, 0, send)
    const bp = filterNode(ctx, 'bandpass', 1800 * r.rate, 4, g)
    const o = waveNode(ctx, pulseWave(ctx, 0.12), 240 * r.rate, t, 1.3, bp)
    o.frequency.exponentialRampToValueAtTime(90 * r.rate, t + 1.25)
    decayEnv(g.gain, t, 0.08 * r.vol, 0.01, 1.25)
}

/** The rod switch dropping out: a sputter of sparks and a dying buzz. */
export function rodSputter(r: Rt): void {
    for (const dt of [0, 0.14, 0.33]) zap(at(r, dt), 0.35)
    thud(at(r, 0.05), { freq: 110, freqEnd: 60, dur: 0.25, gain: 0.3, body: 0.5, bodyFreq: 500, click: 0.2 })
}

/** All three rods: thunder right overhead, a rolling crack across the sky. */
export function rodThunder(r: Rt): void {
    const send = reverbSend(r.ctx, r.out, 0.6, 3.5, 2.5, 0.6)
    const s = { ...r, out: send }
    crack(s, { gain: 0.8, dur: 0.4, freq: 1800 })
    thud(s, { freq: 60, freqEnd: 24, dur: 2.2, gain: 0.8, body: 1, bodyFreq: 180, click: 0.4 })
    noiseSwell(at(s, 0.1), { kind: 'brown', type: 'lowpass', freq: 500, freqEnd: 120, q: 0.7, gain: 0.5, dur: 3, peakAt: 0.15 })
    crackle(at(s, 0.05), 1.4, 0.25, 70)
}
