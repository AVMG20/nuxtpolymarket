// Live blackjack sound playback. Same shape as shapezz-sound.ts — Web Audio,
// per-event levels and cooldowns, persisted enable/volume — because a dealt
// round fires several card sounds inside a few hundred milliseconds and needs
// overlapping playback with a little pitch jitter.
//
// Each event owns a folder public/live-blackjack/sound/<event>/ with numbered
// takes; play() picks randomly among the variants that actually loaded, so a
// table with no generated audio yet is silent rather than broken.

import {
    LB_SOUND_COOLDOWNS,
    LB_SOUND_LEVELS,
    LB_SOUND_MANIFEST,
    LB_SOUND_VARIANTS,
    type LbSoundEvent
} from '~/utils/live-blackjack-sounds'

const soundEnabled = ref(true)
const soundVolume = ref(70)

let ctx: AudioContext | null = null
const loading = new Map<string, Promise<AudioBuffer | null>>()
/** Resolved decode results — null marks a variant that 404'd or failed. */
const decoded = new Map<string, AudioBuffer | null>()
const lastPlayedAt = new Map<LbSoundEvent, number>()
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

function loadVariant(event: LbSoundEvent, variant: number): Promise<AudioBuffer | null> {
    const key = `${event}/${variant}`
    let cached = loading.get(key)
    if (cached) return cached
    cached = (async () => {
        const context = ensureContext()
        if (!context) return null
        try {
            const res = await fetch(`/live-blackjack/sound/${key}.wav`)
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

function play(event: LbSoundEvent) {
    if (!import.meta.client || !soundEnabled.value) return
    const now = performance.now()
    if (now - (lastPlayedAt.get(event) ?? -Infinity) < LB_SOUND_COOLDOWNS[event]) return
    lastPlayedAt.set(event, now)

    const available: AudioBuffer[] = []
    for (let variant = 1; variant <= LB_SOUND_VARIANTS; variant++) {
        const buffer = decoded.get(`${event}/${variant}`)
        if (buffer) available.push(buffer)
        else if (buffer === undefined) void loadVariant(event, variant)
    }
    const context = ensureContext()
    const buffer = available[Math.floor(Math.random() * available.length)]
    if (!buffer || !context) return

    const source = context.createBufferSource()
    source.buffer = buffer
    // A hand deals four cards in a row off the same short sample; without
    // jitter that reads as a stutter rather than four separate cards.
    source.playbackRate.value = 0.95 + Math.random() * 0.1
    const gain = context.createGain()
    gain.gain.value = Math.min(1, (soundVolume.value / 100) * LB_SOUND_LEVELS[event])
    source.connect(gain)
    gain.connect(context.destination)
    activeSources.add(source)
    source.onended = () => activeSources.delete(source)
    source.start()
}

/** Stop every in-flight effect when the table is unmounted. */
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

/** Resume a suspended AudioContext — call from a user gesture (sitting, betting). */
function unlock() {
    const context = ensureContext()
    if (context && context.state === 'suspended') void context.resume()
}

/** Fetch + decode every clip up front so the first card dealt isn't silent. */
function preload() {
    if (!import.meta.client) return
    for (const event of Object.keys(LB_SOUND_MANIFEST) as LbSoundEvent[]) {
        for (let variant = 1; variant <= LB_SOUND_VARIANTS; variant++) {
            void loadVariant(event, variant)
        }
    }
}

function initialize() {
    if (!import.meta.client || initialized) return
    initialized = true
    const storedEnabled = localStorage.getItem('lb-sound-enabled')
    const storedVolume = localStorage.getItem('lb-sound-volume')
    if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
    // Number(null) is 0, not NaN, so reading the volume without the null check
    // first sets it to zero and silently mutes the table on every first visit.
    if (storedVolume !== null && Number.isFinite(Number(storedVolume))) {
        soundVolume.value = Math.max(0, Math.min(100, Number(storedVolume)))
    }
    watch(soundEnabled, enabled => localStorage.setItem('lb-sound-enabled', String(enabled)))
    watch(soundVolume, volume => localStorage.setItem('lb-sound-volume', String(volume)))
}

export function useLiveBlackjackSound() {
    initialize()
    return { soundEnabled, soundVolume, play, stop, unlock, preload }
}
