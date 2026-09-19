/**
 * Every sound in Void Runner is synthesised on the fly with WebAudio — no
 * sample files. A cue is a stack of layers (transient, body, sub, tail) built
 * from oscillators, FM pairs and three shared noise buffers, mixed into one
 * per-cue chain that handles distance, pan and the reverb send. Everything
 * meets on a master bus: glue compressor, generated-impulse reverb, brickwall
 * limiter and a soft clip, so a twelve-turret broadside stacked on a warden
 * kill still never clips.
 */

export type VoidSfx =
    | 'pulse' | 'gatling' | 'flak' | 'missile' | 'rail' | 'gun' | 'enemyShot' | 'enemyBeam'
    | 'hit' | 'rockHit' | 'shieldHit' | 'hullHit' | 'explosionSmall' | 'explosionLarge' | 'rockBreak'
    | 'pickup' | 'cargoFull' | 'boost' | 'ability' | 'blink' | 'warning' | 'charge'
    | 'dock' | 'undock' | 'ui' | 'uiConfirm' | 'uiError' | 'wardenAlert' | 'levelUp' | 'lowHull' | 'mineArm'
    | 'bounty' | 'gear' | 'crit' | 'shieldBreak' | 'streak' | 'rareDrop'
    | 'mortar' | 'tesla' | 'plasma' | 'shieldDown' | 'shieldUp' | 'death' | 'boostEnd'

/**
 * Per cue: [minimum gap between plays in seconds, priority, reverb send].
 * Priority 0 is chatter that is dropped first when the mix is busy, 1 is
 * normal, 2 is feedback the player must never miss.
 */
const CUES: Record<VoidSfx, readonly [number, 0 | 1 | 2, number]> = {
    pulse: [0.045, 0, 0.1],
    gatling: [0.05, 0, 0.06],
    flak: [0.08, 1, 0.14],
    missile: [0.07, 1, 0.2],
    rail: [0.08, 1, 0.3],
    gun: [0.05, 1, 0.08],
    enemyShot: [0.06, 0, 0.12],
    enemyBeam: [0.2, 1, 0.25],
    hit: [0.035, 0, 0.05],
    rockHit: [0.06, 0, 0.1],
    shieldHit: [0.07, 1, 0.2],
    hullHit: [0.08, 2, 0.15],
    explosionSmall: [0.04, 1, 0.3],
    explosionLarge: [0.18, 2, 0.4],
    rockBreak: [0.06, 1, 0.3],
    pickup: [0.035, 1, 0.12],
    cargoFull: [1.2, 2, 0.15],
    boost: [0.3, 2, 0.2],
    ability: [0.2, 2, 0.3],
    blink: [0.2, 1, 0.4],
    warning: [0.5, 2, 0.15],
    charge: [0.3, 1, 0.2],
    dock: [0.5, 2, 0.4],
    undock: [0.5, 2, 0.3],
    ui: [0.03, 2, 0.04],
    uiConfirm: [0.05, 2, 0.12],
    uiError: [0.1, 2, 0.08],
    wardenAlert: [2, 2, 0.45],
    levelUp: [0.4, 2, 0.35],
    lowHull: [0.5, 2, 0.12],
    mineArm: [0.3, 1, 0.12],
    bounty: [0.8, 2, 0.35],
    gear: [0.4, 2, 0.3],
    crit: [0.05, 1, 0.12],
    shieldBreak: [0.15, 1, 0.3],
    streak: [0.25, 2, 0.25],
    rareDrop: [0.5, 2, 0.45],
    mortar: [0.08, 1, 0.2],
    tesla: [0.06, 1, 0.2],
    plasma: [0.07, 1, 0.2],
    shieldDown: [0.5, 2, 0.35],
    shieldUp: [1, 2, 0.3],
    death: [2, 2, 0.5],
    boostEnd: [0.4, 1, 0.2]
}

/** Live source ceiling per priority. */
const VOICE_CAP = [36, 60, 96] as const

type NoiseKind = 'white' | 'brown' | 'crackle'

interface Cue {
    nodes: AudioNode[]
    pending: number
}

interface LayerOpts {
    /** Seconds after the cue starts. */
    delay?: number
    /** Time the pitch or filter sweep takes; defaults to the whole envelope. */
    sweep?: number
    /** Noise playback rate: lower is darker and slower. */
    rate?: number
}

export class VoidAudio {
    private ctx: AudioContext | null = null
    private master!: GainNode
    private sfxBus!: GainNode
    private musicBus!: GainNode
    private reverbIn!: GainNode
    private buffers!: Record<NoiseKind, AudioBuffer>
    private lastPlayed = new Map<string, number>()
    private voices = 0
    /** The cue being built: layers connect to `dest` and start at `t0`. */
    private cue: Cue | null = null
    private dest!: AudioNode
    private t0 = 0
    /** Far cues get slower attacks as well as a darker top. */
    private soften = 1
    private gatlingFlip = false
    private engineOsc: OscillatorNode | null = null
    private engineOsc2: OscillatorNode | null = null
    private heftOsc: OscillatorNode | null = null
    private heftGain: GainNode | null = null
    private humDetune: OscillatorNode | null = null
    private humFilter: BiquadFilterNode | null = null
    private boostGain: GainNode | null = null
    private engineGain: GainNode | null = null
    private engineFilter: BiquadFilterNode | null = null
    private turbineFilter: BiquadFilterNode | null = null
    private turbineGain: GainNode | null = null
    private beamGain: GainNode | null = null
    private beamOsc: OscillatorNode | null = null
    private droneNodes: AudioScheduledSourceNode[] = []
    private engineGraph: AudioNode[] = []
    private wasBoosting = false
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
            this.ctx = new Ctx()
            this.build()
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume()
    }

    /**
     * The master bus. Sound effects are glued by a gentle compressor; music
     * and the reverb return join after it so an explosion neither ducks the
     * score nor chokes its own tail. A fast limiter and a soft clip that only
     * bends above 0.7 sit last, ahead of the volume control.
     */
    private build() {
        const ctx = this.ctx!
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.value = -18
        comp.knee.value = 12
        comp.ratio.value = 4
        comp.attack.value = 0.004
        comp.release.value = 0.22
        const limiter = ctx.createDynamicsCompressor()
        limiter.threshold.value = -2
        limiter.knee.value = 0
        limiter.ratio.value = 20
        limiter.attack.value = 0.001
        limiter.release.value = 0.09
        const clip = ctx.createWaveShaper()
        const curve = new Float32Array(2049)
        for (let i = 0; i < curve.length; i++) {
            const x = i / 1024 - 1
            const a = Math.abs(x)
            curve[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.25 * Math.tanh((a - 0.7) / 0.25))
        }
        clip.curve = curve

        this.master = ctx.createGain()
        this.master.gain.value = this.muted ? 0 : this._volume
        this.sfxBus = ctx.createGain()
        this.sfxBus.gain.value = 0.8
        this.musicBus = ctx.createGain()
        this.musicBus.gain.value = 0.34
        const mix = ctx.createGain()
        this.sfxBus.connect(comp).connect(mix)
        this.musicBus.connect(mix)
        mix.connect(limiter).connect(clip).connect(this.master).connect(ctx.destination)

        this.buffers = {
            white: this.makeNoise('white', 2),
            brown: this.makeNoise('brown', 3),
            crackle: this.makeNoise('crackle', 2)
        }

        // Reverb send: a big, dark, empty room. The low end stays out of it so
        // booms keep their punch and the tail is all air.
        this.reverbIn = ctx.createGain()
        const verb = ctx.createConvolver()
        verb.buffer = this.makeImpulse(2.6)
        const verbCut = ctx.createBiquadFilter()
        verbCut.type = 'highpass'
        verbCut.frequency.value = 220
        const verbOut = ctx.createGain()
        verbOut.gain.value = 0.55
        this.reverbIn.connect(verbCut).connect(verb).connect(verbOut).connect(mix)
    }

    /**
     * White is flat hiss, brown is integrated white for rumble, crackle is
     * sparse random impulses that turn into debris, sparks or sizzle depending
     * on the filter and playback rate they are sent through.
     */
    private makeNoise(kind: NoiseKind, seconds: number) {
        const ctx = this.ctx!
        const len = Math.floor(ctx.sampleRate * seconds)
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
        const data = buffer.getChannelData(0)
        if (kind === 'white') {
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
        } else if (kind === 'brown') {
            let last = 0
            let peak = 0
            for (let i = 0; i < len; i++) {
                last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02
                data[i] = last
                peak = Math.max(peak, Math.abs(last))
            }
            // Fade the seam so the loop never clicks.
            const fade = Math.floor(ctx.sampleRate * 0.05)
            for (let i = 0; i < len; i++) data[i] = data[i]! / peak * Math.min(1, i / fade, (len - 1 - i) / fade)
        } else {
            for (let i = 0; i < len; i++) data[i] = Math.random() < 0.0025 ? (Math.random() * 2 - 1) * (0.4 + Math.random() * 0.6) : 0
        }
        return buffer
    }

    /** Decaying stereo noise that darkens as it fades, after a short pre-delay. */
    private makeImpulse(seconds: number) {
        const ctx = this.ctx!
        const len = Math.floor(ctx.sampleRate * seconds)
        const pre = Math.floor(ctx.sampleRate * 0.018)
        const impulse = ctx.createBuffer(2, len, ctx.sampleRate)
        for (let c = 0; c < 2; c++) {
            const data = impulse.getChannelData(c)
            let lp = 0
            for (let i = pre; i < len; i++) {
                const k = (i - pre) / (len - pre)
                // One-pole low-pass whose cutoff closes over the tail.
                const a = 0.55 * Math.pow(1 - k, 2) + 0.04
                lp += a * ((Math.random() * 2 - 1) - lp)
                data[i] = lp * Math.pow(1 - k, 2) * Math.exp(-k * 4.2)
            }
        }
        return impulse
    }

    dispose() {
        this.stopEngine()
        this.stopAmbient()
        this.stopCombat()
        void this.ctx?.close()
        this.ctx = null
    }

    // ─── Cue plumbing ──────────────────────────────────────────────────────

    /**
     * One chain per cue, shared by all its layers. Distance rolls the top off,
     * slows the attack, delays the arrival a touch and pushes more of the cue
     * into the reverb, so a kill across the field sits behind the ship instead
     * of on top of it.
     */
    private begin(distance: number, pan: number, send: number) {
        const ctx = this.ctx!
        const input = ctx.createGain()
        const nodes: AudioNode[] = [input]
        let tail: AudioNode = input
        if (distance > 4) {
            const air = ctx.createBiquadFilter()
            air.type = 'lowpass'
            air.Q.value = 0.4
            air.frequency.value = Math.max(500, 18000 / (1 + distance / 60))
            tail.connect(air)
            tail = air
            nodes.push(air)
        }
        if (Math.abs(pan) > 0.02) {
            const panner = ctx.createStereoPanner()
            panner.pan.value = Math.max(-1, Math.min(1, pan))
            tail.connect(panner)
            tail = panner
            nodes.push(panner)
        }
        tail.connect(this.sfxBus)
        const wet = Math.min(0.7, send * (1 + distance / 120))
        if (wet > 0.01) {
            const sendGain = ctx.createGain()
            sendGain.gain.value = wet
            tail.connect(sendGain).connect(this.reverbIn)
            nodes.push(sendGain)
        }
        this.cue = { nodes, pending: 0 }
        this.dest = input
        this.t0 = ctx.currentTime + Math.min(0.12, distance / 2500)
        this.soften = 1 + Math.min(3, distance / 80)
    }

    /** Counts a source as a live voice and tears its chain down when it ends. */
    private hold(src: AudioScheduledSourceNode, ...chain: AudioNode[]) {
        const cue = this.cue
        if (cue) {
            cue.pending++
            this.voices++
        }
        src.onended = () => {
            src.disconnect()
            for (const n of chain) n.disconnect()
            if (!cue) return
            this.voices--
            if (--cue.pending === 0) for (const n of cue.nodes) n.disconnect()
        }
    }

    private env(gain: GainNode, t: number, peak: number, attack: number, decay: number) {
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
    }

    /** An oscillator sweeping f0 → f1 under an attack/decay envelope. */
    private tone(type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number, o: LayerOpts = {}) {
        const ctx = this.ctx!
        const t = this.t0 + (o.delay ?? 0)
        const a = attack * this.soften
        const osc = ctx.createOscillator()
        osc.type = type
        osc.frequency.setValueAtTime(Math.max(1, f0), t)
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + (o.sweep ?? a + decay))
        const g = ctx.createGain()
        this.env(g, t, peak, a, decay)
        osc.connect(g).connect(this.dest)
        osc.start(t)
        osc.stop(t + a + decay + 0.03)
        this.hold(osc, g)
    }

    /**
     * A two-operator FM voice. Inharmonic ratios (1.41, 2.76, 3.5) ring like
     * struck metal or glass; the modulation depth decays with the envelope so
     * the strike is bright and the ring-out is pure.
     */
    private fm(f0: number, f1: number, ratio: number, index: number, peak: number, attack: number, decay: number, o: LayerOpts = {}) {
        const ctx = this.ctx!
        const t = this.t0 + (o.delay ?? 0)
        const a = attack * this.soften
        const end = t + a + decay
        const car = ctx.createOscillator()
        car.frequency.setValueAtTime(Math.max(1, f0), t)
        car.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + (o.sweep ?? a + decay))
        const mod = ctx.createOscillator()
        mod.frequency.setValueAtTime(Math.max(1, f0 * ratio), t)
        mod.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * ratio), t + (o.sweep ?? a + decay))
        const depth = ctx.createGain()
        depth.gain.setValueAtTime(Math.max(1, f0 * ratio * index), t)
        depth.gain.exponentialRampToValueAtTime(1, end)
        mod.connect(depth).connect(car.frequency)
        const g = ctx.createGain()
        this.env(g, t, peak, a, decay)
        car.connect(g).connect(this.dest)
        car.start(t)
        mod.start(t)
        car.stop(end + 0.03)
        mod.stop(end + 0.03)
        this.hold(car, g, mod, depth)
    }

    /** A noise buffer through a sweeping filter. */
    private noise(kind: NoiseKind, filterType: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, decay: number, o: LayerOpts = {}) {
        const ctx = this.ctx!
        const t = this.t0 + (o.delay ?? 0)
        const a = attack * this.soften
        const src = ctx.createBufferSource()
        src.buffer = this.buffers[kind]
        src.loop = true
        src.playbackRate.value = (o.rate ?? 1) * (0.85 + Math.random() * 0.3)
        const filter = ctx.createBiquadFilter()
        filter.type = filterType
        filter.Q.value = q
        filter.frequency.setValueAtTime(Math.min(18000, Math.max(20, f0)), t)
        filter.frequency.exponentialRampToValueAtTime(Math.min(18000, Math.max(20, f1)), t + (o.sweep ?? a + decay))
        const g = ctx.createGain()
        this.env(g, t, peak, a, decay)
        src.connect(filter).connect(g).connect(this.dest)
        src.start(t, Math.random() * 1.5)
        src.stop(t + a + decay + 0.03)
        this.hold(src, filter, g)
    }

    /** The first millisecond of anything that needs to feel like it hit. */
    private click(peak: number, freq = 5000, o: LayerOpts = {}) {
        this.noise('white', 'highpass', freq, freq, 0.7, peak, 0.0005, 0.012, o)
    }

    /**
     * `distance` is 0 for the player's own sounds; world sounds fade out with
     * it. `pan` is -1..1 from the camera's point of view.
     */
    play(sfx: VoidSfx, opts: { distance?: number, pan?: number, pitch?: number, volume?: number } = {}) {
        if (!this.ctx || this.muted) return
        const distance = Math.max(0, opts.distance ?? 0)
        const falloff = 1 / (1 + Math.max(0, distance - 20) / 90)
        let v = (opts.volume ?? 1) * falloff
        if (v < 0.03) return
        // Loud requests get weight from extra layers, not from raw gain.
        if (v > 1) v = Math.min(1.6, 1 + (v - 1) * 0.5)

        const [gap, priority, send] = CUES[sfx]
        const now = this.ctx.currentTime
        if (now - (this.lastPlayed.get(sfx) ?? -10) < gap) return
        if (this.voices > VOICE_CAP[priority]) return
        this.lastPlayed.set(sfx, now)

        // `q` is the pitch the caller asked for; `p` adds the per-shot drift
        // that keeps rapid fire from sounding like one sample on repeat.
        const q = opts.pitch ?? 1
        const p = q * (0.94 + Math.random() * 0.12)
        this.begin(distance, opts.pan ?? 0, send)
        this.voice(sfx, v, p, q, (opts.volume ?? 1) > 1.3)
        const cue = this.cue!
        this.cue = null
        if (cue.pending === 0) for (const n of cue.nodes) n.disconnect()
    }

    private voice(sfx: VoidSfx, v: number, p: number, q: number, huge: boolean) {
        // Timbre drift: filter centres and sweep ends move a little per shot.
        const w = 0.9 + Math.random() * 0.2
        switch (sfx) {
            // ── Weapons ────────────────────────────────────────────────────
            case 'pulse':
                // Tight zap over a sub thump.
                this.click(0.05 * v, 5500)
                this.tone('square', 1400 * p, 260 * p, 0.04 * v, 0.002, 0.09)
                this.tone('sawtooth', 2100 * p * w, 320 * p, 0.022 * v, 0.001, 0.06)
                this.tone('sine', 520 * p, 110 * p, 0.08 * v, 0.002, 0.11)
                this.tone('sine', 150, 50, 0.09 * v, 0.002, 0.09, { sweep: 0.05 })
                this.noise('white', 'bandpass', 2400 * w, 800, 1, 0.02 * v, 0.004, 0.18)
                break
            case 'gun':
                // The ship's own blaster: lower and punchier than a turret pulse.
                this.click(0.06 * v, 4500)
                this.tone('sawtooth', 1700 * p, 280 * p, 0.045 * v, 0.001, 0.075)
                this.tone('sine', 460 * p, 85, 0.1 * v, 0.001, 0.1)
                this.tone('sine', 130, 45, 0.11 * v, 0.002, 0.1, { sweep: 0.05 })
                this.noise('white', 'bandpass', 1800 * w, 600, 0.9, 0.025 * v, 0.003, 0.14)
                break
            case 'gatling': {
                // Mechanical rattle: alternate barrels sit a semitone apart.
                this.gatlingFlip = !this.gatlingFlip
                const b = p * (this.gatlingFlip ? 1 : 0.93)
                this.noise('white', 'bandpass', 2800 * b, 1000, 1.5, 0.085 * v, 0.0008, 0.04)
                this.fm(900 * b, 700 * b, 2.41, 3, 0.035 * v, 0.0008, 0.035)
                this.tone('square', 170 * b, 90, 0.035 * v, 0.001, 0.045)
                this.tone('sine', 110, 60, 0.06 * v, 0.001, 0.05)
                break
            }
            case 'flak':
                // A pop, a thump and a scatter of shrapnel.
                this.click(0.06 * v, 3500)
                this.noise('white', 'lowpass', 3500 * w, 300, 0.7, 0.17 * v, 0.002, 0.15)
                this.tone('triangle', 190 * p, 55, 0.12 * v, 0.002, 0.13)
                this.noise('crackle', 'bandpass', 3000 * p, 1500, 0.8, 0.09 * v, 0.004, 0.28, { delay: 0.02, rate: 1.4 })
                break
            case 'missile':
                // Ignition pop, then the motor whooshes away.
                this.noise('white', 'lowpass', 1200, 200, 0.7, 0.1 * v, 0.002, 0.09)
                this.tone('sine', 70 * p, 42, 0.09 * v, 0.004, 0.22)
                this.noise('white', 'bandpass', 500 * p, 2600 * p, 1.2, 0.1 * v, 0.03, 0.45)
                this.noise('white', 'highpass', 4000, 7000, 0.7, 0.025 * v, 0.05, 0.5)
                this.tone('sawtooth', 160 * p, 420 * p, 0.022 * v, 0.02, 0.32)
                break
            case 'plasma':
                // A heavy, wet blob of energy leaving the barrel.
                this.tone('sine', 240 * p, 70 * p, 0.12 * v, 0.005, 0.3)
                this.fm(180 * p, 90 * p, 0.5, 4, 0.07 * v, 0.005, 0.32)
                this.noise('white', 'bandpass', 700 * w, 300, 2, 0.06 * v, 0.006, 0.26)
                this.tone('sine', 85, 40, 0.1 * v, 0.003, 0.2, { sweep: 0.1 })
                break
            case 'rail':
                // Capacitor whine, a supersonic crack, then the air sizzles shut.
                this.tone('sawtooth', 800 * p, 3200 * p, 0.03 * v, 0.022, 0.01)
                this.click(0.15 * v, 6000, { delay: 0.022 })
                this.tone('sawtooth', 2600 * p, 70, 0.09 * v, 0.001, 0.32, { delay: 0.022 })
                this.tone('sine', 95, 38, 0.22 * v, 0.002, 0.38, { delay: 0.022, sweep: 0.16 })
                this.noise('crackle', 'highpass', 5000, 3000, 0.7, 0.08 * v, 0.01, 0.9, { delay: 0.03, rate: 2 })
                this.noise('white', 'highpass', 7000 * w, 2500, 0.8, 0.05 * v, 0.004, 0.7, { delay: 0.025 })
                break
            case 'mortar':
                // A hollow tube thoonk with real weight under it.
                this.click(0.05 * v, 2500)
                this.tone('sine', 110 * p, 36, 0.24 * v, 0.003, 0.3, { sweep: 0.12 })
                this.noise('white', 'lowpass', 900 * w, 120, 0.7, 0.15 * v, 0.002, 0.17)
                this.noise('white', 'bandpass', 260 * p, 200 * p, 6, 0.12 * v, 0.003, 0.14)
                break
            case 'tesla':
                // Arc crackle over a mains buzz.
                this.noise('crackle', 'bandpass', 3500 * w, 2500, 1, 0.16 * v, 0.001, 0.22, { rate: 2.2 })
                this.fm(1800 * p, 500 * p, 3.7, 8, 0.045 * v, 0.001, 0.08)
                this.tone('sawtooth', 120 * p, 90 * p, 0.035 * v, 0.003, 0.16)
                this.noise('white', 'highpass', 6000, 6000, 0.7, 0.04 * v, 0.001, 0.05)
                break
            case 'enemyShot':
                // Hostile fire is hollow and slightly off, so it never reads as yours.
                this.click(0.025 * v, 3500)
                this.tone('square', 520 * p, 180 * p, 0.035 * v, 0.002, 0.14)
                this.fm(640 * p, 200 * p, 0.5, 3, 0.04 * v, 0.002, 0.13)
                this.tone('sine', 300 * p, 90 * p, 0.04 * v, 0.002, 0.1)
                break
            case 'enemyBeam':
                this.tone('sawtooth', 160, 60, 0.11 * v, 0.005, 0.7)
                this.tone('sawtooth', 161.8, 60.6, 0.08 * v, 0.005, 0.7)
                this.fm(80, 60, 1.5, 6, 0.06 * v, 0.01, 0.7)
                this.noise('white', 'lowpass', 2000, 200, 1, 0.14 * v, 0.005, 0.6)
                this.noise('crackle', 'highpass', 3000, 3000, 0.7, 0.04 * v, 0.01, 0.6, { rate: 1.6 })
                break
            case 'charge':
                this.tone('sawtooth', 120 * p, 900 * p, 0.05 * v, 0.6, 0.15)
                this.tone('sine', 240 * p, 1800 * p, 0.03 * v, 0.6, 0.15)
                this.noise('white', 'highpass', 2000, 8000, 0.7, 0.025 * v, 0.6, 0.1)
                this.noise('crackle', 'bandpass', 2500, 5000, 1, 0.05 * v, 0.55, 0.12, { rate: 1.8 })
                break
            case 'mineArm':
                this.click(0.02 * v, 4000)
                this.tone('square', 1320 * q, 1320 * q, 0.028 * v, 0.002, 0.05)
                this.tone('square', 1760 * q, 1760 * q, 0.022 * v, 0.002, 0.06, { delay: 0.08 })
                break

            // ── Impacts ────────────────────────────────────────────────────
            case 'hit':
                // A small metallic tick.
                this.noise('white', 'bandpass', 3400 * p, 1500, 2, 0.06 * v, 0.001, 0.045)
                this.fm(2100 * p, 1900 * p, 1.41, 2, 0.025 * v, 0.001, 0.06)
                break
            case 'crit':
                // A hard metallic snap that cuts over the normal hit, with a ring.
                this.noise('white', 'bandpass', 4200 * p, 1800, 4, 0.13 * v, 0.001, 0.07)
                this.tone('square', 2400 * p, 900 * p, 0.04 * v, 0.001, 0.09)
                this.fm(3100 * p, 3000 * p, 2.76, 1.5, 0.035 * v, 0.001, 0.26)
                this.tone('sine', 180, 70, 0.08 * v, 0.002, 0.09)
                break
            case 'rockHit':
                // Stone is dull: a knock, some dust, a few chips.
                this.noise('white', 'bandpass', 700 * p, 300, 1.5, 0.07 * v, 0.001, 0.08)
                this.noise('brown', 'lowpass', 400, 150, 0.7, 0.07 * v, 0.002, 0.11)
                this.noise('crackle', 'bandpass', 1800 * p, 1200, 2, 0.05 * v, 0.002, 0.14, { rate: 1.2 })
                this.tone('triangle', 1800 * p, 1400 * p, 0.01 * v, 0.001, 0.05)
                break
            case 'shieldHit':
                // Glassy: a rising sine, an inharmonic ring and a faint hum of field.
                this.noise('white', 'highpass', 5000, 5000, 0.7, 0.02 * v, 0.001, 0.04)
                this.tone('sine', 900 * p, 1500 * p, 0.07 * v, 0.003, 0.18)
                this.fm(1900 * p, 1960 * p, 2.4, 1.2, 0.035 * v, 0.002, 0.3)
                this.tone('sine', 3150 * p, 3150 * p, 0.012 * v, 0.002, 0.26)
                this.tone('sine', 180 * p, 140 * p, 0.04 * v, 0.004, 0.2)
                break
            case 'shieldBreak':
                // Glass under pressure: a bright crack that falls away into a hum.
                this.noise('white', 'bandpass', 5200 * p, 900, 3, 0.16 * v, 0.001, 0.32)
                this.noise('crackle', 'highpass', 4000, 2500, 0.7, 0.1 * v, 0.002, 0.45, { rate: 1.6 })
                this.tone('triangle', 1600 * p, 240 * p, 0.1 * v, 0.002, 0.4)
                this.fm(2300 * p, 1200 * p, 2.76, 2, 0.04 * v, 0.001, 0.3)
                this.tone('sine', 300 * p, 120 * p, 0.08 * v, 0.01, 0.5, { delay: 0.05 })
                break
            case 'shieldDown':
                // Your own shields: the crack, then the field generator spinning down.
                this.noise('white', 'bandpass', 5200, 900, 3, 0.14 * v, 0.001, 0.3)
                this.noise('crackle', 'highpass', 3500, 2000, 0.7, 0.09 * v, 0.002, 0.5, { rate: 1.5 })
                this.tone('sine', 700 * q, 110 * q, 0.1 * v, 0.005, 0.65)
                this.tone('sawtooth', 350 * q, 55 * q, 0.025 * v, 0.005, 0.6)
                this.tone('sine', 90, 40, 0.13 * v, 0.003, 0.3)
                break
            case 'shieldUp':
                // The generator catches again: a soft rising hum with a glint on top.
                this.tone('sine', 220 * q, 660 * q, 0.05 * v, 0.25, 0.35)
                this.fm(880 * q, 1320 * q, 2, 1, 0.025 * v, 0.3, 0.4)
                this.tone('sine', 110 * q, 165 * q, 0.04 * v, 0.2, 0.3)
                break
            case 'hullHit':
                // Plating takes it: crunch, a clang that rings, and a gut punch.
                this.click(0.06 * v, 3000)
                this.noise('white', 'lowpass', 1800 * w, 150, 0.8, 0.2 * v, 0.002, 0.2)
                this.tone('square', 120 * p, 50, 0.06 * v, 0.002, 0.18)
                this.fm(310 * p, 300 * p, 1.41, 5, 0.075 * v, 0.001, 0.38)
                this.fm(520 * p, 505 * p, 2.76, 3, 0.035 * v, 0.001, 0.26)
                this.tone('sine', 80, 38, 0.16 * v, 0.002, 0.16)
                break

            // ── Explosions ─────────────────────────────────────────────────
            case 'explosionSmall':
                this.click(0.08 * v, 3000)
                this.noise('white', 'lowpass', 2800 * p * w, 130, 0.7, 0.26 * v, 0.003, 0.45)
                this.tone('sine', 140 * p, 34, 0.28 * v, 0.003, 0.42, { sweep: 0.2 })
                this.noise('crackle', 'bandpass', 2500 * w, 1200, 0.8, 0.1 * v, 0.01, 0.6, { delay: 0.04 })
                this.noise('brown', 'lowpass', 500, 70, 0.6, 0.16 * v, 0.03, 0.9, { delay: 0.03 })
                break
            case 'explosionLarge':
                // Crack, fireball, a boom that drops through the floor, falling
                // debris and a rumble that rolls across the other side.
                this.click(0.1 * v, 2500)
                this.noise('white', 'lowpass', 1600 * p * w, 45, 0.6, 0.36 * v, 0.005, 1.6)
                this.noise('white', 'bandpass', 3500, 400, 0.8, 0.13 * v, 0.003, 0.5)
                this.tone('sine', 90 * p, 24, 0.4 * v, 0.004, 1.3, { sweep: 0.5 })
                this.noise('crackle', 'bandpass', 2000 * w, 700, 0.7, 0.14 * v, 0.02, 1.4, { delay: 0.08, rate: 0.8 })
                this.noise('brown', 'lowpass', 600, 50, 0.6, 0.3 * v, 0.06, 2.2, { delay: 0.1 })
                if (huge) {
                    // A capital kill: a second, deeper detonation and a long groan.
                    this.tone('sine', 58 * p, 20, 0.3 * v, 0.01, 2.4, { delay: 0.22, sweep: 1.2 })
                    this.noise('white', 'lowpass', 900, 40, 0.6, 0.2 * v, 0.01, 1.8, { delay: 0.22 })
                    this.fm(70 * p, 35 * p, 1.41, 4, 0.08 * v, 0.05, 2.6, { delay: 0.15 })
                    this.noise('crackle', 'bandpass', 1200, 500, 0.7, 0.1 * v, 0.1, 2.4, { delay: 0.5, rate: 0.6 })
                }
                break
            case 'rockBreak':
                // The crack, the collapse, then rubble settling.
                this.click(0.08 * v, 2000)
                this.noise('white', 'lowpass', 1800 * p, 90, 0.6, 0.24 * v, 0.003, 0.55)
                this.tone('sine', 95 * p, 34, 0.2 * v, 0.003, 0.4, { sweep: 0.2 })
                this.noise('crackle', 'bandpass', 900 * w, 500, 0.7, 0.2 * v, 0.02, 0.9, { delay: 0.04, rate: 0.6 })
                this.noise('crackle', 'bandpass', 2600 * w, 1600, 1, 0.07 * v, 0.02, 0.6, { delay: 0.1 })
                this.noise('brown', 'lowpass', 300, 60, 0.6, 0.14 * v, 0.05, 1, { delay: 0.05 })
                break
            case 'death':
                // Reactor failing under the blast: everything winds down and out.
                this.tone('sine', 440, 40, 0.07 * v, 0.02, 1.8)
                this.tone('sawtooth', 220, 30, 0.04 * v, 0.02, 1.6)
                this.noise('crackle', 'bandpass', 3000, 800, 0.8, 0.1 * v, 0.05, 1.6, { delay: 0.2, rate: 1.3 })
                this.noise('brown', 'lowpass', 400, 50, 0.6, 0.3 * v, 0.2, 3, { delay: 0.1 })
                this.tone('sine', 3100, 3000, 0.01 * v, 0.4, 2.4, { delay: 0.2 })
                break

            // ── Ship ───────────────────────────────────────────────────────
            case 'boost':
                // Ignition kick, then the afterburner opens up.
                this.tone('sine', 70, 42, 0.15 * v, 0.003, 0.2)
                this.noise('white', 'lowpass', 900, 200, 0.7, 0.1 * v, 0.002, 0.1)
                this.noise('white', 'bandpass', 300 * p, 1400 * p, 0.7, 0.1 * v, 0.06, 0.6)
                this.noise('white', 'highpass', 3000, 6000, 0.7, 0.025 * v, 0.1, 0.5)
                this.tone('sine', 55 * p, 110 * p, 0.08 * v, 0.06, 0.5)
                break
            case 'boostEnd':
                this.noise('white', 'bandpass', 1200, 250, 0.8, 0.05 * v, 0.02, 0.6)
                this.tone('sine', 100, 50, 0.04 * v, 0.02, 0.5)
                break
            case 'ability':
                this.tone('sine', 120, 50, 0.12 * v, 0.003, 0.2)
                this.tone('sawtooth', 200 * p, 1600 * p, 0.05 * v, 0.02, 0.4)
                this.tone('sine', 400 * p, 3200 * p, 0.06 * v, 0.02, 0.35)
                this.noise('white', 'highpass', 800, 5000, 0.7, 0.07 * v, 0.02, 0.4)
                this.fm(2400 * p, 2400 * p, 3.5, 1, 0.02 * v, 0.004, 0.5, { delay: 0.3 })
                break
            case 'blink':
                // Space folds: a falling chirp, a gasp of air and a shimmer left behind.
                this.tone('sine', 2400 * p, 300 * p, 0.1 * v, 0.002, 0.25)
                this.noise('white', 'bandpass', 6000 * p, 400, 2, 0.11 * v, 0.002, 0.3)
                this.fm(1200 * p, 900 * p, 1.5, 2, 0.035 * v, 0.004, 0.4)
                this.tone('sine', 140 * p, 50 * p, 0.08 * v, 0.003, 0.22)
                break
            case 'lowHull':
                // A soft two-note klaxon over a heartbeat: urgent, never shrill.
                this.tone('sine', 587 * q, 587 * q, 0.055 * v, 0.012, 0.16)
                this.tone('triangle', 1174 * q, 1174 * q, 0.008 * v, 0.012, 0.12)
                this.tone('sine', 440 * q, 440 * q, 0.055 * v, 0.012, 0.22, { delay: 0.17 })
                this.tone('triangle', 880 * q, 880 * q, 0.008 * v, 0.012, 0.16, { delay: 0.17 })
                this.tone('sine', 62, 44, 0.09 * v, 0.004, 0.14)
                this.tone('sine', 58, 42, 0.06 * v, 0.004, 0.14, { delay: 0.17 })
                break

            // ── Pickups and rewards ────────────────────────────────────────
            case 'pickup': {
                // `pitch` climbs with the pickup combo, so no drift here.
                const base = 880 * q
                this.tone('sine', base, base * 1.01, 0.06 * v, 0.003, 0.09)
                this.tone('sine', base * 1.5, base * 1.51, 0.045 * v, 0.003, 0.12, { delay: 0.04 })
                this.fm(base * 2, base * 2, 3, 0.8, 0.012 * v, 0.002, 0.1, { delay: 0.04 })
                break
            }
            case 'cargoFull':
                this.tone('triangle', 440, 440, 0.07 * v, 0.005, 0.12)
                this.tone('sine', 220, 220, 0.04 * v, 0.005, 0.12)
                this.tone('triangle', 330, 330, 0.07 * v, 0.005, 0.2, { delay: 0.14 })
                this.tone('sine', 165, 165, 0.04 * v, 0.005, 0.2, { delay: 0.14 })
                break
            case 'streak':
                // Rises with the streak: `pitch` carries how far in you are.
                this.tone('triangle', 520 * q, 520 * q, 0.06 * v, 0.004, 0.1)
                this.tone('triangle', 780 * q, 780 * q, 0.055 * v, 0.004, 0.16, { delay: 0.07 })
                this.tone('sine', 1560 * q, 1560 * q, 0.015 * v, 0.004, 0.22, { delay: 0.07 })
                break
            case 'rareDrop':
                // Something valuable just fell out: a bell under a slow shimmer.
                this.tone('sine', 1320 * q, 1320 * q, 0.08 * v, 0.004, 0.7)
                this.fm(1320 * q, 1320 * q, 3.5, 1.2, 0.03 * v, 0.002, 0.9)
                this.tone('sine', 1980 * q, 1980 * q, 0.045 * v, 0.01, 0.9, { delay: 0.06 })
                this.tone('triangle', 660 * q, 660 * q, 0.06 * v, 0.006, 0.5, { delay: 0.02 })
                this.noise('white', 'highpass', 3000, 9000, 0.7, 0.04 * v, 0.2, 0.8)
                break
            case 'levelUp':
                // A rising arpeggio with a warm note under it and air on top.
                this.tone('sine', 330 * q, 330 * q, 0.05 * v, 0.01, 0.6)
                this.tone('triangle', 660 * q, 660 * q, 0.075 * v, 0.005, 0.14)
                this.tone('triangle', 990 * q, 990 * q, 0.075 * v, 0.005, 0.2, { delay: 0.09 })
                this.tone('sine', 1320 * q, 1320 * q, 0.06 * v, 0.005, 0.45, { delay: 0.18 })
                this.tone('sine', 1980 * q, 1980 * q, 0.025 * v, 0.005, 0.5, { delay: 0.27 })
                this.noise('white', 'highpass', 5000, 9000, 0.7, 0.015 * v, 0.1, 0.5, { delay: 0.18 })
                break
            case 'bounty':
                // A short brass-like fanfare: a low punch under a rising fifth and octave.
                this.tone('sine', 110, 70, 0.13 * v, 0.004, 0.35)
                this.tone('sawtooth', 392 * q, 392 * q, 0.03 * v, 0.01, 0.16)
                this.tone('sawtooth', 393.5 * q, 393.5 * q, 0.02 * v, 0.01, 0.16)
                this.tone('triangle', 587 * q, 587 * q, 0.065 * v, 0.01, 0.2, { delay: 0.1 })
                this.tone('triangle', 784 * q, 784 * q, 0.075 * v, 0.01, 0.55, { delay: 0.2 })
                this.tone('sawtooth', 785.5 * q, 785.5 * q, 0.015 * v, 0.02, 0.4, { delay: 0.2 })
                this.tone('sine', 1568 * q, 1568 * q, 0.025 * v, 0.02, 0.6, { delay: 0.2 })
                break
            case 'gear':
                // Something heavy clunks into the hold, then a bright shimmer of loot.
                this.noise('white', 'lowpass', 900, 120, 0.8, 0.18 * v, 0.002, 0.25)
                this.fm(240, 230, 1.41, 4, 0.06 * v, 0.001, 0.3)
                this.tone('sine', 180, 60, 0.16 * v, 0.003, 0.3)
                for (let i = 0; i < 4; i++) {
                    const f = 1046 * Math.pow(1.26, i)
                    this.tone('triangle', f, f, 0.04 * v, 0.004, 0.24, { delay: 0.08 + i * 0.06 })
                }
                break

            // ── Station and interface ──────────────────────────────────────
            case 'dock':
                // Clamps take the hull, then the station welcomes you home.
                this.noise('white', 'lowpass', 500, 100, 0.8, 0.1 * v, 0.003, 0.2)
                this.tone('sine', 90, 50, 0.1 * v, 0.003, 0.22)
                this.tone('sine', 523 * q, 523 * q, 0.085 * v, 0.01, 0.35)
                this.tone('sine', 659 * q, 659 * q, 0.085 * v, 0.01, 0.35, { delay: 0.12 })
                this.tone('sine', 784 * q, 784 * q, 0.085 * v, 0.01, 0.6, { delay: 0.24 })
                this.tone('sine', 1046 * q, 1046 * q, 0.07 * v, 0.01, 0.9, { delay: 0.36 })
                this.tone('triangle', 261.5 * q, 261.5 * q, 0.04 * v, 0.05, 1.1)
                break
            case 'undock':
                // Clamps release and the drive spools up into open space.
                this.noise('white', 'bandpass', 1500, 900, 1.2, 0.07 * v, 0.002, 0.06)
                this.noise('white', 'lowpass', 200 * p, 3000 * p, 0.8, 0.18 * v, 0.3, 1.2)
                this.noise('brown', 'lowpass', 150, 400, 0.6, 0.16 * v, 0.2, 1.1)
                this.tone('sawtooth', 50 * p, 180 * p, 0.05 * v, 0.3, 1.2)
                this.tone('sine', 100 * p, 400 * p, 0.035 * v, 0.4, 1)
                break
            case 'ui':
                // One soft tick shared by every button and tab.
                this.click(0.012 * v, 4000)
                this.tone('sine', 1500 * q, 1200 * q, 0.035 * v, 0.002, 0.05)
                break
            case 'uiConfirm':
                this.tone('sine', 880 * q, 880 * q, 0.055 * v, 0.003, 0.08)
                this.tone('sine', 1320 * q, 1320 * q, 0.055 * v, 0.003, 0.15, { delay: 0.07 })
                this.tone('triangle', 440 * q, 440 * q, 0.02 * v, 0.003, 0.18)
                break
            case 'uiError':
                // A muted double knock, a whole tone down: clearly no, never harsh.
                this.tone('triangle', 196 * q, 190 * q, 0.075 * v, 0.003, 0.1)
                this.tone('triangle', 174.6 * q, 165 * q, 0.075 * v, 0.003, 0.16, { delay: 0.1 })
                this.tone('sine', 98 * q, 95 * q, 0.04 * v, 0.003, 0.2)
                break
            case 'warning':
                // Two clean pips. `pitch` is meaningful here, so it is not drifted.
                for (const delay of [0, 0.2]) {
                    this.tone('sine', 740 * q, 740 * q, 0.06 * v, 0.005, 0.12, { delay })
                    this.tone('triangle', 1480 * q, 1480 * q, 0.014 * v, 0.005, 0.1, { delay })
                    this.tone('square', 740 * q, 740 * q, 0.012 * v, 0.005, 0.1, { delay })
                }
                break
            case 'wardenAlert':
                // The arrival sting: a gong in the deep, then three brass swells
                // with a tritone leaning on them.
                this.tone('sine', 55 * q, 34 * q, 0.16 * v, 0.01, 0.9)
                this.fm(82 * q, 80 * q, 1.41, 6, 0.08 * v, 0.004, 2.2)
                for (let i = 0; i < 3; i++) {
                    const delay = i * 0.55
                    this.tone('sawtooth', 110 * q, 90 * q, 0.085 * v, 0.03, 0.5, { delay })
                    this.tone('sawtooth', 110.9 * q, 90.7 * q, 0.05 * v, 0.03, 0.5, { delay })
                    this.tone('square', 220 * q, 180 * q, 0.025 * v, 0.03, 0.45, { delay })
                    this.tone('sawtooth', 155.6 * q, 127.3 * q, 0.03 * v, 0.05, 0.45, { delay })
                }
                break
        }
    }

    // ─── Continuous layers ─────────────────────────────────────────────────

    startEngine() {
        if (!this.ctx || this.engineOsc) return
        const ctx = this.ctx
        // A soft, low drive: brown-noise rumble that slowly breathes, a sine
        // sub, a quiet detuned hum and a narrow turbine whistle that climbs
        // with the throttle. No raw sawtooth, so nothing buzzes.
        this.engineGain = ctx.createGain()
        this.engineGain.gain.value = 0.0001
        this.engineGain.connect(this.sfxBus)
        const body = ctx.createBiquadFilter()
        body.type = 'lowpass'
        body.frequency.value = 1800
        body.Q.value = 0.3
        body.connect(this.engineGain)

        const noise = ctx.createBufferSource()
        noise.buffer = this.buffers.brown
        noise.loop = true
        this.engineFilter = ctx.createBiquadFilter()
        this.engineFilter.type = 'lowpass'
        this.engineFilter.frequency.value = 220
        this.engineFilter.Q.value = 0.5
        const rumble = ctx.createGain()
        rumble.gain.value = 0.4
        noise.connect(this.engineFilter).connect(rumble).connect(body)
        const breath = ctx.createOscillator()
        breath.frequency.value = 0.23
        const breathDepth = ctx.createGain()
        breathDepth.gain.value = 0.09
        breath.connect(breathDepth).connect(rumble.gain)

        this.engineOsc = ctx.createOscillator()
        this.engineOsc.type = 'sine'
        this.engineOsc.frequency.value = 40
        const sub = ctx.createGain()
        sub.gain.value = 0.35
        this.engineOsc.connect(sub).connect(body)

        // Big hulls add a sub-octave under the drive.
        this.heftOsc = ctx.createOscillator()
        this.heftOsc.type = 'sine'
        this.heftOsc.frequency.value = 28
        this.heftGain = ctx.createGain()
        this.heftGain.gain.value = 0
        this.heftOsc.connect(this.heftGain).connect(body)

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
        this.humFilter.connect(hum).connect(body)
        this.humDetune = hum2

        // The turbine skips the body filter or it would never be heard.
        const whistle = ctx.createBufferSource()
        whistle.buffer = this.buffers.white
        whistle.loop = true
        this.turbineFilter = ctx.createBiquadFilter()
        this.turbineFilter.type = 'bandpass'
        this.turbineFilter.frequency.value = 900
        this.turbineFilter.Q.value = 7
        this.turbineGain = ctx.createGain()
        this.turbineGain.gain.value = 0.5
        whistle.connect(this.turbineFilter).connect(this.turbineGain).connect(this.engineGain)

        // Boost is a breathy airflow layer that fades in, not a pitch whine.
        const air = ctx.createBufferSource()
        air.buffer = this.buffers.white
        air.loop = true
        air.playbackRate.value = 0.8
        const airFilter = ctx.createBiquadFilter()
        airFilter.type = 'bandpass'
        airFilter.frequency.value = 700
        airFilter.Q.value = 0.7
        this.boostGain = ctx.createGain()
        this.boostGain.gain.value = 0
        air.connect(airFilter).connect(this.boostGain).connect(this.engineGain)

        // Beam weapons: two saws a fifth apart through a vocal band-pass, with
        // a fast tremolo and a little sizzle so it sounds like it is burning.
        this.beamOsc = ctx.createOscillator()
        this.beamOsc.type = 'sawtooth'
        this.beamOsc.frequency.value = 120
        const beamFifth = ctx.createOscillator()
        beamFifth.type = 'sawtooth'
        beamFifth.frequency.value = 180.9
        const bf = ctx.createBiquadFilter()
        bf.type = 'bandpass'
        bf.frequency.value = 800
        bf.Q.value = 3
        const sizzle = ctx.createBufferSource()
        sizzle.buffer = this.buffers.crackle
        sizzle.loop = true
        sizzle.playbackRate.value = 2.4
        const sizzleCut = ctx.createBiquadFilter()
        sizzleCut.type = 'highpass'
        sizzleCut.frequency.value = 4000
        const sizzleGain = ctx.createGain()
        sizzleGain.gain.value = 0.5
        const tremolo = ctx.createGain()
        tremolo.gain.value = 0.75
        const flutter = ctx.createOscillator()
        flutter.frequency.value = 31
        const flutterDepth = ctx.createGain()
        flutterDepth.gain.value = 0.25
        flutter.connect(flutterDepth).connect(tremolo.gain)
        this.beamGain = ctx.createGain()
        this.beamGain.gain.value = 0
        this.beamOsc.connect(bf)
        beamFifth.connect(bf)
        bf.connect(tremolo)
        sizzle.connect(sizzleCut).connect(sizzleGain).connect(tremolo)
        tremolo.connect(this.beamGain).connect(this.sfxBus)

        const now = ctx.currentTime
        this.droneNodes = [noise, breath, this.engineOsc, this.heftOsc, this.engineOsc2, hum2, whistle, air, this.beamOsc, beamFifth, sizzle, flutter]
        for (const n of this.droneNodes) n.start(now)
        this.engineGraph = [this.engineGain, this.beamGain, body, rumble, tremolo]
        this.wasBoosting = false
    }

    /** throttle 0..1; boosting opens the airflow layer. heft 0..1 drops a big hull's drive into a deeper, louder rumble. */
    updateEngine(throttle: number, boosting: boolean, beams: number, heft = 0) {
        if (!this.ctx || !this.engineOsc || !this.engineGain || !this.engineFilter) return
        const t = this.ctx.currentTime
        const k = Math.max(0, Math.min(1, Number.isFinite(throttle) ? throttle : 0))
        const h = Math.max(0, Math.min(1, Number.isFinite(heft) ? heft : 0))
        const deep = 1 - h * 0.38
        this.engineGain.gain.setTargetAtTime((0.035 + k * 0.03 + (boosting ? 0.02 : 0)) * (1 + h * 0.7), t, 0.25)
        this.engineFilter.frequency.setTargetAtTime((170 + k * 230 + (boosting ? 260 : 0)) * deep, t, 0.3)
        const sub = (38 + k * 8 + (boosting ? 6 : 0)) * (1 - h * 0.2)
        this.engineOsc.frequency.setTargetAtTime(sub, t, 0.4)
        this.heftOsc?.frequency.setTargetAtTime(sub * 0.5 + 9, t, 0.4)
        this.heftGain?.gain.setTargetAtTime(h * 0.4, t, 0.5)
        const hum = (76 + k * 22 + (boosting ? 14 : 0)) * deep
        this.engineOsc2!.frequency.setTargetAtTime(hum, t, 0.4)
        this.humDetune?.frequency.setTargetAtTime(hum * 1.008, t, 0.4)
        this.humFilter?.frequency.setTargetAtTime((240 + k * 160) * deep, t, 0.3)
        this.turbineFilter?.frequency.setTargetAtTime((800 + k * 1500 + (boosting ? 700 : 0)) * deep, t, 0.5)
        this.turbineGain?.gain.setTargetAtTime(0.4 + k * 1.6 + (boosting ? 0.8 : 0), t, 0.4)
        this.boostGain?.gain.setTargetAtTime(boosting ? 0.45 : 0, t, boosting ? 0.18 : 0.35)
        this.beamGain!.gain.setTargetAtTime(Math.min(0.05, Math.max(0, beams) * 0.018), t, 0.05)
        if (this.wasBoosting && !boosting) this.play('boostEnd')
        this.wasBoosting = boosting
    }

    stopEngine() {
        for (const n of this.droneNodes) {
            try {
                n.stop()
            } catch {
                // already stopped
            }
            n.disconnect()
        }
        for (const n of this.engineGraph) n.disconnect()
        this.engineOsc = this.engineOsc2 = this.beamOsc = this.humDetune = this.heftOsc = null
        this.engineGain = this.beamGain = this.boostGain = this.heftGain = this.turbineGain = null
        this.engineFilter = this.humFilter = this.turbineFilter = null
        this.droneNodes = []
        this.engineGraph = []
        this.wasBoosting = false
    }

    // ─── Combat pulse ──────────────────────────────────────────────────────
    // A sequenced groove that grows with the fight instead of just getting
    // louder: a syncopated bass and half-time kick first, then hats, a pad
    // and a wandering arpeggio, and a backbeat only when it is truly hot. It
    // walks a four-chord loop (i, i, VI, VII) in the sector's key. Notes are
    // scheduled a little ahead on the audio clock so timing stays tight.
    private combatGain: GainNode | null = null
    private arpPans: StereoPannerNode[] = []
    private combatTarget = 0
    private nextBeat = 0
    private beat = 0
    private phrase = 0
    private combatRoot = 55

    setCombat(intensity: number) {
        if (!this.ctx) return
        this.combatTarget = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0))
        if (!this.combatGain) {
            const ctx = this.ctx
            this.combatGain = ctx.createGain()
            this.combatGain.gain.value = 0
            this.combatGain.connect(this.musicBus)
            const send = ctx.createGain()
            send.gain.value = 0.2
            this.combatGain.connect(send).connect(this.reverbIn)
            this.arpPans = [-0.35, 0.35].map((pan) => {
                const node = ctx.createStereoPanner()
                node.pan.value = pan
                node.connect(this.combatGain!)
                return node
            })
            this.nextBeat = ctx.currentTime + 0.1
        }
        const t = this.ctx.currentTime
        this.combatGain.gain.setTargetAtTime(this.combatTarget * 0.9, t, this.combatTarget > this.combatGain.gain.value ? 0.6 : 2.5)
        // The pad steps back while the fight has the floor.
        this.ambientGain?.gain.setTargetAtTime(1 - this.combatTarget * 0.45, t, 1.5)
        if (this.combatGain.gain.value < 0.01 && this.combatTarget === 0) return
        const step = 60 / 116 / 2
        // Coming out of a lull the clock is minutes behind; restart it rather
        // than scheduling every missed beat into the past at once.
        if (this.nextBeat < t) {
            this.nextBeat = t + 0.05
            this.beat = 0
        }
        while (this.nextBeat < t + 0.2) {
            this.scheduleBeat(this.nextBeat, this.beat, step)
            this.nextBeat += step
            this.beat = (this.beat + 1) % 16
            if (this.beat === 0) this.phrase = (this.phrase + 1) % 4
        }
    }

    /** One music voice: source → optional low-pass → envelope → out. */
    private note(out: AudioNode, src: AudioScheduledSourceNode, t: number, peak: number, attack: number, decay: number, cutoff?: [number, number]) {
        const ctx = this.ctx!
        const g = ctx.createGain()
        this.env(g, t, peak, attack, decay)
        let filter: BiquadFilterNode | null = null
        if (cutoff) {
            filter = ctx.createBiquadFilter()
            filter.type = 'lowpass'
            filter.frequency.setValueAtTime(cutoff[0], t)
            filter.frequency.exponentialRampToValueAtTime(cutoff[1], t + attack + decay)
            src.connect(filter).connect(g)
        } else {
            src.connect(g)
        }
        g.connect(out)
        src.onended = () => {
            src.disconnect()
            filter?.disconnect()
            g.disconnect()
        }
        src.stop(t + attack + decay + 0.03)
    }

    private musicOsc(type: OscillatorType, f0: number, f1: number, t: number, sweep: number) {
        const osc = this.ctx!.createOscillator()
        osc.type = type
        osc.frequency.setValueAtTime(f0, t)
        if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + sweep)
        osc.start(t)
        return osc
    }

    private musicNoise(t: number) {
        const src = this.ctx!.createBufferSource()
        src.buffer = this.buffers.white
        src.loop = true
        src.start(t, Math.random() * 1.5)
        return src
    }

    private scheduleBeat(t: number, i: number, step: number) {
        const ctx = this.ctx!
        const out = this.combatGain!
        const heat = this.combatTarget
        const chord = [0, 0, -4, -2][this.phrase]!
        const major = chord !== 0
        const root = this.combatRoot * Math.pow(2, chord / 12)

        // Bass: a syncopated 3-3-2 figure, root with a fifth and an octave pickup.
        const bass = ({ 0: 0, 3: 0, 6: 7, 8: 0, 11: 0, 14: 12 } as Record<number, number>)[i]
        if (bass !== undefined) {
            const f = root * Math.pow(2, bass / 12)
            const open = 500 + heat * 700
            this.note(out, this.musicOsc('sawtooth', f, f, t, 0), t, 0.17, 0.008, 0.3, [open, 110])
            this.note(out, this.musicOsc('sine', f, f, t, 0), t, 0.16, 0.008, 0.28)
        }
        // Kick: half-time while it simmers, four on the floor once it boils.
        if (i % 8 === 0 || (heat > 0.3 && i % 4 === 0)) {
            this.note(out, this.musicOsc('sine', 115, 42, t, 0.11), t, 0.3, 0.002, 0.2)
        }
        // Closed hats on the off-beats, accented every other one.
        if (heat > 0.35 && i % 2 === 1) {
            const hat = ctx.createBiquadFilter()
            hat.type = 'highpass'
            hat.frequency.value = 7500
            const src = this.musicNoise(t)
            src.connect(hat)
            const g = ctx.createGain()
            this.env(g, t, i % 4 === 3 ? 0.045 : 0.028, 0.001, i === 15 && heat > 0.7 ? 0.16 : 0.04)
            hat.connect(g).connect(out)
            src.onended = () => {
                src.disconnect()
                hat.disconnect()
                g.disconnect()
            }
            src.stop(t + 0.22)
        }
        // Backbeat: a soft clap only when the fight is at full heat.
        if (heat > 0.7 && (i === 4 || i === 12)) {
            const band = ctx.createBiquadFilter()
            band.type = 'bandpass'
            band.frequency.value = 1700
            band.Q.value = 0.9
            const src = this.musicNoise(t)
            src.connect(band)
            const g = ctx.createGain()
            this.env(g, t, 0.09, 0.002, 0.13)
            band.connect(g).connect(out)
            src.onended = () => {
                src.disconnect()
                band.disconnect()
                g.disconnect()
            }
            src.stop(t + 0.18)
            this.note(out, this.musicOsc('triangle', 190, 120, t, 0.08), t, 0.05, 0.002, 0.1)
        }
        // Pad: the chord, held under each two-bar phrase.
        if (heat > 0.25 && i === 0) {
            const hold = step * 16
            for (const semis of [0, major ? 4 : 3, 7]) {
                const f = root * 4 * Math.pow(2, semis / 12)
                const osc = this.musicOsc('triangle', f, f, t, 0)
                osc.detune.value = (semis - 3) * 2
                this.note(out, osc, t, 0.022, hold * 0.35, hold * 0.75, [900, 500])
            }
        }
        // Arpeggio: plucks that skip a different third of the steps each bar,
        // so the line never settles into a loop the ear can count.
        if (heat > 0.5 && (i * 5 + this.phrase * 2) % 3 !== 0) {
            const shape = major ? [0, 7, 12, 16, 19, 16, 12, 7] : [0, 7, 12, 15, 19, 15, 12, 7]
            const f = root * 4 * Math.pow(2, shape[i % 8]! / 12)
            this.note(this.arpPans[i % 2]!, this.musicOsc('triangle', f, f, t, 0), t, 0.04, 0.004, 0.24, [2400, 600])
        }
    }

    stopCombat() {
        if (this.combatGain && this.ctx) this.combatGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3)
        this.combatTarget = 0
    }

    private ambientNodes: AudioScheduledSourceNode[] = []
    private ambientGain: GainNode | null = null

    /**
     * A slow pad in the sector's key for quiet flight. Every voice swells on
     * its own slow cycle, so the chord keeps changing colour (root and fifth
     * one minute, the minor third and ninth the next) without ever moving,
     * and a band of filtered wind drifts underneath. Mostly reverb.
     */
    startAmbient(root = 55) {
        this.combatRoot = root
        if (!this.ctx || this.ambientGain) return
        const ctx = this.ctx
        this.ambientGain = ctx.createGain()
        this.ambientGain.gain.value = 0
        this.ambientGain.gain.setTargetAtTime(1, ctx.currentTime, 2)
        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = 750
        filter.Q.value = 0.5
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 0.05
        const lfoGain = ctx.createGain()
        lfoGain.gain.value = 350
        lfo.connect(lfoGain).connect(filter.frequency)
        lfo.start()
        this.ambientNodes.push(lfo)
        // [ratio to root, detune cents, level, swell rate Hz]
        const voices = [
            [0.5, 0, 0.09, 0.031], [1, -6, 0.1, 0.043], [1.5, 5, 0.06, 0.057], [2, 3, 0.045, 0.037],
            [2.378, -3, 0.03, 0.071], [3, -4, 0.02, 0.049], [3.564, 4, 0.016, 0.083], [4.49, 0, 0.012, 0.061], [8, 2, 0.005, 0.023]
        ] as const
        for (const [ratio, detune, level, rate] of voices) {
            const osc = ctx.createOscillator()
            osc.type = ratio >= 2 ? 'sine' : 'triangle'
            osc.frequency.value = root * ratio
            osc.detune.value = detune
            const g = ctx.createGain()
            g.gain.value = level
            const swell = ctx.createOscillator()
            swell.frequency.value = rate
            const depth = ctx.createGain()
            depth.gain.value = level * (ratio <= 1 ? 0.4 : 0.85)
            swell.connect(depth).connect(g.gain)
            osc.connect(g).connect(filter)
            osc.start()
            swell.start()
            this.ambientNodes.push(osc, swell)
        }
        const wind = ctx.createBufferSource()
        wind.buffer = this.buffers.brown
        wind.loop = true
        const windBand = ctx.createBiquadFilter()
        windBand.type = 'bandpass'
        windBand.frequency.value = 420
        windBand.Q.value = 1.4
        const drift = ctx.createOscillator()
        drift.frequency.value = 0.017
        const driftDepth = ctx.createGain()
        driftDepth.gain.value = 240
        drift.connect(driftDepth).connect(windBand.frequency)
        const windGain = ctx.createGain()
        windGain.gain.value = 0.22
        wind.connect(windBand).connect(windGain).connect(this.ambientGain)
        wind.start()
        drift.start()
        this.ambientNodes.push(wind, drift)

        filter.connect(this.ambientGain).connect(this.musicBus)
        const send = ctx.createGain()
        send.gain.value = 0.5
        this.ambientGain.connect(send).connect(this.reverbIn)
    }

    stopAmbient() {
        if (!this.ctx || !this.ambientGain) return
        const g = this.ambientGain
        g.gain.cancelScheduledValues(this.ctx.currentTime)
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4)
        const nodes = this.ambientNodes
        setTimeout(() => {
            for (const n of nodes) {
                try {
                    n.stop()
                } catch {
                    // already stopped
                }
                n.disconnect()
            }
            g.disconnect()
        }, 2000)
        this.ambientNodes = []
        this.ambientGain = null
    }
}
