/**
 * Nitro Rush sound, all synthesised with WebAudio: an engine drone that
 * tracks speed, punchy one-shot cues, and a four-chord synthwave loop whose
 * layers come in as the car speeds up. Nothing here touches outcomes, so
 * Math.random is fine for noise.
 */

const CHORDS = [
    [45, 52, 57, 60, 64], // Am
    [41, 48, 53, 57, 60], // F
    [48, 55, 60, 64, 67], // C
    [43, 50, 55, 59, 62] // G
]
const BPM = 128
const STEP = 60 / BPM / 4

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

export class NitroAudio {
    private ctx: AudioContext | null = null
    private master!: GainNode
    private sfx!: GainNode
    private music!: GainNode
    private musicFilter!: BiquadFilterNode
    private noise!: AudioBuffer
    private engineOsc: OscillatorNode[] = []
    private engineGain!: GainNode
    private engineFilter!: BiquadFilterNode
    private roarGain!: GainNode
    private skidGain!: GainNode
    private skidFilter!: BiquadFilterNode
    private seqTimer: ReturnType<typeof setInterval> | null = null
    private nextStepTime = 0
    private step = 0
    private intensity = 0
    private nitro = false
    musicOn = true
    sfxOn = true

    /** Must run inside a user gesture the first time. */
    unlock() {
        if (!this.ctx) {
            const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
            if (!Ctx) return
            this.ctx = new Ctx()
            this.build()
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume()
    }

    private build() {
        const ctx = this.ctx!
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.value = -14
        comp.ratio.value = 4
        comp.attack.value = 0.003
        comp.release.value = 0.2
        this.master = ctx.createGain()
        this.master.gain.value = 0.8
        this.master.connect(comp).connect(ctx.destination)
        this.sfx = ctx.createGain()
        this.sfx.gain.value = this.sfxOn ? 0.9 : 0
        this.sfx.connect(this.master)
        this.musicFilter = ctx.createBiquadFilter()
        this.musicFilter.type = 'lowpass'
        this.musicFilter.frequency.value = 18000
        this.music = ctx.createGain()
        this.music.gain.value = this.musicOn ? 0.5 : 0
        this.musicFilter.connect(this.music).connect(this.master)

        const len = ctx.sampleRate
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
        const d = this.noise.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1

        // Engine: two detuned saws through a lowpass, plus a noise roar for nitro.
        this.engineFilter = ctx.createBiquadFilter()
        this.engineFilter.type = 'lowpass'
        this.engineFilter.frequency.value = 600
        this.engineFilter.Q.value = 4
        this.engineGain = ctx.createGain()
        this.engineGain.gain.value = 0
        this.engineFilter.connect(this.engineGain).connect(this.sfx)
        for (const detune of [-12, 9]) {
            const o = ctx.createOscillator()
            o.type = 'sawtooth'
            o.frequency.value = 50
            o.detune.value = detune
            o.connect(this.engineFilter)
            o.start()
            this.engineOsc.push(o)
        }
        const roar = ctx.createBufferSource()
        roar.buffer = this.noise
        roar.loop = true
        const roarFilter = ctx.createBiquadFilter()
        roarFilter.type = 'bandpass'
        roarFilter.frequency.value = 900
        roarFilter.Q.value = 0.7
        this.roarGain = ctx.createGain()
        this.roarGain.gain.value = 0
        roar.connect(roarFilter).connect(this.roarGain).connect(this.sfx)
        roar.start()

        // Tyre squeal: a narrow band of noise that sings higher the harder the car slides.
        const squeal = ctx.createBufferSource()
        squeal.buffer = this.noise
        squeal.loop = true
        this.skidFilter = ctx.createBiquadFilter()
        this.skidFilter.type = 'bandpass'
        this.skidFilter.frequency.value = 1300
        this.skidFilter.Q.value = 9
        this.skidGain = ctx.createGain()
        this.skidGain.gain.value = 0
        squeal.connect(this.skidFilter).connect(this.skidGain).connect(this.sfx)
        squeal.start()
    }

    setMusic(on: boolean) {
        this.musicOn = on
        if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05)
    }

    setSfx(on: boolean) {
        this.sfxOn = on
        if (this.ctx) this.sfx.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05)
    }

    /** speed01: 0 idle to 1 top speed. */
    engine(speed01: number, nitro: boolean, on: boolean) {
        if (!this.ctx) return
        const t = this.ctx.currentTime
        const f = 42 + speed01 * 70 + (nitro ? 34 : 0)
        for (const o of this.engineOsc) o.frequency.setTargetAtTime(f, t, 0.08)
        this.engineFilter.frequency.setTargetAtTime(380 + speed01 * 1500 + (nitro ? 1600 : 0), t, 0.1)
        this.engineGain.gain.setTargetAtTime(on ? 0.07 + speed01 * 0.05 : 0, t, 0.15)
        this.roarGain.gain.setTargetAtTime(on && nitro ? 0.22 : 0, t, 0.08)
        this.nitro = nitro
    }

    /** amount: 0 gripping to 1 fully sideways. */
    skid(amount: number) {
        if (!this.ctx) return
        const t = this.ctx.currentTime
        const a = Math.min(1, Math.max(0, amount))
        this.skidGain.gain.setTargetAtTime(a * 0.5, t, 0.05)
        this.skidFilter.frequency.setTargetAtTime(1100 + a * 700, t, 0.08)
    }

    /** Muffle the music (pause, crash) or open it back up. */
    muffle(amount: number) {
        if (!this.ctx) return
        this.musicFilter.frequency.setTargetAtTime(18000 * (1 - amount) + 380 * amount, this.ctx.currentTime, 0.12)
    }

    setIntensity(v: number) {
        this.intensity = v
    }

    startMusic() {
        if (!this.ctx || this.seqTimer) return
        this.nextStepTime = this.ctx.currentTime + 0.06
        this.step = 0
        this.seqTimer = setInterval(() => this.schedule(), 25)
    }

    stopMusic() {
        if (this.seqTimer) clearInterval(this.seqTimer)
        this.seqTimer = null
    }

    private schedule() {
        const ctx = this.ctx
        if (!ctx) return
        while (this.nextStepTime < ctx.currentTime + 0.12) {
            this.playStep(this.step, this.nextStepTime)
            this.nextStepTime += STEP
            this.step = (this.step + 1) % 64
        }
    }

    private playStep(step: number, t: number) {
        const chord = CHORDS[Math.floor(step / 16)]!
        const s = step % 16
        const hot = this.intensity
        if (s % 4 === 0) this.kick(t)
        if (s === 4 || s === 12) this.snare(t, 0.32)
        if (hot > 0.25 && s % 2 === 1) this.hat(t, s % 4 === 3 ? 0.08 : 0.05)
        // Bass: octave pulse on the root, eighth notes.
        if (s % 2 === 0) this.tone(midi(chord[0]! - 12 + (s % 4 === 2 ? 12 : 0)), t, STEP * 1.7, 'sawtooth', 0.16, 900, this.musicFilter)
        if (hot > 0.55 || this.nitro) {
            const arp = [1, 2, 3, 4, 3, 2]
            const note = chord[arp[s % arp.length]!]! + 12
            this.tone(midi(note), t, STEP * 0.9, 'square', 0.045, 3200, this.musicFilter)
        }
        if (s === 0) this.pad(chord, t, STEP * 16)
    }

    private kick(t: number) {
        const ctx = this.ctx!
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.frequency.setValueAtTime(150, t)
        o.frequency.exponentialRampToValueAtTime(42, t + 0.14)
        g.gain.setValueAtTime(0.55, t)
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
        o.connect(g).connect(this.musicFilter)
        o.start(t)
        o.stop(t + 0.32)
    }

    private snare(t: number, vol: number) {
        this.noiseHit(t, 0.18, vol, 1800, 'bandpass', this.musicFilter)
        this.tone(190, t, 0.08, 'triangle', vol * 0.5, 4000, this.musicFilter)
    }

    private hat(t: number, vol: number) {
        this.noiseHit(t, 0.04, vol, 8000, 'highpass', this.musicFilter)
    }

    private pad(chord: number[], t: number, dur: number) {
        for (const n of chord.slice(1, 4)) this.tone(midi(n), t, dur, 'sawtooth', 0.028, 1400, this.musicFilter, 0.4)
    }

    private tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number, cutoff: number, dest: AudioNode, attack = 0.005) {
        const ctx = this.ctx!
        const o = ctx.createOscillator()
        const f = ctx.createBiquadFilter()
        const g = ctx.createGain()
        o.type = type
        o.frequency.setValueAtTime(freq, t)
        f.type = 'lowpass'
        f.frequency.value = cutoff
        g.gain.setValueAtTime(0.0001, t)
        g.gain.linearRampToValueAtTime(vol, t + attack)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        o.connect(f).connect(g).connect(dest)
        o.start(t)
        o.stop(t + dur + 0.02)
    }

    private noiseHit(t: number, dur: number, vol: number, freq: number, type: BiquadFilterType, dest: AudioNode, sweepTo?: number) {
        const ctx = this.ctx!
        const src = ctx.createBufferSource()
        src.buffer = this.noise
        src.playbackRate.value = 0.8 + Math.random() * 0.4
        const f = ctx.createBiquadFilter()
        f.type = type
        f.frequency.setValueAtTime(freq, t)
        if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
        const g = ctx.createGain()
        g.gain.setValueAtTime(vol, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        src.connect(f).connect(g).connect(dest)
        src.start(t, Math.random() * 0.5)
        src.stop(t + dur + 0.02)
    }

    private sweep(from: number, to: number, dur: number, type: OscillatorType, vol: number) {
        const ctx = this.ctx!
        const t = ctx.currentTime
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = type
        o.frequency.setValueAtTime(from, t)
        o.frequency.exponentialRampToValueAtTime(to, t + dur)
        g.gain.setValueAtTime(vol, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        o.connect(g).connect(this.sfx)
        o.start(t)
        o.stop(t + dur + 0.02)
    }

    private ready() {
        return this.ctx !== null && this.ctx.state === 'running'
    }

    scrape() {
        if (!this.ready()) return
        const t = this.ctx!.currentTime
        this.noiseHit(t, 0.4, 0.4, 3000, 'bandpass', this.sfx, 1200)
        this.tone(1800, t, 0.3, 'sawtooth', 0.03, 4000, this.sfx)
    }

    bump() {
        if (!this.ready()) return
        this.noiseHit(this.ctx!.currentTime, 0.18, 0.6, 3500, 'bandpass', this.sfx, 900)
        this.sweep(220, 90, 0.12, 'square', 0.15)
    }

    nitroReady() {
        if (!this.ready()) return
        const t = this.ctx!.currentTime
        this.tone(midi(88), t, 0.12, 'square', 0.06, 7000, this.sfx)
        this.tone(midi(93), t + 0.08, 0.2, 'square', 0.06, 7000, this.sfx)
    }

    nitroStart() {
        if (!this.ready()) return
        this.sweep(80, 1200, 0.6, 'sawtooth', 0.14)
        this.noiseHit(this.ctx!.currentTime, 0.9, 0.7, 300, 'bandpass', this.sfx, 6000)
        this.sweep(60, 30, 0.5, 'sine', 0.6)
    }

    /** A lap banked; a rising flourish on top for a new best. */
    lap(best: boolean) {
        if (!this.ready()) return
        const t = this.ctx!.currentTime
        this.noiseHit(t, 0.6, 0.3, 300, 'bandpass', this.sfx, 6000)
        const notes = best ? [60, 67, 72, 79, 84] : [67, 72]
        for (const [i, n] of notes.entries()) this.tone(midi(n), t + i * 0.08, 0.5, 'sawtooth', 0.05, 3000, this.sfx)
    }

    /** A sector split: higher and brighter when it's up on the best lap. */
    split(ahead: boolean) {
        if (!this.ready()) return
        const t = this.ctx!.currentTime
        this.tone(midi(ahead ? 84 : 72), t, 0.12, 'triangle', 0.08, 8000, this.sfx)
        this.tone(midi(ahead ? 91 : 69), t + 0.07, 0.16, 'triangle', 0.06, 8000, this.sfx)
    }

    countdown(final: boolean) {
        if (!this.ready()) return
        const t = this.ctx!.currentTime
        this.tone(midi(final ? 84 : 72), t, final ? 0.6 : 0.25, 'square', 0.1, 6000, this.sfx)
        if (final) this.tone(midi(91), t, 0.6, 'sawtooth', 0.05, 6000, this.sfx)
    }

    ui() {
        if (!this.ready()) return
        this.tone(midi(84), this.ctx!.currentTime, 0.06, 'square', 0.04, 6000, this.sfx)
    }

    dispose() {
        this.stopMusic()
        void this.ctx?.close()
        this.ctx = null
    }
}
