// FIREWALL sound playback using Web Audio API.
//
// Each event owns a folder public/firewall/sound/<event>/ with numbered
// variant takes (1.wav .. FIREWALL_SOUND_VARIANTS.wav); play() picks randomly
// among the variants that actually loaded, so deleting audited-out files just
// narrows the pool.

import {
  FIREWALL_SOUND_COOLDOWNS,
  FIREWALL_SOUND_LEVELS,
  FIREWALL_SOUND_MANIFEST,
  FIREWALL_SOUND_VARIANTS,
  type FirewallSoundEvent
} from '~/utils/firewall-sounds'

const soundEnabled = ref(true)
const soundVolume = ref(50)

let ctx: AudioContext | null = null
const loading = new Map<string, Promise<AudioBuffer | null>>()
/** Resolved decode results — null marks a variant that 404'd or failed. */
const decoded = new Map<string, AudioBuffer | null>()
const lastPlayedAt = new Map<FirewallSoundEvent, number>()
const activeSources = new Set<AudioBufferSourceNode>()
let initialized = false

function ensureContext(): AudioContext | null {
  if (!import.meta.client) return null
  if (!ctx) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    ctx = new Ctx()
  }
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
  return ctx
}

function loadVariant(event: FirewallSoundEvent, variant: number): Promise<AudioBuffer | null> {
  const key = `${event}/${variant}`
  let cached = loading.get(key)
  if (cached) return cached
  cached = (async () => {
    const context = ensureContext()
    if (!context) return null
    try {
      const res = await fetch(`/firewall/sound/${key}.wav`)
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

function play(event: FirewallSoundEvent) {
  if (!import.meta.client || !soundEnabled.value) return
  const now = performance.now()
  if (now - (lastPlayedAt.get(event) ?? -Infinity) < FIREWALL_SOUND_COOLDOWNS[event]) return
  lastPlayedAt.set(event, now)

  const available: AudioBuffer[] = []
  for (let variant = 1; variant <= FIREWALL_SOUND_VARIANTS; variant++) {
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
  gain.gain.value = Math.min(1, (soundVolume.value / 100) * FIREWALL_SOUND_LEVELS[event])
  source.connect(gain)
  gain.connect(context.destination)
  activeSources.add(source)
  source.onended = () => activeSources.delete(source)
  source.start()
}

/** Stop every in-flight effect when the FIREWALL arena is unmounted. */
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
  for (const event of Object.keys(FIREWALL_SOUND_MANIFEST) as FirewallSoundEvent[]) {
    for (let variant = 1; variant <= FIREWALL_SOUND_VARIANTS; variant++) {
      void loadVariant(event, variant)
    }
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
  const storedEnabled = localStorage.getItem('firewall-sound-enabled')
  const rawVolume = localStorage.getItem('firewall-sound-volume')
  if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
  if (rawVolume !== null) {
    const storedVolume = Number(rawVolume)
    if (Number.isFinite(storedVolume)) soundVolume.value = Math.max(0, Math.min(100, storedVolume))
  } else {
    soundVolume.value = 50
  }
  watch(soundEnabled, enabled => localStorage.setItem('firewall-sound-enabled', String(enabled)))
  watch(soundVolume, volume => localStorage.setItem('firewall-sound-volume', String(volume)))
}

export function useFirewallSound() {
  initialize()
  return { soundEnabled, soundVolume, play, stop, unlock, preload }
}
