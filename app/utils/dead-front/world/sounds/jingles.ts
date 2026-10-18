import type { DfPerkId } from '#shared/utils/dead-front/types'
import {
    at, filterNode, gainNode, mtof, noise, oscNode, pulseWave, reverbSend, rnd, shaperNode, waveNode
} from './noise'
import type { Rt } from './noise'
import { clickTrain, fmBell, scatter } from './parts'

// A tiny step sequencer with a few period instruments, the music box tune
// and one original jingle per perk machine. Played through a "phonograph"
// band (no deep lows, no harsh highs) so it sits in the 1917 world.

/** Plays one note; `r.t` is the note start, `freq` 0 for unpitched drums. */
type Instrument = (r: Rt, freq: number, dur: number, vel: number) => void

interface SeqNote {
    at: number
    len: number
    freqs: number[]
    vel: number
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function noteToMidi(name: string): number {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name)
    if (!m) throw new Error(`Bad note ${name}`)
    const base = NOTE_INDEX[m[1] ?? 'C'] ?? 0
    const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
    return 12 * (Number(m[3]) + 1) + base + acc
}

/**
 * Parse 'C4:1 D4+F4:.5 r:.5 x:.25 X:.25'. Lengths are beats; `r` rests; `+` stacks
 * a chord; `x` / `X` are soft / accented unpitched hits; a trailing `!` accents a note.
 */
export function parseSeq(src: string): { notes: SeqNote[], beats: number } {
    const notes: SeqNote[] = []
    let pos = 0
    for (const tok of src.trim().split(/\s+/)) {
        if (!tok) continue
        const accent = tok.endsWith('!')
        const clean = accent ? tok.slice(0, -1) : tok
        const [pitch = 'r', lenStr = '1'] = clean.split(':')
        const len = Number(lenStr)
        if (pitch === 'x' || pitch === 'X') {
            notes.push({ at: pos, len, freqs: [0], vel: pitch === 'X' ? 1 : 0.55 })
        } else if (pitch !== 'r') {
            notes.push({ at: pos, len, freqs: pitch.split('+').map(n => mtof(noteToMidi(n))), vel: accent ? 1 : 0.8 })
        }
        pos += len
    }
    return { notes, beats: pos }
}

interface Track {
    inst: Instrument
    seq: string
    /** Fraction of the note length that sounds (staccato < 1). */
    gate?: number
    gain?: number
}

/** Schedule a whole tune; returns its length in seconds. */
function playSong(r: Rt, bpm: number, tracks: readonly Track[], swing = 0): number {
    const beat = 60 / bpm
    let total = 0
    for (const tr of tracks) {
        const { notes, beats } = parseSeq(tr.seq)
        total = Math.max(total, beats * beat)
        for (const n of notes) {
            const off = n.at % 1 === 0.5 ? swing * beat : 0
            for (const f of n.freqs) {
                tr.inst(at(r, n.at * beat + off), f, Math.max(0.04, n.len * beat * (tr.gate ?? 0.9)), n.vel * (tr.gain ?? 1))
            }
        }
    }
    return total
}

/** The phonograph horn: band-limit, a little saturation, a short room, faint surface crackle. */
function phonograph(r: Rt, dur: number, room = 0.18): Rt {
    const { ctx } = r
    const roomIn = reverbSend(ctx, r.out, room, 1.4, 3.5, 0.6)
    const lp = filterNode(ctx, 'lowpass', 4300, 0.6, roomIn)
    const sat = shaperNode(ctx, 0.6, lp)
    const pre = gainNode(ctx, 0.9, sat)
    const hp = filterNode(ctx, 'highpass', 170, 0.6, pre)
    const crackleT = scatter(Math.round(dur * 9), dur, 1)
    clickTrain({ ...r, out: lp }, crackleT, { freq: 2600, q: 0.8, gain: 0.03, len: 0.003, jitter: 0.8 })
    return { ...r, out: hp }
}

// ---------------------------------------------------------------- instruments

function lead(duty: number, cutoff = 2800): Instrument {
    return (r, freq, dur, vel) => {
        const { ctx, t } = r
        const g = gainNode(ctx, 0, r.out)
        const lp = filterNode(ctx, 'lowpass', cutoff, 1.2, g)
        const wave = pulseWave(ctx, duty)
        const a = waveNode(ctx, wave, freq * r.rate, t, dur + 0.12, lp)
        const b = waveNode(ctx, wave, freq * r.rate, t, dur + 0.12, lp)
        a.detune.setValueAtTime(-6, t)
        b.detune.setValueAtTime(6, t)
        lp.frequency.setValueAtTime(cutoff * 1.4, t)
        lp.frequency.exponentialRampToValueAtTime(cutoff * 0.55, t + dur)
        const pk = 0.11 * vel * r.vol
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(pk, t + 0.006)
        g.gain.linearRampToValueAtTime(pk * 0.65, t + Math.min(dur, 0.09))
        g.gain.setValueAtTime(pk * 0.65, t + dur)
        g.gain.linearRampToValueAtTime(0, t + dur + 0.08)
    }
}

/** Brass section-ish: two saws with a filter "blat" on the attack and late vibrato. */
const brass: Instrument = (r, freq, dur, vel) => {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 600, 1.5, g)
    const vib = gainNode(ctx, 0)
    oscNode(ctx, 'sine', 5.5, t, dur + 0.2, vib)
    for (const d of [-8, 7]) {
        const o = oscNode(ctx, 'sawtooth', freq * r.rate, t, dur + 0.2, lp)
        o.detune.setValueAtTime(d, t)
        vib.connect(o.detune)
    }
    vib.gain.setValueAtTime(0, t)
    vib.gain.linearRampToValueAtTime(0, t + 0.18)
    vib.gain.linearRampToValueAtTime(14, t + Math.max(0.2, dur))
    lp.frequency.setValueAtTime(500, t)
    lp.frequency.exponentialRampToValueAtTime(Math.min(3200, freq * 9), t + 0.05)
    lp.frequency.exponentialRampToValueAtTime(Math.min(2000, freq * 5), t + 0.25)
    const pk = 0.075 * vel * r.vol
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(pk, t + 0.03)
    g.gain.linearRampToValueAtTime(pk * 0.8, t + 0.12)
    g.gain.setValueAtTime(pk * 0.8, t + dur)
    g.gain.linearRampToValueAtTime(0, t + dur + 0.12)
}

/** Plucked upright bass / tuba-ish thump. */
const pluckBass: Instrument = (r, freq, dur, vel) => {
    const { ctx, t } = r
    const len = Math.min(dur + 0.15, 0.6)
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 1400, 2, g)
    oscNode(ctx, 'triangle', freq * r.rate, t, len + 0.05, lp)
    oscNode(ctx, 'sawtooth', freq * r.rate, t, len + 0.05, gainNode(ctx, 0.35, lp))
    lp.frequency.setValueAtTime(1600, t)
    lp.frequency.exponentialRampToValueAtTime(220, t + len * 0.6)
    const pk = 0.22 * vel * r.vol
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(pk, t + 0.004)
    g.gain.exponentialRampToValueAtTime(pk * 0.002, t + len)
    g.gain.linearRampToValueAtTime(0, t + len + 0.02)
}

/** Honky upright piano chord stab. */
const piano: Instrument = (r, freq, dur, vel) => {
    const { ctx, t } = r
    const len = Math.min(0.9, dur + 0.25)
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', 2400, 0.8, g)
    for (const d of [-9, 9]) {
        const o = oscNode(ctx, 'triangle', freq * r.rate, t, len + 0.05, lp)
        o.detune.setValueAtTime(d, t)
    }
    oscNode(ctx, 'sine', freq * 2 * r.rate, t, len * 0.4, gainNode(ctx, 0.3, lp))
    lp.frequency.setValueAtTime(3000, t)
    lp.frequency.exponentialRampToValueAtTime(900, t + len)
    const pk = 0.06 * vel * r.vol
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(pk, t + 0.003)
    g.gain.exponentialRampToValueAtTime(pk * 0.003, t + len)
    g.gain.linearRampToValueAtTime(0, t + len + 0.02)
}

/** Reed harmonium: soft attack, breathy saw through a mellow filter. */
const harmonium: Instrument = (r, freq, dur, vel) => {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const lp = filterNode(ctx, 'lowpass', Math.min(2200, freq * 6), 0.7, g)
    for (const d of [-5, 4]) {
        const o = oscNode(ctx, 'sawtooth', freq * r.rate, t, dur + 0.4, lp)
        o.detune.setValueAtTime(d, t)
    }
    oscNode(ctx, 'sine', freq * 0.5 * r.rate, t, dur + 0.4, gainNode(ctx, 0.4, lp))
    const pk = 0.045 * vel * r.vol
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(pk, t + 0.12)
    g.gain.setValueAtTime(pk, t + dur)
    g.gain.linearRampToValueAtTime(0, t + dur + 0.35)
}

/** Whistled lead with breath and a lazy vibrato. */
const whistle: Instrument = (r, freq, dur, vel) => {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const o = oscNode(ctx, 'sine', freq * r.rate, t, dur + 0.15, g)
    const vib = gainNode(ctx, 0, o.detune)
    oscNode(ctx, 'sine', rnd(5, 6), t, dur + 0.15, vib)
    vib.gain.setValueAtTime(0, t)
    vib.gain.linearRampToValueAtTime(22, t + Math.min(0.4, dur))
    o.frequency.setValueAtTime(freq * 0.97 * r.rate, t)
    o.frequency.exponentialRampToValueAtTime(freq * r.rate, t + 0.05)
    const bg = gainNode(ctx, 0.25, g)
    const bp = filterNode(ctx, 'bandpass', freq * r.rate, 8, bg)
    noise(ctx, 'white', t, dur + 0.15, bp)
    const pk = 0.12 * vel * r.vol
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(pk, t + 0.04)
    g.gain.setValueAtTime(pk * 0.9, t + dur)
    g.gain.linearRampToValueAtTime(0, t + dur + 0.1)
}

/** Field snare: noise rattle + a short tonal crack. */
const snare: Instrument = (r, _freq, _dur, vel) => {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const bp = filterNode(ctx, 'bandpass', 2200, 0.7, g)
    noise(ctx, 'white', t, 0.2, bp)
    const pk = 0.09 * vel * r.vol
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(pk, t + 0.002)
    g.gain.exponentialRampToValueAtTime(pk * 0.004, t + 0.13)
    g.gain.linearRampToValueAtTime(0, t + 0.14)
    const tg = gainNode(ctx, 0, r.out)
    const o = oscNode(ctx, 'triangle', 210 * r.rate, t, 0.08, tg)
    o.frequency.exponentialRampToValueAtTime(150 * r.rate, t + 0.05)
    tg.gain.setValueAtTime(0, t)
    tg.gain.linearRampToValueAtTime(0.08 * vel * r.vol, t + 0.002)
    tg.gain.exponentialRampToValueAtTime(0.0003, t + 0.06)
}

/** Parade bass drum. */
const bassDrum: Instrument = (r, _freq, _dur, vel) => {
    const { ctx, t } = r
    const g = gainNode(ctx, 0, r.out)
    const o = oscNode(ctx, 'sine', 130 * r.rate, t, 0.35, g)
    o.frequency.exponentialRampToValueAtTime(55 * r.rate, t + 0.12)
    const pk = 0.3 * vel * r.vol
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(pk, t + 0.003)
    g.gain.exponentialRampToValueAtTime(pk * 0.003, t + 0.32)
    g.gain.linearRampToValueAtTime(0, t + 0.33)
}

/** Brushed cymbal / triangle tick. */
const tick: Instrument = (r, _freq, _dur, vel) => {
    clickTrain(r, [0], { freq: 6000, q: 1.2, gain: 0.05 * vel, len: 0.03, type: 'bandpass', jitter: 0 })
}

/** Music-box tine: bright FM strike decaying into a pure tone, slightly out of tune. */
const tine: Instrument = (r, freq, dur, vel) => {
    fmBell(r, { freq, dur: Math.max(0.8, dur * 2.5), gain: 0.13 * vel, ratio: 4.01, index: 0.9, bite: 0.07, detune: rnd(-9, 9) })
    fmBell(r, { freq: freq * 2, dur: 0.25, gain: 0.025 * vel, ratio: 2.76, index: 0.4, bite: 0.03 })
}

/** Glass chime for the hymn's descant. */
const chime: Instrument = (r, freq, dur, vel) => {
    fmBell(r, { freq, dur: Math.max(1, dur * 1.5), gain: 0.07 * vel, ratio: 3.5, index: 0.8, bite: 0.15 })
}

// ---------------------------------------------------------------- tunes

/** The mystery box music box: an eerie A minor waltz-like figure (~4 s). */
export function boxJingle(r: Rt): void {
    const p = phonograph(r, 4.5, 0.3)
    // Mechanism ticking under the tune.
    clickTrain({ ...p, out: p.out }, Array.from({ length: 24 }, (_, i) => i / 6), { freq: 3500, q: 3, gain: 0.025, len: 0.004, jitter: 0.3 })
    playSong(p, 180, [
        { inst: tine, seq: 'A5:.5 E5:.5 C6:.5 B5:.5 A5:.5 E5:.5 G#5:1 F5:.5 C5:.5 A5:.5 G#5:.5 F5:.5 D5:.5 E5:1 C5:.5 E5:.5 B4:.5 D5:.5 G#4:.5 B4:.5 A4:2' },
        { inst: tine, seq: 'A3:2 E4:2 D4:2 E3:2 F3:1 E3:2 A3:2', gain: 0.6 }
    ])
}

const PERK_TUNES: Record<DfPerkId, (r: Rt) => void> = {
    // Ironhide: a sturdy Bb march with brass, parade drum and snare.
    ironhide: r => playSong(phonograph(r, 4.2), 120, [
        { inst: brass, seq: 'Bb3:.75! Bb3:.25 D4:.5 F4:.5 Bb4:1! A4:.5 G4:.5 F4:.75 Eb4:.25 D4:.5 C4:.5 Bb3+D4+F4:2!', gate: 0.85 },
        { inst: brass, seq: 'r:4 F3:.75 G3:.25 F3:.5 Eb3:.5 r:2', gain: 0.6 },
        { inst: pluckBass, seq: 'Bb2:1 F2:1 Bb2:1 F2:1 Eb2:1 F2:1 Bb1:2' },
        { inst: bassDrum, seq: 'X:1 x:1 X:1 x:1 X:1 x:1 X:2' },
        { inst: snare, seq: 'r:.5 x:.5 r:.5 x:.25 x:.25 r:.5 x:.5 r:.5 x:.25 x:.25 r:.5 x:.5 x:.25 x:.25 x:.25 x:.25 X:.5 r:1.5' }
    ]),
    // Quickhand: a quick ragtime strut over oom-pah piano.
    quickhand: r => playSong(phonograph(r, 3.4), 160, [
        { inst: lead(0.25, 3000), seq: 'D5:.5 B4:.5 G4:.25 A4:.5 B4:.25 r:.5 E5:.5 D5:.25 B4:.5 G4:.25 r:.5 A4:.5 F#4:.5 G4:1! G4:1.5!', gate: 0.8 },
        { inst: pluckBass, seq: 'G2:1 D2:1 C3:1 D2:1 G2:1 D2:1 G2:2' },
        { inst: piano, seq: 'r:.5 G3+B3+D4:.5 r:.5 G3+B3+D4:.5 r:.5 G3+C4+E4:.5 r:.5 F#3+A3+C4:.5 r:.5 G3+B3+D4:.5 r:.5 F#3+A3+C4:.5 G3+B3+D4:1 r:1' },
        { inst: tick, seq: 'x:.5 X:.5 x:.5 X:.5 x:.5 X:.5 x:.5 X:.5 x:.5 X:.5 x:.5 X:.5 X:1 r:1' }
    ], 0.08),
    // Twinfire: rapid staccato sixteenths in D minor, a rattling snare under it.
    twinfire: r => playSong(phonograph(r, 3), 180, [
        { inst: lead(0.5, 2600), seq: 'D5:.25 D5:.25 A4:.25 D5:.25 F5:.25 D5:.25 A4:.25 D5:.25 C5:.25 C5:.25 G4:.25 C5:.25 E5:.25 C5:.25 G4:.25 C5:.25 Bb4:.25 Bb4:.25 F4:.25 Bb4:.25 D5:.25 Bb4:.25 A4:.25 G4:.25 A4:.5! A4:.25 A4:.25 D5:1!', gate: 0.45 },
        { inst: pluckBass, seq: 'D3:.5 D3:.5 D3:.5 D3:.5 C3:.5 C3:.5 C3:.5 C3:.5 Bb2:.5 Bb2:.5 Bb2:.5 Bb2:.5 A2:.5 A2:.5 D2:1', gate: 0.6 },
        { inst: snare, seq: 'x:.25 x:.25 X:.5 x:.25 x:.25 X:.5 x:.25 x:.25 X:.5 x:.25 x:.25 X:.5 x:.25 x:.25 X:.5 x:.25 x:.25 X:.5 x:.125 x:.125 x:.125 x:.125 X:.5 X:1' }
    ]),
    // Second Wind: a gentle F major hymn on harmonium, a glass descant above.
    secondwind: r => playSong(phonograph(r, 4.6, 0.35), 90, [
        { inst: harmonium, seq: 'F3+A3+C4:1 D3+A3+D4:1 Bb2+F3+D4:1 C3+G3+E4:1 F2+F3+C4:2', gate: 0.97 },
        { inst: harmonium, seq: 'A4:1 F4:.5 G4:.5 F4:1 E4:1 F4:2', gain: 0.8, gate: 0.97 },
        { inst: chime, seq: 'C6:1 D6:.5 C6:.5 Bb5:1 G5:1 A5:2' }
    ]),
    // Fleetfoot: a bouncy galop in A, skipping melody over oom-pah.
    fleetfoot: r => playSong(phonograph(r, 3.8), 200, [
        { inst: lead(0.25, 3200), seq: 'E5:.5 C#5:.25 A4:.25 E5:.5 C#5:.25 A4:.25 F#5:.5 E5:.5 D5:.5 B4:.5 D5:.5 B4:.25 G#4:.25 D5:.5 B4:.25 G#4:.25 E5:.5 D5:.5 C#5:.5 B4:.5 A4:.5 C#5:.5 E5:.5 A5:.5! E5:.5 A5:1! r:.5', gate: 0.7 },
        { inst: pluckBass, seq: 'A2:.5 r:.5 E2:.5 r:.5 D2:.5 r:.5 A2:.5 r:.5 E2:.5 r:.5 B2:.5 r:.5 E2:.5 r:.5 G#2:.5 r:.5 A2:.5 r:.5 E2:.5 r:.5 A2:1 r:1' },
        { inst: piano, seq: 'r:.5 A3+C#4+E4:.5 r:.5 A3+C#4+E4:.5 r:.5 A3+D4+F#4:.5 r:.5 A3+D4+F#4:.5 r:.5 G#3+B3+E4:.5 r:.5 G#3+B3+E4:.5 r:.5 G#3+B3+D4:.5 r:.5 G#3+B3+D4:.5 r:.5 A3+C#4+E4:.5 r:.5 A3+C#4+E4:.5 A3+C#4+E4:1 r:1' },
        { inst: snare, seq: 'r:.5 x:.5 r:.5 x:.5 r:.5 x:.5 r:.5 x:.5 r:.5 x:.5 r:.5 x:.5 r:.5 x:.5 r:.5 x:.5 r:.5 x:.5 r:.5 x:.5 X:1 r:1' }
    ]),
    // Steadyeye: a slow, wistful E minor waltz with a whistled lead.
    steadyeye: r => playSong(phonograph(r, 4.4, 0.3), 140, [
        { inst: whistle, seq: 'B4:1.5 C5:.5 B4:1 A4:1 F#4:1 D#4:1 E4:3', gate: 0.95 },
        { inst: pluckBass, seq: 'E2:3 B1:3 E2:3' },
        { inst: piano, seq: 'r:1 G3+B3:1 G3+B3:1 r:1 A3+D#4:1 A3+D#4:1 r:1 G3+B3:1 G3+B3:1' }
    ])
}

export function perkJingle(perk: DfPerkId): (r: Rt) => void {
    return PERK_TUNES[perk]
}

export const DF_JINGLE_PERKS = Object.keys(PERK_TUNES) as DfPerkId[]
