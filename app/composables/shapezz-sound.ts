// SHAPEZZ sound playback. Every effect is synthesized on the fly
// (app/utils/shapezz-synth.ts); nothing is fetched. Follows the
// pirate-sound.ts shape (levels, cooldowns, persisted enable/volume).
//
// Signal chain: voice (level, pan) -> master gain (player volume) ->
// compressor -> speakers, so dense combat squashes instead of clipping.
// Voices are capped per event and in total; a play past a cap steals the
// oldest voice.

import {
    SHAPEZZ_SOUND_COOLDOWNS,
    SHAPEZZ_SOUND_DEFAULT_VOICE_CAP,
    SHAPEZZ_SOUND_LEVELS,
    SHAPEZZ_SOUND_MAX_VOICES,
    SHAPEZZ_SOUND_VOICE_CAPS,
    type ShapezzSoundEvent,
    type ShapezzSoundOptions
} from '~/utils/shapezz-sounds'
import {
    SHAPEZZ_SYNTH_DEFAULT_JITTER,
    SHAPEZZ_SYNTH_JITTER,
    SHAPEZZ_SYNTH_RECIPES,
    ShapezzSynthVoice,
    shapezzPentatonic,
    shapezzSynthWarmUp
} from '~/utils/shapezz-synth'

const soundEnabled = ref(true)
const soundVolume = ref(70)

interface MasterBus {
    input: GainNode
    compressor: DynamicsCompressorNode
}

interface ActiveVoice {
    event: ShapezzSoundEvent
    voice: ShapezzSynthVoice
}

let ctx: AudioContext | null = null
let bus: MasterBus | null = null
/** Oldest first. */
const voices: ActiveVoice[] = []
const lastPlayedAt = new Map<ShapezzSoundEvent, number>()
let initialized = false

/** Coin pickups in quick succession climb the pentatonic scale. */
const COIN_COMBO_RESET_MS = 500
const COIN_COMBO_MAX_STEP = 7
let coinStep = -1
let lastCoinAt = -Infinity

function ensureContext(): AudioContext | null {
    if (!import.meta.client) return null
    if (!ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return null
        ctx = new Ctx()
    }
    return ctx
}

function masterLevel(): number {
    return Math.max(0, Math.min(1, soundVolume.value / 100))
}

function ensureBus(context: AudioContext): MasterBus {
    if (bus) return bus
    const input = context.createGain()
    input.gain.value = masterLevel()
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -12
    compressor.knee.value = 8
    compressor.ratio.value = 12
    compressor.attack.value = 0.003
    compressor.release.value = 0.2
    input.connect(compressor)
    compressor.connect(context.destination)
    bus = { input, compressor }
    return bus
}

function removeVoice(entry: ActiveVoice) {
    const index = voices.indexOf(entry)
    if (index !== -1) voices.splice(index, 1)
}

function steal(entry: ActiveVoice) {
    removeVoice(entry)
    entry.voice.release()
}

function coinPitch(now: number): number {
    coinStep = now - lastCoinAt > COIN_COMBO_RESET_MS ? 0 : Math.min(COIN_COMBO_MAX_STEP, coinStep + 1)
    lastCoinAt = now
    return Math.pow(2, shapezzPentatonic(coinStep) / 12)
}

function play(event: ShapezzSoundEvent, options: ShapezzSoundOptions = {}) {
    if (!import.meta.client || !soundEnabled.value || soundVolume.value <= 0) return
    const context = ensureContext()
    if (!context) return
    if (context.state !== 'running') {
        // Scheduling on a frozen clock would burst everything out on resume.
        void context.resume().catch(() => {})
        return
    }
    const now = performance.now()
    if (now - (lastPlayedAt.get(event) ?? -Infinity) < SHAPEZZ_SOUND_COOLDOWNS[event]) return
    lastPlayedAt.set(event, now)

    const cap = SHAPEZZ_SOUND_VOICE_CAPS[event] ?? SHAPEZZ_SOUND_DEFAULT_VOICE_CAP
    let same = 0
    for (const entry of voices) if (entry.event === event) same++
    if (same >= cap) {
        const oldest = voices.find(entry => entry.event === event)
        if (oldest) steal(oldest)
    }
    while (voices.length >= SHAPEZZ_SOUND_MAX_VOICES) steal(voices[0]!)

    const jitter = SHAPEZZ_SYNTH_JITTER[event] ?? SHAPEZZ_SYNTH_DEFAULT_JITTER
    let pitch = (options.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * jitter)
    if (event === 'pickup-coin') pitch *= coinPitch(now)

    const master = ensureBus(context)
    const voice = new ShapezzSynthVoice(context, master.input, {
        level: SHAPEZZ_SOUND_LEVELS[event] * Math.max(0, options.volume ?? 1),
        pan: options.pan,
        pitch,
        start: context.currentTime + 0.005
    })
    const entry: ActiveVoice = { event, voice }
    voice.onDone = () => removeVoice(entry)
    voices.push(entry)
    try {
        SHAPEZZ_SYNTH_RECIPES[event](voice)
    } catch {
        voice.release(0)
    }
    voice.seal()
}

/** Silence every in-flight effect at once (arena unmounted, sound disabled). */
function stop() {
    lastPlayedAt.clear()
    coinStep = -1
    lastCoinAt = -Infinity
    if (!ctx || !bus) return
    const old = bus
    bus = null
    const now = ctx.currentTime
    old.input.gain.cancelScheduledValues(now)
    old.input.gain.setValueAtTime(old.input.gain.value, now)
    old.input.gain.linearRampToValueAtTime(0, now + 0.01)
    for (const entry of voices.splice(0)) entry.voice.release(0.01)
    setTimeout(() => {
        old.input.disconnect()
        old.compressor.disconnect()
    }, 60)
}

/** Resume a suspended AudioContext — call from a user gesture (starting a run). */
function unlock() {
    const context = ensureContext()
    if (!context) return
    shapezzSynthWarmUp(context)
    if (context.state === 'suspended') void context.resume().catch(() => {})
}

/** Cheap warm-up: create the context, master bus and noise buffers. */
function preload() {
    const context = ensureContext()
    if (!context) return
    shapezzSynthWarmUp(context)
    ensureBus(context)
}

function initialize() {
    if (!import.meta.client || initialized) return
    initialized = true
    const storedEnabled = localStorage.getItem('shapezz-sound-enabled')
    const storedVolume = localStorage.getItem('shapezz-sound-volume')
    if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
    // Number(null) is 0, not NaN, so reading the volume without the null check
    // first sets it to zero and silently mutes the game on every first visit.
    if (storedVolume !== null && Number.isFinite(Number(storedVolume))) {
        soundVolume.value = Math.max(0, Math.min(100, Number(storedVolume)))
    }
    watch(soundEnabled, (enabled) => {
        localStorage.setItem('shapezz-sound-enabled', String(enabled))
        if (!enabled) stop()
    })
    watch(soundVolume, (volume) => {
        localStorage.setItem('shapezz-sound-volume', String(volume))
        if (ctx && bus) bus.input.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.02)
    })
}

export function useShapezzSound() {
    initialize()
    return { soundEnabled, soundVolume, play, stop, unlock, preload }
}
