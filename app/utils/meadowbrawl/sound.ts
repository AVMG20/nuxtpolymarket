// Procedural WebAudio sound for Meadowbrawl. Everything is synthesised so the
// game ships without audio assets; each call is short and throttled so a
// crowded wave never turns into noise.
import type { GameEvent } from './types'

export class MeadowbrawlSound {
    private ctx: AudioContext | null = null
    private master: GainNode | null = null
    private noise: AudioBuffer | null = null
    private last: Record<string, number> = {}
    muted = false

    private ensure(): AudioContext | null {
        if (typeof window === 'undefined') return null
        if (!this.ctx) {
            const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            if (!Ctor) return null
            this.ctx = new Ctor()
            this.master = this.ctx.createGain()
            this.master.gain.value = 0.5
            this.master.connect(this.ctx.destination)
            const len = this.ctx.sampleRate * 1.5
            this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
            const data = this.noise.getChannelData(0)
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume()
        return this.ctx
    }

    /** Call from a user gesture so the context is allowed to start. */
    unlock() {
        this.ensure()
    }

    setMuted(m: boolean) {
        this.muted = m
        if (this.master) this.master.gain.value = m ? 0 : 0.5
    }

    dispose() {
        void this.ctx?.close()
        this.ctx = null
    }

    private throttle(key: string, ms: number): boolean {
        const now = performance.now()
        if ((this.last[key] ?? 0) + ms > now) return false
        this.last[key] = now
        return true
    }

    private tone(freq: number, dur: number, opts: { type?: OscillatorType, gain?: number, to?: number, attack?: number, delay?: number } = {}) {
        const ctx = this.ensure()
        if (!ctx || !this.master) return
        const t0 = ctx.currentTime + (opts.delay ?? 0)
        const osc = ctx.createOscillator()
        osc.type = opts.type ?? 'sine'
        osc.frequency.setValueAtTime(freq, t0)
        if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + dur)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t0 + (opts.attack ?? 0.005))
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        osc.connect(g)
        g.connect(this.master)
        osc.start(t0)
        osc.stop(t0 + dur + 0.02)
    }

    private hiss(dur: number, opts: { gain?: number, from?: number, to?: number, q?: number, type?: BiquadFilterType, delay?: number } = {}) {
        const ctx = this.ensure()
        if (!ctx || !this.master || !this.noise) return
        const t0 = ctx.currentTime + (opts.delay ?? 0)
        const src = ctx.createBufferSource()
        src.buffer = this.noise
        src.playbackRate.value = 0.8 + Math.random() * 0.4
        const f = ctx.createBiquadFilter()
        f.type = opts.type ?? 'bandpass'
        f.Q.value = opts.q ?? 1
        f.frequency.setValueAtTime(opts.from ?? 1200, t0)
        f.frequency.exponentialRampToValueAtTime(opts.to ?? 400, t0 + dur)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t0 + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        src.connect(f)
        f.connect(g)
        g.connect(this.master)
        src.start(t0, Math.random() * 0.8)
        src.stop(t0 + dur + 0.02)
    }

    play(ev: GameEvent) {
        if (this.muted) return
        const power = ev.power ?? 0.5
        switch (ev.type) {
            case 'swing':
                if (!this.throttle('swing', 40)) return
                this.hiss(0.16 + power * 0.1, { gain: 0.12 + power * 0.1, from: 2400, to: 500, q: 0.8 })
                break
            case 'hit':
                if (!this.throttle('hit', 30)) return
                this.tone(160 + Math.random() * 60, 0.09, { type: 'triangle', gain: 0.22, to: 60 })
                this.hiss(0.08, { gain: 0.16, from: 3000, to: 900 })
                break
            case 'heavyHit':
                if (!this.throttle('heavy', 40)) return
                this.tone(110, 0.2, { type: 'square', gain: 0.22, to: 40 })
                this.tone(70, 0.28, { type: 'sine', gain: 0.3, to: 30 })
                this.hiss(0.16, { gain: 0.2, from: 2000, to: 300 })
                break
            case 'kill':
                if (!this.throttle('kill', 50)) return
                this.hiss(0.22, { gain: 0.22, from: 1500, to: 200, q: 0.7 })
                this.tone(200, 0.25, { type: 'sawtooth', gain: 0.12, to: 50 })
                if (power > 0.8) this.tone(55, 0.9, { type: 'sine', gain: 0.35, to: 25 })
                break
            case 'block':
                if (!this.throttle('block', 60)) return
                this.tone(1800 + Math.random() * 400, 0.1, { type: 'square', gain: 0.08, to: 1200 })
                this.tone(900, 0.06, { type: 'triangle', gain: 0.1 })
                break
            case 'shieldBreak':
                this.tone(1400, 0.3, { type: 'square', gain: 0.14, to: 200 })
                this.hiss(0.35, { gain: 0.25, from: 4000, to: 600 })
                break
            case 'hurt':
                this.tone(90, 0.3, { type: 'sine', gain: 0.4, to: 35 })
                this.hiss(0.2, { gain: 0.2, from: 800, to: 200, type: 'lowpass' })
                break
            case 'dodge':
                this.hiss(0.22, { gain: 0.12, from: 600, to: 2200, q: 0.6 })
                break
            case 'sprint':
                this.hiss(0.3, { gain: 0.06, from: 300, to: 900, q: 0.5 })
                break
            case 'special':
                this.hiss(0.3, { gain: 0.16, from: 400, to: 3000, q: 0.9 })
                this.tone(220, 0.35, { type: 'sawtooth', gain: 0.1, to: 660 })
                if (power > 0.8) this.tone(50, 0.6, { type: 'sine', gain: 0.4, to: 25 })
                break
            case 'explode':
                if (!this.throttle('explode', 60)) return
                this.tone(80, 0.5, { type: 'sine', gain: 0.4, to: 20 })
                this.hiss(0.4, { gain: 0.3, from: 1200, to: 150, type: 'lowpass' })
                break
            case 'lightning':
                if (!this.throttle('lightning', 80)) return
                this.hiss(0.14, { gain: 0.14, from: 6000, to: 2500, q: 2 })
                this.tone(2200, 0.08, { type: 'square', gain: 0.05, to: 400 })
                break
            case 'freeze':
                this.tone(1500, 0.3, { type: 'sine', gain: 0.08, to: 2600 })
                break
            case 'burn':
                if (!this.throttle('burn', 300)) return
                this.hiss(0.25, { gain: 0.07, from: 900, to: 400, q: 0.5 })
                break
            case 'telegraph':
                if (!this.throttle('telegraph', 90)) return
                if (power > 0.8) this.tone(60, 0.5, { type: 'sawtooth', gain: 0.12, to: 40 })
                else this.tone(320, 0.05, { type: 'triangle', gain: 0.04, to: 260 })
                break
            case 'waveStart':
                this.tone(110, 0.5, { type: 'sawtooth', gain: 0.12, to: 100 })
                this.tone(165, 0.5, { type: 'sawtooth', gain: 0.1, to: 150, delay: 0.15 })
                this.tone(60, 0.35, { type: 'sine', gain: 0.3, to: 30 })
                break
            case 'eliteSpawn':
                this.tone(82, 1.2, { type: 'sawtooth', gain: 0.16, to: 78 })
                this.tone(123, 1.2, { type: 'sawtooth', gain: 0.12, to: 117, delay: 0.1 })
                this.tone(45, 0.8, { type: 'sine', gain: 0.4, to: 25 })
                break
            case 'waveClear':
                for (const [i, f] of [523, 659, 784].entries()) this.tone(f, 0.5, { type: 'triangle', gain: 0.12, delay: i * 0.08 })
                break
            case 'upgrade':
                for (const [i, f] of [659, 880, 1318].entries()) this.tone(f, 0.4, { type: 'sine', gain: 0.12, delay: i * 0.07 })
                break
            case 'death':
                this.tone(120, 1.6, { type: 'sawtooth', gain: 0.2, to: 30 })
                this.hiss(0.9, { gain: 0.25, from: 600, to: 80, type: 'lowpass' })
                break
            case 'victory':
                for (const [i, f] of [523, 659, 784, 1046, 1318].entries()) this.tone(f, 0.7, { type: 'triangle', gain: 0.14, delay: i * 0.12 })
                break
        }
    }
}
