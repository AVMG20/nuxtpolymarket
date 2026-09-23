// Book of Shadows audio: the game's own samples plus the synthesized layers
// in bookofshadows-synth.ts, mixed on one bus.
//
// Chain: music gain ─┐
//        sample/synth ├─> sfx gain ─> master (player volume) ─> compressor ─> out
// The music bus ducks while a big win or the feature intro is on screen.
// Settings persist in localStorage (bos_volume, bos_muted, bos_music).

import { ref, watch } from 'vue'
import {
    BOS_SYNTH_COOLDOWNS,
    BOS_SYNTH_LEVELS,
    BOS_SYNTH_RECIPES,
    BosSynthVoice,
    bosSynthWarmUp,
    type BosSynthEvent
} from '~/utils/slots/bookofshadows-synth'

const SAMPLES = {
    music: '/slots/bookofshadows/background-music.mp3',
    reel: '/slots/bookofshadows/reel.mp3',
    button: '/slots/bookofshadows/button.mp3',
    bonus: '/slots/bookofshadows/bonus.mp3',
    bigWin: '/slots/bookofshadows/big-win.mp3',
    drawLine: '/slots/bookofshadows/draw-line-4-sounds.mp3',
    wildSpawn: '/slots/bookofshadows/wild-spawn.mp3'
} as const

export type BosSample = Exclude<keyof typeof SAMPLES, 'music'>

const SAMPLE_LEVELS: Record<BosSample, number> = {
    reel: 0.32,
    button: 0.45,
    bonus: 0.85,
    bigWin: 0.8,
    drawLine: 0.3,
    wildSpawn: 0.4
}

const SAMPLE_COOLDOWNS: Record<BosSample, number> = {
    reel: 60,
    button: 50,
    bonus: 400,
    bigWin: 600,
    drawLine: 35,
    wildSpawn: 30
}

const MUSIC_LEVEL = 0.34
const MUSIC_DUCKED = 0.12
const MAX_VOICES = 24

export class BosAudio {
    readonly volume = ref(70)
    readonly muted = ref(false)
    readonly music = ref(true)

    private ctx: AudioContext | null = null
    private master: GainNode | null = null
    private compressor: DynamicsCompressorNode | null = null
    private sfx: GainNode | null = null
    private musicGain: GainNode | null = null
    private musicSource: AudioBufferSourceNode | null = null
    private readonly buffers: Partial<Record<keyof typeof SAMPLES, AudioBuffer>> = {}
    private drawSlices: { offset: number, duration: number }[] = []
    private readonly lastPlayed = new Map<string, number>()
    private readonly voices: BosSynthVoice[] = []
    private ducked = false
    private stops: (() => void)[] = []
    private disposed = false

    constructor() {
        if (!import.meta.client) return
        try {
            const volume = localStorage.getItem('bos_volume')
            if (volume !== null && Number.isFinite(Number(volume))) this.volume.value = Math.max(0, Math.min(100, Number(volume)))
            this.muted.value = localStorage.getItem('bos_muted') === '1'
            this.music.value = localStorage.getItem('bos_music') !== '0'
        } catch { /* storage blocked: defaults */ }

        this.stops.push(watch(this.volume, (value) => {
            this.store('bos_volume', String(value))
            this.applyMaster()
        }))
        this.stops.push(watch(this.muted, (value) => {
            this.store('bos_muted', value ? '1' : '0')
            this.applyMaster()
            if (!value) this.unlock()
        }))
        this.stops.push(watch(this.music, (value) => {
            this.store('bos_music', value ? '1' : '0')
            if (value) this.startMusic()
            else this.stopMusic()
        }))
    }

    private store(key: string, value: string) {
        try {
            localStorage.setItem(key, value)
        } catch { /* ignore */ }
    }

    async load() {
        if (!import.meta.client || this.ctx) return
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return
        const ctx = new Ctx()
        this.ctx = ctx
        bosSynthWarmUp(ctx)

        this.compressor = ctx.createDynamicsCompressor()
        this.compressor.threshold.value = -12
        this.compressor.knee.value = 10
        this.compressor.ratio.value = 8
        this.compressor.attack.value = 0.003
        this.compressor.release.value = 0.25
        this.compressor.connect(ctx.destination)

        this.master = ctx.createGain()
        this.master.connect(this.compressor)
        this.sfx = ctx.createGain()
        this.sfx.connect(this.master)
        this.musicGain = ctx.createGain()
        this.musicGain.gain.value = MUSIC_LEVEL
        this.musicGain.connect(this.master)
        this.applyMaster()

        await Promise.all(Object.entries(SAMPLES).map(async ([key, url]) => {
            try {
                const res = await fetch(url)
                const data = await res.arrayBuffer()
                if (this.disposed) return
                this.buffers[key as keyof typeof SAMPLES] = await ctx.decodeAudioData(data)
            } catch { /* a missing sample just stays silent */ }
        }))

        // draw-line-4-sounds.mp3 holds four short traces back to back.
        const draw = this.buffers.drawLine
        if (draw) {
            const seg = draw.duration / 4
            this.drawSlices = Array.from({ length: 4 }, (_, i) => ({ offset: i * seg, duration: seg }))
        }
        if (ctx.state === 'running') this.startMusic()
    }

    private applyMaster() {
        if (!this.ctx || !this.master) return
        const level = this.muted.value ? 0 : this.volume.value / 100
        this.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.03)
    }

    /** Call from any user gesture: resumes the context and starts the music. */
    unlock() {
        const ctx = this.ctx
        if (!ctx || this.disposed) return
        if (ctx.state === 'suspended') {
            void ctx.resume().then(() => this.startMusic()).catch(() => {})
        } else {
            this.startMusic()
        }
    }

    private running(): AudioContext | null {
        const ctx = this.ctx
        if (!ctx || this.disposed || this.muted.value || this.volume.value <= 0) return null
        if (ctx.state !== 'running') {
            void ctx.resume().catch(() => {})
            return null
        }
        return ctx
    }

    private cooled(key: string, ms: number): boolean {
        const now = performance.now()
        if (now - (this.lastPlayed.get(key) ?? -Infinity) < ms) return false
        this.lastPlayed.set(key, now)
        return true
    }

    private startMusic() {
        const ctx = this.ctx
        if (!ctx || ctx.state !== 'running' || !this.music.value || this.musicSource || !this.buffers.music || !this.musicGain) return
        const src = ctx.createBufferSource()
        src.buffer = this.buffers.music
        src.loop = true
        src.connect(this.musicGain)
        src.start()
        this.musicSource = src
    }

    private stopMusic() {
        try {
            this.musicSource?.stop()
        } catch { /* already stopped */ }
        this.musicSource?.disconnect()
        this.musicSource = null
    }

    /** Pull the music down under a big moment, and back up after. */
    duck(on: boolean) {
        if (!this.ctx || !this.musicGain || this.ducked === on) return
        this.ducked = on
        this.musicGain.gain.setTargetAtTime(on ? MUSIC_DUCKED : MUSIC_LEVEL, this.ctx.currentTime, on ? 0.08 : 0.6)
    }

    play(key: BosSample, options: { rate?: number, gain?: number } = {}) {
        const ctx = this.running()
        const buffer = this.buffers[key]
        if (!ctx || !buffer || !this.sfx || !this.cooled(key, SAMPLE_COOLDOWNS[key])) return
        const src = ctx.createBufferSource()
        src.buffer = buffer
        if (options.rate) src.playbackRate.value = options.rate
        const gain = ctx.createGain()
        gain.gain.value = SAMPLE_LEVELS[key] * (options.gain ?? 1)
        src.connect(gain)
        gain.connect(this.sfx)
        src.onended = () => gain.disconnect()
        if (key === 'drawLine' && this.drawSlices.length) {
            const slice = this.drawSlices[Math.floor(Math.random() * this.drawSlices.length)]!
            src.start(0, slice.offset, slice.duration)
        } else {
            src.start()
        }
    }

    synth(event: BosSynthEvent, intensity = 0) {
        const ctx = this.running()
        if (!ctx || !this.sfx || !this.cooled(`s:${event}`, BOS_SYNTH_COOLDOWNS[event])) return
        while (this.voices.length >= MAX_VOICES) this.voices.shift()!.release()
        const voice = new BosSynthVoice(ctx, this.sfx, {
            level: BOS_SYNTH_LEVELS[event],
            pitch: 1 + (Math.random() * 2 - 1) * 0.015,
            start: ctx.currentTime + 0.004
        })
        voice.onDone = () => {
            const i = this.voices.indexOf(voice)
            if (i !== -1) this.voices.splice(i, 1)
        }
        this.voices.push(voice)
        try {
            BOS_SYNTH_RECIPES[event](voice, intensity)
        } catch {
            voice.release(0)
        }
        voice.seal()
    }

    dispose() {
        this.disposed = true
        for (const stop of this.stops) stop()
        this.stops = []
        this.stopMusic()
        for (const voice of this.voices.splice(0)) voice.release(0)
        void this.ctx?.close().catch(() => {})
        this.ctx = null
    }
}
