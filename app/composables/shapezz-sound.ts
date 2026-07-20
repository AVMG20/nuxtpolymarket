// SHAPEZZ sound playback. Follows the pirate-sound.ts shape (levels,
// cooldowns, persisted enable/volume) but uses Web Audio instead of
// HTMLAudioElement: the blaster fires up to 18 shots per second, which needs
// overlapping playback from a decoded buffer plus a little pitch jitter so
// rapid fire doesn't sound like a stuck sample.
//
// Each event owns a folder public/shapezz/sound/<event>/ with numbered
// variant takes; play() picks randomly among the variants that actually
// loaded, so deleting audited-out files just narrows the pool.

import {
    SHAPEZZ_SOUND_COOLDOWNS,
    SHAPEZZ_SOUND_LEVELS,
    SHAPEZZ_SOUND_MANIFEST,
    SHAPEZZ_SOUND_VARIANTS,
    type ShapezzSoundEvent
} from '~/utils/shapezz-sounds'

const soundEnabled = ref(true)
const soundVolume = ref(70)

let ctx: AudioContext | null = null
const loading = new Map<string, Promise<AudioBuffer | null>>()
/** Resolved decode results — null marks a variant that 404'd or failed. */
const decoded = new Map<string, AudioBuffer | null>()
const lastPlayedAt = new Map<ShapezzSoundEvent, number>()
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

function loadVariant(event: ShapezzSoundEvent, variant: number): Promise<AudioBuffer | null> {
    const key = `${event}/${variant}`
    let cached = loading.get(key)
    if (cached) return cached
    cached = (async () => {
        const context = ensureContext()
        if (!context) return null
        try {
            const res = await fetch(`/shapezz/sound/${key}.wav`)
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

function play(event: ShapezzSoundEvent) {
    if (!import.meta.client || !soundEnabled.value) return
    const now = performance.now()
    if (now - (lastPlayedAt.get(event) ?? -Infinity) < SHAPEZZ_SOUND_COOLDOWNS[event]) return
    lastPlayedAt.set(event, now)

    const available: AudioBuffer[] = []
    for (let variant = 1; variant <= SHAPEZZ_SOUND_VARIANTS; variant++) {
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
    gain.gain.value = Math.min(1, (soundVolume.value / 100) * SHAPEZZ_SOUND_LEVELS[event])
    source.connect(gain)
    gain.connect(context.destination)
    activeSources.add(source)
    source.onended = () => activeSources.delete(source)
    source.start()
}

/** Stop every in-flight effect when the SHAPEZZ arena is unmounted. */
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

/** Resume a suspended AudioContext — call from a user gesture (starting a run). */
function unlock() {
    const context = ensureContext()
    if (context && context.state === 'suspended') void context.resume()
}

/** Fetch + decode every clip up front so the first shot isn't silent. */
function preload() {
    if (!import.meta.client) return
    for (const event of Object.keys(SHAPEZZ_SOUND_MANIFEST) as ShapezzSoundEvent[]) {
        for (let variant = 1; variant <= SHAPEZZ_SOUND_VARIANTS; variant++) {
            void loadVariant(event, variant)
        }
    }
}

function initialize() {
    if (!import.meta.client || initialized) return
    initialized = true
    const storedEnabled = localStorage.getItem('shapezz-sound-enabled')
    const storedVolume = Number(localStorage.getItem('shapezz-sound-volume'))
    if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
    if (Number.isFinite(storedVolume)) soundVolume.value = Math.max(0, Math.min(100, storedVolume))
    watch(soundEnabled, enabled => localStorage.setItem('shapezz-sound-enabled', String(enabled)))
    watch(soundVolume, volume => localStorage.setItem('shapezz-sound-volume', String(volume)))
}

export function useShapezzSound() {
    initialize()
    return { soundEnabled, soundVolume, play, stop, unlock, preload }
}
