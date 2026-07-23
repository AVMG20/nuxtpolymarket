export type PirateSoundEvent =
    | 'cannon-fire' | 'cannon-impact' | 'ship-hit' | 'enemy-sunk' | 'treasure-pickup' | 'power-up' | 'speed-boost' | 'menu'
    | 'powder-keg-throw' | 'powder-keg-explosion' | 'hunter-salvo-launch' | 'hunter-salvo-hit'
    | 'stormchain-call' | 'stormchain-hit' | 'kraken-open' | 'hellfire-barrage' | 'hellfire-multi'

const soundEnabled = ref(true)
const soundVolume = ref(70)

const SOUND_FILES: Record<PirateSoundEvent, string[]> = {
    'cannon-fire': [
        '/pirates/sounds/cannon-shot.mp3',
        '/pirates/sounds/cannon-shot-2.mp3',
        '/pirates/sounds/cannon-shot-3.mp3'
    ],
    'cannon-impact': ['/pirates/sounds/cannon-impact.mp3', '/pirates/sounds/cannon-impact-2.mp3'],
    'ship-hit': ['/pirates/sounds/ship-hit-damage.mp3', '/pirates/sounds/ship-hit-damage-2.mp3'],
    'enemy-sunk': [
        '/pirates/sounds/enemy-sunk.mp3',
        '/pirates/sounds/enemy-sunk-2.mp3',
        '/pirates/sounds/enemy-sunk-3.mp3',
        '/pirates/sounds/enemy-sunk-4.mp3'
    ],
    'treasure-pickup': ['/pirates/sounds/treasure-pickup.mp3'],
    'power-up': ['/pirates/sounds/power-up-collected.mp3'],
    'speed-boost': ['/pirates/sounds/speed-boost.mp3'],
    'menu': ['/pirates/sounds/menu-button.mp3'],
    'powder-keg-throw': ['/pirates/sounds/powder-keg-throw.mp3', '/pirates/sounds/powder-keg-throw-2.mp3', '/pirates/sounds/powder-keg-throw-3.mp3'],
    'powder-keg-explosion': ['/pirates/sounds/powder-keg-explosion.mp3', '/pirates/sounds/powder-keg-explosion-2.mp3'],
    'hunter-salvo-launch': ['/pirates/sounds/hunter-salvo-launch.mp3'],
    'hunter-salvo-hit': ['/pirates/sounds/hunter-salvo-hit.mp3', '/pirates/sounds/hunter-salvo-hit-2.mp3'],
    'stormchain-call': ['/pirates/sounds/stormchain-call.mp3', '/pirates/sounds/stormchain-call-2.mp3'],
    'stormchain-hit': ['/pirates/sounds/stormchain-hit.mp3', '/pirates/sounds/stormchain-hit-2.mp3'],
    'kraken-open': ['/pirates/sounds/kraken-open.mp3', '/pirates/sounds/kraken-open-2.mp3'],
    'hellfire-barrage': ['/pirates/sounds/hellfire-barrage.mp3'],
    'hellfire-multi': ['/pirates/sounds/hellfire-barage-multi.mp3']
}

// These are intentional mix levels relative to the player's master volume.
// The generated boost and ambience assets are particularly hot.
const SOUND_LEVELS: Record<PirateSoundEvent, number> = {
    'cannon-fire': 0.42,
    'cannon-impact': 0.34,
    'ship-hit': 0.36,
    'enemy-sunk': 0.48,
    'treasure-pickup': 0.32,
    'power-up': 0.38,
    'speed-boost': 0.14,
    'menu': 0.2,
    'powder-keg-throw': 0.32,
    'powder-keg-explosion': 0.44,
    'hunter-salvo-launch': 0.34,
    'hunter-salvo-hit': 0.3,
    'stormchain-call': 0.32,
    'stormchain-hit': 0.26,
    'kraken-open': 0.34,
    'hellfire-barrage': 0.32,
    'hellfire-multi': 0.38
}

const SOUND_COOLDOWNS: Partial<Record<PirateSoundEvent, number>> = {
    'cannon-fire': 140,
    'cannon-impact': 100,
    'ship-hit': 180,
    'hunter-salvo-hit': 120,
    'stormchain-hit': 120
}

const lastPlayedAt = new Map<PirateSoundEvent, number>()
const activeEffects = new Set<HTMLAudioElement>()
let ambience: HTMLAudioElement | null = null
let krakenLoop: HTMLAudioElement | null = null
let seagullTimer: ReturnType<typeof setTimeout> | null = null
let ambienceWanted = false
let initialized = false

function masterLevel() {
    return soundEnabled.value ? soundVolume.value / 100 : 0
}

function pick(files: string[]) {
    return files[Math.floor(Math.random() * files.length)]!
}

function play(event: PirateSoundEvent) {
    if (!import.meta.client || !soundEnabled.value) return
    const now = performance.now()
    const cooldown = SOUND_COOLDOWNS[event] ?? 0
    if (now - (lastPlayedAt.get(event) ?? -Infinity) < cooldown) return
    lastPlayedAt.set(event, now)

    const audio = new Audio(pick(SOUND_FILES[event]))
    audio.volume = Math.min(1, masterLevel() * SOUND_LEVELS[event])
    activeEffects.add(audio)
    audio.addEventListener('ended', () => activeEffects.delete(audio), { once: true })
    audio.addEventListener('error', () => activeEffects.delete(audio), { once: true })
    audio.play().catch(() => {})
}

/** Stop short effects that otherwise continue playing after the game page unmounts. */
function stopEffects() {
    for (const audio of activeEffects) {
        audio.pause()
        audio.currentTime = 0
    }
    activeEffects.clear()
    lastPlayedAt.clear()
}

function startAmbience() {
    ambienceWanted = true
    if (!import.meta.client || !soundEnabled.value) return
    if (!ambience) {
        ambience = new Audio('/pirates/sounds/wave-ambience-loop.mp3')
        ambience.loop = true
    }
    // Keep the sea present but well behind combat. The generated file is loud.
    ambience.volume = Math.min(1, masterLevel() * 0.13)
    ambience.play().catch(() => {})
    scheduleSeagulls()
}

function scheduleSeagulls() {
    if (!import.meta.client || !soundEnabled.value || !ambienceWanted || seagullTimer) return
    const delay = 18_000 + Math.random() * 17_000
    seagullTimer = setTimeout(() => {
        seagullTimer = null
        // A timer can become ready just as the game page is being torn down.
        // Check the requested ambience state again so it cannot restart itself
        // after leaving Pirate Raid.
        if (!soundEnabled.value || !ambienceWanted) return
        const gulls = new Audio(pick(['/pirates/sounds/seagull-ambience.mp3', '/pirates/sounds/seagull-ambience-2.mp3']))
        gulls.volume = Math.min(1, masterLevel() * 0.07)
        activeEffects.add(gulls)
        gulls.addEventListener('ended', () => activeEffects.delete(gulls), { once: true })
        gulls.addEventListener('error', () => activeEffects.delete(gulls), { once: true })
        gulls.play().catch(() => {})
        scheduleSeagulls()
    }, delay)
}

function pauseAmbientPlayback() {
    ambience?.pause()
    if (seagullTimer) clearTimeout(seagullTimer)
    seagullTimer = null
}

function pauseAmbience() {
    ambienceWanted = false
    pauseAmbientPlayback()
}

function stopAmbience() {
    ambienceWanted = false
    pauseAmbientPlayback()
    if (ambience) {
        ambience.pause()
        ambience.currentTime = 0
    }
}

function startKrakenLoop() {
    if (!import.meta.client || !soundEnabled.value) return
    stopKrakenLoop()
    krakenLoop = new Audio(pick(['/pirates/sounds/kraken-loop.mp3', '/pirates/sounds/kraken-loop-2.mp3']))
    krakenLoop.loop = true
    krakenLoop.volume = Math.min(1, masterLevel() * 0.13)
    krakenLoop.play().catch(() => {})
}

function stopKrakenLoop() {
    if (!krakenLoop) return
    krakenLoop.pause()
    krakenLoop.currentTime = 0
    krakenLoop = null
}

function pauseKrakenLoop() {
    krakenLoop?.pause()
}

function resumeKrakenLoop() {
    if (krakenLoop && soundEnabled.value) krakenLoop.play().catch(() => {})
}

function updateAmbienceLevel() {
    if (ambience) ambience.volume = Math.min(1, masterLevel() * 0.13)
    if (krakenLoop) krakenLoop.volume = Math.min(1, masterLevel() * 0.13)
    if (!soundEnabled.value) pauseAmbientPlayback()
}

function initialize() {
    if (!import.meta.client || initialized) return
    initialized = true
    const storedEnabled = localStorage.getItem('pirates-sound-enabled')
    const storedVolume = Number(localStorage.getItem('pirates-sound-volume'))
    if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
    if (Number.isFinite(storedVolume)) soundVolume.value = Math.max(0, Math.min(100, storedVolume))
    watch(soundEnabled, (enabled) => {
        localStorage.setItem('pirates-sound-enabled', String(enabled))
        updateAmbienceLevel()
        if (enabled && ambienceWanted) startAmbience()
    })
    watch(soundVolume, (volume) => {
        localStorage.setItem('pirates-sound-volume', String(volume))
        updateAmbienceLevel()
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
        startKrakenLoop,
        stopKrakenLoop,
        pauseKrakenLoop,
        resumeKrakenLoop
    }
}
