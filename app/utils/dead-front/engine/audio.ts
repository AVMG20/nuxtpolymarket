import * as THREE from 'three'
import type { Vec3 } from '#shared/utils/dead-front/types'
import type { DfAudio, DfSoundOpts, DfSynth } from '../context'

// The Dead Front sound engine: one AudioContext (created on the first user
// gesture) feeding a small mixer. Every sound name maps to a category bus
// (zombie vocals, zombie foley, own weapon, remote weapons, world, UI, music,
// ambience) with its own gain, voice cap, distance cull and per-name retrigger
// interval. Zombie vocals have a global governor on top (few at once, spaced
// out), own shots and stingers duck the ambience and the horde, and the master
// runs through a glue compressor and a brickwall limiter before the volume.
//
// The voice policy (`createDfMixer`) is pure and unit-tested; the WebAudio
// side below only builds nodes for what the mixer admits.

// ---------------------------------------------------------------- mix policy

export type DfMixCat = 'zvocal' | 'zfoley' | 'weapon' | 'remote' | 'world' | 'ui' | 'music' | 'ambience'
export const DF_MIX_CATS: readonly DfMixCat[] = ['zvocal', 'zfoley', 'weapon', 'remote', 'world', 'ui', 'music', 'ambience']

export interface DfMixBus {
    /** Bus gain: the mix level of the whole category. */
    gain: number
    /** Simultaneous voices in the category. */
    voices: number
    /** Spatial sounds farther than this never start. */
    maxDist: number
    /** Inverse-distance model of the panner. */
    ref: number
    rolloff: number
    /** Reverb send at 0 m (farther sounds get wetter). */
    wet: number
}

export const DF_MIX: Record<DfMixCat, DfMixBus> = {
    weapon: { gain: 1, voices: 14, maxDist: 70, ref: 2.5, rolloff: 1, wet: 0.1 },
    remote: { gain: 0.55, voices: 8, maxDist: 110, ref: 4, rolloff: 0.9, wet: 0.22 },
    zvocal: { gain: 0.5, voices: 3, maxDist: 36, ref: 2.5, rolloff: 1.35, wet: 0.16 },
    zfoley: { gain: 0.6, voices: 8, maxDist: 30, ref: 2, rolloff: 1.25, wet: 0.1 },
    world: { gain: 0.65, voices: 12, maxDist: 60, ref: 2.5, rolloff: 1, wet: 0.16 },
    ui: { gain: 0.5, voices: 8, maxDist: Infinity, ref: 1, rolloff: 1, wet: 0 },
    music: { gain: 0.6, voices: 3, maxDist: 60, ref: 5, rolloff: 0.8, wet: 0.1 },
    ambience: { gain: 0.7, voices: 4, maxDist: Infinity, ref: 1, rolloff: 1, wet: 0 }
}

/** Bus gain multipliers while ducked, and how long the duck holds / releases. */
export interface DfDuck {
    cats: Partial<Record<DfMixCat, number>>
    hold: number
    release: number
}

export const DF_DUCK_SHOT: DfDuck = { cats: { zvocal: 0.62, ambience: 0.55, zfoley: 0.85 }, hold: 0.05, release: 0.35 }
export const DF_DUCK_BOOM: DfDuck = { cats: { zvocal: 0.55, ambience: 0.45, zfoley: 0.75, remote: 0.8, world: 0.85 }, hold: 0.15, release: 0.9 }
export const DF_DUCK_STING: DfDuck = { cats: { ambience: 0.4, zvocal: 0.45, zfoley: 0.75, world: 0.85, remote: 0.85 }, hold: 1.8, release: 1.6 }
export const DF_DUCK_JINGLE: DfDuck = { cats: { ambience: 0.6, zvocal: 0.65, zfoley: 0.9 }, hold: 1.4, release: 1.2 }

export type DfVocalKind = 'groan' | 'attack' | 'death'

export interface DfSoundRule {
    cat: DfMixCat
    /** Importance when voices compete (multiplies the estimated loudness). */
    priority: number
    /** Minimum seconds between two starts of the same name. */
    interval: number
    /** Seconds a voice counts as live (its audible length). */
    dur: number
    vocal?: DfVocalKind
    duck?: DfDuck
}

type RuleRow = readonly [interval: number, dur: number, priority: number]

const ZFOLEY: Record<string, RuleRow> = {
    'df:flesh-hit': [0.045, 0.3, 1.2],
    'df:head-pop': [0.05, 0.7, 2],
    'df:gib': [0.08, 1, 1.8],
    'df:body-fall': [0.09, 0.7, 1],
    'df:helmet-clang': [0.05, 1, 1.6],
    'df:zombie-swipe': [0.08, 0.35, 1.8],
    'df:zombie-rise': [0.22, 1.5, 0.7],
    'df:zombie-spit': [0.25, 0.7, 1.8],
    'df:gas-hiss': [0.4, 1.5, 1],
    'df:zombie-climb': [0.25, 0.9, 1.2],
    'df:board-rip': [0.14, 0.8, 1.3],
    'df:brute-step': [0.07, 0.45, 1.1],
    'df:bloater-gurgle': [0.6, 1.4, 0.8]
}

const UI: Record<string, RuleRow> = {
    'df:hit': [0.035, 0.12, 2],
    'df:hit-head': [0.04, 0.35, 2.2],
    'df:kill': [0.045, 0.25, 2.2],
    'df:kill-head': [0.045, 0.45, 2.4],
    'df:points': [0.06, 0.3, 1],
    'df:buy': [0.15, 0.7, 2],
    'df:denied': [0.25, 0.4, 2],
    'df:heartbeat': [0.2, 0.5, 3],
    'df:breath': [1, 1.6, 1.5],
    'df:hurt': [0.12, 0.35, 2.5],
    'df:down': [0.5, 2, 3],
    'df:revive': [0.5, 2, 2.5],
    'df:revive-tick': [0.08, 0.1, 1],
    'df:jump': [0.1, 0.15, 1],
    'df:land': [0.1, 0.2, 1],
    'df:slide': [0.3, 0.7, 1],
    'df:throw': [0.12, 0.25, 1.5],
    'df:lunge': [0.12, 0.2, 1.5],
    'df:pu-spawn': [0.3, 0.6, 1.5],
    'df:pu-end': [0.3, 0.6, 1.5],
    // salvage, the workbench and killstreaks (arsenal-sounds.ts)
    'df:ars-reward': [0.3, 1.2, 2.6],
    'df:ars-callin': [0.3, 1.2, 2.2],
    'df:ars-challenge': [0.5, 0.8, 1.8],
    'df:ars-challenge-done': [0.5, 1.4, 2.4]
}

const MUSIC: Record<string, readonly [dur: number, duck: DfDuck]> = {
    'df:round-start': [6.5, DF_DUCK_STING],
    'df:round-end': [5, DF_DUCK_STING],
    'df:game-start': [4.5, DF_DUCK_STING],
    'df:egg-step': [3, DF_DUCK_STING],
    'df:box-jingle': [4.4, DF_DUCK_JINGLE],
    'df:rod-thunder': [3.5, DF_DUCK_BOOM]
}

const WORLD: Record<string, RuleRow> = {
    'df:gen-hum': [0.8, 2.2, 0.8],
    'df:zap': [0.09, 0.4, 1.2],
    'df:soul': [0.15, 1.4, 1.2],
    'df:box-roll': [0.5, 4.2, 1.5],
    'df:pap-work': [0.5, 3.6, 1.5],
    'df:perk-hum': [0.1, 1.8, 0.8],
    'df:board-slam': [0.06, 0.4, 1.4],
    'df:rod-lever': [0.1, 0.8, 1.6],
    'df:rod-crackle': [0.25, 1.4, 1.3],
    'df:rod-sputter': [0.2, 0.6, 1.2],
    // salvage, the workbench, crafted gear and killstreak support (arsenal-sounds.ts)
    'df:ars-scrap': [0.05, 0.3, 1.2],
    'df:ars-part': [0.1, 0.9, 1.6],
    'df:ars-craft': [0.3, 1.3, 1.6],
    'df:ars-deploy': [0.2, 0.6, 1.5],
    'df:ars-sentry-shot': [0.05, 0.22, 1.4],
    'df:ars-sentry-spent': [0.3, 1.2, 1.3],
    'df:ars-sentry-broken': [0.3, 1, 1.6],
    'df:ars-decoy-wind': [0.3, 1, 1.3],
    'df:ars-whistle': [0.04, 1.35, 2.2],
    'df:ars-zeppelin': [1, 9, 2],
    'df:ars-bomber': [1, 8, 2.2],
    'df:ars-carpet': [0.5, 3.2, 3]
}

/** Category, priority, retrigger interval and length of a sound, from its name. */
export function dfSoundRule(name: string, spatial: boolean): DfSoundRule {
    if (name.startsWith('df:groan:')) return { cat: 'zvocal', priority: 1, interval: 1.1, dur: 2, vocal: 'groan' }
    if (name.startsWith('df:attack:')) return { cat: 'zvocal', priority: 2.2, interval: 0.35, dur: 1, vocal: 'attack' }
    if (name.startsWith('df:death:')) return { cat: 'zvocal', priority: 1.6, interval: 0.2, dur: 1.6, vocal: 'death' }
    const zf = ZFOLEY[name]
    if (zf) return { cat: 'zfoley', interval: zf[0], dur: zf[1], priority: zf[2] }
    if (name.startsWith('w:')) {
        if (name.includes(':fire')) {
            return spatial
                ? { cat: 'remote', priority: 1.4, interval: 0.035, dur: 0.9 }
                : { cat: 'weapon', priority: 4, interval: 0.012, dur: 1, duck: DF_DUCK_SHOT }
        }
        if (name === 'w:explode') return { cat: 'weapon', priority: 3, interval: 0.06, dur: 2, duck: DF_DUCK_BOOM }
        if (name === 'w:casing') return { cat: 'weapon', priority: 0.5, interval: 0.05, dur: 0.15 }
        return { cat: 'weapon', priority: spatial ? 2 : 2.5, interval: 0.02, dur: spatial ? 0.6 : 0.4 }
    }
    if (name.startsWith('df:step-')) {
        return spatial
            ? { cat: 'world', priority: 0.8, interval: 0.07, dur: 0.15 }
            : { cat: 'ui', priority: 0.8, interval: 0.08, dur: 0.15 }
    }
    const ui = UI[name]
    if (ui) return { cat: 'ui', interval: ui[0], dur: ui[1], priority: ui[2] }
    if (name.startsWith('df:pu-')) return { cat: 'music', priority: 3, interval: 0.3, dur: 2.2, duck: DF_DUCK_JINGLE }
    if (name.startsWith('df:perk-jingle:')) return { cat: 'music', priority: 2.5, interval: 0.5, dur: 4.5, duck: DF_DUCK_JINGLE }
    const mu = MUSIC[name]
    if (mu) return { cat: 'music', priority: 3, interval: 0.5, dur: mu[0], duck: mu[1] }
    if (name === 'df:ambience') return { cat: 'ambience', priority: 0.5, interval: 2, dur: 5 }
    const w = WORLD[name]
    if (w) return { cat: 'world', interval: w[0], dur: w[1], priority: w[2] }
    if (name.startsWith('df:ars-waltz')) return { cat: 'world', priority: 1.5, interval: 0.3, dur: 1.3 }
    return { cat: 'world', priority: 1.5, interval: 0.05, dur: 1.5 }
}

/** Gain of the panner's inverse distance model at `dist`. */
export function dfDistanceGain(dist: number, ref: number, rolloff: number): number {
    const d = Math.max(dist, ref)
    return ref / (ref + rolloff * (d - ref))
}

/** Lowpass cutoff that stands in for air absorption and occlusion by distance. */
export function dfAirCutoff(dist: number): number {
    return Math.max(1400, Math.min(20000, 20000 * Math.exp(-dist / 26)))
}

/** Estimated level below which a sound is not worth starting (about -36 dB). */
export const DF_AUDIBLE = 0.016

export const DF_VOCAL = {
    /** Zombie vocals at once, across every zombie. */
    max: 3,
    /** Any two vocal starts are at least this far apart (s). */
    gap: [0.22, 0.45] as const,
    /** After an idle groan, the next groan waits this long (s). */
    groanGap: [1.5, 3.8] as const,
    /** After an attack or death cry, idle groans wait this long (s). */
    afterCry: [0.7, 1.5] as const,
    /** Attack snarls are spaced by this much (s). */
    attackGap: [0.45, 0.9] as const,
    /** Death cries are spaced by this much (s). */
    deathGap: [0.18, 0.4] as const
}

export interface DfMixRequest {
    name: string
    now: number
    spatial: boolean
    dist: number
    volume: number
}

export type DfDropReason = 'interval' | 'far' | 'quiet' | 'vocal-gap' | 'vocal-full' | 'full'

export type DfMixResult
    = | { ok: true, id: number, rule: DfSoundRule, est: number, steal: number[] }
        | { ok: false, reason: DfDropReason }

interface Slot {
    id: number
    name: string
    cat: DfMixCat
    start: number
    end: number
    score: number
    vocal: boolean
}

export interface DfMixStats {
    live: Record<DfMixCat, number>
    started: Record<DfMixCat, number>
    dropped: Record<DfDropReason, number>
    stolen: number
}

export interface DfMixer {
    request(r: DfMixRequest): DfMixResult
    /** A voice ended early (stolen, failed). */
    end(id: number): void
    /** Cap one name below its category cap (legacy setVoiceLimit). */
    setNameLimit(name: string, max: number): void
    live(now: number): Record<DfMixCat, number>
    stats(now: number): DfMixStats
    reset(): void
}

function zeroCats(): Record<DfMixCat, number> {
    return { zvocal: 0, zfoley: 0, weapon: 0, remote: 0, world: 0, ui: 0, music: 0, ambience: 0 }
}

/**
 * The voice policy: decides whether a sound may start and which live voices it
 * replaces. Pure (no WebAudio); time comes in with each request.
 */
export function createDfMixer(opts: { rng?: () => number, mix?: Record<DfMixCat, DfMixBus> } = {}): DfMixer {
    const rng = opts.rng ?? Math.random
    const mix = opts.mix ?? DF_MIX
    const range = (r: readonly [number, number]) => r[0] + rng() * (r[1] - r[0])
    const rules = new Map<string, DfSoundRule>()
    const nameLimits = new Map<string, number>()
    const lastStart = new Map<string, number>()
    let slots: Slot[] = []
    let nextId = 1
    let vocalGate = -Infinity
    let groanGate = -Infinity
    let attackGate = -Infinity
    let deathGate = -Infinity
    const started = zeroCats()
    const dropped: Record<DfDropReason, number> = { 'interval': 0, 'far': 0, 'quiet': 0, 'vocal-gap': 0, 'vocal-full': 0, 'full': 0 }
    let stolen = 0

    function rule(name: string, spatial: boolean): DfSoundRule {
        const key = spatial ? `@${name}` : name
        let r = rules.get(key)
        if (!r) {
            r = dfSoundRule(name, spatial)
            rules.set(key, r)
        }
        return r
    }

    function prune(now: number): void {
        if (slots.length === 0) return
        let w = 0
        for (const s of slots) if (s.end > now) slots[w++] = s
        slots.length = w
    }

    /** A live voice's weight right now: it fades as it plays out. */
    function weight(s: Slot, now: number): number {
        const left = Math.max(0, Math.min(1, (s.end - now) / Math.max(0.05, s.end - s.start)))
        return s.score * (0.3 + 0.7 * left)
    }

    /**
     * The weakest voice among those matching `pick`, if the new score beats it.
     * A voice that has played less than `minFrac` of its length (and at least
     * 50 ms) is never cut, so nothing stutters.
     */
    function victim(now: number, score: number, pick: (s: Slot) => boolean, taken: readonly number[], minFrac = 0): Slot | null {
        let worst: Slot | null = null
        let ws = Infinity
        for (const s of slots) {
            if (!pick(s) || taken.includes(s.id)) continue
            if (now - s.start < Math.max(0.05, minFrac * (s.end - s.start))) continue
            const w = weight(s, now)
            if (w < ws) {
                ws = w
                worst = s
            }
        }
        return worst && score > ws * 1.15 ? worst : null
    }

    function drop(reason: DfDropReason): DfMixResult {
        dropped[reason]++
        return { ok: false, reason }
    }

    return {
        request(r) {
            const { name, now } = r
            const rl = rule(name, r.spatial)
            const bus = mix[rl.cat]
            const last = lastStart.get(name)
            if (last !== undefined && now - last < rl.interval) return drop('interval')
            if (r.spatial && r.dist > bus.maxDist) return drop('far')
            const est = Math.max(0, r.volume) * bus.gain * (r.spatial ? dfDistanceGain(r.dist, bus.ref, bus.rolloff) : 1)
            if (est < DF_AUDIBLE) return drop('quiet')
            prune(now)
            const score = est * rl.priority
            const steal: number[] = []

            // Zombie vocals: spaced out globally, few at once, groans fill gaps only.
            if (rl.vocal) {
                if (now < vocalGate) return drop('vocal-gap')
                if (rl.vocal === 'groan' && now < groanGate) return drop('vocal-gap')
                if (rl.vocal === 'attack' && now < attackGate) return drop('vocal-gap')
                if (rl.vocal === 'death' && now < deathGate) return drop('vocal-gap')
                let n = 0
                for (const s of slots) if (s.vocal) n++
                if (n >= DF_VOCAL.max) {
                    if (rl.vocal === 'groan') return drop('vocal-full')
                    const v = victim(now, score, s => s.vocal, steal, 0.3)
                    if (!v) return drop('vocal-full')
                    steal.push(v.id)
                }
            }

            // Category cap: the weakest (quietest, farthest, most played-out) voice gives way.
            let inCat = 0
            for (const s of slots) if (s.cat === rl.cat && !steal.includes(s.id)) inCat++
            if (inCat >= bus.voices) {
                const v = victim(now, score, s => s.cat === rl.cat, steal)
                if (!v) return drop('full')
                steal.push(v.id)
            }

            // Per-name cap: the oldest voice of the same name gives way (rapid fire).
            const nameMax = nameLimits.get(name)
            if (nameMax !== undefined) {
                let oldest: Slot | null = null
                let same = 0
                for (const s of slots) {
                    if (s.name !== name || steal.includes(s.id)) continue
                    same++
                    if (!oldest || s.start < oldest.start) oldest = s
                }
                if (same >= nameMax && oldest) steal.push(oldest.id)
            }

            if (steal.length > 0) {
                stolen += steal.length
                slots = slots.filter(s => !steal.includes(s.id))
            }
            const id = nextId++
            slots.push({ id, name, cat: rl.cat, start: now, end: now + rl.dur, score, vocal: !!rl.vocal })
            lastStart.set(name, now)
            started[rl.cat]++
            if (rl.vocal) {
                vocalGate = now + range(DF_VOCAL.gap)
                if (rl.vocal === 'groan') {
                    groanGate = now + range(DF_VOCAL.groanGap)
                } else {
                    groanGate = Math.max(groanGate, now + range(DF_VOCAL.afterCry))
                    if (rl.vocal === 'attack') attackGate = now + range(DF_VOCAL.attackGap)
                    else deathGate = now + range(DF_VOCAL.deathGap)
                }
            }
            return { ok: true, id, rule: rl, est, steal }
        },
        end(id) {
            const i = slots.findIndex(s => s.id === id)
            if (i >= 0) slots.splice(i, 1)
        },
        setNameLimit(name, max) {
            nameLimits.set(name, Math.max(1, Math.floor(max)))
        },
        live(now) {
            prune(now)
            const out = zeroCats()
            for (const s of slots) out[s.cat]++
            return out
        },
        stats(now) {
            return { live: this.live(now), started: { ...started }, dropped: { ...dropped }, stolen }
        },
        reset() {
            slots = []
            lastStart.clear()
            vocalGate = groanGate = attackGate = deathGate = -Infinity
        }
    }
}

/** Merge a new duck into a bus's active one: the deeper depth wins, the hold extends. */
export function dfMergeDuck(active: { depth: number, until: number }, now: number, depth: number, hold: number): { depth: number, until: number } {
    const live = now < active.until
    return {
        depth: live ? Math.min(active.depth, depth) : depth,
        until: Math.max(live ? active.until : now, now + hold)
    }
}

// ---------------------------------------------------------------- WebAudio engine

type LoopSynth = (ctx: AudioContext, out: AudioNode) => () => void

/** A tension layer: a looping bed whose intensity follows the horde size. */
export type DfTensionSynth = (ctx: AudioContext, out: AudioNode) => { set(v: number): void, stop(): void }

interface Voice {
    id: number
    nodes: AudioNode[]
    input: GainNode
    release: number
    dead: boolean
}

interface Bus {
    dry: GainNode
    wet: GainNode
    duckDry: GainNode
    duckWet: GainNode
    duck: { depth: number, until: number }
}

export interface DfAudioEngine extends DfAudio {
    /** Create / resume the context. Call from a user gesture. */
    unlock(): void
    /** Settings volume 0..1 (perceptual taper applied here). */
    setVolume(v: number): void
    /** Settings effects volume 0..1: every bus but music (perceptual taper applied here). */
    setSfxVolume(v: number): void
    /** 0..1: lowpasses everything (downed / concussed). */
    setMuffle(amount: number): void
    /** Maximum simultaneous voices of one sound name. */
    setVoiceLimit(name: string, max: number): void
    /** The horde-tension bed (registered by the engine sounds). */
    setTensionSynth(synth: DfTensionSynth): void
    /** 0..1 how much pressure the horde puts on: drives the tension bed. */
    setTension(v: number): void
    updateListener(camera: THREE.Camera): void
    /** Live voice counts and drops (debug readout). */
    stats(): DfMixStats | null
    dispose(): void
}

const HRTF_DIST = 12

export function createDfAudio(): DfAudioEngine {
    let ctx: AudioContext | null = null
    let master: GainNode | null = null
    let muffle: BiquadFilterNode | null = null
    let reverbIn: GainNode | null = null
    let volume = 0.8
    let sfxVolume = 1
    let muffleAmount = 0
    let tension = 0
    let tensionSynth: DfTensionSynth | null = null
    let tensionBed: { set(v: number): void, stop(): void } | null = null
    const buses = new Map<DfMixCat, Bus>()
    const synths = new Map<string, DfSynth>()
    const mixer = createDfMixer()
    const voices = new Map<number, Voice>()
    const loops = new Map<string, () => void>()
    const pendingLoops = new Map<string, LoopSynth>()
    const listenerPos = new THREE.Vector3()
    const fwd = new THREE.Vector3()
    const up = new THREE.Vector3()
    let sweepAt = 0
    let debugTimer: ReturnType<typeof setInterval> | null = null

    const taper = (v: number) => v ** 1.5
    /** A bus's mix level with the effects volume (music has its own level). */
    const busGain = (cat: DfMixCat) => DF_MIX[cat].gain * (cat === 'music' ? 1 : taper(sfxVolume))

    function build(): void {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        const c = new AC({ latencyHint: 'interactive' })
        ctx = c
        // master chain: buses -> muffle -> glue comp -> limiter -> volume -> out
        muffle = c.createBiquadFilter()
        muffle.type = 'lowpass'
        muffle.frequency.value = 20000
        muffle.Q.value = 0.6
        const glue = c.createDynamicsCompressor()
        glue.threshold.value = -20
        glue.knee.value = 10
        glue.ratio.value = 3
        glue.attack.value = 0.006
        glue.release.value = 0.2
        const limiter = c.createDynamicsCompressor()
        limiter.threshold.value = -4
        limiter.knee.value = 0
        limiter.ratio.value = 20
        limiter.attack.value = 0.001
        limiter.release.value = 0.12
        master = c.createGain()
        master.gain.value = taper(volume)
        muffle.connect(glue)
        glue.connect(limiter)
        limiter.connect(master)
        master.connect(c.destination)

        // A dark stone-room tail shared by every voice through per-bus sends.
        reverbIn = c.createGain()
        const conv = c.createConvolver()
        conv.buffer = makeImpulse(c, 2.4, 3)
        const reverbOut = c.createGain()
        reverbOut.gain.value = 0.5
        const reverbHp = c.createBiquadFilter()
        reverbHp.type = 'highpass'
        reverbHp.frequency.value = 160
        reverbIn.connect(reverbHp)
        reverbHp.connect(conv)
        conv.connect(reverbOut)
        reverbOut.connect(muffle)

        for (const cat of DF_MIX_CATS) {
            const dry = c.createGain()
            dry.gain.value = busGain(cat)
            const wet = c.createGain()
            wet.gain.value = busGain(cat)
            const duckDry = c.createGain()
            const duckWet = c.createGain()
            dry.connect(duckDry)
            duckDry.connect(muffle)
            wet.connect(duckWet)
            duckWet.connect(reverbIn)
            buses.set(cat, { dry, wet, duckDry, duckWet, duck: { depth: 1, until: 0 } })
        }
        if (muffleAmount > 0) applyMuffle()
        if (import.meta.dev) exposeDebug()
    }

    function unlock(): void {
        if (!ctx) build()
        if (!ctx) return
        if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
        for (const [name, s] of pendingLoops) startLoop(name, s)
        pendingLoops.clear()
        startTension()
    }

    function startLoop(name: string, synth: LoopSynth): void {
        const bus = buses.get('ambience')
        if (!ctx || !bus) return
        try {
            loops.set(name, synth(ctx, bus.dry))
        } catch {
            // a broken ambience recipe must not take the game down
        }
    }

    function startTension(): void {
        const bus = buses.get('ambience')
        if (!ctx || !bus || !tensionSynth || tensionBed) return
        try {
            tensionBed = tensionSynth(ctx, bus.dry)
            tensionBed.set(tension)
        } catch {
            tensionBed = null
        }
    }

    function duck(d: { cats: Partial<Record<DfMixCat, number>>, hold: number, release: number }, now: number): void {
        for (const cat of DF_MIX_CATS) {
            const depth = d.cats[cat]
            const bus = buses.get(cat)
            if (depth === undefined || !bus) continue
            bus.duck = dfMergeDuck(bus.duck, now, depth, d.hold)
            for (const g of [bus.duckDry, bus.duckWet]) {
                const p = g.gain
                if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now)
                else {
                    p.cancelScheduledValues(now)
                    p.setValueAtTime(p.value, now)
                }
                p.setTargetAtTime(bus.duck.depth, now, 0.012)
                p.setTargetAtTime(1, bus.duck.until, d.release / 3)
            }
        }
    }

    function release(v: Voice): void {
        if (v.dead) return
        v.dead = true
        voices.delete(v.id)
        for (const n of v.nodes) {
            try {
                n.disconnect()
            } catch {
                // already gone
            }
        }
    }

    function fadeOut(id: number): void {
        const v = voices.get(id)
        if (!ctx || !v || v.dead) return
        const t = ctx.currentTime
        const p = v.input.gain
        p.cancelScheduledValues(t)
        p.setValueAtTime(p.value, t)
        p.linearRampToValueAtTime(0, t + 0.06)
        v.release = Math.min(v.release, t + 0.1)
    }

    function play(name: string, opts: DfSoundOpts = {}): void {
        if (!ctx || ctx.state !== 'running' || !reverbIn) return
        const synth = synths.get(name)
        if (!synth) return
        const now = ctx.currentTime
        let dist = 0
        const pos = opts.pos
        if (pos) {
            const dx = pos.x - listenerPos.x
            const dy = pos.y - listenerPos.y
            const dz = pos.z - listenerPos.z
            dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        }
        const volume = opts.volume ?? 1
        const res = mixer.request({ name, now, spatial: !!pos, dist, volume })
        if (!res.ok) return
        for (const id of res.steal) fadeOut(id)
        const busDef = DF_MIX[res.rule.cat]
        const bus = buses.get(res.rule.cat)
        if (!bus) return

        const input = ctx.createGain()
        input.gain.value = volume
        const nodes: AudioNode[] = [input]
        let tail: AudioNode = input
        if (pos) {
            const cutoff = dfAirCutoff(dist)
            if (cutoff < 19000) {
                const air = ctx.createBiquadFilter()
                air.type = 'lowpass'
                air.frequency.value = cutoff
                air.Q.value = 0.5
                tail.connect(air)
                tail = air
                nodes.push(air)
            }
            const panner = ctx.createPanner()
            panner.panningModel = dist < HRTF_DIST ? 'HRTF' : 'equalpower'
            panner.distanceModel = 'inverse'
            panner.refDistance = busDef.ref
            panner.rolloffFactor = busDef.rolloff
            panner.maxDistance = 10000
            setPannerPos(panner, pos)
            tail.connect(panner)
            tail = panner
            nodes.push(panner)
        }
        tail.connect(bus.dry)
        const wet = busDef.wet > 0 ? busDef.wet + (pos ? Math.min(0.45, dist / 70) : 0) : 0
        if (wet > 0) {
            const send = ctx.createGain()
            send.gain.value = wet
            tail.connect(send)
            send.connect(bus.wet)
            nodes.push(send)
        }
        const voice: Voice = { id: res.id, nodes, input, release: now + Math.max(4, res.rule.dur * 1.5 + 2), dead: false }
        voices.set(res.id, voice)
        if (res.rule.duck) duck(res.rule.duck, now)
        try {
            synth(ctx, input, opts)
        } catch {
            mixer.end(res.id)
            release(voice)
        }
    }

    function setPannerPos(p: PannerNode, pos: Vec3 | THREE.Vector3): void {
        if (p.positionX) {
            p.positionX.value = pos.x
            p.positionY.value = pos.y
            p.positionZ.value = pos.z
        } else {
            (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z)
        }
    }

    function applyMuffle(): void {
        if (!ctx || !muffle) return
        const f = 20000 * Math.pow(0.03, muffleAmount)
        muffle.frequency.setTargetAtTime(Math.max(380, f), ctx.currentTime, 0.12)
    }

    function exposeDebug(): void {
        const w = window as unknown as { __dfAudio?: unknown }
        w.__dfAudio = {
            stats: () => api.stats(),
            /** Log live voice counts every `seconds` (0 stops). */
            log(seconds = 1) {
                if (debugTimer) clearInterval(debugTimer)
                debugTimer = null
                if (seconds <= 0) return
                debugTimer = setInterval(() => {
                    const s = api.stats()
                    if (!s) return
                    const live = DF_MIX_CATS.map(c => `${c} ${s.live[c]}/${DF_MIX[c].voices}`).join('  ')
                    const drop = Object.entries(s.dropped).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(' ')
                    console.info(`[df-audio] ${live} | nodes ${voices.size} | dropped ${drop || '-'} | stolen ${s.stolen}`)
                }, seconds * 1000)
            }
        }
    }

    const api: DfAudioEngine = {
        get ctx() {
            return ctx
        },
        register(name, synth) {
            synths.set(name, synth)
        },
        play,
        loop(name, synth) {
            if (loops.has(name) || pendingLoops.has(name)) return
            if (!ctx) {
                pendingLoops.set(name, synth)
                return
            }
            startLoop(name, synth)
        },
        stopLoop(name) {
            pendingLoops.delete(name)
            const stop = loops.get(name)
            if (!stop) return
            loops.delete(name)
            try {
                stop()
            } catch {
                // ignore
            }
        },
        unlock,
        setVolume(v) {
            volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.8))
            if (ctx && master) master.gain.setTargetAtTime(taper(volume), ctx.currentTime, 0.05)
        },
        setSfxVolume(v) {
            sfxVolume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1))
            if (!ctx) return
            for (const [cat, bus] of buses) {
                bus.dry.gain.setTargetAtTime(busGain(cat), ctx.currentTime, 0.05)
                bus.wet.gain.setTargetAtTime(busGain(cat), ctx.currentTime, 0.05)
            }
        },
        setMuffle(amount) {
            const a = Math.max(0, Math.min(1, amount))
            if (Math.abs(a - muffleAmount) < 0.01) return
            muffleAmount = a
            applyMuffle()
        },
        setVoiceLimit(name, max) {
            mixer.setNameLimit(name, max)
        },
        setTensionSynth(synth) {
            tensionSynth = synth
            if (ctx) startTension()
        },
        setTension(v) {
            const t = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
            if (Math.abs(t - tension) < 0.01) return
            tension = t
            tensionBed?.set(t)
        },
        updateListener(camera) {
            camera.getWorldPosition(listenerPos)
            if (!ctx) return
            const l = ctx.listener
            camera.getWorldDirection(fwd)
            up.set(0, 1, 0).applyQuaternion(camera.quaternion)
            if (l.positionX) {
                const t = ctx.currentTime
                l.positionX.setTargetAtTime(listenerPos.x, t, 0.01)
                l.positionY.setTargetAtTime(listenerPos.y, t, 0.01)
                l.positionZ.setTargetAtTime(listenerPos.z, t, 0.01)
                l.forwardX.value = fwd.x
                l.forwardY.value = fwd.y
                l.forwardZ.value = fwd.z
                l.upX.value = up.x
                l.upY.value = up.y
                l.upZ.value = up.z
            } else {
                const legacy = l as unknown as { setPosition(x: number, y: number, z: number): void, setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }
                legacy.setPosition(listenerPos.x, listenerPos.y, listenerPos.z)
                legacy.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z)
            }
            // release finished voices a few times a second
            const now = ctx.currentTime
            if (now - sweepAt < 0.25) return
            sweepAt = now
            for (const v of [...voices.values()]) if (now > v.release) release(v)
        },
        stats() {
            return ctx ? mixer.stats(ctx.currentTime) : null
        },
        dispose() {
            for (const name of [...loops.keys()]) api.stopLoop(name)
            try {
                tensionBed?.stop()
            } catch {
                // ignore
            }
            tensionBed = null
            for (const v of [...voices.values()]) release(v)
            pendingLoops.clear()
            mixer.reset()
            if (debugTimer) clearInterval(debugTimer)
            debugTimer = null
            if (import.meta.dev) delete (window as unknown as { __dfAudio?: unknown }).__dfAudio
            if (ctx) void ctx.close().catch(() => {})
            ctx = null
            buses.clear()
        }
    }
    return api
}

/** A dark, slightly lowpassed stone-room tail with sparse early reflections. */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate
    const len = Math.floor(rate * seconds)
    const buf = ctx.createBuffer(2, len, rate)
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch)
        let lp = 0
        for (let i = 0; i < len; i++) {
            const t = i / len
            const n = Math.random() * 2 - 1
            // the tail darkens as it decays
            const k = 0.2 + 0.6 * (1 - t)
            lp += (n - lp) * k
            const pre = i < 96 ? i / 96 : 1
            d[i] = lp * Math.pow(1 - t, decay) * pre * 0.6
        }
        // early reflections off nearby walls
        for (let r = 0; r < 6; r++) {
            const at = Math.floor(rate * (0.011 + Math.random() * 0.06))
            if (at < len) d[at] = (d[at] ?? 0) + (Math.random() < 0.5 ? -1 : 1) * (0.32 - r * 0.04)
        }
    }
    return buf
}
