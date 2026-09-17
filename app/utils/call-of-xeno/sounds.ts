// Call of Xeno — synthesised sound effects.
//
// Every effect is generated live with the Web Audio API rather than shipped as
// a sample. There is nothing to download, nothing to keep in sync with the
// build, and each shot can be detuned slightly so a held trigger does not turn
// into one flat repeating click.

export type CallOfXenoSound
    = | 'shoot-pistol'
      | 'shoot-shotgun'
      | 'shoot-smg'
      | 'shoot-rifle'
      | 'shoot-lmg'
      | 'shoot-launcher'
      | 'shoot-wonder'
      | 'dry-fire'
      | 'reload-start'
      | 'reload-end'
      | 'hit'
      | 'headshot'
      | 'kill'
      | 'zombie-groan'
      | 'zombie-attack'
  | 'hurt'
  | 'melee'
  | 'melee-hit'
  | 'footstep'
  | 'land'
  | 'heartbeat'
  | 'explosion'
  | 'buy'
      | 'deny'
      | 'door'
      | 'power'
      | 'papunch'
      | 'perk'
      | 'round-start'
      | 'death'
      | 'board-break'
      | 'board-repair'
      | 'climb-in'

export class CallOfXenoAudio {
    private ctx: AudioContext | null = null
    private master: GainNode | null = null
    private noise: AudioBuffer | null = null
    private muted = false
    /** Stereo pan of the effect currently being played. −1 left … +1 right. */
    private pan = 0

    /** Must be called from a user gesture — browsers refuse to start audio otherwise. */
    start() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') void this.ctx.resume()
            return
        }
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        this.ctx = new Ctor()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.55
        this.master.connect(this.ctx.destination)

        // Two seconds of white noise, reused as the source for every percussive
        // layer: gunshot bodies, impacts, the reload clatter.
        const length = this.ctx.sampleRate * 2
        const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
        const data = buffer.getChannelData(0)
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
        this.noise = buffer
    }

    setMuted(muted: boolean) {
        this.muted = muted
        if (this.master) this.master.gain.value = muted ? 0 : 0.55
    }

    isMuted() {
        return this.muted
    }

    dispose() {
        void this.ctx?.close()
        this.ctx = null
        this.master = null
        this.noise = null
    }

    private now() {
        return this.ctx!.currentTime
    }

    /**
     * Where this effect's layers connect: straight to the master, or through
     * a stereo panner when the source sits off-centre — so a groan from the
     * left speaker tells you which wall is about to lose its boards.
     */
    private output(): AudioNode {
        if (Math.abs(this.pan) < 0.01) return this.master!
        const panner = this.ctx!.createStereoPanner()
        panner.pan.value = Math.max(-1, Math.min(1, this.pan))
        panner.connect(this.master!)
        return panner
    }

    /** Filtered noise burst — the body of every gunshot and impact. */
    private burst(opts: {
        at?: number
        duration: number
        gain: number
        type?: BiquadFilterType
        freq: number
        freqEnd?: number
        q?: number
        curve?: number
    }) {
        const ctx = this.ctx!
        const at = opts.at ?? this.now()
        const source = ctx.createBufferSource()
        source.buffer = this.noise
        source.playbackRate.value = 0.8 + Math.random() * 0.4

        const filter = ctx.createBiquadFilter()
        filter.type = opts.type ?? 'lowpass'
        filter.frequency.setValueAtTime(opts.freq, at)
        if (opts.freqEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), at + opts.duration)
        filter.Q.value = opts.q ?? 1

        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0, at)
        gain.gain.linearRampToValueAtTime(opts.gain, at + 0.004)
        gain.gain.exponentialRampToValueAtTime(0.0001, at + opts.duration)

        source.connect(filter).connect(gain).connect(this.output())
        source.start(at, Math.random() * 1.5)
        source.stop(at + opts.duration + 0.02)
    }

    /** Pitched oscillator layer — thump, whine, chime. */
    private tone(opts: {
        at?: number
        duration: number
        gain: number
        freq: number
        freqEnd?: number
        type?: OscillatorType
    }) {
        const ctx = this.ctx!
        const at = opts.at ?? this.now()
        const osc = ctx.createOscillator()
        osc.type = opts.type ?? 'sine'
        osc.frequency.setValueAtTime(opts.freq, at)
        if (opts.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), at + opts.duration)

        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0, at)
        gain.gain.linearRampToValueAtTime(opts.gain, at + 0.006)
        gain.gain.exponentialRampToValueAtTime(0.0001, at + opts.duration)

        osc.connect(gain).connect(this.output())
        osc.start(at)
        osc.stop(at + opts.duration + 0.02)
    }

    play(event: CallOfXenoSound, pan = 0) {
        if (!this.ctx || !this.master || this.muted) return
        if (this.ctx.state === 'suspended') void this.ctx.resume()
        this.pan = pan
        const t = this.now()

        switch (event) {
            case 'shoot-pistol':
                this.burst({ duration: 0.16, gain: 0.5, freq: 4200, freqEnd: 500, q: 0.8 })
                this.tone({ duration: 0.12, gain: 0.35, freq: 190, freqEnd: 60, type: 'triangle' })
                break
            case 'shoot-smg':
                this.burst({ duration: 0.11, gain: 0.42, freq: 5200, freqEnd: 700, q: 0.7 })
                this.tone({ duration: 0.08, gain: 0.28, freq: 240, freqEnd: 80, type: 'square' })
                break
            case 'shoot-rifle':
                this.burst({ duration: 0.19, gain: 0.55, freq: 6000, freqEnd: 400, q: 0.9 })
                this.tone({ duration: 0.14, gain: 0.4, freq: 150, freqEnd: 48, type: 'triangle' })
                break
            case 'shoot-lmg':
                this.burst({ duration: 0.22, gain: 0.6, freq: 3400, freqEnd: 300, q: 1.1 })
                this.tone({ duration: 0.18, gain: 0.48, freq: 110, freqEnd: 40, type: 'sawtooth' })
                break
            case 'shoot-launcher':
                // A hollow back-blast cough, then the rising burn of the
                // rocket motor carrying the shell away.
                this.burst({ duration: 0.38, gain: 0.42, freq: 1400, freqEnd: 200, q: 0.7 })
                this.tone({ duration: 0.34, gain: 0.32, freq: 95, freqEnd: 36, type: 'sawtooth' })
                this.tone({ at: t + 0.04, duration: 0.3, gain: 0.13, freq: 620, freqEnd: 1900, type: 'sawtooth' })
                break
            case 'shoot-shotgun':
                this.burst({ duration: 0.42, gain: 0.7, freq: 2600, freqEnd: 200, q: 0.6 })
                this.tone({ duration: 0.3, gain: 0.5, freq: 95, freqEnd: 34, type: 'triangle' })
                break
            case 'shoot-wonder':
                this.tone({ duration: 0.5, gain: 0.34, freq: 1600, freqEnd: 180, type: 'sawtooth' })
                this.tone({ at: t + 0.02, duration: 0.45, gain: 0.22, freq: 2400, freqEnd: 300, type: 'sine' })
                this.burst({ duration: 0.4, gain: 0.2, freq: 900, freqEnd: 120, type: 'bandpass', q: 6 })
                break
            case 'dry-fire':
                this.burst({ duration: 0.05, gain: 0.3, freq: 3000, q: 4, type: 'bandpass' })
                break
            case 'reload-start':
                this.burst({ duration: 0.07, gain: 0.3, freq: 1800, q: 5, type: 'bandpass' })
                this.burst({ at: t + 0.13, duration: 0.06, gain: 0.24, freq: 1200, q: 5, type: 'bandpass' })
                break
            case 'reload-end':
                this.burst({ duration: 0.08, gain: 0.34, freq: 2400, q: 6, type: 'bandpass' })
                this.tone({ duration: 0.06, gain: 0.2, freq: 420, freqEnd: 180, type: 'square' })
                break
            case 'hit':
                // Wet squelch: soft low thud, no bright crack.
                this.burst({ duration: 0.08, gain: 0.3, freq: 700, freqEnd: 160, q: 0.9 })
                this.tone({ duration: 0.06, gain: 0.14, freq: 210, freqEnd: 80, type: 'triangle' })
                break
            case 'headshot':
                // A dull crunch rather than a ding.
                this.burst({ duration: 0.11, gain: 0.4, freq: 1500, freqEnd: 260, q: 1.4 })
                this.tone({ duration: 0.09, gain: 0.2, freq: 130, freqEnd: 55, type: 'triangle' })
                break
            case 'kill':
                this.burst({ duration: 0.22, gain: 0.32, freq: 640, freqEnd: 90, q: 0.9 })
                this.tone({ duration: 0.2, gain: 0.16, freq: 110, freqEnd: 40, type: 'sawtooth' })
                break
            case 'zombie-groan': {
                // A rasp from the chest: two detuned growls plus a breath of
                // air through a narrow band, each call pitched at random.
                const base = 68 + Math.random() * 42
                this.tone({ duration: 1.1, gain: 0.14, freq: base, freqEnd: base * 0.62, type: 'sawtooth' })
                this.tone({ duration: 1.05, gain: 0.09, freq: base * 1.02, freqEnd: base * 0.6, type: 'sawtooth' })
                this.burst({ duration: 1.0, gain: 0.05, freq: 900, freqEnd: 300, type: 'bandpass', q: 4 })
                break
            }
            case 'zombie-attack':
                // A snarl snapping shut: fast rising rasp, then the bite.
                this.tone({ duration: 0.16, gain: 0.2, freq: 140, freqEnd: 380, type: 'sawtooth' })
                this.tone({ at: t + 0.14, duration: 0.14, gain: 0.22, freq: 300, freqEnd: 80, type: 'sawtooth' })
                this.burst({ at: t + 0.14, duration: 0.14, gain: 0.18, freq: 1800, freqEnd: 300, q: 1.4 })
                break
            case 'hurt':
                // Muffled thump and a ringing ear, not a cartoon yell.
                this.tone({ duration: 0.3, gain: 0.3, freq: 160, freqEnd: 48, type: 'triangle' })
                this.burst({ duration: 0.22, gain: 0.16, freq: 520, freqEnd: 120 })
                this.tone({ duration: 0.5, gain: 0.06, freq: 3100, freqEnd: 2900, type: 'sine' })
                break
            case 'melee':
                this.burst({ duration: 0.15, gain: 0.22, freq: 800, freqEnd: 3400, type: 'bandpass', q: 2 })
                break
            case 'melee-hit':
                this.burst({ duration: 0.12, gain: 0.44, freq: 900, freqEnd: 150, q: 1 })
                this.tone({ duration: 0.15, gain: 0.32, freq: 165, freqEnd: 55, type: 'triangle' })
                break
            case 'footstep':
                this.burst({ duration: 0.05, gain: 0.06 + Math.random() * 0.03, freq: 280 + Math.random() * 180, q: 1.3 })
                break
            case 'land':
                this.tone({ duration: 0.17, gain: 0.26, freq: 115, freqEnd: 44, type: 'triangle' })
                this.burst({ duration: 0.11, gain: 0.17, freq: 420, freqEnd: 130 })
                break
            case 'heartbeat':
                this.tone({ duration: 0.12, gain: 0.36, freq: 58, freqEnd: 40 })
                this.tone({ at: t + 0.24, duration: 0.1, gain: 0.26, freq: 52, freqEnd: 38 })
                break
            case 'explosion': {
                // A sharp crack, then the low rumble rolling away.
                this.burst({ duration: 0.12, gain: 0.5, freq: 3000, freqEnd: 700, q: 0.8 })
                this.burst({ at: t + 0.02, duration: 1.0, gain: 0.6, freq: 750, freqEnd: 55, q: 0.6 })
                this.tone({ duration: 0.85, gain: 0.5, freq: 78, freqEnd: 24, type: 'sawtooth' })
                this.tone({ at: t + 0.03, duration: 0.6, gain: 0.3, freq: 190, freqEnd: 36, type: 'triangle' })
                break
            }
            case 'buy': {
                // Coin chime, muted.
                this.tone({ duration: 0.09, gain: 0.16, freq: 990, type: 'sine' })
                this.tone({ at: t + 0.07, duration: 0.16, gain: 0.14, freq: 1485, type: 'sine' })
                break
            }
            case 'deny':
                this.tone({ duration: 0.09, gain: 0.16, freq: 180, freqEnd: 150, type: 'square' })
                this.tone({ at: t + 0.11, duration: 0.12, gain: 0.14, freq: 150, freqEnd: 110, type: 'square' })
                break
            case 'door':
                // Metal grinding back into a pocket.
                this.burst({ duration: 0.5, gain: 0.28, freq: 900, freqEnd: 200, type: 'bandpass', q: 2.5 })
                this.tone({ at: t + 0.42, duration: 0.16, gain: 0.24, freq: 95, freqEnd: 50, type: 'triangle' })
                break
            case 'power':
                // Breaker thrown: a clunk, then the hum climbing to full.
                this.burst({ duration: 0.06, gain: 0.4, freq: 2400, freqEnd: 500, q: 3 })
                this.tone({ at: t + 0.1, duration: 1.6, gain: 0.22, freq: 50, freqEnd: 190, type: 'sawtooth' })
                this.tone({ at: t + 0.5, duration: 1.3, gain: 0.12, freq: 170, freqEnd: 400, type: 'sine' })
                break
            case 'papunch': {
                // A whirring charge, then the stamp comes down.
                this.tone({ duration: 0.5, gain: 0.16, freq: 160, freqEnd: 660, type: 'sawtooth' })
                for (let i = 0; i < 3; i++) {
                    this.tone({ at: t + 0.5 + i * 0.09, duration: 0.1, gain: 0.16, freq: 520 + i * 140, type: 'square' })
                }
                this.burst({ at: t + 0.78, duration: 0.12, gain: 0.34, freq: 2100, freqEnd: 400, q: 2 })
                break
            }
            case 'perk': {
                // A short bottle-pop jingle.
                this.burst({ duration: 0.04, gain: 0.24, freq: 2000, freqEnd: 900, type: 'bandpass', q: 5 })
                this.tone({ at: t + 0.05, duration: 0.14, gain: 0.16, freq: 523, type: 'sine' })
                this.tone({ at: t + 0.17, duration: 0.14, gain: 0.16, freq: 659, type: 'sine' })
                this.tone({ at: t + 0.29, duration: 0.24, gain: 0.16, freq: 784, type: 'sine' })
                break
            }
            case 'round-start': {
                // The horde horn: two low saws a fifth apart, fading out.
                this.tone({ duration: 1.5, gain: 0.16, freq: 98, freqEnd: 82, type: 'sawtooth' })
                this.tone({ duration: 1.5, gain: 0.12, freq: 147, freqEnd: 123, type: 'sawtooth' })
                this.burst({ duration: 1.2, gain: 0.06, freq: 400, freqEnd: 150, type: 'bandpass', q: 2 })
                break
            }
            case 'death':
                // Falling: a low drone sliding out under a fading pulse.
                this.tone({ duration: 2.4, gain: 0.22, freq: 200, freqEnd: 34, type: 'sawtooth' })
                this.tone({ duration: 2.2, gain: 0.16, freq: 96, freqEnd: 30, type: 'triangle' })
                this.burst({ duration: 1.6, gain: 0.12, freq: 700, freqEnd: 80, q: 1 })
                break
            case 'board-break':
                // Nails giving, then the plank cracking off.
                this.burst({ duration: 0.09, gain: 0.3, freq: 2800, freqEnd: 900, type: 'bandpass', q: 3 })
                this.burst({ at: t + 0.06, duration: 0.26, gain: 0.4, freq: 1500, freqEnd: 240, q: 1.2 })
                this.tone({ at: t + 0.06, duration: 0.2, gain: 0.2, freq: 260, freqEnd: 90, type: 'square' })
                break
            case 'board-repair':
                // Two hammer strikes onto timber.
                this.burst({ duration: 0.07, gain: 0.34, freq: 1900, freqEnd: 420, q: 2 })
                this.tone({ duration: 0.09, gain: 0.22, freq: 300, freqEnd: 130, type: 'triangle' })
                this.burst({ at: t + 0.11, duration: 0.06, gain: 0.26, freq: 1600, freqEnd: 380, q: 2 })
                break
            case 'climb-in':
                this.burst({ duration: 0.3, gain: 0.22, freq: 700, freqEnd: 160, type: 'lowpass' })
                this.tone({ duration: 0.26, gain: 0.16, freq: 150, freqEnd: 60, type: 'triangle' })
                break
        }
    }
}
