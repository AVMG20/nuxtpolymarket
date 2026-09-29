// Call of Xeno — synthesised audio engine.
//
// Everything is generated live with the Web Audio API: no samples, nothing to
// download. The engine is built like a small mixing desk.
//
//   voice ──> [distance low-pass] ──┬── dry ──> pan ──> dry bus ──> duck ──┐
//                                   ├── send ─> warehouse convolution ─────┤
//                                   └── send ─> slapback echoes ───────────┤
//   ambience / music ──> bed bus ──────────────────────────> duck ─────────┤
//   priority voices (explosions, stingers) ──> priority bus (never ducked) ─┤
//                                                                           v
//                           health low-pass ─> glue compressor ─> master ─> limiter ─> out
//
// Randomness in here is purely cosmetic (pitch and timing variation per shot),
// never an outcome.

export type CallOfXenoSound
    = | 'shoot-pistol'
      | 'shoot-magnum'
      | 'shoot-shotgun'
      | 'shoot-smg'
      | 'shoot-rifle'
      | 'shoot-sniper'
      | 'shoot-lmg'
      | 'shoot-launcher'
      | 'shoot-wonder'
      | 'shotgun-pump'
      | 'dry-fire'
      | 'reload-start'
      | 'reload-end'
      | 'reload-mag-out'
      | 'reload-mag-in'
      | 'reload-rack'
      | 'reload-shell'
      | 'hit'
      | 'headshot'
      | 'hitmarker'
      | 'kill'
      | 'gore-splat'
      | 'body-thud'
      | 'zombie-groan'
      | 'zombie-snarl'
      | 'zombie-attack'
      | 'zombie-screech'
      | 'zombie-death'
      | 'xeno-call'
      | 'hurt'
      | 'melee'
      | 'melee-hit'
      | 'footstep'
      | 'footstep-concrete'
      | 'footstep-metal'
      | 'jump'
      | 'land'
      | 'heartbeat'
      | 'explosion'
      | 'buy'
      | 'deny'
      | 'door'
      | 'power'
      | 'papunch'
      | 'papunch-grind'
      | 'papunch-chime'
      | 'perk'
      | 'powerup-spawn'
      | 'powerup-pickup'
      | 'powerup-expire'
      | 'round-start'
      | 'round-end'
      | 'death'
      | 'board-break'
      | 'board-repair'
      | 'climb-in'
      | 'box-open'
      | 'box-tick'

/** Weapon families with their own reload choreography. */
export type CallOfXenoWeaponClass = 'pistol' | 'magnum' | 'smg' | 'rifle' | 'sniper' | 'lmg' | 'shotgun' | 'launcher' | 'wonder'

type Vowel = 'a' | 'o' | 'u' | 'e' | 'i' | 'ae'
type NoiseKind = 'white' | 'pink' | 'brown' | 'crackle'

/** First three formant centres of each vowel, in Hz. */
const VOWELS: Record<Vowel, readonly [number, number, number]> = {
    a: [800, 1150, 2800],
    o: [450, 800, 2830],
    u: [325, 700, 2530],
    e: [400, 1600, 2700],
    i: [270, 2140, 2950],
    ae: [660, 1720, 2410]
}
const FORMANT_Q = [6, 8, 10] as const
const FORMANT_GAIN = [1, 0.65, 0.35] as const

const MAX_VOICES = 32
const MASTER_LEVEL = 0.8

/** Minimum seconds between two plays of the same effect (pellets, multi-hits, spam). */
const THROTTLE: Partial<Record<CallOfXenoSound, number>> = {
    'hit': 0.035,
    'headshot': 0.04,
    'hitmarker': 0.03,
    'kill': 0.06,
    'gore-splat': 0.05,
    'body-thud': 0.05,
    'zombie-groan': 0.09,
    'zombie-snarl': 0.09,
    'zombie-attack': 0.08,
    'zombie-death': 0.07,
    'melee-hit': 0.05,
    'footstep': 0.05,
    'footstep-concrete': 0.05,
    'footstep-metal': 0.05,
    'board-break': 0.08,
    'board-repair': 0.08,
    'climb-in': 0.1,
    'buy': 0.05,
    'deny': 0.1,
    'powerup-pickup': 0.1
}

// Cosmetic randomness helpers.
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const chance = (p: number) => Math.random() < p
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))

function makeCurve(drive: number) {
    const n = 1024
    const curve = new Float32Array(n)
    const norm = Math.tanh(drive)
    for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1
        curve[i] = Math.tanh(x * drive) / norm
    }
    return curve
}

/** Sharpens a sine LFO into a heartbeat-like pulse (0..1). */
function makePulseCurve() {
    const n = 1024
    const curve = new Float32Array(n)
    for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1
        const y = Math.max(0, (x - 0.25) / 0.75)
        curve[i] = y * y
    }
    return curve
}

interface Voice {
    /** Every layer of this sound connects here. */
    input: GainNode
    /** Context time the sound was started; every layer offset is relative to it. */
    t0: number
    /** Shared nodes (buses, filters) that get disconnected with the voice. */
    nodes: AudioNode[]
    sources: AudioScheduledSourceNode[]
    pending: number
    sticky: boolean
    tag: string
    released: boolean
}

interface VoiceOpts {
    pan?: number
    dist?: number
    /** Reverb send. */
    wet?: number
    /** Slapback echo send (gunshots). */
    slap?: number
    level?: number
    /** Bypasses the duck (explosions, stingers). */
    priority?: boolean
    /** Not chosen for voice stealing unless nothing else is left. */
    sticky?: boolean
    tag?: string
    delay?: number
}

interface NoiseOpts {
    at?: number
    dur: number
    gain: number
    type?: BiquadFilterType
    freq: number
    freqEnd?: number
    sweep?: number
    q?: number
    hp?: number
    buf?: NoiseKind
    attack?: number
    hold?: number
    rate?: number
    /** Amplitude modulation: rate in Hz and depth 0..1 (rolling shutter, buzz). */
    am?: { rate: number, depth: number }
}

interface ToneOpts {
    at?: number
    dur: number
    gain: number
    freq: number
    freqEnd?: number
    /** How long the pitch takes to fall/rise to `freqEnd` (defaults to dur). */
    pitchTime?: number
    type?: OscillatorType
    attack?: number
    hold?: number
    detune?: number
    filter?: { type: BiquadFilterType, freq: number, freqEnd?: number, q?: number }
    vib?: { rate: number, depth: number }
    drive?: number
}

interface GrowlOpts {
    at?: number
    dur: number
    gain: number
    f0: number
    f0End?: number
    pitchTime?: number
    from: Vowel
    to?: Vowel
    /** Scales the formants: <1 is a bigger, more monstrous mouth. */
    scale?: number
    vib?: number
    vibDepth?: number
    rasp?: number
    raspDepth?: number
    drive?: number
    breath?: number
    attack?: number
    hold?: number
    sub?: number
}

interface PadOpts {
    at?: number
    dur: number
    gain: number
    freqs: number[]
    type?: OscillatorType
    lpFrom: number
    lpPeak: number
    lpTo: number
    attack: number
    hold: number
    detune?: number
}

export class CallOfXenoAudio {
    private ctx: AudioContext | null = null
    private master: GainNode | null = null
    private limiter: DynamicsCompressorNode | null = null
    private glue: DynamicsCompressorNode | null = null
    private tone: BiquadFilterNode | null = null
    private duckGain: GainNode | null = null
    private dryBus: GainNode | null = null
    private priorityBus: GainNode | null = null
    private bedBus: GainNode | null = null
    private reverbIn: GainNode | null = null
    private slapIn: GainNode | null = null
    private graph: AudioNode[] = []

    private buffers: Partial<Record<NoiseKind, AudioBuffer>> = {}
    private curves = new Map<number, Float32Array<ArrayBuffer>>()
    private pulseCurve: Float32Array<ArrayBuffer> | null = null
    private voices: Voice[] = []
    private lastPlayed = new Map<string, number>()
    private muted = false
    private lowHealth = 0
    private nyq = 20000

    // Ambience / music state
    private wantAmbience = false
    private powerOn = false
    private intensity = 0
    private ambSources: AudioScheduledSourceNode[] = []
    private ambNodes: AudioNode[] = []
    private ambBus: GainNode | null = null
    private ambTimer: ReturnType<typeof setTimeout> | null = null
    private ambStopTimer: ReturnType<typeof setTimeout> | null = null
    private ambLastCall = 0
    private padGain: GainNode | null = null
    private tenseGain: GainNode | null = null
    private pulseGain: GainNode | null = null
    private pulseLfo: OscillatorNode | null = null
    private droneGain: GainNode | null = null
    private humGain: GainNode | null = null
    private genGain: GainNode | null = null
    private genOscs: OscillatorNode[] = []
    private buzzGain: GainNode | null = null

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /** Must be called from a user gesture — browsers refuse to start audio otherwise. */
    start() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') void this.ctx.resume()
            // A new run starts with a clear head.
            this.lowHealth = 0
            this.applyTone(0.05)
            return
        }
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        const ctx = new Ctor({ latencyHint: 'interactive' })
        this.ctx = ctx
        this.nyq = ctx.sampleRate / 2 - 200
        this.buildGraph(ctx)
        this.buildNoise(ctx)
        if (this.wantAmbience) this.startAmbience()
    }

    /** Suspends the whole engine (pause menu, hidden tab). */
    pause() {
        if (this.ctx?.state === 'running') void this.ctx.suspend()
    }

    resume() {
        if (this.ctx?.state === 'suspended') void this.ctx.resume()
    }

    setMuted(muted: boolean) {
        this.muted = muted
        if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, this.ctx.currentTime, 0.02)
    }

    isMuted() {
        return this.muted
    }

    dispose() {
        this.wantAmbience = false
        if (this.ambTimer) clearTimeout(this.ambTimer)
        if (this.ambStopTimer) clearTimeout(this.ambStopTimer)
        this.ambTimer = null
        this.ambStopTimer = null
        for (const v of [...this.voices]) this.release(v)
        this.voices = []
        for (const s of this.ambSources) {
            try {
                s.stop()
            } catch { /* already stopped */ }
        }
        for (const n of [...this.ambNodes, ...this.graph]) {
            try {
                n.disconnect()
            } catch { /* already disconnected */ }
        }
        this.ambSources = []
        this.ambNodes = []
        this.graph = []
        this.genOscs = []
        this.ambBus = this.padGain = this.tenseGain = this.pulseGain = this.droneGain = null
        this.humGain = this.genGain = this.buzzGain = null
        this.pulseLfo = null
        void this.ctx?.close()
        this.ctx = null
        this.master = this.limiter = this.glue = this.tone = this.duckGain = null
        this.dryBus = this.priorityBus = this.bedBus = this.reverbIn = this.slapIn = null
        this.buffers = {}
        this.curves.clear()
        this.pulseCurve = null
        this.lastPlayed.clear()
    }

    // -----------------------------------------------------------------------
    // Graph construction
    // -----------------------------------------------------------------------

    private buildGraph(ctx: AudioContext) {
        const g = this.graph
        const add = <T extends AudioNode>(n: T): T => {
            g.push(n)
            return n
        }

        const limiter = add(ctx.createDynamicsCompressor())
        limiter.threshold.value = -3
        limiter.knee.value = 0
        limiter.ratio.value = 20
        limiter.attack.value = 0.001
        limiter.release.value = 0.09
        limiter.connect(ctx.destination)

        const master = add(ctx.createGain())
        master.gain.value = this.muted ? 0 : MASTER_LEVEL
        master.connect(limiter)

        // Glue: gently pulls the whole mix together so gunfire feels dense.
        const glue = add(ctx.createDynamicsCompressor())
        glue.threshold.value = -20
        glue.knee.value = 12
        glue.ratio.value = 3.5
        glue.attack.value = 0.012
        glue.release.value = 0.22
        glue.connect(master)

        // Health / hurt muffle.
        const tone = add(ctx.createBiquadFilter())
        tone.type = 'lowpass'
        tone.frequency.value = this.nyq
        tone.Q.value = 0.707
        tone.connect(glue)

        const duck = add(ctx.createGain())
        duck.connect(tone)

        const dryBus = add(ctx.createGain())
        dryBus.connect(duck)
        const bedBus = add(ctx.createGain())
        bedBus.connect(duck)
        const priorityBus = add(ctx.createGain())
        priorityBus.connect(tone)

        // Warehouse reverb.
        const reverbIn = add(ctx.createGain())
        const preDelay = add(ctx.createDelay(0.1))
        preDelay.delayTime.value = 0.018
        const convolver = add(ctx.createConvolver())
        convolver.buffer = this.makeImpulse(ctx)
        const reverbOut = add(ctx.createGain())
        reverbOut.gain.value = 0.9
        reverbIn.connect(preDelay)
        preDelay.connect(convolver)
        convolver.connect(reverbOut)
        reverbOut.connect(tone)

        // Two slapback echoes bouncing off the far walls, left and right.
        const slapIn = add(ctx.createGain())
        for (const [time, pan] of [[0.115, -0.45], [0.187, 0.45]] as const) {
            const delay = add(ctx.createDelay(0.5))
            delay.delayTime.value = time
            const lp = add(ctx.createBiquadFilter())
            lp.type = 'lowpass'
            lp.frequency.value = 2800
            const out = add(ctx.createGain())
            out.gain.value = 0.42
            const panner = add(ctx.createStereoPanner())
            panner.pan.value = pan
            slapIn.connect(delay)
            delay.connect(lp)
            lp.connect(out)
            out.connect(panner)
            panner.connect(tone)
        }

        this.master = master
        this.limiter = limiter
        this.glue = glue
        this.tone = tone
        this.duckGain = duck
        this.dryBus = dryBus
        this.bedBus = bedBus
        this.priorityBus = priorityBus
        this.reverbIn = reverbIn
        this.slapIn = slapIn
    }

    /** A big warehouse: sparse early reflections, wall flutter, ~2.2 s dark tail. */
    private makeImpulse(ctx: AudioContext) {
        const sr = ctx.sampleRate
        const len = Math.floor(sr * 2.6)
        const buf = ctx.createBuffer(2, len, sr)
        const rt60 = 2.2
        const early = [0.007, 0.013, 0.019, 0.027, 0.036, 0.048, 0.061, 0.077, 0.094]
        const flutter = [0.118, 0.163, 0.221]
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch)
            let lp = 0
            for (let i = 0; i < len; i++) {
                const t = i / sr
                const env = Math.pow(10, (-3 * t) / rt60)
                const onset = Math.min(1, t / 0.04)
                // The tail darkens as it decays, like air and walls eating highs.
                const fc = 7000 * Math.exp(-t * 1.15) + 650
                const a = 1 - Math.exp((-2 * Math.PI * fc) / sr)
                lp += a * (Math.random() * 2 - 1 - lp)
                d[i] = lp * Math.sqrt((2 - a) / a) * env * onset * 0.8
            }
            early.forEach((time, idx) => {
                const i = Math.floor((time * (ch ? 1.07 : 1) + rnd(0, 0.002)) * sr)
                const amp = (0.95 - idx * 0.07) * (chance(0.5) ? 1 : -1)
                for (let j = 0; j < 4 && i + j < len; j++) d[i + j]! += amp * Math.exp(-j * 0.7)
            })
            flutter.forEach((time, idx) => {
                const i = Math.floor((time * (ch ? 0.96 : 1)) * sr)
                for (let j = 0; j < 220 && i + j < len; j++) d[i + j]! += (Math.random() * 2 - 1) * (0.32 - idx * 0.07) * Math.exp(-j / 70)
            })
        }
        return buf
    }

    private buildNoise(ctx: AudioContext) {
        const sr = ctx.sampleRate
        const len = sr * 2
        const make = () => {
            const b = ctx.createBuffer(1, len, sr)
            return { b, d: b.getChannelData(0) }
        }

        const white = make()
        for (let i = 0; i < len; i++) white.d[i] = Math.random() * 2 - 1

        const pink = make()
        let b0 = 0
        let b1 = 0
        let b2 = 0
        let b3 = 0
        let b4 = 0
        let b5 = 0
        let b6 = 0
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1
            b0 = 0.99886 * b0 + w * 0.0555179
            b1 = 0.99332 * b1 + w * 0.0750759
            b2 = 0.969 * b2 + w * 0.153852
            b3 = 0.8665 * b3 + w * 0.3104856
            b4 = 0.55 * b4 + w * 0.5329522
            b5 = -0.7616 * b5 - w * 0.016898
            pink.d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
            b6 = w * 0.115926
        }

        const brown = make()
        let last = 0
        for (let i = 0; i < len; i++) {
            last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
            brown.d[i] = last * 3.5
        }

        // Sparse clicks with short decaying grit: debris, splinters, static.
        const crackle = make()
        for (let i = 0; i < len; i++) {
            if (Math.random() < 0.0022) {
                const amp = rnd(0.3, 1) * (chance(0.5) ? 1 : -1)
                for (let j = 0; j < 40 && i + j < len; j++) crackle.d[i + j]! += (Math.random() * 2 - 1) * amp * Math.exp(-j / 9)
            }
        }

        this.buffers = { white: white.b, pink: pink.b, brown: brown.b, crackle: crackle.b }
    }

    private curve(drive: number) {
        let c = this.curves.get(drive)
        if (!c) {
            c = makeCurve(drive)
            this.curves.set(drive, c)
        }
        return c
    }

    private fq(f: number) {
        return clamp(f, 20, this.nyq)
    }

    // -----------------------------------------------------------------------
    // Voices
    // -----------------------------------------------------------------------

    private voice(o: VoiceOpts = {}): Voice {
        const ctx = this.ctx!
        const dist = Math.max(0, o.dist ?? 0)
        const pan = clamp(o.pan ?? 0, -1, 1)
        const input = ctx.createGain()
        input.gain.value = (o.level ?? 1) / (1 + dist * 0.055)
        const nodes: AudioNode[] = [input]

        // Distance: quieter, duller, and wetter (the hall dominates far sounds).
        let head: AudioNode = input
        if (dist > 2) {
            const lp = ctx.createBiquadFilter()
            lp.type = 'lowpass'
            lp.frequency.value = Math.max(700, 16000 / (1 + dist * 0.16))
            lp.Q.value = 0.5
            input.connect(lp)
            nodes.push(lp)
            head = lp
        }

        const wet = Math.min(1.2, (o.wet ?? 0.2) * (1 + dist * 0.05))
        if (wet > 0.01) {
            const send = ctx.createGain()
            send.gain.value = wet
            head.connect(send)
            send.connect(this.reverbIn!)
            nodes.push(send)
        }
        if ((o.slap ?? 0) > 0.01) {
            const send = ctx.createGain()
            send.gain.value = o.slap! / (1 + dist * 0.02)
            head.connect(send)
            send.connect(this.slapIn!)
            nodes.push(send)
        }

        const bus = o.priority ? this.priorityBus! : this.dryBus!
        if (Math.abs(pan) > 0.01) {
            const panner = ctx.createStereoPanner()
            panner.pan.value = pan
            head.connect(panner)
            panner.connect(bus)
            nodes.push(panner)
        } else {
            head.connect(bus)
        }

        const voice: Voice = {
            input,
            t0: ctx.currentTime + 0.005 + (o.delay ?? 0),
            nodes,
            sources: [],
            pending: 0,
            sticky: o.sticky ?? false,
            tag: o.tag ?? '',
            released: false
        }
        this.voices.push(voice)
        while (this.voices.length > MAX_VOICES) {
            const victim = this.voices.find(x => !x.sticky && x !== voice) ?? this.voices.find(x => x !== voice)!
            this.steal(victim)
        }
        return voice
    }

    /** Fades a voice out fast and frees it. */
    private steal(v: Voice) {
        const ctx = this.ctx
        if (!ctx) return
        const t = ctx.currentTime
        this.voices = this.voices.filter(x => x !== v)
        v.input.gain.cancelScheduledValues(t)
        v.input.gain.setTargetAtTime(0, t, 0.008)
        for (const s of v.sources) {
            try {
                s.stop(t + 0.05)
            } catch { /* not started */ }
        }
        // Sources scheduled for later may never fire `ended`.
        setTimeout(() => this.release(v), 150)
    }

    private release(v: Voice) {
        if (v.released) return
        v.released = true
        this.voices = this.voices.filter(x => x !== v)
        for (const n of v.nodes) {
            try {
                n.disconnect()
            } catch { /* already disconnected */ }
        }
        v.nodes = []
        v.sources = []
    }

    private track(v: Voice, src: AudioScheduledSourceNode, chain: AudioNode[]) {
        v.sources.push(src)
        v.pending++
        src.onended = () => {
            for (const n of chain) {
                try {
                    n.disconnect()
                } catch { /* already disconnected */ }
            }
            v.pending--
            if (v.pending <= 0) this.release(v)
        }
    }

    private keep(v: Voice, ...nodes: AudioNode[]) {
        v.nodes.push(...nodes)
    }

    /** Cancels every voice carrying `tag` (e.g. a reload interrupted by a weapon swap). */
    cancel(tag: 'reload') {
        for (const v of this.voices.filter(x => x.tag === tag)) this.steal(v)
    }

    private envelope(p: AudioParam, t: number, peak: number, attack: number, dur: number, hold = 0) {
        const a = Math.max(0.0005, attack)
        const end = Math.max(t + a + hold + 0.01, t + dur)
        p.setValueAtTime(0, t)
        p.linearRampToValueAtTime(peak, t + a)
        if (hold > 0) p.setValueAtTime(peak, t + a + hold)
        p.exponentialRampToValueAtTime(0.0001, end)
    }

    // -----------------------------------------------------------------------
    // Layer primitives
    // -----------------------------------------------------------------------

    /** Filtered noise: cracks, tails, scrapes, whooshes, debris. */
    private noise(v: Voice, o: NoiseOpts) {
        const ctx = this.ctx!
        const t = v.t0 + (o.at ?? 0)
        const src = ctx.createBufferSource()
        src.buffer = this.buffers[o.buf ?? 'white']!
        src.loop = true
        src.playbackRate.value = o.rate ?? rnd(0.85, 1.15)
        const chain: AudioNode[] = [src]
        let node: AudioNode = src

        if (o.hp) {
            const hp = ctx.createBiquadFilter()
            hp.type = 'highpass'
            hp.frequency.value = this.fq(o.hp)
            node.connect(hp)
            node = hp
            chain.push(hp)
        }
        const f = ctx.createBiquadFilter()
        f.type = o.type ?? 'lowpass'
        f.frequency.setValueAtTime(this.fq(o.freq), t)
        if (o.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(this.fq(o.freqEnd), t + (o.sweep ?? o.dur))
        f.Q.value = o.q ?? 0.7
        node.connect(f)
        chain.push(f)

        const g = ctx.createGain()
        this.envelope(g.gain, t, o.gain, o.attack ?? 0.003, o.dur, o.hold ?? 0)
        f.connect(g)
        g.connect(v.input)
        chain.push(g)

        if (o.am) {
            const lfo = ctx.createOscillator()
            lfo.type = 'sine'
            lfo.frequency.value = o.am.rate
            const lg = ctx.createGain()
            lg.gain.value = o.am.depth
            // Modulating the envelope's own gain param adds to its automation.
            const amGain = ctx.createGain()
            amGain.gain.value = 1 - o.am.depth
            lfo.connect(lg)
            lg.connect(amGain.gain)
            g.disconnect()
            g.connect(amGain)
            amGain.connect(v.input)
            lfo.start(t)
            lfo.stop(t + o.dur + 0.06)
            this.track(v, lfo, [lfo, lg, amGain])
        }

        src.start(t, Math.random() * 1.7)
        src.stop(t + Math.max(o.dur, (o.attack ?? 0) + (o.hold ?? 0) + 0.01) + 0.05)
        this.track(v, src, chain)
    }

    /** Pitched layer: thumps, whines, chimes, motors. */
    private tonal(v: Voice, o: ToneOpts) {
        const ctx = this.ctx!
        const t = v.t0 + (o.at ?? 0)
        const osc = ctx.createOscillator()
        osc.type = o.type ?? 'sine'
        osc.frequency.setValueAtTime(this.fq(o.freq), t)
        if (o.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(this.fq(o.freqEnd), t + (o.pitchTime ?? o.dur))
        if (o.detune) osc.detune.value = o.detune
        const chain: AudioNode[] = [osc]
        let node: AudioNode = osc

        if (o.vib) {
            const lfo = ctx.createOscillator()
            lfo.frequency.value = o.vib.rate
            const lg = ctx.createGain()
            lg.gain.value = o.vib.depth
            lfo.connect(lg)
            lg.connect(osc.frequency)
            lfo.start(t)
            lfo.stop(t + o.dur + 0.06)
            this.track(v, lfo, [lfo, lg])
        }
        if (o.drive) {
            const sh = ctx.createWaveShaper()
            sh.curve = this.curve(o.drive)
            node.connect(sh)
            node = sh
            chain.push(sh)
        }
        if (o.filter) {
            const f = ctx.createBiquadFilter()
            f.type = o.filter.type
            f.frequency.setValueAtTime(this.fq(o.filter.freq), t)
            if (o.filter.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(this.fq(o.filter.freqEnd), t + o.dur)
            f.Q.value = o.filter.q ?? 1
            node.connect(f)
            node = f
            chain.push(f)
        }
        const g = ctx.createGain()
        this.envelope(g.gain, t, o.gain, o.attack ?? 0.004, o.dur, o.hold ?? 0)
        node.connect(g)
        g.connect(v.input)
        chain.push(g)

        osc.start(t)
        osc.stop(t + Math.max(o.dur, (o.attack ?? 0) + (o.hold ?? 0) + 0.01) + 0.05)
        this.track(v, osc, chain)
    }

    /**
     * A throat: sawtooth (with deep, irregular vibrato and gravelly amplitude
     * modulation) pushed through three vowel formants, with breath noise. The
     * vowel morphs across the call, which is what makes it sound like a mouth
     * rather than a synth.
     */
    private growl(v: Voice, o: GrowlOpts) {
        const ctx = this.ctx!
        const t = v.t0 + (o.at ?? 0)
        const end = t + o.dur + 0.06
        const scale = o.scale ?? 1

        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(o.f0, t)
        if (o.f0End !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f0End), t + (o.pitchTime ?? o.dur))

        const lfo = (target: AudioParam, rate: number, depth: number, type: OscillatorType = 'sine') => {
            const l = ctx.createOscillator()
            l.type = type
            l.frequency.value = rate
            const lg = ctx.createGain()
            lg.gain.value = depth
            l.connect(lg)
            lg.connect(target)
            l.start(t)
            l.stop(end)
            this.track(v, l, [l, lg])
        }
        const vib = o.vib ?? 5
        const depth = o.f0 * (o.vibDepth ?? 0.05)
        lfo(osc.frequency, vib, depth)
        lfo(osc.frequency, vib * 0.37 + 0.6, depth * 0.6)

        const chain: AudioNode[] = [osc]
        let node: AudioNode = osc
        if (o.drive) {
            const sh = ctx.createWaveShaper()
            sh.curve = this.curve(o.drive)
            node.connect(sh)
            node = sh
            chain.push(sh)
        }
        const am = ctx.createGain()
        const raspDepth = o.raspDepth ?? 0.35
        if (o.rasp) {
            am.gain.value = 1 - raspDepth
            lfo(am.gain, o.rasp, raspDepth, 'triangle')
        } else {
            am.gain.value = 1
        }
        node.connect(am)
        chain.push(am)

        const bank = ctx.createGain()
        am.connect(bank)
        const env = ctx.createGain()
        const from = VOWELS[o.from]
        const to = VOWELS[o.to ?? o.from]
        this.keep(v, bank, env)
        for (let i = 0; i < 3; i++) {
            const f = ctx.createBiquadFilter()
            f.type = 'bandpass'
            f.Q.value = FORMANT_Q[i]!
            f.frequency.setValueAtTime(from[i]! * scale, t)
            f.frequency.linearRampToValueAtTime(to[i]! * scale, t + o.dur * 0.85)
            const fg = ctx.createGain()
            fg.gain.value = FORMANT_GAIN[i]!
            bank.connect(f)
            f.connect(fg)
            fg.connect(env)
            this.keep(v, f, fg)
        }
        this.envelope(env.gain, t, o.gain * 5, o.attack ?? 0.06, o.dur, o.hold ?? o.dur * 0.3)
        env.connect(v.input)

        osc.start(t)
        osc.stop(end)
        this.track(v, osc, chain)

        if (o.breath) {
            const n = ctx.createBufferSource()
            n.buffer = this.buffers.pink!
            n.loop = true
            const bg = ctx.createGain()
            bg.gain.value = o.breath * 10
            n.connect(bg)
            bg.connect(bank)
            n.start(t, Math.random() * 1.7)
            n.stop(end)
            this.track(v, n, [n, bg])
        }
        if (o.sub) {
            const sub = ctx.createOscillator()
            sub.type = 'triangle'
            sub.frequency.setValueAtTime(o.f0 / 2, t)
            if (o.f0End !== undefined) sub.frequency.exponentialRampToValueAtTime(Math.max(20, o.f0End / 2), t + (o.pitchTime ?? o.dur))
            const sg = ctx.createGain()
            sg.gain.value = o.sub
            sub.connect(sg)
            sg.connect(env)
            sub.start(t)
            sub.stop(end)
            this.track(v, sub, [sub, sg])
        }
    }

    /** Inharmonic struck-metal partials: bells, chimes, clangs. */
    private bell(v: Voice, o: { at?: number, freq: number, dur: number, gain: number, bright?: number }) {
        const partials = [[1, 1, 1], [2.76, 0.45, 0.55], [5.4, 0.22, 0.35], [8.93, 0.1, 0.2]] as const
        for (const [ratio, gain, decay] of partials) {
            this.tonal(v, {
                at: o.at,
                dur: o.dur * decay,
                gain: o.gain * gain * (ratio > 1 ? (o.bright ?? 1) : 1),
                freq: o.freq * ratio,
                attack: 0.002
            })
        }
    }

    /** Stacked detuned saws through a moving low-pass: brass swells and pads. */
    private pad(v: Voice, o: PadOpts) {
        const ctx = this.ctx!
        const t = v.t0 + (o.at ?? 0)
        const lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.Q.value = 1.2
        lp.frequency.setValueAtTime(o.lpFrom, t)
        lp.frequency.exponentialRampToValueAtTime(o.lpPeak, t + o.attack)
        lp.frequency.exponentialRampToValueAtTime(o.lpTo, t + o.dur)
        const env = ctx.createGain()
        this.envelope(env.gain, t, o.gain, o.attack, o.dur, o.hold)
        lp.connect(env)
        env.connect(v.input)
        this.keep(v, lp, env)
        for (const freq of o.freqs) {
            for (const cents of [-(o.detune ?? 7), o.detune ?? 7]) {
                const osc = ctx.createOscillator()
                osc.type = o.type ?? 'sawtooth'
                osc.frequency.value = freq
                osc.detune.value = cents
                osc.connect(lp)
                osc.start(t)
                osc.stop(t + o.dur + 0.06)
                this.track(v, osc, [osc])
            }
        }
    }

    // Small mechanical building blocks ---------------------------------------

    private clack(v: Voice, at: number, freq: number, gain: number, q = 5) {
        this.noise(v, { at, dur: 0.035, gain, type: 'bandpass', freq, q, attack: 0.0008 })
        this.tonal(v, { at, dur: 0.03, gain: gain * 0.25, freq: freq * 0.45, freqEnd: freq * 0.25, type: 'square', attack: 0.0008 })
    }

    private scrape(v: Voice, at: number, dur: number, f0: number, f1: number, gain: number) {
        this.noise(v, { at, dur, gain, type: 'bandpass', freq: f0, freqEnd: f1, q: 2.5, buf: 'pink', attack: dur * 0.3 })
    }

    private thunk(v: Voice, at: number, freq: number, gain: number) {
        this.tonal(v, { at, dur: 0.14, gain, freq, freqEnd: freq * 0.45, pitchTime: 0.05 })
        this.noise(v, { at, dur: 0.06, gain: gain * 0.6, type: 'lowpass', freq: 900, freqEnd: 250, buf: 'pink', attack: 0.001 })
    }

    private casing(v: Voice, at: number) {
        const f = rnd(3400, 5200)
        for (let i = 0; i < 2; i++) {
            const a = at + i * 0.085
            const k = i ? 0.45 : 1
            this.tonal(v, { at: a, dur: 0.16, gain: 0.05 * k, freq: f * (1 - i * 0.03), attack: 0.001 })
            this.tonal(v, { at: a, dur: 0.09, gain: 0.03 * k, freq: f * 1.53, attack: 0.001 })
            this.noise(v, { at: a, dur: 0.02, gain: 0.05 * k, type: 'bandpass', freq: 4200, q: 6, attack: 0.0005 })
        }
    }

    private magOut(v: Voice, at: number, heft: number) {
        this.clack(v, at, 2400 / heft, 0.16)
        this.scrape(v, at + 0.03, 0.1, 1400 / heft, 800 / heft, 0.09)
        this.thunk(v, at + 0.15, 200 / heft, 0.22 * heft)
        this.clack(v, at + 0.17, 3300 / heft, 0.05)
    }

    private magIn(v: Voice, at: number, heft: number) {
        this.scrape(v, at, 0.09, 900 / heft, 1600 / heft, 0.1)
        this.thunk(v, at + 0.09, 230 / heft, 0.3 * heft)
        this.clack(v, at + 0.095, 3000 / heft, 0.2, 6)
    }

    private rack(v: Voice, at: number, heft: number) {
        this.scrape(v, at, 0.1, 1200 / heft, 2600 / heft, 0.13)
        this.clack(v, at + 0.1, 2000 / heft, 0.3, 3)
        this.thunk(v, at + 0.1, 280 / heft, 0.14 * heft)
        this.tonal(v, { at: at + 0.1, dur: 0.05, gain: 0.08, freq: 520 / heft, freqEnd: 200 / heft, type: 'triangle' })
    }

    private pump(v: Voice, at: number) {
        this.scrape(v, at, 0.13, 900, 2300, 0.17)
        this.clack(v, at + 0.12, 1400, 0.3, 3)
        this.thunk(v, at + 0.12, 150, 0.22)
        this.scrape(v, at + 0.24, 0.1, 2200, 1000, 0.12)
        this.clack(v, at + 0.33, 1700, 0.34, 3)
        this.thunk(v, at + 0.33, 170, 0.26)
        this.tonal(v, { at: at + 0.33, dur: 0.08, gain: 0.1, freq: 380, freqEnd: 170, type: 'triangle' })
    }

    // -----------------------------------------------------------------------
    // Guns
    // -----------------------------------------------------------------------

    private gun(cls: CallOfXenoWeaponClass, pan: number, dist: number) {
        const p = rnd(0.94, 1.07)
        const level = rnd(0.9, 1)
        switch (cls) {
            case 'pistol': {
                // Snappy: a bright crack over a short, punchy thump.
                const v = this.voice({ pan, dist, wet: 0.32, slap: 0.3, level })
                this.noise(v, { dur: 0.06, gain: 0.85, type: 'bandpass', freq: 3600 * p, freqEnd: 1400, q: 0.6, attack: 0.001 })
                this.noise(v, { dur: 0.014, gain: 0.5, type: 'highpass', freq: 6500, attack: 0.0005 })
                this.tonal(v, { dur: 0.28, gain: 0.85, freq: 230 * p, freqEnd: 68, pitchTime: 0.05, attack: 0.001 })
                this.tonal(v, { dur: 0.1, gain: 0.3, freq: 520 * p, freqEnd: 150, pitchTime: 0.035, type: 'triangle' })
                this.noise(v, { at: 0.01, dur: 0.5, gain: 0.2, type: 'bandpass', freq: 950, freqEnd: 300, q: 0.8, buf: 'pink', attack: 0.01 })
                this.clack(v, 0.06, 2600, 0.14)
                if (chance(0.7)) this.casing(v, rnd(0.22, 0.34))
                break
            }
            case 'magnum': {
                // Booming: heavy low body, long rolling tail, hard crack.
                const v = this.voice({ pan, dist, wet: 0.55, slap: 0.45, level })
                this.noise(v, { dur: 0.09, gain: 1, type: 'bandpass', freq: 2500 * p, freqEnd: 900, q: 0.7, attack: 0.001 })
                this.noise(v, { dur: 0.018, gain: 0.5, type: 'highpass', freq: 6000, attack: 0.0005 })
                this.tonal(v, { dur: 0.9, gain: 1.05, freq: 130 * p, freqEnd: 38, pitchTime: 0.09, attack: 0.002 })
                this.tonal(v, { dur: 0.35, gain: 0.55, freq: 260 * p, freqEnd: 80, pitchTime: 0.06, type: 'triangle' })
                this.noise(v, { at: 0.005, dur: 1.0, gain: 0.5, type: 'lowpass', freq: 1400, freqEnd: 140, buf: 'brown', attack: 0.008 })
                this.noise(v, { at: 0.02, dur: 0.6, gain: 0.22, type: 'bandpass', freq: 800, freqEnd: 250, q: 0.7, buf: 'pink', attack: 0.02 })
                this.clack(v, 0.08, 1900, 0.2, 3)
                if (chance(0.6)) this.casing(v, rnd(0.3, 0.42))
                break
            }
            case 'smg': {
                // Tight and rattly: short crack, buzzy square rattle, quick tail.
                const v = this.voice({ pan, dist, wet: 0.2, slap: 0.16, level })
                this.noise(v, { dur: 0.045, gain: 0.65, type: 'bandpass', freq: 4500 * p, freqEnd: 2000, q: 0.7, attack: 0.001 })
                this.tonal(v, { dur: 0.16, gain: 0.55, freq: 270 * p, freqEnd: 95, pitchTime: 0.03, attack: 0.001 })
                this.tonal(v, { dur: 0.06, gain: 0.12, freq: 640 * p, freqEnd: 210, pitchTime: 0.03, type: 'square' })
                this.noise(v, { at: 0.005, dur: 0.22, gain: 0.16, type: 'bandpass', freq: 1500, freqEnd: 600, q: 0.8, buf: 'pink', attack: 0.006 })
                this.clack(v, 0.028, 3200, 0.13)
                if (chance(0.3)) this.casing(v, rnd(0.18, 0.3))
                break
            }
            case 'rifle': {
                // Sharp supersonic crack over a firm body and a ringing tail.
                const v = this.voice({ pan, dist, wet: 0.5, slap: 0.4, level })
                this.noise(v, { dur: 0.07, gain: 0.95, type: 'bandpass', freq: 3000 * p, freqEnd: 1100, q: 0.7, attack: 0.001 })
                this.noise(v, { dur: 0.03, gain: 0.32, type: 'bandpass', freq: 8000, freqEnd: 3000, q: 1.2, attack: 0.0005 })
                this.noise(v, { dur: 0.014, gain: 0.5, type: 'highpass', freq: 7000, attack: 0.0005 })
                this.tonal(v, { dur: 0.5, gain: 0.9, freq: 155 * p, freqEnd: 50, pitchTime: 0.06, attack: 0.001 })
                this.tonal(v, { dur: 0.16, gain: 0.35, freq: 340 * p, freqEnd: 110, pitchTime: 0.04, type: 'triangle' })
                this.noise(v, { at: 0.005, dur: 0.85, gain: 0.35, type: 'lowpass', freq: 2500, freqEnd: 220, buf: 'pink', attack: 0.006 })
                this.clack(v, 0.09, 2100, 0.16, 4)
                if (chance(0.6)) this.casing(v, rnd(0.25, 0.4))
                break
            }
            case 'sniper': {
                // A cannon: giant body, long echoing tail, then the bolt work.
                const v = this.voice({ pan, dist, wet: 0.75, slap: 0.55, level })
                this.noise(v, { dur: 0.09, gain: 1, type: 'bandpass', freq: 2800 * p, freqEnd: 800, q: 0.7, attack: 0.001 })
                this.noise(v, { dur: 0.04, gain: 0.4, type: 'bandpass', freq: 8500, freqEnd: 3000, q: 1.2, attack: 0.0005 })
                this.tonal(v, { dur: 1.0, gain: 1.1, freq: 118 * p, freqEnd: 36, pitchTime: 0.1, attack: 0.002 })
                this.tonal(v, { dur: 0.3, gain: 0.5, freq: 300 * p, freqEnd: 90, pitchTime: 0.05, type: 'triangle' })
                this.noise(v, { at: 0.005, dur: 1.4, gain: 0.5, type: 'lowpass', freq: 2200, freqEnd: 120, buf: 'brown', attack: 0.01 })
                this.clack(v, 0.5, 1500, 0.14, 3)
                this.clack(v, 0.62, 1800, 0.14, 3)
                this.clack(v, 0.8, 1400, 0.2, 3)
                this.clack(v, 0.9, 2000, 0.22, 3)
                break
            }
            case 'lmg': {
                // Heavy chug: thick low-mid body, hammering bolt slam.
                const v = this.voice({ pan, dist, wet: 0.4, slap: 0.3, level })
                this.noise(v, { dur: 0.07, gain: 0.8, type: 'bandpass', freq: 2200 * p, freqEnd: 900, q: 0.7, attack: 0.001 })
                this.tonal(v, { dur: 0.42, gain: 1, freq: 105 * p, freqEnd: 36, pitchTime: 0.07, attack: 0.001 })
                this.tonal(v, { dur: 0.16, gain: 0.32, freq: 78 * p, freqEnd: 42, type: 'sawtooth', filter: { type: 'lowpass', freq: 420, q: 0.8 } })
                this.tonal(v, { dur: 0.1, gain: 0.3, freq: 300 * p, freqEnd: 100, pitchTime: 0.04, type: 'triangle' })
                this.noise(v, { at: 0.005, dur: 0.6, gain: 0.35, type: 'lowpass', freq: 1400, freqEnd: 200, buf: 'brown', attack: 0.006 })
                this.noise(v, { at: 0.045, dur: 0.06, gain: 0.26, type: 'bandpass', freq: 900, q: 2, attack: 0.001 })
                if (chance(0.25)) this.casing(v, rnd(0.2, 0.32))
                break
            }
            case 'shotgun': {
                // A massive low boom and a wall of blast, then the pump rack.
                const v = this.voice({ pan, dist, wet: 0.7, slap: 0.5, level })
                this.noise(v, { dur: 0.22, gain: 1, type: 'lowpass', freq: 6000, freqEnd: 1000, q: 0.6, attack: 0.001 })
                this.noise(v, { dur: 0.03, gain: 0.5, type: 'highpass', freq: 5000, attack: 0.0005 })
                this.tonal(v, { dur: 1.0, gain: 1.15, freq: 92 * p, freqEnd: 30, pitchTime: 0.12, attack: 0.002 })
                this.tonal(v, { dur: 0.5, gain: 0.6, freq: 190 * p, freqEnd: 60, pitchTime: 0.08, type: 'triangle' })
                this.noise(v, { at: 0.005, dur: 1.3, gain: 0.6, type: 'lowpass', freq: 1000, freqEnd: 110, buf: 'brown', attack: 0.01 })
                this.noise(v, { at: 0.01, dur: 0.5, gain: 0.3, type: 'bandpass', freq: 1800, freqEnd: 400, q: 0.6, buf: 'pink', attack: 0.01 })
                this.pump(v, 0.46 + rnd(0, 0.04))
                break
            }
            case 'launcher': {
                // Whoomp: a thick back-blast cough, then the motor hissing away.
                const v = this.voice({ pan, dist, wet: 0.7, slap: 0.3, level })
                this.noise(v, { dur: 0.1, gain: 0.5, type: 'bandpass', freq: 900, freqEnd: 400, q: 0.7, attack: 0.002 })
                this.tonal(v, { dur: 0.9, gain: 0.95, freq: 74 * p, freqEnd: 28, pitchTime: 0.16, attack: 0.004 })
                this.tonal(v, { dur: 0.35, gain: 0.4, freq: 160 * p, freqEnd: 60, pitchTime: 0.1, type: 'triangle' })
                this.noise(v, { dur: 0.7, gain: 0.7, type: 'lowpass', freq: 1400, freqEnd: 160, buf: 'brown', attack: 0.015 })
                this.noise(v, { at: 0.05, dur: 1.3, gain: 0.3, type: 'bandpass', freq: 1800, freqEnd: 5500, sweep: 1.0, q: 0.9, buf: 'pink', attack: 0.1, hold: 0.25 })
                this.tonal(v, { at: 0.05, dur: 1.1, gain: 0.1, freq: 110, freqEnd: 300, type: 'sawtooth', attack: 0.15, hold: 0.2, filter: { type: 'lowpass', freq: 700, q: 0.8 } })
                this.clack(v, 0.02, 1100, 0.2, 2)
                break
            }
            case 'wonder': {
                // Sci-fi: a rising charge whine snapping into a FM zap.
                const v = this.voice({ pan, dist, wet: 0.6, slap: 0.2, level })
                this.tonal(v, { dur: 0.1, gain: 0.18, freq: 500, freqEnd: 2600, type: 'sawtooth', attack: 0.02, filter: { type: 'bandpass', freq: 1400, q: 3 } })
                this.zap(v, 0.08, p)
                break
            }
        }
    }

    /** Wonder-weapon discharge: FM sweep + sub thump + ionised hiss. */
    private zap(v: Voice, at: number, p: number) {
        const ctx = this.ctx!
        const t = v.t0 + at
        const dur = 0.7
        const carrier = ctx.createOscillator()
        carrier.type = 'sine'
        carrier.frequency.setValueAtTime(1500 * p, t)
        carrier.frequency.exponentialRampToValueAtTime(170, t + 0.4)
        const mod = ctx.createOscillator()
        mod.frequency.setValueAtTime(190 * p, t)
        mod.frequency.exponentialRampToValueAtTime(70, t + 0.5)
        const index = ctx.createGain()
        index.gain.setValueAtTime(900, t)
        index.gain.exponentialRampToValueAtTime(60, t + 0.5)
        mod.connect(index)
        index.connect(carrier.frequency)
        const g = ctx.createGain()
        this.envelope(g.gain, t, 0.42, 0.003, dur)
        carrier.connect(g)
        g.connect(v.input)
        for (const s of [carrier, mod]) {
            s.start(t)
            s.stop(t + dur + 0.06)
        }
        this.track(v, carrier, [carrier, g])
        this.track(v, mod, [mod, index])

        this.tonal(v, { at, dur: 0.5, gain: 0.3, freq: 2600 * p, freqEnd: 280, pitchTime: 0.3, type: 'sawtooth', filter: { type: 'lowpass', freq: 5000, freqEnd: 500, q: 4 } })
        this.tonal(v, { at, dur: 0.6, gain: 0.7, freq: 150, freqEnd: 42, pitchTime: 0.14, attack: 0.002 })
        this.noise(v, { at, dur: 0.55, gain: 0.25, type: 'bandpass', freq: 3200, freqEnd: 300, q: 5, attack: 0.002 })
        this.noise(v, { at, dur: 0.04, gain: 0.5, type: 'highpass', freq: 5000, attack: 0.0005 })
        this.noise(v, { at: at + 0.1, dur: 0.5, gain: 0.12, type: 'highpass', freq: 3500, buf: 'crackle', attack: 0.01 })
    }

    private dryFire(pan: number, dist: number) {
        const v = this.voice({ pan, dist, wet: 0.15 })
        this.noise(v, { dur: 0.04, gain: 0.32, type: 'bandpass', freq: 3000, q: 4, attack: 0.0008 })
        this.tonal(v, { dur: 0.05, gain: 0.14, freq: 900, freqEnd: 400, type: 'triangle', attack: 0.001 })
        this.tonal(v, { dur: 0.08, gain: 0.14, freq: 320, freqEnd: 150, pitchTime: 0.04, attack: 0.001 })
    }

    /** One weapon's whole reload, spread across `duration` seconds. */
    playReload(cls: CallOfXenoWeaponClass, duration: number, pan = 0) {
        if (!this.ctx || !this.master || this.muted) return
        if (this.ctx.state === 'suspended') void this.ctx.resume()
        const D = Math.max(0.4, duration)
        const v = this.voice({ pan, wet: 0.22, tag: 'reload' })
        switch (cls) {
            case 'pistol':
            case 'magnum':
            case 'smg':
            case 'rifle': {
                const heft = cls === 'pistol' ? 0.9 : cls === 'magnum' ? 1.1 : 1
                this.magOut(v, D * 0.12, heft)
                this.magIn(v, D * 0.55, heft)
                this.rack(v, D * 0.8, heft)
                break
            }
            case 'sniper': {
                this.clack(v, D * 0.08, 1800, 0.2, 3)
                this.scrape(v, D * 0.1, 0.12, 900, 1800, 0.14)
                this.clack(v, D * 0.22, 1400, 0.24, 3)
                for (let i = 0; i < 3; i++) this.rifleRound(v, D * (0.4 + i * 0.1))
                this.scrape(v, D * 0.75, 0.1, 1800, 900, 0.12)
                this.clack(v, D * 0.85, 1900, 0.3, 3)
                this.thunk(v, D * 0.85, 240, 0.2)
                break
            }
            case 'lmg': {
                this.clack(v, D * 0.06, 700, 0.3, 2)
                this.thunk(v, D * 0.08, 110, 0.4)
                this.magOut(v, D * 0.22, 1.5)
                this.magIn(v, D * 0.52, 1.5)
                this.thunk(v, D * 0.72, 90, 0.4)
                this.clack(v, D * 0.74, 800, 0.32, 2)
                this.rack(v, D * 0.86, 1.4)
                break
            }
            case 'shotgun': {
                const shells = 4
                for (let i = 0; i < shells; i++) {
                    const at = D * (0.1 + i * (0.6 / shells)) + rnd(-0.02, 0.02)
                    this.clack(v, at, 3000 + rnd(-200, 200), 0.2, 6)
                    this.tonal(v, { at, dur: 0.06, gain: 0.08, freq: 720, freqEnd: 500, type: 'triangle' })
                    this.thunk(v, at + 0.03, 210, 0.16)
                }
                this.pump(v, D * 0.84)
                break
            }
            case 'launcher': {
                this.clack(v, D * 0.08, 600, 0.3, 2)
                this.thunk(v, D * 0.09, 100, 0.4)
                this.scrape(v, D * 0.25, 0.35, 500, 900, 0.14)
                this.thunk(v, D * 0.58, 120, 0.42)
                this.clack(v, D * 0.6, 900, 0.3, 3)
                this.clack(v, D * 0.82, 700, 0.32, 2)
                this.thunk(v, D * 0.83, 95, 0.4)
                break
            }
            case 'wonder': {
                this.tonal(v, { dur: D * 0.8, gain: 0.12, freq: 180, freqEnd: 1400, pitchTime: D * 0.75, type: 'sawtooth', attack: D * 0.2, filter: { type: 'lowpass', freq: 900, freqEnd: 3000, q: 3 } })
                this.tonal(v, { at: D * 0.78, dur: 0.16, gain: 0.2, freq: 1400, freqEnd: 900, type: 'square', attack: 0.002 })
                this.thunk(v, D * 0.15, 140, 0.3)
                this.clack(v, D * 0.15, 1500, 0.16, 3)
                this.thunk(v, D * 0.8, 170, 0.3)
                this.bell(v, { at: D * 0.82, freq: 1320, dur: 0.6, gain: 0.08 })
                break
            }
        }
    }

    private rifleRound(v: Voice, at: number) {
        this.clack(v, at, 3400, 0.16, 6)
        this.thunk(v, at + 0.03, 260, 0.12)
    }

    // -----------------------------------------------------------------------
    // Creatures
    // -----------------------------------------------------------------------

    private groan(pan: number, dist: number) {
        const v = this.voice({ pan, dist, wet: 0.4 })
        const dur = rnd(1.1, 1.8)
        const variant = Math.floor(Math.random() * 3)
        if (variant === 0) {
            // A low chest moan sinking into the ground.
            const f0 = rnd(72, 112)
            this.growl(v, { dur, gain: 0.5, f0, f0End: f0 * 0.6, from: 'o', to: 'a', scale: 0.9, vib: rnd(4.5, 6), vibDepth: 0.05, rasp: rnd(40, 60), raspDepth: 0.35, drive: 2.5, breath: 0.25, sub: 0.25, attack: 0.15 })
        } else if (variant === 1) {
            // A thin, dragging wail that cracks in the middle.
            const f0 = rnd(120, 175)
            this.growl(v, { dur, gain: 0.42, f0, f0End: f0 * 0.68, pitchTime: dur * 0.9, from: 'ae', to: 'o', scale: 0.95, vib: rnd(6, 8), vibDepth: 0.09, rasp: rnd(55, 80), raspDepth: 0.4, drive: 2, breath: 0.3, attack: 0.2 })
        } else {
            // A wet, gurgling throat-rattle.
            const f0 = rnd(58, 82)
            this.growl(v, { dur, gain: 0.5, f0, f0End: f0 * 0.7, from: 'u', to: 'o', scale: 0.85, vib: 4, vibDepth: 0.06, rasp: rnd(24, 34), raspDepth: 0.55, drive: 3, breath: 0.5, sub: 0.3, attack: 0.12 })
            for (let i = 0; i < 4; i++) {
                this.tonal(v, { at: rnd(0.1, dur * 0.8), dur: 0.09, gain: 0.07, freq: rnd(260, 420), freqEnd: rnd(600, 900), pitchTime: 0.06, attack: 0.01 })
            }
        }
        this.noise(v, { at: 0.05, dur: dur * 0.9, gain: 0.05, type: 'bandpass', freq: 1400, freqEnd: 500, q: 2, buf: 'pink', attack: 0.2 })
    }

    private snarl(pan: number, dist: number) {
        const v = this.voice({ pan, dist, wet: 0.35 })
        const f0 = rnd(140, 200)
        this.growl(v, { dur: 0.6, gain: 0.55, f0, f0End: f0 * 0.65, from: 'a', to: 'o', scale: 0.85, vib: 9, vibDepth: 0.08, rasp: rnd(55, 75), raspDepth: 0.5, drive: 3.5, breath: 0.4, attack: 0.03, hold: 0.15, sub: 0.2 })
        this.noise(v, { dur: 0.35, gain: 0.12, type: 'bandpass', freq: 2400, freqEnd: 900, q: 1.5, attack: 0.02 })
    }

    /** The lunge: a rising shriek snapping into a bite. */
    private attackScreech(pan: number, dist: number) {
        const v = this.voice({ pan, dist, wet: 0.4 })
        const f0 = rnd(420, 560)
        this.growl(v, { dur: 0.6, gain: 0.5, f0, f0End: f0 * 2.4, pitchTime: 0.14, from: 'i', to: 'a', scale: 0.92, vib: 26, vibDepth: 0.1, rasp: rnd(70, 90), raspDepth: 0.45, drive: 4, breath: 0.5, attack: 0.02, hold: 0.22 })
        this.growl(v, { dur: 0.4, gain: 0.35, f0: 130, f0End: 80, from: 'a', to: 'o', scale: 0.8, vib: 8, vibDepth: 0.06, rasp: 50, raspDepth: 0.5, drive: 3, attack: 0.03 })
        this.noise(v, { dur: 0.5, gain: 0.1, type: 'bandpass', freq: 3800, freqEnd: 2000, q: 1.6, attack: 0.03, hold: 0.15 })
        // Teeth snapping shut.
        this.clack(v, 0.16, 2600, 0.24, 3)
        this.thunk(v, 0.16, 300, 0.12)
    }

    /** A long, ear-splitting screech (round stinger, spawn shriek). */
    private screech(pan: number, dist: number, delay = 0) {
        const v = this.voice({ pan, dist, wet: 0.6, delay })
        const f0 = rnd(750, 950)
        this.growl(v, { dur: 1.5, gain: 0.5, f0, f0End: f0 * 1.2, pitchTime: 0.3, from: 'i', to: 'e', scale: 0.95, vib: rnd(16, 22), vibDepth: 0.14, rasp: rnd(75, 95), raspDepth: 0.4, drive: 4, breath: 0.5, attack: 0.05, hold: 0.7 })
        this.growl(v, { at: 0.02, dur: 1.3, gain: 0.28, f0: f0 * 0.5, f0End: f0 * 0.62, pitchTime: 0.3, from: 'a', to: 'o', vib: 11, vibDepth: 0.1, rasp: 60, raspDepth: 0.5, drive: 3, attack: 0.08, hold: 0.5 })
    }

    /** A far-off, warbling xeno call, for ambience. */
    private xenoCall(pan: number, dist: number) {
        const v = this.voice({ pan, dist, wet: 0.7 })
        const f0 = rnd(240, 400)
        const dur = rnd(1.4, 2.4)
        this.growl(v, { dur, gain: 0.55, f0, f0End: f0 * rnd(0.6, 1.5), from: 'i', to: 'u', scale: 0.9, vib: rnd(6, 10), vibDepth: 0.13, rasp: rnd(30, 60), raspDepth: 0.3, drive: 2.5, breath: 0.3, attack: 0.2, hold: dur * 0.3 })
    }

    /** A wet gurgle and collapse: what a xeno does when the lights go out. */
    private deathGurgle(pan: number, dist: number, long: boolean) {
        const v = this.voice({ pan, dist, wet: 0.3 })
        const dur = long ? 0.9 : 0.55
        const f0 = rnd(80, 110)
        this.growl(v, { dur, gain: 0.4, f0, f0End: f0 * 0.5, from: 'u', to: 'o', scale: 0.85, vib: 4, vibDepth: 0.08, rasp: rnd(14, 22), raspDepth: 0.7, drive: 3, breath: 0.4, attack: 0.02, hold: dur * 0.2 })
        for (let i = 0; i < (long ? 6 : 3); i++) {
            this.tonal(v, { at: rnd(0.02, dur * 0.9), dur: 0.1, gain: 0.11, freq: rnd(300, 600), freqEnd: rnd(700, 1200), pitchTime: 0.07, attack: 0.008 })
        }
        this.splat(v, 0.03, 0.8)
        if (long) this.thunk(v, 0.42, 90, 0.45)
    }

    private splat(v: Voice, at: number, gain: number) {
        this.noise(v, { at, dur: 0.24, gain: 0.5 * gain, type: 'bandpass', freq: 650, freqEnd: 250, q: 1.4, buf: 'pink', attack: 0.004 })
        this.noise(v, { at, dur: 0.03, gain: 0.25 * gain, type: 'bandpass', freq: 2500, q: 2, attack: 0.001 })
        this.noise(v, { at: at + 0.02, dur: 0.28, gain: 0.16 * gain, type: 'bandpass', freq: 1600, q: 0.9, buf: 'crackle', attack: 0.01 })
        this.tonal(v, { at, dur: 0.24, gain: 0.5 * gain, freq: 120, freqEnd: 48, pitchTime: 0.08 })
    }

    // -----------------------------------------------------------------------
    // Public play
    // -----------------------------------------------------------------------

    /**
     * Plays a one-shot. `pan` is −1 (left) … +1 (right); `distance` is metres
     * to the source: farther sounds get quieter, duller and wetter.
     */
    play(event: CallOfXenoSound, pan = 0, distance = 0) {
        const ctx = this.ctx
        if (!ctx || !this.master || this.muted) return
        if (ctx.state === 'suspended') void ctx.resume()

        const gap = THROTTLE[event]
        if (gap) {
            const last = this.lastPlayed.get(event) ?? -1
            if (ctx.currentTime - last < gap) return
            this.lastPlayed.set(event, ctx.currentTime)
        }

        const d = distance
        switch (event) {
            case 'shoot-pistol': this.gun('pistol', pan, d); break
            case 'shoot-magnum': this.gun('magnum', pan, d); break
            case 'shoot-smg': this.gun('smg', pan, d); break
            case 'shoot-rifle': this.gun('rifle', pan, d); break
            case 'shoot-sniper': this.gun('sniper', pan, d); break
            case 'shoot-lmg': this.gun('lmg', pan, d); break
            case 'shoot-shotgun': this.gun('shotgun', pan, d); break
            case 'shoot-launcher': this.gun('launcher', pan, d); break
            case 'shoot-wonder': this.gun('wonder', pan, d); break
            case 'shotgun-pump': {
                const v = this.voice({ pan, dist: d, wet: 0.3 })
                this.pump(v, 0)
                break
            }
            case 'dry-fire': this.dryFire(pan, d); break
            case 'reload-start': {
                const v = this.voice({ pan, dist: d, wet: 0.2, tag: 'reload' })
                this.magOut(v, 0, 1)
                break
            }
            case 'reload-end': {
                const v = this.voice({ pan, dist: d, wet: 0.2, tag: 'reload' })
                this.magIn(v, 0, 1)
                this.rack(v, 0.22, 1)
                break
            }
            case 'reload-mag-out': this.magOut(this.voice({ pan, dist: d, wet: 0.2 }), 0, 1); break
            case 'reload-mag-in': this.magIn(this.voice({ pan, dist: d, wet: 0.2 }), 0, 1); break
            case 'reload-rack': this.rack(this.voice({ pan, dist: d, wet: 0.2 }), 0, 1); break
            case 'reload-shell': {
                const v = this.voice({ pan, dist: d, wet: 0.2 })
                this.clack(v, 0, 3000, 0.22, 6)
                this.tonal(v, { dur: 0.06, gain: 0.08, freq: 720, freqEnd: 500, type: 'triangle' })
                this.thunk(v, 0.03, 210, 0.16)
                break
            }

            // Impacts ---------------------------------------------------------
            case 'hit': {
                const v = this.voice({ pan, dist: d, wet: 0.15 })
                this.tonal(v, { dur: 0.2, gain: 0.55, freq: rnd(140, 170), freqEnd: 52, pitchTime: 0.05, attack: 0.001 })
                this.noise(v, { dur: 0.14, gain: 0.38, type: 'lowpass', freq: 950, freqEnd: 200, buf: 'pink', attack: 0.001 })
                this.noise(v, { at: 0.01, dur: 0.09, gain: 0.14, type: 'bandpass', freq: rnd(500, 700), freqEnd: 950, q: 4, attack: 0.004 })
                break
            }
            case 'headshot': {
                const v = this.voice({ pan, dist: d, wet: 0.25 })
                this.tonal(v, { dur: 0.16, gain: 0.55, freq: 520, freqEnd: 120, pitchTime: 0.03, attack: 0.001 })
                this.noise(v, { dur: 0.045, gain: 0.5, type: 'bandpass', freq: 2600, freqEnd: 1200, q: 1.2, attack: 0.001 })
                this.splat(v, 0.02, 0.9)
                this.tonal(v, { dur: 0.09, gain: 0.05, freq: 2900, attack: 0.001 })
                break
            }
            case 'hitmarker': {
                const v = this.voice({ pan, dist: d, wet: 0, level: 0.8 })
                this.tonal(v, { dur: 0.07, gain: 0.14, freq: 2300, freqEnd: 1800, pitchTime: 0.05, attack: 0.001 })
                this.noise(v, { dur: 0.012, gain: 0.16, type: 'highpass', freq: 5500, attack: 0.0005 })
                break
            }
            case 'kill': this.deathGurgle(pan, d, false); break
            case 'zombie-death': this.deathGurgle(pan, d, true); break
            case 'gore-splat': this.splat(this.voice({ pan, dist: d, wet: 0.25 }), 0, 1); break
            case 'body-thud': {
                const v = this.voice({ pan, dist: d, wet: 0.25 })
                this.tonal(v, { dur: 0.4, gain: 0.7, freq: 95, freqEnd: 38, pitchTime: 0.09 })
                this.noise(v, { dur: 0.2, gain: 0.35, type: 'lowpass', freq: 400, freqEnd: 120, buf: 'brown', attack: 0.002 })
                this.noise(v, { at: 0.02, dur: 0.12, gain: 0.08, type: 'bandpass', freq: 1800, q: 1, buf: 'crackle' })
                break
            }
            case 'zombie-groan': this.groan(pan, d); break
            case 'zombie-snarl': this.snarl(pan, d); break
            case 'zombie-attack': this.attackScreech(pan, d); break
            case 'zombie-screech': this.screech(pan, d); break
            case 'xeno-call': this.xenoCall(pan, d || 35); break

            // Player ----------------------------------------------------------
            case 'hurt': {
                const v = this.voice({ pan, dist: d, wet: 0.2, level: 1 })
                const f0 = rnd(110, 140)
                // A pained grunt, a thump to the ribs, a ringing ear.
                this.growl(v, { dur: 0.3, gain: 0.4, f0, f0End: f0 * 0.7, from: 'o', to: 'a', vib: 6, vibDepth: 0.05, drive: 1.5, breath: 0.4, attack: 0.02, hold: 0.06 })
                this.tonal(v, { dur: 0.45, gain: 0.6, freq: 150, freqEnd: 44, pitchTime: 0.08 })
                this.noise(v, { dur: 0.3, gain: 0.3, type: 'lowpass', freq: 700, freqEnd: 130, buf: 'pink', attack: 0.002 })
                this.tonal(v, { dur: 0.9, gain: 0.04, freq: 3100, freqEnd: 2950, attack: 0.05, hold: 0.3 })
                this.muffle(700, 0.3)
                break
            }
            case 'heartbeat': {
                const v = this.voice({ wet: 0.05, level: 1 })
                this.tonal(v, { dur: 0.24, gain: 0.9, freq: 62, freqEnd: 38, pitchTime: 0.08, attack: 0.004 })
                this.noise(v, { dur: 0.1, gain: 0.25, type: 'lowpass', freq: 300, buf: 'brown', attack: 0.003 })
                this.tonal(v, { at: 0.23, dur: 0.22, gain: 0.65, freq: 54, freqEnd: 36, pitchTime: 0.08, attack: 0.004 })
                this.noise(v, { at: 0.23, dur: 0.09, gain: 0.16, type: 'lowpass', freq: 260, buf: 'brown', attack: 0.003 })
                break
            }
            case 'death': this.death(); break
            case 'melee': {
                const v = this.voice({ pan, dist: d, wet: 0.15 })
                this.noise(v, { dur: 0.24, gain: 0.34, type: 'bandpass', freq: 350, freqEnd: 2800, sweep: 0.2, q: 1.4, buf: 'pink', attack: 0.09 })
                this.tonal(v, { dur: 0.2, gain: 0.06, freq: 200, freqEnd: 130, attack: 0.08 })
                break
            }
            case 'melee-hit': {
                const v = this.voice({ pan, dist: d, wet: 0.25 })
                this.tonal(v, { dur: 0.4, gain: 0.85, freq: 135, freqEnd: 42, pitchTime: 0.06, attack: 0.001 })
                this.noise(v, { dur: 0.14, gain: 0.55, type: 'lowpass', freq: 1900, freqEnd: 200, attack: 0.001 })
                this.noise(v, { at: 0.005, dur: 0.14, gain: 0.3, type: 'bandpass', freq: 1900, q: 0.9, buf: 'crackle', attack: 0.003 })
                this.splat(v, 0.02, 0.5)
                break
            }
            case 'footstep':
            case 'footstep-concrete': this.footstep(pan, d, false); break
            case 'footstep-metal': this.footstep(pan, d, true); break
            case 'jump': {
                const v = this.voice({ pan, dist: d, wet: 0.1 })
                this.noise(v, { dur: 0.2, gain: 0.13, type: 'bandpass', freq: 500, freqEnd: 1000, q: 1.2, buf: 'pink', attack: 0.06 })
                this.thunk(v, 0, 120, 0.15)
                this.noise(v, { at: 0.02, dur: 0.06, gain: 0.05, type: 'bandpass', freq: 2200, q: 3, buf: 'crackle' })
                break
            }
            case 'land': {
                const v = this.voice({ pan, dist: d, wet: 0.25 })
                this.tonal(v, { dur: 0.36, gain: 0.7, freq: 105, freqEnd: 38, pitchTime: 0.07, attack: 0.002 })
                this.noise(v, { dur: 0.2, gain: 0.35, type: 'lowpass', freq: 600, freqEnd: 120, buf: 'pink', attack: 0.002 })
                this.noise(v, { at: 0.02, dur: 0.08, gain: 0.06, type: 'bandpass', freq: 2200, q: 3, buf: 'crackle' })
                break
            }

            // World -----------------------------------------------------------
            case 'explosion': this.explosion(pan, d); break
            case 'buy': this.buy(pan, d); break
            case 'deny': {
                const v = this.voice({ pan, dist: d, wet: 0.1 })
                for (const at of [0, 0.13]) {
                    const f = at ? 128 : 165
                    this.tonal(v, { at, dur: 0.14, gain: 0.2, freq: f, freqEnd: f * 0.8, type: 'sawtooth', attack: 0.004, hold: 0.06, filter: { type: 'lowpass', freq: 900, q: 1 } })
                    this.tonal(v, { at, dur: 0.14, gain: 0.16, freq: f * 1.04, freqEnd: f * 0.83, type: 'square', attack: 0.004, hold: 0.06, filter: { type: 'lowpass', freq: 700, q: 1 } })
                }
                this.clack(v, 0, 1800, 0.1)
                break
            }
            case 'door': this.door(pan, d); break
            case 'power': this.power(pan, d); break
            case 'papunch': this.papunch(pan, d, true, true); break
            case 'papunch-grind': this.papunch(pan, d, true, false); break
            case 'papunch-chime': this.papunch(pan, d, false, true); break
            case 'perk': this.perk(pan, d); break
            case 'powerup-spawn': {
                const v = this.voice({ pan, dist: d, wet: 0.5 })
                this.tonal(v, { dur: 0.7, gain: 0.16, freq: 300, freqEnd: 1800, pitchTime: 0.6, attack: 0.15, hold: 0.2, vib: { rate: 9, depth: 40 } })
                this.tonal(v, { dur: 0.5, gain: 0.5, freq: 110, freqEnd: 50, pitchTime: 0.12 })
                for (let i = 0; i < 5; i++) this.bell(v, { at: 0.08 + i * 0.07, freq: 880 * Math.pow(1.335, i % 3) * (i > 2 ? 2 : 1), dur: 0.7, gain: 0.07 })
                break
            }
            case 'powerup-pickup': {
                const v = this.voice({ pan, dist: d, wet: 0.35 })
                const notes = [659, 880, 1109, 1319]
                notes.forEach((f, i) => this.bell(v, { at: i * 0.055, freq: f, dur: 0.9, gain: 0.11 }))
                this.tonal(v, { dur: 0.35, gain: 0.08, freq: 400, freqEnd: 2400, pitchTime: 0.3, type: 'sawtooth', attack: 0.1, filter: { type: 'lowpass', freq: 3000, q: 2 } })
                this.noise(v, { dur: 0.4, gain: 0.05, type: 'highpass', freq: 6000, buf: 'crackle', attack: 0.05 })
                break
            }
            case 'powerup-expire': {
                const v = this.voice({ pan, dist: d, wet: 0.1 })
                for (let i = 0; i < 3; i++) this.tonal(v, { at: i * 0.14, dur: 0.1, gain: 0.1, freq: 900 - i * 140, type: 'triangle', attack: 0.003 })
                break
            }
            case 'round-start': this.roundStart(); break
            case 'round-end': this.roundEnd(); break
            case 'board-break': this.boardBreak(pan, d); break
            case 'board-repair': {
                const v = this.voice({ pan, dist: d, wet: 0.3 })
                for (let i = 0; i < 2; i++) {
                    const at = i * rnd(0.11, 0.14)
                    this.tonal(v, { at, dur: 0.16, gain: 0.5, freq: 290 - i * 20, freqEnd: 110, pitchTime: 0.04, attack: 0.001 })
                    this.noise(v, { at, dur: 0.05, gain: 0.35, type: 'bandpass', freq: 1700, freqEnd: 800, q: 2, attack: 0.001 })
                    this.tonal(v, { at, dur: 0.09, gain: 0.2, freq: 540, freqEnd: 260, pitchTime: 0.03, type: 'triangle', attack: 0.001 })
                    this.tonal(v, { at: at + 0.005, dur: 0.15, gain: 0.03, freq: 3400 + i * 300, attack: 0.001 })
                }
                break
            }
            case 'climb-in': {
                const v = this.voice({ pan, dist: d, wet: 0.35 })
                this.noise(v, { dur: 0.32, gain: 0.3, type: 'bandpass', freq: 800, freqEnd: 250, q: 1.2, buf: 'pink', attack: 0.05 })
                this.noise(v, { at: 0.02, dur: 0.2, gain: 0.1, type: 'bandpass', freq: 2500, q: 1, buf: 'crackle', attack: 0.02 })
                this.thunk(v, 0.2, 105, 0.55)
                this.noise(v, { at: 0.2, dur: 0.16, gain: 0.25, type: 'lowpass', freq: 500, freqEnd: 120, buf: 'brown', attack: 0.002 })
                this.growl(v, { at: 0.08, dur: 0.4, gain: 0.25, f0: 120, f0End: 85, from: 'a', to: 'o', scale: 0.85, vib: 6, vibDepth: 0.06, rasp: 45, raspDepth: 0.4, drive: 2.5, breath: 0.4, attack: 0.03 })
                break
            }
            case 'box-open': {
                const v = this.voice({ pan, dist: d, wet: 0.5 })
                this.tonal(v, { dur: 0.6, gain: 0.14, freq: 260, freqEnd: 420, type: 'sawtooth', attack: 0.1, hold: 0.2, filter: { type: 'bandpass', freq: 900, freqEnd: 1400, q: 10 }, vib: { rate: 9, depth: 14 } })
                this.thunk(v, 0.5, 100, 0.4)
                this.clack(v, 0.5, 900, 0.2, 2)
                this.tonal(v, { at: 0.55, dur: 1.4, gain: 0.05, freq: 165, type: 'sine', attack: 0.3 })
                for (let i = 0; i < 4; i++) this.bell(v, { at: 0.6 + i * 0.09, freq: 1046 * Math.pow(1.26, i), dur: 1.1, gain: 0.06 })
                break
            }
            case 'box-tick': {
                const v = this.voice({ pan, dist: d, wet: 0.2 })
                this.clack(v, 0, 2200, 0.14, 4)
                this.tonal(v, { dur: 0.06, gain: 0.05, freq: 700, freqEnd: 500, type: 'triangle' })
                break
            }
        }
    }

    // -----------------------------------------------------------------------
    // Composite sounds
    // -----------------------------------------------------------------------

    private footstep(pan: number, dist: number, metal: boolean) {
        const v = this.voice({ pan, dist, wet: metal ? 0.3 : 0.16 })
        const p = rnd(0.9, 1.12)
        const g = rnd(0.85, 1.1)
        if (metal) {
            this.thunk(v, 0, 150 * p, 0.2 * g)
            this.noise(v, { dur: 0.03, gain: 0.12 * g, type: 'bandpass', freq: 2600 * p, q: 3, attack: 0.001 })
            // Grating rings after the heel lands.
            const base = rnd(360, 460)
            for (const [r, gain, dur] of [[1, 0.05, 0.22], [1.62, 0.04, 0.16], [2.9, 0.025, 0.12]] as const) {
                this.tonal(v, { at: 0.004, dur, gain: gain * g, freq: base * r, freqEnd: base * r * 0.985, attack: 0.001 })
            }
        } else {
            this.tonal(v, { dur: 0.16, gain: 0.26 * g, freq: 125 * p, freqEnd: 60, pitchTime: 0.05, attack: 0.001 })
            this.noise(v, { dur: 0.09, gain: 0.16 * g, type: 'lowpass', freq: 650 * p, freqEnd: 250, buf: 'pink', attack: 0.001 })
            this.noise(v, { at: 0.01, dur: 0.05, gain: 0.05 * g, type: 'bandpass', freq: 1900 * p, q: 1.2, buf: 'crackle', attack: 0.008 })
        }
    }

    private explosion(pan: number, dist: number) {
        const v = this.voice({ pan, dist, wet: 0.85, slap: 0.35, priority: true, sticky: true })
        // Initial crack.
        this.noise(v, { dur: 0.2, gain: 1, type: 'bandpass', freq: 2200, freqEnd: 600, q: 0.6, attack: 0.001 })
        this.noise(v, { dur: 0.05, gain: 0.5, type: 'highpass', freq: 5000, attack: 0.0005 })
        // Sub-bass drop, plus audible low harmonics for laptop speakers.
        this.tonal(v, { dur: 2.2, gain: 1.3, freq: 110, freqEnd: 22, pitchTime: 0.6, attack: 0.004, hold: 0.1 })
        this.tonal(v, { dur: 1.2, gain: 0.65, freq: 95, freqEnd: 40, pitchTime: 0.4, type: 'triangle' })
        this.tonal(v, { dur: 0.8, gain: 0.7, freq: 240, freqEnd: 55, pitchTime: 0.2, type: 'triangle' })
        this.tonal(v, { at: 0.1, dur: 2.4, gain: 0.5, freq: 48, freqEnd: 30 })
        // Blast wall and rolling tail.
        this.noise(v, { dur: 1.9, gain: 1.1, type: 'lowpass', freq: 2200, freqEnd: 70, buf: 'brown', q: 0.5, attack: 0.008 })
        this.noise(v, { at: 0.05, dur: 1.2, gain: 0.45, type: 'bandpass', freq: 700, freqEnd: 200, q: 0.6, buf: 'pink', attack: 0.01 })
        this.noise(v, { at: 0.25, dur: 3.2, gain: 0.4, type: 'lowpass', freq: 500, freqEnd: 60, buf: 'brown', attack: 0.1 })
        // Debris crackle and clatter.
        this.noise(v, { at: 0.1, dur: 1.6, gain: 0.7, type: 'bandpass', freq: 3000, freqEnd: 1200, q: 0.6, buf: 'crackle', attack: 0.02, hold: 0.3 })
        for (let i = 0; i < 9; i++) {
            const at = rnd(0.15, 1.5)
            this.noise(v, { at, dur: rnd(0.03, 0.07), gain: rnd(0.06, 0.16), type: 'bandpass', freq: rnd(1200, 4500), q: 4, attack: 0.001 })
            if (i % 2) this.tonal(v, { at, dur: 0.07, gain: 0.05, freq: rnd(500, 1400), freqEnd: 300, type: 'triangle', attack: 0.001 })
        }
        this.duck(clamp(0.6 - dist * 0.01, 0.15, 0.6), 1.2)
    }

    private buy(pan: number, dist: number) {
        const v = this.voice({ pan, dist, wet: 0.22 })
        // Register mechanics: key clack, then the drawer slamming out.
        this.clack(v, 0, 2800, 0.22, 3)
        this.thunk(v, 0.05, 150, 0.3)
        this.noise(v, { at: 0.05, dur: 0.1, gain: 0.12, type: 'bandpass', freq: 1200, freqEnd: 600, q: 1.5, buf: 'pink', attack: 0.01 })
        // The bell.
        this.bell(v, { at: 0.075, freq: 2093, dur: 0.9, gain: 0.16, bright: 1.1 })
        this.bell(v, { at: 0.13, freq: 2637, dur: 0.7, gain: 0.08 })
        // Coins tumbling into the tray.
        for (let i = 0; i < 6; i++) {
            const at = 0.14 + i * rnd(0.03, 0.055)
            const f = rnd(3800, 6500)
            this.tonal(v, { at, dur: 0.09, gain: rnd(0.03, 0.06), freq: f, freqEnd: f * 0.97, attack: 0.001 })
            this.tonal(v, { at, dur: 0.05, gain: 0.025, freq: f * 1.42, attack: 0.001 })
        }
    }

    private door(pan: number, dist: number) {
        const v = this.voice({ pan, dist, wet: 0.55 })
        const dur = 1.8
        // Latch releases with a heavy clunk.
        this.thunk(v, 0, 110, 0.55)
        this.clack(v, 0, 1100, 0.3, 2)
        // Slat rattle of the shutter rolling up, quickening as it goes.
        this.noise(v, { at: 0.12, dur, gain: 0.3, type: 'bandpass', freq: 600, freqEnd: 1200, q: 1.6, attack: 0.15, hold: dur * 0.5, am: { rate: 17, depth: 0.55 } })
        this.noise(v, { at: 0.12, dur, gain: 0.14, type: 'highpass', freq: 3000, buf: 'crackle', attack: 0.2, hold: dur * 0.4 })
        // Motor and chain drive.
        this.tonal(v, { at: 0.1, dur, gain: 0.2, freq: 52, freqEnd: 72, type: 'sawtooth', attack: 0.25, hold: dur * 0.5, filter: { type: 'lowpass', freq: 220, q: 1 }, vib: { rate: 9, depth: 2 } })
        this.tonal(v, { at: 0.1, dur, gain: 0.05, freq: 310, freqEnd: 400, type: 'sawtooth', attack: 0.3, hold: dur * 0.5, filter: { type: 'bandpass', freq: 500, q: 5 } })
        // Metal ticks off the track.
        for (let i = 0; i < 7; i++) {
            const at = rnd(0.3, 1.6)
            this.tonal(v, { at, dur: 0.1, gain: 0.05, freq: rnd(600, 1100), freqEnd: rnd(300, 500), type: 'triangle', attack: 0.001 })
        }
        // It bangs into the stop.
        this.thunk(v, 1.75, 70, 0.9)
        this.noise(v, { at: 1.75, dur: 0.25, gain: 0.35, type: 'bandpass', freq: 900, freqEnd: 400, q: 1.5, attack: 0.001 })
        this.bell(v, { at: 1.76, freq: 190, dur: 0.6, gain: 0.08 })
    }

    private power(pan: number, dist: number) {
        const v = this.voice({ pan, dist, wet: 0.7, priority: true, sticky: true })
        // Breaker slammed home: a crack of arc, then an enormous clunk.
        this.noise(v, { dur: 0.09, gain: 0.95, type: 'bandpass', freq: 3000, freqEnd: 1000, q: 0.7, attack: 0.001 })
        this.noise(v, { dur: 0.5, gain: 0.4, type: 'highpass', freq: 2500, buf: 'crackle', attack: 0.005, am: { rate: 55, depth: 0.6 } })
        this.tonal(v, { dur: 0.9, gain: 1.15, freq: 82, freqEnd: 30, pitchTime: 0.1, attack: 0.002 })
        this.tonal(v, { dur: 0.2, gain: 0.5, freq: 240, freqEnd: 70, pitchTime: 0.04, type: 'triangle' })
        this.thunk(v, 0.34, 100, 0.6)
        this.clack(v, 0.34, 1400, 0.3, 2)
        this.bell(v, { at: 0.02, freq: 140, dur: 1.0, gain: 0.1 })
        // The generator spinning up.
        this.tonal(v, { at: 0.3, dur: 2.8, gain: 0.3, freq: 34, freqEnd: 96, pitchTime: 2.2, type: 'sawtooth', attack: 0.5, hold: 1.0, filter: { type: 'lowpass', freq: 200, freqEnd: 900, q: 1.2 }, vib: { rate: 12, depth: 2 } })
        this.tonal(v, { at: 0.5, dur: 2.5, gain: 0.12, freq: 68, freqEnd: 192, pitchTime: 2.1, type: 'square', attack: 0.6, hold: 0.8, filter: { type: 'lowpass', freq: 400, freqEnd: 1600, q: 1 } })
        // Lights stuttering on.
        for (const at of [0.7, 0.86, 1.08, 1.2, 1.5]) {
            const len = at > 1.4 ? 1.2 : 0.09
            this.tonal(v, { at, dur: len, gain: 0.1, freq: 120, type: 'sawtooth', attack: 0.004, hold: len * 0.7, filter: { type: 'bandpass', freq: 2400, q: 3 }, drive: 2 })
            this.noise(v, { at, dur: Math.min(len, 0.4), gain: 0.08, type: 'highpass', freq: 4000, attack: 0.002, am: { rate: 100, depth: 0.7 } })
        }
        this.bell(v, { at: 1.5, freq: 1760, dur: 0.6, gain: 0.03 })
        this.duck(0.35, 1.6)
    }

    private papunch(pan: number, dist: number, grind: boolean, chime: boolean) {
        const v = this.voice({ pan, dist, wet: 0.5, sticky: chime })
        if (grind) {
            // Gears and a motor winding up, ratchet clicks, then the stamp.
            this.noise(v, { dur: 1.1, gain: 0.3, type: 'bandpass', freq: 380, freqEnd: 1000, q: 2, buf: 'pink', attack: 0.2, hold: 0.5, am: { rate: 22, depth: 0.5 } })
            this.tonal(v, { dur: 1.2, gain: 0.22, freq: 60, freqEnd: 240, pitchTime: 1.0, type: 'sawtooth', attack: 0.3, hold: 0.5, filter: { type: 'lowpass', freq: 300, freqEnd: 1200, q: 2 } })
            this.tonal(v, { dur: 1.1, gain: 0.07, freq: 400, freqEnd: 1300, pitchTime: 1.0, type: 'square', attack: 0.4, hold: 0.4, filter: { type: 'bandpass', freq: 900, q: 4 } })
            for (let i = 0; i < 9; i++) this.clack(v, 0.08 + i * (0.11 - i * 0.006), 2400 + i * 150, 0.09, 4)
            this.thunk(v, 1.1, 75, 0.95)
            this.noise(v, { at: 1.1, dur: 0.16, gain: 0.5, type: 'bandpass', freq: 2100, freqEnd: 500, q: 1.4, attack: 0.001 })
            this.bell(v, { at: 1.1, freq: 260, dur: 0.9, gain: 0.14 })
            this.noise(v, { at: 1.12, dur: 0.3, gain: 0.12, type: 'highpass', freq: 3500, buf: 'crackle', attack: 0.005 })
        }
        if (chime) {
            const at = grind ? 1.35 : 0
            const notes = [523.25, 783.99, 1046.5, 1568]
            notes.forEach((f, i) => {
                this.bell(v, { at: at + i * 0.12, freq: f, dur: 1.3, gain: 0.13 })
            })
            this.tonal(v, { at, dur: 0.6, gain: 0.05, freq: 300, freqEnd: 2200, pitchTime: 0.5, type: 'sawtooth', attack: 0.2, filter: { type: 'lowpass', freq: 3000, q: 2 } })
        }
    }

    private perk(pan: number, dist: number) {
        const v = this.voice({ pan, dist, wet: 0.35 })
        // Cap flicked off.
        this.noise(v, { dur: 0.04, gain: 0.3, type: 'bandpass', freq: 2000, freqEnd: 900, q: 5, attack: 0.001 })
        this.tonal(v, { dur: 0.08, gain: 0.3, freq: 640, freqEnd: 260, pitchTime: 0.05, attack: 0.001 })
        this.bell(v, { at: 0.02, freq: 2400, dur: 0.2, gain: 0.05 })
        // Glug, glug, glug.
        for (let i = 0; i < 3; i++) {
            const at = 0.16 + i * 0.15 + rnd(-0.01, 0.01)
            const f = rnd(170, 210)
            this.tonal(v, { at, dur: 0.13, gain: 0.32, freq: f, freqEnd: f * 2.3, pitchTime: 0.07, attack: 0.01, filter: { type: 'lowpass', freq: 900, q: 2 } })
            this.noise(v, { at, dur: 0.11, gain: 0.08, type: 'bandpass', freq: 600, freqEnd: 1100, q: 3, buf: 'pink', attack: 0.02 })
        }
        // A satisfied, slightly rude burp.
        this.growl(v, { at: 0.68, dur: 0.3, gain: 0.16, f0: 95, f0End: 58, from: 'o', to: 'a', scale: 1, vib: 24, vibDepth: 0.08, rasp: 32, raspDepth: 0.6, drive: 2, breath: 0.2, attack: 0.03, hold: 0.06 })
        // Jingle.
        const notes = [523.25, 659.25, 783.99, 1046.5]
        notes.forEach((f, i) => {
            this.bell(v, { at: 0.85 + i * 0.1, freq: f, dur: 0.9, gain: 0.12 })
            this.tonal(v, { at: 0.85 + i * 0.1, dur: 0.22, gain: 0.05, freq: f * 2, type: 'triangle', attack: 0.004 })
        })
        this.noise(v, { at: 0.85, dur: 0.6, gain: 0.05, type: 'highpass', freq: 6000, buf: 'crackle', attack: 0.05 })
    }

    private roundStart() {
        const v = this.voice({ wet: 0.85, priority: true, sticky: true, level: 1 })
        // Timpani-like hit and a wave of low pressure.
        this.tonal(v, { dur: 1.6, gain: 1.0, freq: 88, freqEnd: 34, pitchTime: 0.2, attack: 0.003 })
        this.noise(v, { dur: 1.5, gain: 0.6, type: 'lowpass', freq: 700, freqEnd: 70, buf: 'brown', attack: 0.005 })
        this.noise(v, { dur: 0.08, gain: 0.35, type: 'bandpass', freq: 1800, q: 1, attack: 0.001 })
        // The ominous brass chord: A minor with a flat ninth grinding on top.
        this.pad(v, { at: 0.05, dur: 3.4, gain: 0.1, freqs: [55, 82.41, 110, 130.81], lpFrom: 220, lpPeak: 1900, lpTo: 260, attack: 0.4, hold: 0.9, detune: 8 })
        this.pad(v, { at: 0.35, dur: 3.0, gain: 0.05, freqs: [233.08, 329.63], lpFrom: 300, lpPeak: 1400, lpTo: 300, attack: 0.6, hold: 0.5, detune: 12 })
        this.tonal(v, { dur: 3.4, gain: 0.5, freq: 27.5, type: 'sine', attack: 0.3, hold: 1.0 })
        // Something in the dark answers.
        this.screech(rnd(-0.8, 0.8), 42, 0.75)
        this.duck(0.5, 2.2)
    }

    private roundEnd() {
        const v = this.voice({ wet: 0.85, priority: true, sticky: true })
        this.tonal(v, { dur: 1.2, gain: 0.55, freq: 70, freqEnd: 40, pitchTime: 0.2, attack: 0.004 })
        this.pad(v, { dur: 2.8, gain: 0.07, freqs: [110, 164.81, 196, 246.94], lpFrom: 200, lpPeak: 1100, lpTo: 300, attack: 0.5, hold: 0.8, detune: 6 })
        const notes = [880, 659.25, 587.33, 440]
        notes.forEach((f, i) => this.bell(v, { at: 0.12 + i * 0.32, freq: f, dur: 1.8, gain: 0.11 }))
        this.duck(0.3, 1.8)
    }

    private death() {
        const v = this.voice({ wet: 0.8, priority: true, sticky: true })
        // Ears ringing as the world drains away.
        this.tonal(v, { dur: 3.4, gain: 0.05, freq: 3200, freqEnd: 3000, attack: 0.1, hold: 1.4 })
        this.tonal(v, { dur: 3.2, gain: 0.28, freq: 200, freqEnd: 32, pitchTime: 2.8, type: 'sawtooth', attack: 0.05, hold: 0.5, filter: { type: 'lowpass', freq: 700, freqEnd: 90, q: 1 } })
        this.tonal(v, { dur: 3, gain: 0.5, freq: 90, freqEnd: 28, pitchTime: 2.6, type: 'triangle' })
        this.thunk(v, 0, 70, 0.9)
        this.noise(v, { dur: 2.2, gain: 0.25, type: 'lowpass', freq: 800, freqEnd: 60, buf: 'brown', attack: 0.02 })
        this.noise(v, { at: 0.2, dur: 2.4, gain: 0.08, type: 'bandpass', freq: 300, freqEnd: 2200, q: 1.5, buf: 'pink', attack: 1.2 })
        // Two failing heartbeats.
        this.tonal(v, { at: 0.5, dur: 0.3, gain: 0.7, freq: 52, freqEnd: 34, pitchTime: 0.1 })
        this.tonal(v, { at: 1.4, dur: 0.35, gain: 0.5, freq: 46, freqEnd: 30, pitchTime: 0.12 })
        this.growl(v, { at: 0.1, dur: 0.9, gain: 0.2, f0: 140, f0End: 70, from: 'o', to: 'u', vib: 5, vibDepth: 0.06, drive: 1.5, breath: 0.5, attack: 0.05 })
        this.muffle(260, 1.5, true)
        this.duck(0.7, 3)
    }

    private boardBreak(pan: number, dist: number) {
        const v = this.voice({ pan, dist, wet: 0.4 })
        // Wood groaning under load...
        const f = rnd(190, 280)
        this.tonal(v, { dur: 0.34, gain: 0.16, freq: f, freqEnd: f * rnd(1.3, 1.7), type: 'sawtooth', attack: 0.05, hold: 0.1, filter: { type: 'bandpass', freq: f * 3.5, freqEnd: f * 2.2, q: 9 }, vib: { rate: rnd(12, 24), depth: f * 0.06 } })
        // ...then the nail-shrieking crack of the plank.
        const crack = 0.16
        this.noise(v, { at: crack, dur: 0.06, gain: 0.9, type: 'bandpass', freq: 2000, freqEnd: 800, q: 1.4, attack: 0.001 })
        this.noise(v, { at: crack + 0.045, dur: 0.16, gain: 0.55, type: 'bandpass', freq: 1200, freqEnd: 300, q: 1, attack: 0.001 })
        this.noise(v, { at: crack, dur: 0.3, gain: 0.35, type: 'bandpass', freq: 3200, q: 0.8, buf: 'crackle', attack: 0.003 })
        this.tonal(v, { at: crack, dur: 0.25, gain: 0.5, freq: 170, freqEnd: 62, pitchTime: 0.05, attack: 0.001 })
        this.tonal(v, { at: crack, dur: 0.12, gain: 0.14, freq: 3600, freqEnd: 1900, type: 'triangle', attack: 0.001 })
        // Splinters clattering to the floor.
        for (let i = 0; i < 4; i++) {
            const at = crack + rnd(0.15, 0.45)
            this.tonal(v, { at, dur: 0.06, gain: 0.07, freq: rnd(600, 1000), freqEnd: 350, type: 'triangle', attack: 0.001 })
            this.noise(v, { at, dur: 0.04, gain: 0.08, type: 'bandpass', freq: rnd(1500, 3000), q: 4, attack: 0.001 })
        }
    }

    // -----------------------------------------------------------------------
    // Mix control
    // -----------------------------------------------------------------------

    private baseTone() {
        // 20 kHz clear → ~1.4 kHz at death's door.
        return this.nyq * Math.pow(1400 / this.nyq, this.lowHealth)
    }

    private applyTone(timeConstant: number) {
        if (!this.ctx || !this.tone) return
        const t = this.ctx.currentTime
        this.tone.frequency.cancelScheduledValues(t)
        this.tone.frequency.setTargetAtTime(this.baseTone(), t, timeConstant)
    }

    /** Briefly muffles the mix (taking a hit, dying), then recovers. */
    private muffle(freq: number, recover: number, hold = false) {
        if (!this.ctx || !this.tone) return
        const t = this.ctx.currentTime
        const p = this.tone.frequency
        p.cancelScheduledValues(t)
        p.setValueAtTime(Math.min(this.baseTone(), freq), t)
        if (!hold) p.setTargetAtTime(this.baseTone(), t + recover * 0.6, recover * 0.6)
    }

    /** 0 = clear, 1 = nearly dead: closes a low-pass over the whole mix. */
    setLowHealth(amount: number) {
        this.lowHealth = clamp(amount, 0, 1)
        this.applyTone(0.35)
    }

    /**
     * Pushes everything except priority sounds down by `amount` (0..1 of the
     * level) and lets it swell back over ~`seconds`.
     */
    duck(amount: number, seconds: number) {
        if (!this.ctx || !this.duckGain) return
        const t = this.ctx.currentTime
        const p = this.duckGain.gain
        p.cancelScheduledValues(t)
        p.setTargetAtTime(1 - clamp(amount, 0, 0.95), t, 0.015)
        p.setTargetAtTime(1, t + seconds * 0.3, Math.max(0.05, seconds * 0.28))
    }

    // -----------------------------------------------------------------------
    // Ambience and music
    // -----------------------------------------------------------------------

    private bedOsc(type: OscillatorType, freq: number, dest: AudioNode, gain: number, detune = 0) {
        const ctx = this.ctx!
        const osc = ctx.createOscillator()
        osc.type = type
        osc.frequency.value = freq
        osc.detune.value = detune
        const g = ctx.createGain()
        g.gain.value = gain
        osc.connect(g)
        g.connect(dest)
        osc.start()
        this.ambSources.push(osc)
        this.ambNodes.push(osc, g)
        return osc
    }

    private bedNoise(kind: NoiseKind, dest: AudioNode, gain: number) {
        const ctx = this.ctx!
        const src = ctx.createBufferSource()
        src.buffer = this.buffers[kind]!
        src.loop = true
        const g = ctx.createGain()
        g.gain.value = gain
        src.connect(g)
        g.connect(dest)
        src.start(0, Math.random() * 1.7)
        this.ambSources.push(src)
        this.ambNodes.push(src, g)
        return g
    }

    private bedFilter(type: BiquadFilterType, freq: number, q: number, dest: AudioNode) {
        const f = this.ctx!.createBiquadFilter()
        f.type = type
        f.frequency.value = freq
        f.Q.value = q
        f.connect(dest)
        this.ambNodes.push(f)
        return f
    }

    private bedLfo(target: AudioParam, rate: number, depth: number) {
        const ctx = this.ctx!
        const lfo = ctx.createOscillator()
        lfo.frequency.value = rate
        const g = ctx.createGain()
        g.gain.value = depth
        lfo.connect(g)
        g.connect(target)
        lfo.start()
        this.ambSources.push(lfo)
        this.ambNodes.push(lfo, g)
    }

    /**
     * Starts the continuous bed: sub drone, wind, a flickering fluorescent
     * hum, a generator (when the power is on), the tension music layers and
     * occasional distant creaks, clangs and xeno calls. Call once per run
     * after `start()`; safe to call repeatedly.
     */
    startAmbience() {
        this.wantAmbience = true
        const ctx = this.ctx
        if (!ctx || !this.bedBus) return
        if (this.ambStopTimer) {
            clearTimeout(this.ambStopTimer)
            this.ambStopTimer = null
            this.teardownAmbience()
        }
        if (this.ambBus) return

        const bus = ctx.createGain()
        bus.gain.value = 0
        bus.connect(this.bedBus)
        bus.gain.setTargetAtTime(1, ctx.currentTime, 1.2)
        this.ambBus = bus
        this.ambNodes.push(bus)

        // Sub drone: two slow-beating sines and a filtered saw.
        const drone = ctx.createGain()
        drone.gain.value = 0.16
        drone.connect(bus)
        this.ambNodes.push(drone)
        this.droneGain = drone
        this.bedOsc('sine', 38, drone, 0.5)
        this.bedOsc('sine', 38.7, drone, 0.4)
        this.bedOsc('sine', 57.2, drone, 0.18)
        const droneLp = this.bedFilter('lowpass', 110, 0.7, drone)
        this.bedOsc('sawtooth', 28.5, droneLp, 0.35)
        this.bedLfo(drone.gain, 0.05, 0.05)

        // Wind through the rafters: a low moan and a thin whistle.
        const windBp = this.bedFilter('bandpass', 320, 0.9, bus)
        this.bedNoise('pink', windBp, 0.5)
        this.bedLfo(windBp.frequency, 0.09, 160)
        const windGain = ctx.createGain()
        windGain.gain.value = 0.16
        windBp.disconnect()
        windBp.connect(windGain)
        windGain.connect(bus)
        this.ambNodes.push(windGain)
        this.bedLfo(windGain.gain, 0.13, 0.08)
        const whistle = this.bedFilter('bandpass', 950, 11, bus)
        this.bedNoise('white', whistle, 0.03)
        this.bedLfo(whistle.frequency, 0.05, 220)

        // Failing fluorescents: 100 Hz mains hum and its harmonics, buzzing.
        const hum = ctx.createGain()
        hum.gain.value = this.powerOn ? 0.6 : 0.35
        hum.connect(bus)
        this.ambNodes.push(hum)
        this.humGain = hum
        this.bedOsc('sine', 100, hum, 0.03)
        this.bedOsc('sine', 200, hum, 0.018)
        this.bedOsc('sine', 300, hum, 0.012)
        const buzzHp = this.bedFilter('highpass', 5500, 0.7, hum)
        this.bedNoise('white', buzzHp, 0.01)
        this.bedLfo(hum.gain, 0.4, 0.12)

        // Generator + lit tubes, only with the power on.
        const gen = ctx.createGain()
        gen.gain.value = 0
        gen.connect(bus)
        this.ambNodes.push(gen)
        this.genGain = gen
        const genLp = this.bedFilter('lowpass', 260, 1, gen)
        this.genOscs = [
            this.bedOsc('sawtooth', this.powerOn ? 48 : 30, genLp, 0.5),
            this.bedOsc('square', this.powerOn ? 96 : 60, genLp, 0.15)
        ]
        const buzz = ctx.createGain()
        buzz.gain.value = 0
        buzz.connect(bus)
        this.ambNodes.push(buzz)
        this.buzzGain = buzz
        const buzzBp = this.bedFilter('bandpass', 2600, 2.5, buzz)
        this.bedOsc('sawtooth', 120, buzzBp, 0.12)
        this.bedNoise('white', buzzBp, 0.04)
        this.bedLfo(buzz.gain, 0.23, 0.15)
        if (this.powerOn) this.applyPower(0.05)

        // Music: brooding pad, dissonant shimmer, and a sub pulse.
        const pad = ctx.createGain()
        pad.gain.value = 0
        pad.connect(bus)
        this.ambNodes.push(pad)
        this.padGain = pad
        const padLp = this.bedFilter('lowpass', 420, 1.1, pad)
        this.bedLfo(padLp.frequency, 0.06, 160)
        for (const f of [55, 82.41, 110, 130.81]) {
            this.bedOsc('sawtooth', f, padLp, 0.2, -6)
            this.bedOsc('sawtooth', f, padLp, 0.2, 6)
        }
        const tense = ctx.createGain()
        tense.gain.value = 0
        tense.connect(bus)
        this.ambNodes.push(tense)
        this.tenseGain = tense
        this.bedOsc('sine', 440, tense, 0.4)
        this.bedOsc('sine', 466.16, tense, 0.4)
        this.bedOsc('sine', 311.13, tense, 0.25)
        this.bedLfo(tense.gain, 5.3, 0.005)
        const pulse = ctx.createGain()
        pulse.gain.value = 0
        pulse.connect(bus)
        this.ambNodes.push(pulse)
        this.pulseGain = pulse
        const pulseLp = this.bedFilter('lowpass', 240, 0.8, pulse)
        this.bedOsc('sine', 44, pulseLp, 0.9)
        this.bedOsc('triangle', 88, pulseLp, 0.4)
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 1.3
        const shaper = ctx.createWaveShaper()
        this.pulseCurve ??= makePulseCurve()
        shaper.curve = this.pulseCurve
        lfo.connect(shaper)
        shaper.connect(pulse.gain)
        lfo.start()
        this.ambSources.push(lfo)
        this.ambNodes.push(lfo, shaper)
        this.pulseLfo = lfo

        this.applyIntensity(0.01)
        this.scheduleAmbient()
    }

    /** Fades the bed out and frees it. */
    stopAmbience() {
        this.wantAmbience = false
        if (this.ambTimer) clearTimeout(this.ambTimer)
        this.ambTimer = null
        if (!this.ctx || !this.ambBus) return
        this.ambBus.gain.cancelScheduledValues(this.ctx.currentTime)
        this.ambBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3)
        if (this.ambStopTimer) clearTimeout(this.ambStopTimer)
        this.ambStopTimer = setTimeout(() => {
            this.ambStopTimer = null
            this.teardownAmbience()
        }, 1600)
    }

    private teardownAmbience() {
        for (const s of this.ambSources) {
            try {
                s.stop()
            } catch { /* already stopped */ }
        }
        for (const n of this.ambNodes) {
            try {
                n.disconnect()
            } catch { /* already disconnected */ }
        }
        this.ambSources = []
        this.ambNodes = []
        this.genOscs = []
        this.ambBus = this.padGain = this.tenseGain = this.pulseGain = this.droneGain = null
        this.humGain = this.genGain = this.buzzGain = null
        this.pulseLfo = null
    }

    private applyPower(tc: number) {
        if (!this.ctx || !this.genGain || !this.buzzGain || !this.humGain) return
        const t = this.ctx.currentTime
        const on = this.powerOn
        this.genGain.gain.setTargetAtTime(on ? 0.13 : 0, t, tc)
        this.buzzGain.gain.setTargetAtTime(on ? 0.05 : 0, t + (on ? 0.6 : 0), tc)
        this.humGain.gain.setTargetAtTime(on ? 0.6 : 0.35, t, tc)
        // The generator spools up (or down) through its pitch.
        const [saw, sq] = this.genOscs
        saw?.frequency.cancelScheduledValues(t)
        sq?.frequency.cancelScheduledValues(t)
        saw?.frequency.setTargetAtTime(on ? 48 : 30, t, on ? 1.2 : 0.6)
        sq?.frequency.setTargetAtTime(on ? 96 : 60, t, on ? 1.2 : 0.6)
    }

    /** Generator hum and buzzing lights fade in when the power is thrown. */
    setPowerOn(on: boolean) {
        this.powerOn = on
        this.applyPower(on ? 1.4 : 0.6)
    }

    private applyIntensity(tc: number) {
        if (!this.ctx) return
        const t = this.ctx.currentTime
        const i = this.intensity
        this.padGain?.gain.setTargetAtTime(0.1 * Math.pow(i, 1.3), t, tc)
        this.tenseGain?.gain.setTargetAtTime(0.02 * i * i, t, tc)
        this.pulseGain?.gain.setTargetAtTime(0.32 * Math.pow(Math.max(0, i - 0.12), 1.1), t, tc)
        this.pulseLfo?.frequency.setTargetAtTime(1.15 + i * 1.4, t, 1.0)
        this.droneGain?.gain.setTargetAtTime(0.16 + i * 0.06, t, tc)
    }

    /** 0 = quiet warehouse, 1 = the room is full of enemies: tense pad and pulse fade in. */
    setIntensity(amount: number) {
        this.intensity = clamp(amount, 0, 1)
        this.applyIntensity(0.9)
    }

    private scheduleAmbient() {
        if (this.ambTimer) clearTimeout(this.ambTimer)
        this.ambTimer = setTimeout(() => {
            this.ambTimer = null
            const ctx = this.ctx
            if (!ctx || !this.ambBus) return
            if (ctx.state === 'running' && !this.muted) {
                const now = ctx.currentTime
                const pan = rnd(-0.9, 0.9)
                const r = Math.random()
                const callReady = now - this.ambLastCall > 13 - this.intensity * 6
                if (callReady && r < 0.3 + this.intensity * 0.3) {
                    this.ambLastCall = now
                    this.xenoCall(pan, rnd(30, 55))
                } else if (r < 0.65) {
                    this.creak(pan)
                } else if (r < 0.85) {
                    this.clang(pan)
                } else {
                    this.skitter(pan)
                }
            }
            this.scheduleAmbient()
        }, rnd(2500, 7500))
    }

    /** Distant structural creak. */
    private creak(pan: number) {
        const v = this.voice({ pan, dist: rnd(22, 40), wet: 0.6 })
        const f = rnd(160, 380)
        const dur = rnd(0.8, 2)
        this.tonal(v, { dur, gain: 0.2, freq: f, freqEnd: f * rnd(0.75, 1.3), type: 'sawtooth', attack: 0.2, hold: dur * 0.3, filter: { type: 'bandpass', freq: f * 3, freqEnd: f * 2.2, q: 12 }, vib: { rate: rnd(5, 13), depth: f * 0.04 } })
        this.noise(v, { at: 0.1, dur: dur * 0.6, gain: 0.03, type: 'bandpass', freq: f * 4, q: 8, buf: 'pink', attack: 0.2 })
    }

    /** A far-away clang of something metal shifting. */
    private clang(pan: number) {
        const v = this.voice({ pan, dist: rnd(28, 45), wet: 0.7 })
        this.bell(v, { freq: rnd(220, 620), dur: rnd(1.5, 2.6), gain: 0.14 })
        this.thunk(v, 0, rnd(90, 140), 0.12)
    }

    /** Claws or debris skittering somewhere in the roof. */
    private skitter(pan: number) {
        const v = this.voice({ pan, dist: rnd(25, 40), wet: 0.5 })
        const n = Math.floor(rnd(4, 9))
        let at = 0
        for (let i = 0; i < n; i++) {
            at += rnd(0.04, 0.12)
            this.noise(v, { at, dur: 0.04, gain: rnd(0.05, 0.12), type: 'bandpass', freq: rnd(1500, 4000), q: 4, attack: 0.001 })
            this.tonal(v, { at, dur: 0.04, gain: 0.03, freq: rnd(500, 900), freqEnd: 300, type: 'triangle', attack: 0.001 })
        }
    }
}
