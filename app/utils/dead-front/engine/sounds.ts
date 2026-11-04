import type { DfPowerupKind } from '#shared/utils/dead-front/constants'
import { dfMaterialSurface } from '#shared/utils/dead-front/map'
import type { DfAudio, DfSoundOpts } from '../context'
import {
    at, decayEnv, filterNode, gainNode, link, mtof, noiseBuffer, oscNode, reverbSend, rnd
} from '../world/sounds/noise'
import type { Rt } from '../world/sounds/noise'
import { bell, clickTrain, fmBell, metal, noiseBurst, noiseSwell, scatter, thud } from '../world/sounds/parts'
import type { DfTensionSynth } from './audio'

// Procedural UI and feedback sounds owned by the engine: hitmarkers, points,
// purchases, round stingers, downed heartbeat, breathing, power-ups, revive,
// footsteps and jumps, plus the horde-tension bed. Everything is synthesised.
//
// The round stingers share one motif, "the toll": a low bell, then horns
// sighing D - A - Bb - A over a timpani roll. The round-end answer climbs
// A - Bb - C - D and opens into D major: you made it through the night.

export const DF_SND = {
    hit: 'df:hit',
    head: 'df:hit-head',
    kill: 'df:kill',
    killHead: 'df:kill-head',
    points: 'df:points',
    buy: 'df:buy',
    denied: 'df:denied',
    roundStart: 'df:round-start',
    roundEnd: 'df:round-end',
    gameStart: 'df:game-start',
    heartbeat: 'df:heartbeat',
    breath: 'df:breath',
    revive: 'df:revive',
    reviveTick: 'df:revive-tick',
    down: 'df:down',
    hurt: 'df:hurt',
    jump: 'df:jump',
    land: 'df:land',
    slide: 'df:slide',
    throw: 'df:throw',
    lunge: 'df:lunge',
    powerupSpawn: 'df:pu-spawn',
    powerupEnd: 'df:pu-end',
    step: (mat: string) => `df:step-${stepMat(mat)}`,
    powerup: (kind: DfPowerupKind) => `df:pu-${kind}`
} as const

export function stepMat(mat: string): 'mud' | 'wood' | 'stone' {
    const s = dfMaterialSurface(mat)
    return s === 'wood' ? 'wood' : s === 'stone' || s === 'metal' ? 'stone' : 'mud'
}

/** MIDI note numbers of the stinger motif (exported for the spec). */
export const DF_TOLL_MOTIF = { start: [50, 45, 46, 45], end: [45, 46, 48, 50] } as const

// ---------------------------------------------------------------- instruments

function blip(r: Rt, f0: number, f1: number, dur: number, gainV: number, type: OscillatorType = 'sine'): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const o = oscNode(ctx, type, f0 * r.rate, t, dur + 0.05, g)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * r.rate), t + dur * 0.8)
    decayEnv(g.gain, t, gainV * r.vol, 0.0015, dur)
}

/** A dark horn: detuned saws through a lowpass that blooms on the attack, late vibrato. */
function horn(r: Rt, midi: number, dur: number, gainV: number, bright = 1): void {
    const { ctx, t } = r
    const f = mtof(midi) * r.rate
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 400, 1.1, g)
    const vib = gainNode(ctx, 0)
    oscNode(ctx, 'sine', 4.8, t, dur + 0.4, vib)
    for (const d of [-7, 6]) {
        const o = oscNode(ctx, 'sawtooth', f, t, dur + 0.4, lp)
        o.detune.setValueAtTime(d, t)
        vib.connect(o.detune)
    }
    oscNode(ctx, 'triangle', f * 0.5, t, dur + 0.4, gainNode(ctx, 0.5, lp))
    vib.gain.setValueAtTime(0, t)
    vib.gain.linearRampToValueAtTime(0, t + dur * 0.4)
    vib.gain.linearRampToValueAtTime(10, t + dur)
    lp.frequency.setValueAtTime(260, t)
    lp.frequency.exponentialRampToValueAtTime(Math.min(1800, f * 7 * bright), t + 0.09)
    lp.frequency.exponentialRampToValueAtTime(Math.min(1100, f * 4 * bright), t + Math.max(0.2, dur * 0.6))
    const pk = gainV * r.vol
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(pk, t + 0.05)
    g.gain.linearRampToValueAtTime(pk * 0.78, t + 0.18)
    g.gain.setValueAtTime(pk * 0.78, t + dur)
    g.gain.linearRampToValueAtTime(0, t + dur + 0.35)
}

/** One timpani stroke: a pitched membrane with a soft mallet thump. */
function timpani(r: Rt, midi: number, gainV: number): void {
    const f = mtof(midi)
    blip(r, f * 1.04, f, 0.9, gainV)
    blip(r, f * 1.5, f * 1.48, 0.5, gainV * 0.3)
    noiseBurst(r, { kind: 'brown', type: 'lowpass', freq: 500, q: 0.7, gain: gainV * 0.6, dur: 0.12 })
}

/** A timpani roll swelling from soft to `peak` over `dur`. */
function timpaniRoll(r: Rt, midi: number, dur: number, peak: number): void {
    const n = Math.max(2, Math.round(dur / 0.055))
    for (let i = 0; i < n; i++) {
        const u = i / (n - 1)
        timpani(at(r, i * 0.055 + rnd(-0.006, 0.006)), midi, peak * (0.15 + 0.85 * u * u) * rnd(0.85, 1))
    }
}

/** A choir pad: detuned saws through "ah" formants, swelling in and out. */
function choir(r: Rt, notes: readonly number[], dur: number, gainV: number): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const mix = gainNode(ctx, 1)
    for (const [fr, q, lvl] of [[730, 6, 1], [1090, 8, 0.5], [2440, 10, 0.15]] as const) {
        const bp = filterNode(ctx, 'bandpass', fr, q, gainNode(ctx, lvl, g))
        mix.connect(bp)
    }
    for (const m of notes) {
        for (const d of [-9, 0, 8]) {
            const o = oscNode(ctx, 'sawtooth', mtof(m) * r.rate, t, dur + 0.1, mix)
            o.detune.setValueAtTime(d, t)
            const lg = gainNode(ctx, 5, o.detune)
            oscNode(ctx, 'sine', rnd(4.4, 5.6), t, dur + 0.1, lg)
        }
    }
    const pk = gainV * r.vol
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(pk, t + dur * 0.45)
    g.gain.linearRampToValueAtTime(0, t + dur)
}

// ---------------------------------------------------------------- tension bed

/** The horde's pressure: a low drone and a minor-second string cluster that pulse harder as more zombies are up. */
export const dfTensionBed: DfTensionSynth = (ctx, out) => {
    const t0 = ctx.currentTime
    const bus = gainNode(ctx, 0, out)
    const nodes: OscillatorNode[] = []
    const osc = (type: OscillatorType, f: number, dest: AudioNode | AudioParam, detune = 0): OscillatorNode => {
        const o = ctx.createOscillator()
        o.type = type
        o.frequency.value = f
        o.detune.value = detune
        link(o, dest)
        o.start(t0)
        nodes.push(o)
        return o
    }
    // Drone: D1 / A1 saws, dark.
    const droneG = gainNode(ctx, 0, bus)
    const pulse = gainNode(ctx, 1, droneG)
    const droneLp = filterNode(ctx, 'lowpass', 180, 0.8, pulse)
    osc('sawtooth', mtof(26), droneLp, -6)
    osc('sawtooth', mtof(26), droneLp, 7)
    osc('sawtooth', mtof(33), gainNode(ctx, 0.6, droneLp), 3)
    // Pulse: a slow throb that quickens with the tension.
    const pulseDepth = gainNode(ctx, 0, pulse.gain)
    const pulseLfo = osc('sine', 0.5, pulseDepth)
    // Strings: D3 + Eb3 cluster, bowed, with a slow swell.
    const strG = gainNode(ctx, 0, bus)
    const strLp = filterNode(ctx, 'lowpass', 700, 0.7, strG)
    for (const [m, d] of [[50, -4], [51, 5], [62, -3]] as const) {
        const o = osc('sawtooth', mtof(m), gainNode(ctx, m > 60 ? 0.35 : 1, strLp), d)
        osc('sine', rnd(4.5, 5.5), gainNode(ctx, 6, o.detune))
    }
    // Low wind in the wire: filtered noise breathing at high tension.
    const air = ctx.createBufferSource()
    air.buffer = noiseBuffer(ctx, 'pink')
    air.loop = true
    const airG = gainNode(ctx, 0, bus)
    air.connect(filterNode(ctx, 'bandpass', 380, 3, airG))
    air.start(t0, Math.random() * 3)
    bus.gain.setValueAtTime(0, t0)
    bus.gain.linearRampToValueAtTime(1, t0 + 2)
    let stopped = false
    return {
        set(v) {
            if (stopped) return
            const t = ctx.currentTime
            const x = Math.max(0, Math.min(1, v))
            droneG.gain.setTargetAtTime(0.008 + 0.036 * x, t, 2.5)
            strG.gain.setTargetAtTime(0.016 * Math.max(0, x - 0.25) / 0.75, t, 3)
            airG.gain.setTargetAtTime(0.045 * Math.max(0, x - 0.5) / 0.5, t, 3)
            pulseDepth.gain.setTargetAtTime(0.15 + 0.5 * x, t, 2)
            pulseLfo.frequency.setTargetAtTime(0.45 + 0.9 * x, t, 3)
            if (x <= 0.001) {
                droneG.gain.setTargetAtTime(0, t, 3)
            }
        },
        stop() {
            if (stopped) return
            stopped = true
            const t = ctx.currentTime
            bus.gain.cancelScheduledValues(t)
            bus.gain.setValueAtTime(bus.gain.value, t)
            bus.gain.linearRampToValueAtTime(0, t + 0.5)
            for (const o of nodes) {
                try {
                    o.stop(t + 0.6)
                } catch {
                    // already stopped
                }
            }
            try {
                air.stop(t + 0.6)
            } catch {
                // already stopped
            }
            setTimeout(() => bus.disconnect(), 800)
        }
    }
}

// ---------------------------------------------------------------- registry

export function registerDfEngineSounds(audio: DfAudio): void {
    const eng = audio as DfAudio & { setVoiceLimit?(n: string, m: number): void, setTensionSynth?(s: DfTensionSynth): void }
    const r = (name: string, s: (r: Rt, o: DfSoundOpts) => void, limit?: number) => {
        audio.register(name, (ctx, out, o) => s({ ctx, out, t: ctx.currentTime + 0.002, vol: 1, rate: o.rate ?? 1 }, o))
        if (limit !== undefined) eng.setVoiceLimit?.(name, limit)
    }
    eng.setTensionSynth?.(dfTensionBed)

    /** Stingers get their own tail so they bloom even with a dry UI bus. */
    const hall = (p: Rt, wet = 0.45): Rt => ({ ...p, out: reverbSend(p.ctx, p.out, wet, 2.6, 2.6, 0.55) })

    // Hitmarker: a soft, dry "tk" that stays pleasant at 15 hits a second.
    r(DF_SND.hit, (p) => {
        clickTrain(p, [0], { freq: 2300, q: 1.8, gain: 0.7, len: 0.008, jitter: 0.15 })
        blip(p, 1350, 1050, 0.04, 0.3, 'triangle')
    }, 3)
    // Headshot: the tick plus a small bright "tink".
    r(DF_SND.head, (p) => {
        clickTrain(p, [0], { freq: 2600, q: 1.8, gain: 0.6, len: 0.008, jitter: 0.15 })
        fmBell(p, { freq: 1760, dur: 0.28, gain: 0.22, ratio: 3.5, index: 0.7, bite: 0.04 })
    }, 3)
    // Kill confirm: a soft low thunk with a felt click.
    r(DF_SND.kill, (p) => {
        blip(p, 190, 62, 0.12, 0.5)
        noiseBurst(p, { kind: 'pink', type: 'bandpass', freq: 1100, q: 1.4, gain: 0.16, dur: 0.03 })
    }, 4)
    // Headshot kill: the thunk and a clear two-partial ding.
    r(DF_SND.killHead, (p) => {
        blip(p, 210, 66, 0.13, 0.5)
        noiseBurst(p, { kind: 'pink', type: 'bandpass', freq: 1500, q: 1.4, gain: 0.16, dur: 0.03 })
        fmBell(at(p, 0.008), { freq: 2093, dur: 0.45, gain: 0.13, ratio: 2.76, index: 0.5, bite: 0.05 })
    }, 4)
    // Points: a quiet two-note chime, higher for big gains (rate).
    r(DF_SND.points, (p) => {
        fmBell(p, { freq: 1319, dur: 0.18, gain: 0.08, ratio: 2, index: 0.4, bite: 0.03 })
        fmBell(at(p, 0.05), { freq: 1976, dur: 0.24, gain: 0.07, ratio: 2, index: 0.4, bite: 0.03 })
    }, 3)
    // Purchase: the till drawer clunks, a bell rings, coins settle.
    r(DF_SND.buy, (p) => {
        thud(p, { freq: 150, freqEnd: 80, dur: 0.12, gain: 0.3, body: 0.5, bodyFreq: 900, click: 0.25 })
        clickTrain(p, [0, 0.03], { freq: 1800, q: 3, gain: 0.2, len: 0.01, gains: [1, 0.6] })
        fmBell(at(p, 0.07), { freq: 2093, dur: 0.8, gain: 0.14, ratio: 3.01, index: 0.6, bite: 0.06 })
        fmBell(at(p, 0.07), { freq: 2637, dur: 0.6, gain: 0.08, ratio: 3.01, index: 0.5, bite: 0.06 })
        clickTrain(at(p, 0.12), scatter(7, 0.22, 1.3), { freq: 3200, q: 4, gain: 0.07, len: 0.01, jitter: 0.5 })
    }, 2)
    // Denied: two dull knocks with a low buzz under them.
    r(DF_SND.denied, (p) => {
        for (let i = 0; i < 2; i++) {
            const k = at(p, i * 0.13)
            const lp = filterNode(p.ctx, 'lowpass', 700, 0.8, p.out)
            blip({ ...k, out: lp }, 104, 96, 0.1, 0.22, 'square')
            blip(k, 220, 140, 0.06, 0.16)
        }
    }, 2)
    // Round start: the toll. A low bell, the horns sigh D - A - Bb - A, a timpani roll into a D minor choir.
    r(DF_SND.roundStart, (p) => {
        const h = hall(p)
        const [a, b, c, d] = DF_TOLL_MOTIF.start
        bell(h, { freq: mtof(38), dur: 5.5, gain: 0.5, bright: 0.45 })
        blip(p, mtof(26), mtof(26), 3.5, 0.32)
        timpaniRoll(at(h, 0.2), 38, 1.1, 0.32)
        horn(at(h, 0.35), a, 0.55, 0.16)
        horn(at(h, 0.95), b, 0.5, 0.15)
        horn(at(h, 1.5), c, 0.9, 0.17)
        horn(at(h, 2.45), d, 1.8, 0.16, 0.8)
        horn(at(h, 2.45), d - 12, 1.8, 0.1, 0.7)
        timpani(at(h, 2.45), 33, 0.45)
        choir(at(h, 2.2), [50, 53, 57], 3.6, 0.045)
        bell(at(h, 2.5), { freq: mtof(50), dur: 3.5, gain: 0.25, bright: 0.4 })
    }, 1)
    // Round end: the answer climbs A - Bb - C - D and opens into D major, bells falling softly.
    r(DF_SND.roundEnd, (p) => {
        const h = hall(p, 0.5)
        const [a, b, c, d] = DF_TOLL_MOTIF.end
        horn(h, a, 0.4, 0.12, 0.8)
        horn(at(h, 0.42), b, 0.4, 0.12, 0.8)
        horn(at(h, 0.84), c, 0.45, 0.13, 0.85)
        horn(at(h, 1.3), d, 2.2, 0.14, 0.9)
        horn(at(h, 1.3), d - 7, 2.2, 0.09, 0.8)
        horn(at(h, 1.3), d - 12, 2.2, 0.08, 0.7)
        choir(at(h, 1.2), [50, 54, 57], 3.4, 0.04)
        for (const [i, m] of [74, 69, 66, 62].entries()) bell(at(h, 1.4 + i * 0.4), { freq: mtof(m), dur: 2.4, gain: 0.16, bright: 0.5 })
        timpani(at(h, 1.3), 38, 0.3)
    }, 1)
    // Match start: a far trench whistle, then the toll's first note.
    r(DF_SND.gameStart, (p) => {
        const h = hall(p, 0.55)
        const { ctx, t } = h
        const g = gainNode(ctx, 0, h.out)
        const bp = filterNode(ctx, 'bandpass', 2300, 4, g)
        const o = oscNode(ctx, 'triangle', 2250, t + 0.3, 1.1, bp)
        const trill = gainNode(ctx, 70, o.frequency)
        oscNode(ctx, 'sine', 30, t + 0.3, 1.1, trill)
        g.gain.setValueAtTime(0, t + 0.3)
        g.gain.linearRampToValueAtTime(0.1, t + 0.36)
        g.gain.setValueAtTime(0.1, t + 1)
        g.gain.linearRampToValueAtTime(0, t + 1.3)
        noiseSwell(at(h, 0.3), { kind: 'white', type: 'bandpass', freq: 2300, q: 3, gain: 0.03, dur: 1, peakAt: 0.1 })
        bell(at(h, 1.5), { freq: mtof(38), dur: 4.5, gain: 0.4, bright: 0.4 })
        horn(at(h, 1.6), 38, 2.6, 0.1, 0.6)
    }, 1)
    // Heartbeat: lub-dub, with a little upper body so it reads on laptop speakers.
    r(DF_SND.heartbeat, (p) => {
        blip(p, 70, 42, 0.16, 0.7)
        blip(p, 140, 90, 0.08, 0.18, 'triangle')
        blip(at(p, 0.19), 60, 38, 0.2, 0.5)
        blip(at(p, 0.19), 120, 80, 0.09, 0.12, 'triangle')
        noiseBurst(p, { kind: 'brown', type: 'lowpass', freq: 260, q: 0.7, gain: 0.12, dur: 0.07 })
    }, 2)
    // Low-health breathing: a filtered inhale and exhale.
    r(DF_SND.breath, (p) => {
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 1000, freqEnd: 1400, q: 1.6, gain: 0.16, dur: 0.55 / p.rate, peakAt: 0.7 })
        noiseSwell(at(p, 0.75 / p.rate), { kind: 'pink', type: 'bandpass', freq: 750, freqEnd: 480, q: 1.4, gain: 0.13, dur: 0.7 / p.rate, peakAt: 0.15 })
    }, 1)
    r(DF_SND.hurt, (p) => {
        blip(p, 95, 45, 0.18, 0.5)
        noiseBurst(p, { kind: 'pink', type: 'lowpass', freq: 900, freqEnd: 200, q: 0.8, gain: 0.25, dur: 0.12 })
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 600, q: 2, gain: 0.08, dur: 0.25, peakAt: 0.2 })
    }, 2)
    // Downed: a heavy hit, the world drops away, one low bell.
    r(DF_SND.down, (p) => {
        blip(p, 72, 30, 0.8, 0.6)
        noiseBurst(p, { kind: 'brown', type: 'lowpass', freq: 500, freqEnd: 80, q: 0.7, gain: 0.35, dur: 0.4 })
        const h = hall(p, 0.6)
        noiseSwell(h, { kind: 'pink', type: 'lowpass', freq: 1400, freqEnd: 200, q: 0.8, gain: 0.08, dur: 1.4, peakAt: 0.05 })
        bell(at(h, 0.2), { freq: mtof(45), dur: 3.5, gain: 0.25, bright: 0.35 })
    }, 1)
    // Revived: a warm rising arpeggio over a soft choir.
    r(DF_SND.revive, (p) => {
        const h = hall(p, 0.4)
        for (const [i, m] of [62, 66, 69, 74].entries()) fmBell(at(h, i * 0.09), { freq: mtof(m), dur: 1, gain: 0.07, ratio: 2, index: 0.5, bite: 0.1 })
        choir(h, [50, 54, 57], 1.8, 0.035)
    }, 1)
    r(DF_SND.reviveTick, (p) => {
        blip(p, 880, 880, 0.05, 0.05)
    }, 2)
    r(DF_SND.throw, (p) => {
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 700, freqEnd: 2000, q: 1.1, gain: 0.25, dur: 0.22, peakAt: 0.6 })
    }, 2)
    r(DF_SND.lunge, (p) => {
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 900, freqEnd: 2400, q: 1.1, gain: 0.22, dur: 0.16, peakAt: 0.6 })
    }, 2)
    r(DF_SND.jump, (p) => {
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 500, freqEnd: 1200, q: 1, gain: 0.12, dur: 0.12, peakAt: 0.3 })
        noiseBurst(p, { kind: 'brown', type: 'lowpass', freq: 300, q: 0.7, gain: 0.12, dur: 0.05 })
    }, 2)
    // Slide: a body dropping onto the ground and a long scuff of cloth and grit.
    r(DF_SND.slide, (p) => {
        blip(p, 120, 60, 0.1, 0.25)
        noiseSwell(p, { kind: 'pink', type: 'bandpass', freq: 900, freqEnd: 500, q: 0.8, gain: 0.3, dur: 0.6, peakAt: 0.15 })
        noiseSwell(p, { kind: 'brown', type: 'lowpass', freq: 500, freqEnd: 200, q: 0.7, gain: 0.25, dur: 0.55, peakAt: 0.2 })
        clickTrain(at(p, 0.05), scatter(8, 0.45, 1.3), { freq: 2600, q: 2, gain: 0.04, len: 0.008, jitter: 0.6 })
    }, 1)
    r(DF_SND.land, (p) => {
        blip(p, 95, 50, 0.12, 0.4)
        noiseBurst(p, { kind: 'pink', type: 'lowpass', freq: 600, freqEnd: 150, q: 0.7, gain: 0.3, dur: 0.12 })
        clickTrain(at(p, 0.01), [0, 0.02], { freq: 2000, q: 2, gain: 0.06, len: 0.01, gains: [1, 0.5] })
    }, 2)

    // footsteps by surface; pitch variety comes from opts.rate
    r('df:step-mud', (p) => {
        noiseBurst(p, { kind: 'pink', type: 'lowpass', freq: 520, freqEnd: 180, q: 1.6, gain: 0.32, dur: 0.11, attack: 0.012 })
        noiseBurst(at(p, 0.04), { kind: 'pink', type: 'bandpass', freq: 1300, freqEnd: 650, q: 2.5, gain: 0.07, dur: 0.09, attack: 0.01 })
        blip(p, 70, 45, 0.07, 0.2)
    }, 6)
    r('df:step-wood', (p) => {
        noiseBurst(p, { kind: 'pink', type: 'bandpass', freq: 420, q: 3.5, gain: 0.32, dur: 0.05 })
        blip(p, 180, 120, 0.08, 0.16, 'triangle')
        noiseBurst(at(p, 0.06), { kind: 'pink', type: 'bandpass', freq: 1800, q: 3, gain: 0.05, dur: 0.03 })
    }, 6)
    r('df:step-stone', (p) => {
        noiseBurst(p, { kind: 'pink', type: 'bandpass', freq: 1500, freqEnd: 900, q: 1.2, gain: 0.26, dur: 0.05 })
        noiseBurst(at(p, 0.015), { kind: 'pink', type: 'bandpass', freq: 2800, q: 1.5, gain: 0.08, dur: 0.05 })
        blip(p, 120, 70, 0.05, 0.12)
    }, 6)

    // power-ups: each with its own stinger
    r('df:pu-maxammo', (p) => {
        const h = hall(p, 0.3)
        for (const [i, m] of [50, 55, 59, 62].entries()) horn(at(h, i * 0.11), m, i === 3 ? 1.1 : 0.16, 0.12, 1.1)
        clickTrain(p, [0, 0.03, 0.06], { freq: 2200, q: 3, gain: 0.15, len: 0.01, gains: [1, 0.7, 0.5] })
    }, 1)
    r('df:pu-double', (p) => {
        const h = hall(p, 0.35)
        for (let i = 0; i < 4; i++) fmBell(at(h, i * 0.12), { freq: mtof(i % 2 ? 79 : 74), dur: 0.9, gain: 0.09, ratio: 3.01, index: 0.6, bite: 0.06 })
        choir(at(h, 0.1), [62, 67, 71], 1.6, 0.03)
    }, 1)
    r('df:pu-insta', (p) => {
        const h = hall(p, 0.5)
        choir(h, [41, 47, 53], 2, 0.06)
        blip(h, 220, 55, 1.2, 0.18, 'triangle')
        bell(at(h, 0.05), { freq: mtof(41), dur: 2.5, gain: 0.3, bright: 0.3 })
    }, 1)
    r('df:pu-nuke', (p) => {
        blip(p, 55, 24, 2, 0.6)
        noiseBurst(p, { kind: 'brown', type: 'lowpass', freq: 800, freqEnd: 60, q: 0.7, gain: 0.45, dur: 2.2, attack: 0.02 })
        noiseBurst(p, { kind: 'pink', type: 'bandpass', freq: 1500, q: 0.8, gain: 0.15, dur: 0.3 })
        bell(at(hall(p, 0.5), 0.4), { freq: mtof(26), dur: 4, gain: 0.35, bright: 0.4 })
    }, 1)
    r('df:pu-carpenter', (p) => {
        for (let i = 0; i < 4; i++) {
            noiseBurst(at(p, i * 0.15), { kind: 'pink', type: 'bandpass', freq: 520, q: 4, gain: 0.4, dur: 0.05 })
            blip(at(p, i * 0.15), 230, 150, 0.07, 0.15, 'triangle')
            metal(at(p, i * 0.15), { base: 2500, ratios: [1, 1.5], decay: 0.08, gain: 0.03, strike: 0 })
        }
        fmBell(at(hall(p, 0.3), 0.65), { freq: mtof(74), dur: 1.4, gain: 0.1, ratio: 3.01, index: 0.6 })
    }, 1)
    r(DF_SND.powerupSpawn, (p) => {
        for (const [i, m] of [74, 78, 81, 86].entries()) fmBell(at(p, i * 0.06), { freq: mtof(m), dur: 0.45, gain: 0.04, ratio: 2, index: 0.5, bite: 0.05 })
    }, 2)
    r(DF_SND.powerupEnd, (p) => {
        fmBell(p, { freq: mtof(74), dur: 0.3, gain: 0.05, ratio: 2, index: 0.5 })
        fmBell(at(p, 0.15), { freq: mtof(69), dur: 0.5, gain: 0.05, ratio: 2, index: 0.5 })
    }, 1)
}
