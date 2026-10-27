import type { DfPowerupKind } from '#shared/utils/dead-front/constants'
import type { DfEvent, DfPlayerLife } from '#shared/utils/dead-front/protocol'
import type { DfEggStep, DfPerkId, DfWeaponId } from '#shared/utils/dead-front/types'
import { dfArsenalFeedLine } from './arsenal-prompt'
import type { DfHudArsenal } from './arsenal-prompt'

// HUD state the engine writes (~20 Hz) and the Vue overlay renders. Fast
// per-frame values (crosshair spread, waypoint position, damage indicator
// rotation) go straight to CSS variables on the HUD root instead.

export interface DfHudPlayer {
    pid: number
    name: string
    color: string
    me: boolean
    points: number
    kills: number
    headshots: number
    downs: number
    revives: number
    life: DfPlayerLife
    connected: boolean
    ping: number | null
}

export interface DfHudPopup {
    id: number
    pid: number
    amount: number
    gold: boolean
    /** -1..1 horizontal jitter. */
    dx: number
    born: number
}

/**
 * A hit's points floating up off the zombie that paid them (own hits only). Slot i
 * is placed every frame through --df-hp{i}-x / --df-hp{i}-y (px) and --df-hp{i}-on
 * (1 in front of the camera, 0 behind) on the HUD root.
 */
export interface DfHudHitPop {
    id: number
    slot: number
    amount: number
    kind: 'hit' | 'kill' | 'head'
    gold: boolean
    /** -1..1 horizontal drift. */
    dx: number
    born: number
}

/** Hit pops on screen at once (the oldest is replaced). */
export const DF_HUD_HIT_POPS = 12

export interface DfHudPerk {
    id: DfPerkId
    name: string
    color: string
}

export interface DfHudPowerup {
    kind: DfPowerupKind
    name: string
    seconds: number
    ending: boolean
}

export interface DfHudDamage {
    id: number
    /** World-space angle (radians, yaw convention) the damage came from. */
    angle: number
    born: number
}

export interface DfHudState {
    round: number
    /** Bumps when the round changes (drives the transition). */
    roundKey: number
    phase: 'intermission' | 'active'
    phaseTimer: number
    zombiesLeft: number
    players: DfHudPlayer[]
    popups: DfHudPopup[]
    hitPops: DfHudHitPop[]
    ammo: {
        weapon: DfWeaponId | null
        name: string
        mag: number
        magSize: number
        reserve: number
        pap: number
        reloading: boolean
        infinite: boolean
        /** Rarity tier 0..3 (rarity.ts): the name shows in its colour. */
        rarity?: number
    }
    grenades: number
    perks: DfHudPerk[]
    health: number // 0..1
    life: DfPlayerLife
    bleedout: number
    bleedoutMax: number
    beingRevived: number // 0..1
    selfRevives: number
    reviving: { name: string, progress: number } | null
    powerups: DfHudPowerup[]
    announce: { key: number, title: string, sub: string, tone: 'gold' | 'red' | 'pale' } | null
    prompt: { text: string, sub: string, cost: number | null, ok: boolean, denyKey: number, hold: number, /** Colour of the text (a rarity's). */ tint?: string | null } | null
    objective: {
        visible: boolean
        step: DfEggStep
        text: string
        fuses: string | null
        charge: number | null
        /** "x/3" lightning rods thrown during the `rods` step, else null. */
        rods?: string | null
        /** Seconds left on the rod clock once the first rod is thrown, else null. */
        rodTimer?: number | null
        label: string
        distance: number
        hasTarget: boolean
    }
    hitmarker: { key: number, kind: 'hit' | 'kill' | 'head' }
    killKey: number
    damage: DfHudDamage[]
    scoreboard: boolean
    ping: number
    connection: 'ok' | 'reconnecting' | 'lost'
    locked: boolean
    started: boolean
    spectating: string | null
    chat: { id: number, name: string, text: string, born: number }[]
    stamina: number // 0..1
    ads: boolean
    sprinting: boolean
    lowAmmo: boolean
    gameOver: boolean
    /** The most recently bought perk; `key` bumps on every purchase (drives the bottle pop-in). */
    perkPulse: { id: DfPerkId | null, key: number }
    /** Bumps whenever the held weapon changes (swap, buy, box, Pack-a-Punch): drives the name plate. */
    swapKey: number
    /** Squad event feed (top right): downs, revives, doors, power. Filled by the game view from snapshot events. */
    feed: DfHudFeedItem[]
    /**
     * First-match coaching line (`hints.ts`): "Hold F at a broken window to rebuild it" plus
     * a sub line. One at a time; `key` bumps per hint. The text starts with "Hold/Press X" like
     * a prompt, so the same keycap parsing applies. Null when there's nothing to teach.
     */
    hint: { key: number, text: string, sub: string } | null
    /** Short line under the crosshair about the magazine: 'Press R to reload', 'Low ammo', 'No ammo' (null: nothing). */
    ammoHint: string | null
    /** Zombies left when the round is down to its last few (1-3) and nothing more spawns; 0 otherwise. */
    lastZombies: number
    /**
     * Off-screen-aware markers (up to DF_HUD_MARKERS): the last zombies of a round and downed
     * teammates. Marker i is positioned every frame through CSS variables on the HUD root:
     * --df-mk{i}-x / --df-mk{i}-y (px), --df-mk{i}-on (1 on screen, 0 clamped to the edge) and
     * --df-mk{i}-ang (radians toward it when clamped), like the objective waypoint.
     */
    markers: DfHudMarker[]
    /** Salvage, crafted gear, the workbench list, killstreaks and the round challenge (arsenal.ts). */
    arsenal: DfHudArsenal
}

export const DF_HUD_MARKERS = 4

export interface DfHudMarker {
    /** Stable per subject ('z12', 'p3') for v-for keys. */
    key: string
    kind: 'zombie' | 'revive'
    /** Teammate name for revive markers, '' for zombies. */
    label: string
    /** Metres away (rounded). */
    distance: number
}

export type DfHudFeedTone = 'red' | 'green' | 'gold' | 'blue' | 'pale'

export interface DfHudFeedItem {
    id: number
    /** performance.now() when it arrived; the view fades it out. */
    born: number
    tone: DfHudFeedTone
    /** The soldier who did it (null for squad-wide events like the power). */
    who: string | null
    whoColor: string | null
    text: string
    /** Optional second name, e.g. the revived soldier. */
    target: string | null
    targetColor: string | null
    /** Colour of the text itself (a weapon's rarity), else the tone's. */
    textColor?: string | null
}

export type DfHudFeedLine = Omit<DfHudFeedItem, 'id' | 'born'>

export interface DfHudFeedContext {
    /** Your pid: you read as "You". */
    me: number
    name(pid: number): string
    color(pid: number): string
    doorLabel(id: string): string | null
    /** "Churchyard Passage" for a trap id. */
    trapLabel?(id: string): string | null
    weaponName(id: string): string
    powerupName(kind: DfPowerupKind): string
}

export const DF_HUD_FEED_MAX = 5
export const DF_HUD_FEED_MS = 6000

/** The feed line for one snapshot event, or null when the event isn't feed-worthy. Pure. */
export function dfHudFeedLine(ev: DfEvent, c: DfHudFeedContext): DfHudFeedLine | null {
    const who = (pid: number) => (pid === c.me ? 'You' : c.name(pid))
    const line = (tone: DfHudFeedTone, pid: number | null, text: string, target: number | null = null): DfHudFeedLine => ({
        tone,
        who: pid === null ? null : who(pid),
        whoColor: pid === null ? null : c.color(pid),
        text,
        target: target === null ? null : who(target),
        targetColor: target === null ? null : c.color(target)
    })
    switch (ev.k) {
        case 'down':
            return line('red', ev.p, ev.p === c.me ? 'are down' : 'is down')
        case 'revived':
            return ev.by === ev.p ? line('green', ev.p, 'got back up') : line('green', ev.by, 'revived', ev.p)
        case 'bleedout':
            return line('red', ev.p, 'bled out')
        case 'respawn':
            return line('pale', ev.p, ev.p === c.me ? 'are back on the line' : 'is back on the line')
        case 'power':
            return line('blue', null, 'The power is on')
        case 'fuse':
            return line('blue', ev.p, 'found a Tesla fuse')
        case 'rod':
            // a reset sends one event per rod, counting down: one line for the last
            if (!ev.on) return (ev.n ?? 0) === 0 ? line('red', null, 'The rods lost their charge') : null
            return line('blue', null, ev.n !== undefined ? `Lightning rod thrown (${ev.n}/3)` : 'Lightning rod thrown')
        case 'pap':
            return line('gold', ev.p, `packed the ${c.weaponName(ev.weapon)}`)
        case 'box':
            return ev.what === 'move' ? line('pale', null, 'The mystery box moved') : null
        case 'papReturn':
            // only the owner hears about it: the offer ran out and the machine handed the weapon back
            return ev.p === c.me ? line('gold', null, `Pack-a-Punch returned your ${c.weaponName(ev.weapon)}`) : null
        case 'powerup':
            return line('gold', ev.p, `grabbed ${c.powerupName(ev.kind)}`)
        case 'buy': {
            if (ev.what.startsWith('door:')) {
                const label = c.doorLabel(ev.what.slice(5))
                return line('pale', ev.p, label ? `opened the ${label}` : 'opened a door')
            }
            if (ev.what.startsWith('trap:')) {
                const label = c.trapLabel?.(ev.what.slice(5))
                return line('pale', ev.p, label ? `threw the ${label} trap` : 'threw an electric trap')
            }
            if (ev.what === 'weapon:wunder') return line('gold', ev.p, 'claimed the wonder weapon')
            return null
        }
        default:
            return dfArsenalFeedLine(ev, { me: c.me, line, weaponName: c.weaponName })
    }
}

let feedId = 0

/** Pushes a line onto the feed, dropping expired and overflowing entries. */
export function dfHudPushFeed(feed: DfHudFeedItem[], line: DfHudFeedLine, now: number): void {
    dfHudPruneFeed(feed, now)
    feed.push({ ...line, id: ++feedId, born: now })
    while (feed.length > DF_HUD_FEED_MAX) feed.shift()
}

/** Drops entries older than DF_HUD_FEED_MS. */
export function dfHudPruneFeed(feed: DfHudFeedItem[], now: number): void {
    while (feed.length && now - feed[0]!.born > DF_HUD_FEED_MS) feed.shift()
}

export function dfNewHudArsenal(): DfHudArsenal {
    return {
        scrap: 0, parts: 0, launcher: 0, equip: null, kit: false, streak: 0,
        next: { name: '', at: 15, from: 0 }, rewards: [], bench: null, challenge: null, salvageKey: 0, targeting: null
    }
}

export function dfCreateHudState(): DfHudState {
    return {
        round: 0,
        roundKey: 0,
        phase: 'intermission',
        phaseTimer: 0,
        zombiesLeft: 0,
        players: [],
        popups: [],
        hitPops: [],
        ammo: { weapon: null, name: '', mag: 0, magSize: 0, reserve: 0, pap: 0, reloading: false, infinite: false },
        grenades: 0,
        perks: [],
        health: 1,
        life: 'alive',
        bleedout: 0,
        bleedoutMax: 30,
        beingRevived: 0,
        selfRevives: 0,
        reviving: null,
        powerups: [],
        announce: null,
        prompt: null,
        objective: { visible: false, step: 'power', text: '', fuses: null, charge: null, rods: null, rodTimer: null, label: '', distance: 0, hasTarget: false },
        hitmarker: { key: 0, kind: 'hit' },
        killKey: 0,
        damage: [],
        scoreboard: false,
        ping: 0,
        connection: 'ok',
        locked: false,
        started: false,
        spectating: null,
        chat: [],
        stamina: 1,
        ads: false,
        sprinting: false,
        lowAmmo: false,
        gameOver: false,
        perkPulse: { id: null, key: 0 },
        swapKey: 0,
        feed: [],
        hint: null,
        ammoHint: null,
        lastZombies: 0,
        markers: [],
        arsenal: dfNewHudArsenal()
    }
}
