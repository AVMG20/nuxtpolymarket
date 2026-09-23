// Candy Madness sound playback. Every effect is synthesized on the fly
// (app/utils/slots/candymadness-synth.ts); nothing is fetched. Same shape as
// pirate-sound.ts: per-event levels, cooldowns and voice caps, persisted
// enable/volume.
//
// Signal chain: voice (level, pan) -> master gain (player volume) ->
// compressor -> speakers, so a long tumble chain squashes instead of clipping.

import {
  CANDY_SOUND_COOLDOWNS,
  CANDY_SOUND_DEFAULT_VOICE_CAP,
  CANDY_SOUND_LEVELS,
  CANDY_SOUND_MAX_VOICES,
  CANDY_SOUND_VOICE_CAPS,
  CANDY_SYNTH_JITTER,
  CANDY_SYNTH_RECIPES,
  CandySynthVoice,
  type CandySoundEvent
} from '~/utils/slots/candymadness-synth'
import { shapezzSynthWarmUp } from '~/utils/shapezz-synth'

const ENABLED_KEY = 'candymadness-sound-enabled'
const VOLUME_KEY = 'candymadness-sound-volume'

const soundEnabled = ref(true)
const soundVolume = ref(70)

interface MasterBus {
  input: GainNode
  compressor: DynamicsCompressorNode
}

interface ActiveVoice {
  event: CandySoundEvent
  voice: CandySynthVoice
}

let ctx: AudioContext | null = null
let bus: MasterBus | null = null
const voices: ActiveVoice[] = []
const lastPlayedAt = new Map<CandySoundEvent, number>()
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
  compressor.ratio.value = 8
  compressor.attack.value = 0.003
  compressor.release.value = 0.2
  input.connect(compressor)
  compressor.connect(context.destination)
  bus = { input, compressor }
  return bus
}

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

/** Call from a user gesture so the first real cue can play. */
function unlock() {
  if (!import.meta.client || !soundEnabled.value) return
  const context = ensureContext()
  if (!context) return
  if (context.state !== 'running') void context.resume().catch(() => {})
  shapezzSynthWarmUp(context)
}

function removeVoice(entry: ActiveVoice) {
  const index = voices.indexOf(entry)
  if (index !== -1) voices.splice(index, 1)
}

function steal(entry: ActiveVoice) {
  removeVoice(entry)
  entry.voice.release()
}

interface PlayOptions {
  /** Recipe hint: chain level, column, tier... */
  intensity?: number
  /** Stereo position -1..1. */
  pan?: number
}

function play(event: CandySoundEvent, options: PlayOptions = {}) {
  const context = runningContext()
  if (!context) return
  const now = performance.now()
  if (now - (lastPlayedAt.get(event) ?? -Infinity) < CANDY_SOUND_COOLDOWNS[event]) return
  lastPlayedAt.set(event, now)

  const cap = CANDY_SOUND_VOICE_CAPS[event] ?? CANDY_SOUND_DEFAULT_VOICE_CAP
  let same = 0
  for (const entry of voices) if (entry.event === event) same++
  if (same >= cap) {
    const oldest = voices.find(entry => entry.event === event)
    if (oldest) steal(oldest)
  }
  while (voices.length >= CANDY_SOUND_MAX_VOICES) steal(voices[0]!)

  const jitter = CANDY_SYNTH_JITTER[event] ?? 0
  const voice = new CandySynthVoice(context, ensureBus(context).input, {
    level: CANDY_SOUND_LEVELS[event],
    pan: Math.max(-0.8, Math.min(0.8, options.pan ?? 0)),
    pitch: 1 + (Math.random() * 2 - 1) * jitter,
    start: context.currentTime + 0.005
  })
  const entry: ActiveVoice = { event, voice }
  voice.onDone = () => removeVoice(entry)
  voices.push(entry)
  try {
    CANDY_SYNTH_RECIPES[event](voice, Math.max(0, options.intensity ?? 0))
  } catch {
    voice.release(0)
  }
  voice.seal()
}

function stopAll() {
  lastPlayedAt.clear()
  for (const entry of voices.splice(0)) entry.voice.release(0.03)
}

function initialize() {
  if (!import.meta.client || initialized) return
  initialized = true
  const storedEnabled = localStorage.getItem(ENABLED_KEY)
  const storedVolume = localStorage.getItem(VOLUME_KEY)
  if (storedEnabled !== null) soundEnabled.value = storedEnabled === 'true'
  // Number(null) is 0, so check for null before trusting the stored volume.
  if (storedVolume !== null && Number.isFinite(Number(storedVolume))) {
    soundVolume.value = Math.max(0, Math.min(100, Number(storedVolume)))
  }
  watch(soundEnabled, (enabled) => {
    localStorage.setItem(ENABLED_KEY, String(enabled))
    if (!enabled) stopAll()
  })
  watch(soundVolume, (volume) => {
    localStorage.setItem(VOLUME_KEY, String(volume))
    if (ctx && bus) bus.input.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.02)
  })
}

export function useCandyMadnessSound() {
  initialize()
  return { soundEnabled, soundVolume, play, unlock, stopAll }
}
