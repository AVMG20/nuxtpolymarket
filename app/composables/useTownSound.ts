// Polytown sound effects — synthesised live with the Web Audio API.
//
// Nothing is downloaded: every cue is a handful of oscillators and the odd
// filtered noise burst shaped by gain envelopes, so the town page stays a
// zero-asset route and works the moment it renders. State lives at module
// scope so every caller shares one mixer and one persisted preference.

export type TownSoundEvent
    = | 'click'
      | 'open'
      | 'close'
      | 'place'
      | 'complete'
      | 'upgrade'
      | 'rush'
      | 'coin'
      | 'bigcoin'
      | 'buy'
      | 'error'
      | 'demolish'
      | 'plot'
      | 'select'
      | 'tab'
      | 'rotate'
      | 'pickup'
      | 'road'
      | 'tick'
      | 'deny'
      | 'stamp'
      | 'reward'
      | 'chest'
      | 'streak'
      | 'reset'
      | 'gem'
      | 'whoosh'
      | 'land'
      | 'count'
      | 'rattle'
      | 'chestDrop'
      | 'chestRattle'
      | 'chestBurst'
      | 'cardLand'
      | 'extraReveal'
      | 'luckyUpgrade'
      | 'collect'

const STORAGE_KEY = 'polytown-sound'

/** Ceiling before the user's volume slider is applied. Deliberately gentle. */
const MASTER_GAIN = 0.25

/** Spamming a cue (holding a build button) must not stack into a wall. */
const COOLDOWN_MS = 60

/** A paint drag ticks once per tile, so its cue may repeat faster than the rest. */
const COOLDOWN_OVERRIDES: Partial<Record<TownSoundEvent, number>> = { tick: 25, rotate: 40, land: 35, count: 45, cardLand: 30, extraReveal: 30 }

/** Long cues that a skip cuts short: each plays on its own bus, which stop() fades out. */
const STOPPABLE = new Set<TownSoundEvent>(['chestRattle'])

const enabled = ref(true)
const volume = ref(70)

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null
let hydrated = false
let watching = false
/** Where tone() and noise() send their output while a cue renders: the master, or a stoppable cue's bus. */
let dest: AudioNode | null = null
const buses = new Map<TownSoundEvent, GainNode>()

const lastPlayedAt = new Map<TownSoundEvent, number>()

interface StoredPrefs {
    enabled?: unknown
    volume?: unknown
}

function hydrate() {
    if (hydrated || !import.meta.client) return
    hydrated = true
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw) as StoredPrefs
        if (typeof parsed.enabled === 'boolean') enabled.value = parsed.enabled
        if (typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)) {
            volume.value = Math.max(0, Math.min(100, Math.round(parsed.volume)))
        }
    } catch {
        // Private mode / blocked storage — defaults are fine.
    }
}

function persist() {
    if (!import.meta.client) return
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: enabled.value, volume: volume.value }))
    } catch {
        // Ignore quota / privacy errors.
    }
}

function masterLevel(): number {
    if (!enabled.value) return 0
    return MASTER_GAIN * Math.max(0, Math.min(100, volume.value)) / 100
}

function ensure(): AudioContext | null {
    if (!import.meta.client) return null
    if (ctx) {
        if (ctx.state === 'suspended') void ctx.resume()
        return ctx
    }
    const win = window as unknown as { AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }
    const Ctor = win.AudioContext ?? win.webkitAudioContext
    if (!Ctor) return null

    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = masterLevel()
    master.connect(ctx.destination)

    // One second of white noise, reused by every percussive cue.
    const length = Math.max(1, Math.floor(ctx.sampleRate))
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    // Cosmetic audio texture only — never decides an outcome.
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1

    return ctx
}

interface ToneOpts {
    /** Offset in seconds from "now". */
    at?: number
    freq: number
    freqEnd?: number
    type?: OscillatorType
    dur: number
    gain: number
    attack?: number
}

function tone(o: ToneOpts) {
    const c = ctx
    const out = dest ?? master
    if (!c || !out) return

    const at = c.currentTime + (o.at ?? 0)
    const osc = c.createOscillator()
    const g = c.createGain()

    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(Math.max(20, o.freq), at)
    if (o.freqEnd !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), at + o.dur)
    }

    const attack = o.attack ?? 0.008
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), at + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur)

    osc.connect(g)
    g.connect(out)
    osc.start(at)
    osc.stop(at + o.dur + 0.02)
}

interface NoiseOpts {
    at?: number
    dur: number
    gain: number
    type?: BiquadFilterType
    freq: number
    freqEnd?: number
    q?: number
    /** Swell in over this long instead of starting at full gain. */
    attack?: number
}

function noise(o: NoiseOpts) {
    const c = ctx
    const out = dest ?? master
    if (!c || !out || !noiseBuffer) return

    const at = c.currentTime + (o.at ?? 0)
    const src = c.createBufferSource()
    src.buffer = noiseBuffer

    const filter = c.createBiquadFilter()
    filter.type = o.type ?? 'lowpass'
    filter.frequency.setValueAtTime(Math.max(30, o.freq), at)
    if (o.freqEnd !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqEnd), at + o.dur)
    }
    if (o.q !== undefined) filter.Q.value = o.q

    const g = c.createGain()
    if (o.attack) {
        g.gain.setValueAtTime(0.0001, at)
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), at + o.attack)
    } else {
        g.gain.setValueAtTime(Math.max(0.0002, o.gain), at)
    }
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur)

    src.connect(filter)
    filter.connect(g)
    g.connect(out)
    src.start(at)
    src.stop(at + o.dur + 0.02)
}

/** Cosmetic variety: the same cue a few cents apart reads as one hand, not a loop. */
function detune(cents: number) {
    return Math.pow(2, ((Math.random() * 2 - 1) * cents) / 1200)
}

function render(event: TownSoundEvent, pitch: number, variant: number) {
    switch (event) {
        case 'click':
            tone({ freq: 880, freqEnd: 660, type: 'sine', dur: 0.05, gain: 0.16, attack: 0.004 })
            break

        case 'open':
            tone({ freq: 420, freqEnd: 900, type: 'triangle', dur: 0.16, gain: 0.16 })
            noise({ at: 0.01, dur: 0.12, gain: 0.03, type: 'bandpass', freq: 900, freqEnd: 2600, q: 1.2 })
            break

        case 'close':
            tone({ freq: 700, freqEnd: 300, type: 'triangle', dur: 0.16, gain: 0.15 })
            break

        case 'place': {
            // Wooden thunk under a short rising confirmation blip.
            const d = detune(40)
            noise({ dur: 0.13, gain: 0.22, type: 'lowpass', freq: 620 * d, freqEnd: 180, q: 0.8 })
            tone({ freq: 150 * d, freqEnd: 90, type: 'sine', dur: 0.12, gain: 0.2 })
            tone({ at: 0.05, freq: 330 * d, freqEnd: 560 * d, type: 'triangle', dur: 0.14, gain: 0.14 })
            // A second knock settling, a beat behind the first.
            noise({ at: 0.07, dur: 0.07, gain: 0.08, type: 'lowpass', freq: 900 * d, freqEnd: 300, q: 1 })
            break
        }

        case 'road': {
            // Gravel crunch: a dry noise burst with no tune, so a long run stays calm.
            const d = detune(80)
            noise({ dur: 0.09, gain: 0.16, type: 'bandpass', freq: 2200 * d, freqEnd: 900, q: 0.9 })
            noise({ at: 0.03, dur: 0.1, gain: 0.1, type: 'lowpass', freq: 700 * d, freqEnd: 200 })
            tone({ freq: 120 * d, freqEnd: 80, type: 'sine', dur: 0.08, gain: 0.1 })
            break
        }

        case 'select':
            // Soft wooden tap, higher than 'click' so picking a building reads apart from buttons.
            tone({ freq: 1250 * detune(30), freqEnd: 980, type: 'triangle', dur: 0.06, gain: 0.12, attack: 0.003 })
            noise({ dur: 0.03, gain: 0.04, type: 'highpass', freq: 3500 })
            break

        case 'tab':
            tone({ freq: 640, freqEnd: 720, type: 'sine', dur: 0.05, gain: 0.1, attack: 0.003 })
            break

        case 'rotate':
            // Quick swish with a ratchet click on the end.
            noise({ dur: 0.1, gain: 0.07, type: 'bandpass', freq: 1400, freqEnd: 3800, q: 2 })
            tone({ at: 0.06, freq: 1800 * detune(25), type: 'square', dur: 0.025, gain: 0.04, attack: 0.002 })
            break

        case 'pickup':
            // The inverse of 'place': a lift that rises off the ground.
            noise({ dur: 0.1, gain: 0.08, type: 'lowpass', freq: 400, freqEnd: 1400, q: 0.8 })
            tone({ freq: 260, freqEnd: 620, type: 'triangle', dur: 0.14, gain: 0.12 })
            break

        case 'tick':
            // One step of a paint drag; the caller raises the pitch as the run grows.
            tone({ freq: 520 * pitch, type: 'triangle', dur: 0.045, gain: 0.07, attack: 0.002 })
            tone({ freq: 1040 * pitch, type: 'sine', dur: 0.03, gain: 0.025, attack: 0.002 })
            break

        case 'stamp': {
            // A contract signed off: a rubber stamp thud, then the coins drop in.
            noise({ dur: 0.08, gain: 0.25, type: 'lowpass', freq: 500, freqEnd: 120, q: 1 })
            tone({ freq: 95, freqEnd: 55, type: 'sine', dur: 0.14, gain: 0.24 })
            const pings = [2350, 2900, 2600, 3300]
            pings.forEach((freq, i) => {
                tone({ at: 0.14 + i * 0.055, freq: freq * detune(30), type: 'square', dur: 0.07, gain: 0.045, attack: 0.002 })
            })
            break
        }

        case 'reward': {
            // A track step claimed: a bright two-note chime with a shimmer tail.
            tone({ freq: 987.8, type: 'triangle', dur: 0.14, gain: 0.14 })
            tone({ at: 0.07, freq: 1318.5, type: 'triangle', dur: 0.3, gain: 0.15 })
            tone({ at: 0.07, freq: 2637, type: 'sine', dur: 0.22, gain: 0.04 })
            noise({ at: 0.06, dur: 0.3, gain: 0.025, type: 'highpass', freq: 6000, freqEnd: 10000 })
            break
        }

        case 'chest': {
            // A loot box: a wooden creak and rattle building up, then a burst of sparkle.
            noise({ dur: 0.35, gain: 0.06, type: 'bandpass', freq: 300, freqEnd: 900, q: 3 })
            for (let i = 0; i < 5; i++) {
                noise({ at: 0.05 + i * 0.06, dur: 0.04, gain: 0.09, type: 'bandpass', freq: 1200 + i * 250, q: 4 })
            }
            tone({ at: 0.36, freq: 80, freqEnd: 45, type: 'sine', dur: 0.3, gain: 0.22 })
            const sparkle = [1568, 2093, 2637, 3136, 4186]
            sparkle.forEach((freq, i) => {
                tone({ at: 0.38 + i * 0.04, freq, type: 'sine', dur: 0.22, gain: 0.07, attack: 0.003 })
            })
            noise({ at: 0.36, dur: 0.6, gain: 0.05, type: 'highpass', freq: 5000, freqEnd: 11000 })
            break
        }

        case 'streak': {
            // A new day on the track: a rising five-note run that lands on a held chord.
            const run = [523.25, 659.25, 784, 1046.5, 1318.5]
            run.forEach((freq, i) => {
                tone({ at: i * 0.07, freq, type: 'triangle', dur: 0.16, gain: 0.12 })
            })
            for (const freq of [1046.5, 1318.5, 1568]) {
                tone({ at: 0.36, freq, type: 'triangle', dur: 0.6, gain: 0.07 })
            }
            noise({ at: 0.36, dur: 0.5, gain: 0.03, type: 'highpass', freq: 5000, freqEnd: 9000 })
            break
        }

        case 'reset':
            // Rewinding the track: a falling sweep with a low thump to land on day one.
            noise({ dur: 0.45, gain: 0.08, type: 'bandpass', freq: 4000, freqEnd: 300, q: 1.5 })
            tone({ freq: 900, freqEnd: 180, type: 'triangle', dur: 0.4, gain: 0.1 })
            tone({ at: 0.4, freq: 110, freqEnd: 60, type: 'sine', dur: 0.25, gain: 0.2 })
            break

        case 'gem': {
            // A gem won: a glassy run climbing an E major arpeggio, with a crystal shimmer on top.
            const run = [1318.5, 1661.2, 1975.5, 2637, 3322.4]
            run.forEach((freq, i) => {
                tone({ at: i * 0.05, freq, type: 'sine', dur: 0.24, gain: 0.09, attack: 0.003 })
                tone({ at: i * 0.05, freq: freq * 2.01, type: 'sine', dur: 0.1, gain: 0.025, attack: 0.002 })
            })
            tone({ at: 0.25, freq: 3951, type: 'triangle', dur: 0.45, gain: 0.05 })
            noise({ at: 0.04, dur: 0.55, gain: 0.03, type: 'highpass', freq: 6500, freqEnd: 12000 })
            break
        }

        case 'whoosh':
            // Coins taking off for the wallet: a soft airy sweep upward.
            noise({ dur: 0.26, gain: 0.07, type: 'bandpass', freq: 500, freqEnd: 3200, q: 1.4 })
            tone({ freq: 300, freqEnd: 700, type: 'sine', dur: 0.2, gain: 0.03 })
            break

        case 'land':
            // One coin dropping into the wallet; the caller raises the pitch as a stream lands.
            tone({ freq: 1900 * pitch, type: 'square', dur: 0.035, gain: 0.03, attack: 0.002 })
            tone({ freq: 2850 * pitch, type: 'sine', dur: 0.06, gain: 0.035, attack: 0.002 })
            break

        case 'count':
            // A tally ticking up; the caller raises the pitch as it nears the total.
            tone({ freq: 1500 * pitch, type: 'triangle', dur: 0.03, gain: 0.05, attack: 0.002 })
            break

        case 'rattle': {
            // A chest straining at its lock: knocks that crowd closer and climb. `pitch` stretches it to the shake.
            const knocks = [0, 0.16, 0.29, 0.4, 0.49, 0.57, 0.64, 0.7, 0.75, 0.8, 0.84, 0.88]
            knocks.forEach((t, i) => {
                const d = detune(60)
                noise({ at: t * pitch, dur: 0.05, gain: 0.08 + i * 0.008, type: 'bandpass', freq: (700 + i * 90) * d, q: 3 })
                tone({ at: t * pitch, freq: (140 + i * 12) * d, freqEnd: 90, type: 'triangle', dur: 0.06, gain: 0.07 + i * 0.006 })
            })
            break
        }

        // ── Chest opening ── `variant` is the chest tier (0 wooden, 1 silver, 2 golden) unless noted.

        case 'chestDrop': {
            // The chest slamming down: a deep thud, a wooden knock or a metal clang, and dust.
            const t = variant
            tone({ freq: 130 - t * 15, freqEnd: 38, type: 'sine', dur: 0.38 + t * 0.12, gain: 0.34 + t * 0.04 })
            noise({ dur: 0.28 + t * 0.08, gain: 0.26, type: 'lowpass', freq: 900, freqEnd: 90, q: 0.7 })
            if (t === 0) {
                noise({ dur: 0.09, gain: 0.2, type: 'bandpass', freq: 520, q: 2.5 })
                tone({ at: 0.09, freq: 210, freqEnd: 150, type: 'triangle', dur: 0.08, gain: 0.08 })
            } else {
                // Inharmonic partials ring like struck metal.
                const base = t === 1 ? 640 : 480
                for (const [ratio, g] of [[1, 0.07], [2.76, 0.045], [5.4, 0.03], [8.93, 0.018]] as const) {
                    tone({ freq: base * ratio, type: 'sine', dur: 0.5 + t * 0.25, gain: g, attack: 0.002 })
                }
            }
            if (t === 2) {
                tone({ at: 0.02, freq: 55, freqEnd: 32, type: 'sine', dur: 0.7, gain: 0.3 })
                noise({ at: 0.05, dur: 0.6, gain: 0.025, type: 'highpass', freq: 6000, freqEnd: 11000 })
            }
            break
        }

        case 'chestRattle': {
            // The wind-up: knocks that crowd closer and climb over `pitch` seconds, on a rising swell.
            const len = Math.max(0.4, pitch)
            const t = variant
            let at = 0
            let i = 0
            while (at < len && i < 80) {
                const k = at / len
                const d = detune(70)
                noise({ at, dur: 0.05, gain: 0.07 + k * 0.1, type: 'bandpass', freq: (650 + k * 1400) * d, q: 3 })
                tone({ at, freq: (130 + k * 160) * d, freqEnd: 90, type: 'triangle', dur: 0.06, gain: 0.06 + k * 0.06 })
                if (t > 0) tone({ at, freq: (1700 + k * 1600) * d, type: 'square', dur: 0.025, gain: 0.015 + k * 0.02, attack: 0.002 })
                at += 0.21 - 0.17 * Math.pow(k, 0.7)
                i++
            }
            // The swell: a climbing tone and a hiss that open up as the lock gives.
            tone({ freq: 160, freqEnd: 760 + t * 240, type: 'triangle', dur: len + 0.08, gain: 0.05 + t * 0.012, attack: len * 0.94 })
            tone({ freq: 240, freqEnd: 1140 + t * 360, type: 'sine', dur: len + 0.08, gain: 0.03, attack: len * 0.94 })
            noise({ dur: len + 0.1, gain: 0.06 + t * 0.02, type: 'bandpass', freq: 400, freqEnd: 5200, q: 1.2, attack: len * 0.92 })
            if (t === 2) noise({ dur: len + 0.1, gain: 0.12, type: 'lowpass', freq: 90, freqEnd: 180, attack: len * 0.6 })
            break
        }

        case 'chestBurst': {
            // The lid blowing off: a boom with a crack on top, then a shower of sparkle and a major chord.
            const t = variant
            const tail = 1 + t * 0.4
            tone({ freq: 95, freqEnd: 28, type: 'sine', dur: 0.7 * tail, gain: 0.42 })
            noise({ dur: 0.65 * tail, gain: 0.34, type: 'lowpass', freq: 3200, freqEnd: 90, q: 0.6 })
            noise({ dur: 0.09, gain: 0.28, type: 'highpass', freq: 2200 })
            const chord = [1046.5, 1318.5, 1568, 2093]
            chord.forEach((freq, i) => {
                tone({ at: 0.05 + i * 0.03, freq, type: 'triangle', dur: 1.1 * tail, gain: 0.06, attack: 0.02 })
                tone({ at: 0.05 + i * 0.03, freq: freq * 1.003, type: 'sine', dur: 1.1 * tail, gain: 0.03, attack: 0.03 })
            })
            const pings = 12 + t * 8
            for (let i = 0; i < pings; i++) {
                const at = 0.08 + Math.random() * (0.9 + t * 0.5)
                tone({ at, freq: 2000 + Math.random() * 3200, type: 'sine', dur: 0.16, gain: 0.04, attack: 0.002 })
            }
            noise({ at: 0.06, dur: 1.2 * tail, gain: 0.05, type: 'highpass', freq: 5500, freqEnd: 12000 })
            if (t === 2) {
                // A second boom and a choir-ish pad for the big one.
                tone({ at: 0.18, freq: 70, freqEnd: 30, type: 'sine', dur: 0.8, gain: 0.3 })
                for (const freq of [523.25, 659.25, 784, 1046.5]) {
                    tone({ at: 0.1, freq, type: 'sine', dur: 2.2, gain: 0.035, attack: 0.25 })
                    tone({ at: 0.1, freq: freq * 1.006, type: 'triangle', dur: 2.2, gain: 0.02, attack: 0.3 })
                }
            }
            break
        }

        case 'cardLand': {
            // A reward card slapping into its slot; the caller raises the pitch card by card.
            const d = detune(20)
            noise({ dur: 0.07, gain: 0.12, type: 'bandpass', freq: 1500 * d, q: 1.4 })
            tone({ freq: 520 * pitch, freqEnd: 860 * pitch, type: 'triangle', dur: 0.1, gain: 0.1 })
            tone({ at: 0.04, freq: 1320 * pitch, type: 'sine', dur: 0.2, gain: 0.06, attack: 0.003 })
            break
        }

        case 'extraReveal': {
            // A boost card: a magical chime, its key and flourish picked by `variant`
            // (0 build, 1 production, 2 market, 3 builder, 4 instant, 5 lucky).
            const roots = [523.25, 587.33, 659.25, 698.46, 783.99, 880]
            const root = roots[variant] ?? 659.25
            const steps = [1, 1.26, 1.5, 2, 2.52]
            steps.forEach((r, i) => {
                tone({ at: i * 0.055, freq: root * r, type: 'triangle', dur: 0.4, gain: 0.08, attack: 0.004 })
                tone({ at: i * 0.055, freq: root * r * 2, type: 'sine', dur: 0.25, gain: 0.025, attack: 0.003 })
            })
            tone({ at: 0.28, freq: root * 4, type: 'sine', dur: 0.8, gain: 0.04, attack: 0.01 })
            noise({ at: 0.02, dur: 0.7, gain: 0.04, type: 'highpass', freq: 5000, freqEnd: 11000 })
            if (variant === 0 || variant === 3) {
                // A hammer knock.
                noise({ dur: 0.05, gain: 0.14, type: 'bandpass', freq: 1800, q: 3 })
                tone({ freq: 900, freqEnd: 600, type: 'square', dur: 0.04, gain: 0.04, attack: 0.002 })
            } else if (variant === 1) {
                // A zap.
                tone({ freq: 2400, freqEnd: 300, type: 'sawtooth', dur: 0.12, gain: 0.03 })
            } else if (variant === 2) {
                tone({ at: 0.3, freq: 2400, type: 'square', dur: 0.07, gain: 0.04, attack: 0.002 })
                tone({ at: 0.36, freq: 3100, type: 'square', dur: 0.09, gain: 0.035, attack: 0.002 })
            } else if (variant === 4) {
                // A clock rushing forward.
                for (let i = 0; i < 6; i++) tone({ at: i * 0.035, freq: i % 2 ? 2600 : 2000, type: 'square', dur: 0.02, gain: 0.03, attack: 0.001 })
            } else if (variant === 5) {
                // A harp glissando.
                for (let i = 0; i < 8; i++) tone({ at: 0.3 + i * 0.03, freq: root * Math.pow(2, i / 5), type: 'triangle', dur: 0.3, gain: 0.04 })
            }
            break
        }

        case 'luckyUpgrade': {
            // The chest turning into a better one: a power-up sweep, a stab and a bell.
            tone({ freq: 260, freqEnd: 1900, type: 'triangle', dur: 0.42, gain: 0.1, attack: 0.3 })
            noise({ dur: 0.45, gain: 0.08, type: 'bandpass', freq: 500, freqEnd: 6000, q: 1.5, attack: 0.35 })
            for (const freq of [783.99, 987.77, 1174.66, 1567.98]) {
                tone({ at: 0.42, freq, type: 'triangle', dur: 0.7, gain: 0.07 })
                tone({ at: 0.42, freq: freq * 2, type: 'sine', dur: 0.4, gain: 0.02 })
            }
            tone({ at: 0.42, freq: 98, freqEnd: 50, type: 'sine', dur: 0.4, gain: 0.25 })
            tone({ at: 0.5, freq: 3135.96, type: 'sine', dur: 1.2, gain: 0.05, attack: 0.003 })
            noise({ at: 0.42, dur: 0.8, gain: 0.05, type: 'highpass', freq: 6000, freqEnd: 12000 })
            break
        }

        case 'collect': {
            // Everything heading home: an airy whoosh, then coins pouring into the purse.
            const t = variant
            noise({ dur: 0.4, gain: 0.1, type: 'bandpass', freq: 380, freqEnd: 3600, q: 1.2 })
            tone({ freq: 240, freqEnd: 720, type: 'sine', dur: 0.3, gain: 0.05 })
            const n = 6 + t * 4
            for (let i = 0; i < n; i++) {
                const at = 0.3 + i * 0.045 + Math.random() * 0.02
                const f = (2000 + i * 70) * detune(40)
                tone({ at, freq: f, type: 'square', dur: 0.05, gain: 0.035, attack: 0.002 })
                tone({ at, freq: f * 1.5, type: 'sine', dur: 0.08, gain: 0.03, attack: 0.002 })
            }
            tone({ at: 0.3 + n * 0.045, freq: 120, freqEnd: 60, type: 'sine', dur: 0.25, gain: 0.2 })
            break
        }

        case 'deny':
            // A soft "nope" for a tile that will not take the building: two low knocks.
            tone({ freq: 220, freqEnd: 180, type: 'triangle', dur: 0.07, gain: 0.12 })
            tone({ at: 0.08, freq: 180, freqEnd: 140, type: 'triangle', dur: 0.09, gain: 0.12 })
            break

        case 'complete': {
            // Cheerful major arpeggio — A5, C#6, E6.
            const notes = [880, 1108.7, 1318.5]
            notes.forEach((freq, i) => {
                tone({ at: i * 0.085, freq, type: 'triangle', dur: 0.26, gain: 0.15 })
                tone({ at: i * 0.085, freq: freq * 2, type: 'sine', dur: 0.18, gain: 0.05 })
            })
            break
        }

        case 'upgrade':
            tone({ freq: 440, type: 'triangle', dur: 0.16, gain: 0.15 })
            tone({ at: 0.1, freq: 660, type: 'triangle', dur: 0.22, gain: 0.15 })
            break

        case 'rush': {
            // Sparkle: fast high arpeggio with a breathy shimmer over the top.
            const notes = [1046.5, 1318.5, 1568, 2093]
            notes.forEach((freq, i) => {
                tone({ at: i * 0.045, freq, type: 'sine', dur: 0.12, gain: 0.11, attack: 0.004 })
            })
            noise({ at: 0.02, dur: 0.4, gain: 0.035, type: 'highpass', freq: 4000, freqEnd: 9000 })
            break
        }

        case 'coin':
            // Two overlapping metallic pings with a very quick decay.
            tone({ freq: 2200, type: 'square', dur: 0.07, gain: 0.06, attack: 0.002 })
            tone({ at: 0.03, freq: 2950, type: 'square', dur: 0.09, gain: 0.05, attack: 0.002 })
            tone({ at: 0.03, freq: 1760, type: 'sine', dur: 0.12, gain: 0.07 })
            break

        case 'bigcoin':
            // Cash-register double clink sitting on a low thump.
            tone({ freq: 2400, type: 'square', dur: 0.08, gain: 0.07, attack: 0.002 })
            tone({ at: 0.02, freq: 3100, type: 'square', dur: 0.1, gain: 0.06, attack: 0.002 })
            tone({ at: 0.13, freq: 2600, type: 'square', dur: 0.09, gain: 0.06, attack: 0.002 })
            tone({ at: 0.13, freq: 3400, type: 'square', dur: 0.11, gain: 0.05, attack: 0.002 })
            tone({ at: 0.02, freq: 130, freqEnd: 60, type: 'sine', dur: 0.3, gain: 0.22 })
            noise({ at: 0.13, dur: 0.18, gain: 0.04, type: 'highpass', freq: 5000 })
            break

        case 'buy':
            tone({ freq: 620, freqEnd: 560, type: 'triangle', dur: 0.11, gain: 0.13 })
            tone({ at: 0.09, freq: 430, freqEnd: 380, type: 'triangle', dur: 0.16, gain: 0.13 })
            break

        case 'error':
            tone({ freq: 160, freqEnd: 105, type: 'square', dur: 0.2, gain: 0.1 })
            tone({ freq: 82, type: 'sine', dur: 0.18, gain: 0.1 })
            break

        case 'demolish':
            // Crumble: a wide decaying noise burst sweeping down into rubble.
            noise({ dur: 0.55, gain: 0.2, type: 'lowpass', freq: 1800, freqEnd: 180, q: 0.7 })
            noise({ at: 0.08, dur: 0.35, gain: 0.09, type: 'bandpass', freq: 900, freqEnd: 220, q: 0.9 })
            tone({ at: 0.02, freq: 110, freqEnd: 45, type: 'sine', dur: 0.4, gain: 0.16 })
            break

        case 'plot': {
            // Four-note fanfare — C5, E5, G5, C6.
            const notes = [523.25, 659.25, 784, 1046.5]
            notes.forEach((freq, i) => {
                const last = i === notes.length - 1
                tone({ at: i * 0.1, freq, type: 'triangle', dur: last ? 0.45 : 0.18, gain: 0.16 })
                tone({ at: i * 0.1, freq: freq / 2, type: 'sine', dur: last ? 0.45 : 0.18, gain: 0.07 })
            })
            break
        }
    }
}

function unlock() {
    hydrate()
    ensure()
}

/**
 * `pitch` scales cues that take one (the paint tick); 1 is the natural note.
 * `variant` picks a cue's flavour where it has one (a chest's tier, a boost's kind).
 */
function play(event: TownSoundEvent, pitch = 1, variant = 0) {
    if (!import.meta.client) return
    hydrate()
    if (!enabled.value || volume.value <= 0) return

    const now = performance.now()
    const last = lastPlayedAt.get(event)
    if (last !== undefined && now - last < (COOLDOWN_OVERRIDES[event] ?? COOLDOWN_MS)) return
    lastPlayedAt.set(event, now)

    const c = ensure()
    if (!c || !master) return
    // A context created outside a gesture starts suspended; nothing is heard
    // until unlock() runs from a real click, which is the intended behaviour.
    if (c.state === 'suspended') return

    master.gain.setValueAtTime(masterLevel(), c.currentTime)
    if (STOPPABLE.has(event)) {
        stop(event)
        const bus = c.createGain()
        bus.connect(master)
        buses.set(event, bus)
        dest = bus
    }
    try {
        render(event, pitch, variant)
    } finally {
        dest = null
    }
}

/** Fade out a stoppable cue that is still playing (a skipped chest wind-up). */
function stop(event: TownSoundEvent) {
    const bus = buses.get(event)
    if (!bus || !ctx) return
    buses.delete(event)
    const at = ctx.currentTime
    bus.gain.setValueAtTime(bus.gain.value, at)
    bus.gain.linearRampToValueAtTime(0, at + 0.06)
    setTimeout(() => bus.disconnect(), 120)
}

export function useTownSound() {
    hydrate()

    if (import.meta.client && !watching) {
        watching = true
        watch([enabled, volume], () => {
            persist()
            if (ctx && master) master.gain.setValueAtTime(masterLevel(), ctx.currentTime)
        })
    }

    return { enabled, volume, play, stop, unlock }
}
