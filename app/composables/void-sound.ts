// Void Runner sound playback. Mirrors shapezz-sound.ts: Web Audio rather than
// HTMLAudioElement, because the primary cannon fires many shots per second and
// needs overlapping playback from a decoded buffer plus a little pitch jitter
// so rapid fire doesn't sound like a stuck sample.
//
// Each event owns a folder public/void/sound/<event>/ with numbered variant
// takes; play() picks randomly among the variants that actually loaded, so
// deleting audited-out files just narrows the pool.

import {
    VOID_SOUND_COOLDOWNS,
    VOID_SOUND_LEVELS,
    VOID_SOUND_MANIFEST,
    VOID_SOUND_VARIANTS,
    type VoidSoundEvent
} from '~/utils/void-sounds'

const soundEnabled = ref(true)
const soundVolume = ref(70)

let ctx: AudioContext | null = null
const loading = new Map<string, Promise<AudioBuffer | null>>()
/** Resolved decode results — null marks a variant that 404'd or failed. */
const decoded = new Map<string, AudioBuffer | null>()
const lastPlayedAt = new Map<VoidSoundEvent, number>()
const activeSources = new Set<AudioBufferSourceNode>()
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

function loadVariant(event: VoidSoundEvent, variant: number): Promise<AudioBuffer | null> {
    const key = `${event}/${variant}`
    let cached = loading.get(key)
    if (cached) return cached
    cached = (async () => {
        const context = ensureContext()
        if (!context) return null
        try {
            const res = await fetch(`/void/sound/${key}.wav`)
            if (!res.ok) return null
            return await context.decodeAudioData(await res.arrayBuffer())
        } catch {
            // Missing variant (not generated, or deleted during audit) —
            // play() just won't pick it.
            return null
        }
    })().then((buffer) => {
        decoded.set(key, buffer)
        return buffer
    })
    loading.set(key, cached)
    return cached
}

function play(event: VoidSoundEvent) {
    if (!import.meta.client || !soundEnabled.value) return
    const now = performance.now()
    if (now - (lastPlayedAt.get(event) ?? -Infinity) < VOID_SOUND_COOLDOWNS[event]) return
    lastPlayedAt.set(event, now)

    const available: AudioBuffer[] = []
    for (let variant = 1; variant <= VOID_SOUND_VARIANTS; variant++) {
        const buffer = decoded.get(`${event}/${variant}`)
        if (buffer) available.push(buffer)
        else if (buffer === undefined) void loadVariant(event, variant)
    }
    const context = ensureContext()
    const buffer = available[Math.floor(Math.random() * available.length)]
    if (!buffer || !context) return

    const source = context.createBufferSource()
    source.buffer = buffer
    // ±6% pitch jitter keeps rapid fire from machine-gunning one sample.
    source.playbackRate.value = 0.94 + Math.random() * 0.12
    const gain = context.createGain()
    gain.gain.value = Math.min(1, (soundVolume.value / 100) * VOID_SOUND_LEVELS[event])
    source.connect(gain)
    gain.connect(context.destination)
    activeSources.add(source)
    source.onended = () => activeSources.delete(source)
    source.start()
}

/** Stop every in-flight effect when the run ends or the arena unmounts. */
function stop() {
    for (const source of activeSources) {
        try {
            source.stop()
        } catch {
            // A source may already have naturally ended between iteration and stop().
        }
    }
    activeSources.clear()
    lastPlayedAt.clear()
}

/** Resume a suspended AudioContext — call from a user gesture (launching a run). */
function unlock() {
    const context = ensureContext()
    if (context && context.state === 'suspended') void context.resume()
}

/** Fetch + decode every clip up front so the first shot isn't silent. */
function preload() {
    if (!import.meta.client) return
    for (const event of Object.keys(VOID_SOUND_MANIFEST) as VoidSoundEvent[]) {
        for (let variant = 1; variant <= VOID_SOUND_VARIANTS; variant++) {
            void loadVariant(event, variant)
        }
    }
}

function initialize() {
    if (!import.meta.client || initialized) return
    initialized = true
    const storedEnabled = localStorage.getItem('void-sound-enabled')
    const storedVolume = Number(localStorage.getItem('void-sound-volume'))
    if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
    if (Number.isFinite(storedVolume)) soundVolume.value = Math.max(0, Math.min(100, storedVolume))
    watch(soundEnabled, enabled => localStorage.setItem('void-sound-enabled', String(enabled)))
    watch(soundVolume, volume => localStorage.setItem('void-sound-volume', String(volume)))
}

export function useVoidSound() {
    initialize()
    return { soundEnabled, soundVolume, play, stop, unlock, preload }
}
