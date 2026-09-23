// Aether Gates sound playback. Every effect is synthesized on the fly
// (app/utils/slots/aethergates-synth.ts); nothing is fetched. Same shape as
// pirate-sound.ts: per-event levels, cooldowns and voice caps, persisted
// enable/volume.
//
// Signal chain: voice (level, pan) -> master gain (player volume) ->
// compressor -> speakers, so a tumble chain with a dozen orbs squashes
// instead of clipping. The free-spins pad feeds the same master gain.

import {
    AETHER_SOUND_COOLDOWNS,
    AETHER_SOUND_DEFAULT_VOICE_CAP,
    AETHER_SOUND_JITTER,
    AETHER_SOUND_LEVELS,
    AETHER_SOUND_MAX_VOICES,
    AETHER_SOUND_VOICE_CAPS,
    type AetherSoundEvent,
    type AetherSoundOptions
} from '~/utils/slots/aethergates-sounds'
import {
    AETHER_SYNTH_RECIPES,
    AetherSynthVoice,
    aetherBonusPad,
    aetherSynthWarmUp,
    type AetherLoopHandle
} from '~/utils/slots/aethergates-synth'

const STORAGE_ENABLED = 'aethergates-sound-enabled'
const STORAGE_VOLUME = 'aethergates-sound-volume'
const PAD_LEVEL = 0.14

const soundEnabled = ref(true)
const soundVolume = ref(70)

interface MasterBus {
    input: GainNode
    compressor: DynamicsCompressorNode
}

interface ActiveVoice {
    event: AetherSoundEvent
    voice: AetherSynthVoice
}

let ctx: AudioContext | null = null
let bus: MasterBus | null = null
const voices: ActiveVoice[] = []
const lastPlayedAt = new Map<AetherSoundEvent, number>()
let pad: AetherLoopHandle | null = null
let padWanted = false
let initialized = false

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
    compressor.threshold.value = -14
    compressor.knee.value = 10
    compressor.ratio.value = 8
    compressor.attack.value = 0.003
    compressor.release.value = 0.25
    input.connect(compressor)
    compressor.connect(context.destination)
    bus = { input, compressor }
    return bus
}

/** A running context, resumed if a gesture allows it. Null while it can't play yet. */
function runningContext(): AudioContext | null {
    if (!import.meta.client || !soundEnabled.value || soundVolume.value <= 0) return null
    const context = ensureContext()
    if (!context) return null
    if (context.state !== 'running') {
        // Scheduling on a frozen clock would burst everything out on resume.
        void context.resume().catch(() => {})
        return null
    }
    return context
}

/** Call from a user gesture (spin click, key press) so the first sound isn't lost. */
function unlock() {
    if (!import.meta.client || !soundEnabled.value) return
    const context = ensureContext()
    if (context && context.state !== 'running') void context.resume().catch(() => {})
}

function removeVoice(entry: ActiveVoice) {
    const index = voices.indexOf(entry)
    if (index !== -1) voices.splice(index, 1)
}

function steal(entry: ActiveVoice) {
    removeVoice(entry)
    entry.voice.release()
}

function play(event: AetherSoundEvent, options: AetherSoundOptions = {}) {
    const context = runningContext()
    if (!context) return
    const now = performance.now()
    if (now - (lastPlayedAt.get(event) ?? -Infinity) < AETHER_SOUND_COOLDOWNS[event]) return
    lastPlayedAt.set(event, now)

    const cap = AETHER_SOUND_VOICE_CAPS[event] ?? AETHER_SOUND_DEFAULT_VOICE_CAP
    let same = 0
    for (const entry of voices) if (entry.event === event) same++
    if (same >= cap) {
        const oldest = voices.find(entry => entry.event === event)
        if (oldest) steal(oldest)
    }
    while (voices.length >= AETHER_SOUND_MAX_VOICES) steal(voices[0]!)

    const jitter = AETHER_SOUND_JITTER[event] ?? 0
    const pitch = 1 + (Math.random() * 2 - 1) * jitter
    const intensity = Math.max(0, options.intensity ?? 0)
    const voice = new AetherSynthVoice(context, ensureBus(context).input, {
        level: AETHER_SOUND_LEVELS[event],
        pan: options.pan ?? 0,
        pitch,
        start: context.currentTime + 0.005
    })
    const entry: ActiveVoice = { event, voice }
    voice.onDone = () => removeVoice(entry)
    voices.push(entry)
    try {
        AETHER_SYNTH_RECIPES[event](voice, intensity)
    } catch {
        voice.release(0)
    }
    voice.seal()
}

function startPad() {
    padWanted = true
    if (pad) return
    const context = runningContext()
    if (!context) return
    aetherSynthWarmUp(context)
    pad = aetherBonusPad(context, ensureBus(context).input, PAD_LEVEL)
}

function stopPad() {
    padWanted = false
    pad?.stop()
    pad = null
}

/** Silence every in-flight effect and the pad (page unmounted). */
function stopAll() {
    lastPlayedAt.clear()
    stopPad()
    for (const entry of voices.splice(0)) entry.voice.release(0.03)
}

function initialize() {
    if (!import.meta.client || initialized) return
    initialized = true
    const storedEnabled = localStorage.getItem(STORAGE_ENABLED)
    const storedVolume = localStorage.getItem(STORAGE_VOLUME)
    if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
    // Number(null) is 0, so check for null before parsing or a first visit mutes the game.
    if (storedVolume !== null && Number.isFinite(Number(storedVolume))) {
        soundVolume.value = Math.max(0, Math.min(100, Number(storedVolume)))
    }
    watch(soundEnabled, (enabled) => {
        localStorage.setItem(STORAGE_ENABLED, String(enabled))
        if (!enabled) {
            const wanted = padWanted
            stopAll()
            padWanted = wanted
        } else {
            unlock()
            if (padWanted) setTimeout(startPad, 120)
        }
    })
    watch(soundVolume, (volume) => {
        localStorage.setItem(STORAGE_VOLUME, String(volume))
        if (ctx && bus) bus.input.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.02)
    })
}

export function useAethergatesSound() {
    initialize()
    return { soundEnabled, soundVolume, play, unlock, startPad, stopPad, stopAll }
}
