/**
 * Procedural sound for Gold Miner: every effect and the banjo loop are
 * synthesised with WebAudio at runtime, so the game ships no audio files.
 */

class GoldMinerSfx {
    private ctx: AudioContext | null = null
    private master!: GainNode
    private sfxBus!: GainNode
    private musicBus!: GainNode
    private noise!: AudioBuffer
    private musicTimer: number | null = null
    private musicStep = 0
    private musicNext = 0
    sfxOn = true
    musicOn = true

    /** Must be called from a user gesture. */
    unlock() {
        if (!this.ctx) {
            const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
            this.ctx = new Ctor()
            const comp = this.ctx.createDynamicsCompressor()
            comp.threshold.value = -12
            comp.ratio.value = 4
            comp.connect(this.ctx.destination)
            this.master = this.ctx.createGain()
            this.master.gain.value = 0.8
            this.master.connect(comp)
            this.sfxBus = this.ctx.createGain()
            this.sfxBus.connect(this.master)
            this.musicBus = this.ctx.createGain()
            this.musicBus.gain.value = 0.22
            this.musicBus.connect(this.master)
            const len = this.ctx.sampleRate * 2
            this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
            const d = this.noise.getChannelData(0)
            // Cosmetic noise for synthesis only.
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
            this.startMusic()
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume()
        this.apply()
    }

    setSfx(on: boolean) {
        this.sfxOn = on
        this.apply()
    }

    setMusic(on: boolean) {
        this.musicOn = on
        this.apply()
    }

    private apply() {
        if (!this.ctx) return
        const t = this.ctx.currentTime
        this.sfxBus.gain.setTargetAtTime(this.sfxOn ? 1 : 0, t, 0.05)
        this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.22 : 0, t, 0.2)
    }

    dispose() {
        if (this.musicTimer !== null) window.clearInterval(this.musicTimer)
        this.musicTimer = null
        void this.ctx?.close()
        this.ctx = null
    }

    // ─── primitives ─────────────────────────────────────────────────────────

    private get ready() {
        return !!this.ctx && this.sfxOn
    }

    private tone(freq: number, dur: number, opts: { type?: OscillatorType, gain?: number, slide?: number, delay?: number, attack?: number, bus?: GainNode } = {}) {
        const ctx = this.ctx!
        const t = ctx.currentTime + (opts.delay ?? 0)
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = opts.type ?? 'sine'
        o.frequency.setValueAtTime(freq, t)
        if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t + dur)
        const peak = opts.gain ?? 0.2
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.005))
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        o.connect(g).connect(opts.bus ?? this.sfxBus)
        o.start(t)
        o.stop(t + dur + 0.05)
    }

    private hiss(dur: number, opts: { freq?: number, q?: number, gain?: number, type?: BiquadFilterType, slide?: number, delay?: number, attack?: number } = {}) {
        const ctx = this.ctx!
        const t = ctx.currentTime + (opts.delay ?? 0)
        const src = ctx.createBufferSource()
        src.buffer = this.noise
        src.playbackRate.value = 0.7 + Math.random() * 0.6
        const f = ctx.createBiquadFilter()
        f.type = opts.type ?? 'bandpass'
        f.frequency.setValueAtTime(opts.freq ?? 1200, t)
        if (opts.slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, (opts.freq ?? 1200) * opts.slide), t + dur)
        f.Q.value = opts.q ?? 1
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t + (opts.attack ?? 0.004))
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        src.connect(f).connect(g).connect(this.sfxBus)
        src.start(t, Math.random() * 1.5)
        src.stop(t + dur + 0.05)
    }

    // ─── effects ────────────────────────────────────────────────────────────

    /** Claw fired: a rope zip. */
    launch() {
        if (!this.ready) return
        this.hiss(0.35, { freq: 2400, slide: 0.35, q: 2, gain: 0.18 })
        this.tone(520, 0.12, { type: 'triangle', slide: 0.6, gain: 0.08 })
    }

    /** One ratchet click of the winch. Pitch follows the load. */
    click(heavy: number) {
        if (!this.ready) return
        this.hiss(0.03, { freq: 3200 - heavy * 1800, q: 6, gain: 0.07 })
        this.tone(900 - heavy * 500, 0.03, { type: 'square', gain: 0.018 })
    }

    /** Claw bit into something; the timbre says what. */
    hook(kind: string) {
        if (!this.ready) return
        if (kind.startsWith('gold')) {
            this.tone(180, 0.18, { type: 'triangle', gain: 0.3, slide: 0.7 })
            this.tone(1250, 0.25, { type: 'sine', gain: 0.08 })
        } else if (kind.startsWith('rock')) {
            this.hiss(0.18, { freq: 300, q: 0.8, gain: 0.45, type: 'lowpass' })
            this.tone(95, 0.2, { type: 'sine', gain: 0.35, slide: 0.6 })
        } else if (kind === 'diamond' || kind === 'moleDiamond') {
            this.tone(2093, 0.35, { gain: 0.1 })
            this.tone(3136, 0.3, { gain: 0.06, delay: 0.03 })
        } else if (kind === 'bag') {
            this.hiss(0.2, { freq: 900, q: 0.6, gain: 0.25 })
        } else if (kind.startsWith('mole')) {
            this.tone(900, 0.18, { type: 'square', gain: 0.05, slide: 1.8 })
        } else {
            this.tone(700, 0.08, { type: 'triangle', gain: 0.12 })
        }
        this.hiss(0.06, { freq: 5000, q: 3, gain: 0.1 })
    }

    /** Came back empty. */
    miss() {
        if (!this.ready) return
        this.tone(420, 0.1, { type: 'triangle', gain: 0.06 })
    }

    /** Load landed at the winch: cha-ching scaled to the value. */
    collect(value: number, kind: string) {
        if (!this.ready) return
        if (kind === 'diamond' || kind === 'moleDiamond') {
            ;[1568, 2093, 2637, 3136, 4186].forEach((f, i) => this.tone(f, 0.5, { gain: 0.09, delay: i * 0.05 }))
            return
        }
        if (value < 30) {
            this.tone(220, 0.15, { type: 'triangle', gain: 0.12, slide: 0.8 })
            return
        }
        // Register bell + coins.
        this.tone(1319, 0.35, { type: 'triangle', gain: 0.14 })
        this.tone(1976, 0.5, { type: 'sine', gain: 0.12, delay: 0.06 })
        const coins = Math.min(8, 2 + Math.floor(value / 100))
        for (let i = 0; i < coins; i++) this.tone(2600 + Math.random() * 1400, 0.08, { type: 'sine', gain: 0.04, delay: 0.1 + i * 0.035 })
    }

    bagReveal(good: boolean) {
        if (!this.ready) return
        const notes = good ? [784, 988, 1175, 1568] : [659, 784]
        notes.forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', gain: 0.1, delay: i * 0.07 }))
    }

    powerUp() {
        if (!this.ready) return
        ;[392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { type: 'square', gain: 0.05, delay: i * 0.05 }))
    }

    fuse() {
        if (!this.ready) return
        this.hiss(0.35, { freq: 6000, q: 1.5, gain: 0.12, type: 'highpass' })
    }

    explosion(big = 1) {
        if (!this.ready) return
        this.hiss(1.4 * big, { freq: 900, slide: 0.08, q: 0.6, gain: 0.9, type: 'lowpass' })
        this.tone(70, 0.9 * big, { type: 'sine', gain: 0.7, slide: 0.35 })
        this.tone(140, 0.3, { type: 'sawtooth', gain: 0.12, slide: 0.3 })
        this.hiss(0.5, { freq: 3500, q: 0.8, gain: 0.25, delay: 0.05 })
    }

    tick(urgent: boolean) {
        if (!this.ready) return
        this.tone(urgent ? 1760 : 1320, 0.06, { type: 'square', gain: urgent ? 0.06 : 0.035 })
    }

    timeUp() {
        if (!this.ready) return
        this.tone(880, 0.25, { type: 'square', gain: 0.08 })
        this.tone(660, 0.45, { type: 'square', gain: 0.08, delay: 0.25 })
    }

    goalReached() {
        if (!this.ready) return
        ;[523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', gain: 0.1, delay: i * 0.06 }))
    }

    fanfare() {
        if (!this.ready) return
        const seq: [number, number, number][] = [[523, 0, 0.15], [659, 0.15, 0.15], [784, 0.3, 0.15], [1047, 0.45, 0.5], [988, 0.8, 0.12], [1047, 0.95, 0.7]]
        for (const [f, d, l] of seq) {
            this.tone(f, l, { type: 'square', gain: 0.07, delay: d })
            this.tone(f / 2, l, { type: 'triangle', gain: 0.1, delay: d })
        }
    }

    fail() {
        if (!this.ready) return
        ;[392, 370, 349, 262].forEach((f, i) => this.tone(f, i === 3 ? 0.9 : 0.3, { type: 'triangle', gain: 0.14, delay: i * 0.3, slide: i === 3 ? 0.9 : 1 }))
    }

    bell() {
        if (!this.ready) return
        this.tone(1760, 0.8, { gain: 0.1 })
        this.tone(2637, 0.6, { gain: 0.05, delay: 0.01 })
    }

    buy() {
        if (!this.ready) return
        this.tone(988, 0.1, { type: 'square', gain: 0.05 })
        this.tone(1319, 0.3, { type: 'square', gain: 0.05, delay: 0.08 })
    }

    coinShower() {
        if (!this.ready) return
        for (let i = 0; i < 24; i++) this.tone(2200 + Math.random() * 2400, 0.1, { type: 'sine', gain: 0.05, delay: i * 0.045 })
        this.fanfare()
    }

    /** One syllable of the miner's gibberish voice: a formant-filtered buzz at a wandering pitch. */
    voice(mood = 1) {
        if (!this.ready) return
        const ctx = this.ctx!
        const t = ctx.currentTime
        const o = ctx.createOscillator()
        const f = ctx.createBiquadFilter()
        const g = ctx.createGain()
        o.type = 'sawtooth'
        // Cosmetic pitch wobble.
        const base = (150 + Math.random() * 70) * mood
        o.frequency.setValueAtTime(base, t)
        o.frequency.exponentialRampToValueAtTime(base * (0.85 + Math.random() * 0.4), t + 0.09)
        f.type = 'bandpass'
        f.frequency.value = 700 + Math.random() * 900
        f.Q.value = 3
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.012)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
        o.connect(f).connect(g).connect(this.sfxBus)
        o.start(t)
        o.stop(t + 0.12)
    }

    button() {
        if (!this.ready) return
        this.tone(660, 0.05, { type: 'triangle', gain: 0.06 })
    }

    // ─── music: a lazy banjo-and-bass shuffle ──────────────────────────────

    private pluck(freq: number, t: number, gain: number) {
        const ctx = this.ctx!
        // Two detuned triangles with a fast pluck envelope and a touch of noise on the attack.
        for (const det of [1, 1.004]) {
            const o = ctx.createOscillator()
            const g = ctx.createGain()
            const f = ctx.createBiquadFilter()
            o.type = 'sawtooth'
            o.frequency.value = freq * det
            f.type = 'lowpass'
            f.frequency.setValueAtTime(freq * 8, t)
            f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.25)
            g.gain.setValueAtTime(0.0001, t)
            g.gain.exponentialRampToValueAtTime(gain, t + 0.004)
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
            o.connect(f).connect(g).connect(this.musicBus)
            o.start(t)
            o.stop(t + 0.4)
        }
    }

    private bass(freq: number, t: number) {
        const ctx = this.ctx!
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = 'triangle'
        o.frequency.value = freq
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
        o.connect(g).connect(this.musicBus)
        o.start(t)
        o.stop(t + 0.35)
    }

    private startMusic() {
        const ctx = this.ctx!
        const bpm = 132
        const step = 60 / bpm / 2
        // G – C – D – G roll, eight eighths per bar.
        const chords = [
            { root: 98, notes: [392, 494, 587, 784] },
            { root: 131, notes: [523, 659, 784, 1047] },
            { root: 147, notes: [587, 740, 880, 1175] },
            { root: 98, notes: [392, 494, 587, 784] }
        ]
        const roll = [0, 1, 2, 3, 2, 1, 3, 2]
        this.musicNext = ctx.currentTime + 0.1
        this.musicTimer = window.setInterval(() => {
            if (!this.ctx) return
            while (this.musicNext < this.ctx.currentTime + 0.25) {
                const bar = Math.floor(this.musicStep / 8) % chords.length
                const i = this.musicStep % 8
                const chord = chords[bar]!
                const swing = i % 2 ? step * 0.18 : 0
                this.pluck(chord.notes[roll[i]!]!, this.musicNext + swing, 0.05)
                if (i % 4 === 0) this.bass(chord.root, this.musicNext)
                if (i % 4 === 2) this.bass(chord.root * 1.5, this.musicNext)
                this.musicStep++
                this.musicNext += step
            }
        }, 60)
    }
}

export const gmSfx = new GoldMinerSfx()
