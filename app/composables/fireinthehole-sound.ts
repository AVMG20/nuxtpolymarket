// Fire in the Hole sound playback. Every effect is synthesized on the fly
// (app/utils/fireinthehole-synth.ts); nothing is fetched. Same shape as
// pirate-sound.ts: per-event levels, cooldowns and voice caps, persisted
// enable/volume.
//
// Signal chain: voice (level, pan) -> master gain (player volume) ->
// compressor -> speakers, so a chain of bombs going off together squashes
// instead of clipping. The mine ambience feeds the same master gain.

import { FITH_COLS } from '#shared/utils/gamelogic/fireinthehole'
import {
    FITH_SOUND_COOLDOWNS,
    FITH_SOUND_DEFAULT_VOICE_CAP,
    FITH_SOUND_LEVELS,
    FITH_SOUND_MAX_VOICES,
    FITH_SOUND_VOICE_CAPS,
    type FithSoundEvent,
    type FithSoundOptions
} from '~/utils/fireinthehole-sounds'
import {
    FITH_SYNTH_DEFAULT_JITTER,
    FITH_SYNTH_JITTER,
    FITH_SYNTH_RECIPES,
    FithSynthVoice,
    fithCreak,
    fithDrip,
    fithMineLoop,
    fithSynthWarmUp,
    type FithLoopHandle
} from '~/utils/fireinthehole-synth'

const STORAGE_ENABLED = 'fireinthehole-sound-enabled'
const STORAGE_VOLUME = 'fireinthehole-sound-volume'

const soundEnabled = ref(true)
const soundVolume = ref(70)

const AMBIENCE_LEVEL = 0.2
const DRIP_LEVEL = 0.06
const CREAK_LEVEL = 0.07

interface MasterBus {
    input: GainNode
    compressor: DynamicsCompressorNode
}

interface ActiveVoice {
    event: FithSoundEvent | 'ambient'
    voice: FithSynthVoice
}

let ctx: AudioContext | null = null
let bus: MasterBus | null = null
const voices: ActiveVoice[] = []
const lastPlayedAt = new Map<FithSoundEvent, number>()
let mine: FithLoopHandle | null = null
let heat = 0
let dripTimer: ReturnType<typeof setTimeout> | null = null
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

function panFor(col: number | undefined) {
    if (col === undefined || !Number.isFinite(col)) return 0
    return Math.max(-0.6, Math.min(0.6, ((col + 0.5) / FITH_COLS * 2 - 1) * 0.6))
}

function spawn(context: AudioContext, event: ActiveVoice['event'], level: number, pan: number, pitch: number, recipe: (voice: FithSynthVoice) => void) {
    const voice = new FithSynthVoice(context, ensureBus(context).input, {
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

function play(event: FithSoundEvent, options: FithSoundOptions = {}) {
    const context = runningContext()
    if (!context) return
    const now = performance.now()
    if (now - (lastPlayedAt.get(event) ?? -Infinity) < FITH_SOUND_COOLDOWNS[event]) return
    lastPlayedAt.set(event, now)

    const cap = FITH_SOUND_VOICE_CAPS[event] ?? FITH_SOUND_DEFAULT_VOICE_CAP
    let same = 0
    for (const entry of voices) if (entry.event === event) same++
    if (same >= cap) {
        const oldest = voices.find(entry => entry.event === event)
        if (oldest) steal(oldest)
    }
    while (voices.length >= FITH_SOUND_MAX_VOICES) steal(voices[0]!)

    const jitter = FITH_SYNTH_JITTER[event] ?? FITH_SYNTH_DEFAULT_JITTER
    const pitch = 1 + (Math.random() * 2 - 1) * jitter
    const intensity = Math.max(0, options.intensity ?? 0)
    spawn(context, event, FITH_SOUND_LEVELS[event], panFor(options.col), pitch, (voice) => {
        FITH_SYNTH_RECIPES[event](voice, intensity)
    })
}

/** Silence every in-flight effect. */
function stopEffects() {
    lastPlayedAt.clear()
    for (const entry of voices.splice(0)) entry.voice.release(0.03)
}

function scheduleDrip() {
    if (!import.meta.client || !ambienceWanted || dripTimer) return
    const delay = 3_500 + Math.random() * 7_000
    dripTimer = setTimeout(() => {
        dripTimer = null
        if (!ambienceWanted) return
        const context = runningContext()
        if (context) {
            const creak = Math.random() < 0.25
            spawn(context, 'ambient', creak ? CREAK_LEVEL : DRIP_LEVEL, (Math.random() * 2 - 1) * 0.7, 1, creak ? fithCreak : fithDrip)
        }
        scheduleDrip()
    }, delay)
}

function startAmbience() {
    ambienceWanted = true
    const context = runningContext()
    if (!context) {
        // The first gesture may still be resuming the context; try again shortly.
        if (import.meta.client && soundEnabled.value) {
            setTimeout(() => {
                if (ambienceWanted && !mine && ctx?.state === 'running') startAmbience()
            }, 150)
        }
        return
    }
    fithSynthWarmUp(context)
    if (!mine) mine = fithMineLoop(context, ensureBus(context).input, AMBIENCE_LEVEL)
    mine.setHeat(heat)
    scheduleDrip()
}

function silenceAmbience() {
    if (dripTimer) clearTimeout(dripTimer)
    dripTimer = null
    mine?.stop()
    mine = null
}

function stopAmbience() {
    ambienceWanted = false
    heat = 0
    silenceAmbience()
}

/** 0 base game, 1 during free spins. */
function setHeat(level: number) {
    heat = Math.max(0, Math.min(1, level))
    mine?.setHeat(heat)
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

/** Resume the context from a user gesture (first click / key on the page). */
function unlock() {
    if (!soundEnabled.value) return
    const context = ensureContext()
    if (context && context.state !== 'running') void context.resume().catch(() => {})
    if (ambienceWanted && !mine) startAmbience()
}

function initialize() {
    if (!import.meta.client || initialized) return
    initialized = true
    try {
        const storedEnabled = localStorage.getItem(STORAGE_ENABLED)
        const storedVolume = localStorage.getItem(STORAGE_VOLUME)
        if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
        // Number(null) is 0, so check for null first or every first visit is muted.
        if (storedVolume !== null && Number.isFinite(Number(storedVolume))) {
            soundVolume.value = Math.max(0, Math.min(100, Number(storedVolume)))
        }
    } catch {
        // Storage blocked: keep the defaults.
    }
    watch(soundEnabled, (enabled) => {
        try {
            localStorage.setItem(STORAGE_ENABLED, String(enabled))
        } catch { /* storage blocked */ }
        if (!enabled) stopAll()
        else if (ambienceWanted) startAmbience()
    })
    watch(soundVolume, (volume) => {
        try {
            localStorage.setItem(STORAGE_VOLUME, String(volume))
        } catch { /* storage blocked */ }
        if (ctx && bus) bus.input.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.02)
        if (volume > 0 && ambienceWanted && !mine) startAmbience()
    })
}

export function useFireInTheHoleSound() {
    initialize()

    return {
        soundEnabled,
        soundVolume,
        play,
        unlock,
        stopEffects,
        startAmbience,
        stopAmbience,
        setHeat
    }
}
