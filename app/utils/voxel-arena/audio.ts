// Voxel Arena — synthesised sound effects and an adaptive synth loop.
// Everything is generated with the Web Audio API, nothing is downloaded.

export type ArenaSound
    = | 'shoot-pulse'
      | 'shoot-scatter'
      | 'shoot-needler'
      | 'shoot-rail'
      | 'shoot-plasma'
      | 'shoot-arc'
      | 'shoot-shredder'
      | 'shoot-ember'
      | 'dry'
      | 'reload'
      | 'reload-done'
      | 'slash'
      | 'slash-hit'
      | 'hit'
      | 'crit'
      | 'kill'
      | 'kill-big'
      | 'explosion'
      | 'hurt'
      | 'dash'
      | 'jump'
      | 'pickup'
      | 'pickup-weapon'
      | 'nova'
      | 'wave-start'
      | 'wave-clear'
      | 'boss'
      | 'upgrade'
      | 'select'
      | 'spit'
      | 'charge'
      | 'slam'
      | 'death'
      | 'chrono'

export class ArenaAudio {
    private ctx: AudioContext | null = null
    private master: GainNode | null = null
    private sfxBus: GainNode | null = null
    private musicBus: GainNode | null = null
    private noiseBuffer: AudioBuffer | null = null
    private musicTimer: number | null = null
    private musicStep = 0
    private nextNoteTime = 0
    intensity = 0
    muted = false

    ensure(): void {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') void this.ctx.resume()
            return
        }
        const ctx = new AudioContext()
        this.ctx = ctx
        this.master = ctx.createGain()
        this.master.gain.value = this.muted ? 0 : 0.8
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.value = -14
        comp.ratio.value = 6
        this.master.connect(comp)
        comp.connect(ctx.destination)
        this.sfxBus = ctx.createGain()
        this.sfxBus.gain.value = 0.9
        this.sfxBus.connect(this.master)
        this.musicBus = ctx.createGain()
        this.musicBus.gain.value = 0.28
        this.musicBus.connect(this.master)

        const len = ctx.sampleRate * 2
        const buf = ctx.createBuffer(1, len, ctx.sampleRate)
        const data = buf.getChannelData(0)
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
        this.noiseBuffer = buf
    }

    setMuted(muted: boolean): void {
        this.muted = muted
        if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05)
    }

    dispose(): void {
        this.stopMusic()
        if (this.ctx) void this.ctx.close()
        this.ctx = null
    }

    // ── Music ────────────────────────────────────────────────────────────

    startMusic(): void {
        this.ensure()
        if (this.musicTimer !== null || !this.ctx) return
        this.nextNoteTime = this.ctx.currentTime + 0.1
        this.musicStep = 0
        this.musicTimer = window.setInterval(() => this.scheduleMusic(), 90)
    }

    stopMusic(): void {
        if (this.musicTimer !== null) window.clearInterval(this.musicTimer)
        this.musicTimer = null
    }

    private scheduleMusic(): void {
        const ctx = this.ctx
        const bus = this.musicBus
        if (!ctx || !bus) return
        const bpm = 132 + Math.min(30, this.intensity * 3)
        const step = 60 / bpm / 4
        while (this.nextNoteTime < ctx.currentTime + 0.25) {
            const t = this.nextNoteTime
            const s = this.musicStep
            // kick on every beat, snap on 2 and 4
            if (s % 4 === 0) this.kick(t, bus)
            if (s % 8 === 4) this.snap(t, bus, 0.35)
            if (s % 2 === 1 && this.intensity > 3) this.hat(t, bus, 0.08)
            // bass: minor pentatonic riff in E
            const bassSeq = [0, 0, 7, 0, 10, 0, 7, 5]
            if (s % 2 === 0) this.tone(t, 55 * Math.pow(2, bassSeq[(s / 2) % 8]! / 12), 'sawtooth', step * 1.8, 0.22, bus, 220)
            // arps get louder and denser with intensity
            if (this.intensity > 1 && s % 2 === 0) {
                const arp = [0, 3, 7, 10, 12, 10, 7, 3]
                const octave = this.intensity > 6 ? 4 : 3
                this.tone(t, 55 * Math.pow(2, arp[(s / 2) % 8]! / 12) * Math.pow(2, octave - 1), 'square', step * 0.9, 0.05 + Math.min(0.08, this.intensity * 0.008), bus, 1800)
            }
            this.nextNoteTime += step
            this.musicStep++
        }
    }

    private kick(t: number, out: AudioNode): void {
        const ctx = this.ctx!
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.frequency.setValueAtTime(150, t)
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.14)
        g.gain.setValueAtTime(0.9, t)
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
        osc.connect(g)
        g.connect(out)
        osc.start(t)
        osc.stop(t + 0.22)
    }

    private snap(t: number, out: AudioNode, vol: number): void {
        this.noise(t, 0.12, vol, out, 1800, 'highpass')
    }

    private hat(t: number, out: AudioNode, vol: number): void {
        this.noise(t, 0.035, vol, out, 7000, 'highpass')
    }

    private tone(t: number, freq: number, type: OscillatorType, dur: number, vol: number, out: AudioNode, cutoff: number): void {
        const ctx = this.ctx!
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.value = cutoff
        osc.type = type
        osc.frequency.value = freq
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        osc.connect(f)
        f.connect(g)
        g.connect(out)
        osc.start(t)
        osc.stop(t + dur + 0.02)
    }

    // ── SFX primitives ───────────────────────────────────────────────────

    private noise(t: number, dur: number, vol: number, out: AudioNode, cutoff: number, type: BiquadFilterType, q = 1): GainNode {
        const ctx = this.ctx!
        const src = ctx.createBufferSource()
        src.buffer = this.noiseBuffer
        src.playbackRate.value = 0.8 + Math.random() * 0.4
        const f = ctx.createBiquadFilter()
        f.type = type
        f.frequency.value = cutoff
        f.Q.value = q
        const g = ctx.createGain()
        g.gain.setValueAtTime(vol, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        src.connect(f)
        f.connect(g)
        g.connect(out)
        src.start(t)
        src.stop(t + dur + 0.05)
        return g
    }

    private sweep(t: number, from: number, to: number, dur: number, vol: number, type: OscillatorType, out: AudioNode): void {
        const ctx = this.ctx!
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = type
        osc.frequency.setValueAtTime(from, t)
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur)
        g.gain.setValueAtTime(vol, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        osc.connect(g)
        g.connect(out)
        osc.start(t)
        osc.stop(t + dur + 0.02)
    }

    private chord(t: number, freqs: number[], dur: number, vol: number, type: OscillatorType, out: AudioNode): void {
        for (const f of freqs) this.tone(t, f, type, dur, vol, out, 4000)
    }

    play(sound: ArenaSound, volume = 1): void {
        if (!this.ctx || !this.sfxBus || this.muted) return
        const ctx = this.ctx
        const out = this.sfxBus
        const t = ctx.currentTime
        const v = volume
        const detune = 0.9 + Math.random() * 0.2
        switch (sound) {
            case 'shoot-pulse':
                this.sweep(t, 900 * detune, 180, 0.09, 0.28 * v, 'square', out)
                this.noise(t, 0.06, 0.18 * v, out, 3500, 'bandpass', 0.8)
                break
            case 'shoot-scatter':
                this.noise(t, 0.28, 0.7 * v, out, 900, 'lowpass')
                this.sweep(t, 220 * detune, 50, 0.22, 0.5 * v, 'sawtooth', out)
                this.noise(t, 0.05, 0.4 * v, out, 5000, 'highpass')
                break
            case 'shoot-needler':
                this.sweep(t, 2400 * detune, 700, 0.05, 0.14 * v, 'sine', out)
                this.noise(t, 0.03, 0.08 * v, out, 6000, 'highpass')
                break
            case 'shoot-rail':
                this.sweep(t, 80, 2400, 0.12, 0.35 * v, 'sawtooth', out)
                this.sweep(t + 0.1, 3000, 120, 0.4, 0.5 * v, 'square', out)
                this.noise(t + 0.08, 0.35, 0.5 * v, out, 2000, 'bandpass', 0.6)
                break
            case 'shoot-plasma':
                this.sweep(t, 160 * detune, 60, 0.3, 0.5 * v, 'sawtooth', out)
                this.sweep(t, 600, 1400, 0.18, 0.2 * v, 'sine', out)
                this.noise(t, 0.2, 0.3 * v, out, 800, 'lowpass')
                break
            case 'shoot-arc':
                this.noise(t, 0.18, 0.45 * v, out, 2600 * detune, 'bandpass', 3)
                this.sweep(t, 1800 * detune, 300, 0.14, 0.18 * v, 'square', out)
                break
            case 'shoot-shredder':
                this.sweep(t, 300 * detune, 1200, 0.16, 0.25 * v, 'sawtooth', out)
                this.noise(t, 0.1, 0.25 * v, out, 3000, 'bandpass', 2)
                break
            case 'shoot-ember':
                this.noise(t, 0.3, 0.35 * v, out, 700 * detune, 'lowpass')
                this.sweep(t, 90 * detune, 60, 0.25, 0.1 * v, 'sawtooth', out)
                break
            case 'dry':
                this.noise(t, 0.04, 0.2 * v, out, 2500, 'highpass')
                break
            case 'reload':
                this.noise(t, 0.06, 0.25 * v, out, 1800, 'bandpass', 2)
                this.noise(t + 0.12, 0.05, 0.2 * v, out, 2600, 'bandpass', 2)
                break
            case 'reload-done':
                this.noise(t, 0.05, 0.3 * v, out, 3200, 'bandpass', 3)
                this.tone(t, 880, 'square', 0.05, 0.08 * v, out, 5000)
                break
            case 'slash':
                this.noise(t, 0.16, 0.5 * v, out, 1200 * detune, 'bandpass', 0.5)
                this.sweep(t, 400 * detune, 1600, 0.12, 0.12 * v, 'sine', out)
                break
            case 'slash-hit':
                this.noise(t, 0.12, 0.6 * v, out, 700, 'lowpass')
                this.sweep(t, 700, 120, 0.12, 0.3 * v, 'square', out)
                break
            case 'hit':
                this.noise(t, 0.05, 0.22 * v, out, 1500 * detune, 'bandpass', 1.5)
                this.sweep(t, 500 * detune, 200, 0.05, 0.12 * v, 'square', out)
                break
            case 'crit':
                this.sweep(t, 1400, 400, 0.08, 0.2 * v, 'square', out)
                this.noise(t, 0.06, 0.2 * v, out, 3000, 'highpass')
                break
            case 'kill':
                this.noise(t, 0.22, 0.5 * v, out, 900 * detune, 'lowpass')
                this.sweep(t, 300 * detune, 60, 0.2, 0.3 * v, 'square', out)
                this.noise(t + 0.03, 0.14, 0.3 * v, out, 4000, 'highpass')
                break
            case 'kill-big':
                this.noise(t, 0.5, 0.8 * v, out, 500, 'lowpass')
                this.sweep(t, 200, 30, 0.45, 0.6 * v, 'sawtooth', out)
                this.noise(t + 0.05, 0.3, 0.4 * v, out, 3000, 'highpass')
                break
            case 'explosion':
                this.noise(t, 0.6, 0.9 * v, out, 400, 'lowpass')
                this.sweep(t, 120, 25, 0.5, 0.7 * v, 'sine', out)
                this.noise(t, 0.15, 0.4 * v, out, 2500, 'bandpass', 0.7)
                break
            case 'hurt':
                this.sweep(t, 300, 90, 0.2, 0.5 * v, 'sawtooth', out)
                this.noise(t, 0.15, 0.4 * v, out, 600, 'lowpass')
                break
            case 'dash':
                this.noise(t, 0.28, 0.4 * v, out, 900, 'bandpass', 0.6)
                this.sweep(t, 200, 900, 0.22, 0.12 * v, 'sine', out)
                break
            case 'jump':
                this.sweep(t, 300, 700, 0.12, 0.12 * v, 'sine', out)
                break
            case 'pickup':
                this.tone(t, 880, 'square', 0.08, 0.15 * v, out, 5000)
                this.tone(t + 0.07, 1320, 'square', 0.12, 0.15 * v, out, 5000)
                break
            case 'pickup-weapon':
                this.chord(t, [523, 659, 784], 0.25, 0.12 * v, 'square', out)
                this.chord(t + 0.15, [784, 988, 1175], 0.4, 0.12 * v, 'square', out)
                break
            case 'nova':
                this.sweep(t, 60, 1200, 0.35, 0.5 * v, 'sawtooth', out)
                this.noise(t + 0.2, 0.6, 0.7 * v, out, 700, 'lowpass')
                this.sweep(t + 0.25, 1600, 100, 0.5, 0.4 * v, 'square', out)
                break
            case 'wave-start':
                this.chord(t, [110, 165, 220], 0.6, 0.25 * v, 'sawtooth', out)
                this.chord(t + 0.35, [131, 196, 262], 0.8, 0.25 * v, 'sawtooth', out)
                this.noise(t, 0.4, 0.3 * v, out, 300, 'lowpass')
                break
            case 'wave-clear':
                this.chord(t, [523, 659, 784], 0.3, 0.15 * v, 'square', out)
                this.chord(t + 0.2, [659, 784, 988], 0.3, 0.15 * v, 'square', out)
                this.chord(t + 0.4, [784, 988, 1319], 0.7, 0.18 * v, 'square', out)
                break
            case 'boss':
                this.sweep(t, 90, 30, 1.4, 0.8 * v, 'sawtooth', out)
                this.noise(t, 1.2, 0.5 * v, out, 250, 'lowpass')
                this.chord(t + 0.3, [55, 65, 82], 1.2, 0.3 * v, 'square', out)
                break
            case 'upgrade':
                this.chord(t, [659, 830, 988], 0.4, 0.12 * v, 'square', out)
                this.sweep(t, 400, 1600, 0.3, 0.1 * v, 'sine', out)
                break
            case 'select':
                this.tone(t, 1200, 'square', 0.05, 0.08 * v, out, 6000)
                break
            case 'spit':
                this.sweep(t, 700, 250, 0.16, 0.2 * v, 'sawtooth', out)
                this.noise(t, 0.12, 0.2 * v, out, 1500, 'bandpass', 1)
                break
            case 'charge':
                this.sweep(t, 100, 400, 0.5, 0.4 * v, 'sawtooth', out)
                this.noise(t, 0.5, 0.3 * v, out, 500, 'lowpass')
                break
            case 'slam':
                this.noise(t, 0.7, 1 * v, out, 300, 'lowpass')
                this.sweep(t, 80, 20, 0.6, 0.8 * v, 'sine', out)
                break
            case 'death':
                this.sweep(t, 400, 40, 1.2, 0.6 * v, 'sawtooth', out)
                this.noise(t, 1.0, 0.5 * v, out, 400, 'lowpass')
                break
            case 'chrono':
                this.sweep(t, 1200, 200, 0.35, 0.2 * v, 'sine', out)
                this.sweep(t + 0.3, 200, 1200, 0.25, 0.12 * v, 'sine', out)
                break
        }
    }
}
