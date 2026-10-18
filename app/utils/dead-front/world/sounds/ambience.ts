import {
    at, filterNode, gainNode, impulse, noiseBuffer, oscNode, rnd, rndPick, shaperNode
} from './noise'
import type { Rt } from './noise'
import { bell, creak, noiseBurst, noiseSwell, thud } from './parts'

// The night over the front: a gusting wind bed with a low ground rumble and,
// at random intervals, far artillery, crows, creaking timber, distant rifle
// and machine-gun fire, and very rarely a church bell from a ruined village.

/** One artillery shell landing far away (or a little closer). */
export function artilleryBoom(r: Rt, far: boolean): void {
    const k = rnd(0.85, 1.15)
    const lp = far ? rnd(110, 160) : rnd(220, 320)
    thud(r, { freq: 52 * k, freqEnd: 26 * k, dur: far ? 2.2 : 1.6, gain: far ? 0.32 : 0.42, body: 1.1, bodyFreq: lp, click: 0 })
    noiseSwell(r, { kind: 'brown', type: 'lowpass', freq: lp * 0.9, freqEnd: 55, q: 0.8, gain: far ? 0.3 : 0.38, dur: far ? 3.8 : 3, peakAt: far ? 0.07 : 0.04 })
    if (!far) noiseBurst(r, { kind: 'pink', type: 'lowpass', freq: 900, freqEnd: 250, q: 0.7, gain: 0.12, dur: 0.5 })
    // A softer echo off the hills.
    const echo = at(r, rnd(0.6, 1.3))
    noiseSwell(echo, { kind: 'brown', type: 'lowpass', freq: lp * 0.7, freqEnd: 50, q: 0.7, gain: far ? 0.12 : 0.16, dur: 2.5, peakAt: 0.1 })
}

function artilleryVolley(r: Rt): void {
    const n = rndPick([1, 1, 2, 2, 3, 4])
    const far = Math.random() < 0.7
    let dt = 0
    for (let i = 0; i < n; i++) {
        artilleryBoom(at({ ...r, vol: r.vol * 0.55 }, dt), far || Math.random() < 0.5)
        dt += rnd(0.5, 1.8)
    }
}

/** A single crow caw. */
function caw(r: Rt, f: number, len: number, gainV: number): void {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 2600, 0.7, g)
    const sum = gainNode(ctx, 1, lp)
    const shp = shaperNode(ctx, 2)
    for (const [ff, q, lvl] of [[1300, 3, 1], [2100, 4, 0.6], [700, 2, 0.5]] as const) {
        const bp = filterNode(ctx, 'bandpass', ff * rnd(0.95, 1.05), q, gainNode(ctx, lvl * 2, sum))
        shp.connect(bp)
    }
    const o = oscNode(ctx, 'sawtooth', f * 1.12, t, len + 0.05, gainNode(ctx, 0.8, shp))
    o.frequency.exponentialRampToValueAtTime(f, t + len * 0.3)
    o.frequency.exponentialRampToValueAtTime(f * 0.82, t + len)
    const vib = gainNode(ctx, 40, o.detune)
    oscNode(ctx, 'sine', rnd(25, 35), t, len + 0.05, vib)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gainV, t + 0.02)
    g.gain.setValueAtTime(gainV, t + len * 0.6)
    g.gain.linearRampToValueAtTime(0, t + len)
}

function crows(r: Rt): void {
    const birds = rndPick([1, 1, 2])
    let dt = 0
    for (let b = 0; b < birds; b++) {
        const f = rnd(480, 680)
        const n = rndPick([2, 3, 3, 4])
        const vol = rnd(0.025, 0.045) * r.vol
        for (let i = 0; i < n; i++) {
            caw(at(r, dt), f * rnd(0.97, 1.03), rnd(0.2, 0.3), vol * (1 - i * 0.1))
            dt += rnd(0.32, 0.5)
        }
        dt += rnd(0.6, 1.5)
    }
}

function timberCreak(r: Rt): void {
    const dur = rnd(0.8, 1.6)
    creak(r, { dur, from: rnd(18, 30), to: rnd(14, 45), res: [rnd(260, 340), rnd(650, 800), rnd(1200, 1500)], q: 8, gain: rnd(0.09, 0.14), attack: 0.2 })
    if (Math.random() < 0.4) creak(at(r, dur + rnd(0.2, 0.5)), { dur: dur * 0.6, from: 25, to: 18, res: [300, 720], q: 8, gain: 0.07, attack: 0.15 })
}

function rifleShot(r: Rt, gainV: number, lp: number): void {
    noiseBurst(r, { kind: 'pink', type: 'lowpass', freq: lp, freqEnd: lp * 0.3, q: 0.7, gain: gainV, dur: 0.22, attack: 0.002 })
    thud(r, { freq: 130, freqEnd: 60, dur: 0.18, gain: gainV * 0.6, body: 0.4, bodyFreq: 300, click: 0 })
    noiseSwell(at(r, rnd(0.25, 0.5)), { kind: 'pink', type: 'lowpass', freq: lp * 0.5, q: 0.7, gain: gainV * 0.25, dur: 0.6, peakAt: 0.1 })
}

function gunfire(r: Rt): void {
    if (Math.random() < 0.35) {
        // A machine gun far down the line.
        const n = Math.round(rnd(6, 15))
        const gap = rnd(0.095, 0.12)
        const g = rnd(0.03, 0.05)
        for (let i = 0; i < n; i++) rifleShot(at(r, i * gap + rnd(-0.005, 0.005)), g * rnd(0.8, 1), 1000)
        return
    }
    const n = Math.round(rnd(2, 6))
    let dt = 0
    for (let i = 0; i < n; i++) {
        rifleShot(at(r, dt), rnd(0.035, 0.07), rnd(900, 1400))
        dt += rnd(0.12, 0.9)
    }
}

function churchBell(r: Rt): void {
    const f = rnd(175, 205)
    const tolls = rndPick([1, 2, 3])
    for (let i = 0; i < tolls; i++) bell(at(r, i * rnd(2.6, 3.2)), { freq: f, dur: 6, gain: 0.12, bright: 0.35 })
}

/** The random ambience events, also usable as one-shots. */
export const DF_AMBIENCE_EVENTS = {
    artillery: artilleryVolley,
    crows,
    creak: timberCreak,
    gunfire,
    churchBell
} as const

/** One-shot used when the ambience name is played directly: a far artillery volley. */
export function ambienceSting(r: Rt): void {
    artilleryVolley(r)
}

/** The looping night ambience bed. Returns a stop function that silences and frees everything. */
export function dfAmbienceLoop(ctx: AudioContext, out: AudioNode): () => void {
    const now = ctx.currentTime
    const bus = gainNode(ctx, 0, out)
    bus.gain.setValueAtTime(0, now)
    bus.gain.linearRampToValueAtTime(1, now + 3)
    const sources: AudioScheduledSourceNode[] = []
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let stopped = false

    const loopNoise = (kind: 'white' | 'pink' | 'brown', dest: AudioNode): void => {
        const src = ctx.createBufferSource()
        src.buffer = noiseBuffer(ctx, kind)
        src.loop = true
        src.connect(dest)
        src.start(now, Math.random() * 3)
        sources.push(src)
    }
    const lfo = (freq: number, depth: number, target: AudioParam): void => {
        const g = gainNode(ctx, depth, target)
        sources.push(oscNode(ctx, 'sine', freq, now, 1e7, g))
    }

    // Wind body: pink noise through a wandering bandpass, gusting.
    const windGain = gainNode(ctx, 0.11, bus)
    const windBp = filterNode(ctx, 'bandpass', 420, 0.9, windGain)
    const windLp = filterNode(ctx, 'lowpass', 1800, 0.7, windBp)
    loopNoise('pink', windLp)
    lfo(rnd(0.045, 0.06), 160, windBp.frequency)
    lfo(rnd(0.11, 0.15), 80, windBp.frequency)
    lfo(rnd(0.028, 0.035), 0.045, windGain.gain)
    lfo(rnd(0.07, 0.09), 0.03, windGain.gain)
    lfo(rnd(0.17, 0.21), 0.015, windGain.gain)

    // Gusts: a brighter band that only opens when the slow LFOs line up.
    const gustGain = gainNode(ctx, 0.03, bus)
    const gustBp = filterNode(ctx, 'bandpass', 900, 1.2, gustGain)
    loopNoise('pink', gustBp)
    lfo(rnd(0.05, 0.07), 300, gustBp.frequency)
    lfo(rnd(0.021, 0.027), 0.022, gustGain.gain)
    lfo(rnd(0.061, 0.067), 0.01, gustGain.gain)

    // Thin whistle through the wire and the ruins.
    const whistleGain = gainNode(ctx, 0.008, bus)
    const whistleBp = filterNode(ctx, 'bandpass', 850, 14, whistleGain)
    loopNoise('white', whistleBp)
    lfo(rnd(0.035, 0.05), 220, whistleBp.frequency)
    lfo(rnd(0.08, 0.1), 0.007, whistleGain.gain)

    // Ground rumble.
    const rumbleGain = gainNode(ctx, 0.12, bus)
    const rumbleLp = filterNode(ctx, 'lowpass', 85, 0.7, rumbleGain)
    loopNoise('brown', rumbleLp)
    lfo(0.023, 0.04, rumbleGain.gain)

    // Event bus: dry + a long, dark open-air tail.
    const evBus = gainNode(ctx, 1, bus)
    const conv = ctx.createConvolver()
    conv.buffer = impulse(ctx, 3.5, 2.2, 0.75)
    evBus.connect(conv)
    conv.connect(gainNode(ctx, 0.55, bus))

    const rtAt = (): Rt => ({ ctx, out: evBus, t: ctx.currentTime + 0.05, vol: 1, rate: rnd(0.96, 1.04) })
    const every = (min: number, max: number, first: number, fn: (r: Rt) => void): void => {
        const arm = (delay: number): void => {
            const id = setTimeout(() => {
                timers.delete(id)
                if (stopped) return
                if (ctx.state === 'running') fn(rtAt())
                arm(rnd(min, max))
            }, delay * 1000)
            timers.add(id)
        }
        arm(first)
    }
    // Sparse on purpose: the night should feel wide and quiet between events.
    every(14, 34, rnd(4, 9), artilleryVolley)
    every(28, 60, rnd(12, 25), crows)
    every(16, 36, rnd(8, 16), timberCreak)
    every(24, 55, rnd(14, 26), gunfire)
    every(80, 170, rnd(45, 95), churchBell)

    return () => {
        if (stopped) return
        stopped = true
        for (const id of timers) clearTimeout(id)
        timers.clear()
        const t = ctx.currentTime
        bus.gain.cancelScheduledValues(t)
        bus.gain.setValueAtTime(bus.gain.value, t)
        bus.gain.linearRampToValueAtTime(0, t + 0.4)
        for (const s of sources) {
            try {
                s.stop(t + 0.45)
            } catch {
                // Already stopped.
            }
        }
        setTimeout(() => {
            bus.disconnect()
            evBus.disconnect()
            conv.disconnect()
        }, 600)
    }
}
