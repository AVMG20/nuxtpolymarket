import type { DfWeaponId } from '#shared/utils/dead-front/types'
import { DF_WEAPON_IDS } from '#shared/utils/dead-front/weapons'
import type { DfAudio, DfSoundOpts, DfSynth } from '../context'
import { at, decayEnv, filterNode, gainNode, oscNode, rnd, shaperNode } from '../world/sounds/noise'
import type { Rt } from '../world/sounds/noise'
import { clickTrain, crackle, fmBell, metal, noiseBurst, noiseSwell, scatter } from '../world/sounds/parts'

// Procedural weapon sounds. Every report is built from the same four layers,
// tuned per weapon: a low body thump (punch, through a soft saturator), a
// pink-noise blast, a short crack (supersonic rounds only) and an outdoor tail
// with a slapback off the ruins. Remote shots (played with a position) skip
// the crack and the action and lean on the engine's distance filter.
// Recipes read only `opts.rate` and `opts.pos`: the engine applies volume and
// spatialisation on each voice itself.

export const DF_WSND = {
    fire: (id: DfWeaponId, pap: number, suppressed = false) => `w:${id}:fire${pap > 0 ? ':pap' : suppressed ? ':sup' : ''}`,
    dry: 'w:dry',
    magOut: 'w:mag-out',
    magIn: 'w:mag-in',
    slide: 'w:slide',
    boltOpen: 'w:bolt-open',
    boltClose: 'w:bolt-close',
    pump: 'w:pump',
    shell: 'w:shell',
    clip: 'w:clip',
    drum: 'w:drum',
    raise: 'w:raise',
    knife: 'w:knife',
    pin: 'w:grenade-pin',
    throw: 'w:grenade-throw',
    explode: 'w:explode',
    xrayHit: 'w:xray-hit',
    arc: 'w:arc',
    steam: 'w:steam',
    charge: 'w:coil-charge',
    splat: 'w:splat',
    casing: 'w:casing'
} as const

export interface DfGunVoice {
    /** Body thump: start and end pitch (Hz) and length (s). */
    body: number
    bodyEnd: number
    bodyDur: number
    /** Blast noise lowpass (Hz) and length (s). */
    blast: number
    blastDur: number
    /** Supersonic crack centre (Hz); 0 for subsonic rounds. */
    crack: number
    /** Outdoor tail length (s) and slapback level (0..1). */
    tail: number
    echo: number
    /** Action click after the shot: pitch (Hz), delay (s), level. */
    mech: number
    mechAt: number
    mechGain: number
    /** Saturation of the body (punch). */
    drive: number
    /** Overall level (own shot peaks land around 0.8). */
    gain: number
}

/** Per-weapon voicing. Exported for the spec (every weapon has a distinct report). */
export const DF_GUN_VOICES: Record<Exclude<DfWeaponId, 'xray' | 'wunder'>, DfGunVoice> = {
    // .45 service pistol: round, mid-weighted bark, slide snaps forward.
    m1911: { body: 210, bodyEnd: 70, bodyDur: 0.11, blast: 2400, blastDur: 0.09, crack: 0, tail: 0.5, echo: 0.35, mech: 2900, mechAt: 0.045, mechGain: 0.12, drive: 1.6, gain: 0.8 },
    // 7.63 Mauser: small, fast, snappy crack and a bright toggle.
    c96: { body: 260, bodyEnd: 90, bodyDur: 0.08, blast: 3400, blastDur: 0.07, crack: 3200, tail: 0.45, echo: 0.3, mech: 3600, mechAt: 0.035, mechGain: 0.12, drive: 1.4, gain: 0.72 },
    // 12-gauge trench gun: a big low boom with a long roll.
    m1897: { body: 120, bodyEnd: 38, bodyDur: 0.24, blast: 1500, blastDur: 0.22, crack: 0, tail: 1.2, echo: 0.6, mech: 0, mechAt: 0, mechGain: 0, drive: 2.2, gain: 0.74 },
    // 8 mm Mauser rifle: a hard supersonic crack and a long valley echo.
    kar98k: { body: 150, bodyEnd: 45, bodyDur: 0.16, blast: 2800, blastDur: 0.13, crack: 2900, tail: 1.5, echo: 0.7, mech: 0, mechAt: 0, mechGain: 0, drive: 2, gain: 0.78 },
    // .45 Tommy gun: thick and round, short tail for the fast cycle.
    thompson: { body: 190, bodyEnd: 65, bodyDur: 0.08, blast: 2000, blastDur: 0.07, crack: 0, tail: 0.3, echo: 0.2, mech: 2300, mechAt: 0.02, mechGain: 0.07, drive: 1.8, gain: 0.66 },
    // 9 mm MP18: tighter and lighter than the Thompson, with a tinny bolt.
    mp18: { body: 240, bodyEnd: 85, bodyDur: 0.065, blast: 2600, blastDur: 0.06, crack: 0, tail: 0.28, echo: 0.18, mech: 3100, mechAt: 0.018, mechGain: 0.07, drive: 1.5, gain: 0.6 },
    // .30-06 BAR: heavy rifle report with a solid bolt slam.
    bar: { body: 140, bodyEnd: 45, bodyDur: 0.13, blast: 2600, blastDur: 0.11, crack: 2700, tail: 0.9, echo: 0.5, mech: 1900, mechAt: 0.03, mechGain: 0.1, drive: 2, gain: 0.74 },
    // .303 Lewis gun: a drier rifle bark with a ratchety cocking click.
    lewis: { body: 160, bodyEnd: 50, bodyDur: 0.11, blast: 2300, blastDur: 0.1, crack: 2500, tail: 0.75, echo: 0.45, mech: 2100, mechAt: 0.028, mechGain: 0.1, drive: 1.9, gain: 0.72 }
}

function rtOf(ctx: AudioContext, out: AudioNode, o: DfSoundOpts, jitter = 0.04): Rt {
    return { ctx, out, t: ctx.currentTime + 0.003, vol: 1, rate: (o.rate ?? 1) * rnd(1 - jitter, 1 + jitter) }
}

/** A pitched sine drop (kick-drum style): the punch of a report or an impact. */
function thump(r: Rt, f0: number, f1: number, dur: number, gainV: number, type: OscillatorType = 'sine'): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const o = oscNode(ctx, type, f0 * r.rate, t, dur + 0.05, g)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * r.rate), t + dur * 0.8)
    decayEnv(g.gain, t, gainV * r.vol, 0.0015, dur)
}

/** A small metal "tick" with a short ring: the vocabulary of every action click. */
function tick(r: Rt, freq: number, gainV: number, ring = 0.06): void {
    clickTrain(r, [0], { freq, q: 2.5, gain: gainV, len: 0.007, jitter: 0 })
    metal(r, { base: freq * 0.9, ratios: [1, 1.47, 2.09], decay: ring, gain: gainV * 0.25, strike: 0 })
}

/** A solid "clack": metal seating against metal, with a little low body. */
function clack(r: Rt, freq: number, gainV: number): void {
    clickTrain(r, [0, 0.004], { freq, q: 2, gain: gainV, len: 0.01, gains: [1, 0.5], jitter: 0 })
    thump(r, 420, 160, 0.05, gainV * 0.45)
    metal(r, { base: freq * 0.62, ratios: [1, 1.53, 2.37], decay: 0.09, gain: gainV * 0.22, strike: 0 })
}

/** Metal sliding on metal (slides, bolts, mags). */
function scrape(r: Rt, f0: number, f1: number, dur: number, gainV: number): void {
    noiseSwell(r, { kind: 'pink', type: 'bandpass', freq: f0, freqEnd: f1, q: 2.2, gain: gainV, dur, peakAt: 0.6 })
}

/** PaP shimmer: a quick, soft sparkle of high bell partials and a low violet whum. */
function papShimmer(r: Rt): void {
    const notes = [1568, 2093, 2637]
    notes.forEach((f, i) => fmBell(at(r, 0.008 + i * 0.022), { freq: f * rnd(0.995, 1.005), dur: 0.42, gain: 0.05, ratio: 3.01, index: 0.5, bite: 0.05 }))
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 1400, 1.2, g)
    for (const d of [-14, 14]) {
        const o = oscNode(ctx, 'sawtooth', 220 * r.rate, t, 0.4, lp)
        o.detune.setValueAtTime(d, t)
        o.frequency.exponentialRampToValueAtTime(110 * r.rate, t + 0.32)
    }
    lp.frequency.setValueAtTime(2200, t)
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.3)
    decayEnv(g.gain, t, 0.06 * r.vol, 0.01, 0.32)
}

function gunshot(v: DfGunVoice, mode: 'plain' | 'sup' | 'pap'): DfSynth {
    return (ctx, out, o) => {
        const remote = !!o.pos
        const r = rtOf(ctx, out, o)
        const pap = mode === 'pap'
        const lvl = v.gain * (pap ? 1.05 : 1)
        // Body + blast through a soft saturator so the transient is fat, not spiky.
        const punchOut = gainNode(ctx, lvl, out)
        const sat = shaperNode(ctx, mode === 'sup' ? 0.6 : v.drive, punchOut)
        const pre = gainNode(ctx, 0.85, sat)
        const p: Rt = { ...r, out: pre }
        if (mode === 'sup') {
            // Suppressed: a muffled "thup" and a short exhale, the action is the loudest part.
            thump(p, v.body * 0.9, v.bodyEnd, v.bodyDur * 0.8, 0.5)
            noiseBurst(p, { kind: 'pink', type: 'lowpass', freq: 900, freqEnd: 300, q: 0.7, gain: 0.45, dur: 0.07 })
            noiseBurst({ ...r, out: punchOut }, { kind: 'pink', type: 'bandpass', freq: 1300, freqEnd: 700, q: 1.2, gain: 0.12, dur: 0.06 })
            if (!remote) {
                const m = at({ ...r, out: punchOut }, Math.max(0.02, v.mechAt))
                tick(m, v.mech || 2400, 0.22)
            }
            return
        }
        const body = pap ? 1.12 : 1
        thump(p, v.body * body, v.bodyEnd, v.bodyDur, 0.95)
        thump(p, v.body * 0.5 * body, v.bodyEnd * 0.7, v.bodyDur * 1.4, 0.35, 'triangle')
        noiseBurst(p, { kind: 'pink', type: 'lowpass', freq: v.blast, freqEnd: v.blast * 0.22, q: 0.7, gain: 0.9, dur: v.blastDur, attack: 0.0008 })
        // Supersonic crack: short and band-limited so it snaps without fizzing.
        const dry: Rt = { ...r, out: punchOut }
        if (v.crack > 0 && !remote) {
            noiseBurst(dry, { kind: 'white', type: 'bandpass', freq: v.crack, q: 1.1, gain: 0.32, dur: 0.014, attack: 0.0005 })
        }
        // Outdoor tail and a slapback off the ruins.
        const tailG = remote ? 0.32 : 0.2
        noiseSwell(dry, { kind: 'brown', type: 'lowpass', freq: v.blast * 0.45, freqEnd: 140, q: 0.6, gain: tailG, dur: v.tail, peakAt: 0.04 })
        if (v.echo > 0) {
            const e = at(dry, rnd(0.13, 0.24))
            noiseBurst(e, { kind: 'pink', type: 'lowpass', freq: v.blast * 0.3, freqEnd: 200, q: 0.6, gain: v.echo * 0.12, dur: v.tail * 0.5, attack: 0.01 })
        }
        if (!remote && v.mechGain > 0) tick(at(dry, v.mechAt), v.mech, v.mechGain)
        if (pap) papShimmer(dry)
    }
}

/** M1911 at tier 1+: twin grenade launchers, a hollow tube "thoomp". */
const launcher: DfSynth = (ctx, out, o) => {
    const r = rtOf(ctx, out, o)
    const sat = shaperNode(ctx, 1.2, gainNode(ctx, 0.75, out))
    const p = { ...r, out: sat }
    thump(p, 180, 55, 0.16, 0.9)
    noiseBurst(p, { kind: 'pink', type: 'bandpass', freq: 520, freqEnd: 260, q: 2.5, gain: 0.7, dur: 0.12 })
    noiseBurst({ ...r, out }, { kind: 'pink', type: 'lowpass', freq: 1200, freqEnd: 300, q: 0.7, gain: 0.25, dur: 0.18 })
    if (!o.pos) {
        tick(at({ ...r, out }, 0.05), 2400, 0.1)
        papShimmer({ ...r, out })
    }
}

/** X-Ray: a bright, glassy ray zap with a sub kick (never shrill: tops out around 3 kHz). */
function xray(pap: boolean): DfSynth {
    return (ctx, out, o) => {
        const r = rtOf(ctx, out, o, 0.03)
        const { t } = r
        const lvl = pap ? 0.75 : 0.65
        const bus = gainNode(ctx, lvl, out)
        // FM "pew": the modulation collapses as the pitch falls, so it starts gritty and ends pure.
        const g = gainNode(ctx, 0, bus)
        const car = oscNode(ctx, 'sine', 1500 * r.rate, t, 0.3, g)
        car.frequency.exponentialRampToValueAtTime(240 * r.rate, t + 0.22)
        const modG = gainNode(ctx, 0, car.frequency)
        const mod = oscNode(ctx, 'sine', 1500 * 1.5 * r.rate, t, 0.3, modG)
        mod.frequency.exponentialRampToValueAtTime(240 * 1.5 * r.rate, t + 0.22)
        modG.gain.setValueAtTime(1800, t)
        modG.gain.exponentialRampToValueAtTime(20, t + 0.16)
        decayEnv(g.gain, t, 0.5, 0.002, 0.24)
        // Wobble of the bolt leaving.
        const wob = gainNode(ctx, 40, car.detune)
        oscNode(ctx, 'sine', 28, t, 0.3, wob)
        thump({ ...r, out: bus }, 160, 60, 0.12, 0.6)
        noiseBurst({ ...r, out: bus }, { kind: 'white', type: 'bandpass', freq: 2600, freqEnd: 1200, q: 1.6, gain: 0.14, dur: 0.08 })
        if (pap) {
            fmBell(at({ ...r, out: bus }, 0.02), { freq: 1318, dur: 0.4, gain: 0.07, ratio: 2.01, index: 0.8 })
            fmBell(at({ ...r, out: bus }, 0.05), { freq: 1976, dur: 0.35, gain: 0.05, ratio: 2.01, index: 0.6 })
        }
    }
}

/** The arc rifle: a heavy discharge, a buzzing arc and a crackling tail. */
function wunder(pap: boolean): DfSynth {
    return (ctx, out, o) => {
        const r = rtOf(ctx, out, o, 0.03)
        const { t } = r
        const bus = gainNode(ctx, 0.6, out)
        const sat = shaperNode(ctx, 1.4, gainNode(ctx, 0.9, bus))
        const p = { ...r, out: sat }
        thump(p, 140, 40, 0.3, 0.9)
        noiseBurst(p, { kind: 'pink', type: 'lowpass', freq: 1800, freqEnd: 250, q: 0.7, gain: 0.55, dur: 0.18 })
        // The arc: a buzzy saw through a sweeping band, flickering.
        const g = gainNode(ctx, 0, bus)
        const bp = filterNode(ctx, 'bandpass', 900 * r.rate, 1.6, g)
        const saw = oscNode(ctx, 'sawtooth', (pap ? 130 : 110) * r.rate, t, 0.55, bp)
        saw.frequency.exponentialRampToValueAtTime(55 * r.rate, t + 0.5)
        bp.frequency.setValueAtTime(2200 * r.rate, t)
        bp.frequency.exponentialRampToValueAtTime(500 * r.rate, t + 0.45)
        decayEnv(g.gain, t, 0.45, 0.003, 0.5)
        crackle({ ...r, out: bus }, 0.45, 0.22, 90)
        noiseSwell({ ...r, out: bus }, { kind: 'brown', type: 'lowpass', freq: 500, freqEnd: 90, q: 0.6, gain: 0.25, dur: 0.9, peakAt: 0.05 })
        if (pap) papShimmer({ ...r, out: bus })
    }
}

export function registerDfWeaponSoundsImpl(audio: DfAudio): void {
    const limit = (name: string, max: number) => (audio as DfAudio & { setVoiceLimit?(n: string, m: number): void }).setVoiceLimit?.(name, max)
    for (const id of DF_WEAPON_IDS) {
        if (id === 'xray') {
            audio.register(DF_WSND.fire(id, 0), xray(false))
            audio.register(DF_WSND.fire(id, 1), xray(true))
            audio.register(DF_WSND.fire(id, 0, true), xray(false))
        } else if (id === 'wunder') {
            audio.register(DF_WSND.fire(id, 0), wunder(false))
            audio.register(DF_WSND.fire(id, 1), wunder(true))
            audio.register(DF_WSND.fire(id, 0, true), wunder(false))
        } else {
            const v = DF_GUN_VOICES[id]
            audio.register(DF_WSND.fire(id, 0), gunshot(v, 'plain'))
            audio.register(DF_WSND.fire(id, 0, true), gunshot(v, 'sup'))
            audio.register(DF_WSND.fire(id, 1), id === 'm1911' ? launcher : gunshot(v, 'pap'))
        }
        // Rapid fire: the oldest tails give way so automatics never pile up.
        for (const name of [DF_WSND.fire(id, 0), DF_WSND.fire(id, 1), DF_WSND.fire(id, 0, true)]) limit(name, 4)
    }

    const r = (name: string, recipe: (r: Rt, o: DfSoundOpts) => void, gainV = 1) => audio.register(name, (ctx, out, o) => {
        recipe(rtOf(ctx, gainV === 1 ? out : gainNode(ctx, gainV, out), o, 0.03), o)
    })

    // Trigger on an empty chamber: the sear and a hollow click.
    r(DF_WSND.dry, (p) => {
        tick(p, 2700, 0.3, 0.05)
        tick(at(p, 0.012), 1700, 0.15, 0.04)
    })
    // Mag release: button tick, the mag slides out of the well.
    r(DF_WSND.magOut, (p) => {
        tick(p, 2400, 0.25)
        scrape(at(p, 0.015), 1300, 900, 0.1, 0.18)
        thump(at(p, 0.09), 300, 150, 0.05, 0.12)
    })
    // Mag seated: slide in and a firm clack.
    r(DF_WSND.magIn, (p) => {
        scrape(p, 900, 1500, 0.07, 0.15)
        clack(at(p, 0.07), 1900, 0.42)
    })
    // Slide / charging handle: rack back, snap forward.
    r(DF_WSND.slide, (p) => {
        tick(p, 2200, 0.18)
        scrape(at(p, 0.01), 2000, 1400, 0.06, 0.16)
        clack(at(p, 0.08), 2300, 0.45)
    })
    r(DF_WSND.boltOpen, (p) => {
        tick(p, 1700, 0.28, 0.08)
        scrape(at(p, 0.03), 1200, 1900, 0.1, 0.16)
        tick(at(p, 0.13), 2400, 0.12)
    })
    r(DF_WSND.boltClose, (p) => {
        scrape(p, 1900, 1200, 0.08, 0.15)
        clack(at(p, 0.08), 1600, 0.45)
        tick(at(p, 0.13), 1300, 0.14, 0.08)
    })
    // Trench gun pump: wood and steel, "shuck-chk".
    r(DF_WSND.pump, (p) => {
        scrape(p, 800, 1200, 0.09, 0.22)
        clack(at(p, 0.09), 1300, 0.42)
        scrape(at(p, 0.15), 1200, 800, 0.08, 0.18)
        clack(at(p, 0.23), 1100, 0.5)
        thump(at(p, 0.23), 160, 80, 0.08, 0.2)
    })
    // A shell thumbed into the tube.
    r(DF_WSND.shell, (p) => {
        scrape(p, 700, 1100, 0.05, 0.12)
        clack(at(p, 0.05), 1400, 0.3)
    })
    // Stripper clip: rounds rattle down, the clip pings out.
    r(DF_WSND.clip, (p) => {
        tick(p, 2600, 0.25)
        clickTrain(at(p, 0.05), [0, 0.028, 0.055, 0.08, 0.1], { freq: 2900, q: 3, gain: 0.14, len: 0.008, gains: [1, 0.9, 0.8, 0.7, 0.6] })
        scrape(at(p, 0.04), 1600, 2200, 0.1, 0.1)
        metal(at(p, 0.16), { base: 2600, ratios: [1, 1.38, 2.2], decay: 0.18, gain: 0.07, strike: 0.2 })
    })
    // Drum / pan magazine: a rattle of rounds and a heavy latch.
    r(DF_WSND.drum, (p) => {
        clickTrain(p, scatter(9, 0.16, 1), { freq: 2200, q: 2, gain: 0.12, len: 0.008, jitter: 0.5 })
        scrape(p, 900, 1300, 0.16, 0.14)
        clack(at(p, 0.18), 1300, 0.45)
    })
    // Raise: a cloth rustle and a sling-swivel rattle.
    r(DF_WSND.raise, (p) => {
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 700, freqEnd: 1100, q: 0.9, gain: 0.12, dur: 0.18, peakAt: 0.5 })
        clickTrain(at(p, 0.1), [0, 0.03], { freq: 2600, q: 4, gain: 0.08, len: 0.008, gains: [1, 0.6] })
    })
    r(DF_WSND.knife, (p) => {
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 700, freqEnd: 2600, q: 1.3, gain: 0.45, dur: 0.17, peakAt: 0.65 })
        noiseSwell(p, { kind: 'white', type: 'bandpass', freq: 3000, freqEnd: 2200, q: 3, gain: 0.05, dur: 0.15, peakAt: 0.7 })
    })
    r(DF_WSND.pin, (p) => {
        tick(p, 3000, 0.22, 0.1)
        metal(at(p, 0.03), { base: 2900, ratios: [1, 1.6], decay: 0.2, gain: 0.05, strike: 0 })
    })
    r(DF_WSND.throw, (p) => {
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 600, freqEnd: 1800, q: 1, gain: 0.32, dur: 0.24, peakAt: 0.6 })
    })
    // Explosion: sub punch, a dark blast that rolls off, debris pattering down.
    r(DF_WSND.explode, (p) => {
        const sat = shaperNode(p.ctx, 1.6, gainNode(p.ctx, 0.85, p.out))
        const s = { ...p, out: sat }
        thump(s, 95, 28, 0.7, 1)
        noiseBurst(s, { kind: 'pink', type: 'lowpass', freq: 2600, freqEnd: 140, q: 0.6, gain: 0.85, dur: 0.9, attack: 0.001 })
        noiseBurst(p, { kind: 'white', type: 'bandpass', freq: 1600, q: 0.8, gain: 0.22, dur: 0.02 })
        noiseSwell(p, { kind: 'brown', type: 'lowpass', freq: 420, freqEnd: 60, q: 0.6, gain: 0.4, dur: 2.2, peakAt: 0.05 })
        clickTrain(at(p, 0.25), scatter(14, 0.9, 1.3), { freq: 1700, q: 1.2, gain: 0.08, len: 0.012, jitter: 0.6 })
    })
    // X-Ray bolt hitting: a green splash, a falling glassy pop and fizz.
    r(DF_WSND.xrayHit, (p) => {
        thump(p, 520, 90, 0.18, 0.55)
        fmBell(p, { freq: 880, dur: 0.3, gain: 0.12, ratio: 1.5, index: 2, bite: 0.08 })
        noiseBurst(p, { kind: 'pink', type: 'bandpass', freq: 2000, freqEnd: 600, q: 1.4, gain: 0.3, dur: 0.25 })
        clickTrain(at(p, 0.04), scatter(10, 0.3, 1.4), { freq: 2400, q: 1.5, gain: 0.08, len: 0.006, jitter: 0.6 })
    })
    // An arc jumping between zombies: a crackle with a buzzing core.
    r(DF_WSND.arc, (p) => {
        crackle(p, 0.25, 0.22, 100)
        const { ctx, t } = p
        const g = gainNode(ctx, 0, p.out)
        const bp = filterNode(ctx, 'bandpass', 1200 * p.rate, 2, g)
        oscNode(ctx, 'sawtooth', 120 * p.rate, t, 0.3, bp)
        decayEnv(g.gain, t, 0.25, 0.003, 0.25)
    })
    // Relief valve on the coil weapons: soft steam, not a fizz.
    r(DF_WSND.steam, (p) => {
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 2600, freqEnd: 3200, q: 0.9, gain: 0.18, dur: 0.5, peakAt: 0.15 })
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 900, q: 1, gain: 0.08, dur: 0.4, peakAt: 0.1 })
    })
    // Coil charging: a rising whine with a mains buzz.
    r(DF_WSND.charge, (p) => {
        const { ctx, t } = p
        const g = gainNode(ctx, 0, p.out)
        const lp = filterNode(ctx, 'lowpass', 2800, 0.8, g)
        const o = oscNode(ctx, 'triangle', 260 * p.rate, t, 0.75, lp)
        o.frequency.exponentialRampToValueAtTime(1500 * p.rate, t + 0.68)
        const buzz = gainNode(ctx, 30, o.frequency)
        oscNode(ctx, 'square', 50, t, 0.75, buzz)
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.12, t + 0.6)
        g.gain.linearRampToValueAtTime(0, t + 0.72)
    })
    r(DF_WSND.splat, (p) => {
        thump(p, 170, 60, 0.14, 0.35)
        noiseBurst(p, { kind: 'pink', type: 'lowpass', freq: 900, freqEnd: 220, q: 1, gain: 0.55, dur: 0.24 })
    })
    // Brass casing on the ground: a light tinkle and one bounce.
    r(DF_WSND.casing, (p) => {
        const f = rnd(3600, 4400)
        metal(p, { base: f, ratios: [1, 1.34, 1.87], decay: 0.12, gain: 0.05, strike: 0 })
        metal(at(p, rnd(0.07, 0.11)), { base: f * 1.02, ratios: [1, 1.34], decay: 0.07, gain: 0.025, strike: 0 })
    })
}
