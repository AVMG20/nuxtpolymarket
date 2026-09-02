// Meadowbrawl simulation. No DOM, no canvas — the renderer reads this state
// and the Vue shell feeds it input. Outcome rolls (offers, procs, enemy
// attack choice) go through the shared CSPRNG helpers; cosmetic scatter uses
// Math.random.
import { randomChance, randomFloat } from '#shared/utils/random'
import type { EnemyTypeId, GameEvent, Offer, SpawnGroup, SwingDef, Vec, WeaponDef, WeaponId } from './types'
import { ARENA_H, ARENA_W, TOTAL_WAVES } from './types'
import { WEAPONS, buildChain } from './weapons'
import { ENEMY_TYPES, waveScaling, type EnemyTypeDef } from './enemies'
import { buildWave } from './waves'
import { rollOffers } from './upgrades'
import { angleTo, clamp, inArc, inCircle, inSegment, normalizeAngle, shapeHits } from './geometry'
import { generateWorld, type WorldLayout } from './world'

export type Phase = 'menu' | 'wave' | 'calm' | 'upgrade' | 'dead' | 'victory'

export interface InputState {
    moveX: number
    moveY: number
    aimX: number
    aimY: number
    attackPressed: boolean
    attackHeld: boolean
    specialPressed: boolean
    spaceDown: boolean
    spacePressed: boolean
    spaceReleased: boolean
}

export interface PlayerAttack {
    index: number
    def: SwingDef
    t: number
    phase: 'windup' | 'active' | 'recovery'
    dir: number
    hitIds: Set<number>
    windup: number
    active: number
    recovery: number
    /** True once the swing's chain-continuation input has been set. */
    landed: boolean
}

export interface Dodge {
    t: number
    dur: number
    dx: number
    dy: number
}

export interface SpecialState {
    kind: 'dash' | 'slam' | 'sweep' | 'backstab' | 'leap' | 'whirl'
    t: number
    dur: number
    dx: number
    dy: number
    hitIds: Set<number>
    fired: boolean
    targetId?: number
    /** Leap origin and landing point. */
    sx?: number
    sy?: number
    tx?: number
    ty?: number
    tick?: number
}

export interface Player {
    x: number
    y: number
    r: number
    facing: number
    aim: number
    hp: number
    maxHp: number
    weapon: WeaponId
    chain: SwingDef[]
    attack: PlayerAttack | null
    comboIndex: number
    comboTimer: number
    comboHits: number
    buffer: number
    dodge: Dodge | null
    dodgeCharges: number
    dodgeMax: number
    dodgeRecharge: number
    spaceHold: number
    spaceHolding: boolean
    sprinting: boolean
    sprintT: number
    special: SpecialState | null
    specialCd: number
    specialCdMax: number
    invuln: number
    hurtFlash: number
    walk: number
    moving: boolean
    upgrades: Map<string, number>
    lastMoveX: number
    lastMoveY: number
    /** Direct hits landed, for Echo Strike's every-third-hit rhythm. */
    hitCount: number
    bloodlust: number
    bloodlustT: number
    phoenixUsed: number
    /** Airborne height during Sky Fall, for the renderer. */
    z: number
}

export interface EnemyAttack {
    kind: 'melee' | 'charge' | 'shot' | 'slam' | 'spin'
    windup: number
    dir: number
    reach: number
    halfAngle: number
    radius: number
    damage: number
    knockback: number
    recover: number
    tracking: number
    chargeT: number
    chargeDur: number
    chargeSpeed: number
    hit: boolean
    /** Forward lunge on melee release. */
    lunge: number
}

export interface Enemy {
    id: number
    type: EnemyTypeId
    def: EnemyTypeDef
    x: number
    y: number
    vx: number
    vy: number
    hp: number
    maxHp: number
    r: number
    speed: number
    damage: number
    facing: number
    state: 'spawn' | 'chase' | 'windup' | 'attack' | 'recover' | 'stagger' | 'dead'
    stateT: number
    attack: EnemyAttack | null
    attackCd: number
    shield: { hp: number, max: number, broken: boolean } | null
    slow: number
    slowT: number
    frozen: number
    burn: { t: number, dps: number, tick: number } | null
    hitFlash: number
    squash: number
    walk: number
    seed: number
    alive: boolean
    deadT: number
    entered: boolean
    sprintHitCd: number
    wander: number
    /** Remaining stagger time while in the stagger state. */
    stunT: number
}

export interface Particle {
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    life: number
    maxLife: number
    size: number
    color: string
    kind: 'spark' | 'blood' | 'dust' | 'ember' | 'frost' | 'leaf' | 'chip' | 'smoke' | 'petal'
    gravity: number
    decal: boolean
}

export interface Floater {
    x: number
    y: number
    z: number
    text: string
    life: number
    maxLife: number
    color: string
    size: number
    vx: number
}

export interface Trail {
    x: number
    y: number
    angle0: number
    angle1: number
    reach: number
    life: number
    maxLife: number
    color: string
    kind: 'arc' | 'thrust' | 'ring'
    width: number
    z: number
}

export interface Ring {
    x: number
    y: number
    r0: number
    r1: number
    life: number
    maxLife: number
    color: string
    width: number
}

export interface Bolt {
    points: Vec[]
    life: number
    maxLife: number
}

export interface Decal {
    x: number
    y: number
    r: number
    color: string
    kind: 'blood' | 'scorch' | 'crack'
}

export interface Impact {
    x: number
    y: number
    z: number
    life: number
    maxLife: number
    size: number
    color: string
    kind: 'burst' | 'slash' | 'ring'
    angle: number
}

export interface Whirlwind {
    life: number
    maxLife: number
    radius: number
    tick: number
    damage: number
    spin: number
}

export interface Projectile {
    id: number
    x: number
    y: number
    vx: number
    vy: number
    life: number
    damage: number
    r: number
    owner: 'player' | 'enemy'
    pierce: number
    hitIds: Set<number>
    kind: 'thorn' | 'windblade'
    angle: number
}

export interface RunStats {
    kills: number
    damageDealt: number
    damageTaken: number
    highestCombo: number
    time: number
    elitesKilled: number
}

const PLAYER_SPEED = 205
const SPRINT_HOLD = 0.17
const DODGE_DUR = 0.4
const DODGE_DIST = 165
const HURT_GRACE = 0.5
const MAX_PARTICLES = 900
/**
 * Fraction of a swing's recovery that must play out before the next combo
 * input can cancel it. Without this, spam-clicking collapses every swing to
 * windup + active and the sword turns into a buzzsaw.
 */
const CHAIN_POINT = 0.7

export class MeadowbrawlGame {
    phase: Phase = 'menu'
    paused = false
    wave = 0
    world: WorldLayout
    player: Player
    enemies: Enemy[] = []
    projectiles: Projectile[] = []
    particles: Particle[] = []
    floaters: Floater[] = []
    trails: Trail[] = []
    rings: Ring[] = []
    bolts: Bolt[] = []
    decals: Decal[] = []
    whirlwinds: Whirlwind[] = []
    impacts: Impact[] = []
    events: GameEvent[] = []
    offers: Offer[] = []
    shake = 0
    hitstop = 0
    timeScale = 1
    time = 0
    waveElapsed = 0
    calmTimer = 0
    deathT = 0
    spawnQueue: SpawnGroup[] = []
    stats: RunStats = { kills: 0, damageDealt: 0, damageTaken: 0, highestCombo: 0, time: 0, elitesKilled: 0 }
    waveKills = 0
    waveTotal = 0
    finalRush = false
    banner: { text: string, sub: string, t: number } | null = null
    input: InputState = {
        moveX: 0, moveY: 0, aimX: ARENA_W / 2 + 100, aimY: ARENA_H / 2,
        attackPressed: false, attackHeld: false, specialPressed: false,
        spaceDown: false, spacePressed: false, spaceReleased: false
    }

    private nextId = 1
    private ambientT = 0

    constructor() {
        this.world = generateWorld()
        this.player = this.makePlayer('sword')
    }

    // ------------------------------------------------------------------ setup

    private makePlayer(weapon: WeaponId): Player {
        return {
            x: ARENA_W / 2, y: ARENA_H / 2, r: 12, facing: 0, aim: 0,
            hp: 100, maxHp: 100,
            weapon, chain: buildChain(WEAPONS[weapon], 0),
            attack: null, comboIndex: 0, comboTimer: 0, comboHits: 0, buffer: 0,
            dodge: null, dodgeCharges: 1, dodgeMax: 1, dodgeRecharge: 0,
            spaceHold: 0, spaceHolding: false, sprinting: false, sprintT: 0,
            special: null, specialCd: 0, specialCdMax: WEAPONS[weapon].special.cooldown,
            invuln: 0, hurtFlash: 0, walk: 0, moving: false,
            upgrades: new Map(), lastMoveX: 1, lastMoveY: 0,
            hitCount: 0, bloodlust: 0, bloodlustT: 0, phoenixUsed: 0, z: 0
        }
    }

    get weapon(): WeaponDef {
        return WEAPONS[this.player.weapon]
    }

    stack(id: string): number {
        return this.player.upgrades.get(id) ?? 0
    }

    get damageMult(): number {
        const p = this.player
        const berserk = this.stack('berserk') > 0 && p.hp / p.maxHp < 0.5 ? 1 + 0.4 * this.stack('berserk') : 1
        return (1 + 0.15 * this.stack('might')) * (1 + 0.12 * this.stack('oversized')) * berserk
    }

    get attackSpeed(): number {
        return (1 + 0.12 * this.stack('haste')) * (1 + 0.05 * this.player.bloodlust)
    }

    get moveSpeed(): number {
        return (1 + 0.1 * this.stack('swift')) * (1 + 0.05 * this.player.bloodlust)
    }

    get comboWindow(): number {
        return this.weapon.comboWindow * (1 + 0.6 * this.stack('flow'))
    }

    /** Every hit is heavy with the greataxe, the warhammer, or Titan Grip. */
    get allHeavy(): boolean {
        return this.weapon.heavy || this.stack('titangrip') > 0
    }

    get reachMult(): number {
        return 1 + 0.22 * this.stack('oversized')
    }

    get knockbackMult(): number {
        return 1 + 0.35 * this.stack('bruiser')
    }

    startRun(weapon: WeaponId = 'sword') {
        this.world = generateWorld()
        this.player = this.makePlayer(weapon)
        this.enemies = []
        this.projectiles = []
        this.particles = []
        this.floaters = []
        this.trails = []
        this.rings = []
        this.bolts = []
        this.decals = []
        this.whirlwinds = []
        this.impacts = []
        this.events = []
        this.offers = []
        this.shake = 0
        this.hitstop = 0
        this.timeScale = 1
        this.time = 0
        this.deathT = 0
        this.paused = false
        this.stats = { kills: 0, damageDealt: 0, damageTaken: 0, highestCombo: 0, time: 0, elitesKilled: 0 }
        this.wave = 0
        this.nextWave()
    }

    private nextWave() {
        this.wave += 1
        this.waveElapsed = 0
        this.waveKills = 0
        this.spawnQueue = buildWave(this.wave, randomFloat)
        this.waveTotal = this.spawnQueue.reduce((s, g) => s + g.count, 0)
        this.phase = 'wave'
        const elite = this.spawnQueue.some(g => ENEMY_TYPES[g.type].elite)
        this.banner = { text: `Wave ${this.wave}`, sub: this.wave === TOTAL_WAVES ? 'The last stand' : elite ? 'Something big is coming' : '', t: 2.2 }
        this.emit('waveStart')
    }

    chooseOffer(index: number) {
        if (this.phase !== 'upgrade') return
        const offer = this.offers[index]
        if (!offer) return
        this.applyOffer(offer)
        this.offers = []
        this.emit('upgrade')
        this.nextWave()
    }

    applyOffer(offer: Offer) {
        const p = this.player
        if (offer.weapon) {
            p.weapon = offer.weapon
            p.chain = buildChain(WEAPONS[p.weapon], this.stack('comboplus'))
            p.specialCdMax = WEAPONS[p.weapon].special.cooldown * Math.pow(0.75, this.stack('quickspecial'))
            p.specialCd = 0
            p.attack = null
            p.comboIndex = 0
            return
        }
        const id = offer.upgrade.id
        p.upgrades.set(id, (p.upgrades.get(id) ?? 0) + 1)
        switch (id) {
            case 'vigor':
                p.maxHp += 25
                p.hp = Math.min(p.maxHp, p.hp + 25)
                break
            case 'mending':
                p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.5)
                break
            case 'doubledodge':
                p.dodgeMax += 1
                p.dodgeCharges = p.dodgeMax
                break
            case 'comboplus':
                p.chain = buildChain(this.weapon, this.stack('comboplus'))
                break
            case 'quickspecial':
                p.specialCdMax = this.weapon.special.cooldown * Math.pow(0.75, this.stack('quickspecial'))
                p.specialCd = Math.min(p.specialCd, p.specialCdMax)
                break
        }
    }

    restart() {
        this.phase = 'menu'
        this.enemies = []
        this.projectiles = []
        this.particles = []
        this.floaters = []
        this.trails = []
        this.rings = []
        this.bolts = []
        this.whirlwinds = []
        this.impacts = []
        this.timeScale = 1
        this.paused = false
    }

    private emit(type: GameEvent['type'], x?: number, y?: number, power?: number) {
        this.events.push({ type, x, y, power })
    }

    // ----------------------------------------------------------------- update

    update(rawDt: number) {
        rawDt = Math.min(rawDt, 1 / 20)
        this.ambientT += rawDt
        this.spawnAmbient(rawDt)

        if (this.paused) {
            this.clearEdges()
            return
        }

        if (this.phase === 'menu' || this.phase === 'upgrade' || this.phase === 'victory') {
            this.updateEffects(rawDt)
            this.clearEdges()
            return
        }

        let dt = rawDt * this.timeScale
        if (this.hitstop > 0) {
            this.hitstop = Math.max(0, this.hitstop - rawDt)
            dt *= 0.06
        }
        if (this.banner) {
            this.banner.t -= rawDt
            if (this.banner.t <= 0) this.banner = null
        }

        if (this.phase === 'dead') {
            this.deathT += rawDt
            this.timeScale = this.deathT < 1.2 ? 0.22 : 0
            this.updateEnemies(dt)
            this.updateEffects(dt)
            this.clearEdges()
            return
        }

        this.time += dt
        this.stats.time = this.time

        // Sub-step so fast things (dashes, charges) never tunnel.
        const steps = Math.max(1, Math.ceil(dt / (1 / 90)))
        const sub = dt / steps
        for (let i = 0; i < steps; i++) {
            this.updatePlayer(sub, i === 0)
            this.updateSpecial(sub)
            this.updateEnemies(sub)
            this.updateProjectiles(sub)
            this.updateWhirlwinds(sub)
            this.resolveBodies()
        }
        this.updateWave(dt)
        this.updateEffects(dt)
        this.clearEdges()
    }

    private clearEdges() {
        const i = this.input
        i.attackPressed = false
        i.specialPressed = false
        i.spacePressed = false
        i.spaceReleased = false
    }

    // ------------------------------------------------------------------ waves

    private updateWave(dt: number) {
        if (this.phase === 'wave') {
            this.waveElapsed += dt
            while (this.spawnQueue.length && this.spawnQueue[0]!.time <= this.waveElapsed) {
                const g = this.spawnQueue.shift()!
                for (let i = 0; i < g.count; i++) this.spawnEnemy(g.type, g.side)
            }
            if (this.spawnQueue.length === 0 && !this.enemies.some(e => e.alive)) {
                this.phase = 'calm'
                this.calmTimer = 1.7
                this.player.hp = Math.min(this.player.maxHp, this.player.hp + 12)
                this.banner = { text: 'Wave cleared', sub: `${this.waveKills} slain`, t: 1.6 }
                this.emit('waveClear')
            }
        } else if (this.phase === 'calm') {
            this.calmTimer -= dt
            if (this.calmTimer <= 0) {
                if (this.wave >= TOTAL_WAVES) {
                    this.phase = 'victory'
                    this.emit('victory')
                } else {
                    this.offers = rollOffers(this.wave, this.player.upgrades, this.player.weapon)
                    this.phase = 'upgrade'
                }
            }
        }
    }

    spawnEnemy(type: EnemyTypeId, side: SpawnGroup['side']): Enemy {
        const def = ENEMY_TYPES[type]
        const scale = waveScaling(this.wave)
        const p = this.world.spawn[side]()
        p.x += (Math.random() - 0.5) * 60
        p.y += (Math.random() - 0.5) * 40
        // Elites already have deep pools; scale them more gently so a late
        // boss is a fight, not a grind.
        const hpScale = def.elite ? 1 + (scale.hp - 1) * 0.6 : scale.hp
        const e: Enemy = {
            id: this.nextId++,
            type,
            def,
            x: p.x, y: p.y, vx: 0, vy: 0,
            hp: def.hp * hpScale, maxHp: def.hp * hpScale,
            r: def.radius,
            speed: def.speed * scale.speed * (0.92 + Math.random() * 0.16),
            damage: def.damage * scale.damage,
            facing: angleTo(p, this.player),
            state: 'spawn', stateT: 0,
            attack: null, attackCd: 0.6 + Math.random() * 0.8,
            shield: def.shield ? { hp: def.shield * hpScale, max: def.shield * hpScale, broken: false } : null,
            slow: 0, slowT: 0, frozen: 0, burn: null,
            hitFlash: 0, squash: 0, walk: Math.random() * 10, seed: Math.random(),
            alive: true, deadT: 0, entered: false, sprintHitCd: 0,
            wander: Math.random() * Math.PI * 2, stunT: 0
        }
        this.enemies.push(e)
        this.burst(e.x, e.y, 0, 8, 'dust', '#b9a77a', 60, 0.5)
        if (def.elite) {
            this.banner = { text: def.name, sub: 'Elite', t: 2 }
            this.emit('eliteSpawn', e.x, e.y)
            this.shake = Math.max(this.shake, 8)
        }
        return e
    }

    // ----------------------------------------------------------------- player

    private updatePlayer(dt: number, first: boolean) {
        const p = this.player
        const input = this.input

        p.invuln = Math.max(0, p.invuln - dt)
        p.hurtFlash = Math.max(0, p.hurtFlash - dt)
        if (p.bloodlust > 0) {
            p.bloodlustT -= dt
            if (p.bloodlustT <= 0) {
                p.bloodlust = 0
            }
        }
        p.specialCd = Math.max(0, p.specialCd - dt)
        // A click during the swing itself is queued until recovery, so slow
        // weapons chain from an early press instead of eating the input.
        if (!p.attack || (p.attack.phase === 'recovery' && p.attack.t >= p.attack.recovery * CHAIN_POINT)) p.buffer = Math.max(0, p.buffer - dt)
        if (p.dodgeCharges < p.dodgeMax) {
            p.dodgeRecharge += dt
            if (p.dodgeRecharge >= 1.15) {
                p.dodgeRecharge = 0
                p.dodgeCharges += 1
            }
        }
        if (p.comboTimer > 0 && !p.attack) {
            p.comboTimer -= dt
            if (p.comboTimer <= 0) {
                p.comboIndex = 0
                p.comboHits = 0
            }
        }

        p.aim = Math.atan2(input.aimY - p.y, input.aimX - p.x)
        if (p.special?.kind !== 'leap') p.z = 0

        // Space: tap = dodge (on release), hold = sprint after a short wind-up.
        if (first) {
            if (input.spacePressed) {
                p.spaceHolding = true
                p.spaceHold = 0
            }
            if (input.attackPressed) p.buffer = 0.3
        }
        if (p.spaceHolding) {
            p.spaceHold += dt
            if (p.spaceHold >= SPRINT_HOLD && !p.sprinting && !p.dodge && !p.special) {
                this.startSprint()
            }
        }
        if (first && input.spaceReleased) {
            if (p.spaceHolding && p.spaceHold < SPRINT_HOLD) this.tryDodge()
            p.spaceHolding = false
            if (p.sprinting) {
                p.sprinting = false
                p.sprintT = 0
            }
        }
        if (!input.spaceDown && p.sprinting) {
            p.sprinting = false
            p.sprintT = 0
        }

        // Special: right click.
        if (first && input.specialPressed && p.specialCd <= 0 && !p.dodge && !p.special) {
            this.startSpecial()
        }

        // Attacks and combo chaining.
        if (p.buffer > 0 && !p.dodge && !p.special) {
            const a = p.attack
            if (!a) {
                if (p.sprinting) {
                    p.sprinting = false
                    p.sprintT = 0
                    // Holding space through an attack shouldn't yank you
                    // straight back into a sprint and cancel the swing.
                    p.spaceHolding = false
                }
                const idx = p.comboTimer > 0 ? p.comboIndex : 0
                this.startSwing(idx)
                p.buffer = 0
            } else if (a.phase === 'recovery' && a.t >= a.recovery * CHAIN_POINT) {
                this.startSwing(a.index + 1 >= p.chain.length ? 0 : a.index + 1)
                p.buffer = 0
            }
        }

        // Movement.
        let mx = input.moveX
        let my = input.moveY
        const ml = Math.hypot(mx, my)
        if (ml > 0) {
            mx /= ml
            my /= ml
            p.lastMoveX = mx
            p.lastMoveY = my
        }
        p.moving = ml > 0
        let speed = PLAYER_SPEED * this.moveSpeed
        let vx = 0
        let vy = 0

        if (p.dodge) {
            const d = p.dodge
            d.t += dt
            const k = d.t / d.dur
            // Ease-out: most of the distance early, then settle.
            const s = (1 - k) * (1 - k) * 3 * DODGE_DIST / d.dur
            vx = d.dx * s
            vy = d.dy * s
            p.invuln = Math.max(p.invuln, d.t < 0.3 ? 0.02 : 0)
            if (k > 0.1 && k < 0.7 && Math.random() < 0.6) {
                this.puff(p.x - d.dx * 8, p.y - d.dy * 8, 1, '#c9b98c')
            }
            if (d.t >= d.dur) {
                p.dodge = null
                const rt = this.stack('rollingthunder')
                if (rt > 0) this.thunderclap(p.x, p.y, 90 + 20 * rt, this.weapon.baseDamage * this.damageMult * (0.8 + 0.3 * (rt - 1)))
            }
        } else if (p.attack) {
            const a = p.attack
            a.t += dt
            const commit = a.phase === 'recovery' ? 0.55 : 0.2
            vx = mx * speed * commit
            vy = my * speed * commit
            if (a.phase !== 'recovery') {
                const stepSpeed = a.def.step / (a.windup + a.active)
                vx += Math.cos(a.dir) * stepSpeed
                vy += Math.sin(a.dir) * stepSpeed
            }
            this.advanceSwing(a)
        } else if (p.special?.kind === 'whirl') {
            vx = mx * speed * 0.55
            vy = my * speed * 0.55
        } else if (p.special && p.special.kind !== 'dash') {
            // Rooted during slams, sweeps and the leap.
        } else if (p.special?.kind === 'dash') {
            // Dash movement is applied in updateSpecial.
        } else {
            if (p.sprinting) {
                p.sprintT += dt
                const ramp = clamp(p.sprintT / 0.28, 0, 1)
                speed *= 1 + 0.75 * ramp * ramp
                if (ml > 0 && Math.random() < 0.5) this.puff(p.x - mx * 10, p.y - my * 10, 1, '#c9b98c')
                if (ml === 0) {
                    p.sprinting = false
                    p.sprintT = 0
                }
            }
            vx = mx * speed
            vy = my * speed
        }

        if (p.sprinting && this.stack('sprintcharge') > 0 && p.sprintT > 0.28) this.sprintContact()

        p.x += vx * dt
        p.y += vy * dt
        if (p.moving || p.dodge) p.walk += dt * (p.sprinting ? 16 : 11)
        if (!p.attack && !p.dodge) p.facing = p.moving && !p.sprinting ? p.aim : p.moving ? Math.atan2(my, mx) : p.aim
        else if (p.attack) p.facing = p.attack.dir
        this.collidePlayer()
    }

    private collidePlayer() {
        const p = this.player
        p.x = clamp(p.x, p.r, ARENA_W - p.r)
        p.y = clamp(p.y, p.r, ARENA_H - p.r)
        for (const o of this.world.obstacles) {
            const dx = p.x - o.x
            const dy = p.y - o.y
            const d = Math.hypot(dx, dy)
            const min = o.r + p.r
            if (d < min && d > 0) {
                p.x = o.x + dx / d * min
                p.y = o.y + dy / d * min
            }
        }
    }

    private tryDodge() {
        const p = this.player
        if (p.dodgeCharges <= 0 || p.dodge || p.special) return
        p.dodgeCharges -= 1
        let dx = this.input.moveX
        let dy = this.input.moveY
        const l = Math.hypot(dx, dy)
        if (l === 0) {
            dx = Math.cos(p.aim)
            dy = Math.sin(p.aim)
        } else {
            dx /= l
            dy /= l
        }
        p.dodge = { t: 0, dur: DODGE_DUR, dx, dy }
        // Dodging cancels the combo — the tactical cost.
        p.attack = null
        p.comboIndex = 0
        p.comboTimer = 0
        p.comboHits = 0
        p.sprinting = false
        p.sprintT = 0
        p.facing = Math.atan2(dy, dx)
        this.burst(p.x, p.y, 0, 6, 'dust', '#cbbd93', 80, 0.45)
        this.emit('dodge', p.x, p.y)
    }

    private startSprint() {
        const p = this.player
        p.sprinting = true
        p.sprintT = 0
        p.attack = null
        p.comboIndex = 0
        p.comboTimer = 0
        p.comboHits = 0
        this.emit('sprint', p.x, p.y)
    }

    private startSwing(index: number) {
        const p = this.player
        const def = p.chain[index]!
        const as = this.attackSpeed
        p.attack = {
            index, def, t: 0, phase: 'windup', dir: p.aim, hitIds: new Set(),
            windup: def.windup / as, active: def.active / as, recovery: def.recovery / as, landed: false
        }
        p.comboIndex = index
        p.comboTimer = 0
        p.facing = p.aim
        this.emit('swing', p.x, p.y, def.finisher ? 1 : 0.5)
    }

    private advanceSwing(a: PlayerAttack) {
        const p = this.player
        if (a.phase === 'windup') {
            // Track the mouse through the anticipation so aiming feels tight.
            a.dir = a.dir + normalizeAngle(p.aim - a.dir) * Math.min(1, 12 * (a.t / a.windup))
            if (a.t >= a.windup) {
                a.phase = 'active'
                a.t = 0
                this.onSwingActive(a)
            }
        }
        if (a.phase === 'active') {
            for (const e of this.enemies) {
                if (!e.alive || a.hitIds.has(e.id)) continue
                if (shapeHits(a.def.shape, p, a.dir, this.reachMult, e, e.r)) {
                    a.hitIds.add(e.id)
                    this.playerHitEnemy(e, a.def)
                }
            }
            if (a.t >= a.active) {
                a.phase = 'recovery'
                a.t = 0
            }
        }
        if (a.phase === 'recovery' && a.t >= a.recovery) {
            const finished = a.index + 1 >= p.chain.length
            p.attack = null
            p.comboIndex = finished ? 0 : a.index + 1
            // The hit counter survives a finisher as long as you keep swinging.
            p.comboTimer = this.comboWindow
        }
    }

    private onSwingActive(a: PlayerAttack) {
        const p = this.player
        const shape = a.def.shape
        const reach = this.reachMult
        if (shape.kind === 'arc') {
            const half = shape.halfAngle
            this.trails.push({
                x: p.x, y: p.y, angle0: a.dir - half * a.def.sweep, angle1: a.dir + half * a.def.sweep,
                reach: shape.reach * reach, life: 0.22, maxLife: 0.22, color: this.weapon.color, kind: 'arc',
                width: a.def.finisher ? 30 : 20, z: 16
            })
        } else if (shape.kind === 'thrust') {
            this.trails.push({
                x: p.x, y: p.y, angle0: a.dir, angle1: a.dir, reach: shape.reach * reach,
                life: 0.18, maxLife: 0.18, color: this.weapon.color, kind: 'thrust', width: shape.width * reach, z: 16
            })
        }
        if (a.def.finisher && this.stack('whirlwind') > 0) {
            const s = this.stack('whirlwind')
            this.whirlwinds.push({
                life: 0.7 + 0.25 * (s - 1), maxLife: 0.7 + 0.25 * (s - 1), radius: (95 + 10 * s) * reach,
                tick: 0, damage: this.weapon.baseDamage * this.damageMult * 0.4, spin: 0
            })
        }
        const proj = this.stack('projectile')
        if (proj > 0) {
            this.projectiles.push({
                id: this.nextId++, x: p.x + Math.cos(a.dir) * 20, y: p.y + Math.sin(a.dir) * 20,
                vx: Math.cos(a.dir) * 560, vy: Math.sin(a.dir) * 560, life: 0.75,
                damage: this.weapon.baseDamage * this.damageMult * a.def.damage * (0.5 + 0.15 * (proj - 1)),
                r: 14, owner: 'player', pierce: proj, hitIds: new Set(), kind: 'windblade', angle: a.dir
            })
        }
    }

    private playerHitEnemy(e: Enemy, def: SwingDef) {
        const p = this.player
        const heavy = !!def.finisher || this.allHeavy
        const flow = this.stack('flow') > 0 ? 1 + Math.min(10, p.comboHits) * 0.06 * this.stack('flow') : 1
        const crit = this.stack('crit') > 0 && randomChance(0.15 * this.stack('crit'))
        const dmg = this.weapon.baseDamage * this.damageMult * def.damage * flow * (crit ? 2.5 : 1)
        const dealt = this.damageEnemy(e, dmg, {
            source: p, heavy, knockback: def.knockback * (crit ? 1.4 : 1), stagger: def.stagger, tag: 'melee', crit
        })
        if (dealt > 0) {
            p.comboHits += 1
            this.stats.highestCombo = Math.max(this.stats.highestCombo, p.comboHits)
            p.hitCount += 1
            const echo = this.stack('echo')
            if (echo > 0 && p.hitCount % 3 === 0 && e.alive) {
                this.damageEnemy(e, dmg * (0.7 + 0.15 * (echo - 1)), { source: p, heavy, knockback: def.knockback * 0.5, stagger: def.stagger, tag: 'echo', color: '#9fe3ff' })
                this.impacts.push({ x: e.x, y: e.y, z: e.def.height * 0.5, life: 0.25, maxLife: 0.25, size: 26, color: '#9fe3ff', kind: 'slash', angle: p.aim + 0.8 })
            }
        }
    }

    // ---------------------------------------------------------------- special

    private startSpecial() {
        const p = this.player
        const w = this.weapon
        p.attack = null
        p.comboIndex = 0
        p.comboTimer = 0
        p.sprinting = false
        p.sprintT = 0
        p.specialCd = p.specialCdMax
        const dx = Math.cos(p.aim)
        const dy = Math.sin(p.aim)
        p.facing = p.aim
        this.emit('special', p.x, p.y)
        const gravity = this.stack('gravity')
        if (gravity > 0) {
            const radius = 240 + 60 * (gravity - 1)
            this.rings.push({ x: p.x, y: p.y, r0: radius, r1: 10, life: 0.35, maxLife: 0.35, color: '#c9a3ff', width: 6 })
            for (const e of this.enemies) {
                if (!e.alive || e.def.elite) continue
                const d = Math.hypot(e.x - p.x, e.y - p.y)
                if (d < radius && d > 1) {
                    const pull = Math.min(d - e.r - p.r - 10, 900)
                    e.vx += (p.x - e.x) / d * pull * 2.2
                    e.vy += (p.y - e.y) / d * pull * 2.2
                    this.setStagger(e, 0.35, true)
                }
            }
        }
        switch (w.special.kind) {
            case 'leap': {
                const dist = Math.min(320, Math.hypot(this.input.aimX - p.x, this.input.aimY - p.y))
                const tx = clamp(p.x + dx * dist, p.r, ARENA_W - p.r)
                const ty = clamp(p.y + dy * dist, p.r, ARENA_H - p.r)
                p.special = { kind: 'leap', t: 0, dur: 0.5, dx, dy, hitIds: new Set(), fired: false, sx: p.x, sy: p.y, tx, ty }
                p.invuln = Math.max(p.invuln, 0.55)
                this.burst(p.x, p.y, 0, 10, 'dust', '#cbbd93', 120, 0.45)
                this.emit('leap', p.x, p.y)
                break
            }
            case 'whirl':
                p.special = { kind: 'whirl', t: 0, dur: 1.0, dx, dy, hitIds: new Set(), fired: false, tick: 0 }
                break
            case 'dash':
                p.special = { kind: 'dash', t: 0, dur: 0.22, dx, dy, hitIds: new Set(), fired: false }
                p.invuln = Math.max(p.invuln, 0.3)
                this.burst(p.x, p.y, 4, 10, 'dust', '#d6c79a', 120, 0.4)
                break
            case 'slam':
                p.special = { kind: 'slam', t: 0, dur: 0.42, dx, dy, hitIds: new Set(), fired: false }
                break
            case 'sweep':
                p.special = { kind: 'sweep', t: 0, dur: 0.2, dx, dy, hitIds: new Set(), fired: false }
                break
            case 'blink': {
                let best: Enemy | null = null
                let bestD = 440
                for (const e of this.enemies) {
                    if (!e.alive) continue
                    const d = Math.hypot(e.x - p.x, e.y - p.y)
                    if (d < bestD) {
                        bestD = d
                        best = e
                    }
                }
                this.burst(p.x, p.y, 6, 12, 'smoke', '#3a2f4a', 70, 0.5)
                if (best) {
                    const behind = best.facing + Math.PI
                    p.x = best.x + Math.cos(behind) * (best.r + 20)
                    p.y = best.y + Math.sin(behind) * (best.r + 20)
                    this.collidePlayer()
                    p.aim = angleTo(p, best)
                    p.facing = p.aim
                    p.special = { kind: 'backstab', t: 0, dur: 0.08, dx: Math.cos(p.aim), dy: Math.sin(p.aim), hitIds: new Set(), fired: false, targetId: best.id }
                } else {
                    p.x += dx * 180
                    p.y += dy * 180
                    this.collidePlayer()
                    p.special = null
                }
                p.invuln = Math.max(p.invuln, 0.35)
                this.burst(p.x, p.y, 6, 12, 'smoke', '#3a2f4a', 70, 0.5)
                break
            }
        }
    }

    private updateSpecial(dt: number) {
        const p = this.player
        const s = p.special
        if (!s) return
        s.t += dt
        const w = this.weapon
        const base = w.baseDamage * this.damageMult * w.special.damage
        switch (s.kind) {
            case 'dash': {
                const speed = 250 / s.dur
                const ox = p.x
                const oy = p.y
                p.x += s.dx * speed * dt
                p.y += s.dy * speed * dt
                this.collidePlayer()
                for (const e of this.enemies) {
                    if (!e.alive || s.hitIds.has(e.id)) continue
                    if (inSegment({ x: ox, y: oy }, p, 34 * this.reachMult, e, e.r)) {
                        s.hitIds.add(e.id)
                        this.damageEnemy(e, base, { source: { x: e.x - s.dx * 10, y: e.y - s.dy * 10 }, heavy: true, knockback: 220, stagger: 0.5, tag: 'special' })
                    }
                }
                this.trails.push({ x: ox, y: oy, angle0: p.aim, angle1: p.aim, reach: Math.hypot(p.x - ox, p.y - oy) + 6, life: 0.2, maxLife: 0.2, color: w.color, kind: 'thrust', width: 40, z: 14 })
                if (s.t >= s.dur) p.special = null
                break
            }
            case 'slam':
                if (!s.fired && s.t >= s.dur) {
                    s.fired = true
                    const radius = 150 * this.reachMult
                    this.rings.push({ x: p.x, y: p.y, r0: 20, r1: radius + 20, life: 0.4, maxLife: 0.4, color: '#e8dcc0', width: 12 })
                    this.decals.push({ x: p.x, y: p.y, r: 34, color: '#4a3a2a', kind: 'crack' })
                    this.burst(p.x, p.y, 0, 26, 'dust', '#bfae83', 220, 0.7)
                    this.burst(p.x, p.y, 0, 10, 'chip', '#6b5a48', 260, 0.6)
                    this.shake = Math.max(this.shake, 16)
                    this.hitstop = Math.max(this.hitstop, 0.08)
                    for (const e of this.enemies) {
                        if (!e.alive) continue
                        if (inCircle(p, radius, e, e.r)) {
                            this.damageEnemy(e, base, { source: p, heavy: true, knockback: 400, stagger: 1.0, tag: 'special', bypassShield: true })
                        }
                    }
                }
                if (s.t >= s.dur + 0.35) p.special = null
                break
            case 'sweep':
                if (!s.fired && s.t >= s.dur) {
                    s.fired = true
                    const radius = 130 * this.reachMult
                    this.trails.push({ x: p.x, y: p.y, angle0: p.aim, angle1: p.aim + Math.PI * 2, reach: radius, life: 0.3, maxLife: 0.3, color: w.color, kind: 'ring', width: 28, z: 16 })
                    this.shake = Math.max(this.shake, 6)
                    for (const e of this.enemies) {
                        if (!e.alive) continue
                        if (inCircle(p, radius, e, e.r)) {
                            this.damageEnemy(e, base, { source: p, heavy: true, knockback: 280, stagger: 0.55, tag: 'special' })
                        }
                    }
                }
                if (s.t >= s.dur + 0.3) p.special = null
                break
            case 'leap': {
                const k = clamp(s.t / s.dur, 0, 1)
                const ease = k * k * (3 - 2 * k)
                p.x = s.sx! + (s.tx! - s.sx!) * ease
                p.y = s.sy! + (s.ty! - s.sy!) * ease
                p.z = k >= 1 ? 0 : Math.sin(k * Math.PI) * 120
                this.collidePlayer()
                if (!s.fired && s.t >= s.dur) {
                    s.fired = true
                    p.z = 0
                    const radius = 140 * this.reachMult
                    this.rings.push({ x: p.x, y: p.y, r0: 20, r1: radius + 20, life: 0.4, maxLife: 0.4, color: '#f3e3b6', width: 14 })
                    this.decals.push({ x: p.x, y: p.y, r: 40, color: '#4a3a2a', kind: 'crack' })
                    this.burst(p.x, p.y, 0, 30, 'dust', '#bfae83', 240, 0.7)
                    this.burst(p.x, p.y, 0, 12, 'chip', '#6b5a48', 280, 0.6)
                    this.shake = Math.max(this.shake, 18)
                    this.hitstop = Math.max(this.hitstop, 0.09)
                    for (const e of this.enemies) {
                        if (!e.alive) continue
                        if (inCircle(p, radius, e, e.r)) {
                            this.damageEnemy(e, base, { source: p, heavy: true, knockback: 440, stagger: 1.0, tag: 'special', bypassShield: true })
                        }
                    }
                }
                if (s.t >= s.dur + 0.3) p.special = null
                break
            }
            case 'whirl': {
                s.tick = (s.tick ?? 0) - dt
                const radius = 120 * this.reachMult
                if (s.tick <= 0) {
                    s.tick = 0.15
                    this.trails.push({ x: p.x, y: p.y, angle0: p.aim + s.t * 14, angle1: p.aim + s.t * 14 + 2.4, reach: radius, life: 0.16, maxLife: 0.16, color: w.color, kind: 'arc', width: 26, z: 16 })
                    for (const e of this.enemies) {
                        if (!e.alive) continue
                        if (inCircle(p, radius, e, e.r)) {
                            this.damageEnemy(e, base, { source: p, heavy: true, knockback: 40, stagger: 0.3, tag: 'special' })
                        }
                    }
                }
                // Drag everything nearby into the blade.
                for (const e of this.enemies) {
                    if (!e.alive || e.def.elite) continue
                    const d = Math.hypot(e.x - p.x, e.y - p.y)
                    if (d < radius * 2.2 && d > e.r + p.r) {
                        e.vx += (p.x - e.x) / d * 420 * dt * 4
                        e.vy += (p.y - e.y) / d * 420 * dt * 4
                    }
                }
                p.facing = p.aim + s.t * 14
                if (s.t >= s.dur) p.special = null
                break
            }
            case 'backstab':
                if (!s.fired && s.t >= s.dur) {
                    s.fired = true
                    this.trails.push({ x: p.x, y: p.y, angle0: p.aim - 1.2, angle1: p.aim + 1.2, reach: 62 * this.reachMult, life: 0.2, maxLife: 0.2, color: w.color, kind: 'arc', width: 24, z: 18 })
                    for (const e of this.enemies) {
                        if (!e.alive) continue
                        if (inArc(p, p.aim, 1.4, 64 * this.reachMult, e, e.r)) {
                            this.damageEnemy(e, base, { source: p, heavy: true, knockback: 160, stagger: 0.7, tag: 'special', bypassShield: true })
                        }
                    }
                }
                if (s.t >= s.dur + 0.18) p.special = null
                break
        }
    }

    private sprintContact() {
        const p = this.player
        const s = this.stack('sprintcharge')
        for (const e of this.enemies) {
            if (!e.alive || e.sprintHitCd > 0) continue
            if (Math.hypot(e.x - p.x, e.y - p.y) <= e.r + p.r + 8) {
                e.sprintHitCd = 0.7
                const dmg = this.weapon.baseDamage * this.damageMult * (0.7 + 0.3 * (s - 1))
                this.damageEnemy(e, dmg, { source: p, heavy: true, knockback: 360, stagger: 0.5, tag: 'sprint' })
            }
        }
    }

    // ----------------------------------------------------------------- damage

    damageEnemy(e: Enemy, amount: number, opts: {
        source: Vec
        heavy?: boolean
        knockback?: number
        stagger?: number
        tag: 'melee' | 'special' | 'proj' | 'sprint' | 'whirl' | 'shock' | 'lightning' | 'burn' | 'explode' | 'echo' | 'thorns' | 'thunder' | 'blossom'
        bypassShield?: boolean
        color?: string
        crit?: boolean
    }): number {
        if (!e.alive) return 0
        const heavy = !!opts.heavy
        const angleFromEnemy = angleTo(e, opts.source)
        const direct = opts.tag === 'melee' || opts.tag === 'special' || opts.tag === 'proj' || opts.tag === 'sprint' || opts.tag === 'whirl' || opts.tag === 'echo' || opts.tag === 'blossom'
        // Echoes and blossoms are already the product of a proc; they hit
        // hard but don't cascade.
        const procs = opts.tag === 'melee' || opts.tag === 'special' || opts.tag === 'proj' || opts.tag === 'sprint' || opts.tag === 'whirl'

        if (e.shield && !e.shield.broken && !opts.bypassShield && direct) {
            const facingDiff = Math.abs(normalizeAngle(angleFromEnemy - e.facing))
            if (facingDiff < 1.15) {
                if (heavy) {
                    e.shield.hp -= amount
                    this.burst(e.x + Math.cos(angleFromEnemy) * e.r, e.y + Math.sin(angleFromEnemy) * e.r, 14, 10, 'spark', '#ffe9a8', 200, 0.3)
                    if (e.shield.hp <= 0) {
                        e.shield.broken = true
                        this.floaters.push({ x: e.x, y: e.y, z: e.def.height + 6, text: 'BREAK', life: 0.9, maxLife: 0.9, color: '#ffd166', size: 18, vx: 0 })
                        this.burst(e.x, e.y, 16, 14, 'chip', '#8c7a5a', 200, 0.6)
                        this.setStagger(e, 1.0, true)
                        this.hitstop = Math.max(this.hitstop, 0.07)
                        this.shake = Math.max(this.shake, 7)
                        this.emit('shieldBreak', e.x, e.y)
                    } else {
                        this.setStagger(e, 0.15, true)
                        this.hitstop = Math.max(this.hitstop, 0.03)
                        this.emit('block', e.x, e.y)
                    }
                } else {
                    this.floaters.push({ x: e.x, y: e.y, z: e.def.height, text: 'BLOCK', life: 0.5, maxLife: 0.5, color: '#c9d1dc', size: 12, vx: 0 })
                    this.burst(e.x + Math.cos(angleFromEnemy) * e.r, e.y + Math.sin(angleFromEnemy) * e.r, 14, 5, 'spark', '#ffffff', 140, 0.22)
                    this.emit('block', e.x, e.y)
                }
                return 0
            }
        }

        let dmg = amount
        if (e.frozen > 0) dmg *= 1.25
        const execute = this.stack('execute')
        let executed = false
        if (execute > 0 && direct) {
            if (e.def.elite) {
                if (e.hp / e.maxHp < 0.3) dmg *= 1.5
            } else if (e.hp / e.maxHp < 0.2 + 0.05 * (execute - 1) && dmg < e.hp) {
                dmg = e.hp
                executed = true
            }
        }
        dmg = Math.round(dmg)
        e.hp -= dmg
        e.hitFlash = 0.12
        e.squash = 1
        this.stats.damageDealt += dmg

        const color = opts.crit ? '#ffcc33' : opts.color ?? (opts.tag === 'burn' ? '#ff9a3c' : opts.tag === 'lightning' ? '#c9a3ff' : opts.tag === 'explode' ? '#ffb347' : opts.tag === 'thunder' ? '#dcc8ff' : heavy ? '#ffe066' : '#ffffff')
        const size = opts.crit ? 26 : opts.tag === 'burn' ? 11 : heavy ? 20 : 14 + Math.min(6, dmg / 20)
        if (executed) {
            this.floaters.push({ x: e.x, y: e.y, z: e.def.height + 8, text: 'EXECUTED', life: 0.9, maxLife: 0.9, color: '#ff5d6c', size: 15, vx: 0 })
            this.emit('execute', e.x, e.y)
        } else {
            this.floaters.push({ x: e.x + (Math.random() - 0.5) * 14, y: e.y, z: e.def.height + 4, text: opts.crit ? `${dmg}!` : String(dmg), life: opts.crit ? 1 : 0.8, maxLife: opts.crit ? 1 : 0.8, color, size, vx: (Math.random() - 0.5) * 30 })
        }
        if (opts.crit) this.emit('crit', e.x, e.y)

        const kbDir = angleFromEnemy + Math.PI
        const kb = (opts.knockback ?? 0) * this.knockbackMult * (e.def.elite ? 0.3 : 1)
        e.vx += Math.cos(kbDir) * kb
        e.vy += Math.sin(kbDir) * kb
        if (opts.stagger) this.setStagger(e, opts.stagger * (1 + 0.35 * this.stack('bruiser')), heavy)

        if (direct) {
            const big = heavy || !!opts.crit
            this.burst(e.x, e.y, e.def.height * 0.5, big ? 12 : 6, 'blood', '#a3121f', big ? 160 : 110, 0.6, kbDir)
            this.burst(e.x, e.y, e.def.height * 0.5, big ? 8 : 4, 'spark', '#fff2c4', 200, 0.25, kbDir)
            const hx = e.x + Math.cos(angleFromEnemy) * e.r * 0.6
            const hy = e.y + Math.sin(angleFromEnemy) * e.r * 0.6
            this.impacts.push({ x: hx, y: hy, z: e.def.height * 0.55, life: big ? 0.22 : 0.14, maxLife: big ? 0.22 : 0.14, size: big ? 24 : 14, color: opts.crit ? '#ffcc33' : '#ffffff', kind: 'burst', angle: kbDir })
            if (opts.tag === 'melee' || opts.tag === 'special') this.impacts.push({ x: hx, y: hy, z: e.def.height * 0.55, life: 0.16, maxLife: 0.16, size: big ? 30 : 20, color: '#ffffff', kind: 'slash', angle: kbDir + (Math.random() - 0.5) * 1.2 })
            this.hitstop = Math.max(this.hitstop, (0.03 + Math.min(0.08, dmg / 320)) * (big ? 1.4 : 1))
            this.shake = Math.max(this.shake, 1.5 + Math.min(10, dmg / 12) + (big ? 3 : 0))
            this.emit(heavy ? 'heavyHit' : 'hit', e.x, e.y, Math.min(1, dmg / 60))
            if (procs) this.onHitProcs(e, dmg, opts.tag)
        } else if (opts.tag === 'explode' || opts.tag === 'shock') {
            this.burst(e.x, e.y, e.def.height * 0.5, 4, 'blood', '#a3121f', 100, 0.5)
        }

        if (e.hp <= 0) this.killEnemy(e, kbDir, heavy)
        return dmg
    }

    private setStagger(e: Enemy, seconds: number, heavy: boolean) {
        if (e.def.poise && !heavy) return
        const dur = e.def.poise ? seconds * 0.5 : seconds
        if (e.state === 'dead' || e.state === 'spawn') return
        e.stunT = Math.max(e.state === 'stagger' ? e.stunT - e.stateT : 0, dur)
        e.state = 'stagger'
        e.stateT = 0
        e.attack = null
    }

    private onHitProcs(e: Enemy, dmg: number, tag: string) {
        const p = this.player
        const ls = this.stack('lifesteal')
        if (ls > 0) {
            const heal = dmg * 0.06 * ls
            if (p.hp < p.maxHp) {
                p.hp = Math.min(p.maxHp, p.hp + heal)
                if (Math.random() < 0.3) this.burst(p.x, p.y, 20, 2, 'petal', '#ff6b8a', 30, 0.6)
            }
        }
        const burn = this.stack('burn')
        if (burn > 0) {
            e.burn = { t: 4, dps: this.weapon.baseDamage * this.damageMult * 0.22 * burn, tick: e.burn?.tick ?? 0.3 }
            this.burst(e.x, e.y, 10, 3, 'ember', '#ff8c2a', 60, 0.6)
            if (tag === 'melee') this.emit('burn', e.x, e.y)
        }
        const freeze = this.stack('freeze')
        if (freeze > 0) {
            e.slow = Math.max(e.slow, 0.45 + 0.15 * (freeze - 1))
            e.slowT = 1.6
            this.burst(e.x, e.y, 12, 3, 'frost', '#bfefff', 60, 0.5)
            if (freeze >= 3 && e.frozen <= 0 && !e.def.elite && randomChance(0.25)) {
                e.frozen = 1.1
                e.attack = null
                this.floaters.push({ x: e.x, y: e.y, z: e.def.height + 8, text: 'FROZEN', life: 0.8, maxLife: 0.8, color: '#bfefff', size: 13, vx: 0 })
                this.emit('freeze', e.x, e.y)
            }
        }
        const shock = this.stack('shockwave')
        if (shock > 0 && tag !== 'whirl' && randomChance(0.25 + 0.12 * (shock - 1))) {
            const radius = 85
            this.rings.push({ x: e.x, y: e.y, r0: 10, r1: radius, life: 0.3, maxLife: 0.3, color: '#f3e3b6', width: 8 })
            this.burst(e.x, e.y, 0, 8, 'dust', '#bba97e', 120, 0.4)
            this.shake = Math.max(this.shake, 5)
            for (const o of this.enemies) {
                if (!o.alive || o === e) continue
                if (inCircle(e, radius, o, o.r)) {
                    this.damageEnemy(o, dmg * (0.4 + 0.1 * (shock - 1)), { source: e, knockback: 200, stagger: 0.3, tag: 'shock', bypassShield: true })
                }
            }
        }
        const lightning = this.stack('lightning')
        if (lightning > 0 && tag !== 'whirl') {
            const jumps = 1 + lightning
            const visited = new Set<number>([e.id])
            let from: Enemy = e
            const points: Vec[] = [{ x: e.x, y: e.y }]
            for (let i = 0; i < jumps; i++) {
                let best: Enemy | null = null
                let bestD = 175
                for (const o of this.enemies) {
                    if (!o.alive || visited.has(o.id)) continue
                    const d = Math.hypot(o.x - from.x, o.y - from.y)
                    if (d < bestD) {
                        bestD = d
                        best = o
                    }
                }
                if (!best) break
                visited.add(best.id)
                points.push({ x: best.x, y: best.y })
                this.damageEnemy(best, dmg * 0.35, { source: from, knockback: 40, stagger: 0.15, tag: 'lightning', bypassShield: true })
                from = best
            }
            if (points.length > 1) {
                this.bolts.push({ points, life: 0.22, maxLife: 0.22 })
                this.emit('lightning', e.x, e.y)
            }
        }
    }

    private killEnemy(e: Enemy, dir: number, heavy: boolean) {
        e.alive = false
        e.state = 'dead'
        e.deadT = 0
        e.attack = null
        e.vx += Math.cos(dir) * (heavy ? 160 : 80)
        e.vy += Math.sin(dir) * (heavy ? 160 : 80)
        this.stats.kills += 1
        this.waveKills += 1
        if (e.def.elite) this.stats.elitesKilled += 1
        this.burst(e.x, e.y, e.def.height * 0.4, e.def.elite ? 40 : 16, 'blood', '#8f0f1c', e.def.elite ? 220 : 150, 0.9, dir)
        this.decals.push({ x: e.x, y: e.y, r: e.def.elite ? 46 : 16 + e.r, color: 'rgba(120,10,20,0.55)', kind: 'blood' })
        this.hitstop = Math.max(this.hitstop, e.def.elite ? 0.16 : 0.05)
        this.shake = Math.max(this.shake, e.def.elite ? 18 : 4)
        this.emit('kill', e.x, e.y, e.def.elite ? 1 : 0.4)
        this.impacts.push({ x: e.x, y: e.y, z: e.def.height * 0.5, life: 0.3, maxLife: 0.3, size: e.def.elite ? 70 : 34, color: '#ffffff', kind: 'ring', angle: 0 })

        const p = this.player
        const bloodlust = this.stack('bloodlust')
        if (bloodlust > 0) {
            p.bloodlust = Math.min(10, p.bloodlust + bloodlust)
            p.bloodlustT = 4
        }
        const overcharge = this.stack('overcharge')
        if (overcharge > 0 && p.specialCd > 0 && randomChance(0.2 * overcharge)) {
            p.specialCd = 0
            this.floaters.push({ x: p.x, y: p.y, z: 50, text: 'RECHARGED', life: 0.8, maxLife: 0.8, color: '#ffe066', size: 13, vx: 0 })
        }
        const blossom = this.stack('deathblossom')
        if (blossom > 0) {
            const n = 6 + 2 * (blossom - 1)
            for (let i = 0; i < n; i++) {
                const a = i / n * Math.PI * 2 + Math.random() * 0.3
                this.projectiles.push({
                    id: this.nextId++, x: e.x, y: e.y, vx: Math.cos(a) * 480, vy: Math.sin(a) * 480, life: 0.55,
                    damage: this.weapon.baseDamage * this.damageMult * 0.4, r: 12, owner: 'player', pierce: 1, hitIds: new Set([e.id]), kind: 'windblade', angle: a
                })
            }
        }

        const explode = this.stack('explode')
        if (explode > 0) {
            const radius = 85 + 12 * explode
            const dmg = this.weapon.baseDamage * this.damageMult * (0.7 + 0.35 * (explode - 1))
            this.rings.push({ x: e.x, y: e.y, r0: 8, r1: radius, life: 0.35, maxLife: 0.35, color: '#ffb347', width: 10 })
            this.burst(e.x, e.y, 10, 22, 'ember', '#ff8c2a', 200, 0.7)
            this.burst(e.x, e.y, 6, 8, 'smoke', '#4a3a30', 90, 0.7)
            this.decals.push({ x: e.x, y: e.y, r: radius * 0.5, color: 'rgba(30,20,15,0.5)', kind: 'scorch' })
            this.shake = Math.max(this.shake, 9)
            this.emit('explode', e.x, e.y)
            for (const o of this.enemies) {
                if (!o.alive || o === e) continue
                if (inCircle(e, radius, o, o.r)) {
                    this.damageEnemy(o, dmg, { source: e, knockback: 280, stagger: 0.4, tag: 'explode', bypassShield: true })
                }
            }
        }
    }

    hurtPlayer(amount: number, from: Vec, knockback: number, attacker?: Enemy): boolean {
        const p = this.player
        if (p.invuln > 0 || (this.phase !== 'wave' && this.phase !== 'calm')) return false
        const dmg = Math.round(amount)
        p.hp -= dmg
        const thorns = this.stack('thorns')
        if (thorns > 0 && attacker?.alive) {
            this.damageEnemy(attacker, this.weapon.baseDamage * this.damageMult * 0.6 * thorns, { source: p, heavy: true, knockback: 380, stagger: 0.5, tag: 'thorns', bypassShield: true, color: '#9be07a' })
        }
        p.invuln = HURT_GRACE
        p.hurtFlash = 0.35
        this.stats.damageTaken += dmg
        const dir = angleTo(from, p)
        // Being hit interrupts the combo — losing the chain hurts.
        p.attack = null
        p.comboIndex = 0
        p.comboTimer = 0
        p.comboHits = 0
        if (p.special?.kind !== 'dash' && p.special?.kind !== 'leap') p.special = null
        p.dodge = null
        p.x += Math.cos(dir) * knockback * 0.12
        p.y += Math.sin(dir) * knockback * 0.12
        this.collidePlayer()
        this.floaters.push({ x: p.x, y: p.y, z: 40, text: `-${dmg}`, life: 0.9, maxLife: 0.9, color: '#ff5d6c', size: 18, vx: 0 })
        this.burst(p.x, p.y, 16, 10, 'blood', '#b0121f', 140, 0.6, dir)
        this.hitstop = Math.max(this.hitstop, 0.06)
        this.shake = Math.max(this.shake, 6 + Math.min(12, dmg / 3))
        this.emit('hurt', p.x, p.y, Math.min(1, dmg / 30))
        if (p.hp <= 0 && p.phoenixUsed < this.stack('phoenix')) {
            p.phoenixUsed += 1
            p.hp = Math.ceil(p.maxHp * 0.5)
            p.invuln = 2
            p.hurtFlash = 0
            this.rings.push({ x: p.x, y: p.y, r0: 10, r1: 240, life: 0.6, maxLife: 0.6, color: '#ff8c2a', width: 16 })
            this.burst(p.x, p.y, 10, 60, 'ember', '#ff8c2a', 260, 0.9)
            this.decals.push({ x: p.x, y: p.y, r: 90, color: 'rgba(30,20,15,0.45)', kind: 'scorch' })
            this.floaters.push({ x: p.x, y: p.y, z: 60, text: 'REBORN', life: 1.2, maxLife: 1.2, color: '#ffb347', size: 22, vx: 0 })
            this.shake = Math.max(this.shake, 14)
            this.hitstop = Math.max(this.hitstop, 0.12)
            this.emit('revive', p.x, p.y)
            for (const e of this.enemies) {
                if (!e.alive) continue
                if (inCircle(p, 240, e, e.r)) this.damageEnemy(e, this.weapon.baseDamage * this.damageMult * 3, { source: p, heavy: true, knockback: 500, stagger: 1.2, tag: 'explode', bypassShield: true })
            }
            return true
        }
        if (p.hp <= 0) {
            p.hp = 0
            this.phase = 'dead'
            this.deathT = 0
            this.decals.push({ x: p.x, y: p.y, r: 30, color: 'rgba(120,10,20,0.6)', kind: 'blood' })
            this.burst(p.x, p.y, 16, 30, 'blood', '#8f0f1c', 200, 1, dir)
            this.shake = 20
            this.emit('death', p.x, p.y)
        }
        return true
    }

    // ---------------------------------------------------------------- enemies

    private updateEnemies(dt: number) {
        const p = this.player
        // Once the wave has finished spawning and only stragglers remain,
        // they come to you — no kiting the last thornspitter across the map.
        this.finalRush = this.spawnQueue.length === 0 && this.aliveEnemies <= 4
        for (const e of this.enemies) {
            if (!e.alive) {
                e.deadT += dt
                e.x += e.vx * dt
                e.y += e.vy * dt
                e.vx *= Math.max(0, 1 - 8 * dt)
                e.vy *= Math.max(0, 1 - 8 * dt)
                continue
            }
            e.hitFlash = Math.max(0, e.hitFlash - dt)
            e.squash = Math.max(0, e.squash - dt * 6)
            e.attackCd = Math.max(0, e.attackCd - dt)
            e.sprintHitCd = Math.max(0, e.sprintHitCd - dt)
            if (e.slowT > 0) {
                e.slowT -= dt
                if (e.slowT <= 0) e.slow = 0
            }
            if (e.burn) {
                e.burn.t -= dt
                e.burn.tick -= dt
                if (e.burn.tick <= 0) {
                    e.burn.tick = 0.5
                    this.damageEnemy(e, e.burn.dps * 0.5, { source: e, tag: 'burn', bypassShield: true })
                    this.burst(e.x, e.y, 10, 2, 'ember', '#ff8c2a', 50, 0.6)
                }
                if (e.burn.t <= 0) e.burn = null
                if (!e.alive) continue
            }
            if (e.frozen > 0) {
                e.frozen -= dt
                e.vx *= Math.max(0, 1 - 10 * dt)
                e.vy *= Math.max(0, 1 - 10 * dt)
                e.x += e.vx * dt
                e.y += e.vy * dt
                continue
            }

            // Knockback decays; AI motion is added on top.
            e.vx *= Math.max(0, 1 - 5 * dt)
            e.vy *= Math.max(0, 1 - 5 * dt)
            let mx = 0
            let my = 0
            const toP = angleTo(e, p)
            const d = Math.hypot(p.x - e.x, p.y - e.y)
            const speed = e.speed * (1 - e.slow) * (this.finalRush ? 1.3 : 1)

            e.stateT += dt
            switch (e.state) {
                case 'spawn':
                    if (e.stateT >= 0.45) {
                        e.state = 'chase'
                        e.stateT = 0
                    }
                    break
                case 'stagger':
                    if (e.stateT >= e.stunT) {
                        e.state = 'chase'
                        e.stateT = 0
                        e.stunT = 0
                        e.attackCd = Math.max(e.attackCd, 0.35)
                    }
                    break
                case 'recover':
                    if (e.stateT >= (e.attack?.recover ?? 0.5)) {
                        e.state = 'chase'
                        e.stateT = 0
                        e.attack = null
                    }
                    break
                case 'chase': {
                    const move = this.think(e, d, toP)
                    mx = move.x
                    my = move.y
                    break
                }
                case 'windup': {
                    const a = e.attack!
                    if (e.stateT < a.windup * a.tracking) a.dir = toP
                    if (e.stateT >= a.windup) this.releaseAttack(e)
                    if (a.kind === 'shot' || a.kind === 'slam' || a.kind === 'spin' || a.kind === 'charge') {
                        e.facing = a.dir
                    } else {
                        e.facing = a.dir
                    }
                    break
                }
                case 'attack': {
                    const a = e.attack!
                    if (a.kind === 'charge') {
                        a.chargeT += dt
                        const ox = e.x
                        const oy = e.y
                        e.x += Math.cos(a.dir) * a.chargeSpeed * dt
                        e.y += Math.sin(a.dir) * a.chargeSpeed * dt
                        e.facing = a.dir
                        e.walk += dt * 20
                        if (Math.random() < 0.7) this.puff(e.x - Math.cos(a.dir) * e.r, e.y - Math.sin(a.dir) * e.r, 1, '#c9b98c')
                        if (!a.hit && inSegment({ x: ox, y: oy }, e, e.r + 2, p, p.r)) {
                            a.hit = true
                            if (this.hurtPlayer(a.damage, { x: e.x - Math.cos(a.dir) * 10, y: e.y - Math.sin(a.dir) * 10 }, a.knockback, e)) {
                                a.chargeT = a.chargeDur
                            }
                        }
                        const blocked = this.hitsObstacle(e)
                        if (a.chargeT >= a.chargeDur || blocked) {
                            e.state = 'recover'
                            e.stateT = 0
                            if (blocked) {
                                this.burst(e.x, e.y, 10, 8, 'chip', '#7f6c50', 140, 0.5)
                                this.shake = Math.max(this.shake, 4)
                                e.vx -= Math.cos(a.dir) * 120
                                e.vy -= Math.sin(a.dir) * 120
                            }
                        }
                    } else {
                        e.state = 'recover'
                        e.stateT = 0
                    }
                    break
                }
            }

            const ml = Math.hypot(mx, my)
            if (ml > 0) {
                e.walk += dt * 9
                mx = mx / ml * speed
                my = my / ml * speed
                if (e.state === 'chase') e.facing = Math.atan2(my, mx)
            }
            e.x += (mx + e.vx) * dt
            e.y += (my + e.vy) * dt

            if (!e.entered && e.x > 0 && e.x < ARENA_W && e.y > 0 && e.y < ARENA_H) e.entered = true
            if (e.entered) {
                e.x = clamp(e.x, e.r, ARENA_W - e.r)
                e.y = clamp(e.y, e.r, ARENA_H - e.r)
            } else {
                e.x = clamp(e.x, -160, ARENA_W + 160)
                e.y = clamp(e.y, -160, ARENA_H + 160)
            }
            for (const o of this.world.obstacles) {
                const dx = e.x - o.x
                const dy = e.y - o.y
                const dist = Math.hypot(dx, dy)
                const min = o.r + e.r
                if (dist < min && dist > 0) {
                    e.x = o.x + dx / dist * min
                    e.y = o.y + dy / dist * min
                }
            }
        }
        // Drop corpses after they've faded.
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i]!
            if (!e.alive && e.deadT > 0.7) this.enemies.splice(i, 1)
        }
    }

    private hitsObstacle(e: Enemy): boolean {
        if (e.x <= e.r || e.x >= ARENA_W - e.r || e.y <= e.r || e.y >= ARENA_H - e.r) return true
        for (const o of this.world.obstacles) {
            if (Math.hypot(e.x - o.x, e.y - o.y) < o.r + e.r + 1) return true
        }
        return false
    }

    /** Decide movement (unit-ish vector) for a chasing enemy, and start attacks. */
    private think(e: Enemy, d: number, toP: number): Vec {
        const p = this.player
        if (!e.entered) {
            // Walk straight into the clearing first (across the bridge, out of
            // the tree line), then start hunting.
            const tx = clamp(e.x, 60, ARENA_W - 60)
            const ty = clamp(e.y, 60, ARENA_H - 60)
            const a = Math.atan2(ty - e.y, tx - e.x)
            return { x: Math.cos(a), y: Math.sin(a) }
        }
        let mx = Math.cos(toP)
        let my = Math.sin(toP)
        const ready = e.attackCd <= 0
        const dmg = e.damage

        const begin = (a: Partial<EnemyAttack> & { kind: EnemyAttack['kind'], windup: number }) => {
            e.attack = {
                kind: a.kind, windup: a.windup, dir: toP, reach: a.reach ?? 50, halfAngle: a.halfAngle ?? 1,
                radius: a.radius ?? 0, damage: a.damage ?? dmg, knockback: a.knockback ?? 160, recover: a.recover ?? 0.5,
                tracking: a.tracking ?? 0.6, chargeT: 0, chargeDur: a.chargeDur ?? 0.6, chargeSpeed: a.chargeSpeed ?? 540,
                hit: false, lunge: a.lunge ?? 0
            }
            e.state = 'windup'
            e.stateT = 0
            this.emit('telegraph', e.x, e.y, a.kind === 'slam' ? 1 : 0.4)
        }

        switch (e.type) {
            case 'grunt':
                if (ready && d < 56 + p.r) begin({ kind: 'melee', windup: 0.5, reach: 58, halfAngle: 1.05, knockback: 180, recover: 0.5, lunge: 14 })
                break
            case 'swarmer':
                // Swarmers orbit a little so they arrive from several angles.
                mx += Math.cos(toP + Math.PI / 2) * Math.sin(e.wander + this.time * 2) * 0.6
                my += Math.sin(toP + Math.PI / 2) * Math.sin(e.wander + this.time * 2) * 0.6
                if (ready && d < 48 + p.r) begin({ kind: 'melee', windup: 0.3, reach: 40, halfAngle: 1.2, knockback: 80, recover: 0.35, lunge: 26 })
                break
            case 'shield':
                if (ready && d < 62 + p.r) begin({ kind: 'melee', windup: 0.7, reach: 64, halfAngle: 0.9, knockback: 300, recover: 0.6, lunge: 18 })
                break
            case 'ranged': {
                if (d < 180 && !this.finalRush) {
                    mx = -mx
                    my = -my
                } else if (d < 340 && !this.finalRush) {
                    // Hold the line, sidestep a little.
                    const side = Math.sin(e.wander + this.time * 1.3)
                    mx = Math.cos(toP + Math.PI / 2) * side * 0.5
                    my = Math.sin(toP + Math.PI / 2) * side * 0.5
                }
                if (ready && d < 420 && d > 120) begin({ kind: 'shot', windup: 0.85, recover: 0.4, tracking: 0.7 })
                break
            }
            case 'charger':
                if (ready && d < 320 && d > 40) begin({ kind: 'charge', windup: 0.75, chargeDur: 0.62, chargeSpeed: 560, knockback: 320, recover: 1.0, tracking: 0.65 })
                else if (d < 60) {
                    // Too close to charge: shove and back off a step.
                    mx = -mx * 0.6
                    my = -my * 0.6
                }
                break
            case 'ogre':
                if (ready && d < 150) {
                    if (randomChance(0.5) || d > 105) begin({ kind: 'slam', windup: 1.1, radius: 128, damage: dmg, knockback: 380, recover: 1.0, tracking: 0.5 })
                    else begin({ kind: 'melee', windup: 0.62, reach: 104, halfAngle: 1.1, damage: dmg * 0.7, knockback: 280, recover: 0.6, lunge: 10 })
                }
                break
            case 'warlord':
                if (ready && d < 120) {
                    if (randomChance(0.45)) begin({ kind: 'spin', windup: 0.8, radius: 110, damage: dmg * 0.85, knockback: 320, recover: 0.8 })
                    else begin({ kind: 'melee', windup: 0.48, reach: 92, halfAngle: 1.0, knockback: 240, recover: 0.5, lunge: 20 })
                } else if (ready && d < 360 && d >= 120) {
                    begin({ kind: 'charge', windup: 0.6, chargeDur: 0.55, chargeSpeed: 540, knockback: 340, recover: 0.8, tracking: 0.75 })
                }
                break
        }

        // Steer around boulders in the way.
        for (const o of this.world.obstacles) {
            const dx = o.x - e.x
            const dy = o.y - e.y
            const od = Math.hypot(dx, dy)
            if (od < o.r + e.r + 60 && od > 0) {
                const ahead = (dx * mx + dy * my) / od
                if (ahead > 0.3) {
                    const side = (dx * my - dy * mx) > 0 ? -1 : 1
                    mx += -dy / od * side * 1.2
                    my += dx / od * side * 1.2
                }
            }
        }
        return { x: mx, y: my }
    }

    private releaseAttack(e: Enemy) {
        const a = e.attack!
        const p = this.player
        switch (a.kind) {
            case 'melee': {
                e.x += Math.cos(a.dir) * a.lunge
                e.y += Math.sin(a.dir) * a.lunge
                this.trails.push({ x: e.x, y: e.y, angle0: a.dir - a.halfAngle, angle1: a.dir + a.halfAngle, reach: a.reach, life: 0.18, maxLife: 0.18, color: '#ff7b6b', kind: 'arc', width: 14, z: 12 })
                if (inArc(e, a.dir, a.halfAngle, a.reach, p, p.r)) this.hurtPlayer(a.damage, e, a.knockback, e)
                e.state = 'recover'
                e.stateT = 0
                break
            }
            case 'slam': {
                this.rings.push({ x: e.x, y: e.y, r0: 20, r1: a.radius + 10, life: 0.4, maxLife: 0.4, color: '#e0c9a0', width: 12 })
                this.decals.push({ x: e.x, y: e.y, r: 28, color: '#4a3a2a', kind: 'crack' })
                this.burst(e.x, e.y, 0, 24, 'dust', '#bfae83', 220, 0.7)
                this.shake = Math.max(this.shake, 14)
                this.emit('special', e.x, e.y, 1)
                if (inCircle(e, a.radius, p, p.r)) this.hurtPlayer(a.damage, e, a.knockback, e)
                e.state = 'recover'
                e.stateT = 0
                break
            }
            case 'spin': {
                this.trails.push({ x: e.x, y: e.y, angle0: 0, angle1: Math.PI * 2, reach: a.radius, life: 0.28, maxLife: 0.28, color: '#ff7b6b', kind: 'ring', width: 22, z: 12 })
                this.shake = Math.max(this.shake, 6)
                if (inCircle(e, a.radius, p, p.r)) this.hurtPlayer(a.damage, e, a.knockback, e)
                e.state = 'recover'
                e.stateT = 0
                break
            }
            case 'shot': {
                this.projectiles.push({
                    id: this.nextId++, x: e.x + Math.cos(a.dir) * e.r, y: e.y + Math.sin(a.dir) * e.r,
                    vx: Math.cos(a.dir) * 340, vy: Math.sin(a.dir) * 340, life: 2.2, damage: a.damage, r: 6,
                    owner: 'enemy', pierce: 0, hitIds: new Set(), kind: 'thorn', angle: a.dir
                })
                e.state = 'recover'
                e.stateT = 0
                break
            }
            case 'charge':
                e.state = 'attack'
                e.stateT = 0
                a.chargeT = 0
                this.burst(e.x, e.y, 0, 8, 'dust', '#c9b98c', 100, 0.5)
                break
        }
        e.attackCd = e.type === 'swarmer' ? 0.7 + Math.random() * 0.5 : e.type === 'ranged' ? 2.2 : e.type === 'charger' ? 1.4 : 0.9 + Math.random() * 0.5
    }

    /** Push overlapping bodies apart so crowds spread instead of stacking. */
    private resolveBodies() {
        const list = this.enemies
        for (let i = 0; i < list.length; i++) {
            const a = list[i]!
            if (!a.alive) continue
            for (let j = i + 1; j < list.length; j++) {
                const b = list[j]!
                if (!b.alive) continue
                const dx = b.x - a.x
                const dy = b.y - a.y
                const d = Math.hypot(dx, dy)
                const min = a.r + b.r
                if (d < min && d > 0.001) {
                    const push = (min - d) * 0.5
                    const nx = dx / d
                    const ny = dy / d
                    const wa = b.def.elite ? 1 : a.def.elite ? 0 : 0.5
                    a.x -= nx * push * 2 * wa
                    a.y -= ny * push * 2 * wa
                    b.x += nx * push * 2 * (1 - wa)
                    b.y += ny * push * 2 * (1 - wa)
                }
            }
            // Bodies shove the player a little, but never through walls.
            const p = this.player
            const dx = p.x - a.x
            const dy = p.y - a.y
            const d = Math.hypot(dx, dy)
            const min = a.r + p.r - 2
            if (d < min && d > 0.001 && !p.dodge && p.special?.kind !== 'dash') {
                const push = (min - d)
                p.x += dx / d * push * 0.5
                p.y += dy / d * push * 0.5
                a.x -= dx / d * push * 0.5
                a.y -= dy / d * push * 0.5
            }
        }
        this.collidePlayer()
    }

    // ------------------------------------------------------------ projectiles

    private updateProjectiles(dt: number) {
        const p = this.player
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const pr = this.projectiles[i]!
            pr.x += pr.vx * dt
            pr.y += pr.vy * dt
            pr.life -= dt
            let dead = pr.life <= 0
            if (pr.owner === 'enemy') {
                if (Math.hypot(pr.x - p.x, pr.y - p.y) <= pr.r + p.r) {
                    if (p.invuln <= 0) {
                        this.hurtPlayer(pr.damage, pr, 120)
                        dead = true
                    }
                }
                if (pr.x < -60 || pr.x > ARENA_W + 60 || pr.y < -60 || pr.y > ARENA_H + 60) dead = true
                for (const o of this.world.obstacles) {
                    if (Math.hypot(pr.x - o.x, pr.y - o.y) < o.r) {
                        dead = true
                        this.burst(pr.x, pr.y, 8, 4, 'chip', '#5d7a3a', 80, 0.4)
                    }
                }
            } else {
                for (const e of this.enemies) {
                    if (!e.alive || pr.hitIds.has(e.id)) continue
                    if (Math.hypot(pr.x - e.x, pr.y - e.y) <= pr.r + e.r) {
                        pr.hitIds.add(e.id)
                        this.damageEnemy(e, pr.damage, { source: { x: pr.x - pr.vx * 0.01, y: pr.y - pr.vy * 0.01 }, heavy: this.allHeavy, knockback: 90, stagger: 0.15, tag: 'proj' })
                        if (pr.hitIds.size > pr.pierce) {
                            dead = true
                            break
                        }
                    }
                }
            }
            if (dead) this.projectiles.splice(i, 1)
        }
    }

    private updateWhirlwinds(dt: number) {
        const p = this.player
        for (let i = this.whirlwinds.length - 1; i >= 0; i--) {
            const w = this.whirlwinds[i]!
            w.life -= dt
            w.spin += dt * 18
            w.tick -= dt
            if (Math.random() < 0.5) {
                const a = Math.random() * Math.PI * 2
                this.particles.push({ x: p.x + Math.cos(a) * w.radius * 0.8, y: p.y + Math.sin(a) * w.radius * 0.8, z: 10 + Math.random() * 30, vx: -Math.sin(a) * 120, vy: Math.cos(a) * 120, vz: 30, life: 0.5, maxLife: 0.5, size: 4, color: '#d9c88a', kind: 'leaf', gravity: 0, decal: false })
            }
            if (w.tick <= 0) {
                w.tick = 0.14
                for (const e of this.enemies) {
                    if (!e.alive) continue
                    if (inCircle(p, w.radius, e, e.r)) {
                        this.damageEnemy(e, w.damage, { source: p, knockback: 110, stagger: 0.2, tag: 'whirl' })
                    }
                }
            }
            if (w.life <= 0) this.whirlwinds.splice(i, 1)
        }
    }

    // ---------------------------------------------------------------- effects

    private updateEffects(dt: number) {
        this.shake = Math.max(0, this.shake - dt * 40 * Math.max(0.3, this.shake / 10))
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const pt = this.particles[i]!
            pt.life -= dt
            pt.x += pt.vx * dt
            pt.y += pt.vy * dt
            pt.z += pt.vz * dt
            pt.vz -= pt.gravity * dt
            if (pt.kind === 'blood' || pt.kind === 'chip') {
                pt.vx *= Math.max(0, 1 - 2 * dt)
                pt.vy *= Math.max(0, 1 - 2 * dt)
                if (pt.z <= 0 && pt.vz < 0) {
                    pt.z = 0
                    pt.vz = 0
                    pt.vx = 0
                    pt.vy = 0
                    if (pt.kind === 'blood' && pt.decal) {
                        this.decals.push({ x: pt.x, y: pt.y, r: pt.size * 1.4, color: 'rgba(120,10,20,0.5)', kind: 'blood' })
                        pt.life = 0
                    }
                }
            } else if (pt.kind === 'spark') {
                pt.vx *= Math.max(0, 1 - 6 * dt)
                pt.vy *= Math.max(0, 1 - 6 * dt)
            } else if (pt.kind === 'dust' || pt.kind === 'smoke') {
                pt.vx *= Math.max(0, 1 - 3 * dt)
                pt.vy *= Math.max(0, 1 - 3 * dt)
                pt.size += dt * (pt.kind === 'smoke' ? 8 : 18)
            } else if (pt.kind === 'leaf' || pt.kind === 'petal') {
                pt.vx += Math.sin(this.ambientT * 3 + pt.y) * 20 * dt
            }
            if (pt.life <= 0) this.particles.splice(i, 1)
        }
        for (let i = this.floaters.length - 1; i >= 0; i--) {
            const f = this.floaters[i]!
            f.life -= dt
            f.z += dt * 40
            f.x += f.vx * dt
            if (f.life <= 0) this.floaters.splice(i, 1)
        }
        for (let i = this.trails.length - 1; i >= 0; i--) {
            const t = this.trails[i]!
            t.life -= dt
            if (t.life <= 0) this.trails.splice(i, 1)
        }
        for (let i = this.rings.length - 1; i >= 0; i--) {
            const r = this.rings[i]!
            r.life -= dt
            if (r.life <= 0) this.rings.splice(i, 1)
        }
        for (let i = this.bolts.length - 1; i >= 0; i--) {
            const b = this.bolts[i]!
            b.life -= dt
            if (b.life <= 0) this.bolts.splice(i, 1)
        }
        for (let i = this.impacts.length - 1; i >= 0; i--) {
            const im = this.impacts[i]!
            im.life -= dt
            if (im.life <= 0) this.impacts.splice(i, 1)
        }
    }

    private spawnAmbient(dt: number) {
        // Drifting leaves and petals over the whole arena, always on.
        if (Math.random() < dt * 6) {
            this.particles.push({
                x: Math.random() * (ARENA_W + 400) - 200, y: Math.random() * (ARENA_H + 400) - 200, z: 60 + Math.random() * 60,
                vx: 20 + Math.random() * 25, vy: 10 + Math.random() * 10, vz: -14, life: 5, maxLife: 5, size: 3 + Math.random() * 2,
                color: Math.random() < 0.6 ? '#e2913a' : '#f2c14e', kind: 'leaf', gravity: 0, decal: false
            })
        }
    }

    burst(x: number, y: number, z: number, count: number, kind: Particle['kind'], color: string, speed: number, life: number, dir?: number) {
        for (let i = 0; i < count; i++) {
            const a = dir === undefined ? Math.random() * Math.PI * 2 : dir + (Math.random() - 0.5) * 1.6
            const s = speed * (0.3 + Math.random() * 0.9)
            const size = kind === 'spark' ? 2 + Math.random() * 2 : kind === 'blood' ? 2 + Math.random() * 3.5 : kind === 'dust' || kind === 'smoke' ? 6 + Math.random() * 8 : 3 + Math.random() * 3
            this.particles.push({
                x, y, z: z + Math.random() * 6, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                vz: kind === 'blood' || kind === 'chip' ? 60 + Math.random() * 160 : kind === 'ember' ? 40 + Math.random() * 60 : 10 + Math.random() * 30,
                life: life * (0.6 + Math.random() * 0.6), maxLife: life, size, color, kind,
                gravity: kind === 'blood' || kind === 'chip' ? 520 : kind === 'ember' ? -40 : kind === 'frost' ? 80 : 0,
                decal: kind === 'blood' && Math.random() < 0.5
            })
        }
        if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES)
    }

    /** Lightning shockwave centred on a point (Rolling Thunder). */
    private thunderclap(x: number, y: number, radius: number, damage: number) {
        this.rings.push({ x, y, r0: 10, r1: radius, life: 0.3, maxLife: 0.3, color: '#dcc8ff', width: 8 })
        const points: Vec[] = []
        for (let i = 0; i < 5; i++) {
            const a = i / 5 * Math.PI * 2 + Math.random()
            points.push({ x, y }, { x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius })
        }
        for (let i = 0; i < points.length; i += 2) this.bolts.push({ points: [points[i]!, points[i + 1]!], life: 0.2, maxLife: 0.2 })
        this.shake = Math.max(this.shake, 6)
        this.emit('lightning', x, y)
        for (const e of this.enemies) {
            if (!e.alive) continue
            if (inCircle({ x, y }, radius, e, e.r)) this.damageEnemy(e, damage, { source: { x, y }, knockback: 260, stagger: 0.4, tag: 'thunder', bypassShield: true })
        }
    }

    private puff(x: number, y: number, count: number, color: string) {
        this.burst(x, y, 0, count, 'dust', color, 20, 0.35)
    }

    // -------------------------------------------------------------- queries

    get aliveEnemies(): number {
        return this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0)
    }

    get remainingInWave(): number {
        return this.aliveEnemies + this.spawnQueue.reduce((s, g) => s + g.count, 0)
    }

    get elite(): Enemy | null {
        return this.enemies.find(e => e.alive && e.def.elite) ?? null
    }

    get elites(): Enemy[] {
        return this.enemies.filter(e => e.alive && e.def.elite)
    }
}

