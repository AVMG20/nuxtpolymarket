/**
 * Procedural sound: everything is synthesised with WebAudio at runtime
 * (engine drone, chimes, whooshes, explosions, splash, fanfares, ambience).
 */

type Wave = OscillatorType

class Sfx {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sfxBus!: GainNode
  private musicBus!: GainNode
  private noiseBuf!: AudioBuffer
  private engine: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode; lfo: OscillatorNode } | null = null
  private ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null
  private musicTimer: number | null = null
  sfxOn = true
  musicOn = true

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
      const comp = this.ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 4
      comp.connect(this.ctx.destination)
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.8
      this.master.connect(comp)
      this.sfxBus = this.ctx.createGain()
      this.sfxBus.connect(this.master)
      this.musicBus = this.ctx.createGain()
      this.musicBus.gain.value = 0.32
      this.musicBus.connect(this.master)
      const len = this.ctx.sampleRate * 2
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      this.startAmbience()
      this.startMusic()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    this.apply()
  }

  setSfx(on: boolean) {
    this.sfxOn = on
    this.apply()
  }

  setMusic(on: boolean) {
    this.musicOn = on
    this.apply()
  }

  private apply() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.sfxBus.gain.setTargetAtTime(this.sfxOn ? 1 : 0, t, 0.05)
    this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.32 : 0, t, 0.1)
  }

  private get ok() {
    return !!this.ctx && this.ctx.state === 'running'
  }

  private tone(freq: number, dur: number, opts: { type?: Wave; vol?: number; at?: number; slide?: number; attack?: number; bus?: GainNode } = {}) {
    if (!this.ok) return
    const c = this.ctx!
    const t = c.currentTime + (opts.at ?? 0)
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = opts.type ?? 'sine'
    o.frequency.setValueAtTime(freq, t)
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t + dur)
    const v = opts.vol ?? 0.3
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(v, t + (opts.attack ?? 0.005))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(opts.bus ?? this.sfxBus)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  private noise(dur: number, opts: { type?: BiquadFilterType; freq?: number; freqEnd?: number; q?: number; vol?: number; at?: number; attack?: number } = {}) {
    if (!this.ok) return
    const c = this.ctx!
    const t = c.currentTime + (opts.at ?? 0)
    const src = c.createBufferSource()
    src.buffer = this.noiseBuf
    const f = c.createBiquadFilter()
    f.type = opts.type ?? 'lowpass'
    f.frequency.setValueAtTime(opts.freq ?? 1000, t)
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + dur)
    f.Q.value = opts.q ?? 1
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.4, t + (opts.attack ?? 0.01))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.sfxBus)
    src.start(t, Math.random() * 1.5)
    src.stop(t + dur + 0.05)
  }

  // ---------------------------------------------------------------- loops

  engineStart() {
    if (!this.ctx || this.engine) return
    const c = this.ctx
    const gain = c.createGain()
    gain.gain.value = 0.0001
    const filter = c.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 600
    filter.Q.value = 3
    const o1 = c.createOscillator()
    o1.type = 'sawtooth'
    o1.frequency.value = 58
    const o2 = c.createOscillator()
    o2.type = 'square'
    o2.frequency.value = 87
    // propeller chop: amplitude LFO
    const lfo = c.createOscillator()
    lfo.frequency.value = 22
    const lfoGain = c.createGain()
    lfoGain.gain.value = 0.35
    const chop = c.createGain()
    chop.gain.value = 0.65
    lfo.connect(lfoGain).connect(chop.gain)
    o1.connect(filter)
    o2.connect(filter)
    filter.connect(chop).connect(gain).connect(this.sfxBus)
    o1.start()
    o2.start()
    lfo.start()
    gain.gain.setTargetAtTime(0.09, c.currentTime, 0.3)
    this.engine = { osc: [o1, o2], gain, filter, lfo }
  }

  engineThrottle(k: number) {
    if (!this.engine || !this.ctx) return
    const t = this.ctx.currentTime
    const [o1, o2] = this.engine.osc as [OscillatorNode, OscillatorNode]
    o1.frequency.setTargetAtTime(58 + k * 40, t, 0.2)
    o2.frequency.setTargetAtTime(87 + k * 60, t, 0.2)
    this.engine.lfo.frequency.setTargetAtTime(18 + k * 30, t, 0.2)
    this.engine.filter.frequency.setTargetAtTime(500 + k * 900, t, 0.2)
  }

  engineStop() {
    if (!this.engine || !this.ctx) return
    const e = this.engine
    this.engine = null
    const t = this.ctx.currentTime
    e.gain.gain.setTargetAtTime(0.0001, t, 0.25)
    for (const o of [...e.osc, e.lfo]) o.stop(t + 1.2)
  }

  private startAmbience() {
    const c = this.ctx!
    const src = c.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 420
    const g = c.createGain()
    g.gain.value = 0.05
    // slow swell
    const lfo = c.createOscillator()
    lfo.frequency.value = 0.12
    const lg = c.createGain()
    lg.gain.value = 0.025
    lfo.connect(lg).connect(g.gain)
    lfo.start()
    src.connect(f).connect(g).connect(this.sfxBus)
    src.start()
    this.ambience = { src, gain: g }
  }

  /** Light tropical loop: marimba arpeggios over a soft bass. */
  private startMusic() {
    const c = this.ctx!
    const bpm = 112
    const beat = 60 / bpm
    const prog = [
      [60, 64, 67, 71], // Cmaj7
      [57, 60, 64, 67], // Am7
      [62, 65, 69, 72], // Dm7
      [55, 59, 62, 65], // G7
    ]
    const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)
    let bar = 0
    let next = c.currentTime + 0.1
    const schedule = () => {
      while (next < c.currentTime + 0.6) {
        const chord = prog[bar % prog.length]!
        const at = next - c.currentTime
        // bass
        this.tone(midi(chord[0]! - 24), beat * 1.8, { type: 'triangle', vol: 0.28, at, bus: this.musicBus })
        this.tone(midi(chord[0]! - 24 + 7), beat * 1.5, { type: 'triangle', vol: 0.2, at: at + beat * 2, bus: this.musicBus })
        // marimba arpeggio
        const pattern = [0, 1, 2, 3, 2, 1, 2, 3]
        pattern.forEach((p, i) => {
          const n = chord[p]! + (i >= 4 ? 12 : 0)
          this.tone(midi(n), beat * 0.45, { type: 'sine', vol: 0.12, at: at + i * beat * 0.5, bus: this.musicBus })
          this.tone(midi(n) * 4, beat * 0.08, { type: 'sine', vol: 0.02, at: at + i * beat * 0.5, bus: this.musicBus })
        })
        // shaker
        for (let i = 0; i < 8; i++) this.musicNoise(at + i * beat * 0.5, i % 2 ? 0.02 : 0.035)
        next += beat * 4
        bar++
      }
    }
    this.musicTimer = window.setInterval(schedule, 150)
    schedule()
  }

  private musicNoise(at: number, vol: number) {
    if (!this.ok) return
    const c = this.ctx!
    const t = c.currentTime + at
    const src = c.createBufferSource()
    src.buffer = this.noiseBuf
    const f = c.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 7000
    const g = c.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    src.connect(f).connect(g).connect(this.musicBus)
    src.start(t, Math.random())
    src.stop(t + 0.1)
  }

  // ---------------------------------------------------------------- one-shots

  click() {
    this.tone(1200, 0.05, { type: 'triangle', vol: 0.15 })
  }

  takeoff() {
    this.noise(1.6, { type: 'bandpass', freq: 300, freqEnd: 1400, q: 0.8, vol: 0.18, attack: 0.4 })
  }

  collect(value: number, isMul: boolean) {
    const base = isMul ? 660 : 520
    const steps = isMul ? [0, 4, 7, 12, 16] : [0, 7, 12]
    const lift = Math.min(12, Math.log2(value + 1) * 3)
    steps.forEach((s, i) => {
      const f = base * Math.pow(2, (s + lift) / 12)
      this.tone(f, 0.35, { type: 'triangle', vol: 0.16, at: i * 0.055 })
      this.tone(f * 2, 0.25, { type: 'sine', vol: 0.06, at: i * 0.055 })
    })
    if (isMul) this.noise(0.5, { type: 'highpass', freq: 5000, vol: 0.06 })
  }

  booster() {
    ;[0, 5, 9, 12, 17].forEach((s, i) => this.tone(440 * Math.pow(2, s / 12), 0.3, { type: 'square', vol: 0.06, at: i * 0.04 }))
    this.tone(220, 0.6, { type: 'sine', vol: 0.2, slide: 3 })
  }

  rocketIncoming() {
    this.tone(1800, 0.9, { type: 'sine', vol: 0.07, slide: 0.45, attack: 0.2 })
    this.noise(0.9, { type: 'bandpass', freq: 2500, freqEnd: 800, q: 3, vol: 0.1, attack: 0.3 })
  }

  explosion(big = 1) {
    this.noise(1.2 * big, { type: 'lowpass', freq: 2400, freqEnd: 120, vol: 0.55, attack: 0.005 })
    this.tone(90, 0.8, { type: 'sine', vol: 0.45, slide: 0.35 })
    this.tone(55, 1.0, { type: 'triangle', vol: 0.3, slide: 0.5 })
  }

  halve() {
    this.tone(520, 0.3, { type: 'sawtooth', vol: 0.08, slide: 0.5 })
    this.tone(390, 0.4, { type: 'sawtooth', vol: 0.08, slide: 0.5, at: 0.12 })
  }

  shield() {
    this.tone(1400, 0.5, { type: 'sine', vol: 0.18, slide: 0.7 })
    this.tone(2100, 0.4, { type: 'triangle', vol: 0.08, slide: 0.8 })
    this.noise(0.3, { type: 'highpass', freq: 3000, vol: 0.12 })
  }

  laser() {
    this.tone(2400, 0.25, { type: 'square', vol: 0.09, slide: 0.15 })
    this.tone(1800, 0.25, { type: 'sawtooth', vol: 0.05, slide: 0.2, at: 0.03 })
  }

  magnet() {
    for (let i = 0; i < 4; i++) this.tone(300 + i * 80, 0.25, { type: 'sine', vol: 0.08, at: i * 0.06, slide: 1.3 })
  }

  splash() {
    this.noise(1.4, { type: 'lowpass', freq: 3500, freqEnd: 300, vol: 0.5, attack: 0.01 })
    this.noise(0.8, { type: 'bandpass', freq: 800, q: 0.6, vol: 0.3, at: 0.05 })
    this.tone(140, 0.5, { type: 'sine', vol: 0.3, slide: 0.4 })
    // bubbles
    for (let i = 0; i < 8; i++) this.tone(500 + Math.random() * 700, 0.08, { type: 'sine', vol: 0.05, at: 0.4 + i * 0.09, slide: 1.8 })
  }

  lose() {
    ;[0, -3, -7].forEach((s, i) => this.tone(330 * Math.pow(2, s / 12), 0.5, { type: 'triangle', vol: 0.12, at: 0.5 + i * 0.22 }))
  }

  touchdown() {
    this.noise(0.25, { type: 'lowpass', freq: 600, vol: 0.4 })
    this.tone(70, 0.3, { type: 'sine', vol: 0.35, slide: 0.6 })
    this.noise(0.9, { type: 'bandpass', freq: 1800, q: 2, vol: 0.06, at: 0.1 })
  }

  fanfare(tier: number) {
    const notes = tier >= 3 ? [0, 4, 7, 12, 16, 19, 24] : tier >= 1 ? [0, 4, 7, 12, 16] : [0, 4, 7, 12]
    notes.forEach((s, i) => {
      const f = 523.25 * Math.pow(2, s / 12)
      this.tone(f, 0.5, { type: 'triangle', vol: 0.16, at: i * 0.09 })
      this.tone(f / 2, 0.5, { type: 'square', vol: 0.04, at: i * 0.09 })
    })
    const end = notes.length * 0.09
    ;[0, 4, 7, 12].forEach((s) => this.tone(523.25 * Math.pow(2, s / 12), 1.4, { type: 'triangle', vol: 0.09, at: end }))
    this.noise(1.5, { type: 'highpass', freq: 6000, vol: 0.07, at: end })
  }

  coin() {
    const f = 1800 + Math.random() * 900
    this.tone(f, 0.12, { type: 'square', vol: 0.03 })
    this.tone(f * 1.5, 0.18, { type: 'sine', vol: 0.04, at: 0.05 })
  }

  countTick() {
    this.tone(1500 + Math.random() * 200, 0.04, { type: 'triangle', vol: 0.05 })
  }

  firework() {
    this.tone(700, 0.5, { type: 'sine', vol: 0.05, slide: 2.4, attack: 0.1 })
    this.noise(0.8, { type: 'lowpass', freq: 3000, freqEnd: 200, vol: 0.25, at: 0.5 })
    for (let i = 0; i < 6; i++) this.noise(0.05, { type: 'highpass', freq: 5000, vol: 0.08, at: 0.7 + i * 0.07 + Math.random() * 0.05 })
  }

  /** Silences everything and closes the context; the next unlock() starts a fresh one. */
  dispose() {
    if (this.musicTimer) clearInterval(this.musicTimer)
    this.musicTimer = null
    this.engine = null
    this.ambience = null
    const ctx = this.ctx
    this.ctx = null
    if (ctx) void ctx.close().catch(() => {})
  }
}

export const sfx = new Sfx()
