import type { Container, Graphics } from 'pixi.js'
import type {
    FirewallDamageType, FirewallEnemyDefinition, FirewallLoadout, FirewallTurretRuntime, FirewallWeaponId
} from '#shared/utils/gamelogic/firewall'
import type { FirewallSoundEvent } from '../firewall-sounds'

/** The animated parts of a silhouette, rotated per frame for the walk cycle. */
export interface FigureRig {
    root: Container
    torso: Container
    legFront: Container
    legBack: Container
    armFront: Container
    armBack: Container
    /** Overlaid additive blob, flashed when hit. */
    flash: Graphics
    /** Height of the drawn body, for hitboxes and floating text anchors. */
    height: number
    /** Rest position of the torso, bobbed around during the walk cycle. */
    torsoBaseY: number
    /** Which animation the limbs run: striding, spinning wheels, or hovering. */
    gait: 'walk' | 'roll' | 'hover'
}

export interface EnemyEntity {
    def: FirewallEnemyDefinition
    rig: FigureRig
    x: number
    /** Ground line the figure stands on — also its depth sort key. */
    laneY: number
    /** Drawn feet position; equals `laneY` minus any altitude. */
    y: number
    scale: number
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
    /** Horizontal velocity from knockback, decaying to zero. */
    pushVx: number
    /** Vertical bob for airborne units. */
    hover: number
    flashMs: number
    dying: boolean
    /** Distance from the wall face this type stops at. */
    standoff: number
    healthBar: Graphics | null
}

export interface BulletEntity {
    gfx: Graphics
    x: number
    y: number
    vx: number
    vy: number
    prevX: number
    prevY: number
    damage: number
    /** Remaining targets it may punch through. */
    pierce: number
    hit: Set<EnemyEntity>
    lifeMs: number
    crit: boolean
    /** Turret rounds are dimmer and never crit, so they read as not-yours. */
    fromTurret: boolean
    damageType: FirewallDamageType
    splashRadius: number
    splashDamage: number
    /** Missiles steer toward this target while it lives. */
    homing: boolean
    target: EnemyEntity | null
    /** Arc rounds jump to this many extra enemies on impact. */
    chain: number
    chainFalloff: number
    hex: number
}

/** Enemy ordnance, arcing toward the wall under gravity. */
export interface SpitEntity {
    gfx: Graphics
    x: number
    y: number
    vx: number
    vy: number
    damage: number
    hex: number
    /** Howitzer shells land heavy and shake the frame. */
    heavy: boolean
}

/**
 * A coin shed by a dead enemy, arcing to the wall before it banks. Coins are
 * site currency, so the flight is deliberately a beat long — the payout of a
 * good wave should be something you watch arrive.
 */
export interface CoinEntity {
    gfx: Graphics
    x: number
    y: number
    /** Launch point and apex, for the bezier the coin rides in on. */
    fromX: number
    fromY: number
    arcY: number
    /** 0 → 1 across `COIN_FLIGHT_MS`. */
    t: number
    value: number
}

export interface ParticleEntity {
    gfx: Graphics
    x: number
    y: number
    vx: number
    vy: number
    gravity: number
    lifeMs: number
    maxLifeMs: number
    spin: number
    drag: number
}

export interface TurretMount {
    runtime: FirewallTurretRuntime
    root: Container
    barrel: Container
    x: number
    y: number
    cooldown: number
    /** Recoil offset, eased back to zero. */
    kick: number
}

export interface FirewallWaveSummary {
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
}

export interface FirewallCallbacks {
    onWall: (hp: number, maxHp: number, shield: number, maxShield: number) => void
    onAmmo: (mag: number, magSize: number, reloadProgress: number) => void
    onWaveTime: (msRemaining: number, alive: number) => void
    onCredits: (delta: number, reason: 'kill' | 'purge' | 'clear') => void
    onCoins: (delta: number) => void
    onPulse: (chargeMs: number, cooldownMs: number) => void
    onOverclock: (chargeMs: number, cooldownMs: number, activeMs: number) => void
    onWeapon: (id: FirewallWeaponId) => void
    onWaveEnd: (summary: FirewallWaveSummary) => void
    onGameOver: (stats: { wave: number, kills: number }) => void
    onBoss: (name: string) => void
    onNotice: (text: string, kind: 'good' | 'bad' | 'info') => void
    onSound?: (event: FirewallSoundEvent) => void
}

/** What `startRun` needs to put a resumed run back on the field. */
export interface FirewallStartConfig {
    loadout: FirewallLoadout
    /** Wall health to resume with. Omitted on a fresh run — it starts full. */
    wallHp?: number
    kills?: number
}
