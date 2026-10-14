import type * as THREE from 'three'
import type {
    HackerzDamageType, HackerzDeployableId, HackerzEnemyDefinition, HackerzEventId, HackerzLoadout,
    HackerzProjectile, HackerzTurretRuntime, HackerzWeaponId
} from '#shared/utils/gamelogic/hackerz'
import type { FirewallSoundEvent } from '../firewall-sounds'
import type { ModelRig } from './models'
import type { LinePoint } from './data-lines'
import type { PathChip } from './path-chips'
import type { SysLogLine } from './sys-log'

/**
 * Positions are field units on the ground plane (see `constants.ts`): `u` along
 * the wall, `d` out from its face. Height is cosmetic and only ever rendered.
 */
export interface EnemyEntity {
    def: HackerzEnemyDefinition
    rig: ModelRig
    u: number
    d: number
    /** Rendered height above the ground for flyers, in field units. */
    altitude: number
    hp: number
    maxHp: number
    speed: number
    damage: number
    bounty: number
    /** Site coins this drops when it dies, already scaled for wave and difficulty. */
    coinValue: number
    /** Plated: kinetic sources hit it for 25% more. Nothing hits it for less. */
    armored: boolean
    /** Radians of leg swing, advanced by distance walked. */
    stride: number
    attackTimer: number
    /** Shots left in the current volley, for burst-firing types. */
    burstLeft: number
    /** Knockback velocity away from the wall, decaying to zero. */
    pushVd: number
    /** Vertical bob for airborne units. */
    hover: number
    flashMs: number
    /** Distance from the wall face this type stops at. */
    standoff: number
    /** Hit radius on the ground plane. */
    radius: number
    /** Seconds since spawn, for the rez-in effect. */
    age: number
    /** Ms until a radar ping's wavefront reaches this unit; -1 when none is in flight. */
    pingDelay: number
    /** Ms left on the radar highlight. A cloaked unit can only be seen and hit while this runs. */
    revealMs: number
    /** A cloaked unit that has struck the wall stays visible for good. */
    decloaked: boolean
    /** A ZERO DAY copy: dies fast, pays nothing, and does not bleed data. */
    decoy: boolean
    /** Ms until a boss's next mechanic (ROOTKIT burrow, BLACK ICE freeze). */
    bossTimer: number
    /** Ms left underground, for a burrowed ROOTKIT. */
    burrowMs: number
    /** How many times a ZERO DAY has split. */
    splits: number
    /** 0–1: how close to a node this unit pushes in before it starts hacking, so a crowd staggers. */
    hackReach: number
    /**
     * The line it is riding: the walk through the node it came from, then the
     * trace on to the next. Null until it is put on the board, and for flyers.
     */
    route: LinePoint[] | null
    /** Index of the route segment it is on: between `route[routeSeg]` and `route[routeSeg + 1]`. */
    routeSeg: number
    /** The network node its route ends at, or -1. */
    routeTo: number
    /** The network node its route started from, or -1: where a detour sets off from. */
    routeFrom: number
    /** Rendered yaw: 0 faces the fence, ±π/2 faces across the lane. Turns are hard, like a light cycle. */
    yaw: number
    /** Ms banked toward the next tick of held-ground damage. */
    zoneTick: number
    /** The path node a hacker has picked to work on; it sticks until that node falls. */
    targetChip: PathChip | null
    /** Ms until a hacker can zap to another line again. */
    zapCooldown: number
    /** Carrying red ground's shield, which eats the next hit. */
    redShield: boolean
    /** Ms until red ground grants the shield again. */
    redShieldMs: number
    /** Ms banked toward the next red-ground heal. */
    healTick: number
    /** A wounded weakling holding in red ground to heal, guarding a node if one is near. */
    recovering: boolean
    /** Held-ground ticks taken so far: sappers only feel every second one. */
    zoneTicks: number
    /** Ms left holding the line to cover a retreating unit. */
    coverMs: number
    /** A shield bearer: holds a post in front of the frontier node in `targetChip` instead of attacking. */
    bearer: boolean
    /** The hacked node this unit stands in front of as its defender, or null. One per node: the least tanky nearby. */
    defending: PathChip | null
    /** The hacker this unit bodyguards: it keeps itself between that hacker and the rail. */
    escorting: EnemyEntity | null
    /** Where a ranged unit stepped aside to fire from, clear of the nodes, or null. Riding stops while it is set. */
    parked: { u: number, d: number } | null
    /** Ms until its terminal fires the next pulse into the node. */
    pulseTimer: number
    /** In position at a node and hacking it: its terminal is open. */
    hacking: boolean
}

export interface BulletEntity {
    mesh: THREE.Mesh
    u: number
    d: number
    /** Rendered height, eased toward the target's body. */
    y: number
    vu: number
    vd: number
    prevU: number
    prevD: number
    damage: number
    /** Remaining targets it may punch through. */
    pierce: number
    hit: Set<EnemyEntity>
    lifeMs: number
    crit: boolean
    /** Turret rounds are dimmer and never crit, so they read as not-yours. */
    fromTurret: boolean
    damageType: HackerzDamageType
    splashRadius: number
    splashDamage: number
    /** Missiles steer toward this target while it lives. */
    homing: boolean
    target: EnemyEntity | null
    /** Arc rounds jump to this many extra enemies on impact. */
    chain: number
    chainFalloff: number
    hex: number
    projectile: HackerzProjectile
    /** Path nodes this round has already counted a hit on. */
    chipsHit?: Set<number>
    /** PACKET LOSS: the distance flown at which this round drops out of existence. */
    lostAt?: number
    /** Height the round is fired from and the height of what it is aimed at. */
    fromY: number
    toY: number
    /** Ground distance between the two, for easing `y` across the flight. */
    span: number
    flown: number
}

/** Enemy ordnance, lobbed at the wall under gravity. */
export interface SpitEntity {
    mesh: THREE.Mesh
    u: number
    d: number
    y: number
    vd: number
    vy: number
    damage: number
    hex: number
    /** Howitzer shells land heavy and shake the frame. */
    heavy: boolean
}

/**
 * A coin shed by a dead enemy, arcing to the wall before it banks. Coins are
 * site currency, so the flight is deliberately a beat long.
 */
export interface CoinEntity {
    mesh: THREE.Mesh
    from: THREE.Vector3
    apex: number
    /** 0 → 1 across `COIN_FLIGHT_MS`. */
    t: number
    value: number
}

export interface TurretMount {
    runtime: HackerzTurretRuntime
    rig: ModelRig
    u: number
    /** World z of the mount: the parapet row, or the raised row behind it. */
    z: number
    /** Field depth its rounds leave from (behind the wall face, so negative). */
    muzzleD: number
    /** Extra muzzle height for a raised back-row mount, in field units. */
    muzzleLift: number
    cooldown: number
    /** Recoil, eased back to zero. */
    kick: number
    /** Current yaw, eased toward the target. */
    heading: number
    /** Ms left frozen by BLACK ICE; a click thaws it early. */
    frozenMs: number
    /** The ice block shown while frozen. */
    ice: THREE.Mesh | null
}

export interface HackerzWaveSummary {
    wave: number
    kills: number
    /** Credits banked from kills during the wave, purge included. */
    credits: number
    /** Site coins banked from drops during the wave. */
    coins: number
    leaked: number
    wallHp: number
    wallMaxHp: number
    /** The last wave was just cleared — the run is a win rather than a shop trip. */
    victory: boolean
    /** Set when this was a bonus round rather than a wave. */
    bonus: HackerzEventId | null
    /** A bonus round held the wall and doubled its credits. */
    passed: boolean
}

export interface HackerzCallbacks {
    onWall: (hp: number, maxHp: number, shield: number, maxShield: number) => void
    onAmmo: (mag: number, magSize: number, reloadProgress: number) => void
    onWaveTime: (msRemaining: number, alive: number) => void
    onCredits: (delta: number, reason: 'kill' | 'purge' | 'clear') => void
    onCoins: (delta: number) => void
    onPulse: (chargeMs: number, cooldownMs: number) => void
    onOverclock: (chargeMs: number, cooldownMs: number, activeMs: number) => void
    onWeapon: (id: HackerzWeaponId) => void
    onWaveEnd: (summary: HackerzWaveSummary) => void
    onGameOver: (stats: { wave: number, kills: number }) => void
    onBoss: (name: string) => void
    onNotice: (text: string, kind: 'good' | 'bad' | 'info') => void
    onSound?: (event: FirewallSoundEvent) => void
    /** Exploit chain length and the credit multiplier it is worth. */
    onChain?: (chain: number, multiplier: number) => void
    /** Radar ping recharge, for the HUD. */
    onPing?: (chargeMs: number, cooldownMs: number) => void
    /** The deployable a click will place, or null when none is armed. */
    onArm?: (id: HackerzDeployableId | null) => void
    /** A deployable was placed; `left` is what remains of that kind. */
    onDeploy?: (id: HackerzDeployableId, left: number) => void
    /** A line for the syslog terminal beside the board. */
    onLog?: (line: SysLogLine) => void
}

/** What `startRun` needs to put a resumed run back on the field. */
export interface HackerzStartConfig {
    loadout: HackerzLoadout
    /** Wall health to resume with. Omitted on a fresh run — it starts full. */
    wallHp?: number
    kills?: number
}
