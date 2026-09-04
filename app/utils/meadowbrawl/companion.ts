// Pets — the account's companion that runs at the player's heel.
//
// The engine owns the world; this module owns the companion's brain and
// body. It reads the shared pet definitions (`meadowbrawl-meta`) for what
// a pet can do at a level, and pokes the game through its public surface
// (damageEnemy, burst, glow, applyStun, events) so nothing here needs to
// know how the engine is wired inside.

import { randomChance } from '#shared/utils/random'
import { meadowbrawlPetEffects, type MeadowbrawlPetEffects, type MeadowbrawlPetId } from '#shared/utils/gamelogic/meadowbrawl-meta'
import type { Enemy, MeadowbrawlGame } from './engine'
import { angleTo, inCircle, inSegment } from './geometry'
import type { Vec } from './types'

export interface FireTrail {
    x: number
    y: number
    life: number
    maxLife: number
    r: number
    tick: number
}

export interface Feather {
    x: number
    y: number
    z: number
    life: number
    /** Set once picked up, so the sparkle plays and it stops attracting. */
    taken: boolean
}

export interface Companion {
    id: MeadowbrawlPetId
    level: number
    effects: MeadowbrawlPetEffects
    x: number
    y: number
    /** Airborne height — the owl hovers, the others hop. */
    z: number
    vx: number
    vy: number
    facing: number
    /** Walk/flap phase for the renderer. */
    anim: number
    moving: boolean
    /** Seconds remaining on each ability; -1 when the level hasn't unlocked it. */
    cd: [number, number]
    cdMax: [number, number]
    /** Flame Dash in flight. */
    dash: { t: number, dur: number, x0: number, y0: number, x1: number, y1: number } | null
    /** Seconds the howl pose lasts. */
    howl: number
    /** Shell Ward is up: the next hit is swallowed whole. */
    ward: boolean
    /** Seconds of Mending Bloom heal remaining. */
    bloom: number
    /** Gust flap animation. */
    gust: number
    /** Seconds of Lucky Feather quickness remaining on the player. */
    quick: number
    trails: FireTrail[]
    feather: Feather | null
    /** Squash on landing / reaction. */
    squash: number
}

const FOLLOW_DIST = 42
const FOLLOW_SPEED = 260
const OWL_HOVER = 40
const DASH_DUR = 0.42
const DASH_TICK = 0.25
const BLOOM_DUR = 4
const BLOOM_HEAL_PER_SEC = 3
const QUICK_DUR = 3
const GUST_RADIUS = 96
const GUST_MIN_ENEMIES = 3

export function makeCompanion(id: MeadowbrawlPetId, level: number, x: number, y: number): Companion {
    const effects = meadowbrawlPetEffects(id, level)
    const cdOf = (i: number): number => effects.abilities[i]?.cooldown ?? -1
    return {
        id,
        level,
        effects,
        x: x - FOLLOW_DIST,
        y: y + 10,
        z: id === 'owl' ? OWL_HOVER : 0,
        vx: 0,
        vy: 0,
        facing: 0,
        anim: 0,
        moving: false,
        // Abilities start half-charged so the pet does something early on
        // without opening the run with a burst.
        cd: [cdOf(0) > 0 ? cdOf(0) * 0.5 : -1, cdOf(1) > 0 ? cdOf(1) * 0.5 : -1],
        cdMax: [cdOf(0), cdOf(1)],
        dash: null,
        howl: 0,
        ward: false,
        bloom: 0,
        gust: 0,
        quick: 0,
        trails: [],
        feather: null,
        squash: 0
    }
}

/** True when an ability slot is online at this pet's level. */
export function companionHasAbility(c: Companion, slot: 0 | 1): boolean {
    return c.cdMax[slot] > 0
}

/**
 * One simulation step for the companion: follow the player, tick the
 * cooldowns, fire whatever is ready and worth firing.
 */
export function updateCompanion(game: MeadowbrawlGame, c: Companion, dt: number) {
    const p = game.player
    c.anim += dt * (c.moving ? 9 : 2.5)
    c.squash = Math.max(0, c.squash - dt * 4)
    if (c.howl > 0) c.howl -= dt
    if (c.gust > 0) c.gust -= dt
    if (c.quick > 0) c.quick -= dt

    if (c.dash) {
        updateDash(game, c, dt)
    } else {
        follow(game, c, dt)
    }

    // Fire trails burn whoever stands in them.
    for (let i = c.trails.length - 1; i >= 0; i--) {
        const t = c.trails[i]!
        t.life -= dt
        t.tick -= dt
        if (t.life <= 0) {
            c.trails.splice(i, 1)
            continue
        }
        if (t.tick <= 0) {
            t.tick = DASH_TICK
            const dmg = game.weapon.baseDamage * game.damageMult * 0.18 * c.effects.potency
            for (const e of game.enemies) {
                if (!e.alive || !inCircle(t, t.r, e, e.r)) continue
                game.damageEnemy(e, dmg, { source: t, knockback: 0, tag: 'burn', bypassShield: true, color: '#ff9a3c' })
                e.burn = { t: 2, dps: dmg * 0.6, tick: e.burn?.tick ?? 0.3 }
            }
            if (Math.random() < 0.5) game.burst(t.x + (Math.random() - 0.5) * t.r, t.y + (Math.random() - 0.5) * t.r * 0.6, 4, 1, 'ember', '#ff8c2a', 40, 0.5)
        }
    }

    // Mending Bloom heals over time.
    if (c.bloom > 0) {
        c.bloom -= dt
        p.hp = Math.min(p.maxHp, p.hp + BLOOM_HEAL_PER_SEC * c.effects.potency * dt)
        if (Math.random() < dt * 8) game.burst(p.x + (Math.random() - 0.5) * 24, p.y, 10 + Math.random() * 30, 1, 'petal', '#8fe08a', 20, 0.9)
    }

    // Lucky Feather waits on the ground until the player walks over it.
    if (c.feather) {
        const f = c.feather
        f.life -= dt
        if (f.taken) {
            if (f.life <= 0) c.feather = null
        } else {
            f.z = 8 + Math.sin(game.time * 4) * 4
            if (f.life <= 0) {
                c.feather = null
            } else if (Math.hypot(p.x - f.x, p.y - f.y) < p.r + 18) {
                f.taken = true
                f.life = 0.5
                p.abilityCd.q *= 0.5
                p.abilityCd.e *= 0.5
                c.quick = QUICK_DUR * c.effects.potency
                game.glow(f.x, f.y, 12, 14, '#dfe6ff', 90, 0.8)
                game.floaters.push({ x: p.x, y: p.y, z: 54, text: 'LUCKY', life: 0.9, maxLife: 0.9, color: '#dfe6ff', size: 14, vx: 0 })
                game.emit('petFeather', f.x, f.y)
            }
        }
    }

    // Abilities.
    for (const slot of [0, 1] as const) {
        if (c.cdMax[slot] <= 0) continue
        if (c.cd[slot] > 0) {
            c.cd[slot] -= dt
            continue
        }
        if (tryAbility(game, c, slot)) c.cd[slot] = c.cdMax[slot]
    }
}

function follow(game: MeadowbrawlGame, c: Companion, dt: number) {
    const p = game.player
    // Heel position trails behind the player's last movement direction.
    const back = Math.atan2(p.lastMoveY, p.lastMoveX) + Math.PI
    const tx = p.x + Math.cos(back) * FOLLOW_DIST + (c.id === 'owl' ? 0 : Math.sin(back) * 10)
    const ty = p.y + Math.sin(back) * FOLLOW_DIST * 0.8 + (c.id === 'owl' ? -12 : 8)
    const dx = tx - c.x
    const dy = ty - c.y
    const d = Math.hypot(dx, dy)
    const speed = c.id === 'tortoise' ? FOLLOW_SPEED * 0.7 : c.id === 'owl' ? FOLLOW_SPEED * 1.3 : FOLLOW_SPEED
    // Snap back when left far behind (dashes, blinks) so the pet is never lost.
    if (d > 420) {
        c.x = tx
        c.y = ty
        c.vx = 0
        c.vy = 0
        game.burst(c.x, c.y, 6, 5, 'dust', '#bfae83', 60, 0.4)
    }
    const want = d > 14 ? Math.min(speed, d * 6) : 0
    const ax = d > 0 ? dx / d * want : 0
    const ay = d > 0 ? dy / d * want : 0
    c.vx += (ax - c.vx) * Math.min(1, dt * 10)
    c.vy += (ay - c.vy) * Math.min(1, dt * 10)
    c.x += c.vx * dt
    c.y += c.vy * dt
    c.moving = Math.hypot(c.vx, c.vy) > 20
    if (c.moving) c.facing = Math.atan2(c.vy, c.vx)
    else c.facing = angleTo(c, p)
    if (c.id === 'owl') c.z = OWL_HOVER + Math.sin(c.anim * 0.6) * 5
    else c.z = c.moving ? Math.abs(Math.sin(c.anim)) * (c.id === 'fox' ? 9 : 3) : 0
    if (c.id !== 'owl') {
        // Land animals stay out of the rocks.
        for (const o of game.world.obstacles) {
            const ox = c.x - o.x
            const oy = c.y - o.y
            const od = Math.hypot(ox, oy)
            const min = o.r + 8
            if (od > 0 && od < min) {
                c.x = o.x + ox / od * min
                c.y = o.y + oy / od * min
            }
        }
    }
}

function updateDash(game: MeadowbrawlGame, c: Companion, dt: number) {
    const d = c.dash!
    d.t += dt
    const k = Math.min(1, d.t / d.dur)
    const ease = 1 - Math.pow(1 - k, 2)
    const nx = d.x0 + (d.x1 - d.x0) * ease
    const ny = d.y0 + (d.y1 - d.y0) * ease
    c.facing = Math.atan2(ny - c.y, nx - c.x) || c.facing
    c.x = nx
    c.y = ny
    c.z = Math.sin(k * Math.PI) * 14
    c.moving = true
    c.anim += dt * 12
    // Lay fire behind as it goes.
    const last = c.trails[c.trails.length - 1]
    if (!last || Math.hypot(last.x - c.x, last.y - c.y) > 26) {
        c.trails.push({ x: c.x, y: c.y, life: 2.2 * c.effects.potency, maxLife: 2.2 * c.effects.potency, r: 30, tick: 0 })
        game.burst(c.x, c.y, 6, 4, 'ember', '#ff8c2a', 70, 0.5)
        game.glow(c.x, c.y, 8, 2, '#ffb347', 40, 0.4)
    }
    if (k >= 1) {
        c.dash = null
        c.squash = 1
        game.burst(c.x, c.y, 0, 8, 'dust', '#bfae83', 100, 0.4)
    }
}

function tryAbility(game: MeadowbrawlGame, c: Companion, slot: 0 | 1): boolean {
    const p = game.player
    switch (c.id) {
        case 'fox': return slot === 0 ? flameDash(game, c) : cinderHowl(game, c)
        case 'tortoise': return slot === 0 ? shellWard(game, c) : mendingBloom(game, c, p.hp / p.maxHp)
        case 'owl': return slot === 0 ? gust(game, c) : luckyFeather(game, c)
    }
}

/** Flame Dash: through the densest knot of enemies within reach. */
function flameDash(game: MeadowbrawlGame, c: Companion): boolean {
    const p = game.player
    let best: Enemy | null = null
    let bestScore = 0
    for (const e of game.enemies) {
        if (!e.alive || !e.entered) continue
        const d = Math.hypot(e.x - p.x, e.y - p.y)
        if (d > 320) continue
        let score = 1
        for (const o of game.enemies) if (o.alive && o !== e && Math.hypot(o.x - e.x, o.y - e.y) < 70) score += 1
        score -= d / 400
        if (score > bestScore) {
            bestScore = score
            best = e
        }
    }
    if (!best) return false
    const a = Math.atan2(best.y - c.y, best.x - c.x)
    const len = Math.hypot(best.x - c.x, best.y - c.y) + 90
    c.dash = { t: 0, dur: DASH_DUR, x0: c.x, y0: c.y, x1: c.x + Math.cos(a) * len, y1: c.y + Math.sin(a) * len }
    c.trails.length = 0
    game.burst(c.x, c.y, 8, 10, 'ember', '#ff8c2a', 120, 0.5)
    game.emit('petAbility', c.x, c.y, 1, 'flameDash')
    return true
}

/** Cinder Howl: marks the toughest foe nearby for bonus damage. */
function cinderHowl(game: MeadowbrawlGame, c: Companion): boolean {
    const p = game.player
    let best: Enemy | null = null
    let bestHp = 0
    for (const e of game.enemies) {
        if (!e.alive || !e.entered || e.marked > 0) continue
        if (Math.hypot(e.x - p.x, e.y - p.y) > 360) continue
        const weight = e.hp * (e.def.elite ? 3 : 1)
        if (weight > bestHp) {
            bestHp = weight
            best = e
        }
    }
    if (!best) return false
    best.marked = 4 * c.effects.potency
    c.howl = 0.9
    c.moving = false
    game.rings.push({ x: c.x, y: c.y, r0: 6, r1: 120, life: 0.45, maxLife: 0.45, color: '#ff9a3c', width: 6 })
    game.rings.push({ x: best.x, y: best.y, r0: best.r * 2.4, r1: best.r * 1.1, life: 0.5, maxLife: 0.5, color: '#ff6b3c', width: 5 })
    game.glow(best.x, best.y, best.def.height * 0.6, 10, '#ff8c2a', 70, 0.8)
    game.floaters.push({ x: best.x, y: best.y, z: best.def.height + 10, text: 'MARKED', life: 0.9, maxLife: 0.9, color: '#ff9a3c', size: 14, vx: 0 })
    game.emit('petAbility', c.x, c.y, 1, 'cinderHowl')
    return true
}

/** Shell Ward: a barrier that eats the next hit. */
function shellWard(game: MeadowbrawlGame, c: Companion): boolean {
    if (c.ward) return false
    // Only bother while there is something to be hit by.
    if (!game.enemies.some(e => e.alive && e.entered)) return false
    c.ward = true
    const p = game.player
    game.rings.push({ x: p.x, y: p.y, r0: 40, r1: 18, life: 0.5, maxLife: 0.5, color: '#9be07a', width: 5 })
    game.glow(p.x, p.y, 20, 10, '#b8f0a0', 50, 0.8)
    game.emit('petAbility', c.x, c.y, 0.7, 'shellWard')
    return true
}

/** Consumes the ward if it is up; the engine calls this before damage lands. */
export function companionAbsorbHit(game: MeadowbrawlGame, c: Companion): boolean {
    if (!c.ward) return false
    c.ward = false
    const p = game.player
    game.burst(p.x, p.y, 22, 14, 'spark', '#c9f5b0', 200, 0.35)
    game.impacts.push({ x: p.x, y: p.y, z: 26, life: 0.22, maxLife: 0.22, size: 34, color: '#b8f0a0', kind: 'ring', angle: 0 })
    game.floaters.push({ x: p.x, y: p.y, z: 52, text: 'WARDED', life: 0.7, maxLife: 0.7, color: '#b8f0a0', size: 14, vx: 0 })
    game.hitstop = Math.max(game.hitstop, 0.04)
    c.squash = 1
    game.emit('shieldBlock', p.x, p.y, 0.8, 'ward')
    return true
}

/** Mending Bloom: only when the player is actually hurting. */
function mendingBloom(game: MeadowbrawlGame, c: Companion, hpFrac: number): boolean {
    if (hpFrac >= 0.5) return false
    c.bloom = BLOOM_DUR
    c.squash = 1
    const p = game.player
    game.rings.push({ x: c.x, y: c.y, r0: 4, r1: 70, life: 0.6, maxLife: 0.6, color: '#8fe08a', width: 6 })
    game.burst(c.x, c.y, 16, 18, 'petal', '#8fe08a', 90, 1.2)
    game.glow(p.x, p.y, 20, 12, '#b8f0a0', 60, 1)
    game.floaters.push({ x: p.x, y: p.y, z: 54, text: 'BLOOM', life: 0.9, maxLife: 0.9, color: '#8fe08a', size: 14, vx: 0 })
    game.emit('petAbility', c.x, c.y, 0.8, 'mendingBloom')
    return true
}

/** Gust: when the player is surrounded, hurl the crowd back and rattle them. */
function gust(game: MeadowbrawlGame, c: Companion): boolean {
    const p = game.player
    const near = game.enemies.filter(e => e.alive && e.entered && inCircle(p, GUST_RADIUS, e, e.r))
    if (near.length < GUST_MIN_ENEMIES) return false
    c.gust = 0.6
    c.squash = 1
    for (const e of near) {
        const a = angleTo(p, e)
        const kb = (e.def.elite ? 120 : 380) * c.effects.potency
        e.vx += Math.cos(a) * kb
        e.vy += Math.sin(a) * kb
        game.addStun(e, 22 * c.effects.potency)
        // Knock regulars out of whatever swing they were winding up.
        if (!e.def.elite && e.attack && e.state !== 'stagger') {
            e.attack = null
            e.state = 'chase'
            e.stateT = 0
        }
    }
    game.rings.push({ x: p.x, y: p.y, r0: 12, r1: GUST_RADIUS * 1.4, life: 0.35, maxLife: 0.35, color: '#dfe6ff', width: 10 })
    game.burst(p.x, p.y, 10, 22, 'leaf', '#bfd0a0', 220, 0.7)
    game.burst(p.x, p.y, 14, 12, 'dust', '#cfd6e6', 180, 0.5)
    game.shake = Math.max(game.shake, 5)
    game.emit('petAbility', c.x, c.y, 1, 'gust')
    return true
}

/** Lucky Feather: dropped a little ahead of the player. */
function luckyFeather(game: MeadowbrawlGame, c: Companion): boolean {
    if (c.feather) return false
    if (!game.enemies.some(e => e.alive && e.entered)) return false
    const p = game.player
    let x = p.x + p.lastMoveX * 70
    let y = p.y + p.lastMoveY * 70
    // Keep it off the rocks and in the arena.
    for (const o of game.world.obstacles) {
        if (inSegment(p, { x, y }, o.r + 12, o, 0)) {
            x = p.x
            y = p.y
            break
        }
    }
    c.feather = { x, y, z: 60, life: 10, taken: false }
    c.squash = 1
    game.glow(c.x, c.y, c.z, 6, '#dfe6ff', 40, 0.6)
    game.emit('petAbility', c.x, c.y, 0.6, 'luckyFeather')
    return true
}

/** Player attack-speed multiplier the companion grants right now. */
export function companionHaste(c: Companion | null): number {
    return c && c.quick > 0 ? 1.25 : 1
}

/** Position the renderer should draw the companion's shadow at. */
export function companionGround(c: Companion): Vec {
    return { x: c.x, y: c.y }
}

/** Whether a random cosmetic flourish should play this frame. */
export function companionIdleFlourish(c: Companion, dt: number): boolean {
    return !c.moving && randomChance(dt * 0.15)
}
