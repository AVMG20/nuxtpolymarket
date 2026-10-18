import {
    clamp, filterNode, gainNode, noise, oscNode, randomWalk, rnd, shaperNode
} from './noise'
import type { Rt } from './noise'
import { bubbles, scatter } from './parts'

// A small formant "throat": detuned saws (+ optional sub) with vibrato and
// jitter, mixed with breath noise, saturated for rasp, then shaped by moving
// vowel formants. Every zombie vocal is a VoiceSpec run through dfVoice.

export type Vowel = 'u' | 'o' | 'a' | 'e' | 'i' | 'uh' | 'aw'

const VOWELS: Record<Vowel, readonly [number, number, number]> = {
    u: [320, 800, 2240],
    o: [470, 850, 2500],
    aw: [600, 950, 2450],
    a: [740, 1150, 2450],
    uh: [540, 1200, 2400],
    e: [530, 1800, 2500],
    i: [300, 2200, 2950]
}

export interface VoiceSpec {
    dur: number
    /** Pitch contour as [fraction of dur, Hz]. */
    pitch: readonly (readonly [number, number])[]
    /** Vowel path as [fraction of dur, vowel]. */
    vowels: readonly (readonly [number, Vowel])[]
    /** Vocal tract size: < 1 bigger / darker, > 1 smaller / brighter. */
    tract: number
    vibRate: number
    /** Vibrato depth in cents. */
    vibDepth: number
    /** Random pitch wander in cents. */
    jitter: number
    /** Detune of the second saw in cents. */
    detune: number
    /** Sub-octave square level (growl). */
    sub?: number
    /** Breath noise level through the formants. */
    breath: number
    /** Extra un-voiced hiss (highpassed) level. */
    hiss?: number
    /** Saturation drive. */
    rasp: number
    attack: number
    release: number
    gain: number
    lowpass: number
    /** Irregular amplitude flutter (death rattles, burbles). */
    flutter?: { rate: number, depth: number }
    /** Wet bubble pops per second. */
    gurgle?: number
}

export function dfVoice(r: Rt, v: VoiceSpec): void {
    const { ctx, t } = r
    const dur = v.dur
    const end = t + dur
    const pitchMul = r.rate
    const tract = v.tract * Math.sqrt(r.rate)

    // Output chain: formant sum -> lowpass -> flutter -> envelope -> out.
    const env = gainNode(ctx, 0, r.out)
    const flutter = gainNode(ctx, 1, env)
    const lp = filterNode(ctx, 'lowpass', v.lowpass, 0.6, flutter)
    const formantSum = gainNode(ctx, 1, lp)

    // Source chain: oscillators + breath -> drive -> shaper -> formants.
    const drive = gainNode(ctx, 0.35 + v.rasp * 0.45)
    const shaper = shaperNode(ctx, v.rasp)
    drive.connect(shaper)

    const oscs: OscillatorNode[] = []
    const o1 = oscNode(ctx, 'sawtooth', 100, t, dur + 0.1, drive)
    const o2 = oscNode(ctx, 'sawtooth', 100, t, dur + 0.1, drive)
    o2.detune.setValueAtTime(v.detune, t)
    oscs.push(o1, o2)
    let subOsc: OscillatorNode | null = null
    if (v.sub && v.sub > 0) {
        const sg = gainNode(ctx, v.sub, drive)
        subOsc = oscNode(ctx, 'square', 50, t, dur + 0.1, sg)
    }
    for (const [i, [frac, hz]] of v.pitch.entries()) {
        const time = t + frac * dur
        const f = Math.max(20, hz * pitchMul)
        for (const o of oscs) {
            if (i === 0) o.frequency.setValueAtTime(f, time)
            else o.frequency.exponentialRampToValueAtTime(f, time)
        }
        if (subOsc) {
            if (i === 0) subOsc.frequency.setValueAtTime(f * 0.5, time)
            else subOsc.frequency.exponentialRampToValueAtTime(f * 0.5, time)
        }
    }

    // Vibrato (shared LFO) and per-oscillator jitter curves.
    const lfoG = gainNode(ctx, v.vibDepth)
    oscNode(ctx, 'sine', v.vibRate * rnd(0.85, 1.15), t, dur + 0.1, lfoG)
    for (const o of oscs) lfoG.connect(o.detune)
    if (subOsc) lfoG.connect(subOsc.detune)
    if (v.jitter > 0) {
        const n = Math.ceil(dur * 25)
        o1.detune.setValueCurveAtTime(scaleCurve(randomWalk(n, 1, 0.12), v.jitter), t, dur)
        o2.detune.cancelScheduledValues(t)
        const c2 = scaleCurve(randomWalk(n, 1, 0.12), v.jitter)
        for (let i = 0; i < c2.length; i++) c2[i] = (c2[i] ?? 0) + v.detune
        o2.detune.setValueCurveAtTime(c2, t, dur)
    }

    if (v.breath > 0) {
        const bg = gainNode(ctx, v.breath * 1.4, drive)
        noise(ctx, 'pink', t, dur + 0.1, bg)
    }

    // Formants (parallel bandpasses that glide along the vowel path).
    const fq = [7, 9, 11]
    const fg = [1.6, 1.1, 0.55]
    for (let k = 0; k < 3; k++) {
        const bp = filterNode(ctx, 'bandpass', 500, fq[k] ?? 8)
        const g = gainNode(ctx, (fg[k] ?? 1) * (1 + (fq[k] ?? 8) * 0.12), formantSum)
        shaper.connect(bp)
        bp.connect(g)
        for (const [i, [frac, vw]] of v.vowels.entries()) {
            const hz = clamp((VOWELS[vw][k] ?? 500) * tract, 80, 9000)
            if (i === 0) bp.frequency.setValueAtTime(hz, t + frac * dur)
            else bp.frequency.linearRampToValueAtTime(hz, t + frac * dur)
        }
    }
    // A little direct, unfiltered body under the formants keeps it from sounding thin.
    const direct = filterNode(ctx, 'lowpass', 350 * tract, 0.7)
    shaper.connect(direct)
    direct.connect(gainNode(ctx, 0.35, formantSum))

    if (v.hiss && v.hiss > 0) {
        const hg = gainNode(ctx, 0, env)
        const hp = filterNode(ctx, 'bandpass', 3200 * tract, 0.8, hg)
        noise(ctx, 'white', t, dur + 0.1, hp)
        hg.gain.setValueAtTime(0, t)
        hg.gain.linearRampToValueAtTime(v.hiss * 0.5, t + Math.min(0.08, dur * 0.2))
        hg.gain.linearRampToValueAtTime(v.hiss * 0.18, t + dur * 0.6)
        hg.gain.linearRampToValueAtTime(0, end)
    }

    if (v.flutter) {
        const n = Math.ceil(dur * v.flutter.rate * 6)
        const curve = new Float32Array(n)
        let ph = Math.random() * Math.PI * 2
        const step = (2 * Math.PI * v.flutter.rate * dur) / n
        for (let i = 0; i < n; i++) {
            ph += step * rnd(0.6, 1.4)
            const s = 0.5 + 0.5 * Math.sin(ph)
            curve[i] = 1 - v.flutter.depth * s * s
        }
        flutter.gain.setValueCurveAtTime(curve, t, dur)
    }

    if (v.gurgle && v.gurgle > 0) {
        const count = Math.max(2, Math.round(v.gurgle * dur))
        bubbles({ ...r, out: env }, scatter(count, dur * 0.95, 1), 160 * tract, 420 * tract, 0.6, 0.04)
    }

    // Amplitude envelope.
    const a = Math.max(0.01, v.attack)
    const rel = Math.min(Math.max(0.05, v.release), dur - a)
    const peak = v.gain * r.vol
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(peak, t + a)
    env.gain.linearRampToValueAtTime(peak * 0.8, end - rel)
    env.gain.exponentialRampToValueAtTime(Math.max(0.00001, peak * 0.001), end)
    env.gain.linearRampToValueAtTime(0, end + 0.02)
}

function scaleCurve(c: Float32Array<ArrayBuffer>, cents: number): Float32Array<ArrayBuffer> {
    let max = 0.0001
    for (const v of c) max = Math.max(max, Math.abs(v))
    for (let i = 0; i < c.length; i++) c[i] = (c[i] ?? 0) / max * cents
    return c
}
