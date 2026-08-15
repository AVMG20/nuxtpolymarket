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
      | 'buy'
      | 'deny'
      | 'door'
      | 'power'
      | 'papunch'
      | 'perk'
      | 'round-start'
      | 'death'

export class CallOfXenoAudio {
    private ctx: AudioContext | null = null
    private master: GainNode | null = null
    private noise: AudioBuffer | null = null
    private muted = false

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

        source.connect(filter).connect(gain).connect(this.master!)
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

        osc.connect(gain).connect(this.master!)
        osc.start(at)
        osc.stop(at + opts.duration + 0.02)
    }

    play(event: CallOfXenoSound) {
        if (!this.ctx || !this.master || this.muted) return
        if (this.ctx.state === 'suspended') void this.ctx.resume()
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
                this.burst({ duration: 0.09, gain: 0.34, freq: 1400, freqEnd: 300, q: 1.4 })
                this.tone({ duration: 0.07, gain: 0.16, freq: 320, freqEnd: 120, type: 'triangle' })
                break
            case 'headshot':
                this.burst({ duration: 0.13, gain: 0.42, freq: 2600, freqEnd: 400, q: 2 })
                this.tone({ duration: 0.1, gain: 0.24, freq: 900, freqEnd: 220, type: 'square' })
                break
            case 'kill':
                this.burst({ duration: 0.3, gain: 0.4, freq: 900, freqEnd: 120, q: 1 })
                this.tone({ duration: 0.26, gain: 0.22, freq: 140, freqEnd: 45, type: 'sawtooth' })
                break
            case 'zombie-groan':
                this.tone({ duration: 0.9, gain: 0.13, freq: 90 + Math.random() * 40, freqEnd: 55, type: 'sawtooth' })
                this.burst({ duration: 0.8, gain: 0.07, freq: 620, freqEnd: 180, type: 'bandpass', q: 3 })
                break
            case 'zombie-attack':
                this.tone({ duration: 0.25, gain: 0.24, freq: 320, freqEnd: 90, type: 'sawtooth' })
                this.burst({ duration: 0.2, gain: 0.22, freq: 1600, freqEnd: 260, q: 1.5 })
                break
            case 'hurt':
                this.tone({ duration: 0.4, gain: 0.3, freq: 220, freqEnd: 60, type: 'triangle' })
                this.burst({ duration: 0.3, gain: 0.2, freq: 700, freqEnd: 120, type: 'lowpass' })
                break
            case 'buy':
                this.tone({ duration: 0.1, gain: 0.24, freq: 880, type: 'square' })
                this.tone({ at: t + 0.09, duration: 0.18, gain: 0.24, freq: 1320, type: 'square' })
                break
            case 'deny':
                this.tone({ duration: 0.16, gain: 0.22, freq: 220, freqEnd: 120, type: 'square' })
                break
            case 'door':
                this.burst({ duration: 0.55, gain: 0.4, freq: 1200, freqEnd: 140, q: 0.8 })
                this.tone({ duration: 0.5, gain: 0.22, freq: 130, freqEnd: 55, type: 'sawtooth' })
                break
            case 'power':
                this.tone({ duration: 1.6, gain: 0.3, freq: 60, freqEnd: 220, type: 'sawtooth' })
                this.tone({ at: t + 0.4, duration: 1.4, gain: 0.16, freq: 180, freqEnd: 440, type: 'sine' })
                this.burst({ at: t + 0.1, duration: 0.7, gain: 0.18, freq: 400, freqEnd: 2600, type: 'bandpass', q: 2 })
                break
            case 'papunch':
                for (let i = 0; i < 4; i++) {
                    this.tone({ at: t + i * 0.12, duration: 0.22, gain: 0.22, freq: 440 * Math.pow(2, i / 4), type: 'square' })
                }
                break
            case 'perk':
                this.tone({ duration: 0.5, gain: 0.2, freq: 300, freqEnd: 900, type: 'sine' })
                this.tone({ at: t + 0.2, duration: 0.4, gain: 0.16, freq: 600, freqEnd: 1200, type: 'triangle' })
                break
            case 'round-start':
                this.tone({ duration: 1.2, gain: 0.22, freq: 320, freqEnd: 180, type: 'sawtooth' })
                this.tone({ at: t + 0.5, duration: 1.2, gain: 0.2, freq: 240, freqEnd: 140, type: 'sawtooth' })
                break
            case 'death':
                this.tone({ duration: 2.2, gain: 0.3, freq: 260, freqEnd: 40, type: 'sawtooth' })
                this.burst({ duration: 1.8, gain: 0.2, freq: 1400, freqEnd: 90, q: 1 })
                break
        }
    }
}
