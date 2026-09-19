/**
 * Every sound in Void Runner is synthesised on the fly with WebAudio — no
 * sample files. Each cue is a few oscillators and filtered noise through a
 * shared compressor, rate limited so a twelve-turret broadside doesn't turn
 * into a wall of clipping.
 */

export type VoidSfx =
    | 'pulse' | 'gatling' | 'flak' | 'missile' | 'rail' | 'gun' | 'enemyShot' | 'enemyBeam'
    | 'hit' | 'rockHit' | 'shieldHit' | 'hullHit' | 'explosionSmall' | 'explosionLarge' | 'rockBreak'
    | 'pickup' | 'cargoFull' | 'boost' | 'ability' | 'blink' | 'warning' | 'charge'
    | 'dock' | 'undock' | 'ui' | 'uiConfirm' | 'uiError' | 'wardenAlert' | 'levelUp' | 'lowHull' | 'mineArm'
    | 'bounty' | 'gear' | 'crit' | 'shieldBreak' | 'streak' | 'rareDrop'

export class VoidAudio {
    private ctx: AudioContext | null = null
    private master!: GainNode
    private sfxBus!: GainNode
    private musicBus!: GainNode
    private noiseBuffer!: AudioBuffer
    private lastPlayed = new Map<string, number>()
    private voices = 0
    /** Distance of the cue being played, read by `air()` while it builds nodes. */
    private playDistance = 0
    private engineOsc: OscillatorNode | null = null
    private engineOsc2: OscillatorNode | null = null
    private humDetune: OscillatorNode | null = null
    private humFilter: BiquadFilterNode | null = null
    private boostGain: GainNode | null = null
    private engineGain: GainNode | null = null
    private engineFilter: BiquadFilterNode | null = null
    private beamGain: GainNode | null = null
    private beamOsc: OscillatorNode | null = null
    private droneNodes: AudioNode[] = []
    private _volume = 0.7
    muted = false

    get volume() {
        return this._volume
    }

    set volume(v: number) {
        this._volume = Math.max(0, Math.min(1, v))
        if (this.master) this.master.gain.value = this.muted ? 0 : this._volume
    }

    setMuted(muted: boolean) {
        this.muted = muted
        if (this.master) this.master.gain.value = muted ? 0 : this._volume
    }

    /** Must run inside a user gesture. */
    unlock() {
        if (!this.ctx) {
            const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
            if (!Ctx) return
            const ctx = new Ctx()
            this.ctx = ctx
            const comp = ctx.createDynamicsCompressor()
            comp.threshold.value = -16
            comp.knee.value = 12
            comp.ratio.value = 5
            comp.attack.value = 0.003
            comp.release.value = 0.2
            this.master = ctx.createGain()
            this.master.gain.value = this.muted ? 0 : this._volume
            this.sfxBus = ctx.createGain()
            this.sfxBus.gain.value = 0.9
            this.musicBus = ctx.createGain()
            this.musicBus.gain.value = 0.32
            this.sfxBus.connect(comp)
            comp.connect(this.master)
            // Music skips the sfx compressor, or every explosion ducks the score.
            this.musicBus.connect(this.master)
            this.master.connect(ctx.destination)

            const len = ctx.sampleRate * 2
            this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
            const data = this.noiseBuffer.getChannelData(0)
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume()
    }

    dispose() {
        this.stopEngine()
        this.stopAmbient()
        void this.ctx?.close()
        this.ctx = null
    }

    private gate(key: string, minGap: number) {
        if (!this.ctx) return false
        const now = this.ctx.currentTime
        const last = this.lastPlayed.get(key) ?? -1
        if (now - last < minGap) return false
        if (this.voices > 48) return false
        this.lastPlayed.set(key, now)
        return true
    }

    private track(node: AudioScheduledSourceNode) {
        this.voices++
        node.onended = () => {
            this.voices--
        }
    }

    /**
     * Distance rolls the top off a sound as well as turning it down, so a kill
     * across the field sits behind the ship instead of on top of it.
     */
    private air() {
        const ctx = this.ctx!
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.value = 19000 / (1 + this.playDistance / 70)
        return f
    }

    private env(gain: GainNode, t: number, peak: number, attack: number, decay: number) {
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
    }

    private tone(type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number, pan = 0, delay = 0) {
        const ctx = this.ctx!
        const t = ctx.currentTime + delay
        const osc = ctx.createOscillator()
        osc.type = type
        osc.frequency.setValueAtTime(f0, t)
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + decay)
        const g = ctx.createGain()
        this.env(g, t, peak, attack, decay)
        const p = ctx.createStereoPanner()
        p.pan.value = Math.max(-1, Math.min(1, pan))
        osc.connect(g).connect(this.air()).connect(p).connect(this.sfxBus)
        osc.start(t)
        osc.stop(t + attack + decay + 0.05)
        this.track(osc)
    }

    private noise(filterType: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, decay: number, pan = 0, delay = 0) {
        const ctx = this.ctx!
        const t = ctx.currentTime + delay
        const src = ctx.createBufferSource()
        src.buffer = this.noiseBuffer
        src.playbackRate.value = 0.8 + Math.random() * 0.4
        const filter = ctx.createBiquadFilter()
        filter.type = filterType
        filter.Q.value = q
        filter.frequency.setValueAtTime(f0, t)
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay)
        const g = ctx.createGain()
        this.env(g, t, peak, attack, decay)
        const p = ctx.createStereoPanner()
        p.pan.value = Math.max(-1, Math.min(1, pan))
        src.connect(filter).connect(g).connect(this.air()).connect(p).connect(this.sfxBus)
        src.start(t, Math.random() * 1.5)
        src.stop(t + attack + decay + 0.05)
        this.track(src)
    }

    /**
     * `distance` is 0 for the player's own sounds; world sounds fade out with
     * it. `pan` is -1..1 from the camera's point of view.
     */
    play(sfx: VoidSfx, opts: { distance?: number, pan?: number, pitch?: number, volume?: number } = {}) {
        if (!this.ctx || this.muted) return
        this.playDistance = Math.max(0, opts.distance ?? 0)
        const falloff = 1 / (1 + Math.max(0, (opts.distance ?? 0) - 20) / 90)
        const v = (opts.volume ?? 1) * falloff
        if (v < 0.03) return
        const pan = opts.pan ?? 0
        const p = (opts.pitch ?? 1) * (0.94 + Math.random() * 0.12)

        switch (sfx) {
            case 'pulse':
                if (!this.gate(sfx, 0.045)) return
                this.tone('square', 1100 * p, 240 * p, 0.05 * v, 0.002, 0.09, pan)
                this.tone('sine', 700 * p, 120 * p, 0.08 * v, 0.002, 0.1, pan)
                break
            case 'gatling':
                if (!this.gate(sfx, 0.05)) return
                this.noise('bandpass', 2600 * p, 900, 1.2, 0.09 * v, 0.001, 0.045, pan)
                this.tone('square', 320 * p, 160, 0.03 * v, 0.001, 0.04, pan)
                break
            case 'flak':
                if (!this.gate(sfx, 0.08)) return
                this.noise('lowpass', 3000, 300, 0.7, 0.2 * v, 0.002, 0.16, pan)
                this.tone('triangle', 180 * p, 60, 0.12 * v, 0.002, 0.12, pan)
                break
            case 'missile':
                if (!this.gate(sfx, 0.07)) return
                this.noise('bandpass', 900, 2800, 1.5, 0.12 * v, 0.02, 0.35, pan)
                this.tone('sawtooth', 220 * p, 660 * p, 0.03 * v, 0.02, 0.3, pan)
                break
            case 'rail':
                if (!this.gate(sfx, 0.08)) return
                this.tone('sawtooth', 2400 * p, 80, 0.12 * v, 0.001, 0.35, pan)
                this.noise('highpass', 6000, 1200, 0.8, 0.14 * v, 0.001, 0.25, pan)
                this.tone('sine', 90, 40, 0.25 * v, 0.002, 0.3, pan)
                break
            case 'gun':
                if (!this.gate(sfx, 0.05)) return
                this.tone('sawtooth', 1500 * p, 300 * p, 0.05 * v, 0.001, 0.08, pan)
                this.tone('sine', 420 * p, 90, 0.1 * v, 0.001, 0.09, pan)
                break
            case 'enemyShot':
                if (!this.gate(sfx, 0.06)) return
                this.tone('square', 520 * p, 180 * p, 0.04 * v, 0.002, 0.14, pan)
                break
            case 'enemyBeam':
                if (!this.gate(sfx, 0.2)) return
                this.tone('sawtooth', 160, 60, 0.18 * v, 0.005, 0.7, pan)
                this.noise('lowpass', 2000, 200, 1, 0.2 * v, 0.005, 0.6, pan)
                break
            case 'hit':
                if (!this.gate(sfx, 0.035)) return
                this.noise('bandpass', 3200 * p, 1200, 2, 0.07 * v, 0.001, 0.05, pan)
                break
            case 'rockHit':
                if (!this.gate(sfx, 0.06)) return
                this.noise('bandpass', 700 * p, 300, 1.5, 0.06 * v, 0.001, 0.08, pan)
                this.tone('triangle', 1800 * p, 1400 * p, 0.015 * v, 0.001, 0.06, pan)
                break
            case 'shieldHit':
                if (!this.gate(sfx, 0.07)) return
                this.tone('sine', 900 * p, 1500 * p, 0.09 * v, 0.003, 0.18)
                this.tone('triangle', 1800 * p, 2600 * p, 0.03 * v, 0.003, 0.14)
                break
            case 'hullHit':
                if (!this.gate(sfx, 0.08)) return
                this.noise('lowpass', 1800, 150, 0.8, 0.28 * v, 0.002, 0.22)
                this.tone('square', 120 * p, 50, 0.1 * v, 0.002, 0.18)
                break
            case 'explosionSmall':
                if (!this.gate(sfx, 0.04)) return
                this.noise('lowpass', 2600 * p, 120, 0.7, 0.32 * v, 0.003, 0.45, pan)
                this.tone('sine', 140 * p, 35, 0.3 * v, 0.003, 0.4, pan)
                break
            case 'explosionLarge':
                if (!this.gate(sfx, 0.18)) return
                this.noise('lowpass', 1400 * p, 40, 0.6, 0.55 * v, 0.005, 1.6, pan)
                this.noise('bandpass', 3500, 400, 0.8, 0.18 * v, 0.003, 0.5, pan)
                this.tone('sine', 90 * p, 22, 0.55 * v, 0.004, 1.3, pan)
                this.noise('lowpass', 900, 60, 0.6, 0.25 * v, 0.02, 0.9, -pan, 0.12)
                break
            case 'rockBreak':
                if (!this.gate(sfx, 0.06)) return
                this.noise('lowpass', 1600 * p, 90, 0.6, 0.3 * v, 0.003, 0.6, pan)
                this.tone('triangle', 2400 * p, 1200 * p, 0.04 * v, 0.002, 0.25, pan)
                this.tone('triangle', 3000 * p, 1600 * p, 0.03 * v, 0.002, 0.2, pan, 0.05)
                break
            case 'pickup': {
                if (!this.gate(sfx, 0.035)) return
                const base = 880 * (opts.pitch ?? 1)
                this.tone('sine', base, base * 1.02, 0.07 * v, 0.003, 0.08)
                this.tone('sine', base * 1.5, base * 1.52, 0.05 * v, 0.003, 0.1, 0, 0.04)
                break
            }
            case 'cargoFull':
                if (!this.gate(sfx, 1.2)) return
                this.tone('square', 440, 440, 0.05 * v, 0.005, 0.12)
                this.tone('square', 330, 330, 0.05 * v, 0.005, 0.18, 0, 0.14)
                break
            case 'boost':
                if (!this.gate(sfx, 0.3)) return
                this.noise('bandpass', 300 * p, 1100 * p, 0.6, 0.1 * v, 0.08, 0.6)
                this.tone('sine', 55 * p, 95 * p, 0.08 * v, 0.06, 0.5)
                break
            case 'ability':
                if (!this.gate(sfx, 0.2)) return
                this.tone('sawtooth', 200 * p, 1600 * p, 0.08 * v, 0.02, 0.4)
                this.tone('sine', 400 * p, 3200 * p, 0.07 * v, 0.02, 0.35)
                this.noise('highpass', 800, 5000, 0.7, 0.1 * v, 0.02, 0.4)
                break
            case 'blink':
                if (!this.gate(sfx, 0.2)) return
                this.tone('sine', 2400 * p, 300 * p, 0.12 * v, 0.002, 0.25)
                this.noise('bandpass', 6000 * p, 400, 2, 0.14 * v, 0.002, 0.3)
                break
            case 'shieldBreak':
                // Glass under pressure: a bright crack that falls away into a hum.
                if (!this.gate(sfx, 0.15)) return
                this.noise('bandpass', 5200 * p, 900, 3, 0.2 * v, 0.001, 0.32, pan)
                this.tone('triangle', 1600 * p, 240 * p, 0.12 * v, 0.002, 0.4, pan)
                this.tone('sine', 300 * p, 120 * p, 0.09 * v, 0.01, 0.5, pan, 0.05)
                break
            case 'crit':
                // A hard metallic snap that cuts over the normal hit.
                if (!this.gate(sfx, 0.05)) return
                this.noise('bandpass', 4200 * p, 1800, 4, 0.16 * v, 0.001, 0.07, pan)
                this.tone('square', 2400 * p, 900 * p, 0.05 * v, 0.001, 0.09, pan)
                break
            case 'streak':
                // Rises with the streak: `pitch` carries how far in you are.
                if (!this.gate(sfx, 0.25)) return
                this.tone('triangle', 520 * p, 520 * p, 0.07 * v, 0.004, 0.1)
                this.tone('triangle', 780 * p, 780 * p, 0.06 * v, 0.004, 0.16, 0, 0.07)
                break
            case 'rareDrop':
                // Something valuable just fell out: a bell under a slow shimmer.
                if (!this.gate(sfx, 0.5)) return
                this.tone('sine', 1320, 1320, 0.09 * v, 0.004, 0.7, pan)
                this.tone('sine', 1980, 1980, 0.05 * v, 0.01, 0.9, pan, 0.06)
                this.tone('triangle', 660, 660, 0.07 * v, 0.006, 0.5, pan, 0.02)
                this.noise('highpass', 3000, 9000, 0.7, 0.05 * v, 0.2, 0.8, pan)
                break
            case 'warning':
                if (!this.gate(sfx, 0.5)) return
                this.tone('square', 740 * p, 740 * p, 0.05 * v, 0.005, 0.12)
                this.tone('square', 740 * p, 740 * p, 0.05 * v, 0.005, 0.12, 0, 0.2)
                break
            case 'charge':
                if (!this.gate(sfx, 0.3)) return
                this.tone('sawtooth', 120 * p, 900 * p, 0.07 * v, 0.6, 0.15, pan)
                break
            case 'mineArm':
                if (!this.gate(sfx, 0.3)) return
                this.tone('square', 1320, 1320, 0.035 * v, 0.002, 0.05, pan)
                break
            case 'dock':
                if (!this.gate(sfx, 0.5)) return
                this.tone('sine', 523, 523, 0.1 * v, 0.01, 0.35)
                this.tone('sine', 659, 659, 0.1 * v, 0.01, 0.35, 0, 0.12)
                this.tone('sine', 784, 784, 0.1 * v, 0.01, 0.6, 0, 0.24)
                this.tone('sine', 1046, 1046, 0.08 * v, 0.01, 0.9, 0, 0.36)
                break
            case 'undock':
                if (!this.gate(sfx, 0.5)) return
                this.noise('lowpass', 200, 3000, 0.8, 0.25 * v, 0.3, 1.2)
                this.tone('sawtooth', 50, 180, 0.08 * v, 0.3, 1.2)
                break
            case 'ui':
                if (!this.gate(sfx, 0.03)) return
                this.tone('sine', 1500, 1200, 0.04 * v, 0.002, 0.05)
                break
            case 'uiConfirm':
                if (!this.gate(sfx, 0.05)) return
                this.tone('sine', 880, 880, 0.06 * v, 0.003, 0.08)
                this.tone('sine', 1320, 1320, 0.06 * v, 0.003, 0.14, 0, 0.07)
                break
            case 'uiError':
                if (!this.gate(sfx, 0.1)) return
                this.tone('square', 200, 150, 0.05 * v, 0.003, 0.2)
                break
            case 'wardenAlert':
                if (!this.gate(sfx, 2)) return
                for (let i = 0; i < 3; i++) {
                    this.tone('sawtooth', 110, 90, 0.12 * v, 0.02, 0.5, 0, i * 0.55)
                    this.tone('square', 220, 180, 0.04 * v, 0.02, 0.45, 0, i * 0.55)
                }
                break
            case 'levelUp':
                if (!this.gate(sfx, 0.4)) return
                this.tone('triangle', 660 * p, 660 * p, 0.08 * v, 0.005, 0.12)
                this.tone('triangle', 990 * p, 990 * p, 0.08 * v, 0.005, 0.2, 0, 0.09)
                this.tone('sine', 1320 * p, 1320 * p, 0.06 * v, 0.005, 0.4, 0, 0.18)
                break
            case 'bounty':
                // A short brass-like fanfare: a low punch under a rising fifth and octave.
                if (!this.gate(sfx, 0.8)) return
                this.tone('sine', 110, 70, 0.14 * v, 0.004, 0.35)
                this.tone('sawtooth', 392, 392, 0.035 * v, 0.01, 0.16)
                this.tone('triangle', 587, 587, 0.07 * v, 0.01, 0.2, 0, 0.1)
                this.tone('triangle', 784, 784, 0.08 * v, 0.01, 0.55, 0, 0.2)
                this.tone('sine', 1568, 1568, 0.025 * v, 0.02, 0.6, 0, 0.2)
                break
            case 'gear':
                // Something heavy clunks into the hold, then a bright shimmer of loot.
                if (!this.gate(sfx, 0.4)) return
                this.noise('lowpass', 900, 120, 0.8, 0.22 * v, 0.002, 0.25)
                this.tone('sine', 180, 60, 0.18 * v, 0.003, 0.3)
                for (let i = 0; i < 4; i++) this.tone('triangle', 1046 * Math.pow(1.26, i), 1046 * Math.pow(1.26, i), 0.045 * v, 0.004, 0.22, 0, 0.08 + i * 0.06)
                break
            case 'lowHull':
                if (!this.gate(sfx, 0.5)) return
                this.tone('sine', 520 * p, 380 * p, 0.07 * v, 0.01, 0.25)
                if (p > 1.15) this.tone('sine', 520 * p, 380 * p, 0.06 * v, 0.01, 0.2, 0, 0.16)
                break
        }
    }

    // ─── Continuous layers ─────────────────────────────────────────────────

    startEngine() {
        if (!this.ctx || this.engineOsc) return
        const ctx = this.ctx
        // A soft, low drive: filtered noise for the rumble, a sine sub and a
        // quiet detuned hum. No raw sawtooth, so nothing buzzes.
        this.engineGain = ctx.createGain()
        this.engineGain.gain.value = 0.0001
        const master = ctx.createBiquadFilter()
        master.type = 'lowpass'
        master.frequency.value = 1800
        master.Q.value = 0.3
        this.engineGain.connect(master).connect(this.sfxBus)

        const noise = ctx.createBufferSource()
        noise.buffer = this.noiseBuffer
        noise.loop = true
        this.engineFilter = ctx.createBiquadFilter()
        this.engineFilter.type = 'lowpass'
        this.engineFilter.frequency.value = 220
        this.engineFilter.Q.value = 0.5
        const rumble = ctx.createGain()
        rumble.gain.value = 0.9
        noise.connect(this.engineFilter).connect(rumble).connect(this.engineGain)

        this.engineOsc = ctx.createOscillator()
        this.engineOsc.type = 'sine'
        this.engineOsc.frequency.value = 40
        const sub = ctx.createGain()
        sub.gain.value = 0.35
        this.engineOsc.connect(sub).connect(this.engineGain)

        this.engineOsc2 = ctx.createOscillator()
        this.engineOsc2.type = 'triangle'
        this.engineOsc2.frequency.value = 80
        const hum2 = ctx.createOscillator()
        hum2.type = 'triangle'
        hum2.frequency.value = 80.6
        this.humFilter = ctx.createBiquadFilter()
        this.humFilter.type = 'lowpass'
        this.humFilter.frequency.value = 260
        this.humFilter.Q.value = 0.4
        const hum = ctx.createGain()
        hum.gain.value = 0.12
        this.engineOsc2.connect(this.humFilter)
        hum2.connect(this.humFilter)
        this.humFilter.connect(hum).connect(this.engineGain)
        this.humDetune = hum2

        // Boost is a breathy airflow layer that fades in, not a pitch whine.
        const air = ctx.createBufferSource()
        air.buffer = this.noiseBuffer
        air.loop = true
        air.playbackRate.value = 0.8
        const airFilter = ctx.createBiquadFilter()
        airFilter.type = 'bandpass'
        airFilter.frequency.value = 700
        airFilter.Q.value = 0.7
        this.boostGain = ctx.createGain()
        this.boostGain.gain.value = 0
        air.connect(airFilter).connect(this.boostGain).connect(this.engineGain)

        const now = ctx.currentTime
        for (const n of [noise, this.engineOsc, this.engineOsc2, hum2, air]) n.start(now)
        this.droneNodes.push(noise, hum2, air)

        this.beamOsc = ctx.createOscillator()
        this.beamOsc.type = 'sawtooth'
        this.beamOsc.frequency.value = 180
        const bf = ctx.createBiquadFilter()
        bf.type = 'bandpass'
        bf.frequency.value = 900
        bf.Q.value = 4
        this.beamGain = ctx.createGain()
        this.beamGain.gain.value = 0
        this.beamOsc.connect(bf).connect(this.beamGain).connect(this.sfxBus)
        this.beamOsc.start()
    }

    /** throttle 0..1; boosting opens the airflow layer. heft 0..1 drops a big hull's drive into a deeper, louder rumble. */
    updateEngine(throttle: number, boosting: boolean, beams: number, heft = 0) {
        if (!this.ctx || !this.engineOsc || !this.engineGain || !this.engineFilter) return
        const t = this.ctx.currentTime
        const k = Math.max(0, Math.min(1, throttle))
        const deep = 1 - heft * 0.38
        this.engineGain.gain.setTargetAtTime((0.035 + k * 0.03 + (boosting ? 0.02 : 0)) * (1 + heft * 0.7), t, 0.25)
        this.engineFilter.frequency.setTargetAtTime((170 + k * 230 + (boosting ? 260 : 0)) * deep, t, 0.3)
        this.engineOsc.frequency.setTargetAtTime((38 + k * 8 + (boosting ? 6 : 0)) * (1 - heft * 0.2), t, 0.4)
        const hum = (76 + k * 22 + (boosting ? 14 : 0)) * deep
        this.engineOsc2!.frequency.setTargetAtTime(hum, t, 0.4)
        this.humDetune?.frequency.setTargetAtTime(hum * 1.008, t, 0.4)
        this.humFilter?.frequency.setTargetAtTime((240 + k * 160) * deep, t, 0.3)
        this.boostGain?.gain.setTargetAtTime(boosting ? 0.45 : 0, t, boosting ? 0.18 : 0.35)
        this.beamGain!.gain.setTargetAtTime(Math.min(0.05, beams * 0.018), t, 0.05)
        this.beamOsc!.frequency.setTargetAtTime(170 + Math.sin(t * 30) * 12, t, 0.02)
    }

    stopEngine() {
        for (const n of [this.engineOsc, this.engineOsc2, this.beamOsc, ...this.droneNodes]) {
            try {
                (n as AudioScheduledSourceNode | null)?.stop()
            } catch {
                // already stopped
            }
        }
        this.engineOsc = this.engineOsc2 = this.beamOsc = this.humDetune = null
        this.engineGain = this.engineFilter = this.beamGain = this.boostGain = this.humFilter = null
        this.droneNodes = []
    }

    // ─── Combat pulse ──────────────────────────────────────────────────────
    // A sequenced bass-and-hat groove that fades up with the fight. Notes are
    // scheduled a little ahead on the audio clock so timing stays tight.
    private combatGain: GainNode | null = null
    private combatTarget = 0
    private nextBeat = 0
    private beat = 0
    private combatRoot = 55

    setCombat(intensity: number) {
        if (!this.ctx) return
        this.combatTarget = Math.max(0, Math.min(1, intensity))
        if (!this.combatGain) {
            this.combatGain = this.ctx.createGain()
            this.combatGain.gain.value = 0
            this.combatGain.connect(this.musicBus)
            this.nextBeat = this.ctx.currentTime + 0.1
        }
        const t = this.ctx.currentTime
        this.combatGain.gain.setTargetAtTime(this.combatTarget * 0.9, t, this.combatTarget > this.combatGain.gain.value ? 0.6 : 2.5)
        if (this.combatGain.gain.value < 0.01 && this.combatTarget === 0) return
        const step = 60 / 118 / 2
        // Coming out of a lull the clock is minutes behind; restart it rather
        // than scheduling every missed beat into the past at once.
        if (this.nextBeat < t) {
            this.nextBeat = t + 0.05
            this.beat = 0
        }
        while (this.nextBeat < t + 0.2) {
            this.scheduleBeat(this.nextBeat, this.beat)
            this.nextBeat += step
            this.beat = (this.beat + 1) % 16
        }
    }

    private scheduleBeat(t: number, i: number) {
        const ctx = this.ctx!
        const out = this.combatGain!
        // Bass line: root, root, fifth, minor third pattern over two bars.
        const pattern = [0, 0, 7, 0, 0, 3, 0, 5, 0, 0, 7, 0, 10, 7, 3, 5]
        if (i % 2 === 0 || i === 7 || i === 15) {
            const f = this.combatRoot * Math.pow(2, pattern[i]! / 12)
            const osc = ctx.createOscillator()
            osc.type = 'sawtooth'
            osc.frequency.value = f
            const filter = ctx.createBiquadFilter()
            filter.type = 'lowpass'
            filter.frequency.setValueAtTime(900, t)
            filter.frequency.exponentialRampToValueAtTime(140, t + 0.18)
            const g = ctx.createGain()
            g.gain.setValueAtTime(0.0001, t)
            g.gain.exponentialRampToValueAtTime(0.22, t + 0.01)
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
            osc.connect(filter).connect(g).connect(out)
            osc.start(t)
            osc.stop(t + 0.25)
        }
        // Kick on the quarter notes.
        if (i % 4 === 0) {
            const osc = ctx.createOscillator()
            osc.frequency.setValueAtTime(120, t)
            osc.frequency.exponentialRampToValueAtTime(40, t + 0.12)
            const g = ctx.createGain()
            g.gain.setValueAtTime(0.35, t)
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
            osc.connect(g).connect(out)
            osc.start(t)
            osc.stop(t + 0.18)
        }
        // Closed hat on the off-beats.
        if (i % 2 === 1) {
            const src = ctx.createBufferSource()
            src.buffer = this.noiseBuffer
            const hp = ctx.createBiquadFilter()
            hp.type = 'highpass'
            hp.frequency.value = 7000
            const g = ctx.createGain()
            g.gain.setValueAtTime(0.06, t)
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
            src.connect(hp).connect(g).connect(out)
            src.start(t, Math.random())
            src.stop(t + 0.06)
        }
    }

    stopCombat() {
        if (this.combatGain && this.ctx) this.combatGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3)
        this.combatTarget = 0
    }

    private ambientNodes: AudioScheduledSourceNode[] = []
    private ambientGain: GainNode | null = null

    /** A slow detuned pad in the sector's key. */
    startAmbient(root = 55) {
        this.combatRoot = root
        if (!this.ctx || this.ambientGain) return
        const ctx = this.ctx
        this.ambientGain = ctx.createGain()
        this.ambientGain.gain.value = 0
        this.ambientGain.gain.setTargetAtTime(1, ctx.currentTime, 2)
        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = 700
        filter.Q.value = 0.5
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 0.05
        const lfoGain = ctx.createGain()
        lfoGain.gain.value = 350
        lfo.connect(lfoGain).connect(filter.frequency)
        lfo.start()
        this.ambientNodes.push(lfo)
        for (const [ratio, detune, gain] of [[1, -6, 0.12], [1.5, 5, 0.07], [2, 3, 0.05], [3, -4, 0.02], [0.5, 0, 0.1]] as const) {
            const osc = ctx.createOscillator()
            osc.type = ratio >= 2 ? 'sine' : 'triangle'
            osc.frequency.value = root * ratio
            osc.detune.value = detune
            const g = ctx.createGain()
            g.gain.value = gain
            osc.connect(g).connect(filter)
            osc.start()
            this.ambientNodes.push(osc)
        }
        filter.connect(this.ambientGain).connect(this.musicBus)
    }

    stopAmbient() {
        if (!this.ctx || !this.ambientGain) return
        const g = this.ambientGain
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4)
        const nodes = this.ambientNodes
        setTimeout(() => nodes.forEach((n) => {
            try {
                n.stop()
            } catch {
                // already stopped
            }
        }), 2000)
        this.ambientNodes = []
        this.ambientGain = null
    }
}
