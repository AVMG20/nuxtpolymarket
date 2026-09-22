// Shared state shapes for the SHAPEZZ simulation (shapezz-engine.ts) and its
// renderer (render.ts). Lives in a subfolder so Nuxt does not auto-import the
// short helper names below into every component.

import type { ShapezzBossKind, ShapezzBulletPriority, ShapezzEnemyType } from '#shared/utils/gamelogic/shapezz'

export const WIDTH = 1280
export const HEIGHT = 720
export const FLOOR_Y = 662
export const GRAVITY = 1900
export const COIN_COLOR = '#22d3ee'

export interface Point { x: number, y: number }
export interface Platform { x: number, y: number, width: number, height: number, glow: number }

export type ParticleKind = 'dot' | 'square' | 'spark' | 'smoke' | 'ring' | 'glow'

export interface Particle extends Point {
    kind: ParticleKind
    vx: number
    vy: number
    life: number
    maxLife: number
    size: number
    color: string
    gravity: number
    drag: number
    rotation: number
    spin: number
    /** Size multiplier reached at the end of life (smoke grows, sparks shrink). */
    grow: number
}

/** Polygon shards thrown off a dying shape. Rendered as filled, rotating triangles. */
export interface Debris extends Point {
    vx: number
    vy: number
    life: number
    maxLife: number
    size: number
    color: string
    rotation: number
    spin: number
    bounced: boolean
}

export interface Shockwave extends Point {
    radius: number
    maxRadius: number
    life: number
    maxLife: number
    color: string
    width: number
    /** Filled flash disc under the ring. */
    fill: boolean
}

export interface Beam {
    from: Point
    to: Point
    life: number
    maxLife: number
    color: string
    width: number
    /** Jagged lightning versus a straight tracer. */
    jagged: boolean
    seed: number
}

export interface DamageText extends Point {
    text: string
    color: string
    life: number
    maxLife: number
    size: number
    vx: number
    vy: number
    crit: boolean
}

export interface Pickup extends Point {
    vx: number
    vy: number
    value: number
    life: number
    kind: 'coin' | 'health'
    spin: number
}

export interface Singularity extends Point {
    life: number
    maxLife: number
    radius: number
    damageTick: number
    triggersHealing: boolean
}

export interface Turret extends Point {
    life: number
    fireCooldown: number
    angle: number
    recoil: number
}

export interface Bullet extends Point {
    prevX: number
    prevY: number
    vx: number
    vy: number
    damage: number
    radius: number
    life: number
    pierce: number
    bounces: number
    color: string
    accentColor: string
    homing: boolean
    trail: boolean
    explosionRadius: number
    traveled: number
    falloffStart: number
    falloffEnd: number
    minFalloffDamage: number
    visualIntensity: number
    secondaryEffects: boolean
    triggersHealing: boolean
    hitIds: Set<number>
    priority: ShapezzBulletPriority
    source: DamageSource
}

export type EnemyBulletShape = 'orb' | 'needle' | 'star' | 'wave'

export interface EnemyBullet extends Point {
    vx: number
    vy: number
    damage: number
    radius: number
    life: number
    color: string
    shape: EnemyBulletShape
    /** Radians per second the shot may turn toward the player (0 = straight). */
    homing: number
    gravity: number
    /** Seconds until the shot bursts into a ring of smaller shots (0 = never). */
    splitIn: number
    splitCount: number
    spin: number
}

/** A straight hostile beam: warms up as a thin telegraph, then burns. */
export interface Laser extends Point {
    angle: number
    length: number
    width: number
    warmup: number
    maxWarmup: number
    life: number
    maxLife: number
    damage: number
    color: string
    /** Radians per second while burning. */
    sweep: number
    ownerId: number
    /** Offset from the owner's centre, re-applied every frame so the beam rides with it. */
    offset: number
}

/** Ground and sky telegraphs: where something is about to land. */
export interface Warning extends Point {
    radius: number
    life: number
    maxLife: number
    color: string
    kind: 'circle' | 'column' | 'line'
    x2: number
    y2: number
}

/** The player's Prism Lance: a thick beam that fades out. */
export interface Lance {
    from: Point
    to: Point
    life: number
    maxLife: number
    width: number
    color: string
    /** Accent for the outer glow. */
    glow: string
}

export interface Enemy extends Point {
    id: number
    type: ShapezzEnemyType
    vx: number
    vy: number
    radius: number
    hp: number
    maxHp: number
    /** Trailing health for the chip-damage bar. */
    hpShown: number
    damage: number
    speed: number
    reward: number
    color: string
    fireCooldown: number
    contactCooldown: number
    phase: number
    boss: boolean
    bossKind: ShapezzBossKind | null
    elite: boolean
    minion: boolean
    hitFlash: number
    /** 0 → 1 as the shape warps in. */
    spawnT: number
    /** Facing, for shapes that point at their target. */
    angle: number
    /** Generic behaviour state machine. */
    state: number
    stateTimer: number
    aimX: number
    aimY: number
    /** Inside a warden's aura this frame. */
    shielded: boolean
    /** Boss: 0, 1, 2 as health drops past two thirds and one third. */
    bossPhase: number
    attackIndex: number
    /** Polygon boss: current number of sides, eased toward `targetSides`. */
    sides: number
    targetSides: number
}

export interface Player extends Point {
    vx: number
    vy: number
    size: number
    hp: number
    shield: number
    onGround: boolean
    invulnerable: number
    scaleX: number
    scaleY: number
    recoil: number
    muzzleFlash: number
    hurtFlash: number
}

export type DamageSource =
    | 'weapon' | 'ceiling' | 'orbital' | 'drone' | 'turret' | 'splitstorm' | 'nova'
    | 'explosive' | 'chain' | 'singularity' | 'overkill' | 'killquake' | 'lance' | 'bomber' | 'execute'

export function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value))
}

export function distance(a: Point, b: Point) {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

export function distanceSquared(a: Point, b: Point) {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return dx * dx + dy * dy
}

export function distanceToSegmentSquared(px: number, py: number, startX: number, startY: number, endX: number, endY: number) {
    const dx = endX - startX
    const dy = endY - startY
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) return (px - endX) ** 2 + (py - endY) ** 2
    const projection = clamp(((px - startX) * dx + (py - startY) * dy) / lengthSquared, 0, 1)
    const nearestX = startX + projection * dx
    const nearestY = startY + projection * dy
    return (px - nearestX) ** 2 + (py - nearestY) ** 2
}

export function normalized(dx: number, dy: number) {
    const length = Math.hypot(dx, dy) || 1
    return { x: dx / length, y: dy / length }
}

/** Cosmetic jitter only. Anything that decides an outcome uses `#shared/utils/random`. */
export function jitter(min: number, max: number) {
    return min + Math.random() * (max - min)
}

export function angleDelta(from: number, to: number) {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}
