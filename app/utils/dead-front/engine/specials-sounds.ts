import type { DfAudio, DfSoundOpts } from '../context'
import { at, decayEnv, filterNode, gainNode, mtof, noise, oscNode, reverbSend, rnd, shaperNode } from '../world/sounds/noise'
import type { Rt } from '../world/sounds/noise'
import { crackle, fmBell, metal, noiseBurst, noiseSwell, scatter, clickTrain, thud } from '../world/sounds/parts'

// Sounds of the special rounds and set pieces, all synthesised: the gas alarm
// (a struck shell-casing gong and a hand-cranked siren), coughing in the gas,
// the multi-kill callouts and the electric trap (the switch, its hum, a zombie
// frying in it, the spin-down).

export const DF_SPECIAL_SND = {
    gasAlarm: 'df:gas-alarm',
    cough: 'df:cough',
    callout: (tier: number) => `df:callout-${Math.max(1, Math.min(4, tier))}`,
    calloutHead: 'df:callout-head',
    trapStart: 'df:trap-start',
    trapHum: 'df:trap-hum',
    trapFry: 'df:trap-fry',
    trapOff: 'df:trap-off',
    trapReady: 'df:trap-ready'
} as const

const registered = new WeakSet<DfAudio>()

/** One siren wail: two detuned saws through a growling shaper, pitch swept up then down. */
function wail(r: Rt, dur: number, lo: number, hi: number, gainV: number): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const bp = filterNode(ctx, 'bandpass', 900, 0.9, g)
    const sh = shaperNode(ctx, 2.2, bp)
    for (const det of [-9, 7]) {
        const o = oscNode(ctx, 'sawtooth', lo, t, dur + 0.1, sh)
        o.detune.setValueAtTime(det, t)
        o.frequency.setValueAtTime(lo, t)
        o.frequency.exponentialRampToValueAtTime(hi, t + dur * 0.45)
        o.frequency.setValueAtTime(hi, t + dur * 0.55)
        o.frequency.exponentialRampToValueAtTime(lo * 0.8, t + dur)
    }
    // the rotor's chop
    const trem = gainNode(ctx, 0.25, g.gain)
    oscNode(ctx, 'sine', 11, t, dur + 0.1, trem)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gainV * r.vol, t + dur * 0.2)
    g.gain.setValueAtTime(gainV * r.vol, t + dur * 0.7)
    g.gain.linearRampToValueAtTime(0, t + dur)
}

/** One hack of a cough: a chesty noise burst over a short glottal buzz. */
function hack(r: Rt, gainV: number): void {
    noiseBurst(r, { kind: 'pink', type: 'bandpass', freq: rnd(700, 1000), freqEnd: rnd(380, 520), q: 1.6, gain: gainV, attack: 0.008, dur: rnd(0.16, 0.24) })
    noiseBurst(r, { kind: 'white', type: 'highpass', freq: 2600, q: 0.7, gain: gainV * 0.25, attack: 0.004, dur: 0.07 })
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 900, 0.8, g)
    const o = oscNode(ctx, 'sawtooth', rnd(115, 140) * r.rate, t, 0.2, lp)
    o.frequency.exponentialRampToValueAtTime(80 * r.rate, t + 0.16)
    decayEnv(g.gain, t, gainV * 0.35 * r.vol, 0.01, 0.15)
}

/** A brassy stab for the callouts: a stack of saws through a closing lowpass. */
function brass(r: Rt, notes: readonly number[], dur: number, gainV: number): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 3200, 1.2, g)
    lp.frequency.setValueAtTime(3200, t)
    lp.frequency.exponentialRampToValueAtTime(700, t + dur)
    for (const n of notes) {
        const o = oscNode(ctx, 'sawtooth', mtof(n) * r.rate, t, dur + 0.05, lp)
        o.detune.setValueAtTime(rnd(-6, 6), t)
    }
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gainV * r.vol / Math.sqrt(notes.length), t + 0.012)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainV * 0.3 * r.vol), t + dur * 0.5)
    g.gain.linearRampToValueAtTime(0, t + dur)
}

/** Mains hum with a buzzy edge, for the trap while it runs (about a second; the view retriggers it). */
function hum(r: Rt, dur: number, gainV: number): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const bp = filterNode(ctx, 'bandpass', 420, 0.8, g)
    const sh = shaperNode(ctx, 3, bp)
    oscNode(ctx, 'sawtooth', 100 * r.rate, t, dur + 0.05, sh)
    oscNode(ctx, 'square', 50 * r.rate, t, dur + 0.05, gainNode(ctx, 0.4, sh))
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gainV * r.vol, t + 0.12)
    g.gain.setValueAtTime(gainV * r.vol, t + dur - 0.15)
    g.gain.linearRampToValueAtTime(0, t + dur)
}

export function registerDfSpecialSounds(audio: DfAudio): void {
    if (registered.has(audio)) return
    registered.add(audio)
    const r = (name: string, s: (r: Rt, o: DfSoundOpts) => void) => {
        audio.register(name, (ctx, out, o) => s({ ctx, out, t: ctx.currentTime + 0.002, vol: 1, rate: o.rate ?? 1 }, o))
    }
    const hall = (p: Rt, wet = 0.5): Rt => ({ ...p, out: reverbSend(p.ctx, p.out, wet, 3.2, 2.4, 0.6) })

    // GAS! A shell casing hung on a post, beaten hard, and a hand-cranked siren winding up behind it.
    r(DF_SPECIAL_SND.gasAlarm, (p) => {
        const h = hall(p, 0.55)
        for (const [i, dt] of [0, 0.32, 0.64, 1.3, 1.62, 1.94].entries()) {
            metal(at(h, dt), { base: 520 * (i % 3 === 1 ? 1.02 : 1), ratios: [1, 2.32, 2.97, 4.11, 5.43], decay: 1.1, gain: 0.32, strike: 0.6, spread: 0.02 })
        }
        wail(at(h, 0.4), 2.2, 180, 620, 0.2)
        wail(at(h, 2.6), 2.4, 200, 660, 0.22)
        noiseSwell(at(h, 0.2), { kind: 'pink', type: 'lowpass', freq: 260, q: 0.7, gain: 0.12, dur: 4.6, peakAt: 0.5 })
    })

    // A wet cough from inside a mask: two or three hacks.
    r(DF_SPECIAL_SND.cough, (p) => {
        const n = Math.random() < 0.5 ? 2 : 3
        let dt = 0
        for (let i = 0; i < n; i++) {
            hack(at(p, dt), 0.5 * (1 - i * 0.18))
            dt += rnd(0.26, 0.38)
        }
        noiseSwell(at(p, dt), { kind: 'pink', type: 'bandpass', freq: 520, q: 0.8, gain: 0.12, dur: 0.5, peakAt: 0.3 })
    })

    // Callouts: rising brass stabs, one more for each tier, over a drum hit.
    const TIERS: readonly (readonly number[])[] = [[62, 69], [62, 66, 69], [64, 68, 71], [57, 62, 66, 69, 74]]
    TIERS.forEach((chord, i) => {
        r(DF_SPECIAL_SND.callout(i + 1), (p) => {
            const h = hall(p, 0.3)
            const hits = i + 1
            for (let k = 0; k < Math.min(3, hits); k++) brass(at(h, k * 0.075), chord.map(n => n + k * (k === 2 ? 5 : 2)), 0.16, 0.32)
            const last = Math.min(3, hits) * 0.075
            brass(at(h, last), chord.map(n => n + 7), i >= 3 ? 0.9 : 0.5, 0.36)
            thud(at(p, last), { freq: 110, freqEnd: 45, dur: 0.3, gain: i >= 3 ? 0.55 : 0.35, body: 0.4, click: 0.3 })
            if (i >= 3) fmBell(at(h, last), { freq: 880, dur: 1.4, gain: 0.12, ratio: 2.76, index: 1.2 })
        })
    })
    // Headshot streak: a bright chime run.
    r(DF_SPECIAL_SND.calloutHead, (p) => {
        const h = hall(p, 0.35)
        for (const [k, n] of [76, 81, 88].entries()) fmBell(at(h, k * 0.06), { freq: mtof(n), dur: 0.6, gain: 0.18, ratio: 3.5, index: 0.8, bite: 0.05 })
    })

    // The trap: a knife switch slammed home, then the coils spin up.
    r(DF_SPECIAL_SND.trapStart, (p) => {
        thud(p, { freq: 140, freqEnd: 60, dur: 0.18, gain: 0.6, body: 0.5, click: 0.9 })
        metal(p, { base: 820, ratios: [1, 2.7, 4.1], decay: 0.25, gain: 0.25, strike: 0.8 })
        const { ctx, t } = at(p, 0.1)
        const g = gainNode(ctx, 0, p.out)
        const bp = filterNode(ctx, 'bandpass', 600, 1.1, g)
        const o = oscNode(ctx, 'sawtooth', 30, t, 1.3, bp)
        o.frequency.exponentialRampToValueAtTime(100, t + 1.1)
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.4 * p.vol, t + 0.9)
        g.gain.linearRampToValueAtTime(0, t + 1.25)
        crackle(at(p, 0.3), 1, 0.35, 70)
    })
    r(DF_SPECIAL_SND.trapHum, (p) => {
        hum(p, 1.05, 0.22)
        crackle(p, 1, 0.18, 26)
    })
    // A zombie caught in it: a fat sizzle and a crack.
    r(DF_SPECIAL_SND.trapFry, (p) => {
        crackle(p, 0.6, 0.55, 90)
        clickTrain(p, scatter(5, 0.25, 1.4), { freq: 3200, q: 0.8, gain: 0.5, len: 0.006, jitter: 0.5 })
        noiseBurst(p, { kind: 'white', type: 'highpass', freq: 1800, freqEnd: 5000, q: 0.7, gain: 0.3, dur: 0.5 })
        const { ctx, t } = p
        const g = gainNode(ctx, 0, p.out)
        noise(ctx, 'brown', t, 0.4, filterNode(ctx, 'lowpass', 300, 0.7, g))
        decayEnv(g.gain, t, 0.3 * p.vol, 0.005, 0.35)
    })
    // Run over: the coils wind down and the switch clacks open.
    r(DF_SPECIAL_SND.trapOff, (p) => {
        const { ctx, t } = p
        const g = gainNode(ctx, 0, p.out)
        const bp = filterNode(ctx, 'bandpass', 500, 1, g)
        const o = oscNode(ctx, 'sawtooth', 100, t, 1.3, bp)
        o.frequency.exponentialRampToValueAtTime(28, t + 1.2)
        g.gain.setValueAtTime(0.3 * p.vol, t)
        g.gain.linearRampToValueAtTime(0, t + 1.25)
        thud(at(p, 0.05), { freq: 120, freqEnd: 70, dur: 0.12, gain: 0.35, body: 0.3, click: 0.7 })
    })
    // Cooled down: a small relay click and a green lamp ping.
    r(DF_SPECIAL_SND.trapReady, (p) => {
        clickTrain(p, [0, 0.04], { freq: 2200, q: 1.5, gain: 0.4, len: 0.006, jitter: 0.1 })
        fmBell(at(p, 0.05), { freq: 1320, dur: 0.4, gain: 0.12, ratio: 2, index: 0.5 })
    })
}
