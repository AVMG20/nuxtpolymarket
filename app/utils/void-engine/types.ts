import type { Container, Graphics } from 'pixi.js'
import type {
    VoidDerivedStats, VoidEnemyDefinition, VoidResourceBundle, VoidResourceId,
    VoidRockDefinition, VoidTurretRuntime, VoidSpecialId, VoidSpecialStacks
} from '#shared/utils/gamelogic/void'
import type { VoidSoundEvent } from '~/utils/void-sounds'

// ─── Public API ─────────────────────────────────────────────────────────────

export interface VoidLaunchConfig {
    sector: number
    stats: VoidDerivedStats
    shipId: string
    turrets: VoidTurretRuntime[]
    power: number
}

export interface VoidRunResult {
    reason: 'extracted' | 'destroyed' | 'timeout' | 'cancelled'
    extracted: boolean
    haul: VoidResourceBundle
    units: number
    /** Market value of the hold at the moment the run ended, for the summary. */
    haulValue: number
    kills: number
    rocksMined: number
    shotsFired: number
    elapsedMs: number
    killsByType: { id: string, name: string, count: number }[]
    deepestStormDamage: number
    bossesKilled: number
}

/** One surveyed deposit, as the control deck sees it. */
export interface VoidHudDeposit {
    id: number
    name: string
    /** CSS hex of the ore's glow, so the deck and the canvas use one palette. */
    hex: string
    /** Rocks still standing on the site. */
    remaining: number
    /** Straight-line distance from the ship, in world units. */
    distance: number
    /** True while the ship is inside the survey ring. */
    inside: boolean
}

export interface VoidHudCargo {
    units: number
    capacity: number
    bundle: VoidResourceBundle
    /** What the hold is worth at market rates — the run's real score. */
    value: number
}

export interface VoidGameCallbacks {
    onHullChange: (hull: number, maxHull: number, shield: number, maxShield: number) => void
    onCargoChange: (cargo: VoidHudCargo) => void
    /** `threat` is the current per-minute difficulty multiplier, shown in the HUD. */
    onTimeChange: (elapsedMs: number, stormPhase: number, threat: number) => void
    onMiningProgress: (progress: number, label: string | null) => void
    /** Throttled — the deck only needs the survey a couple of times a second. */
    onSurveyChange?: (deposits: VoidHudDeposit[]) => void
    onExtractProgress: (progress: number, inRange: boolean) => void
    onBoostChange: (chargeMs: number, capacityMs: number) => void
    onRunEnd: (result: VoidRunResult) => void
    onNotice?: (text: string, kind: 'good' | 'bad' | 'info') => void
    onBossSpawn?: (name: string) => void
    onStormPhase?: (phase: 'closing' | 'engulfed') => void
    /** Fired at every sound-worthy moment; the composable routes it to playback. */
    onSfx?: (event: VoidSoundEvent) => void
}

// ─── Internal runtime ───────────────────────────────────────────────────────

export interface Particle {
    gfx: Graphics
    x: number
    y: number
    vx: number
    vy: number
    life: number
    maxLife: number
    drag: number
    spin: number
    scaleDecay: number
}

export interface Bullet {
    gfx: Container
    x: number
    y: number
    vx: number
    vy: number
    life: number
    damage: number
    /** Remaining targets it can punch through before it dies. */
    pierce: number
    splash: number
    lifesteal: number
    homing: number
    hostile: boolean
    color: number
    rocket: boolean
    chain: boolean
    hitIds: Set<number>
    targetId: number | null
}

export interface RockEntity {
    id: number
    def: VoidRockDefinition
    root: Container
    body: Graphics
    x: number
    y: number
    radius: number
    rotation: number
    spin: number
    /** 0..1 of the way through being cut. */
    progress: number
    breakGraceMs: number
    depleted: boolean
    respawnMs: number
    /**
     * The cluster or deposit this rock belongs to. A depleted rock reseeds near
     * its own site rather than anywhere in the sector, so a rich deposit stays a
     * rich deposit and a cleared one stays cleared for a while.
     */
    siteId: number
    siteX: number
    siteY: number
    siteRadius: number
    respawnDelayMs: number
}

/**
 * A surveyed rich deposit. Everything expensive in the sector is inside one of
 * these, all of them are a long flight out, and each has ships sitting on it
 * that wake up the moment you put a beam on the ore.
 */
export interface DepositSite {
    id: number
    x: number
    y: number
    radius: number
    def: VoidRockDefinition
    marker: Container
    /** Flips the first time the player enters the ring — drives the one-off warning. */
    discovered: boolean
    /** Counts down only while the player is inside, then jumps another wing in. */
    reinforceMs: number
    /**
     * Whether anything anchored to this site is still alive. Tracked frame to
     * frame so the moment the last guard dies can be spotted and the reinforce
     * timer restarted from full.
     */
    garrisoned: boolean
    /** Rocks still standing here, refreshed each frame for the HUD and minimap. */
    remaining: number
}

export type EnemyState = 'drift' | 'chase' | 'strafe'

export interface EnemyEntity {
    id: number
    def: VoidEnemyDefinition
    root: Container
    body: Container
    hpBar: Graphics
    hpBarBg: Graphics
    x: number
    y: number
    vx: number
    vy: number
    angle: number
    hp: number
    maxHp: number
    damage: number
    speed: number
    fireTimer: number
    abilityTimer: number
    state: EnemyState
    driftAngle: number
    driftTimer: number
    strafeSign: number
    dead: boolean
    boss: boolean
    flashMs: number
    /** Set on hunter-killers so their carrier can respect a launch cap. */
    carrierId: number | null
    /**
     * Garrison ships hold station on their deposit: they drift around the anchor
     * instead of wandering the sector, so a site you flew past stays guarded
     * when you come back for it.
     */
    anchorX: number | null
    anchorY: number | null
}

export interface ShockwaveEntity {
    gfx: Graphics
    x: number
    y: number
    age: number
    telegraphMs: number
    expandMs: number
    radius: number
    damage: number
    fired: boolean
    hitPlayer: boolean
}

export interface RailbeamEntity {
    gfx: Graphics
    x: number
    y: number
    angle: number
    age: number
    chargeMs: number
    activeMs: number
    damage: number
    fired: boolean
}

export interface MineEntity {
    root: Container
    ring: Graphics
    x: number
    y: number
    age: number
    armMs: number
    life: number
    radius: number
    damage: number
    triggered: boolean
}

export interface SingularityEntity {
    gfx: Container
    x: number
    y: number
    age: number
    life: number
    damage: number
    tickMs: number
    /** Pull and damage reach — widens with every extra Collapse Core mounted. */
    radius: number
}

export interface DroneEntity {
    gfx: Container
    angle: number
    fireTimer: number
}

export interface PickupEntity {
    gfx: Container
    x: number
    y: number
    vx: number
    vy: number
    age: number
    resource: VoidResourceId
    amount: number
    /** Tractor Array holds salvage in place indefinitely instead of letting it rot. */
    permanent: boolean
}

/**
 * Specials are counted, not flagged. Two modules with the same effect stack it,
 * so the runtime always asks "how many copies" rather than "is it on".
 */
export type SpecialCounts = VoidSpecialStacks

export function specialCount(stacks: SpecialCounts, id: VoidSpecialId) {
    return stacks[id] ?? 0
}

/** A screen-edge contact arrow: something worth flying to that is off camera. */
export interface MarkerTarget {
    x: number
    y: number
    color: number
    kind: 'deposit' | 'boss' | 'dock'
    label: string
}
