// Spiñata Slots audio. Effects are the game's samples (decoded once into
// AudioBuffers) plus a few synthesized layers for moments without a sample
// (app/utils/spinata-synth.ts). Music streams through two HTMLAudio elements
// (base game and free spins) that crossfade and duck under big wins.
//
// Effects chain: source -> per-voice gain -> effects gain (player volume) ->
// compressor -> speakers, so a payline pluck, a scatter sting and a coin
// counter landing together squash instead of clipping. Every sample has a
// level, a cooldown and a voice cap (app/utils/spinata-sounds.ts).
//
// Mute, effects volume and music volume persist in localStorage.

import {
    SPINATA_MAX_VOICES,
    SPINATA_MUSIC,
    SPINATA_MUSIC_LEVEL,
    SPINATA_SAMPLES,
    SPINATA_SOUND_BASE,
    SPINATA_SYNTH_CAPS,
    SPINATA_SYNTH_COOLDOWNS,
    SPINATA_SYNTH_LEVELS,
    type SpinataMusicTrack,
    type SpinataSampleName,
    type SpinataSynthEvent
} from '~/utils/spinata-sounds'
import {
    SPINATA_SYNTH_DEFAULT_JITTER,
    SPINATA_SYNTH_JITTER,
    SPINATA_SYNTH_RECIPES,
    SpinataSynthVoice,
    spinataSynthWarmUp
} from '~/utils/spinata-synth'

const STORE_MUTED = 'spinata-sound-muted'
const STORE_SFX = 'spinata-sound-sfx'
const STORE_MUSIC = 'spinata-sound-music'

const muted = ref(false)
const sfxVolume = ref(80)
const musicVolume = ref(60)

export interface SpinataSoundHandle {
    stop: (fade?: number) => void
}

interface PlayOptions {
    /** Playback rate (pitch). */
    rate?: number
    /** Extra gain on top of the sample's level. */
    gain?: number
    loop?: boolean
    /** Seconds from now. */
    delay?: number
}

interface ActiveVoice {
    key: string
    stop: (fade?: number) => void
}

interface MusicDeck {
    el: HTMLAudioElement
    volume: number
    target: number
}

let ctx: AudioContext | null = null
let sfxGain: GainNode | null = null
let compressor: DynamicsCompressorNode | null = null
const buffers = new Map<string, Promise<AudioBuffer | null>>()
const voices: ActiveVoice[] = []
const lastPlayedAt = new Map<string, number>()

const decks = new Map<SpinataMusicTrack, MusicDeck>()
let musicWanted: SpinataMusicTrack | null = null
let duckFactor = 1
let musicTimer: ReturnType<typeof setInterval> | null = null
let unlocked = false
let active = false
let initialized = false

function ensureContext(): AudioContext | null {
    if (!import.meta.client) return null
    if (!ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return null
        ctx = new Ctx()
        compressor = ctx.createDynamicsCompressor()
        compressor.threshold.value = -12
        compressor.knee.value = 8
        compressor.ratio.value = 8
        compressor.attack.value = 0.003
        compressor.release.value = 0.22
        compressor.connect(ctx.destination)
        sfxGain = ctx.createGain()
        sfxGain.gain.value = effectsLevel()
        sfxGain.connect(compressor)
        spinataSynthWarmUp(ctx)
    }
    return ctx
}

function effectsLevel() {
    return muted.value ? 0 : Math.max(0, Math.min(1, sfxVolume.value / 100))
}

function musicLevel() {
    return muted.value ? 0 : Math.max(0, Math.min(1, musicVolume.value / 100)) * SPINATA_MUSIC_LEVEL
}

function loadBuffer(file: string): Promise<AudioBuffer | null> {
    const context = ensureContext()
    if (!context) return Promise.resolve(null)
    let pending = buffers.get(file)
    if (!pending) {
        pending = (async () => {
            try {
                const res = await fetch(`${SPINATA_SOUND_BASE}/${file}.mp3`)
                if (!res.ok) throw new Error(String(res.status))
                return await context.decodeAudioData(await res.arrayBuffer())
            } catch {
                buffers.delete(file)
                return null
            }
        })()
        buffers.set(file, pending)
    }
    return pending
}

function preloadAll() {
    for (const sample of Object.values(SPINATA_SAMPLES)) void loadBuffer(sample.file)
}

function removeVoice(entry: ActiveVoice) {
    const i = voices.indexOf(entry)
    if (i !== -1) voices.splice(i, 1)
}

function admit(key: string, cooldown: number, cap: number): boolean {
    const now = performance.now()
    if (now - (lastPlayedAt.get(key) ?? -Infinity) < cooldown) return false
    lastPlayedAt.set(key, now)
    let same = 0
    for (const v of voices) if (v.key === key) same++
    if (same >= cap) {
        const oldest = voices.find(v => v.key === key)
        if (oldest) {
            removeVoice(oldest)
            oldest.stop(0.04)
        }
    }
    while (voices.length >= SPINATA_MAX_VOICES) {
        const first = voices.shift()
        first?.stop(0.03)
    }
    return true
}

function canPlay(): boolean {
    return import.meta.client && active && !muted.value && sfxVolume.value > 0
}

/** Play a sample. Returns a handle that also cancels a play still waiting on its buffer. */
function play(name: SpinataSampleName, options: PlayOptions = {}): SpinataSoundHandle | null {
    if (!canPlay()) return null
    const context = ensureContext()
    if (!context || !sfxGain) return null
    if (context.state !== 'running') void context.resume().catch(() => {})
    const sample: { file: string, level: number, cooldown?: number, cap?: number } = SPINATA_SAMPLES[name]
    if (!admit(name, sample.cooldown ?? 0, sample.cap ?? 3)) return null

    let cancelled = false
    let src: AudioBufferSourceNode | null = null
    let gain: GainNode | null = null
    const requestedAt = performance.now()

    const entry: ActiveVoice = {
        key: name,
        stop(fade = 0.12) {
            cancelled = true
            removeVoice(entry)
            if (!src || !gain || !ctx) return
            const now = ctx.currentTime
            gain.gain.cancelScheduledValues(now)
            gain.gain.setValueAtTime(gain.gain.value, now)
            gain.gain.linearRampToValueAtTime(0, now + fade)
            try {
                src.stop(now + fade + 0.02)
            } catch {
                // Already stopped.
            }
        }
    }
    voices.push(entry)

    void loadBuffer(sample.file).then((buffer) => {
        if (cancelled || !buffer || !ctx || !sfxGain) {
            removeVoice(entry)
            return
        }
        // A one-shot that arrives very late (first decode) would land out of sync.
        if (!options.loop && performance.now() - requestedAt > 700) {
            removeVoice(entry)
            return
        }
        src = ctx.createBufferSource()
        src.buffer = buffer
        src.loop = !!options.loop
        src.playbackRate.value = options.rate ?? 1
        gain = ctx.createGain()
        gain.gain.value = sample.level * (options.gain ?? 1)
        src.connect(gain)
        gain.connect(sfxGain)
        src.onended = () => {
            removeVoice(entry)
            gain?.disconnect()
            src?.disconnect()
        }
        src.start(ctx.currentTime + 0.005 + (options.delay ?? 0))
    })

    return entry
}

/** Play a synthesized layer. `intensity` is recipe-specific (line index, size). */
function synth(event: SpinataSynthEvent, intensity = 0, pan = 0) {
    if (!canPlay()) return
    const context = ensureContext()
    if (!context || !sfxGain || context.state !== 'running') return
    if (!admit(`synth:${event}`, SPINATA_SYNTH_COOLDOWNS[event], SPINATA_SYNTH_CAPS[event])) return
    const jitter = SPINATA_SYNTH_JITTER[event] ?? SPINATA_SYNTH_DEFAULT_JITTER
    const voice = new SpinataSynthVoice(context, sfxGain, {
        level: SPINATA_SYNTH_LEVELS[event],
        pan,
        pitch: 1 + (Math.random() * 2 - 1) * jitter,
        start: context.currentTime + 0.005
    })
    const entry: ActiveVoice = { key: `synth:${event}`, stop: fade => voice.release(fade) }
    voice.onDone = () => removeVoice(entry)
    voices.push(entry)
    try {
        SPINATA_SYNTH_RECIPES[event](voice, intensity)
    } catch {
        voice.release(0)
    }
    voice.seal()
}

// Music ---------------------------------------------------------------------

function deck(track: SpinataMusicTrack): MusicDeck {
    let d = decks.get(track)
    if (!d) {
        const el = new Audio(SPINATA_MUSIC[track])
        el.loop = true
        el.preload = 'auto'
        el.volume = 0
        d = { el, volume: 0, target: 0 }
        decks.set(track, d)
    }
    return d
}

function retargetMusic() {
    if (!import.meta.client) return
    const hidden = typeof document !== 'undefined' && document.hidden
    for (const track of Object.keys(SPINATA_MUSIC) as SpinataMusicTrack[]) {
        const wanted = active && unlocked && !hidden && musicWanted === track
        if (!wanted && !decks.has(track)) continue
        const d = deck(track)
        d.target = wanted ? musicLevel() * duckFactor : 0
        if (d.target > 0 && d.el.paused) void d.el.play().catch(() => {})
    }
    if (!musicTimer) musicTimer = setInterval(stepMusic, 40)
}

function stepMusic() {
    let settled = true
    for (const d of decks.values()) {
        const diff = d.target - d.volume
        const step = 0.02
        if (Math.abs(diff) > step) {
            d.volume += Math.sign(diff) * step
            settled = false
        } else {
            d.volume = d.target
        }
        d.el.volume = Math.max(0, Math.min(1, d.volume))
        if (d.volume <= 0 && d.target <= 0 && !d.el.paused) d.el.pause()
    }
    if (settled && musicTimer) {
        clearInterval(musicTimer)
        musicTimer = null
    }
}

function setMusic(track: SpinataMusicTrack | null, restart = false) {
    if (restart && track && decks.has(track) && musicWanted !== track) {
        const d = deck(track)
        if (d.volume <= 0) d.el.currentTime = 0
    }
    musicWanted = track
    retargetMusic()
}

/** Lower the music under a celebration (1 = full). */
function duck(level: number) {
    duckFactor = Math.max(0, Math.min(1, level))
    retargetMusic()
}

// Lifecycle -------------------------------------------------------------------

function unlock() {
    const context = ensureContext()
    if (!context) return
    if (context.state !== 'running') void context.resume().catch(() => {})
    if (!unlocked) {
        unlocked = true
        preloadAll()
    }
    retargetMusic()
}

function onVisibility() {
    retargetMusic()
}

/** Stop every effect (loops included). */
function stopEffects(fade = 0.08) {
    for (const v of voices.splice(0)) v.stop(fade)
    lastPlayedAt.clear()
}

/** The game mounted: start the base music once a gesture unlocks audio. */
function start() {
    active = true
    if (musicWanted === null) musicWanted = 'main'
    document.addEventListener('visibilitychange', onVisibility)
    retargetMusic()
}

/** The game unmounted: silence everything. */
function stop() {
    active = false
    stopEffects(0.05)
    document.removeEventListener('visibilitychange', onVisibility)
    musicWanted = null
    duckFactor = 1
    for (const d of decks.values()) {
        d.target = 0
        d.volume = 0
        d.el.volume = 0
        d.el.pause()
    }
    if (musicTimer) {
        clearInterval(musicTimer)
        musicTimer = null
    }
}

function initialize() {
    if (!import.meta.client || initialized) return
    initialized = true
    try {
        const m = localStorage.getItem(STORE_MUTED)
        const s = localStorage.getItem(STORE_SFX)
        const mu = localStorage.getItem(STORE_MUSIC)
        if (m !== null) muted.value = m === 'true'
        // Number(null) is 0, so check for null before parsing or a first visit mutes the game.
        if (s !== null && Number.isFinite(Number(s))) sfxVolume.value = Math.max(0, Math.min(100, Number(s)))
        if (mu !== null && Number.isFinite(Number(mu))) musicVolume.value = Math.max(0, Math.min(100, Number(mu)))
    } catch {
        // Storage blocked: keep defaults.
    }
    const persist = (key: string, value: string) => {
        try {
            localStorage.setItem(key, value)
        } catch {
            // Storage blocked.
        }
    }
    watch(muted, (value) => {
        persist(STORE_MUTED, String(value))
        if (value) stopEffects(0.05)
        if (ctx && sfxGain) sfxGain.gain.setTargetAtTime(effectsLevel(), ctx.currentTime, 0.02)
        retargetMusic()
    })
    watch(sfxVolume, (value) => {
        persist(STORE_SFX, String(value))
        if (ctx && sfxGain) sfxGain.gain.setTargetAtTime(effectsLevel(), ctx.currentTime, 0.02)
    })
    watch(musicVolume, (value) => {
        persist(STORE_MUSIC, String(value))
        retargetMusic()
    })
}

export function useSpinataSound() {
    initialize()
    return {
        muted,
        sfxVolume,
        musicVolume,
        play,
        synth,
        setMusic,
        duck,
        unlock,
        start,
        stop,
        stopEffects
    }
}
