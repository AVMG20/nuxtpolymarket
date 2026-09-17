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

const STORAGE_KEY = 'polytown-sound'

/** Ceiling before the user's volume slider is applied. Deliberately gentle. */
const MASTER_GAIN = 0.25

/** Spamming a cue (holding a build button) must not stack into a wall. */
const COOLDOWN_MS = 60

const enabled = ref(true)
const volume = ref(70)

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null
let hydrated = false
let watching = false

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
    const out = master
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
}

function noise(o: NoiseOpts) {
    const c = ctx
    const out = master
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
    g.gain.setValueAtTime(Math.max(0.0002, o.gain), at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur)

    src.connect(filter)
    filter.connect(g)
    g.connect(out)
    src.start(at)
    src.stop(at + o.dur + 0.02)
}

function render(event: TownSoundEvent) {
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

        case 'place':
            // Wooden thunk under a short rising confirmation blip.
            noise({ dur: 0.13, gain: 0.22, type: 'lowpass', freq: 620, freqEnd: 180, q: 0.8 })
            tone({ freq: 150, freqEnd: 90, type: 'sine', dur: 0.12, gain: 0.2 })
            tone({ at: 0.05, freq: 330, freqEnd: 560, type: 'triangle', dur: 0.14, gain: 0.14 })
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

function play(event: TownSoundEvent) {
    if (!import.meta.client) return
    hydrate()
    if (!enabled.value || volume.value <= 0) return

    const now = performance.now()
    const last = lastPlayedAt.get(event)
    if (last !== undefined && now - last < COOLDOWN_MS) return
    lastPlayedAt.set(event, now)

    const c = ensure()
    if (!c || !master) return
    // A context created outside a gesture starts suspended; nothing is heard
    // until unlock() runs from a real click, which is the intended behaviour.
    if (c.state === 'suspended') return

    master.gain.setValueAtTime(masterLevel(), c.currentTime)
    render(event)
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

    return { enabled, volume, play, unlock }
}
