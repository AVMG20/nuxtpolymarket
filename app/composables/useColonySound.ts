// Colony sound effects — synthesised live with the Web Audio API.
//
// Zero assets: each cue is a handful of oscillators and filtered noise shaped
// by gain envelopes, pitch-jittered so repeats never sound like a stuck sample.
// The mute flag persists per browser. Same approach as useXenoSound, but with
// an earthy, chirpy palette to match the terrarium instead of the garden.

export type ColonySound
  = | 'click'
    | 'hover'
    | 'place'
    | 'unplace'
    | 'release'
    | 'feed'
    | 'gem-feed'
    | 'snack'
    | 'chirp'
    | 'tick'
    | 'collect'
    | 'collect-big'
    | 'coins'
    | 'buy'
    | 'sell'
    | 'build-start'
    | 'build-done'
    | 'level-up'
    | 'research'
    | 'unlock'
    | 'error'
    | 'starving'
    | 'found'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
const lastPlayed = new Map<ColonySound, number>()

const COOLDOWN_MS: Partial<Record<ColonySound, number>> = {
  hover: 40,
  click: 40,
  tick: 120,
  chirp: 250,
  coins: 60,
  place: 60,
  snack: 80
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
  master.gain.value = 0.45
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

function jitter(cents = 30): number {
  return (Math.random() * 2 - 1) * cents
}

// A warm major pentatonic — everything "good" in the colony resolves into it.
const PENTA = [392, 440, 493.88, 587.33, 659.25, 783.99, 880, 987.77, 1174.66]

const CUES: Record<ColonySound, () => void> = {
  'click': () => {
    tone({ freq: 700, freqEnd: 1000, duration: 0.06, gain: 0.1, type: 'triangle', detune: jitter() })
  },
  'hover': () => {
    tone({ freq: 1200, freqEnd: 1500, duration: 0.035, gain: 0.04, type: 'sine', detune: jitter(50) })
  },
  'place': () => {
    const t = ctx!.currentTime
    const d = jitter(60)
    // soft thud into soil + a tiny happy chirp
    tone({ at: t, freq: 220, freqEnd: 90, duration: 0.14, gain: 0.22, type: 'sine', detune: d })
    burst({ at: t, duration: 0.1, gain: 0.1, freq: 500, freqEnd: 150, q: 0.8 })
    tone({ at: t + 0.1, freq: 1400, freqEnd: 2200, duration: 0.07, gain: 0.06, type: 'triangle', detune: d })
    tone({ at: t + 0.17, freq: 1900, freqEnd: 2600, duration: 0.06, gain: 0.05, type: 'triangle', detune: d })
  },
  'unplace': () => {
    const t = ctx!.currentTime
    tone({ at: t, freq: 900, freqEnd: 400, duration: 0.14, gain: 0.1, type: 'triangle' })
    burst({ at: t, duration: 0.08, gain: 0.06, freq: 2500, freqEnd: 800 })
  },
  'release': () => {
    const t = ctx!.currentTime
    tone({ at: t, freq: 600, freqEnd: 200, duration: 0.22, gain: 0.12, type: 'triangle' })
    burst({ at: t + 0.05, duration: 0.25, gain: 0.08, freq: 3000, freqEnd: 6000, q: 0.5 })
    // a few coins tinkle back — refund
    for (let i = 0; i < 3; i++) {
      tone({ at: t + 0.15 + i * 0.05, freq: 2400 + Math.random() * 900, duration: 0.09, gain: 0.05, type: 'square' })
    }
  },
  'feed': () => {
    const t = ctx!.currentTime
    // pour + a handful of munches
    burst({ at: t, duration: 0.35, gain: 0.12, freq: 900, freqEnd: 2600, q: 0.6 })
    for (let i = 0; i < 5; i++) {
      const at = t + 0.12 + i * 0.07 + Math.random() * 0.03
      burst({ at, duration: 0.04, gain: 0.14, freq: 1500 + Math.random() * 1500, q: 2.5 })
      tone({ at, freq: 300 + Math.random() * 200, freqEnd: 150, duration: 0.05, gain: 0.05, type: 'square' })
    }
    ;[PENTA[3]!, PENTA[5]!, PENTA[7]!].forEach((f, i) => {
      tone({ at: t + 0.4 + i * 0.07, freq: f, duration: 0.25, gain: 0.08, type: 'triangle' })
    })
  },
  'gem-feed': () => {
    const t = ctx!.currentTime
    burst({ at: t, duration: 0.4, gain: 0.1, freq: 2000, freqEnd: 8000, q: 0.5 })
    ;[783.99, 987.77, 1174.66, 1567.98, 1975.53].forEach((f, i) => {
      tone({ at: t + i * 0.06, freq: f, duration: 0.5, gain: 0.1, type: 'sine' })
      tone({ at: t + i * 0.06, freq: f * 2, duration: 0.3, gain: 0.03, type: 'sine', detune: 6 })
    })
    tone({ at: t + 0.4, freq: 2637, duration: 0.9, gain: 0.05, type: 'sine' })
  },
  'snack': () => {
    const t = ctx!.currentTime
    tone({ at: t, freq: 500, freqEnd: 180, duration: 0.09, gain: 0.14, type: 'sine', detune: jitter(80) })
    burst({ at: t, duration: 0.05, gain: 0.08, freq: 1200, freqEnd: 400 })
  },
  'chirp': () => {
    const t = ctx!.currentTime
    const base = 2400 + Math.random() * 1200
    const n = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < n; i++) {
      tone({ at: t + i * 0.06, freq: base, freqEnd: base * 1.25, duration: 0.045, gain: 0.03, type: 'sine' })
    }
  },
  'tick': () => {
    const t = ctx!.currentTime
    tone({ at: t, freq: PENTA[Math.floor(Math.random() * 4) + 3]!, duration: 0.12, gain: 0.05, type: 'triangle', detune: jitter(20) })
    burst({ at: t, duration: 0.03, gain: 0.06, freq: 4000, q: 3 })
  },
  'collect': () => {
    const t = ctx!.currentTime
    const start = Math.floor(Math.random() * 3)
    for (let i = 0; i < 4; i++) {
      tone({ at: t + i * 0.06, freq: PENTA[start + i * 2]!, duration: 0.25, gain: 0.11, type: 'triangle' })
    }
    burst({ at: t, duration: 0.25, gain: 0.05, freq: 4000, freqEnd: 9000, q: 0.5 })
    for (let i = 0; i < 4; i++) {
      tone({ at: t + 0.1 + i * 0.045, freq: 2600 + Math.random() * 1000, duration: 0.09, gain: 0.05, type: 'square' })
    }
  },
  'collect-big': () => {
    const t = ctx!.currentTime
    PENTA.forEach((f, i) => {
      tone({ at: t + i * 0.05, freq: f, duration: 0.35, gain: 0.11, type: 'triangle' })
    })
    tone({ at: t + 0.5, freq: 1568, duration: 0.8, gain: 0.09, type: 'sine' })
    tone({ at: t + 0.5, freq: 1975.53, duration: 0.8, gain: 0.06, type: 'sine' })
    tone({ at: t + 0.5, freq: 2349, duration: 0.8, gain: 0.04, type: 'sine' })
    burst({ at: t + 0.45, duration: 0.6, gain: 0.08, freq: 5000, freqEnd: 10000, q: 0.5 })
    for (let i = 0; i < 8; i++) {
      tone({ at: t + 0.55 + i * 0.05, freq: 2200 + Math.random() * 1500, duration: 0.1, gain: 0.05, type: 'square' })
    }
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
    // cash register + a bug chirp popping out of the box
    burst({ at: t, duration: 0.06, gain: 0.2, freq: 3200, q: 2 })
    tone({ at: t + 0.02, freq: 1046.5, duration: 0.18, gain: 0.1, type: 'triangle' })
    tone({ at: t + 0.1, freq: 1318.5, duration: 0.25, gain: 0.1, type: 'triangle' })
    for (let i = 0; i < 4; i++) {
      tone({ at: t + 0.12 + i * 0.05, freq: 2600 + Math.random() * 800, duration: 0.1, gain: 0.05, type: 'square' })
    }
    tone({ at: t + 0.35, freq: 2600, freqEnd: 3400, duration: 0.06, gain: 0.05, type: 'sine' })
    tone({ at: t + 0.42, freq: 2900, freqEnd: 3600, duration: 0.06, gain: 0.05, type: 'sine' })
  },
  'sell': () => {
    const t = ctx!.currentTime
    burst({ at: t, duration: 0.08, gain: 0.14, freq: 2500, q: 1.5 })
    tone({ at: t + 0.02, freq: 660, freqEnd: 990, duration: 0.14, gain: 0.08, type: 'triangle' })
    for (let i = 0; i < 5; i++) {
      tone({ at: t + 0.08 + i * 0.045, freq: 2400 + Math.random() * 1200, duration: 0.1, gain: 0.06, type: 'square' })
    }
  },
  'build-start': () => {
    const t = ctx!.currentTime
    // three hammer knocks, rising
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.16
      burst({ at, duration: 0.12, gain: 0.3, freq: 160 + i * 40, freqEnd: 60, type: 'lowpass', q: 1 })
      burst({ at, duration: 0.05, gain: 0.14, freq: 2600 + i * 400, q: 1.5 })
    }
    tone({ at: t + 0.5, freq: 880, duration: 0.3, gain: 0.08, type: 'triangle' })
    tone({ at: t + 0.58, freq: 1174.66, duration: 0.4, gain: 0.07, type: 'triangle' })
  },
  'build-done': () => {
    const t = ctx!.currentTime
    burst({ at: t, duration: 0.14, gain: 0.3, freq: 180, freqEnd: 60, type: 'lowpass', q: 1 })
    burst({ at: t, duration: 0.05, gain: 0.15, freq: 3000, q: 1.5 })
    ;[659.25, 830.61, 987.77, 1318.51].forEach((f, i) => {
      tone({ at: t + 0.15 + i * 0.08, freq: f, duration: 0.5, gain: 0.12, type: 'triangle' })
    })
    burst({ at: t + 0.3, duration: 0.5, gain: 0.06, freq: 5000, freqEnd: 9000, q: 0.5 })
  },
  'level-up': () => {
    const t = ctx!.currentTime
    tone({ at: t, freq: 150, freqEnd: 900, duration: 0.45, gain: 0.14, type: 'sawtooth' })
    burst({ at: t, duration: 0.4, gain: 0.1, freq: 300, freqEnd: 4000, q: 0.7 })
    const chord = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093]
    chord.forEach((f, i) => {
      tone({ at: t + 0.3 + i * 0.07, freq: f, duration: 1.1, gain: 0.11, type: 'triangle' })
      tone({ at: t + 0.3 + i * 0.07, freq: f * 2, duration: 0.7, gain: 0.03, type: 'sine', detune: 5 })
    })
    burst({ at: t + 0.7, duration: 0.9, gain: 0.07, freq: 6000, freqEnd: 10000, q: 0.5 })
  },
  'research': () => {
    const t = ctx!.currentTime
    // bubbling flask + a rising synth "discovery"
    for (let i = 0; i < 8; i++) {
      const at = t + i * 0.06 + Math.random() * 0.03
      tone({ at, freq: 500 + Math.random() * 900, freqEnd: 900 + Math.random() * 900, duration: 0.07, gain: 0.04, type: 'sine' })
    }
    burst({ at: t, duration: 0.5, gain: 0.05, freq: 600, freqEnd: 2200, q: 0.5 })
    tone({ at: t + 0.4, freq: 440, freqEnd: 1760, duration: 0.4, gain: 0.08, type: 'triangle' })
    ;[1174.66, 1567.98, 1975.53].forEach((f, i) => {
      tone({ at: t + 0.7 + i * 0.09, freq: f, duration: 0.6, gain: 0.09, type: 'sine' })
    })
  },
  'unlock': () => {
    const t = ctx!.currentTime
    burst({ at: t, duration: 0.08, gain: 0.16, freq: 1800, q: 2 })
    tone({ at: t + 0.05, freq: 392, freqEnd: 784, duration: 0.3, gain: 0.1, type: 'triangle' })
    ;[987.77, 1318.51, 1567.98].forEach((f, i) => {
      tone({ at: t + 0.25 + i * 0.08, freq: f, duration: 0.5, gain: 0.1, type: 'triangle' })
    })
  },
  'error': () => {
    const t = ctx!.currentTime
    tone({ at: t, freq: 220, duration: 0.14, gain: 0.12, type: 'square' })
    tone({ at: t + 0.15, freq: 160, duration: 0.22, gain: 0.12, type: 'square' })
  },
  'starving': () => {
    const t = ctx!.currentTime
    // a sad, sagging two-note groan
    tone({ at: t, freq: 330, freqEnd: 220, duration: 0.4, gain: 0.1, type: 'triangle' })
    tone({ at: t + 0.35, freq: 260, freqEnd: 150, duration: 0.55, gain: 0.1, type: 'triangle' })
  },
  'found': () => {
    const t = ctx!.currentTime
    burst({ at: t, duration: 0.5, gain: 0.12, freq: 200, freqEnd: 2500, q: 0.6 })
    tone({ at: t, freq: 110, freqEnd: 220, duration: 0.8, gain: 0.12, type: 'sine', attack: 0.1 })
    PENTA.forEach((f, i) => {
      tone({ at: t + 0.3 + i * 0.07, freq: f, duration: 0.6, gain: 0.1, type: 'triangle' })
    })
    tone({ at: t + 1.0, freq: 1568, duration: 1.2, gain: 0.08, type: 'sine' })
  }
}

export function useColonySound() {
  const muted = useState<boolean>('colony-sound-muted', () => false)
  if (import.meta.client) {
    onNuxtReady(() => {
      try {
        const saved = localStorage.getItem('colony-sound-muted')
        if (saved !== null) muted.value = saved === 'true'
      } catch { /* storage unavailable */ }
    })
  }

  function setMuted(v: boolean) {
    muted.value = v
    if (import.meta.client) {
      try { localStorage.setItem('colony-sound-muted', String(v)) } catch { /* ignore */ }
    }
  }

  function toggle() {
    setMuted(!muted.value)
    if (!muted.value) play('click')
  }

  /** Warm up the context from a user gesture so the first real cue isn't swallowed. */
  function unlock() {
    ensure()
  }

  function play(name: ColonySound) {
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
