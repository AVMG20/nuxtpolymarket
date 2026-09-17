// Procedural WebAudio for Meadowbrawl. Everything is synthesised: hits and
// swings with per-weapon character, twelve class abilities, a meadow
// ambience (wind, birds, the waterfall by distance) and a heartbeat that
// quickens as the waves climb. Short, throttled, and all routed through a
// compressor so a crowded wave stays punchy instead of turning to mush.
import type { GameEvent } from './types'

export class MeadowbrawlSound {
    private ctx: AudioContext | null = null
    private master: GainNode | null = null
    private fxBus: GainNode | null = null
    private ambBus: GainNode | null = null
    private musicBus: GainNode | null = null
    private echo: DelayNode | null = null
    private noise: AudioBuffer | null = null
    private last: Record<string, number> = {}
    private wind: GainNode | null = null
    private falls: GainNode | null = null
    private pulseTimer = 0
    private birdTimer = 2
    private intensity = 0
    private daylight = 1
    muted = false

    private ensure(): AudioContext | null {
        if (typeof window === 'undefined') return null
        if (!this.ctx) {
            const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            if (!Ctor) return null
            const ctx = new Ctor()
            this.ctx = ctx
            const comp = ctx.createDynamicsCompressor()
            comp.threshold.value = -18
            comp.ratio.value = 6
            comp.attack.value = 0.004
            comp.release.value = 0.16
            this.master = ctx.createGain()
            this.master.gain.value = this.muted ? 0 : 0.55
            comp.connect(this.master)
            this.master.connect(ctx.destination)
            this.fxBus = ctx.createGain()
            this.fxBus.connect(comp)
            this.ambBus = ctx.createGain()
            this.ambBus.gain.value = 0.5
            this.ambBus.connect(comp)
            this.musicBus = ctx.createGain()
            this.musicBus.gain.value = 0.35
            this.musicBus.connect(comp)
            // A short slap echo gives hits a little room.
            this.echo = ctx.createDelay(0.5)
            this.echo.delayTime.value = 0.11
            const fb = ctx.createGain()
            fb.gain.value = 0.22
            const wet = ctx.createGain()
            wet.gain.value = 0.18
            this.fxBus.connect(this.echo)
            this.echo.connect(fb)
            fb.connect(this.echo)
            this.echo.connect(wet)
            wet.connect(comp)
            const len = ctx.sampleRate * 2
            this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
            const data = this.noise.getChannelData(0)
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
            this.startAmbience()
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume()
        return this.ctx
    }

    unlock() {
        this.ensure()
    }

    setMuted(m: boolean) {
        this.muted = m
        if (this.master) this.master.gain.value = m ? 0 : 0.55
    }

    dispose() {
        void this.ctx?.close()
        this.ctx = null
    }

    // ------------------------------------------------------------ ambience

    private loopNoise(gain: number, type: BiquadFilterType, freq: number, q: number, bus: AudioNode): GainNode {
        const ctx = this.ctx!
        const src = ctx.createBufferSource()
        src.buffer = this.noise
        src.loop = true
        const f = ctx.createBiquadFilter()
        f.type = type
        f.frequency.value = freq
        f.Q.value = q
        const g = ctx.createGain()
        g.gain.value = gain
        src.connect(f)
        f.connect(g)
        g.connect(bus)
        src.start()
        return g
    }

    private startAmbience() {
        const ctx = this.ctx!
        this.wind = this.loopNoise(0.05, 'lowpass', 380, 0.6, this.ambBus!)
        // Slow wind swell.
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 0.09
        const lfoGain = ctx.createGain()
        lfoGain.gain.value = 0.03
        lfo.connect(lfoGain)
        lfoGain.connect(this.wind.gain)
        lfo.start()
        this.falls = this.loopNoise(0.0, 'bandpass', 900, 0.5, this.ambBus!)
    }

    /**
     * Called every frame with the player's distance to the waterfall and
     * the run's wave so the ambience follows the action.
     */
    setScene(fallsDistance: number, wave: number, inCombat: boolean, dt: number) {
        if (!this.ctx || this.muted) return
        const target = inCombat ? Math.min(1, Math.max(0, (wave - 3) / 20)) : 0
        this.intensity += (target - this.intensity) * Math.min(1, dt * 0.8)
        this.daylight = 1 - Math.min(1, Math.max(0, (wave - 8) / 22))
        if (this.falls) this.falls.gain.value = 0.12 * Math.max(0, 1 - fallsDistance / 520)
        // A heartbeat kick that quickens with the run.
        if (this.intensity > 0.08) {
            this.pulseTimer -= dt
            if (this.pulseTimer <= 0) {
                this.pulseTimer = 1.1 - this.intensity * 0.5
                this.tone(52, 0.22, { type: 'sine', gain: 0.25 * this.intensity, to: 30, bus: this.musicBus! })
            }
        }
        // Birds in the daylight, crickets after.
        this.birdTimer -= dt
        if (this.birdTimer <= 0) {
            this.birdTimer = 2 + Math.random() * 5
            if (this.daylight > 0.4) this.bird()
            else this.cricket()
        }
    }

    private bird() {
        const base = 2200 + Math.random() * 1400
        const n = 2 + Math.floor(Math.random() * 3)
        for (let i = 0; i < n; i++) {
            this.tone(base, 0.09, { type: 'sine', gain: 0.03 * this.daylight, to: base * (1.2 + Math.random() * 0.3), delay: i * 0.13, bus: this.ambBus! })
        }
    }

    private cricket() {
        for (let i = 0; i < 6; i++) this.tone(4200, 0.03, { type: 'square', gain: 0.012, delay: i * 0.07, bus: this.ambBus! })
    }

    // ------------------------------------------------------------ helpers

    private throttle(key: string, ms: number): boolean {
        const now = performance.now()
        if ((this.last[key] ?? 0) + ms > now) return false
        this.last[key] = now
        return true
    }

    private tone(freq: number, dur: number, opts: { type?: OscillatorType, gain?: number, to?: number, attack?: number, delay?: number, bus?: AudioNode } = {}) {
        const ctx = this.ensure()
        if (!ctx || !this.fxBus) return
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
        g.connect(opts.bus ?? this.fxBus)
        osc.start(t0)
        osc.stop(t0 + dur + 0.02)
    }

    private hiss(dur: number, opts: { gain?: number, from?: number, to?: number, q?: number, type?: BiquadFilterType, delay?: number, attack?: number } = {}) {
        const ctx = this.ensure()
        if (!ctx || !this.fxBus || !this.noise) return
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
        g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t0 + (opts.attack ?? 0.01))
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        src.connect(f)
        f.connect(g)
        g.connect(this.fxBus)
        src.start(t0, Math.random() * 1.5)
        src.stop(t0 + dur + 0.02)
    }

    private chord(freqs: number[], dur: number, type: OscillatorType, gain: number, spread = 0.08) {
        for (const [i, f] of freqs.entries()) this.tone(f, dur, { type, gain, delay: i * spread })
    }

    // -------------------------------------------------------------- events

    play(ev: GameEvent) {
        if (this.muted) return
        const power = ev.power ?? 0.5
        switch (ev.type) {
            case 'swing':
                if (!this.throttle('swing', 40)) return
                switch (ev.variant) {
                    case 'greataxe':
                    case 'warhammer':
                        this.hiss(0.32, { gain: 0.2, from: 900, to: 180, q: 0.7 })
                        this.tone(70, 0.25, { type: 'sine', gain: 0.1, to: 40 })
                        break
                    case 'daggers':
                        this.hiss(0.08, { gain: 0.09, from: 4200, to: 1600, q: 1.2 })
                        break
                    case 'spear':
                        this.hiss(0.14, { gain: 0.12, from: 2600, to: 900, q: 2 })
                        break
                    case 'scythe':
                        this.hiss(0.3, { gain: 0.14, from: 1400, to: 300, q: 0.5 })
                        this.tone(220, 0.3, { type: 'sine', gain: 0.05, to: 110 })
                        break
                    default:
                        this.hiss(0.16 + power * 0.1, { gain: 0.12 + power * 0.1, from: 2400, to: 500, q: 0.8 })
                }
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
                if (ev.variant === 'ranged') this.hiss(0.4, { gain: 0.1, from: 600, to: 2400, q: 0.5 })
                if (ev.variant === 'swarmer') this.tone(900, 0.12, { type: 'triangle', gain: 0.06, to: 300 })
                if (ev.variant === 'briar') this.hiss(0.5, { gain: 0.16, from: 2400, to: 300, q: 0.6 })
                if (ev.variant === 'knight') this.tone(1300, 0.2, { type: 'square', gain: 0.08, to: 260 })
                break
            case 'eliteKill':
                this.tone(55, 1.4, { type: 'sine', gain: 0.4, to: 25 })
                this.hiss(1.0, { gain: 0.3, from: 2000, to: 120, type: 'lowpass' })
                this.chord([196, 233, 294, 392], 1.2, 'triangle', 0.1, 0.12)
                if (ev.variant === 'briar') this.hiss(0.9, { gain: 0.18, from: 3000, to: 400, q: 0.6, delay: 0.1 })
                if (ev.variant === 'knight') for (let i = 0; i < 5; i++) this.tone(700 + i * 210, 0.18, { type: 'square', gain: 0.06, to: 160, delay: 0.12 + i * 0.09 })
                break
            case 'stun': {
                // A shell cracking, then the weight of it hitting the ground.
                if (!this.throttle('stun', 60)) return
                const big = power > 0.8
                this.tone(1500, 0.07, { type: 'square', gain: 0.13, to: 300 })
                this.hiss(0.3, { gain: 0.26, from: 3600, to: 260, q: 0.8 })
                this.tone(56, big ? 0.7 : 0.4, { type: 'sine', gain: 0.45, to: 22 })
                this.tone(140, 0.24, { type: 'triangle', gain: 0.2, to: 44, delay: 0.03 })
                if (big) this.chord([98, 117, 147], 0.8, 'sawtooth', 0.07, 0.05)
                break
            }
            case 'block':
                if (!this.throttle('block', 60)) return
                this.tone(1800 + Math.random() * 400, 0.1, { type: 'square', gain: 0.08, to: 1200 })
                this.tone(900, 0.06, { type: 'triangle', gain: 0.1 })
                break
            case 'shieldBlock':
                if (!this.throttle('shieldBlock', 80)) return
                this.tone(1200, 0.16, { type: 'square', gain: 0.12, to: 700 })
                this.tone(300, 0.2, { type: 'triangle', gain: 0.14, to: 120 })
                this.hiss(0.1, { gain: 0.12, from: 5000, to: 1500 })
                break
            case 'coin': {
                // A bright little tick that climbs as the pile comes in.
                if (!this.throttle('coin', 45)) return
                const step = Math.floor(power * 12)
                const freq = 1320 * Math.pow(2, Math.min(12, step) / 12)
                this.tone(freq, 0.09, { type: 'triangle', gain: 0.07, attack: 0.002 })
                this.tone(freq * 1.5, 0.06, { type: 'sine', gain: 0.04, delay: 0.01 })
                break
            }
            case 'petAbility':
                switch (ev.variant) {
                    case 'flameDash':
                        this.hiss(0.4, { gain: 0.2, from: 600, to: 2600, q: 0.7 })
                        this.tone(300, 0.3, { type: 'sawtooth', gain: 0.08, to: 700 })
                        break
                    case 'cinderHowl':
                        this.tone(520, 0.7, { type: 'sawtooth', gain: 0.09, to: 760, attack: 0.08 })
                        this.tone(780, 0.6, { type: 'triangle', gain: 0.06, to: 1100, attack: 0.1, delay: 0.05 })
                        this.hiss(0.5, { gain: 0.08, from: 900, to: 300, q: 0.5 })
                        break
                    case 'shellWard':
                        this.chord([392, 494, 587], 0.5, 'triangle', 0.06, 0.06)
                        this.hiss(0.2, { gain: 0.06, from: 3000, to: 6000 })
                        break
                    case 'mendingBloom':
                        this.chord([523, 659, 784, 1047], 1.0, 'sine', 0.06, 0.1)
                        break
                    case 'gust':
                        this.hiss(0.5, { gain: 0.3, from: 400, to: 2200, q: 0.4 })
                        this.tone(120, 0.25, { type: 'sine', gain: 0.18, to: 60 })
                        break
                    case 'luckyFeather':
                        this.tone(1760, 0.25, { type: 'sine', gain: 0.05, to: 2200 })
                        this.tone(2637, 0.2, { type: 'sine', gain: 0.04, delay: 0.08 })
                        break
                }
                break
            case 'petFeather':
                this.chord([1047, 1319, 1568, 2093], 0.5, 'sine', 0.05, 0.05)
                this.hiss(0.25, { gain: 0.06, from: 4000, to: 8000 })
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
                if (ev.variant === 'javelin') {
                    this.hiss(0.12, { gain: 0.14, from: 3000, to: 800, q: 1.5 })
                    this.tone(120, 0.15, { type: 'triangle', gain: 0.18, to: 50 })
                }
                if (ev.variant === 'briar') {
                    // Wet, woody: bramble tearing out of the ground.
                    this.hiss(0.35, { gain: 0.18, from: 1600, to: 220, q: 0.7 })
                    this.tone(150, 0.3, { type: 'triangle', gain: 0.16, to: 55 })
                }
                if (ev.variant === 'knight') {
                    // Cloth and steel: the blink.
                    this.hiss(0.28, { gain: 0.16, from: 500, to: 4000, q: 0.7 })
                    this.tone(880, 0.22, { type: 'sine', gain: 0.07, to: 1760 })
                }
                break
            case 'ability':
                this.ability(ev.variant ?? '')
                break
            case 'abilityReady':
                this.tone(1320, 0.12, { type: 'sine', gain: 0.05 })
                this.tone(1760, 0.16, { type: 'sine', gain: 0.05, delay: 0.08 })
                break
            case 'ambush':
                this.tone(2400, 0.08, { type: 'square', gain: 0.08, to: 600 })
                this.tone(60, 0.5, { type: 'sine', gain: 0.4, to: 25 })
                this.hiss(0.4, { gain: 0.2, from: 5000, to: 300 })
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
                if (ev.variant === 'knight' && power > 0.8) {
                    // Parry stance: a bright, held ring of steel.
                    this.tone(2100, 0.5, { type: 'sine', gain: 0.07, to: 2400 })
                    this.tone(1400, 0.4, { type: 'triangle', gain: 0.05, delay: 0.05 })
                    return
                }
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
                this.chord([523, 659, 784], 0.5, 'triangle', 0.12)
                break
            case 'upgrade':
                this.chord([659, 880, 1318], 0.4, 'sine', 0.12, 0.07)
                break
            case 'legendary':
                // A fanfare: rising fourths, a shimmer, and a low bloom.
                for (let i = 0; i < 4; i++) this.tone([523, 698, 880, 1047][i]!, 0.5, { type: 'triangle', gain: 0.1, delay: i * 0.11, attack: 0.02 })
                this.chord([1047, 1319, 1568, 2093], 1.4, 'sine', 0.06, 0.12)
                this.tone(65, 1.6, { type: 'sine', gain: 0.3, to: 45, attack: 0.15, delay: 0.3 })
                this.hiss(1.0, { gain: 0.08, from: 3000, to: 9000, delay: 0.2 })
                break
            case 'avatar':
                // A world-sized sweep: sub thump, broad whoosh, a bright ring.
                this.tone(48, 0.9, { type: 'sine', gain: 0.5, to: 24 })
                this.hiss(0.7, { gain: 0.34, from: 400, to: 3200, q: 0.5 })
                this.hiss(0.5, { gain: 0.2, from: 5000, to: 800, delay: 0.12 })
                this.chord([261, 329, 392, 523], 1.1, 'triangle', 0.09, 0.1)
                this.tone(1568, 0.5, { type: 'sine', gain: 0.06, to: 2093, delay: 0.1 })
                break
            case 'chrono':
                // Time tearing: a reversed sweep down, a glassy tick, a long tail.
                this.hiss(0.9, { gain: 0.22, from: 6000, to: 120, q: 1.2 })
                this.tone(880, 0.8, { type: 'sawtooth', gain: 0.07, to: 110 })
                this.tone(1760, 0.06, { type: 'square', gain: 0.08, delay: 0.15 })
                this.tone(2637, 0.06, { type: 'square', gain: 0.06, delay: 0.32 })
                this.chord([110, 138, 165], 1.6, 'sine', 0.08, 0.06)
                break
            case 'storm':
                if (!this.throttle('storm', 120)) return
                this.hiss(0.18, { gain: 0.24, from: 7000, to: 900, q: 1.4 })
                this.tone(120, 0.32, { type: 'triangle', gain: 0.18, to: 40, delay: 0.03 })
                this.tone(2200 + Math.random() * 800, 0.05, { type: 'square', gain: 0.06 })
                break
            case 'splash':
                // A dull thud spreading outward under the hit.
                if (!this.throttle('splash', 90)) return
                this.tone(95, 0.16, { type: 'triangle', gain: 0.12 + power * 0.08, to: 45 })
                this.hiss(0.12, { gain: 0.08, from: 900, to: 300, q: 0.6 })
                break
            case 'charge':
                // Static catching: a short crackle and a high tick.
                if (!this.throttle('charge', 120)) return
                this.hiss(0.09, { gain: 0.1, from: 5000, to: 2200, q: 2.5 })
                this.tone(3000 + Math.random() * 600, 0.04, { type: 'square', gain: 0.04 })
                break
            case 'shatter':
                // Glass breaking: bright noise, a chime, a shard clatter.
                if (!this.throttle('shatter', 80)) return
                this.hiss(0.28, { gain: 0.24 + power * 0.1, from: 7000, to: 1800, q: 1.4 })
                this.tone(2093, 0.18, { type: 'sine', gain: 0.08, to: 2600 })
                this.tone(2794, 0.14, { type: 'triangle', gain: 0.05, to: 3300, delay: 0.04 })
                for (let i = 0; i < 3; i++) this.tone(1400 + Math.random() * 1400, 0.05, { type: 'square', gain: 0.03, delay: 0.08 + i * 0.05 })
                break
            case 'frostwave':
                // A deep intake of cold: a rushing sweep down, then a crystalline shimmer.
                this.hiss(0.8, { gain: 0.26, from: 5000, to: 200, q: 0.8 })
                this.tone(70, 0.7, { type: 'sine', gain: 0.35, to: 30 })
                this.chord([1568, 1976, 2349, 3136], 1.0, 'sine', 0.05, 0.1)
                break
            case 'eclipse':
                // The world stopping: a sub drop, a reversed swell, a bell.
                this.tone(52, 1.8, { type: 'sine', gain: 0.5, to: 20 })
                this.hiss(1.2, { gain: 0.2, from: 200, to: 5000, q: 0.6 })
                this.tone(1318, 0.9, { type: 'sine', gain: 0.09, to: 1245, attack: 0.05, delay: 0.2 })
                this.chord([164, 196, 246], 1.8, 'triangle', 0.07, 0.08)
                break
            case 'phantom': {
                if (!this.throttle(`phantom:${ev.variant}`, 160)) return
                const archer = ev.variant === 'archer'
                // A breath gathers into a resonant body, then a fine crystalline halo.
                this.hiss(0.65, { gain: 0.09, from: 350, to: 2800, q: 0.7, attack: 0.12 })
                this.tone(archer ? 196 : 98, 0.8, { gain: 0.09, to: archer ? 294 : 73, attack: 0.06 })
                this.chord(archer ? [587, 880, 1174] : [294, 440, 587], 0.75, 'sine', 0.045, 0.08)
                this.tone(archer ? 2349 : 1760, 0.55, { gain: 0.025, to: archer ? 2358 : 1772, delay: 0.18, attack: 0.025 })
                this.hiss(0.35, { gain: 0.035, from: 5200, to: 1800, delay: 0.2 })
                break
            }
            case 'phantomDraw':
                if (!this.throttle(`phantomDraw:${ev.variant}`, 100)) return
                if (ev.variant === 'archer') {
                    // Bow wood bending and a taut string, ending at the 275ms release.
                    this.hiss(0.26, { gain: 0.035, from: 500, to: 1500, q: 2, attack: 0.06 })
                    this.tone(280, 0.27, { type: 'triangle', gain: 0.025, to: 490, attack: 0.08 })
                } else {
                    this.hiss(0.18, { gain: 0.035, from: 400, to: 1700, q: 0.6, attack: 0.045 })
                    this.tone(392, 0.2, { gain: 0.02, to: 587, attack: 0.04 })
                }
                break
            case 'phantomStrike': {
                // Separate throttle keys keep allied attacks from swallowing the hero's swing.
                if (!this.throttle(`phantomStrike:${ev.variant}`, 70)) return
                const pitch = 0.97 + Math.random() * 0.06
                if (ev.variant === 'archer') {
                    // A short, woody snap, string harmonics, and an airy arrow whistle.
                    this.tone(740 * pitch, 0.12, { type: 'triangle', gain: 0.075, to: 260, attack: 0.002 })
                    this.tone(1480 * pitch, 0.16, { gain: 0.025, to: 720, attack: 0.002 })
                    this.hiss(0.065, { gain: 0.065, from: 3400, to: 1100, q: 1.4, attack: 0.002 })
                    this.hiss(0.24, { gain: 0.045, from: 5500, to: 2000, q: 2.5, delay: 0.015 })
                    this.tone(1760 * pitch, 0.3, { gain: 0.018, to: 1174, delay: 0.025 })
                } else {
                    // Heavy air under the blade, a steel overtone, then a ghostly tail.
                    this.hiss(0.24, { gain: 0.11, from: 2800, to: 350, q: 0.65, attack: 0.008 })
                    this.tone(145 * pitch, 0.18, { type: 'triangle', gain: 0.065, to: 62 })
                    this.tone(1174 * pitch, 0.22, { gain: 0.035, to: 784, attack: 0.008 })
                    this.tone(1760 * pitch, 0.35, { gain: 0.018, to: 1568, delay: 0.025 })
                }
                break
            }
            case 'phantomHit':
                if (!this.throttle(`phantomHit:${ev.variant}`, 90)) return
                this.hiss(0.09, { gain: 0.055, from: 4200, to: 1200, q: 1.3, attack: 0.002 })
                this.tone(ev.variant === 'archer' ? 160 : 100, 0.12, { type: 'triangle', gain: 0.055, to: 55 })
                this.tone(ev.variant === 'archer' ? 2349 : 1568, 0.26, { gain: 0.025, to: ev.variant === 'archer' ? 1760 : 1174 })
                break
            case 'laststand':
                // Grit: a low hit, then a held bright note.
                this.tone(80, 0.5, { type: 'sine', gain: 0.4, to: 35 })
                this.tone(1046, 0.9, { type: 'triangle', gain: 0.1, attack: 0.04 })
                this.tone(1568, 0.7, { type: 'sine', gain: 0.06, delay: 0.12 })
                break
            case 'crit':
                if (!this.throttle('crit', 60)) return
                this.tone(1400, 0.12, { type: 'square', gain: 0.07, to: 2400 })
                this.tone(90, 0.16, { type: 'sine', gain: 0.25, to: 40 })
                break
            case 'execute':
                this.tone(140, 0.25, { type: 'square', gain: 0.18, to: 30 })
                this.hiss(0.3, { gain: 0.22, from: 1800, to: 200 })
                break
            case 'leap':
                this.hiss(0.45, { gain: 0.14, from: 300, to: 2600, q: 0.7 })
                break
            case 'revive':
                this.chord([392, 523, 659, 784, 1046], 0.8, 'triangle', 0.14, 0.09)
                this.tone(60, 1.0, { type: 'sine', gain: 0.35, to: 25 })
                break
            case 'death':
                this.tone(120, 1.6, { type: 'sawtooth', gain: 0.2, to: 30 })
                this.hiss(0.9, { gain: 0.25, from: 600, to: 80, type: 'lowpass' })
                break
            case 'victory':
                this.chord([523, 659, 784, 1046, 1318], 0.7, 'triangle', 0.14, 0.12)
                break
        }
    }

    private ability(id: string) {
        switch (id) {
            case 'shieldwall':
                this.tone(420, 0.25, { type: 'square', gain: 0.1, to: 180 })
                this.tone(1600, 0.4, { type: 'sine', gain: 0.06, to: 1200 })
                this.hiss(0.15, { gain: 0.1, from: 3000, to: 900 })
                break
            case 'rally':
                this.chord([196, 262, 330], 0.9, 'sawtooth', 0.09, 0.05)
                this.hiss(0.5, { gain: 0.12, from: 500, to: 2500, q: 0.6 })
                break
            case 'bloodrage':
                this.tone(90, 0.9, { type: 'sawtooth', gain: 0.18, to: 260, attack: 0.2 })
                this.hiss(0.7, { gain: 0.2, from: 300, to: 1800, q: 0.5, attack: 0.15 })
                this.tone(50, 0.6, { type: 'sine', gain: 0.3, to: 25 })
                break
            case 'rendingthrow':
                for (let i = 0; i < 6; i++) this.hiss(0.1, { gain: 0.12, from: 700, to: 300, q: 1.2, delay: i * 0.13 })
                break
            case 'skewer':
                this.hiss(0.5, { gain: 0.16, from: 400, to: 3200, q: 0.8 })
                this.tone(180, 0.45, { type: 'sawtooth', gain: 0.08, to: 700 })
                break
            case 'javelinrain':
                for (let i = 0; i < 7; i++) this.hiss(0.14, { gain: 0.07, from: 4000, to: 1200, q: 2, delay: 0.2 + i * 0.11 })
                break
            case 'smokebomb':
                this.hiss(0.9, { gain: 0.18, from: 2200, to: 200, q: 0.4 })
                this.tone(140, 0.2, { type: 'triangle', gain: 0.12, to: 60 })
                break
            case 'fanofknives':
                for (let i = 0; i < 9; i++) this.tone(2600 + i * 90, 0.05, { type: 'square', gain: 0.035, to: 1800, delay: i * 0.02 })
                this.hiss(0.2, { gain: 0.12, from: 3500, to: 1200 })
                break
            case 'ironskin':
                this.tone(880, 0.6, { type: 'triangle', gain: 0.1, to: 660 })
                this.tone(1320, 0.5, { type: 'sine', gain: 0.06, delay: 0.05 })
                this.tone(70, 0.3, { type: 'sine', gain: 0.25, to: 35 })
                break
            case 'seismic':
                this.tone(45, 1.0, { type: 'sawtooth', gain: 0.22, to: 30 })
                for (let i = 0; i < 9; i++) this.hiss(0.08, { gain: 0.12, from: 900, to: 200, q: 1, delay: i * 0.055 })
                break
            case 'soulharvest':
                this.hiss(0.8, { gain: 0.14, from: 300, to: 3000, q: 0.5, attack: 0.3 })
                this.chord([330, 392, 494], 0.9, 'sine', 0.08, 0.1)
                break
            case 'deathmark':
                this.tone(660, 0.7, { type: 'sine', gain: 0.1, to: 640 })
                this.tone(990, 0.5, { type: 'sine', gain: 0.06, delay: 0.1 })
                this.hiss(0.3, { gain: 0.06, from: 6000, to: 2000, q: 2 })
                break
        }
    }
}
