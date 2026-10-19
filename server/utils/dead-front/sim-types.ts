import type { DfBarricade } from '#shared/utils/dead-front/map'
import type { DfPlayerLife, DfProjectileKind, DfZombieAnim } from '#shared/utils/dead-front/protocol'
import type { DfPowerupKind } from '#shared/utils/dead-front/constants'
import type { DfEnemyDef } from '#shared/utils/dead-front/enemies'
import type { DfWeaponStats } from '#shared/utils/dead-front/weapons'
import type {
    DfAttachmentChoice, DfEnemyType, DfPerkId, DfPlayerEffects, DfWeaponId, Vec3
} from '#shared/utils/dead-front/types'

// Internal state of the match simulation (server only).

/** What the match layer hands the simulation for each player (resolved from their profile). */
export interface DfPlayerSetup {
    userId: string
    name: string
    /** Validated start weapon (unlocked and startable). */
    startWeapon: DfWeaponId
    /** Sanitised attachments per weapon. */
    attachments: Partial<Record<DfWeaponId, DfAttachmentChoice>>
    /** Selected research modifiers per perk. */
    perkMods: Partial<Record<DfPerkId, string[]>>
}

export interface SimWeapon {
    id: DfWeaponId
    pap: number
    mag: number
    reserve: number
    attachments: DfAttachmentChoice
    stats: DfWeaponStats
    /** In the Pack-a-Punch: the slot stays reserved (indices never shift) until the upgrade comes back. */
    away?: boolean
}

export interface SimReload {
    slot: number
    /** Magazine reloads complete at `until`; per-round reloads load a round every `per` seconds from `next`. */
    perRound: boolean
    until: number
    next: number
    per: number
}

export interface SimPlayer {
    pid: number
    setup: DfPlayerSetup
    pos: Vec3
    yaw: number
    pitch: number
    flags: number
    seq: number
    life: DfPlayerLife
    health: number
    points: number
    kills: number
    headshots: number
    downs: number
    revives: number
    perks: DfPerkId[]
    effects: DfPlayerEffects
    weapons: SimWeapon[]
    /** Weapons held before last stand handed out a pistol; restored on revive. */
    savedWeapons: SimWeapon[] | null
    savedSlot: number
    slot: number
    grenades: number
    bleedout: number
    reviveProgress: number
    /** pid this player is holding revive on, or -1. */
    reviving: number
    selfRevivesLeft: number
    selfReviveAt: number
    connected: boolean
    tp: number
    // timers (sim seconds)
    lastDamageAt: number
    /** Zombies can't hurt the player before this (a breather after a revive or respawn). */
    invulnUntil: number
    reload: SimReload | null
    swapUntil: number
    meleeReadyAt: number
    grenadeReadyAt: number
    repairReadyAt: number
    useCooldown: Map<string, number>
    deathWishRound: number
    plankPoints: number
    secondwindBuys: number
    // anti-cheat (wall clock seconds)
    lastInputAt: number
    /** The client's reported round trip, seconds (0 until it reports one). */
    rtt: number
    /** Reconnected and no movement report yet (the game view is still loading): not a stall. */
    awaitingInput?: boolean
    /** When their last stall ended (wall clock): the lag shield doesn't cover stalls back to back. */
    lastStallEnd?: number
    moveBudget: number
    fireTokens: number
    fireTokensAt: number
    // result
    weaponKills: Partial<Record<DfWeaponId, number>>
    weaponsFound: Set<DfWeaponId>
    completedEgg: boolean
}

export type SimZombieState = 'rise' | 'approach' | 'tear' | 'climb' | 'hunt' | 'attack' | 'spit' | 'stagger' | 'lunge' | 'charge'

/** A committed straight-line dash: the ghoul's leap or the brute's charge. */
export interface SimDash {
    dir: Vec3
    speed: number
    until: number
    /** Already connected with a player (one hit per dash). */
    hit: boolean
}

export interface SimZombie {
    id: number
    type: DfEnemyType
    def: DfEnemyDef
    pos: Vec3
    vy: number
    yaw: number
    hp: number
    maxHp: number
    helmet: number
    gait: 'walk' | 'run' | 'sprint'
    speed: number
    /** Speed this tick, for the shot tolerance. */
    curSpeed: number
    state: SimZombieState
    /** State to return to after an attack / stagger. */
    resume: SimZombieState
    anim: DfZombieAnim
    timer: number
    barricade: DfBarricade | null
    climbFrom: Vec3 | null
    climbTo: Vec3 | null
    inside: boolean
    target: number
    goal: Vec3 | null
    goalIsNode: boolean
    repathAt: number
    attackReadyAt: number
    attackTarget: number
    /** The swing's windup is over and it waits out the target's lag before it lands. */
    swingPending?: boolean
    spitReadyAt: number
    stuckCheckAt: number
    stuckRef: Vec3
    stuckTime: number
    unreachableTime: number
    detourUntil: number
    detour: Vec3 | null
    shockedUntil: number
    /** Direction the zombie is walking (radians, same convention as yaw); eased so paths curve instead of snapping. */
    heading: number
    /** Angle (radians) it swings around its target on the final approach, so a crowd fans out; 0 = straight in. */
    flank: number
    /** Side point for the flanking approach, refreshed with each plan. */
    flankGoal: Vec3 | null
    lungeReadyAt: number
    chargeReadyAt: number
    dash: SimDash | null
    /** Velocity over the last tick (m/s), sent for client dead-reckoning. */
    vel: Vec3
    /**
     * Height the snapshot shows: follows `pos.y` up and down stair steps as a
     * ramp instead of the physics' instant step-up, so zombies don't hop.
     */
    viewY: number
    /** Legs blown off: crawls slowly, can't leap or charge (specials.ts). */
    crawl?: boolean
    /** A gas-masked ghoul of a gas round. */
    masked?: boolean
}

/** A weapon sitting in the Pack-a-Punch: whose it is, the slot it keeps reserved, and what comes back. */
export interface SimPapJob {
    owner: number
    placeholder: SimWeapon
    id: DfWeaponId
    tier: number
}

export interface SimProjectile {
    id: number
    kind: DfProjectileKind
    pos: Vec3
    vel: Vec3
    tier: number
    owner: number // pid, or -1 for a zombie's spit
    weapon: DfWeaponId | null
    life: number
    resting: boolean
    gravity: number
    directDamage: number
    splashRadius: number
    splashDamage: number
}

export interface SimPowerup {
    id: number
    kind: DfPowerupKind
    pos: Vec3
    expiresAt: number
}

export interface SimGas {
    pos: Vec3
    radius: number
    until: number
}
