// Gridworks sound effects, synthesised with Web Audio so every action gets a
// crisp, slightly varied sound without loading files. Variation uses
// Math.random(): purely cosmetic.

type Wave = OscillatorType

const PENTA = [0, 2, 4, 7, 9]

export class GridSfx {
    private ctx: AudioContext | null = null
    private master: GainNode | null = null
    private noiseBuf: AudioBuffer | null = null
    private last = new Map<string, number>()
    private disposed = false
    muted = false
    volume = 0.7

    constructor() {
        if (typeof localStorage !== 'undefined') this.muted = localStorage.getItem('gridworks:muted') === '1'
    }

    setMuted(m: boolean) {
        this.muted = m
        localStorage.setItem('gridworks:muted', m ? '1' : '0')
    }

    /** Call from a user gesture; browsers keep audio suspended until then. */
    unlock() {
        if (this.disposed) return
        if (!this.ctx) {
            const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
            if (!Ctx) return
            this.ctx = new Ctx()
            const comp = this.ctx.createDynamicsCompressor()
            comp.threshold.value = -14
            comp.ratio.value = 6
            this.master = this.ctx.createGain()
            this.master.gain.value = this.volume
            this.master.connect(comp).connect(this.ctx.destination)
            const len = this.ctx.sampleRate * 0.5
            this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
            const data = this.noiseBuf.getChannelData(0)
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume()
    }

    /** Closes the audio device; every sound after this is a no-op. */
    dispose() {
        this.disposed = true
        const ctx = this.ctx
        this.ctx = null
        this.master = null
        this.noiseBuf = null
        if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {})
    }

    private ready(name: string, gapMs = 0): AudioContext | null {
        if (this.muted || !this.ctx || !this.master) return null
        const now = performance.now()
        if (gapMs && now - (this.last.get(name) ?? 0) < gapMs) return null
        this.last.set(name, now)
        return this.ctx
    }

    private tone(type: Wave, f0: number, f1: number, dur: number, gain: number, at = 0, attack = 0.004) {
        const ctx = this.ctx!
        const t = ctx.currentTime + at
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = type
        osc.frequency.setValueAtTime(f0, t)
        if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(gain, t + attack)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        osc.connect(g).connect(this.master!)
        osc.start(t)
        osc.stop(t + dur + 0.02)
    }

    private noise(dur: number, gain: number, filter: BiquadFilterType, freq: number, q = 1, at = 0, freqEnd?: number) {
        const ctx = this.ctx!
        const t = ctx.currentTime + at
        const src = ctx.createBufferSource()
        src.buffer = this.noiseBuf
        src.playbackRate.value = 0.9 + Math.random() * 0.2
        const f = ctx.createBiquadFilter()
        f.type = filter
        f.frequency.setValueAtTime(freq, t)
        if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur)
        f.Q.value = q
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(gain, t + 0.003)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        src.connect(f).connect(g).connect(this.master!)
        src.start(t, Math.random() * 0.3)
        src.stop(t + dur + 0.02)
    }

    private jitter(f: number, amount = 0.04) {
        return f * (1 + (Math.random() * 2 - 1) * amount)
    }

    /** A building lands: a woody thock, lower for bigger footprints. */
    place(tiles = 1) {
        if (!this.ready('place', 25)) return
        const p = 1 / Math.sqrt(tiles)
        this.tone('sine', this.jitter(210 * p), 62 * p, 0.16, 0.55)
        this.tone('triangle', this.jitter(520 * p), 300 * p, 0.07, 0.16)
        this.noise(0.035, 0.32, 'bandpass', 2600, 1.4)
        this.noise(0.09, 0.1, 'lowpass', 900, 0.7, 0.01)
    }

    /** One belt tile in a drag: a tick that climbs a pentatonic scale. */
    beltTick(i: number) {
        if (!this.ready('belt', 18)) return
        const step = PENTA[i % PENTA.length]! + 12 * Math.min(2, Math.floor(i / PENTA.length))
        const f = 440 * Math.pow(2, (step - 5) / 12)
        this.tone('triangle', f, f * 0.98, 0.06, 0.13)
        this.noise(0.018, 0.12, 'highpass', 3200)
    }

    /** Belts pop into place one after another. */
    beltLand(i: number) {
        if (!this.ready('beltLand', 14)) return
        const f = this.jitter(160 + Math.min(i, 24) * 9, 0.02)
        this.tone('sine', f, f * 0.55, 0.07, 0.22)
        this.noise(0.02, 0.14, 'bandpass', 2200, 1.2)
    }

    remove(tiles = 1) {
        if (!this.ready('remove', 20)) return
        const p = 1 / Math.sqrt(tiles)
        this.tone('sine', this.jitter(380 * p), 900 * p, 0.06, 0.28)
        this.noise(0.18, 0.18, 'bandpass', 2400, 0.8, 0.02, 400)
        this.tone('triangle', 240 * p, 120 * p, 0.12, 0.1, 0.03)
    }

    rotate() {
        if (!this.ready('rotate', 30)) return
        this.noise(0.012, 0.22, 'bandpass', 3800, 2)
        this.noise(0.012, 0.18, 'bandpass', 3000, 2, 0.045)
        this.tone('sine', this.jitter(700), 760, 0.05, 0.08, 0.02)
    }

    pickup() {
        if (!this.ready('pickup', 40)) return
        this.tone('sine', 280, 640, 0.11, 0.22)
        this.noise(0.06, 0.08, 'highpass', 2500)
    }

    drop(tiles = 1) {
        if (!this.ready('drop', 30)) return
        const p = 1 / Math.sqrt(tiles)
        this.tone('sine', this.jitter(170 * p), 58 * p, 0.14, 0.5)
        this.noise(0.04, 0.24, 'bandpass', 1800, 1.2)
    }

    invalid() {
        if (!this.ready('invalid', 120)) return
        this.tone('square', 130, 118, 0.07, 0.07)
        this.tone('square', 98, 90, 0.09, 0.07, 0.08)
    }

    mine() {
        if (!this.ready('mine', 30)) return
        const f = 1300 + Math.random() * 700
        this.tone('triangle', f, f * 0.92, 0.09, 0.16)
        this.tone('sine', f * 2.01, f * 1.9, 0.05, 0.05)
        this.noise(0.04, 0.18, 'highpass', 4200)
    }

    select() {
        if (!this.ready('select', 30)) return
        this.tone('sine', 660, 700, 0.05, 0.1)
        this.tone('sine', 990, 1000, 0.05, 0.05, 0.03)
    }

    hover() {
        if (!this.ready('hover', 45)) return
        this.noise(0.008, 0.035, 'bandpass', 5200, 3)
    }

    tool() {
        if (!this.ready('tool', 30)) return
        this.tone('triangle', 520, 560, 0.05, 0.1)
        this.noise(0.012, 0.06, 'highpass', 3600)
    }

    upgrade() {
        if (!this.ready('upgrade', 60)) return
        ;[0, 4, 7, 12].forEach((s, i) => this.tone('triangle', 440 * Math.pow(2, s / 12), 440 * Math.pow(2, s / 12), 0.12, 0.12, i * 0.045))
    }

    refund() {
        if (!this.ready('refund', 70)) return
        ;[1568, 2093, 2637].forEach((f, i) => this.tone('sine', f, f, 0.07, 0.05, 0.05 + i * 0.035))
    }

    chunk() {
        if (!this.ready('chunk', 200)) return
        ;[0, 4, 7, 11, 14].forEach((s, i) => this.tone('sine', 262 * Math.pow(2, s / 12), 262 * Math.pow(2, s / 12), 0.6, 0.09, i * 0.06, 0.03))
        this.noise(0.5, 0.05, 'lowpass', 600, 0.7, 0, 3000)
    }

    research() {
        if (!this.ready('research', 300)) return
        ;[0, 4, 7, 12, 16, 19].forEach((s, i) => {
            const f = 523 * Math.pow(2, s / 12)
            this.tone('triangle', f, f, 0.25, 0.1, i * 0.07)
            this.tone('sine', f * 2, f * 2, 0.15, 0.03, i * 0.07)
        })
    }

    /** Cog's voice: a soft blip per syllable, pitch picked by the caller's cosmetic jitter. */
    talk(jitter: number) {
        if (!this.ready('talk', 55)) return
        const f = 520 + jitter * 180
        this.tone('square', f, f * 1.08, 0.035, 0.025)
        this.tone('sine', f * 2, f * 2, 0.03, 0.02)
    }

    goal() {
        if (!this.ready('goal', 300)) return
        ;[0, 7, 12, 16].forEach((st, i) => {
            const f = 392 * Math.pow(2, st / 12)
            this.tone('triangle', f, f, 0.2, 0.11, i * 0.06)
        })
        ;[2093, 2637, 3136].forEach((f, i) => this.tone('sine', f, f, 0.08, 0.04, 0.24 + i * 0.04))
    }
}
