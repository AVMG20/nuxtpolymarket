// Live table sound playback. Same shape as live-blackjack-sound.ts — Web Audio,
// per-event levels and cooldowns, persisted enable/volume — because a dealt
// round fires several card sounds inside a few hundred milliseconds and needs
// overlapping playback with a little pitch jitter.
//
// Each event owns a folder public/live-table/sound/<event>/ with numbered
// takes; play() picks randomly among the variants that actually loaded, so a
// table with no generated audio yet is silent rather than broken.

import {
    LT_AMBIENT_STING_EVENTS,
    LT_MURMUR_VARIANTS,
    LT_SOUND_COOLDOWNS,
    LT_SOUND_LEVELS,
    LT_SOUND_MANIFEST,
    LT_SOUND_VARIANTS,
    type LtSoundEvent
} from '~/utils/live-table-sounds'

const soundEnabled = ref(true)
const soundVolume = ref(70)
const bgEnabled = ref(true)
const bgVolume = ref(20)

let ctx: AudioContext | null = null
const loading = new Map<string, Promise<AudioBuffer | null>>()
/** Resolved decode results — null marks a variant that 404'd or failed. */
const decoded = new Map<string, AudioBuffer | null>()
const lastPlayedAt = new Map<LtSoundEvent, number>()
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

/** Shared by loadVariant() and loadMurmur() — same fetch/decode/cache shape,
 *  just a different URL and cache key. */
function loadClip(key: string, url: string): Promise<AudioBuffer | null> {
    let cached = loading.get(key)
    if (cached) return cached
    cached = (async () => {
        const context = ensureContext()
        if (!context) return null
        try {
            const res = await fetch(url)
            if (!res.ok) return null
            return await context.decodeAudioData(await res.arrayBuffer())
        } catch {
            return null
        }
    })().then((buffer) => {
        decoded.set(key, buffer)
        return buffer
    })
    loading.set(key, cached)
    return cached
}

function loadVariant(event: LtSoundEvent, variant: number): Promise<AudioBuffer | null> {
    return loadClip(`${event}/${variant}`, `/live-table/sound/${event}/${variant}.wav`)
}

function loadMurmur(variant: number): Promise<AudioBuffer | null> {
    return loadClip(`ambient-murmur/${variant}`, `/live-table/sound/ambient-murmur/${variant}.wav`)
}

/** Ambient stings fade in/out at the gain node on top of whatever fade is
 *  already baked into the file — table SFX (a card snap, a chip click) plays
 *  at full volume from sample zero, since those are meant to read as
 *  instant, but a sting is meant to read as something happening elsewhere in
 *  the room, and cutting it in and out at full volume reads as a glitch
 *  rather than atmosphere. */
const STING_FADE_IN_MS = 350
const STING_FADE_OUT_MS = 450

/** Shared by play() (an SFX event, gated on soundEnabled/soundVolume) and the
 *  ambience stings (gated on bgEnabled/bgVolume instead, and faded) —
 *  everything past which enabled/volume ref applies is identical. */
function playWith(event: LtSoundEvent, enabled: Ref<boolean>, volume: Ref<number>, fade = false) {
    if (!import.meta.client || !enabled.value) return
    const now = performance.now()
    if (now - (lastPlayedAt.get(event) ?? -Infinity) < LT_SOUND_COOLDOWNS[event]) return
    lastPlayedAt.set(event, now)

    const available: AudioBuffer[] = []
    for (let variant = 1; variant <= LT_SOUND_VARIANTS; variant++) {
        const buffer = decoded.get(`${event}/${variant}`)
        if (buffer) available.push(buffer)
        else if (buffer === undefined) void loadVariant(event, variant)
    }
    const context = ensureContext()
    const buffer = available[Math.floor(Math.random() * available.length)]
    if (!buffer || !context) return

    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 0.95 + Math.random() * 0.1
    const gain = context.createGain()
    const target = Math.min(1, (volume.value / 100) * LT_SOUND_LEVELS[event])

    if (fade) {
        const audibleSeconds = buffer.duration / source.playbackRate.value
        const start = context.currentTime
        const fadeInEnd = start + Math.min(STING_FADE_IN_MS / 1000, audibleSeconds / 2)
        const fadeOutStart = Math.max(fadeInEnd, start + audibleSeconds - STING_FADE_OUT_MS / 1000)
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(target, fadeInEnd)
        gain.gain.setValueAtTime(target, fadeOutStart)
        gain.gain.linearRampToValueAtTime(0, start + audibleSeconds)
    } else {
        gain.gain.value = target
    }

    source.connect(gain)
    gain.connect(context.destination)
    activeSources.add(source)
    source.onended = () => activeSources.delete(source)
    source.start()
}

function play(event: LtSoundEvent) {
    playWith(event, soundEnabled, soundVolume)
}

// --- Casino ambience: a looping murmur bed with occasional stings ---
// Real recorded audio now, not synthesized noise — a seamless crossfade-looped
// room-tone track (see scripts/generate-live-table-ambience.ts) with distant
// slot/crowd/table stings dropped in at random on top of it, the way a rain
// app layers a base loop under occasional thunder.
// 0.3 read as too loud even at moderate slider settings — halved again on
// top of that per feedback that the whole slider should top out quieter.
const MURMUR_GAIN_SCALE = 0.12
const STING_DELAY_MIN_MS = 15_000
const STING_DELAY_MAX_MS = 40_000
/** The bed easing in on first unlock and easing out on stop() — a page nav
 *  or a mute snapping it at full volume is the "abrupt" the fade is for. */
const MURMUR_FADE_IN_MS = 1200
const MURMUR_FADE_OUT_MS = 600
/** Mute toggle and volume drags ramp too, rather than jumping the gain. */
const MURMUR_GAIN_RAMP_MS = 300

let murmurSource: AudioBufferSourceNode | null = null
let murmurGain: GainNode | null = null
let ambienceStarting = false
let stingTimer: ReturnType<typeof setTimeout> | null = null

function currentMurmurTarget(): number {
    return bgEnabled.value ? (bgVolume.value / 100) * MURMUR_GAIN_SCALE : 0
}

function scheduleSting() {
    const delay = STING_DELAY_MIN_MS + Math.random() * (STING_DELAY_MAX_MS - STING_DELAY_MIN_MS)
    stingTimer = setTimeout(() => {
        const event = LT_AMBIENT_STING_EVENTS[Math.floor(Math.random() * LT_AMBIENT_STING_EVENTS.length)]!
        playWith(event, bgEnabled, bgVolume, true)
        scheduleSting()
    }, delay)
}

async function startAmbience() {
    const context = ensureContext()
    if (!context || murmurSource || ambienceStarting) return
    ambienceStarting = true
    try {
        const pick = 1 + Math.floor(Math.random() * LT_MURMUR_VARIANTS)
        const buffer = await loadMurmur(pick)
        // Nothing generated yet, or a stop() landed while this was in flight.
        if (!buffer || murmurSource) return

        const source = context.createBufferSource()
        source.buffer = buffer
        source.loop = true
        const gain = context.createGain()
        const start = context.currentTime
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(currentMurmurTarget(), start + MURMUR_FADE_IN_MS / 1000)
        source.connect(gain)
        gain.connect(context.destination)
        source.start()

        murmurSource = source
        murmurGain = gain
        scheduleSting()
    } finally {
        ambienceStarting = false
    }
}

function stopAmbience() {
    if (stingTimer) {
        clearTimeout(stingTimer)
        stingTimer = null
    }
    const source = murmurSource
    const gain = murmurGain
    murmurSource = null
    murmurGain = null
    if (!source || !gain || !ctx) return

    // Ramp out rather than cutting the loop dead, then tear the nodes down
    // once the ramp has actually finished.
    const start = ctx.currentTime
    gain.gain.cancelScheduledValues(start)
    gain.gain.setValueAtTime(gain.gain.value, start)
    gain.gain.linearRampToValueAtTime(0, start + MURMUR_FADE_OUT_MS / 1000)
    setTimeout(() => {
        try {
            source.stop()
        } catch {
            // already stopped
        }
        source.disconnect()
        gain.disconnect()
    }, MURMUR_FADE_OUT_MS + 50)
}

function updateBgGain() {
    if (!murmurGain || !ctx) return
    const start = ctx.currentTime
    murmurGain.gain.cancelScheduledValues(start)
    murmurGain.gain.setValueAtTime(murmurGain.gain.value, start)
    murmurGain.gain.linearRampToValueAtTime(currentMurmurTarget(), start + MURMUR_GAIN_RAMP_MS / 1000)
}

/** Stop every in-flight effect and background ambience when the table is unmounted. */
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
    stopAmbience()
}

/** Resume a suspended AudioContext and start ambience — call from a user gesture. */
function unlock() {
    const context = ensureContext()
    if (context && context.state === 'suspended') void context.resume()
    if (context && context.state === 'running') void startAmbience()
}

/** Fetch + decode every clip up front so the first card dealt isn't silent. */
function preload() {
    if (!import.meta.client) return
    for (const event of Object.keys(LT_SOUND_MANIFEST) as LtSoundEvent[]) {
        for (let variant = 1; variant <= LT_SOUND_VARIANTS; variant++) {
            void loadVariant(event, variant)
        }
    }
    for (let variant = 1; variant <= LT_MURMUR_VARIANTS; variant++) {
        void loadMurmur(variant)
    }
}

let gestureListenersAdded = false

function attachGestureUnlock() {
    if (!import.meta.client || gestureListenersAdded) return
    gestureListenersAdded = true
    const onGesture = () => {
        unlock()
        if (ctx && ctx.state === 'running') {
            window.removeEventListener('pointerdown', onGesture, true)
            window.removeEventListener('keydown', onGesture, true)
            window.removeEventListener('click', onGesture, true)
        }
    }
    window.addEventListener('pointerdown', onGesture, { capture: true, passive: true })
    window.addEventListener('keydown', onGesture, { capture: true, passive: true })
    window.addEventListener('click', onGesture, { capture: true, passive: true })
}

function initialize() {
    if (!import.meta.client || initialized) return
    initialized = true
    attachGestureUnlock()
    const storedEnabled = localStorage.getItem('lt-sound-enabled')
    const storedVolume = localStorage.getItem('lt-sound-volume')
    const storedBgEnabled = localStorage.getItem('lt-bg-enabled')
    const storedBgVolume = localStorage.getItem('lt-bg-volume')
    if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
    if (storedVolume !== null && Number.isFinite(Number(storedVolume))) {
        soundVolume.value = Math.max(0, Math.min(100, Number(storedVolume)))
    }
    if (storedBgEnabled !== null) bgEnabled.value = storedBgEnabled === 'true'
    if (storedBgVolume !== null && Number.isFinite(Number(storedBgVolume))) {
        bgVolume.value = Math.max(0, Math.min(100, Number(storedBgVolume)))
    }
    // Detached: these refs are a module-level singleton meant to outlive any one
    // page, but watch() otherwise binds to whichever component's effect scope is
    // active on this first call — and dies with it on that page's unmount, taking
    // persistence and the live ambience gain updates with it.
    effectScope(true).run(() => {
        watch(soundEnabled, enabled => localStorage.setItem('lt-sound-enabled', String(enabled)))
        watch(soundVolume, volume => localStorage.setItem('lt-sound-volume', String(volume)))
        watch(bgEnabled, enabled => {
            localStorage.setItem('lt-bg-enabled', String(enabled))
            updateBgGain()
        })
        watch(bgVolume, volume => {
            localStorage.setItem('lt-bg-volume', String(volume))
            updateBgGain()
        })
    })
}

export function useLiveTableSound() {
    initialize()
    return { soundEnabled, soundVolume, bgEnabled, bgVolume, play, stop, unlock, preload }
}
