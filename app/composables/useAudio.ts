// Shared voice/SFX/music playback for game namespaces, factored out of the
// raw Web Audio pattern duplicated across app/pages/games/*.vue (slot pages).
// HackOps is the first non-slot consumer and adds playVoice() — a clip synced
// to a teletyped caption, with captions playing even when the clip is muted,
// missing (404, until real VO is recorded), or blocked by autoplay policy.

type AudioChannel = 'voice' | 'sfx' | 'music'

interface ChannelState {
  muted: Ref<boolean>
  volume: Ref<number>
}

export interface VoiceHandle {
  cancel: () => void
}

interface PlayVoiceOptions {
  /** Bound to the teletyped caption text as it reveals. */
  captionsRef?: Ref<string>
  text?: string
  /** Beat before playback starts, so the caption "pops" a moment after the surface appears. */
  delayMs?: number
  onEnd?: () => void
  /** Caption still runs in full (PLAN.md §5.5) — only the clip itself is skipped.
   *  Pass `!barkThrottle(...)` for reveal barks on a throttled roll. */
  skipAudio?: boolean
}

interface PlayMusicOptions {
  loop?: boolean
  fadeMs?: number
}

interface BarkThrottleOptions {
  /** Elite/Phantom-equivalent reveals always play in full — never throttled. */
  rare?: boolean
  /** Quick Open has already opted out of the full animation; always skip the bark too. */
  quickOpen?: boolean
}

const TELETYPE_MS_PER_CHAR = 32
// Common-rarity reveal barks play first-of-session, then every Nth roll after —
// bulk-opening sessions (~30 rolls) make a bark on every single one fatiguing fast.
const BARK_INTERVAL = 4

interface AudioEngine {
  ctx: AudioContext | null
  gains: Partial<Record<AudioChannel, GainNode>>
  buffers: Map<string, Promise<AudioBuffer | null>>
  musicNode: AudioBufferSourceNode | null
  musicGain: GainNode | null
  musicName: string | null
}

// Imperative, non-reactive runtime state (AudioContext, buffer cache) — client-only,
// never serialized. Keyed per namespace so multiple games can each get their own
// engine while sharing this composable.
const engines = new Map<string, AudioEngine>()

function getEngine(namespace: string): AudioEngine {
  let engine = engines.get(namespace)
  if (!engine) {
    engine = { ctx: null, gains: {}, buffers: new Map(), musicNode: null, musicGain: null, musicName: null }
    engines.set(namespace, engine)
  }
  return engine
}

export function useAudio(namespace: string) {
  const engine = getEngine(namespace)
  const soundBase = `/${namespace}/sound`

  // Persisted settings live in useState so every component sharing this namespace
  // sees the same reactive values, SSR-safe (server and client agree on the
  // default before hydration; the real localStorage value is applied afterward
  // via onNuxtReady so there's no hydration mismatch).
  function persistedRef<T extends boolean | number>(key: string, initial: T): Ref<T> {
    const stateKey = `${namespace}-audio-${key}`
    const r = useState<T>(stateKey, () => initial)
    if (import.meta.client) {
      onNuxtReady(() => {
        const saved = localStorage.getItem(stateKey)
        if (saved === null) return
        r.value = (typeof initial === 'boolean' ? saved === 'true' : parseFloat(saved)) as T
      })
      watch(r, v => localStorage.setItem(stateKey, String(v)))
    }
    return r
  }

  // Explicit type args — otherwise TS infers a literal type (e.g. `false`) from
  // the initial value instead of widening to `boolean`/`number`.
  const masterMuted = persistedRef<boolean>('muted', false)

  const channels = reactive<Record<AudioChannel, ChannelState>>({
    voice: {
      muted: persistedRef<boolean>('voice-muted', false),
      volume: persistedRef<number>('voice-volume', 1)
    },
    sfx: {
      muted: persistedRef<boolean>('sfx-muted', false),
      volume: persistedRef<number>('sfx-volume', 0.8)
    },
    // Music defaults OFF — an ambient loop is the one channel players mute fast.
    music: {
      muted: persistedRef<boolean>('music-muted', true),
      volume: persistedRef<number>('music-volume', 0.5)
    }
  })

  function ensureContext(): AudioContext | null {
    if (!import.meta.client) return null
    if (!engine.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return null
      engine.ctx = new Ctx()
      for (const ch of ['voice', 'sfx', 'music'] as AudioChannel[]) {
        const gain = engine.ctx.createGain()
        gain.connect(engine.ctx.destination)
        engine.gains[ch] = gain
      }
      syncGains()
    }
    return engine.ctx
  }

  function syncGains() {
    for (const ch of ['voice', 'sfx', 'music'] as AudioChannel[]) {
      const gain = engine.gains[ch]
      if (!gain) continue
      const state = channels[ch]
      gain.gain.value = (masterMuted.value || state.muted) ? 0 : state.volume
    }
  }

  if (import.meta.client) {
    watch(
      () => [masterMuted.value, channels.voice.muted, channels.voice.volume, channels.sfx.muted, channels.sfx.volume, channels.music.muted, channels.music.volume],
      syncGains
    )
  }

  /** Resume a suspended AudioContext — call on the first user gesture (browsers block autoplay until then). */
  function unlock() {
    const ctx = ensureContext()
    if (ctx && ctx.state === 'suspended') ctx.resume()
  }

  function loadBuffer(channel: AudioChannel, name: string): Promise<AudioBuffer | null> {
    const key = `${channel}/${name}`
    let cached = engine.buffers.get(key)
    if (cached) return cached
    cached = (async () => {
      const ctx = ensureContext()
      if (!ctx) return null
      try {
        const res = await fetch(`${soundBase}/${key}.mp3`)
        if (!res.ok) return null
        const arrayBuffer = await res.arrayBuffer()
        return await ctx.decodeAudioData(arrayBuffer)
      } catch {
        // Missing/undecodable clip — captions-only playback covers for it.
        return null
      }
    })()
    engine.buffers.set(key, cached)
    return cached
  }

  async function playBuffer(channel: AudioChannel, name: string): Promise<AudioBufferSourceNode | null> {
    if (masterMuted.value || channels[channel].muted) return null
    const ctx = ensureContext()
    const gain = engine.gains[channel]
    if (!ctx || !gain) return null
    const buffer = await loadBuffer(channel, name)
    if (!buffer) return null
    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.connect(gain)
    node.start()
    return node
  }

  function playSfx(name: string) {
    if (!import.meta.client) return
    void playBuffer('sfx', name)
  }

  async function playMusic(name: string, opts: PlayMusicOptions = {}) {
    if (!import.meta.client) return
    const { loop = true, fadeMs = 400 } = opts
    if (engine.musicName === name && engine.musicNode) return
    stopMusic(fadeMs)
    engine.musicName = name
    const ctx = ensureContext()
    const channelGain = engine.gains.music
    if (!ctx || !channelGain) return
    const buffer = await loadBuffer('music', name)
    if (!buffer || engine.musicName !== name) return // superseded while loading
    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.loop = loop
    const fade = ctx.createGain()
    fade.gain.value = 0
    node.connect(fade)
    fade.connect(channelGain)
    node.start()
    fade.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeMs / 1000)
    engine.musicNode = node
    engine.musicGain = fade
  }

  function stopMusic(fadeMs = 400) {
    engine.musicName = null
    const { musicNode, musicGain, ctx } = engine
    if (!musicNode || !musicGain || !ctx) {
      engine.musicNode = null
      engine.musicGain = null
      return
    }
    musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeMs / 1000)
    setTimeout(() => {
      try {
        musicNode.stop()
      } catch {
        /* already stopped */
      }
    }, fadeMs + 50)
    engine.musicNode = null
    engine.musicGain = null
  }

  function teletype(target: Ref<string>, text: string, onDone?: () => void): () => void {
    let i = 0
    target.value = ''
    const interval = setInterval(() => {
      i++
      target.value = text.slice(0, i)
      if (i >= text.length) {
        clearInterval(interval)
        onDone?.()
      }
    }, TELETYPE_MS_PER_CHAR)
    return () => clearInterval(interval)
  }

  /**
   * Plays a voice clip after a short delay while teletyping its caption in sync.
   * Captions always run to completion — a muted channel, a 404 (no VO recorded
   * yet), or an autoplay block never blocks the caption, only the audio.
   */
  function playVoice(name: string, opts: PlayVoiceOptions = {}): VoiceHandle {
    const { captionsRef, text = '', delayMs = 300, onEnd, skipAudio = false } = opts
    // Content docs author some lines with bracketed ElevenLabs v3 delivery tags
    // (e.g. [grim], [quiet]) for generation — TTS-only, never shown on screen.
    // Tags can sit mid-sentence ("...call. [grim] This one's..."), so collapse
    // the resulting double space rather than just trimming the ends.
    const captionText = text.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
    let cancelled = false
    let stopTeletype: (() => void) | null = null
    // Tracks the actual playing clip so cancel() can stop it mid-playback — a
    // bare clearTimeout only prevents playback that hasn't started yet, which
    // is why navigating away used to leave a briefing/bark clip audibly
    // running to completion in the background.
    let activeNode: AudioBufferSourceNode | null = null

    const timer = setTimeout(() => {
      if (cancelled) return
      if (captionsRef && captionText) stopTeletype = teletype(captionsRef, captionText, onEnd)
      else onEnd?.()
      if (!skipAudio) {
        void playBuffer('voice', name).then((node) => {
          if (cancelled) {
            try {
              node?.stop()
            } catch {
              /* already finished */
            }
            return
          }
          activeNode = node
        })
      }
    }, delayMs)

    return {
      cancel() {
        cancelled = true
        clearTimeout(timer)
        stopTeletype?.()
        if (activeNode) {
          try {
            activeNode.stop()
          } catch {
            /* already finished */
          }
          activeNode = null
        }
      }
    }
  }

  // Session-scoped (not persisted) — the fatigue problem is bulk-session repetition,
  // not lifetime repetition, so this resets on every page load.
  let commonRollCount = 0
  let hasPlayedFirstBark = false

  /** Whether a reveal bark's AUDIO should play this roll — the visual stamp/caption always play regardless. */
  function barkThrottle(opts: BarkThrottleOptions = {}): boolean {
    if (opts.quickOpen) return false
    if (opts.rare) return true
    if (!hasPlayedFirstBark) {
      hasPlayedFirstBark = true
      commonRollCount = 0
      return true
    }
    commonRollCount++
    if (commonRollCount >= BARK_INTERVAL) {
      commonRollCount = 0
      return true
    }
    return false
  }

  return {
    channels,
    masterMuted,
    playVoice,
    playSfx,
    playMusic,
    stopMusic,
    unlock,
    barkThrottle
  }
}
