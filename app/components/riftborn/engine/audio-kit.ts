/*
 * WebAudio building blocks shared by the RIFTBORN sound effects and the
 * procedural soundtrack: enveloped oscillators with pitch/filter sweeps,
 * filtered noise, FM bells, a distortion curve and a generated reverb.
 */

export interface FilterOpts {
    type: BiquadFilterType
    f: number
    /** Sweep the cutoff to this value over the note */
    f2?: number
    q?: number
}

export interface ToneOpts {
    out: AudioNode
    t: number
    dur: number
    f: number
    gain: number
    type?: OscillatorType
    /** Pitch sweep target */
    f2?: number
    /** Seconds of the pitch sweep, defaults to dur */
    sweep?: number
    attack?: number
    /** Seconds at full level before the decay */
    hold?: number
    /** Cents */
    detune?: number
    filter?: FilterOpts
    vibrato?: { rate: number, depth: number }
    drive?: boolean
}

export interface NoiseOpts {
    out: AudioNode
    t: number
    dur: number
    gain: number
    filter: FilterOpts
    attack?: number
    hold?: number
}

export function hz(midi: number): number {
    return 440 * 2 ** ((midi - 69) / 12)
}

export class Kit {
    readonly noiseBuf: AudioBuffer
    readonly curve: Float32Array<ArrayBuffer>

    constructor(readonly ctx: AudioContext) {
        const len = Math.floor(ctx.sampleRate * 2)
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
        const data = this.noiseBuf.getChannelData(0)
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
        this.curve = new Float32Array(1024)
        const k = 18
        for (let i = 0; i < 1024; i++) {
            const x = (i / 1023) * 2 - 1
            this.curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
        }
    }

    /** Attack-hold-exponential-decay envelope on a fresh gain node */
    env(t: number, dur: number, gain: number, attack = 0.004, hold = 0): GainNode {
        const g = this.ctx.createGain()
        const peak = Math.max(0.0002, gain)
        const a = Math.max(0.001, Math.min(attack, dur * 0.9))
        const h = Math.max(0, Math.min(hold, dur - a - 0.005))
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(peak, t + a)
        if (h > 0) g.gain.setValueAtTime(peak, t + a + h)
        g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + h + 0.01))
        return g
    }

    filter(o: FilterOpts, t: number, dur: number): BiquadFilterNode {
        const f = this.ctx.createBiquadFilter()
        f.type = o.type
        f.frequency.setValueAtTime(Math.max(10, o.f), t)
        if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.f2), t + dur)
        f.Q.value = o.q ?? 0.8
        return f
    }

    tone(o: ToneOpts): void {
        const ctx = this.ctx
        const osc = ctx.createOscillator()
        osc.type = o.type ?? 'sine'
        osc.frequency.setValueAtTime(Math.max(1, o.f), o.t)
        if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), o.t + (o.sweep ?? o.dur))
        if (o.detune) osc.detune.value = o.detune
        let lfo: OscillatorNode | null = null
        if (o.vibrato) {
            lfo = ctx.createOscillator()
            lfo.frequency.value = o.vibrato.rate
            const depth = ctx.createGain()
            depth.gain.value = o.vibrato.depth
            lfo.connect(depth)
            depth.connect(osc.detune)
            lfo.start(o.t)
            lfo.stop(o.t + o.dur + 0.05)
        }
        const g = this.env(o.t, o.dur, o.gain, o.attack, o.hold)
        let node: AudioNode = osc
        if (o.drive) {
            const ws = ctx.createWaveShaper()
            ws.curve = this.curve
            node.connect(ws)
            node = ws
        }
        if (o.filter) {
            const f = this.filter(o.filter, o.t, o.dur)
            node.connect(f)
            node = f
        }
        node.connect(g)
        g.connect(o.out)
        osc.start(o.t)
        osc.stop(o.t + o.dur + 0.05)
    }

    noise(o: NoiseOpts): void {
        const ctx = this.ctx
        const src = ctx.createBufferSource()
        src.buffer = this.noiseBuf
        src.loop = true
        const f = this.filter(o.filter, o.t, o.dur)
        const g = this.env(o.t, o.dur, o.gain, o.attack ?? 0.002, o.hold)
        src.connect(f)
        f.connect(g)
        g.connect(o.out)
        src.start(o.t, Math.random() * 1.5)
        src.stop(o.t + o.dur + 0.05)
    }

    /** Two-operator FM bell */
    bell(out: AudioNode, t: number, f: number, dur: number, gain: number, ratio = 3.5, index = 2): void {
        const ctx = this.ctx
        const car = ctx.createOscillator()
        const mod = ctx.createOscillator()
        const modGain = ctx.createGain()
        car.frequency.value = f
        mod.frequency.value = f * ratio
        modGain.gain.setValueAtTime(f * index, t)
        modGain.gain.exponentialRampToValueAtTime(Math.max(1, f * index * 0.05), t + dur)
        mod.connect(modGain)
        modGain.connect(car.frequency)
        const g = this.env(t, dur, gain, 0.002)
        car.connect(g)
        g.connect(out)
        car.start(t)
        mod.start(t)
        car.stop(t + dur + 0.05)
        mod.stop(t + dur + 0.05)
    }

    /** Stereo noise impulse for a convolver reverb */
    impulse(seconds: number, decay: number): AudioBuffer {
        const rate = this.ctx.sampleRate
        const len = Math.floor(rate * seconds)
        const buf = this.ctx.createBuffer(2, len, rate)
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch)
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay
        }
        return buf
    }
}
