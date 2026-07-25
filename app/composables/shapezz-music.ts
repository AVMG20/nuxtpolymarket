// SHAPEZZ background music. A plain HTMLAudioElement is enough here — unlike
// shapezz-sound.ts's one-shots, a single long looping track never needs
// overlapping playback, so there's no reason to route it through Web Audio.
//
// Volume is driven by a rAF loop rather than set directly so both the 30s
// fade-in and the power-up-selection duck arrive as smooth ramps instead of
// audible steps. One track is picked at random each time a run starts.

const MUSIC_TRACKS = ['arcade-shooter-loop', 'arcade-overdrive'] as const

/** Background music never gets to compete with SFX — cap it well under, even at 100% volume. */
const MAX_MUSIC_LEVEL = 0.34
/** How long the fade-in from silence to MAX_MUSIC_LEVEL takes after a run starts. */
const FADE_IN_MS = 30000
/** Volume multiplier applied while a power-up (checkpoint/head-start) screen is open. */
const DUCK_LEVEL = 0.3
/** Per-frame approach rate toward the current target — smooths duck/mute transitions. */
const SMOOTHING = 0.06

let audioEl: HTMLAudioElement | null = null
let rafId: number | null = null
let startedAt = 0
let ducked = false
let playing = false

function ensureAudio(): HTMLAudioElement | null {
    if (!import.meta.client) return null
    if (!audioEl) {
        audioEl = new Audio()
        audioEl.loop = true
        audioEl.volume = 0
        audioEl.preload = 'auto'
    }
    return audioEl
}

function targetLevel(soundVolume: number): number {
    const elapsed = performance.now() - startedAt
    const fadeProgress = Math.min(1, elapsed / FADE_IN_MS)
    const base = (soundVolume / 100) * MAX_MUSIC_LEVEL * fadeProgress
    return ducked ? base * DUCK_LEVEL : base
}

function tick(getVolume: () => number, getEnabled: () => boolean) {
    if (!audioEl || !playing) return
    const enabled = getEnabled()
    const target = enabled ? targetLevel(getVolume()) : 0
    const current = audioEl.volume
    audioEl.volume = Math.max(0, Math.min(1, current + (target - current) * SMOOTHING))

    if (enabled && audioEl.paused) void audioEl.play().catch(() => {})
    else if (!enabled && !audioEl.paused && audioEl.volume < 0.002) audioEl.pause()

    rafId = requestAnimationFrame(() => tick(getVolume, getEnabled))
}

export function useShapezzMusic() {
    const sound = useShapezzSound()

    /** Call from a run start (a user gesture chain) — picks a random track and begins the fade-in. */
    function play() {
        if (!import.meta.client) return
        const el = ensureAudio()
        if (!el) return
        const track = MUSIC_TRACKS[Math.floor(Math.random() * MUSIC_TRACKS.length)]
        el.src = `/shapezz/music/${track}.mp3`
        el.currentTime = 0
        el.volume = 0
        ducked = false
        startedAt = performance.now()
        playing = true
        void el.play().catch(() => {})
        if (rafId) cancelAnimationFrame(rafId)
        tick(() => sound.soundVolume.value, () => sound.soundEnabled.value)
    }

    /** Stop playback entirely — call when a run ends or the arena unmounts. */
    function stop() {
        playing = false
        if (rafId) cancelAnimationFrame(rafId)
        rafId = null
        if (audioEl) {
            audioEl.pause()
            audioEl.currentTime = 0
        }
    }

    /** Reduce music under power-up selection (checkpoint/head-start) screens; restore when closed. */
    function duck(value: boolean) {
        ducked = value
    }

    return { play, stop, duck }
}
