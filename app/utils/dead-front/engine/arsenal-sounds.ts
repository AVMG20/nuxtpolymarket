import type { DfAudio, DfSoundOpts } from '../context'
import { at, decayEnv, filterNode, gainNode, mtof, noise, oscNode, reverbSend, rnd, shaperNode } from '../world/sounds/noise'
import type { Rt } from '../world/sounds/noise'
import { clickTrain, crack, crackle, fmBell, metal, noiseBurst, noiseSwell, scatter, thud } from '../world/sounds/parts'

// Sounds of the salvage, the workbench, the crafted gear and the
// support, all synthesised: scrap clinking into a pack, hammering at the
// bench, the Lewis sentry's rattle, a gramophone waltz, the field telephone
// that calls the guns, shells whistling in, a Zeppelin's engines droning
// overhead and a Gotha bomber's twin engines before its carpet rolls in.

export const DF_ARSENAL_SND = {
    scrap: 'df:ars-scrap',
    part: 'df:ars-part',
    craft: 'df:ars-craft',
    deploy: 'df:ars-deploy',
    sentryShot: 'df:ars-sentry-shot',
    sentrySpent: 'df:ars-sentry-spent',
    sentryBroken: 'df:ars-sentry-broken',
    decoyWind: 'df:ars-decoy-wind',
    waltz: 'df:ars-waltz',
    crate: 'df:ars-crate',
    callin: 'df:ars-callin',
    whistle: 'df:ars-whistle',
    zeppelin: 'df:ars-zeppelin',
    bomber: 'df:ars-bomber',
    carpet: 'df:ars-carpet',
    challenge: 'df:ars-challenge',
    challengeDone: 'df:ars-challenge-done'
} as const

const registered = new WeakSet<DfAudio>()

/** A sustained engine: a buzzing saw stack through a lowpass, `dur` long with a swell. */
function engine(r: Rt, o: { freq: number, dur: number, gain: number, rough: number, cutoff: number, peakAt: number, bend?: number }): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', o.cutoff, 0.9, g)
    const sh = shaperNode(ctx, o.rough, lp)
    for (const [det, type] of [[0, 'sawtooth'], [7, 'sawtooth'], [-1200, 'square']] as const) {
        const osc = oscNode(ctx, type, o.freq * r.rate, t, o.dur + 0.1, type === 'square' ? gainNode(ctx, 0.35, sh) : sh)
        osc.detune.setValueAtTime(det, t)
        if (o.bend) {
            osc.frequency.setValueAtTime(o.freq * r.rate * o.bend, t)
            osc.frequency.linearRampToValueAtTime(o.freq * r.rate, t + o.dur * o.peakAt)
            osc.frequency.linearRampToValueAtTime(o.freq * r.rate / o.bend, t + o.dur)
        }
    }
    // the cylinders' beat
    const trem = gainNode(ctx, 0.3, g.gain)
    oscNode(ctx, 'sine', o.freq / 4, t, o.dur + 0.1, trem)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(o.gain * r.vol, t + o.dur * o.peakAt)
    g.gain.linearRampToValueAtTime(0, t + o.dur)
}

/** One gramophone note: a plucked, nasal tone through the horn's band. */
function horn(r: Rt, midi: number, dur: number, gainV: number): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const bp = filterNode(ctx, 'bandpass', 1300, 0.8, g)
    oscNode(ctx, 'square', mtof(midi) * r.rate, t, dur + 0.05, bp)
    oscNode(ctx, 'triangle', mtof(midi + 12) * r.rate, t, dur + 0.05, gainNode(ctx, 0.4, bp))
    decayEnv(g.gain, t, gainV * r.vol, 0.01, dur)
}

export function registerDfArsenalSounds(audio: DfAudio): void {
    if (registered.has(audio)) return
    registered.add(audio)
    const r = (name: string, s: (r: Rt, o: DfSoundOpts) => void) => {
        audio.register(name, (ctx, out, o) => s({ ctx, out, t: ctx.currentTime + 0.002, vol: 1, rate: o.rate ?? 1 }, o))
    }
    const hall = (p: Rt, wet = 0.4): Rt => ({ ...p, out: reverbSend(p.ctx, p.out, wet, 2.6, 2.4, 0.6) })
    const sky = (p: Rt, wet = 0.6): Rt => ({ ...p, out: reverbSend(p.ctx, p.out, wet, 4.5, 2, 0.75) })

    // Scrap: a fistful of nuts and plates clinking into a pack.
    r(DF_ARSENAL_SND.scrap, (p) => {
        clickTrain(p, scatter(5, 0.18, 1.3), { freq: 3400, q: 2.5, gain: 0.35, len: 0.012, jitter: 0.4 })
        metal(at(p, 0.02), { base: rnd(1500, 1900), ratios: [1, 2.4, 3.9], decay: 0.25, gain: 0.16, strike: 0.6, spread: 0.03 })
        noiseBurst(at(p, 0.05), { kind: 'pink', type: 'bandpass', freq: 900, q: 0.8, gain: 0.12, dur: 0.15 })
    })
    // A rare part: a bright brass valve ringing as it's pocketed.
    r(DF_ARSENAL_SND.part, (p) => {
        const h = hall(p, 0.35)
        metal(p, { base: 980, ratios: [1, 2.76, 5.4], decay: 0.9, gain: 0.22, strike: 0.7 })
        for (const [k, n] of [79, 86, 91].entries()) fmBell(at(h, 0.05 + k * 0.07), { freq: mtof(n), dur: 0.7, gain: 0.12, ratio: 3, index: 0.7 })
    })
    // Crafting: hammer blows, a ratchet, a finishing ding.
    r(DF_ARSENAL_SND.craft, (p) => {
        const h = hall(p, 0.25)
        for (const [i, dt] of [0, 0.22, 0.42].entries()) {
            metal(at(h, dt), { base: 620 + i * 40, ratios: [1, 2.3, 3.6, 5.1], decay: 0.35, gain: 0.3, strike: 0.9, spread: 0.02 })
            thud(at(p, dt), { freq: 180, freqEnd: 90, dur: 0.1, gain: 0.25, body: 0.3, click: 0.8 })
        }
        clickTrain(at(p, 0.62), [0, 0.05, 0.1, 0.15, 0.2], { freq: 2600, q: 1.4, gain: 0.3, len: 0.008, jitter: 0.1 })
        fmBell(at(h, 0.9), { freq: 1568, dur: 0.6, gain: 0.14, ratio: 2, index: 0.5 })
    })
    // Gear going down: tripod legs, a clunk, the cocking handle.
    r(DF_ARSENAL_SND.deploy, (p) => {
        thud(p, { freq: 150, freqEnd: 70, dur: 0.18, gain: 0.5, body: 0.5, click: 0.6 })
        clickTrain(at(p, 0.12), [0, 0.04, 0.09], { freq: 2100, q: 1.3, gain: 0.35, len: 0.01 })
        metal(at(p, 0.32), { base: 900, ratios: [1, 2.6, 4.3], decay: 0.2, gain: 0.25, strike: 0.9 })
        noiseBurst(at(p, 0.34), { kind: 'white', type: 'bandpass', freq: 2500, freqEnd: 1200, q: 1.5, gain: 0.25, dur: 0.12 })
    })
    // The Lewis: a sharp crack and a short, dry tail (retriggered per shot).
    r(DF_ARSENAL_SND.sentryShot, (p) => {
        crack(p, { gain: 0.5, freq: rnd(1700, 2100), snap: 0.7, dur: 0.07 })
        thud(p, { freq: 130, freqEnd: 60, dur: 0.12, gain: 0.45, body: 0.35, click: 0.5 })
        noiseBurst(at(p, 0.01), { kind: 'pink', type: 'lowpass', freq: 1800, freqEnd: 500, gain: 0.18, dur: 0.18 })
    })
    r(DF_ARSENAL_SND.sentrySpent, (p) => {
        clickTrain(p, [0, 0.22, 0.44], { freq: 1900, q: 1.5, gain: 0.4, len: 0.01 })
        noiseSwell(at(p, 0.5), { kind: 'white', type: 'highpass', freq: 2200, q: 0.6, gain: 0.12, dur: 0.8, peakAt: 0.2 })
    })
    r(DF_ARSENAL_SND.sentryBroken, (p) => {
        metal(p, { base: 280, ratios: [1, 1.7, 2.6, 3.9, 5.3], decay: 0.8, gain: 0.4, strike: 1, spread: 0.08 })
        crack(p, { gain: 0.4, freq: 1600, snap: 0.6, dur: 0.2 })
        clickTrain(at(p, 0.1), scatter(8, 0.6, 1.4), { freq: 3000, q: 2, gain: 0.3, len: 0.01, jitter: 0.5 })
    })
    // Winding the gramophone's crank.
    r(DF_ARSENAL_SND.decoyWind, (p) => {
        clickTrain(p, scatter(14, 0.9, 1), { freq: 2800, q: 2.2, gain: 0.28, len: 0.006, jitter: 0.2 })
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 600, q: 1.2, gain: 0.08, dur: 1, peakAt: 0.5 })
    })
    // One bar of a scratchy waltz: oom-pah-pah under a little tune (the view plays it on loop).
    const TUNE: readonly (readonly [number, number])[][] = [
        [[72, 0], [76, 0.5], [79, 1]],
        [[77, 0], [76, 0.5], [74, 1]],
        [[72, 0], [71, 0.5], [72, 1]],
        [[74, 0], [79, 0.5], [76, 1]]
    ]
    for (const [i, bar] of TUNE.entries()) {
        r(`${DF_ARSENAL_SND.waltz}-${i}`, (p) => {
            const beat = 0.42
            const bass = [48, 55, 55, 53][i]!
            horn(p, bass, 0.32, 0.22)
            horn(at(p, beat), bass + 7, 0.2, 0.12)
            horn(at(p, beat * 2), bass + 12, 0.2, 0.12)
            for (const [n, b] of bar) horn(at(p, b * beat * 2), n, 0.36, 0.2)
            crackle(p, beat * 3, 0.08, 30)
            noiseBurst(p, { kind: 'pink', type: 'bandpass', freq: 2400, q: 0.6, gain: 0.03, dur: beat * 3 })
        })
    }
    // A supply crate opened: the lid prised off with a creak and a clunk, then a bright brass stab.
    r(DF_ARSENAL_SND.crate, (p) => {
        const h = hall(p, 0.3)
        noiseBurst(p, { kind: 'pink', type: 'bandpass', freq: 700, freqEnd: 1400, q: 3, gain: 0.25, dur: 0.22 })
        thud(at(p, 0.2), { freq: 160, freqEnd: 80, dur: 0.12, gain: 0.4, body: 0.4, click: 0.8 })
        clickTrain(at(p, 0.22), scatter(4, 0.12, 1.2), { freq: 2600, q: 2, gain: 0.25, len: 0.008 })
        const { ctx } = p
        const tt = p.t + 0.35
        const g = gainNode(ctx, 0, h.out)
        const lp = filterNode(ctx, 'lowpass', 2600, 1, g)
        for (const n of [62, 69, 74, 78]) oscNode(ctx, 'sawtooth', mtof(n) * p.rate, tt, 0.75, lp)
        g.gain.setValueAtTime(0, tt)
        g.gain.linearRampToValueAtTime(0.16 * p.vol, tt + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.7)
        thud(at(p, 0.35), { freq: 100, freqEnd: 45, dur: 0.35, gain: 0.45, body: 0.4, click: 0.3 })
    })
    // Calling it in: a crank of the field phone and morse pips over static.
    r(DF_ARSENAL_SND.callin, (p) => {
        noiseBurst(p, { kind: 'white', type: 'bandpass', freq: 2200, q: 0.7, gain: 0.08, dur: 0.9 })
        clickTrain(p, scatter(8, 0.35, 1), { freq: 1500, q: 2, gain: 0.25, len: 0.008 })
        for (const [k, len] of [0.06, 0.06, 0.16, 0.06, 0.16].entries()) {
            const { ctx } = p
            const tt = p.t + 0.4 + k * 0.13
            const g = gainNode(ctx, 0, p.out)
            oscNode(ctx, 'sine', 820 * p.rate, tt, len + 0.02, g)
            g.gain.setValueAtTime(0.14 * p.vol, tt)
            g.gain.setValueAtTime(0, tt + len)
        }
    })
    // An incoming shell: a falling whistle that ends where it lands (about 1.3 s).
    r(DF_ARSENAL_SND.whistle, (p) => {
        const s = sky(p, 0.35)
        const { ctx, t } = s
        const g = gainNode(ctx, 0, s.out)
        const bp = filterNode(ctx, 'bandpass', 1800, 6, g)
        const o = oscNode(ctx, 'sine', 1900 * p.rate, t, 1.35, g)
        o.frequency.setValueAtTime(rnd(1800, 2100) * p.rate, t)
        o.frequency.exponentialRampToValueAtTime(rnd(520, 640) * p.rate, t + 1.3)
        noise(ctx, 'white', t, 1.35, bp)
        bp.frequency.setValueAtTime(1900, t)
        bp.frequency.exponentialRampToValueAtTime(600, t + 1.3)
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.16 * p.vol, t + 0.9)
        g.gain.linearRampToValueAtTime(0.22 * p.vol, t + 1.25)
        g.gain.linearRampToValueAtTime(0, t + 1.32)
    })
    // The Zeppelin: slow-beating Maybach engines droning over (about 9 s).
    r(DF_ARSENAL_SND.zeppelin, (p) => {
        const s = sky(p, 0.5)
        engine(s, { freq: 46, dur: 9, gain: 0.32, rough: 3, cutoff: 420, peakAt: 0.45, bend: 1.04 })
        engine(at(s, 0.1), { freq: 61, dur: 8.8, gain: 0.18, rough: 2.5, cutoff: 600, peakAt: 0.5, bend: 1.04 })
        noiseSwell(s, { kind: 'brown', type: 'lowpass', freq: 220, q: 0.7, gain: 0.25, dur: 9, peakAt: 0.45 })
    })
    // The Gotha: two big Mercedes engines beating against each other, droning in and away (about 8 s).
    r(DF_ARSENAL_SND.bomber, (p) => {
        const s = sky(p, 0.45)
        engine(s, { freq: 58, dur: 8, gain: 0.34, rough: 3.5, cutoff: 700, peakAt: 0.55, bend: 1.06 })
        engine(at(s, 0.05), { freq: 61.5, dur: 7.9, gain: 0.26, rough: 3.5, cutoff: 760, peakAt: 0.55, bend: 1.06 })
        noiseSwell(s, { kind: 'brown', type: 'lowpass', freq: 300, q: 0.7, gain: 0.3, dur: 8, peakAt: 0.55 })
    })
    // Its carpet: the ground shaking under a dozen bombs at once, a long rolling roar.
    r(DF_ARSENAL_SND.carpet, (p) => {
        const s = sky(p, 0.5)
        for (const dt of [0, 0.12, 0.25, 0.4, 0.55]) thud(at(s, dt), { freq: rnd(60, 80), freqEnd: 28, dur: 0.9, gain: 0.55, body: 0.7, click: 0.4 })
        noiseSwell(s, { kind: 'brown', type: 'lowpass', freq: 240, q: 0.7, gain: 0.55, dur: 3.2, peakAt: 0.12 })
        crackle(at(s, 0.3), 2.2, 0.18, 40)
    })
    // A round challenge dealt: a bugle's two notes; met: a bright run.
    r(DF_ARSENAL_SND.challenge, (p) => {
        const h = hall(p, 0.3)
        for (const [k, n] of [67, 72].entries()) fmBell(at(h, k * 0.16), { freq: mtof(n), dur: 0.5, gain: 0.12, ratio: 1, index: 1.4, bite: 0.02 })
    })
    r(DF_ARSENAL_SND.challengeDone, (p) => {
        const h = hall(p, 0.35)
        for (const [k, n] of [72, 76, 79, 84].entries()) fmBell(at(h, k * 0.08), { freq: mtof(n), dur: 0.8, gain: 0.14, ratio: 3.5, index: 0.8, bite: 0.04 })
        metal(at(p, 0.32), { base: 1046, ratios: [1, 2.7, 5.2], decay: 1, gain: 0.12, strike: 0.5 })
    })
}
