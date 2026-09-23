// Trash Panda Heist sound playback. Every effect is synthesized on the fly
// (app/utils/slots/trashpanda-synth.ts); nothing is fetched. Same shape as
// pirate-sound.ts: per-event levels, cooldowns and voice caps, persisted
// enable/volume.
//
// Signal chain: voice (level) -> master gain (player volume) -> compressor ->
// speakers. The reel whir feeds the same master gain; the heist music has its
// own gain into the compressor, so effects and music have separate volumes.

import {
    TPH_SOUND_COOLDOWNS,
    TPH_SOUND_DEFAULT_VOICE_CAP,
    TPH_SOUND_LEVELS,
    TPH_SOUND_MAX_VOICES,
    TPH_SOUND_VOICE_CAPS,
    TPH_SYNTH_DEFAULT_JITTER,
    TPH_SYNTH_JITTER,
    TPH_SYNTH_RECIPES,
    TphMusic,
    TphReelWhir,
    TphSynthVoice,
    tphSynthWarmUp,
    type TphSoundEvent
} from '~/utils/slots/trashpanda-synth'

export type { TphSoundEvent }

const STORAGE_ENABLED = 'trashpanda-sound-enabled'
const STORAGE_VOLUME = 'trashpanda-sound-volume'
const STORAGE_MUSIC = 'trashpanda-music-volume'

const soundEnabled = ref(true)
const soundVolume = ref(70)
const musicVolume = ref(60)

const WHIR_LEVEL = 0.1
const MUSIC_LEVEL = 0.45

interface MasterBus {
    input: GainNode
    music: GainNode
    compressor: DynamicsCompressorNode
}

interface ActiveVoice {
    event: TphSoundEvent
    voice: TphSynthVoice
}

let ctx: AudioContext | null = null
let bus: MasterBus | null = null
const voices: ActiveVoice[] = []
const lastPlayedAt = new Map<TphSoundEvent, number>()
let whir: TphReelWhir | null = null
let music: TphMusic | null = null
let musicWanted = false
let bonusMode = false
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

function musicLevel(): number {
    return Math.max(0, Math.min(1, musicVolume.value / 100))
}

function ensureBus(context: AudioContext): MasterBus {
    if (bus) return bus
    const input = context.createGain()
    input.gain.value = masterLevel()
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -12
    compressor.knee.value = 10
    compressor.ratio.value = 8
    compressor.attack.value = 0.003
    compressor.release.value = 0.25
    const musicGain = context.createGain()
    musicGain.gain.value = musicLevel()
    input.connect(compressor)
    musicGain.connect(compressor)
    compressor.connect(context.destination)
    bus = { input, music: musicGain, compressor }
    return bus
}

/** A running context, resumed if a gesture allows it. Null while it can't play yet. */
function runningContext(): AudioContext | null {
    if (!import.meta.client || !soundEnabled.value || soundVolume.value <= 0) return null
    const context = ensureContext()
    if (!context) return null
    if (context.state !== 'running') {
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

function play(event: TphSoundEvent, intensity = 0, delay = 0) {
    const context = runningContext()
    if (!context) return
    const now = performance.now()
    if (now - (lastPlayedAt.get(event) ?? -Infinity) < TPH_SOUND_COOLDOWNS[event]) return
    lastPlayedAt.set(event, now)

    const cap = TPH_SOUND_VOICE_CAPS[event] ?? TPH_SOUND_DEFAULT_VOICE_CAP
    let same = 0
    for (const entry of voices) if (entry.event === event) same++
    if (same >= cap) {
        const oldest = voices.find(entry => entry.event === event)
        if (oldest) steal(oldest)
    }
    while (voices.length >= TPH_SOUND_MAX_VOICES) steal(voices[0]!)

    const jitter = TPH_SYNTH_JITTER[event] ?? TPH_SYNTH_DEFAULT_JITTER
    const voice = new TphSynthVoice(context, ensureBus(context).input, {
        level: TPH_SOUND_LEVELS[event],
        pitch: 1 + (Math.random() * 2 - 1) * jitter,
        start: context.currentTime + 0.005 + Math.max(0, delay)
    })
    const entry: ActiveVoice = { event, voice }
    voice.onDone = () => removeVoice(entry)
    voices.push(entry)
    try {
        TPH_SYNTH_RECIPES[event](voice, intensity)
    } catch {
        voice.release(0)
    }
    voice.seal()
}

function startWhir() {
    const context = runningContext()
    if (!context) return
    whir?.stop(0.05)
    whir = new TphReelWhir(context, ensureBus(context).input, WHIR_LEVEL)
}

function setWhir(share: number) {
    whir?.setLevel(share)
}

function stopWhir() {
    whir?.stop()
    whir = null
}

function startMusic() {
    musicWanted = true
    if (!import.meta.client || !soundEnabled.value || musicVolume.value <= 0 || music) return
    const context = ensureContext()
    if (!context) return
    if (context.state !== 'running') {
        void context.resume().catch(() => {})
        return
    }
    tphSynthWarmUp(context)
    music = new TphMusic(context, ensureBus(context).music, MUSIC_LEVEL)
    music.setBonus(bonusMode)
}

function silenceMusic() {
    music?.stop()
    music = null
}

function stopMusic() {
    musicWanted = false
    bonusMode = false
    silenceMusic()
}

function setBonusMusic(on: boolean) {
    bonusMode = on
    music?.setBonus(on)
}

/** Resume the context from a user gesture, then start anything waiting on it. */
function unlock() {
    if (!soundEnabled.value) return
    const context = ensureContext()
    if (!context) return
    const go = () => {
        tphSynthWarmUp(context)
        if (musicWanted) startMusic()
    }
    if (context.state === 'running') go()
    else void context.resume().then(go).catch(() => {})
}

function stopEffects() {
    lastPlayedAt.clear()
    stopWhir()
    for (const entry of voices.splice(0)) entry.voice.release(0.03)
}

function stopAll() {
    stopEffects()
    silenceMusic()
    if (!ctx || !bus) return
    const old = bus
    bus = null
    const now = ctx.currentTime
    old.input.gain.cancelScheduledValues(now)
    old.input.gain.setValueAtTime(old.input.gain.value, now)
    old.input.gain.linearRampToValueAtTime(0, now + 0.02)
    setTimeout(() => {
        old.input.disconnect()
        old.music.disconnect()
        old.compressor.disconnect()
    }, 80)
}

function readStorage(key: string): string | null {
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function writeStorage(key: string, value: string) {
    try {
        localStorage.setItem(key, value)
    } catch {
        // Private mode or blocked storage: the setting just won't persist.
    }
}

function initialize() {
    if (!import.meta.client || initialized) return
    initialized = true
    const storedEnabled = readStorage(STORAGE_ENABLED)
    const storedVolume = readStorage(STORAGE_VOLUME)
    const storedMusic = readStorage(STORAGE_MUSIC)
    if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
    if (storedMusic !== null && Number.isFinite(Number(storedMusic))) {
        musicVolume.value = Math.max(0, Math.min(100, Number(storedMusic)))
    }
    if (storedVolume !== null && Number.isFinite(Number(storedVolume))) {
        soundVolume.value = Math.max(0, Math.min(100, Number(storedVolume)))
    }
    watch(soundEnabled, (enabled) => {
        writeStorage(STORAGE_ENABLED, String(enabled))
        if (!enabled) stopAll()
        else unlock()
    })
    watch(musicVolume, (volume) => {
        writeStorage(STORAGE_MUSIC, String(volume))
        if (ctx && bus) bus.music.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.02)
        if (volume <= 0) silenceMusic()
        else if (musicWanted && !music) startMusic()
    })
    watch(soundVolume, (volume) => {
        writeStorage(STORAGE_VOLUME, String(volume))
        if (ctx && bus) bus.input.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.02)
    })
}

export function useTrashPandaSound() {
    initialize()

    return {
        soundEnabled,
        soundVolume,
        musicVolume,
        play,
        unlock,
        startWhir,
        setWhir,
        stopWhir,
        startMusic,
        stopMusic,
        setBonusMusic,
        stopEffects
    }
}
