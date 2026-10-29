/*
 * Engine-internal runtime types, shared by the game loop, weapons,
 * upgrades and ultimates. Nothing in here crosses to the UI; that is what
 * types.ts is for.
 */
import type { BitmapText, Container, Sprite, Texture } from 'pixi.js'
import type { RiftbornClassDef, RiftbornClassId } from '#shared/utils/gamelogic/riftborn'
import type { AtlasBaker } from './atlas'
import type { Fx, NumKind } from './fx'
import type { Enemy, Sfx, SfxName, SfxOptions } from './types'

export interface PlayerStats {
    maxHp: number
    regen: number
    armor: number
    /** World units per second */
    moveSpeed: number
    /** Damage multiplier */
    might: number
    area: number
    /** Cooldown multiplier, lower is faster */
    cooldown: number
    /** Extra projectiles on every weapon that fires several */
    amount: number
    duration: number
    projSpeed: number
    /** Pickup radius in world units */
    magnet: number
    crit: number
    critMul: number
    luck: number
    /** XP multiplier */
    growth: number
    /** Fraction of damage dealt returned as HP (capped per second) */
    lifesteal: number
    /** Shard drop multiplier */
    greed: number
    /** Ability damage multiplier */
    abilityPower: number
    /** Ability cooldown multiplier, lower is faster */
    abilityHaste: number
}

export interface EnemyView {
    root: Container
    body: Sprite
    outline: Sprite
    shadow: Sprite
    glow: Sprite | null
    /** One aura ring per elite affix */
    auras: Sprite[]
    /** Affix name tag above elites */
    tag: BitmapText | null
}

export interface EnemyRt extends Enemy {
    mass: number
    kx: number
    ky: number
    burnDps: number
    burnTick: number
    burnShown: number
    freezeT: number
    slowAmt: number
    frames: Texture[]
    whites: Texture[]
    view: EnemyView
    deathT: number
    spawnT: number
    fxT: number
    lastHit: number
    /** Elite/boss scale applied on top of e.scale */
    sizeMul: number
    /** Cached hp ratio for the boss bar */
    killedBy: string | null
    /** Damage source key of the burn currently on it */
    burnSrc: string
}

export interface PlayerRt {
    x: number
    y: number
    vx: number
    vy: number
    radius: number
    hp: number
    facing: number
    dashT: number
    dashCd: number
    dashCdMax: number
    dashX: number
    dashY: number
    iframes: number
    hurtT: number
    alive: boolean
    moving: boolean
    animT: number
}

export interface HitOpts {
    /** Knockback impulse in world units per second */
    knock?: number
    /** Knock direction; if absent it is from (sx, sy), or the player */
    kx?: number
    ky?: number
    sx?: number
    sy?: number
    burn?: number
    burnT?: number
    slow?: number
    slowT?: number
    freeze?: number
    stun?: number
    critBonus?: number
    noCrit?: boolean
    /** Triple damage against frozen enemies */
    shatter?: boolean
    color?: number
    weapon?: WeaponInst | null
    silent?: boolean
    noNumber?: boolean
    /** Set on secondary hits so traits don't recurse */
    chained?: boolean
    numKind?: NumKind
    onKill?: (e: EnemyRt) => void
    /** Damage source key for the results breakdown ('a:<ability>', 'ultimate', 'other'); weapons use `weapon` */
    src?: string
}

/** Bitmask returned from Ctx.hit */
export const HIT = 1
export const CRIT = 2
export const KILL = 4

export interface ProjOpts {
    x: number
    y: number
    vx: number
    vy: number
    tex: string
    radius: number
    damage: number
    /** Enemies it can pass through, default 1 */
    pierce?: number
    life: number
    color?: number
    /** Sprite scale */
    scale?: number
    /** Additive glow under the sprite */
    glow?: number
    glowSize?: number
    spin?: number
    /** Rotate to the velocity (default true unless spin is set) */
    faceVel?: boolean
    hit?: HitOpts
    /** Seconds between hits on the same enemy; 0 = once per enemy */
    rehit?: number
    homing?: number
    weapon?: WeaponInst | null
    trail?: { color: number, rate: number, tex?: 'p.dot' | 'p.spark' | 'p.flame' | 'p.star' | 'p.smoke', size?: number, life?: number }
    /** Custom movement; the default integration is skipped when present */
    update?: (p: Projectile, ctx: Ctx, dt: number) => void
    onHit?: (p: Projectile, e: EnemyRt, ctx: Ctx, result: number) => void
    onEnd?: (p: Projectile, ctx: Ctx) => void
    noCollide?: boolean
    data?: Record<string, number>
    target?: EnemyRt | null
    /** Draw on the additive layer */
    additive?: boolean
}

export interface Projectile {
    alive: boolean
    x: number
    y: number
    vx: number
    vy: number
    radius: number
    damage: number
    pierce: number
    life: number
    age: number
    sprite: Sprite
    glow: Sprite | null
    spin: number
    faceVel: boolean
    scale: number
    hit: HitOpts
    rehit: number
    hitIds: number[]
    hitMap: Map<number, number> | null
    homing: number
    weapon: WeaponInst | null
    trail: ProjOpts['trail'] | null
    trailT: number
    update: ProjOpts['update'] | null
    onHit: ProjOpts['onHit'] | null
    onEnd: ProjOpts['onEnd'] | null
    noCollide: boolean
    data: Record<string, number>
    target: EnemyRt | null
    additive: boolean
}

export type ZoneKind = 'fire' | 'rift' | 'holy' | 'void' | 'frost' | 'magma' | 'storm' | 'poison'

export interface ZoneOpts {
    x: number
    y: number
    radius: number
    life: number
    /** Seconds between damage ticks */
    tick: number
    damage: number
    color: number
    kind: ZoneKind
    hit?: HitOpts
    /** Pull strength toward the centre, world units per second */
    pull?: number
    /** Stick to the player */
    follow?: boolean
    weapon?: WeaponInst | null
    onTick?: (z: Zone, ctx: Ctx) => void
    onEnd?: (z: Zone, ctx: Ctx) => void
    /** Skip boss/elite pulling */
    pullBosses?: boolean
}

export interface Zone extends Required<Omit<ZoneOpts, 'hit' | 'onTick' | 'onEnd' | 'weapon' | 'pullBosses'>> {
    hit: HitOpts
    age: number
    tickT: number
    sprite: Sprite
    ring: Sprite
    weapon: WeaponInst | null
    onTick: ZoneOpts['onTick'] | null
    onEnd: ZoneOpts['onEnd'] | null
    pullBosses: boolean
    fxT: number
    alive: boolean
}

export type AllyKind = 'skeleton' | 'wraith' | 'shade'

export interface AllyOpts {
    damage?: number
    speed?: number
    src?: string
    onEnd?: (a: Ally) => void
}

export interface Ally {
    kind: AllyKind
    x: number
    y: number
    vx: number
    vy: number
    life: number
    max: number
    speed: number
    damage: number
    radius: number
    target: EnemyRt | null
    retarget: number
    hits: Map<number, number>
    sprite: Sprite
    shadow: Sprite
    facing: number
    fxT: number
    alive: boolean
    src: string
    onEnd: ((a: Ally) => void) | null
}

// ─── Weapons ─────────────────────────────────────────────────────────────

export interface WStats {
    damage: number
    cooldown: number
    area: number
    amount: number
    pierce: number
    speed: number
    duration: number
    chain: number
    knock: number
    /** Weapon-specific (freeze seconds, slow, burn...) */
    extra: number
}

export interface WMods {
    damage?: number
    cooldown?: number
    area?: number
    amount?: number
    pierce?: number
    speed?: number
    duration?: number
    chain?: number
    extra?: number
}

export interface WeaponDef {
    id: string
    name: string
    icon: string
    color: number
    description: string
    /** The class that starts with it; other classes see it less often */
    classWeapon?: RiftbornClassId
    /** Whether the global +projectile stat applies */
    usesAmount: boolean
    amountLabel?: string
    chainLabel?: string
    extraLabel?: (v: number) => string
    base: WStats
    /** Gains for levels 2..8 */
    levels: WMods[]
    evo: {
        id: string
        name: string
        icon: string
        color: number
        description: string
        /** Paired passive id */
        passive: string
        bonus: WMods
    }
    fire?: (ctx: Ctx, w: WeaponInst, s: WStats) => void
    tick?: (ctx: Ctx, w: WeaponInst, s: WStats, dt: number) => void
    cleanup?: (ctx: Ctx, w: WeaponInst) => void
}

export interface WeaponInst {
    def: WeaponDef
    level: number
    evolved: boolean
    mods: Required<WMods>
    timer: number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    st: Record<string, any>
    dealt: number
}

export interface PassiveInst {
    id: string
    level: number
    /** Sum of the rarity multipliers of every level taken */
    power: number
}

// ─── The context weapons and ultimates act through ───────────────────────

export interface Ctx {
    readonly time: number
    readonly player: PlayerRt
    readonly stats: PlayerStats
    readonly cls: RiftbornClassDef
    readonly enemies: readonly EnemyRt[]
    readonly fx: Fx
    readonly sfx: Sfx
    readonly atlas: AtlasBaker
    readonly level: number
    readonly view: { readonly width: number, readonly height: number }
    /** Unit vector: mouse when it moved recently, else nearest enemy, else facing */
    aimDir(): { x: number, y: number }
    /** Where the mouse points in world space, when it moved recently */
    mouseWorld(): { x: number, y: number } | null
    nearest(x: number, y: number, maxR: number, skip?: (e: EnemyRt) => boolean): EnemyRt | null
    randomEnemy(x: number, y: number, maxR: number): EnemyRt | null
    /** Every targetable enemy whose circle overlaps (x, y, r) */
    query(x: number, y: number, r: number, fn: (e: EnemyRt) => unknown): void
    /** Returns a HIT | CRIT | KILL bitmask, 0 when nothing happened */
    hit(e: EnemyRt, damage: number, opts?: HitOpts): number
    explode(x: number, y: number, r: number, damage: number, opts?: HitOpts & { color?: number, sfx?: boolean, shake?: number, visual?: 'fire' | 'void' | 'holy' | 'frost' | 'plain' | 'none' }): void
    projectile(o: ProjOpts): Projectile
    zone(o: ZoneOpts): Zone
    ally(kind: AllyKind, x: number, y: number, life: number, opts?: AllyOpts): void
    schedule(delay: number, fn: () => void): void
    play(name: SfxName, opts?: SfxOptions, minGap?: number): void
    shake(power: number): void
    flash(color: number, alpha: number): void
    hitStop(seconds: number): void
    heal(amount: number, show?: boolean): void
    /** A sprite in one of the world layers, owned by the caller */
    makeSprite(tex: string, layer: 'decal' | 'decalAdd' | 'glow' | 'top'): Sprite
    freeSprite(s: Sprite): void
    pull(x: number, y: number, radius: number, strength: number, dt: number, bosses?: boolean): void
    /** Destroys enemy shots overlapping (x, y, r), returns how many */
    clearShots(x: number, y: number, r: number): number
}

// ─── Abilities (Q / F / R) ───────────────────────────────────────────────

export interface AbilityMods {
    damage?: number
    cooldown?: number
    radius?: number
    duration?: number
    charges?: number
}

export interface AStats {
    damage: number
    /** Seconds */
    cooldown: number
    /** World units */
    radius: number
    /** Seconds */
    duration: number
    charges: number
    level: number
    /** Level 5 */
    mastery: boolean
}

export interface AbilityDef {
    id: string
    name: string
    icon: string
    color: number
    /** Card text for a new ability: the effect only */
    description: string
    /** Card text for the level 5 mastery */
    mastery: string
    base: { damage: number, cooldown: number, radius: number, duration: number }
    /** Gains for levels 2..5 */
    levels: AbilityMods[]
    /** Reports `active` in the HUD while this returns true */
    active?: (a: AbilityInst) => boolean
    /** Returns false when it could not be cast (no cooldown is spent) */
    cast: (ctx: AbilityCtx, a: AbilityInst, s: AStats) => boolean
    tick?: (ctx: AbilityCtx, a: AbilityInst, s: AStats, dt: number) => void
    cleanup?: (ctx: AbilityCtx, a: AbilityInst) => void
}

export interface AbilityInst {
    def: AbilityDef
    level: number
    mods: Required<AbilityMods>
    /** Seconds until the next charge */
    cd: number
    cdMax: number
    charges: number
    /** Seconds the effect keeps running (HUD `active`) */
    activeT: number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    st: Record<string, any>
    readyFired: boolean
    /** Ctx stamped with this ability's damage source */
    ctx: AbilityCtx | null
}

export interface AbilityCtx extends Ctx {
    /** Mouse (clamped to range) when it moved recently, else the densest nearby pack, else ahead of the player */
    aimPoint(range: number): { x: number, y: number }
    /** Enemies inside are slowed by `slow` and their shots by `shotSlow` */
    chrono(x: number, y: number, r: number, life: number, slow: number, shotSlow: number, vuln?: number): void
    /** Absorbs damage for `life` seconds; onEnd(broken, absorbed) */
    shield(hp: number, life: number, onEnd: (broken: boolean, absorbed: number) => void): void
    /** Timed buff: move speed and fire rate multipliers, crit chance bonus */
    haste(t: number, move: number, fire: number, crit: number): void
    teleport(x: number, y: number): void
    grantIframes(t: number): void
}
