import type { DfPowerupKind } from './constants'
import type {
    DfAttachmentChoice, DfEggStep, DfEnemyType, DfHitZone, DfPerkId,
    DfProgressReport, DfWeaponId, Vec3
} from './types'

// Dead Front socket protocol. One socket per tab at /api/dead-front/ws carries
// both the lobby and the match. JSON text frames. Owned by the server agent
// after kickoff; changes must stay additive so the client keeps compiling.

// ---------------------------------------------------------------- lobby

export interface DfLobbyMember {
    userId: string
    name: string
    ready: boolean
    host: boolean
}

export interface DfLobbySummary {
    id: string
    hostName: string
    players: number
    maxPlayers: number
    state: 'lobby' | 'playing'
    round: number
}

export interface DfLobbyState {
    id: string
    members: DfLobbyMember[]
    state: 'lobby' | 'playing'
}

// ---------------------------------------------------------------- match state

/** Bit flags on DfPlayerSnap.flags and in the client input message. */
export const DF_FLAG = {
    crouch: 1,
    sprint: 2,
    ads: 4,
    grounded: 8,
    reloading: 16,
    firing: 32,
    reviving: 64,
    meleeing: 128
} as const

export interface DfHeldWeapon {
    id: DfWeaponId
    pap: number // 0..3
    mag: number
    reserve: number
    attachments: DfAttachmentChoice
    /** Most reserve ammo this player can carry for it (perks included); the wall's "Ammo full" check. */
    maxReserve?: number
}

export type DfPlayerLife = 'alive' | 'down' | 'dead'

export interface DfPlayerSnap {
    /** Small per-match index, stable for the match. */
    pid: number
    userId: string
    name: string
    pos: Vec3 // feet position
    yaw: number
    pitch: number
    flags: number
    life: DfPlayerLife
    health: number
    maxHealth: number
    points: number
    kills: number
    headshots: number
    downs: number
    revives: number
    perks: DfPerkId[]
    weapons: DfHeldWeapon[] // max 2 (3rd slot reserved for the wunderweapon)
    slot: number
    grenades: number
    bleedout: number // seconds left while downed
    reviveProgress: number // 0..1 while being revived
    selfRevives: number
    connected: boolean
    /**
     * Bumped whenever the server moves this player itself (spawn, respawn,
     * revive, a rejected or wall-clipped move). When it changes, the owning
     * client snaps its predicted position to `pos`.
     */
    tp?: number
    /** Seconds left on a server-side reload / weapon swap (0 when idle). */
    busy?: number
    /** Solo: Second Wind bottles bought so far (the machine sells out at `DF_SOLO_SECONDWIND_MAX`). */
    windBuys?: number
}

/** Zombie animation states, drive the client's procedural animation. */
export type DfZombieAnim = 'rise' | 'walk' | 'run' | 'sprint' | 'attack' | 'tear' | 'climb' | 'spit' | 'stagger'

export interface DfZombieSnap {
    id: number
    type: DfEnemyType
    pos: Vec3
    yaw: number
    hp: number // 0..1 fraction
    anim: DfZombieAnim
    /** Brute helmet still on. */
    armored?: boolean
    /** Set by the insta-kill / wunderweapon / pap glow cues. */
    shocked?: boolean
    /**
     * A special attack is winding up (the telegraph to read and dodge):
     * a ghoul crouching to leap, a brute roaring before its charge. The anim
     * is `attack` meanwhile, then `sprint` for the dash itself.
     */
    tell?: 'lunge' | 'charge'
}

export type DfProjectileKind = 'grenade' | 'pap-grenade' | 'xray-bolt' | 'spit'

export interface DfProjectileSnap {
    id: number
    kind: DfProjectileKind
    pos: Vec3
    vel: Vec3
    tier: number
}

export interface DfPowerupSnap {
    id: number
    kind: DfPowerupKind
    pos: Vec3
    expiresIn: number // seconds
}

export interface DfBoxState {
    spot: number // index into map.boxSpots
    state: 'idle' | 'rolling' | 'ready' | 'moving'
    weapon?: DfWeaponId // cycling / offered weapon
    owner?: number // pid
    timer: number // seconds left in the current state
}

export interface DfPapState {
    state: 'idle' | 'working' | 'ready'
    owner?: number
    weapon?: DfWeaponId
    tier?: number
    timer: number
}

export interface DfEggState {
    step: DfEggStep
    fusesFound: string[] // ids from map.egg.fuses collected so far
    charge: number // kills fed during `charge`
    chargeNeeded: number
    claimedBy?: number
}

export interface DfWorldSnap {
    doors: string[] // opened door ids
    planks: Record<string, number> // barricade id -> boards in place
    power: boolean
    box: DfBoxState
    pap: DfPapState
    egg: DfEggState
    /** Active powerups and seconds remaining. */
    double: number
    insta: number
}

export type DfEvent =
    | { k: 'hit', z: number, p: number, zone: DfHitZone, pos: Vec3, dmg: number }
    | { k: 'kill', z: number, p: number, zone: DfHitZone, weapon: DfWeaponId | 'knife' | 'grenade' | 'arc', pos: Vec3, gib?: boolean }
    | { k: 'points', p: number, amount: number }
    | { k: 'zhit', z: number, p: number, dmg: number } // zombie hit a player
    | { k: 'shot', p: number, weapon: DfWeaponId, pap: number, from: Vec3, to: Vec3 } // remote players' shots, for tracers and sound
    | { k: 'explode', pos: Vec3, radius: number, kind: 'grenade' | 'pap-grenade' | 'xray' | 'bloater' | 'nuke' | 'shock' }
    | { k: 'arc', from: Vec3, to: Vec3[] } // wunderweapon chain
    | { k: 'gas', pos: Vec3, radius: number, seconds: number } // bloater death cloud
    | { k: 'plank', b: string, delta: 1 | -1 }
    | { k: 'door', id: string }
    | { k: 'buy', p: number, what: string }
    | { k: 'perk', p: number, perk: DfPerkId }
    | { k: 'pap', p: number, weapon: DfWeaponId, tier: number }
    | { k: 'power' }
    | { k: 'powerup', p: number, kind: DfPowerupKind }
    | { k: 'down', p: number }
    | { k: 'revived', p: number, by: number }
    | { k: 'bleedout', p: number }
    | { k: 'respawn', p: number }
    | { k: 'round', round: number } // a round starts
    | { k: 'roundEnd', round: number }
    | { k: 'egg', step: DfEggStep }
    | { k: 'fuse', id: string, p: number }
    | { k: 'soul', from: Vec3 } // a kill fed the generator
    | { k: 'box', what: 'open' | 'move' | 'take' }
    | { k: 'chat', name: string, text: string }

export interface DfSnapshot {
    tick: number
    time: number // server seconds since match start
    round: number
    phase: 'intermission' | 'active'
    phaseTimer: number // seconds left in intermission
    zombiesLeft: number // zombies still to kill this round (alive + to spawn)
    players: DfPlayerSnap[]
    zombies: DfZombieSnap[]
    projectiles: DfProjectileSnap[]
    powerups: DfPowerupSnap[]
    world: DfWorldSnap
    events: DfEvent[]
    /** Last input seq the server applied for the receiving player. */
    ack: number
}

export interface DfMatchStart {
    matchId: string
    you: number // your pid
    mapId: string
}

export interface DfEndPlayer {
    pid: number
    name: string
    kills: number
    headshots: number
    points: number
    downs: number
    revives: number
}

export interface DfMatchEnd {
    round: number // the round the squad fell on
    players: DfEndPlayer[]
    progress: DfProgressReport | null // for the receiving player
}

// ---------------------------------------------------------------- messages

export interface DfShotHit {
    z: number // zombie id
    zone: DfHitZone
    dist: number
}

export type DfClientMsg =
    | { t: 'lobbies' }
    | { t: 'create' }
    | { t: 'join', id: string }
    | { t: 'leave' }
    | { t: 'ready', ready: boolean }
    | { t: 'start' } // host only; everyone needs to be ready
    | { t: 'chat', text: string }
    /** 20 Hz movement report. The server clamps speed and collides against the map. */
    | { t: 'in', seq: number, pos: Vec3, yaw: number, pitch: number, flags: number }
    /**
     * One trigger pull. `dir` is per pellet for shotguns. Hits are claimed by
     * the client (shared hit test) and validated by the server against its own
     * zombie positions, fire rate and ammo. Projectile weapons send no hits.
     */
    | { t: 'fire', origin: Vec3, dirs: Vec3[], hits: DfShotHit[] }
    | { t: 'reload' }
    | { t: 'swap', slot: number }
    | { t: 'melee', z?: number, zone?: DfHitZone }
    | { t: 'grenade', origin: Vec3, dir: Vec3 }
    /** Interact with a map interactable id (door, wall-buy, perk, box, pap, power, fuse, generator, pedestal, barricade). */
    | { t: 'use', id: string }
    /** Hold-to-revive the teammate with this pid; null stops. */
    | { t: 'revive', pid: number | null }
    | { t: 'ping', at: number }
    /** Development-only test hooks (ignored by production builds). */
    | { t: 'dev', op: DfDevOp }

/** Development-only test hooks, see `DfMatchSim.dev`. The server drops them outside `import.meta.dev`. */
export type DfDevOp
    = | { k: 'tp', pos: Vec3 }
        | { k: 'points', amount: number }
        | { k: 'heal' }
        | { k: 'down' }
        | { k: 'round', round: number }
        | { k: 'clear' }
        | { k: 'hold', on: boolean }
        | { k: 'god', on: boolean }

export type DfServerMsg =
    | { t: 'hello', userId: string, name: string }
    | { t: 'lobbies', lobbies: DfLobbySummary[] }
    | { t: 'lobby', lobby: DfLobbyState | null }
    | { t: 'start', start: DfMatchStart }
    | { t: 'snap', s: DfSnapshot }
    | { t: 'end', end: DfMatchEnd }
    | { t: 'error', message: string }
    | { t: 'pong', at: number }
    /** Lobby chat (outside a match; in-match chat arrives as a `chat` event in the snapshot). */
    | { t: 'chat', name: string, text: string }
