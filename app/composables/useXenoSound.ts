// Xeno Garden sound effects — synthesised live with the Web Audio API.
//
// Nothing is downloaded: every cue is a few oscillators and a filtered noise
// burst shaped by gain envelopes, so the garden stays a zero-asset page and
// every hit can be detuned a touch so bulk harvests don't sound like a stuck
// sample. The mute flag is persisted per browser.

export type XenoSound
  = | 'select'
    | 'deselect'
    | 'plant'
    | 'harvest'
    | 'harvest-big'
    | 'ready'
    | 'unlock'
    | 'attach'
    | 'remove'
    | 'breed-start'
    | 'collect'
    | 'mutation'
    | 'coins'
    | 'buy'
    | 'craft'
    | 'tick'
    | 'roll-win'
    | 'error'
    | 'open'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
const lastPlayed = new Map<XenoSound, number>()

// Rapid-fire cues (a 36-slot harvest) are rate limited so overlapping copies
// don't pile into a wall of noise.
const COOLDOWN_MS: Partial<Record<XenoSound, number>> = {
  select: 40,
  harvest: 45,
  plant: 45,
  tick: 30,
  coins: 60
}

function ensure(): AudioContext | null {
  if (!import.meta.client) return null
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  master = ctx.createGain()
  master.gain.value = 0.5
  master.connect(ctx.destination)
  const length = ctx.sampleRate
  noise = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return ctx
}

interface ToneOpts {
  at?: number
  freq: number
  freqEnd?: number
  type?: OscillatorType
  duration: number
  gain: number
  attack?: number
  detune?: number
}

function tone(o: ToneOpts) {
  const c = ctx!
  const at = o.at ?? c.currentTime
  const osc = c.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, at)
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), at + o.duration)
  if (o.detune) osc.detune.value = o.detune
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(o.gain, at + (o.attack ?? 0.008))
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.duration)
  osc.connect(g)
  g.connect(master!)
  osc.start(at)
  osc.stop(at + o.duration + 0.05)
}

interface BurstOpts {
  at?: number
  duration: number
  gain: number
  freq: number
  freqEnd?: number
  type?: BiquadFilterType
  q?: number
}

function burst(o: BurstOpts) {
  const c = ctx!
  const at = o.at ?? c.currentTime
  const src = c.createBufferSource()
  src.buffer = noise
  const f = c.createBiquadFilter()
  f.type = o.type ?? 'bandpass'
  f.frequency.setValueAtTime(o.freq, at)
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), at + o.duration)
  f.Q.value = o.q ?? 1
  const g = c.createGain()
  g.gain.setValueAtTime(o.gain, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.duration)
  src.connect(f)
  f.connect(g)
  g.connect(master!)
  src.start(at, Math.random() * 0.5)
  src.stop(at + o.duration + 0.05)
}

/** ±cents of pitch jitter so repeats don't sound identical. */
function jitter(cents = 30): number {
  return (Math.random() * 2 - 1) * cents
}

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51]

const CUES: Record<XenoSound, () => void> = {
  'select': () => {
    tone({ freq: 880, freqEnd: 1320, duration: 0.07, gain: 0.12, type: 'triangle', detune: jitter() })
  },
  'deselect': () => {
    tone({ freq: 900, freqEnd: 500, duration: 0.09, gain: 0.1, type: 'triangle' })
  },
  'plant': () => {
    const d = jitter(60)
    tone({ freq: 260, freqEnd: 110, duration: 0.14, gain: 0.25, type: 'sine', detune: d })
    burst({ duration: 0.12, gain: 0.12, freq: 700, freqEnd: 200, q: 0.8 })
    tone({ at: ctx!.currentTime + 0.08, freq: 660, freqEnd: 990, duration: 0.12, gain: 0.07, type: 'triangle', detune: d })
  },
  'harvest': () => {
    const t = ctx!.currentTime
    const base = PENTA[Math.floor(Math.random() * 3)]!
    tone({ at: t, freq: base, duration: 0.18, gain: 0.16, type: 'triangle' })
    tone({ at: t + 0.06, freq: base * 1.5, duration: 0.2, gain: 0.14, type: 'triangle' })
    tone({ at: t + 0.12, freq: base * 2, duration: 0.3, gain: 0.12, type: 'sine' })
    burst({ at: t, duration: 0.15, gain: 0.06, freq: 4000, freqEnd: 8000, q: 0.6 })
  },
  'harvest-big': () => {
    const t = ctx!.currentTime
    PENTA.forEach((f, i) => {
      tone({ at: t + i * 0.055, freq: f, duration: 0.35, gain: 0.13, type: 'triangle' })
    })
    tone({ at: t + 0.45, freq: 1568, duration: 0.7, gain: 0.1, type: 'sine' })
    tone({ at: t + 0.45, freq: 2093, duration: 0.7, gain: 0.06, type: 'sine' })
    burst({ at: t + 0.4, duration: 0.5, gain: 0.08, freq: 5000, freqEnd: 9000, q: 0.5 })
  },
  'ready': () => {
    const t = ctx!.currentTime
    tone({ at: t, freq: 1318, duration: 0.22, gain: 0.1, type: 'sine' })
    tone({ at: t + 0.12, freq: 1760, duration: 0.4, gain: 0.08, type: 'sine' })
  },
  'unlock': () => {
    const t = ctx!.currentTime
    tone({ at: t, freq: 200, freqEnd: 800, duration: 0.35, gain: 0.14, type: 'sawtooth' })
    burst({ at: t, duration: 0.3, gain: 0.1, freq: 300, freqEnd: 3000, q: 0.7 })
    ;[659.25, 830.61, 987.77, 1318.51].forEach((f, i) => {
      tone({ at: t + 0.25 + i * 0.07, freq: f, duration: 0.45, gain: 0.12, type: 'triangle' })
    })
  },
  'attach': () => {
    const t = ctx!.currentTime
    burst({ at: t, duration: 0.06, gain: 0.18, freq: 2500, q: 2 })
    tone({ at: t + 0.03, freq: 440, freqEnd: 880, duration: 0.25, gain: 0.1, type: 'sine' })
    tone({ at: t + 0.03, freq: 442, freqEnd: 884, duration: 0.25, gain: 0.06, type: 'sine', detune: 8 })
  },
  'remove': () => {
    tone({ freq: 520, freqEnd: 180, duration: 0.18, gain: 0.12, type: 'triangle' })
    burst({ duration: 0.1, gain: 0.08, freq: 1200, freqEnd: 300 })
  },
  'breed-start': () => {
    const t = ctx!.currentTime
    tone({ at: t, freq: 90, freqEnd: 140, duration: 0.9, gain: 0.12, type: 'sine', attack: 0.1 })
    for (let i = 0; i < 7; i++) {
      const at = t + 0.05 + i * 0.09 + Math.random() * 0.04
      tone({ at, freq: 500 + Math.random() * 900, freqEnd: 900 + Math.random() * 900, duration: 0.09, gain: 0.05, type: 'sine' })
    }
    burst({ at: t, duration: 0.6, gain: 0.05, freq: 600, freqEnd: 1800, q: 0.5 })
  },
  'collect': () => {
    const t = ctx!.currentTime
    ;[783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => {
      tone({ at: t + i * 0.07, freq: f, duration: 0.3, gain: 0.12, type: 'triangle' })
    })
    burst({ at: t + 0.1, duration: 0.3, gain: 0.05, freq: 5000, freqEnd: 9000, q: 0.5 })
  },
  'mutation': () => {
    const t = ctx!.currentTime
    burst({ at: t, duration: 0.5, gain: 0.12, freq: 200, freqEnd: 6000, q: 0.4 })
    const chord = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98]
    chord.forEach((f, i) => {
      tone({ at: t + 0.1 + i * 0.09, freq: f, duration: 1.1, gain: 0.11, type: 'triangle' })
      tone({ at: t + 0.1 + i * 0.09, freq: f * 2, duration: 0.8, gain: 0.04, type: 'sine', detune: 6 })
    })
    tone({ at: t + 0.7, freq: 2093, duration: 1.4, gain: 0.08, type: 'sine' })
    burst({ at: t + 0.6, duration: 0.9, gain: 0.07, freq: 6000, freqEnd: 10000, q: 0.5 })
  },
  'coins': () => {
    const t = ctx!.currentTime
    const n = 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.05 + Math.random() * 0.02
      const f = 2200 + Math.random() * 1400
      tone({ at, freq: f, duration: 0.12, gain: 0.07, type: 'square' })
      tone({ at, freq: f * 1.5, duration: 0.08, gain: 0.03, type: 'sine' })
    }
  },
  'buy': () => {
    const t = ctx!.currentTime
    tone({ at: t, freq: 600, freqEnd: 1200, duration: 0.1, gain: 0.1, type: 'triangle' })
    for (let i = 0; i < 3; i++) {
      tone({ at: t + 0.08 + i * 0.05, freq: 2600 + Math.random() * 800, duration: 0.1, gain: 0.05, type: 'square' })
    }
  },
  'craft': () => {
    const t = ctx!.currentTime
    burst({ at: t, duration: 0.14, gain: 0.3, freq: 180, freqEnd: 60, type: 'lowpass', q: 1 })
    burst({ at: t, duration: 0.05, gain: 0.15, freq: 3000, q: 1.5 })
    tone({ at: t + 0.12, freq: 1046.5, duration: 0.5, gain: 0.1, type: 'triangle' })
    tone({ at: t + 0.2, freq: 1568, duration: 0.6, gain: 0.08, type: 'sine' })
  },
  'tick': () => {
    burst({ duration: 0.03, gain: 0.12, freq: 3000 + Math.random() * 1500, q: 3 })
  },
  'roll-win': () => {
    const t = ctx!.currentTime
    ;[523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => {
      tone({ at: t + i * 0.08, freq: f, duration: 0.5, gain: 0.12, type: 'triangle' })
    })
    burst({ at: t + 0.3, duration: 0.5, gain: 0.06, freq: 5000, freqEnd: 9000, q: 0.5 })
  },
  'error': () => {
    const t = ctx!.currentTime
    tone({ at: t, freq: 220, duration: 0.14, gain: 0.12, type: 'square' })
    tone({ at: t + 0.15, freq: 160, duration: 0.22, gain: 0.12, type: 'square' })
  },
  'open': () => {
    tone({ freq: 440, freqEnd: 660, duration: 0.12, gain: 0.08, type: 'sine' })
  }
}

export function useXenoSound() {
  // Shared across every component on the page; SSR-safe default, then the
  // persisted value is applied client-side after hydration.
  const muted = useState<boolean>('xeno-sound-muted', () => false)
  if (import.meta.client) {
    onNuxtReady(() => {
      try {
        const saved = localStorage.getItem('xeno-sound-muted')
        if (saved !== null) muted.value = saved === 'true'
      } catch { /* storage unavailable */ }
    })
  }

  function setMuted(v: boolean) {
    muted.value = v
    if (import.meta.client) {
      try { localStorage.setItem('xeno-sound-muted', String(v)) } catch { /* ignore */ }
    }
  }

  function toggle() {
    setMuted(!muted.value)
    if (!muted.value) play('select')
  }

  /** Warm up the context from a user gesture so the first real cue isn't swallowed. */
  function unlock() {
    ensure()
  }

  function play(name: XenoSound) {
    if (muted.value) return
    const c = ensure()
    if (!c || !master || !noise) return
    const now = performance.now()
    const cd = COOLDOWN_MS[name]
    if (cd && now - (lastPlayed.get(name) ?? -Infinity) < cd) return
    lastPlayed.set(name, now)
    try {
      CUES[name]()
    } catch { /* audio graph hiccup — never let a sound break gameplay */ }
  }

  return { muted, setMuted, toggle, unlock, play }
}
