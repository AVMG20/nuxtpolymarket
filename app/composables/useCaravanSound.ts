/**
 * Synthesised sound for the caravan game.
 *
 * Everything here is generated with oscillators rather than loaded from files:
 * the cues are short and tonal, so there is nothing to ship and nothing to wait
 * for. The context is created lazily on the first cue, which is always downstream
 * of a click, so autoplay policy never blocks it.
 */

import type { Rarity } from '#shared/utils/caravan/types'

const STORAGE_KEY = 'caravan:muted'

let context: AudioContext | null = null

function ctx(): AudioContext | null {
    if (!import.meta.client) return null
    if (!context) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return null
        context = new Ctor()
    }
    if (context.state === 'suspended') void context.resume()
    return context
}

interface ToneOptions {
    /** Hz. */
    freq: number
    /** Seconds from now. */
    at?: number
    duration?: number
    type?: OscillatorType
    gain?: number
    /** Slide to this frequency across the note. */
    to?: number
}

export function useCaravanSound() {
    const muted = useState('caravan-muted', () => false)

    onMounted(() => {
        try {
            muted.value = localStorage.getItem(STORAGE_KEY) === '1'
        } catch {
            // Private browsing or blocked storage -- default to sound on.
        }
    })

    function setMuted(value: boolean) {
        muted.value = value
        try {
            localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
        } catch {
            // Nothing to do; the preference just will not survive a reload.
        }
    }

    function tone(options: ToneOptions) {
        const audio = ctx()
        if (!audio || muted.value) return
        const start = audio.currentTime + (options.at ?? 0)
        const duration = options.duration ?? 0.16
        const osc = audio.createOscillator()
        const amp = audio.createGain()

        osc.type = options.type ?? 'sine'
        osc.frequency.setValueAtTime(options.freq, start)
        if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, start + duration)

        // A quick attack and an exponential tail: reads as a "blip", not a beep.
        const peak = (options.gain ?? 0.14)
        amp.gain.setValueAtTime(0.0001, start)
        amp.gain.exponentialRampToValueAtTime(peak, start + 0.012)
        amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)

        osc.connect(amp).connect(audio.destination)
        osc.start(start)
        osc.stop(start + duration + 0.02)
    }

    function noise(duration = 0.25, gain = 0.12) {
        const audio = ctx()
        if (!audio || muted.value) return
        const frames = Math.floor(audio.sampleRate * duration)
        const buffer = audio.createBuffer(1, frames, audio.sampleRate)
        const data = buffer.getChannelData(0)
        for (let i = 0; i < frames; i++) {
            // Decaying white noise -- the body of an impact.
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 2.5)
        }
        const source = audio.createBufferSource()
        const amp = audio.createGain()
        const filter = audio.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = 900
        amp.gain.value = gain
        source.buffer = buffer
        source.connect(filter).connect(amp).connect(audio.destination)
        source.start()
    }

    /** Rising two-note flourish. A node is now yours. */
    function claim() {
        tone({ freq: 392, duration: 0.13 })
        tone({ freq: 587, at: 0.09, duration: 0.22, gain: 0.11 })
    }

    /** Soft mechanical tick for refining and other bulk actions. */
    function tick() {
        tone({ freq: 240, duration: 0.05, type: 'square', gain: 0.05 })
    }

    /**
     * The workshop reveal. Rarity drives both how many notes play and how far up
     * the arpeggio runs, so a legendary is audibly different from across the room.
     */
    function craft(rarity: Rarity) {
        const ladders: Record<Rarity, number[]> = {
            common: [294],
            uncommon: [294, 392],
            rare: [294, 392, 494],
            epic: [294, 392, 494, 659],
            legendary: [294, 392, 494, 659, 784, 988]
        }
        const notes = ladders[rarity]
        notes.forEach((freq, i) => {
            tone({ freq, at: i * 0.075, duration: 0.3, type: i > 2 ? 'triangle' : 'sine', gain: 0.1 + i * 0.012 })
        })
        if (rarity === 'legendary' || rarity === 'epic') {
            tone({ freq: 1568, at: notes.length * 0.075, duration: 0.5, type: 'triangle', gain: 0.07 })
        }
    }

    /** Drums out, then either a fanfare or a slump. */
    function assault() {
        noise(0.3, 0.16)
        tone({ freq: 110, duration: 0.28, type: 'sawtooth', gain: 0.09 })
    }

    function victory() {
        tone({ freq: 523, duration: 0.2 })
        tone({ freq: 659, at: 0.11, duration: 0.2 })
        tone({ freq: 784, at: 0.22, duration: 0.42, gain: 0.13 })
    }

    function defeat() {
        tone({ freq: 330, duration: 0.22, type: 'sawtooth', gain: 0.09, to: 160 })
        noise(0.35, 0.1)
    }

    /** A worker gained a level. Deliberately tiny -- this fires often. */
    function levelUp() {
        tone({ freq: 880, duration: 0.1, gain: 0.06 })
        tone({ freq: 1175, at: 0.06, duration: 0.14, gain: 0.05 })
    }

    /** Tier advancement: the biggest moment in the game, so the longest cue. */
    function ascend() {
        const notes = [262, 330, 392, 523, 659]
        notes.forEach((freq, i) => tone({ freq, at: i * 0.1, duration: 0.6, gain: 0.11 }))
        tone({ freq: 1047, at: 0.55, duration: 0.9, type: 'triangle', gain: 0.09 })
    }

    return { muted, setMuted, claim, tick, craft, assault, victory, defeat, levelUp, ascend }
}
