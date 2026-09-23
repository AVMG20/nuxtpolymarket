// Pirate Raid sound playback. Every effect is synthesized on the fly
// (app/utils/pirate-synth.ts); nothing is fetched. Same shape as
// shapezz-sound.ts: per-event levels, cooldowns and voice caps, persisted
// enable/volume.
//
// Signal chain: voice (level, pan) -> master gain (player volume) ->
// compressor -> speakers, so eight ports and a boss firing at once squash
// instead of clipping. The sea ambience, the Kraken's Maw loop and the battle
// drums feed the same master gain through their own quieter gains.

import { PIRATE_WORLD_W } from '#shared/utils/gamelogic/pirates'
import {
    PIRATE_SOUND_COOLDOWNS,
    PIRATE_SOUND_DEFAULT_VOICE_CAP,
    PIRATE_SOUND_LEVELS,
    PIRATE_SOUND_MAX_VOICES,
    PIRATE_SOUND_VOICE_CAPS,
    type PirateSoundEvent,
    type SoundOptions
} from '~/utils/pirate-sounds'
import {
    PIRATE_SYNTH_DEFAULT_JITTER,
    PIRATE_SYNTH_JITTER,
    PIRATE_SYNTH_RECIPES,
    PirateDrumBed,
    PirateSynthVoice,
    pirateCreak,
    pirateGull,
    pirateMaelstromLoop,
    pirateSeaLoop,
    pirateSynthWarmUp,
    type PirateLoopHandle
} from '~/utils/pirate-synth'

const soundEnabled = ref(true)
const soundVolume = ref(70)

/** Mix levels of the sustained layers, relative to the player's volume. */
const SEA_LEVEL = 0.16
const GULL_LEVEL = 0.07
const CREAK_LEVEL = 0.09
const MAELSTROM_LEVEL = 0.2
const DRUM_LEVEL = 0.22

interface MasterBus {
    input: GainNode
    compressor: DynamicsCompressorNode
}

interface ActiveVoice {
    event: PirateSoundEvent | 'ambient'
    voice: PirateSynthVoice
}

let ctx: AudioContext | null = null
let bus: MasterBus | null = null
/** Oldest first. */
const voices: ActiveVoice[] = []
const lastPlayedAt = new Map<PirateSoundEvent, number>()
let sea: PirateLoopHandle | null = null
let maelstrom: PirateLoopHandle | null = null
let drums: PirateDrumBed | null = null
let tension = 0
let gullTimer: ReturnType<typeof setTimeout> | null = null
let creakTimer: ReturnType<typeof setTimeout> | null = null
let ambienceWanted = false
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
    compressor.ratio.value = 10
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

function removeVoice(entry: ActiveVoice) {
    const index = voices.indexOf(entry)
    if (index !== -1) voices.splice(index, 1)
}

function steal(entry: ActiveVoice) {
    removeVoice(entry)
    entry.voice.release()
}

function panFor(x: number | undefined) {
    if (x === undefined || !Number.isFinite(x)) return 0
    return Math.max(-0.7, Math.min(0.7, (x / PIRATE_WORLD_W * 2 - 1) * 0.7))
}

function startMaelstrom() {
    const context = runningContext()
    if (!context) return
    maelstrom?.stop(0.1)
    maelstrom = pirateMaelstromLoop(context, ensureBus(context).input, MAELSTROM_LEVEL)
}

function stopMaelstrom() {
    maelstrom?.stop()
    maelstrom = null
}

function play(event: PirateSoundEvent, options: SoundOptions = {}) {
    if (event === 'maelstrom-loop-start') startMaelstrom()
    else if (event === 'maelstrom-loop-stop') stopMaelstrom()

    const context = runningContext()
    if (!context) return
    const now = performance.now()
    if (now - (lastPlayedAt.get(event) ?? -Infinity) < PIRATE_SOUND_COOLDOWNS[event]) return
    lastPlayedAt.set(event, now)

    const cap = PIRATE_SOUND_VOICE_CAPS[event] ?? PIRATE_SOUND_DEFAULT_VOICE_CAP
    let same = 0
    for (const entry of voices) if (entry.event === event) same++
    if (same >= cap) {
        const oldest = voices.find(entry => entry.event === event)
        if (oldest) steal(oldest)
    }
    while (voices.length >= PIRATE_SOUND_MAX_VOICES) steal(voices[0]!)

    const jitter = PIRATE_SYNTH_JITTER[event] ?? PIRATE_SYNTH_DEFAULT_JITTER
    const pitch = 1 + (Math.random() * 2 - 1) * jitter
    const intensity = Math.max(0, options.intensity ?? 0)
    // Size hints nudge loudness a little; rarity (crate pickups) is handled by the recipe.
    const loudness = event === 'crate-pickup' ? 1 : Math.min(1.35, 0.85 + intensity * 0.25)
    spawn(context, event, PIRATE_SOUND_LEVELS[event] * loudness, panFor(options.x), pitch, (voice) => {
        PIRATE_SYNTH_RECIPES[event](voice, intensity)
    })
}

function spawn(context: AudioContext, event: ActiveVoice['event'], level: number, pan: number, pitch: number, recipe: (voice: PirateSynthVoice) => void) {
    const voice = new PirateSynthVoice(context, ensureBus(context).input, {
        level,
        pan,
        pitch,
        start: context.currentTime + 0.005
    })
    const entry: ActiveVoice = { event, voice }
    voice.onDone = () => removeVoice(entry)
    voices.push(entry)
    try {
        recipe(voice)
    } catch {
        voice.release(0)
    }
    voice.seal()
}

/** Silence every in-flight effect and the whirlpool loop (page unmounted, voyage paused). */
function stopEffects() {
    lastPlayedAt.clear()
    stopMaelstrom()
    for (const entry of voices.splice(0)) entry.voice.release(0.03)
}

function clearAmbientTimers() {
    if (gullTimer) clearTimeout(gullTimer)
    if (creakTimer) clearTimeout(creakTimer)
    gullTimer = null
    creakTimer = null
}

function scheduleAmbient(kind: 'gull' | 'creak') {
    const pending = kind === 'gull' ? gullTimer : creakTimer
    if (!import.meta.client || !ambienceWanted || pending) return
    const delay = kind === 'gull' ? 14_000 + Math.random() * 20_000 : 7_000 + Math.random() * 12_000
    const timer = setTimeout(() => {
        if (kind === 'gull') gullTimer = null
        else creakTimer = null
        // A timer can become ready just as the game page is being torn down.
        // Check the requested ambience state again so it cannot restart itself
        // after leaving Pirate Raid.
        if (!ambienceWanted) return
        const context = runningContext()
        if (context) {
            const level = kind === 'gull' ? GULL_LEVEL : CREAK_LEVEL
            spawn(context, 'ambient', level, (Math.random() * 2 - 1) * 0.6, 1 + (Math.random() * 2 - 1) * 0.08, kind === 'gull' ? pirateGull : pirateCreak)
        }
        scheduleAmbient(kind)
    }, delay)
    if (kind === 'gull') gullTimer = timer
    else creakTimer = timer
}

function startAmbience() {
    ambienceWanted = true
    const context = runningContext()
    if (!context) {
        // First gesture may still be resuming the context; try again shortly.
        if (import.meta.client && soundEnabled.value) {
            setTimeout(() => {
                if (ambienceWanted && !sea && ctx?.state === 'running') startAmbience()
            }, 150)
        }
        return
    }
    pirateSynthWarmUp(context)
    const input = ensureBus(context).input
    if (!sea) sea = pirateSeaLoop(context, input, SEA_LEVEL)
    if (!drums) drums = new PirateDrumBed(context, input, DRUM_LEVEL)
    drums.setTension(tension)
    scheduleAmbient('gull')
    scheduleAmbient('creak')
}

function silenceAmbience() {
    clearAmbientTimers()
    sea?.stop()
    sea = null
    drums?.stop()
    drums = null
}

function pauseAmbience() {
    ambienceWanted = false
    silenceAmbience()
    stopMaelstrom()
}

function stopAmbience() {
    ambienceWanted = false
    tension = 0
    silenceAmbience()
    stopMaelstrom()
}

/** 0 idle, ~0.3 normal combat, 1 while a boss is afloat. */
function setTension(level: number) {
    tension = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0))
    if (ambienceWanted) drums?.setTension(tension)
}

/** Tear everything down (sound disabled). */
function stopAll() {
    stopEffects()
    silenceAmbience()
    if (!ctx || !bus) return
    const old = bus
    bus = null
    const now = ctx.currentTime
    old.input.gain.cancelScheduledValues(now)
    old.input.gain.setValueAtTime(old.input.gain.value, now)
    old.input.gain.linearRampToValueAtTime(0, now + 0.02)
    setTimeout(() => {
        old.input.disconnect()
        old.compressor.disconnect()
    }, 80)
}

function initialize() {
    if (!import.meta.client || initialized) return
    initialized = true
    const storedEnabled = localStorage.getItem('pirates-sound-enabled')
    const storedVolume = localStorage.getItem('pirates-sound-volume')
    if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
    // Number(null) is 0, not NaN, so reading the volume without the null check
    // first sets it to zero and silently mutes the game on every first visit.
    if (storedVolume !== null && Number.isFinite(Number(storedVolume))) {
        soundVolume.value = Math.max(0, Math.min(100, Number(storedVolume)))
    }
    watch(soundEnabled, (enabled) => {
        localStorage.setItem('pirates-sound-enabled', String(enabled))
        if (!enabled) {
            stopAll()
        } else if (ambienceWanted) {
            startAmbience()
        }
    })
    watch(soundVolume, (volume) => {
        localStorage.setItem('pirates-sound-volume', String(volume))
        if (ctx && bus) bus.input.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.02)
        if (volume > 0 && ambienceWanted && !sea) startAmbience()
    })
}

export function usePirateSound() {
    initialize()

    return {
        soundEnabled,
        soundVolume,
        play,
        stopEffects,
        startAmbience,
        pauseAmbience,
        stopAmbience,
        setTension
    }
}
