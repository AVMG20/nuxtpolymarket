import type { Container, Graphics } from 'pixi.js'
import type { FirewallEnemyDefinition, FirewallLoadout } from '#shared/utils/gamelogic/firewall'

/** The animated parts of a silhouette, rotated per frame for the walk cycle. */
export interface FigureRig {
    root: Container
    torso: Container
    legFront: Container
    legBack: Container
    armFront: Container
    armBack: Container
    /** Overlaid white copy of the body, flashed to 1 when hit. */
    flash: Graphics
    /** Height of the drawn body, for hitboxes and floating text anchors. */
    height: number
    /** Rest position of the torso, bobbed around during the walk cycle. */
    torsoBaseY: number
}

export interface EnemyEntity {
    def: FirewallEnemyDefinition
    rig: FigureRig
    x: number
    /** Ground line the figure stands on — also its depth sort key. */
    laneY: number
    /** Drawn feet position; equals `laneY` minus the flyer's altitude. */
    y: number
    scale: number
    hp: number
    maxHp: number
    speed: number
    damage: number
    bounty: number
    /** Radians of leg swing, advanced by distance walked. */
    stride: number
    attackTimer: number
    /** Horizontal velocity from knockback, decaying to zero. */
    pushVx: number
    /** Vertical bob for flyers. */
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
    /** Sentry rounds are dimmer and never crit, so they read as not-yours. */
    fromSentry: boolean
}

/** Lancer plasma, arcing toward the wall under gravity. */
export interface SpitEntity {
    gfx: Graphics
    x: number
    y: number
    vx: number
    vy: number
    damage: number
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

export interface SentryMount {
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

export interface FirewallRunStats {
    wave: number
    kills: number
    creditsEarned: number
    creditsSpent: number
}

export interface FirewallCallbacks {
    onWall: (hp: number, maxHp: number, shield: number, maxShield: number) => void
    onAmmo: (mag: number, magSize: number, reloadProgress: number) => void
    onWaveTime: (msRemaining: number, alive: number) => void
    onCredits: (delta: number, reason: 'kill' | 'purge' | 'clear') => void
    onPulse: (chargeMs: number, cooldownMs: number) => void
    onWaveEnd: (summary: FirewallWaveSummary) => void
    onGameOver: (stats: { wave: number, kills: number }) => void
    onBoss: (name: string) => void
    onNotice: (text: string, kind: 'good' | 'bad' | 'info') => void
}

export interface FirewallStartConfig {
    wave: number
    loadout: FirewallLoadout
}
