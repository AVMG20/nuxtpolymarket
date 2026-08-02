import type { Container, Graphics } from 'pixi.js'
import type {
    FirewallEnemyDefinition, FirewallLoadout, FirewallTurretRuntime, FirewallWeaponId
} from '#shared/utils/gamelogic/firewall'

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
    /** Fraction of non-AP damage shrugged off. */
    armor: number
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
    armorPiercing: boolean
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
    leaked: number
    wallHp: number
    wallMaxHp: number
}

export interface FirewallCallbacks {
    onWall: (hp: number, maxHp: number, shield: number, maxShield: number) => void
    onAmmo: (mag: number, magSize: number, reloadProgress: number) => void
    onWaveTime: (msRemaining: number, alive: number) => void
    onCredits: (delta: number, reason: 'kill' | 'purge' | 'clear') => void
    onPulse: (chargeMs: number, cooldownMs: number) => void
    onOverclock: (chargeMs: number, cooldownMs: number, activeMs: number) => void
    onWeapon: (id: FirewallWeaponId) => void
    onWaveEnd: (summary: FirewallWaveSummary) => void
    onGameOver: (stats: { wave: number, kills: number }) => void
    onBoss: (name: string) => void
    onNotice: (text: string, kind: 'good' | 'bad' | 'info') => void
}

export interface FirewallStartConfig {
    wave: number
    loadout: FirewallLoadout
}
