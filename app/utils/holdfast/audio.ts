// Holdfast: synthesised sound effects and a small generative medieval loop.
// Everything is generated with the Web Audio API, nothing is downloaded. The
// palette is deliberately soft and toy-like (wooden knocks, plucked strings,
// marimba blips, little bells) because it plays under a 20+ minute match.
// Combat sounds are rate limited per sound and capped globally, so a big
// fight thins out instead of clipping or eating the CPU.

export type HoldfastSound
    = | 'click'
      | 'hover'
      | 'place'
      | 'place-wall'
      | 'deploy'
      | 'invalid'
      | 'upgrade'
      | 'sell'
      | 'bow'
      | 'arrow-hit'
      | 'sword'
      | 'death-friendly'
      | 'death-enemy'
      | 'building-hit'
      | 'building-destroyed'
      | 'wave-horn'
      | 'income'
      | 'unlock'
      | 'victory'
      | 'defeat'
      | 'volley'
      | 'impact'
      | 'coin'
      | 'wave-cleared'
      | 'streak'
      | 'war-drums'
      | 'loot'
      | 'rally'
      | 'collapse'

export interface HoldfastPlayOptions {
    /** 0..1 multiplier, default 1. */
    volume?: number
    /** -1..1 stereo pan, default 0. */
    pan?: number
}

interface SoundRule {
    /** Max starts inside one rate window. */
    max: number
    /** Rate window length in ms. */
    window: number
    /** Random pitch spread (0.1 = ±10%). */
    vary: number
    /** Low-priority sounds are dropped once the voice cap is hit and duck as the mix fills up. */
    low: boolean
}

const RULES: Record<HoldfastSound, SoundRule> = {
    'click': { max: 1, window: 60, vary: 0.02, low: false },
    'hover': { max: 1, window: 50, vary: 0.03, low: true },
    'place': { max: 2, window: 80, vary: 0.04, low: false },
    'place-wall': { max: 2, window: 80, vary: 0.1, low: true },
    'deploy': { max: 2, window: 120, vary: 0.05, low: false },
    'invalid': { max: 1, window: 200, vary: 0, low: false },
    'upgrade': { max: 1, window: 120, vary: 0, low: false },
    'sell': { max: 2, window: 100, vary: 0.03, low: false },
    'bow': { max: 3, window: 80, vary: 0.12, low: true },
    'arrow-hit': { max: 3, window: 80, vary: 0.15, low: true },
    'sword': { max: 3, window: 80, vary: 0.1, low: true },
    'death-friendly': { max: 2, window: 80, vary: 0.08, low: true },
    'death-enemy': { max: 3, window: 80, vary: 0.12, low: true },
    'building-hit': { max: 2, window: 100, vary: 0.12, low: true },
    'building-destroyed': { max: 2, window: 200, vary: 0.06, low: false },
    'wave-horn': { max: 1, window: 1000, vary: 0, low: false },
    'income': { max: 1, window: 120, vary: 0.02, low: true },
    'unlock': { max: 1, window: 400, vary: 0, low: false },
    'victory': { max: 1, window: 3000, vary: 0, low: false },
    'defeat': { max: 1, window: 3000, vary: 0, low: false },
    'volley': { max: 2, window: 160, vary: 0.1, low: true },
    'impact': { max: 2, window: 120, vary: 0.1, low: false },
    'coin': { max: 3, window: 90, vary: 0.06, low: true },
    'wave-cleared': { max: 1, window: 1500, vary: 0, low: false },
    'streak': { max: 1, window: 600, vary: 0, low: false },
    'war-drums': { max: 1, window: 2000, vary: 0, low: false },
    'loot': { max: 1, window: 300, vary: 0.03, low: false },
    'rally': { max: 1, window: 1000, vary: 0, low: false },
    'collapse': { max: 2, window: 250, vary: 0.08, low: false }
}

const MAX_VOICES = 24
const MASTER_GAIN = 0.7
const SFX_GAIN = 0.85
const MUSIC_GAIN = 0.12

// Music: D minor pentatonic plucks over a D/A drone, chords Dm C Dm G.
const MELODY = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84]
const CHORDS: { root: number, tones: number[] }[] = [
    { root: 50, tones: [62, 65, 69] },
    { root: 48, tones: [60, 64, 67] },
    { root: 50, tones: [62, 65, 69] },
    { root: 43, tones: [59, 62, 67] }
]
const WALK = [-2, -1, -1, 0, 1, 1, 2]

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12)
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

interface ToneOpts {
    type?: OscillatorType
    gain?: number
    to?: number
    glide?: number
    attack?: number
    cutoff?: number
}

interface NoiseOpts {
    type?: BiquadFilterType
    from?: number
    to?: number
    q?: number
    attack?: number
}

interface RateState {
    start: number
    count: number
}

interface MusicSession {
    out: GainNode
    calm: GainNode
    battle: GainNode
    oscs: AudioScheduledSourceNode[]
    /** Ambience: wind bed and the din of battle, on the sfx bus. */
    wind: GainNode
    din: GainNode
}

export class HoldfastAudio {
    private ctx: AudioContext | null = null
    private master: GainNode | null = null
    private sfxBus: GainNode | null = null
    private musicBus: GainNode | null = null
    private noiseBuffer: AudioBuffer | null = null
    private isMuted = false
    private disposed = false

    // voice limiting
    private rate = new Map<HoldfastSound, RateState>()
    private voiceEnds: number[] = []
    private building = false
    private voiceEnd = 0
    private voiceSrc: AudioScheduledSourceNode | null = null

    // music
    private musicWanted = false
    private music: MusicSession | null = null
    private musicTimer: number | null = null
    private step = 0
    private nextStepTime = 0
    private lastMusicTick = 0
    private targetIntensity = 0
    private intensity = 0
    private melodyIndex = 3

    get muted(): boolean {
        return this.isMuted
    }

    setMuted(muted: boolean): void {
        this.isMuted = muted
        if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.05)
    }

    /** Call from a user gesture (click/keydown) — creates/resumes the AudioContext. */
    unlock(): void {
        if (this.disposed || typeof window === 'undefined') return
        if (!this.ctx) {
            const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            if (!Ctor) return
            try {
                this.ctx = new Ctor()
            } catch {
                return
            }
            this.build(this.ctx)
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
        if (this.musicWanted) this.beginMusic()
    }

    private build(ctx: AudioContext): void {
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.value = -18
        comp.knee.value = 12
        comp.ratio.value = 4
        comp.attack.value = 0.005
        comp.release.value = 0.25
        comp.connect(ctx.destination)
        this.master = ctx.createGain()
        this.master.gain.value = this.isMuted ? 0 : MASTER_GAIN
        this.master.connect(comp)
        this.sfxBus = ctx.createGain()
        this.sfxBus.gain.value = SFX_GAIN
        this.sfxBus.connect(this.master)
        this.musicBus = ctx.createGain()
        this.musicBus.gain.value = MUSIC_GAIN
        this.musicBus.connect(this.master)

        // One shared noise buffer; every noise voice reads a random slice of it.
        const len = ctx.sampleRate * 2
        const buf = ctx.createBuffer(1, len, ctx.sampleRate)
        const data = buf.getChannelData(0)
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
        this.noiseBuffer = buf
    }

    dispose(): void {
        this.stopMusic()
        this.disposed = true
        if (this.ctx) void this.ctx.close().catch(() => {})
        this.ctx = null
        this.master = null
        this.sfxBus = null
        this.musicBus = null
        this.noiseBuffer = null
        this.music = null
        this.voiceSrc = null
        this.voiceEnds = []
        this.rate.clear()
    }

    // ── SFX ──────────────────────────────────────────────────────────────

    play(sound: HoldfastSound, options: HoldfastPlayOptions = {}): void {
        const ctx = this.ctx
        const bus = this.sfxBus
        if (!ctx || !bus || this.isMuted || this.disposed) return
        const rule = RULES[sound]
        // A suspended context would queue these up and fire them all at once on resume.
        if (rule.low && ctx.state !== 'running') return
        const volume = clamp(options.volume ?? 1, 0, 1)
        if (volume < 0.001) return

        const nowMs = performance.now()
        let rs = this.rate.get(sound)
        if (!rs) {
            rs = { start: nowMs, count: 0 }
            this.rate.set(sound, rs)
        }
        if (nowMs - rs.start >= rule.window) {
            rs.start = nowMs
            rs.count = 0
        }
        if (rs.count >= rule.max) return

        const t = ctx.currentTime
        const active = this.pruneVoices(t)
        if (rule.low && active >= MAX_VOICES) return
        rs.count++

        const duck = rule.low ? 1 / Math.sqrt(1 + active / 8) : 1
        const jitter = rule.low ? 0.85 + Math.random() * 0.15 : 1
        const p = 1 + (Math.random() * 2 - 1) * rule.vary

        const out = ctx.createGain()
        out.gain.value = volume * duck * jitter
        const pan = clamp(options.pan ?? 0, -1, 1)
        let panner: StereoPannerNode | null = null
        if (Math.abs(pan) > 0.01) {
            panner = ctx.createStereoPanner()
            panner.pan.value = pan
            out.connect(panner)
            panner.connect(bus)
        } else {
            out.connect(bus)
        }

        this.building = true
        this.voiceEnd = 0
        this.voiceSrc = null
        this.render(sound, out, t, p)
        this.building = false

        const src = this.voiceSrc as AudioScheduledSourceNode | null
        this.voiceSrc = null
        if (!src) {
            out.disconnect()
            panner?.disconnect()
            return
        }
        this.voiceEnds.push(this.voiceEnd)
        src.onended = () => {
            out.disconnect()
            panner?.disconnect()
        }
    }

    private pruneVoices(now: number): number {
        const ends = this.voiceEnds
        let n = 0
        for (let i = 0; i < ends.length; i++) {
            const e = ends[i]!
            if (e > now) ends[n++] = e
        }
        ends.length = n
        return n
    }

    private render(sound: HoldfastSound, out: AudioNode, t: number, p: number): void {
        switch (sound) {
            case 'click':
                this.mallet(out, t, 784 * p, 0.13, 0.13)
                this.noise(out, t, 0.015, 0.03, { type: 'bandpass', from: 2600, q: 2 })
                break
            case 'hover':
                this.tone(out, t, 1568 * p, 0.035, { gain: 0.018, attack: 0.003 })
                break
            case 'place':
                this.thunk(out, t, 150 * p, 0.28, 0.16)
                this.noise(out, t, 0.09, 0.07, { type: 'lowpass', from: 900 })
                this.bell(out, t + 0.06, 1568, 0.25, 0.035)
                this.bell(out, t + 0.11, 2093, 0.3, 0.028)
                break
            case 'place-wall':
                this.thunk(out, t, 230 * p, 0.11, 0.08)
                break
            case 'deploy':
                this.noise(out, t, 0.32, 0.07, { type: 'bandpass', from: 350, to: 1800, q: 0.8, attack: 0.14 })
                this.frameDrum(out, t + 0.16, 0.22, p)
                this.frameDrum(out, t + 0.28, 0.12, p * 1.12)
                break
            case 'invalid':
                this.tone(out, t, 330, 0.16, { gain: 0.09, to: 220, attack: 0.01 })
                this.tone(out, t + 0.09, 262, 0.2, { gain: 0.07, to: 175, attack: 0.01 })
                break
            case 'upgrade': {
                const notes = [587, 740, 880, 1175]
                for (let i = 0; i < notes.length; i++) this.pluck(out, t + i * 0.065, notes[i]!, 0.35, 0.09, 6)
                this.bell(out, t + 0.26, 1760, 0.5, 0.03)
                break
            }
            case 'sell': {
                this.thunk(out, t, 200 * p, 0.08, 0.1)
                const notes = [1568, 1319, 1047]
                for (let i = 0; i < notes.length; i++) this.bell(out, t + 0.03 + i * 0.06, notes[i]! * p, 0.22, 0.055)
                break
            }
            case 'bow':
                this.pluck(out, t, 420 * p, 0.14, 0.06, 7, 1.08)
                this.tone(out, t, 840 * p, 0.06, { type: 'triangle', gain: 0.015, to: 600 * p })
                this.noise(out, t + 0.01, 0.05, 0.015, { type: 'highpass', from: 3500 })
                break
            case 'arrow-hit':
                this.tone(out, t, 180 * p, 0.08, { gain: 0.08, to: 90 * p, attack: 0.002 })
                this.noise(out, t, 0.035, 0.035, { type: 'lowpass', from: 1200 })
                break
            case 'sword': {
                const f = (1900 + Math.random() * 700) * p
                this.tone(out, t, f, 0.09, { gain: 0.03, attack: 0.001 })
                this.tone(out, t, f * 2.4, 0.05, { gain: 0.012, attack: 0.001 })
                this.noise(out, t, 0.02, 0.02, { type: 'highpass', from: 5000 })
                this.tone(out, t, 260 * p, 0.05, { type: 'triangle', gain: 0.03, to: 150 * p })
                break
            }
            case 'death-friendly':
                this.tone(out, t, 587 * p, 0.3, { type: 'triangle', gain: 0.06, to: 330 * p, attack: 0.01, cutoff: 1600 })
                this.tone(out, t + 0.08, 440 * p, 0.32, { gain: 0.04, to: 247 * p, attack: 0.01 })
                break
            case 'death-enemy':
                this.tone(out, t, 260 * p, 0.08, { gain: 0.09, to: 820 * p, glide: 0.05, attack: 0.002 })
                this.noise(out, t, 0.03, 0.03, { type: 'bandpass', from: 1800 })
                this.bell(out, t + 0.03, 1319 * p, 0.12, 0.02)
                break
            case 'building-hit':
                this.thunk(out, t, 120 * p, 0.2, 0.16)
                this.noise(out, t, 0.06, 0.06, { type: 'bandpass', from: 600 })
                break
            case 'building-destroyed':
                this.noise(out, t, 0.8, 0.2, { type: 'lowpass', from: 2400, to: 180, attack: 0.01 })
                this.tone(out, t, 90 * p, 0.55, { gain: 0.32, to: 38, attack: 0.004 })
                for (let i = 0; i < 5; i++) {
                    this.noise(out, t + 0.05 + i * 0.07 + Math.random() * 0.03, 0.05, 0.07, { type: 'bandpass', from: 500 + Math.random() * 800, q: 1.5 })
                }
                this.thunk(out, t + 0.25, 100 * p, 0.12, 0.2)
                break
            case 'wave-horn':
                // A two-note call (D3 then A3), with a quieter late copy for distance.
                this.frameDrum(out, t, 0.12)
                this.brass(out, t, 147, 0.38, 0.13, { attack: 0.08, bright: 2.8 })
                this.brass(out, t + 0.36, 220, 0.85, 0.15, { attack: 0.12, to: 216, bright: 2.8 })
                this.brass(out, t + 0.62, 220, 0.6, 0.035, { attack: 0.15, to: 216, bright: 1.8 })
                break
            case 'income':
                this.bell(out, t, 2093 * p, 0.1, 0.022)
                break
            case 'unlock': {
                this.mallet(out, t, 523, 0.5, 0.06)
                const notes = [1047, 1319, 1568, 2093]
                for (let i = 0; i < notes.length; i++) this.bell(out, t + i * 0.07, notes[i]!, 0.9 - i * 0.1, 0.05)
                this.noise(out, t + 0.1, 0.5, 0.015, { type: 'highpass', from: 6000, to: 9000, attack: 0.1 })
                break
            }
            case 'victory': {
                // Da-da-da DAAA in D major, drums, then a marimba run and a bell.
                this.frameDrum(out, t, 0.2)
                this.brass(out, t, 294, 0.2, 0.1, { attack: 0.03 })
                this.brass(out, t + 0.18, 370, 0.2, 0.1, { attack: 0.03 })
                this.brass(out, t + 0.36, 440, 0.24, 0.1, { attack: 0.03 })
                this.frameDrum(out, t + 0.45, 0.1)
                this.frameDrum(out, t + 0.52, 0.12)
                this.frameDrum(out, t + 0.6, 0.26)
                for (const f of [294, 370, 440, 587]) this.brass(out, t + 0.6, f, 1.8, 0.07, { attack: 0.06 })
                const run = [587, 740, 880, 1175, 1480]
                for (let i = 0; i < run.length; i++) this.mallet(out, t + 0.65 + i * 0.08, run[i]!, 0.4, 0.06)
                this.bell(out, t + 1.1, 2349, 1.2, 0.025)
                this.frameDrum(out, t + 1.9, 0.14)
                break
            }
            case 'volley':
                // Many shafts cutting the air at once: a swelling, sweeping hiss.
                this.noise(out, t, 0.55, 0.09, { type: 'bandpass', from: 1400 * p, to: 3800 * p, q: 0.8, attack: 0.12 })
                this.noise(out, t + 0.05, 0.4, 0.05, { type: 'highpass', from: 4200, attack: 0.1 })
                break
            case 'impact':
                // Boulder landing: deep thump, crunch, trickling debris.
                this.tone(out, t, 70 * p, 0.45, { gain: 0.4, to: 32, attack: 0.003 })
                this.noise(out, t, 0.35, 0.22, { type: 'lowpass', from: 1800, to: 200, attack: 0.002 })
                for (let i = 0; i < 4; i++) this.noise(out, t + 0.08 + i * 0.06 + Math.random() * 0.04, 0.05, 0.05, { type: 'bandpass', from: 900 + Math.random() * 1200, q: 2 })
                break
            case 'coin':
                this.bell(out, t, 2637 * p, 0.18, 0.035)
                this.bell(out, t + 0.05, 3520 * p, 0.22, 0.025)
                break
            case 'wave-cleared': {
                // Bright rising fanfare with a cymbal shimmer.
                this.frameDrum(out, t, 0.2)
                const notes = [392, 494, 587, 784]
                for (let i = 0; i < notes.length; i++) this.brass(out, t + i * 0.09, notes[i]!, 0.35 + (i === 3 ? 0.6 : 0), 0.08, { attack: 0.02, bright: 3 })
                for (let i = 0; i < 5; i++) this.bell(out, t + 0.35 + i * 0.05, 1568 + i * 262, 0.6, 0.03)
                this.noise(out, t + 0.3, 1.1, 0.04, { type: 'highpass', from: 7000, attack: 0.02 })
                break
            }
            case 'streak': {
                const run = [880, 1109, 1319, 1760, 2217]
                for (let i = 0; i < run.length; i++) this.mallet(out, t + i * 0.045, run[i]!, 0.35, 0.07)
                this.frameDrum(out, t, 0.18, 1.2)
                this.noise(out, t, 0.3, 0.05, { type: 'highpass', from: 5000, to: 9000, attack: 0.01 })
                break
            }
            case 'war-drums':
                // The enemy host arrives: a rolling, heavy drum pattern.
                for (let i = 0; i < 8; i++) {
                    const g = i % 4 === 0 ? 0.32 : 0.18
                    this.frameDrum(out, t + i * 0.16 + (i % 2) * 0.02, g, i % 4 === 0 ? 0.7 : 0.9)
                    if (i % 4 === 0) this.tone(out, t + i * 0.16, 55, 0.35, { gain: 0.22, to: 40 })
                }
                break
            case 'loot': {
                const notes = [1319, 1568, 2093, 2637]
                for (let i = 0; i < notes.length; i++) this.bell(out, t + i * 0.06, notes[i]!, 0.5, 0.04)
                this.noise(out, t, 0.4, 0.03, { type: 'highpass', from: 8000, attack: 0.05 })
                break
            }
            case 'rally':
                this.brass(out, t, 196, 0.3, 0.14, { attack: 0.04, bright: 3.2 })
                this.brass(out, t + 0.25, 294, 0.8, 0.16, { attack: 0.05, bright: 3.4 })
                // A roar of voices: formant-ish filtered noise.
                this.noise(out, t + 0.2, 0.9, 0.12, { type: 'bandpass', from: 650, to: 900, q: 1.2, attack: 0.15 })
                this.noise(out, t + 0.2, 0.9, 0.06, { type: 'bandpass', from: 1500, to: 1800, q: 1.5, attack: 0.15 })
                this.frameDrum(out, t, 0.3, 0.8)
                break
            case 'collapse':
                this.tone(out, t, 60 * p, 0.9, { gain: 0.35, to: 28, attack: 0.01 })
                this.noise(out, t, 1.2, 0.2, { type: 'lowpass', from: 1500, to: 120, attack: 0.02 })
                for (let i = 0; i < 7; i++) this.thunk(out, t + 0.1 + i * 0.09 + Math.random() * 0.05, (90 + Math.random() * 80) * p, 0.1, 0.12)
                break
            case 'defeat':
                // A-G-F then a sagging low D, like a tired horn.
                this.brass(out, t, 220, 0.45, 0.1, { attack: 0.06, bright: 2.4 })
                this.brass(out, t + 0.4, 196, 0.45, 0.1, { attack: 0.06, bright: 2.2 })
                this.brass(out, t + 0.8, 175, 0.45, 0.1, { attack: 0.06, bright: 2 })
                this.brass(out, t + 1.2, 147, 0.9, 0.11, { attack: 0.08, to: 139, bright: 1.8 })
                this.tone(out, t + 1.2, 73.4, 0.9, { gain: 0.08, attack: 0.05 })
                this.frameDrum(out, t + 1.2, 0.18, 0.8)
                break
        }
    }

    // ── Primitives ───────────────────────────────────────────────────────

    /** Remembers the voice's longest-running source so play() can clean up after it. */
    private track(src: AudioScheduledSourceNode, end: number): void {
        if (!this.building || end < this.voiceEnd) return
        this.voiceEnd = end
        this.voiceSrc = src
    }

    private tone(out: AudioNode, t: number, freq: number, dur: number, o: ToneOpts = {}): void {
        const ctx = this.ctx!
        const osc = ctx.createOscillator()
        osc.type = o.type ?? 'sine'
        osc.frequency.setValueAtTime(freq, t)
        if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.glide ?? dur))
        const g = ctx.createGain()
        const attack = Math.min(o.attack ?? 0.004, dur * 0.5)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain ?? 0.1), t + attack)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        if (o.cutoff) {
            const f = ctx.createBiquadFilter()
            f.type = 'lowpass'
            f.frequency.value = o.cutoff
            osc.connect(f)
            f.connect(g)
        } else {
            osc.connect(g)
        }
        g.connect(out)
        osc.start(t)
        osc.stop(t + dur + 0.02)
        this.track(osc, t + dur + 0.02)
    }

    private noise(out: AudioNode, t: number, dur: number, gain: number, o: NoiseOpts = {}): void {
        const ctx = this.ctx!
        const buf = this.noiseBuffer
        if (!buf) return
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.playbackRate.value = 0.85 + Math.random() * 0.3
        const f = ctx.createBiquadFilter()
        f.type = o.type ?? 'bandpass'
        f.Q.value = o.q ?? 1
        f.frequency.setValueAtTime(o.from ?? 1200, t)
        if (o.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur)
        const g = ctx.createGain()
        const attack = Math.min(o.attack ?? 0.003, dur * 0.5)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        src.connect(f)
        f.connect(g)
        g.connect(out)
        src.start(t, Math.random() * Math.max(0, buf.duration - dur - 0.2))
        src.stop(t + dur + 0.02)
        this.track(src, t + dur + 0.02)
    }

    /** Plucked string: a triangle whose lowpass closes like a damped string. `bend` > 1 starts it sharp. */
    private pluck(out: AudioNode, t: number, freq: number, dur: number, gain: number, bright = 5, bend = 1): void {
        const ctx = this.ctx!
        const osc = ctx.createOscillator()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq * bend, t)
        if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq, t + 0.04)
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.Q.value = 0.8
        f.frequency.setValueAtTime(Math.min(12000, freq * bright), t)
        f.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 1.1), t + dur * 0.7)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.003)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        osc.connect(f)
        f.connect(g)
        g.connect(out)
        osc.start(t)
        osc.stop(t + dur + 0.02)
        this.track(osc, t + dur + 0.02)
    }

    /** Marimba: fundamental plus a short 4th partial. */
    private mallet(out: AudioNode, t: number, freq: number, dur: number, gain: number): void {
        this.tone(out, t, freq, dur, { gain, attack: 0.002 })
        this.tone(out, t, freq * 4, dur * 0.3, { gain: gain * 0.3, attack: 0.001 })
    }

    /** Small bell or coin: inharmonic partials that die off faster than the fundamental. */
    private bell(out: AudioNode, t: number, freq: number, dur: number, gain: number): void {
        this.tone(out, t, freq, dur, { gain, attack: 0.001 })
        this.tone(out, t, freq * 2.76, dur * 0.55, { gain: gain * 0.35, attack: 0.001 })
        this.tone(out, t, freq * 5.4, dur * 0.25, { gain: gain * 0.12, attack: 0.001 })
    }

    /** Wooden knock: a quick pitch drop, a woody click and a breath of filtered noise. */
    private thunk(out: AudioNode, t: number, freq: number, gain: number, dur = 0.14): void {
        this.tone(out, t, freq * 1.7, dur, { gain, to: freq * 0.85, glide: 0.05, attack: 0.002 })
        this.tone(out, t, freq * 2.5, dur * 0.35, { type: 'triangle', gain: gain * 0.25, to: freq * 1.5, attack: 0.001 })
        this.noise(out, t, 0.035, gain * 0.35, { type: 'bandpass', from: freq * 6, q: 1.2 })
    }

    private frameDrum(out: AudioNode, t: number, gain: number, p = 1): void {
        this.tone(out, t, 150 * p, 0.28, { gain, to: 70 * p, glide: 0.08, attack: 0.002 })
        this.noise(out, t, 0.05, gain * 0.3, { type: 'lowpass', from: 700 })
        this.noise(out, t, 0.02, gain * 0.12, { type: 'bandpass', from: 1800 })
    }

    /** Soft brass: detuned saws and a triangle through a lowpass that swells open, with a late vibrato. */
    private brass(out: AudioNode, t: number, freq: number, dur: number, gain: number, o: { to?: number, attack?: number, bright?: number } = {}): void {
        const ctx = this.ctx!
        const attack = Math.min(o.attack ?? 0.06, dur * 0.5)
        const bright = o.bright ?? 3.2
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.Q.value = 0.9
        f.frequency.setValueAtTime(freq * 1.1, t)
        f.frequency.linearRampToValueAtTime(freq * bright, t + attack + 0.04)
        f.frequency.linearRampToValueAtTime(freq * bright * 0.6, t + dur)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack)
        g.gain.linearRampToValueAtTime(gain * 0.75, t + Math.max(attack + 0.01, dur * 0.65))
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        f.connect(g)
        g.connect(out)

        const vib = ctx.createOscillator()
        vib.frequency.value = 5
        const vibDepth = ctx.createGain()
        vibDepth.gain.setValueAtTime(0, t)
        vibDepth.gain.linearRampToValueAtTime(freq * 0.007, t + Math.min(dur, 0.35))
        vib.connect(vibDepth)

        const end = t + dur + 0.03
        const voices: { type: OscillatorType, detune: number, level: number }[] = [
            { type: 'sawtooth', detune: 0, level: 1 },
            { type: 'sawtooth', detune: 6, level: 1 },
            { type: 'triangle', detune: 0, level: 1.5 }
        ]
        let last: OscillatorNode = vib
        for (const v of voices) {
            const osc = ctx.createOscillator()
            osc.type = v.type
            osc.detune.value = v.detune
            osc.frequency.setValueAtTime(freq, t)
            if (o.to !== undefined) {
                osc.frequency.setValueAtTime(freq, t + dur * 0.4)
                osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur)
            }
            vibDepth.connect(osc.frequency)
            const lv = ctx.createGain()
            lv.gain.value = v.level / voices.length
            osc.connect(lv)
            lv.connect(f)
            osc.start(t)
            osc.stop(end)
            last = osc
        }
        vib.start(t)
        vib.stop(end)
        this.track(last, end)
    }

    // ── Music ────────────────────────────────────────────────────────────

    /** 0 calm … 1 heavy battle. Drives the ambient music loop smoothly (crossfade over ~2s). */
    setIntensity(value: number): void {
        this.targetIntensity = clamp(Number.isFinite(value) ? value : 0, 0, 1)
        this.applyLayerGains(false)
    }

    private applyLayerGains(immediate: boolean): void {
        const ctx = this.ctx
        const m = this.music
        if (!ctx || !m) return
        const v = this.targetIntensity
        const calm = 1 - 0.4 * v
        if (immediate) {
            m.battle.gain.value = v
            m.calm.gain.value = calm
            return
        }
        const now = ctx.currentTime
        m.battle.gain.setTargetAtTime(v, now, 0.6)
        m.calm.gain.setTargetAtTime(calm, now, 0.6)
        m.din.gain.setTargetAtTime(v * v * 0.09, now, 1)
        m.wind.gain.setTargetAtTime(0.05 - v * 0.02, now, 1.5)
    }

    startMusic(): void {
        if (this.disposed) return
        this.musicWanted = true
        this.beginMusic()
    }

    stopMusic(): void {
        this.musicWanted = false
        if (this.musicTimer !== null && typeof window !== 'undefined') window.clearInterval(this.musicTimer)
        this.musicTimer = null
        const m = this.music
        this.music = null
        const ctx = this.ctx
        if (!m || !ctx) return
        // Fade the whole session (drone plus any notes already scheduled ahead), then let it go.
        const now = ctx.currentTime
        m.out.gain.cancelScheduledValues(now)
        m.out.gain.setValueAtTime(m.out.gain.value, now)
        m.out.gain.linearRampToValueAtTime(0, now + 0.4)
        m.wind.gain.setTargetAtTime(0, now, 0.15)
        m.din.gain.setTargetAtTime(0, now, 0.15)
        for (const osc of m.oscs) osc.stop(now + 0.5)
        const first = m.oscs[0]
        if (first) first.onended = () => m.out.disconnect()
    }

    private beginMusic(): void {
        const ctx = this.ctx
        const bus = this.musicBus
        if (!ctx || !bus || this.music || this.disposed || typeof window === 'undefined') return

        const out = ctx.createGain()
        out.gain.setValueAtTime(0, ctx.currentTime)
        out.gain.linearRampToValueAtTime(1, ctx.currentTime + 2)
        out.connect(bus)
        const calm = ctx.createGain()
        calm.connect(out)
        const battle = ctx.createGain()
        battle.connect(out)

        // Soft D/A drone with a slowly breathing filter.
        const droneFilter = ctx.createBiquadFilter()
        droneFilter.type = 'lowpass'
        droneFilter.frequency.value = 420
        droneFilter.Q.value = 0.5
        const droneGain = ctx.createGain()
        droneGain.gain.value = 0.3
        droneFilter.connect(droneGain)
        droneGain.connect(out)
        const oscs: AudioScheduledSourceNode[] = []
        for (const [n, level, type] of [[38, 0.5, 'triangle'], [45, 0.35, 'triangle'], [50, 0.15, 'sine']] as const) {
            const osc = ctx.createOscillator()
            osc.type = type
            osc.frequency.value = midi(n)
            osc.detune.value = (Math.random() - 0.5) * 6
            const g = ctx.createGain()
            g.gain.value = level
            osc.connect(g)
            g.connect(droneFilter)
            osc.start()
            oscs.push(osc)
        }
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 0.07
        const lfoDepth = ctx.createGain()
        lfoDepth.gain.value = 120
        lfo.connect(lfoDepth)
        lfoDepth.connect(droneFilter.frequency)
        lfo.start()
        oscs.push(lfo)

        // Ambience: a soft wind bed and a battle din that swells with the fighting.
        const wind = ctx.createGain()
        const din = ctx.createGain()
        wind.gain.value = 0
        din.gain.value = 0
        if (this.noiseBuffer && this.sfxBus) {
            for (const [gainNode, type, freq, q] of [[wind, 'lowpass', 420, 0.6], [din, 'bandpass', 850, 0.7]] as const) {
                const src = ctx.createBufferSource()
                src.buffer = this.noiseBuffer
                src.loop = true
                src.playbackRate.value = gainNode === wind ? 0.6 : 1
                const f = ctx.createBiquadFilter()
                f.type = type
                f.frequency.value = freq
                f.Q.value = q
                src.connect(f)
                f.connect(gainNode)
                gainNode.connect(this.sfxBus)
                src.start()
                oscs.push(src)
            }
            wind.gain.setTargetAtTime(0.05, ctx.currentTime, 2)
        }
        this.music = { out, calm, battle, oscs, wind, din }
        this.intensity = this.targetIntensity
        this.applyLayerGains(true)
        this.step = 0
        this.melodyIndex = 3
        this.nextStepTime = ctx.currentTime + 0.1
        this.lastMusicTick = ctx.currentTime
        this.musicTimer = window.setInterval(() => this.scheduleMusic(), 100)
        this.scheduleMusic()
    }

    private scheduleMusic(): void {
        const ctx = this.ctx
        const m = this.music
        if (!ctx || !m) return
        const now = ctx.currentTime
        const dt = clamp(now - this.lastMusicTick, 0, 0.5)
        this.lastMusicTick = now
        // Glide the pattern's intensity toward the target over about two seconds.
        const diff = this.targetIntensity - this.intensity
        const maxStep = dt * 0.5
        this.intensity += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep
        // After a throttled background tab, resync instead of firing a burst of catch-up notes.
        if (this.nextStepTime < now - 0.25) this.nextStepTime = now + 0.05
        while (this.nextStepTime < now + 0.3) {
            if (!this.isMuted) this.scheduleStep(this.nextStepTime, this.step, m)
            const bpm = 80 + 24 * this.intensity
            this.nextStepTime += 60 / bpm / 4
            this.step = (this.step + 1) % 64
        }
    }

    private scheduleStep(t: number, s: number, m: MusicSession): void {
        const I = this.intensity
        const bar = Math.floor(s / 16) % CHORDS.length
        const pos = s % 16
        const chord = CHORDS[bar]!

        // Birdsong over the meadow while it's calm.
        if (I < 0.35 && pos % 4 === 0 && Math.random() < 0.06 && this.sfxBus) {
            const f = 2600 + Math.random() * 1800
            for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
                this.tone(this.sfxBus, t + i * 0.09, f * (1 + Math.random() * 0.2), 0.07, { gain: 0.012, to: f * 1.35, glide: 0.06, attack: 0.01 })
            }
        }

        // Bass pluck on beats one and three.
        if (pos === 0 || pos === 8) this.pluck(m.calm, t, midi(chord.root), 0.9, pos === 0 ? 0.5 : 0.35, 4)

        // A gentle harp strum every other bar while things are calm.
        if (pos === 0 && bar % 2 === 0 && I < 0.7) {
            const level = 0.14 * (1 - I / 0.7)
            for (let i = 0; i < chord.tones.length; i++) this.pluck(m.calm, t + 0.02 + i * 0.05, midi(chord.tones[i]!), 1.4, level, 3)
        }

        // Melody: sparse eighths when calm, denser and adding sixteenths as the battle heats up.
        const eighth = pos % 2 === 0
        const density = eighth ? 0.3 + 0.35 * I : Math.max(0, I - 0.45) * 0.7
        if (Math.random() < density) {
            const note = this.nextMelodyNote(pos === 0 ? chord.tones : null)
            const fast = !eighth
            this.pluck(fast ? m.battle : m.calm, t, midi(note), fast ? 0.35 : 0.6, fast ? 0.32 : 0.45, 5)
        }

        // Frame drum and shaker live on the battle layer, whose gain is the crossfade.
        if (I > 0.02) {
            const fadeIn = (from: number): number => clamp((I - from) / 0.2, 0, 1)
            if (pos === 0) this.frameDrum(m.battle, t, 0.8)
            if (pos === 8) this.frameDrum(m.battle, t, 0.6)
            if (pos === 6 || pos === 14) {
                const g = 0.4 * fadeIn(0.35)
                if (g > 0.01) this.frameDrum(m.battle, t, g, 1.15)
            }
            if (pos === 3 || pos === 11) {
                const g = 0.25 * fadeIn(0.7)
                if (g > 0.01) this.frameDrum(m.battle, t, g, 1.3)
            }
            if (eighth) {
                const g = (pos % 4 === 2 ? 0.18 : 0.1) * fadeIn(0.25)
                if (g > 0.01) this.noise(m.battle, t, 0.045, g, { type: 'highpass', from: 6000, attack: 0.008 })
            }
        }
    }

    private nextMelodyNote(chordTones: number[] | null): number {
        if (chordTones) {
            // Land on the chord tone (in the melody's range) closest to where the tune is.
            const pcs = new Set(chordTones.map(n => n % 12))
            let best = this.melodyIndex
            let bestDist = Infinity
            for (let i = 0; i < MELODY.length; i++) {
                if (!pcs.has(MELODY[i]! % 12)) continue
                const d = Math.abs(i - this.melodyIndex)
                if (d < bestDist) {
                    bestDist = d
                    best = i
                }
            }
            this.melodyIndex = best
        } else {
            let next = this.melodyIndex + WALK[Math.floor(Math.random() * WALK.length)]!
            if (next < 0 || next >= MELODY.length) next = this.melodyIndex + (next < 0 ? 1 : -1)
            this.melodyIndex = clamp(next, 0, MELODY.length - 1)
        }
        return MELODY[this.melodyIndex]!
    }
}
