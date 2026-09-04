// Meadowbrawl simulation. No DOM, no canvas — the renderer reads this state
// and the Vue shell feeds it input. Outcome rolls (offers, procs, enemy
// attack choice) go through the shared CSPRNG helpers; cosmetic scatter uses
// Math.random.
import { randomChance, randomFloat } from '#shared/utils/random'
import {
    meadowbrawlEliteCoinBonus,
    meadowbrawlWaveCoinPool,
    MEADOWBRAWL_SAVE_VERSION,
    type MeadowbrawlPetId,
    type MeadowbrawlRunSave
} from '#shared/utils/gamelogic/meadowbrawl-meta'
import type { EnemyTypeId, GameEvent, Offer, SpawnGroup, SwingDef, Vec, WeaponDef, WeaponId } from './types'
import { ARENA_H, ARENA_W, TOTAL_WAVES } from './types'
import { WEAPONS, buildChain } from './weapons'
import { ENEMY_TYPES, veteranChance, waveScaling, type EnemyTypeDef } from './enemies'
import { ENEMY_COST, buildWave } from './waves'
import { UPGRADE_BY_ID, rollOffers } from './upgrades'
import { companionAbsorbHit, companionHaste, makeCompanion, updateCompanion, type Companion } from './companion'
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
    qPressed: boolean
    ePressed: boolean
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

/**
 * What the account brings into a run: homestead upgrades, the pet, and the
 * coin multiplier (display only — the server applies its own snapshot).
 */
export interface RunConfig {
    maxHp: number
    damageMult: number
    /** Extra dodge charges on top of the class default. */
    dodgeCharges: number
    offerCount: number
    rerolls: number
    coinMult: number
    pet: { id: MeadowbrawlPetId, level: number } | null
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
    maxHp: 100,
    damageMult: 1,
    dodgeCharges: 0,
    offerCount: 3,
    rerolls: 0,
    coinMult: 1,
    pet: null
}

export interface Coin {
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    value: number
    life: number
    seed: number
    size: number
    /** Set once the player's pull has caught it. */
    magnet: boolean
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
    /** Seconds a pressed dodge stays queued while something else finishes. */
    dodgeBuffer: number
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
    adrenalineT: number
    /** Airborne height during Sky Fall, for the renderer. */
    z: number
    abilityCd: { q: number, e: number }
    abilityCdMax: { q: number, e: number }
    /** Timed class effects, seconds remaining. */
    fx: { shieldWall: number, rally: number, bloodrage: number, ironSkin: number, smoke: number, snared: number }
    /** Skewer Charge in flight. */
    skewer: { t: number, dur: number, dx: number, dy: number, carried: number[], hitIds: Set<number> } | null
    /** True while the axe is thrown (hand is empty). */
    axeOut: boolean
}

export interface EnemyAttack {
    kind: 'melee' | 'charge' | 'shot' | 'slam' | 'spin' | 'volley' | 'snare' | 'brood' | 'parry'
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
    /** Ground-targeted attacks (Root Snare) remember where they were aimed. */
    tx?: number
    ty?: number
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
    /** Poise-break meter, 0..stunMax. Filling it is the only real stagger. */
    stun: number
    stunMax: number
    /** Seconds after a stun during which the meter refuses to build. */
    stunLock: number
    /** Hollow Knight: seconds of active parry stance. */
    parryT: number
    /** Multi-hit boss combos: which swing of the chain comes next. */
    combo: number
    /** Cooldown on the signature move (Brood Call, Parry, Shadow Step). */
    moveT: number
    /** Enemy ids this one has summoned (Briar Matriarch's brood). */
    brood: number[]
    /** Base coins dropped on death. */
    coin: number
    /** Late-game variant: bigger, tougher, hits harder. */
    veteran: boolean
    /** Death Mark seconds remaining. */
    marked: number
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
    kind: 'spark' | 'blood' | 'dust' | 'ember' | 'frost' | 'leaf' | 'chip' | 'smoke' | 'petal' | 'glow' | 'spore' | 'bone'
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

export type TrailStyle = WeaponId | 'enemy' | 'ghost'

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
    style: TrailStyle
    finisher?: boolean
}

export interface Meteor {
    x: number
    y: number
    t: number
    delay: number
    radius: number
    damage: number
}

export interface Singularity {
    x: number
    y: number
    life: number
    maxLife: number
    radius: number
    tick: number
    damage: number
    spin: number
}

export interface Orbital {
    life: number
    maxLife: number
    angle: number
    damage: number
    cooldowns: Map<number, number>
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
    kind: 'thorn' | 'windblade' | 'crescent' | 'knife'
    angle: number
}

export interface ThrownAxe {
    x: number
    y: number
    vx: number
    vy: number
    t: number
    phase: 'out' | 'back'
    hitIds: Set<number>
    spin: number
    damage: number
}

export interface Javelin {
    x: number
    y: number
    t: number
    delay: number
    /** Seconds it stays stuck in the ground after landing. */
    stuck: number
    damage: number
    angle: number
}

export interface Seismic {
    x: number
    y: number
    dx: number
    dy: number
    t: number
    next: number
    remaining: number
    damage: number
}

export interface Soul {
    x: number
    y: number
    vx: number
    vy: number
    life: number
    /** Enemy to hunt, or -1 to fly to the player (heal wisp). */
    targetId: number
    damage: number
}

export interface Spike {
    x: number
    y: number
    life: number
    maxLife: number
    angle: number
    size: number
}

export interface Afterimage {
    x: number
    y: number
    facing: number
    life: number
    maxLife: number
    color: string
    weapon: WeaponId
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
/** How long a dodge press waits for a committed special to finish. */
const DODGE_BUFFER = 0.35
/** i-frames, measured from the first frame of the roll. */
const DODGE_IFRAMES = 0.3
/** Past this fraction of the roll you can attack or special out of it. */
const DODGE_CANCEL = 0.65
const DODGE_DIST = 165
const HURT_GRACE = 0.5
const MAX_PARTICLES = 900
/**
 * Fraction of a swing's recovery that must play out before the next combo
 * input can cancel it. Without this, spam-clicking collapses every swing to
 * windup + active and the sword turns into a buzzsaw.
 */
const CHAIN_POINT = 0.7
/** Navigation grid cell size in logic units. */
const NAV_CELL = 40
const NAV_COLS = Math.ceil(ARENA_W / NAV_CELL)
const NAV_ROWS = Math.ceil(ARENA_H / NAV_CELL)
const NAV_STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

// --------------------------------------------------------------- stun meter
//
// Nothing staggers an elite or a poise enemy except a full meter. Every hit
// contributes a share of the target's own health pool, so a grunt breaks in
// about one combo while a boss needs a sustained beating; when the stun ends
// the meter locks out for several seconds, which is what stops a greataxe
// from chain-stunning a boss to death.
const STUN_MAX = 100
/** Meter per point of damage, as a fraction of the target's max health. */
const STUN_GAIN_ELITE = 0.55
const STUN_GAIN_REGULAR = 1.6
/** No single hit may fill more than this much of the meter. */
const STUN_GAIN_CAP = 60
const STUN_DUR_ELITE = 2.6
const STUN_DUR_REGULAR = 1.2
const STUN_LOCK_ELITE = 6
const STUN_LOCK_REGULAR = 3
/** Damage taken while stunned. */
const STUN_VULN = 1.3
/** Hit-reaction flinch on ordinary enemies, seconds. */
const FLINCH_MIN = 0.1
const FLINCH_MAX = 0.15

/** Distance the Briar Matriarch tries to hold. */
const BRIAR_RANGE = 220
/** Spriglings she may have on the field at once. */
const BRIAR_BROOD_CAP = 8

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
    meteors: Meteor[] = []
    singularities: Singularity[] = []
    orbitals: Orbital[] = []
    meteorTimer = 0
    swingCount = 0
    thrownAxes: ThrownAxe[] = []
    javelins: Javelin[] = []
    seismics: Seismic[] = []
    souls: Soul[] = []
    spikes: Spike[] = []
    afterimages: Afterimage[] = []
    /** White screen flash, 0..1. */
    flash = 0
    /** Dramatic slow-motion remaining (elite kills). */
    slowmo = 0
    private afterimageT = 0
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
    config: RunConfig = DEFAULT_RUN_CONFIG
    companion: Companion | null = null
    /** Base coins picked up this run. */
    coins = 0
    /** What each coin is worth to the account — for the HUD only. */
    coinMult = 1
    coinDrops: Coin[] = []
    /** Free offer rerolls left this wave (Fortune). */
    rerollsLeft = 0
    rerolled = false
    /** Called with a fresh checkpoint whenever the run reaches a save point. */
    onCheckpoint: ((save: MeadowbrawlRunSave) => void) | null = null
    /** Base coins per budget point for the current wave's regular spawns. */
    private coinPer = 0
    /** Resuming past a pick: the calm leads straight into the next wave. */
    private skipOffers = false
    private coinStreak = 0
    private coinStreakT = 0
    waveKills = 0
    waveTotal = 0
    finalRush = false
    banner: { text: string, sub: string, t: number } | null = null
    input: InputState = {
        moveX: 0, moveY: 0, aimX: ARENA_W / 2 + 100, aimY: ARENA_H / 2,
        attackPressed: false, attackHeld: false, specialPressed: false,
        spaceDown: false, spacePressed: false, spaceReleased: false,
        qPressed: false, ePressed: false
    }

    private nextId = 1
    private ambientT = 0
    /** Cells an enemy body can't occupy (boulders, trunks, plus a margin). */
    private navBlocked = new Uint8Array(NAV_COLS * NAV_ROWS)
    /** Step distance from each cell to the player, -1 where unreachable. */
    private navDist = new Int32Array(NAV_COLS * NAV_ROWS)
    private navQueue = new Int32Array(NAV_COLS * NAV_ROWS)
    private navTimer = 0

    constructor() {
        this.world = generateWorld()
        this.player = this.makePlayer('sword')
        this.rebuildNav()
    }

    // ------------------------------------------------------------ navigation

    /** Mark the cells obstacles occupy. Call whenever the world changes. */
    rebuildNav() {
        this.navBlocked.fill(0)
        for (let r = 0; r < NAV_ROWS; r++) {
            for (let c = 0; c < NAV_COLS; c++) {
                const cx = (c + 0.5) * NAV_CELL
                const cy = (r + 0.5) * NAV_CELL
                for (const o of this.world.obstacles) {
                    if (Math.hypot(cx - o.x, cy - o.y) < o.r + 18) {
                        this.navBlocked[r * NAV_COLS + c] = 1
                        break
                    }
                }
            }
        }
        this.navTimer = 0
    }

    private navCell(x: number, y: number): number {
        const c = clamp(Math.floor(x / NAV_CELL), 0, NAV_COLS - 1)
        const r = clamp(Math.floor(y / NAV_CELL), 0, NAV_ROWS - 1)
        return r * NAV_COLS + c
    }

    /** Breadth-first flood from the player so every cell knows the way in. */
    private updateNav() {
        const dist = this.navDist
        const blocked = this.navBlocked
        dist.fill(-1)
        let start = this.navCell(this.player.x, this.player.y)
        if (blocked[start]) {
            // Player is hugging a rock: seed from the nearest open cell.
            const sc = start % NAV_COLS
            const sr = Math.floor(start / NAV_COLS)
            let best = -1
            let bestD = Infinity
            for (let r = Math.max(0, sr - 2); r <= Math.min(NAV_ROWS - 1, sr + 2); r++) {
                for (let c = Math.max(0, sc - 2); c <= Math.min(NAV_COLS - 1, sc + 2); c++) {
                    const i = r * NAV_COLS + c
                    if (blocked[i]) continue
                    const d = Math.hypot((c + 0.5) * NAV_CELL - this.player.x, (r + 0.5) * NAV_CELL - this.player.y)
                    if (d < bestD) {
                        bestD = d
                        best = i
                    }
                }
            }
            if (best < 0) return
            start = best
        }
        const q = this.navQueue
        let head = 0
        let tail = 0
        q[tail++] = start
        dist[start] = 0
        while (head < tail) {
            const cur = q[head++]!
            const cc = cur % NAV_COLS
            const cr = Math.floor(cur / NAV_COLS)
            const d = dist[cur]! + 1
            for (const [dc, dr] of NAV_STEPS) {
                const nc = cc + dc
                const nr = cr + dr
                if (nc < 0 || nr < 0 || nc >= NAV_COLS || nr >= NAV_ROWS) continue
                const ni = nr * NAV_COLS + nc
                if (blocked[ni] || dist[ni] !== -1) continue
                // No cutting corners through a rock.
                if (dc !== 0 && dr !== 0 && (blocked[cr * NAV_COLS + nc] || blocked[nr * NAV_COLS + cc])) continue
                dist[ni] = d
                q[tail++] = ni
            }
        }
    }

    /** Direction to walk from (x, y) toward the player, around obstacles. */
    private navDirection(x: number, y: number): Vec | null {
        const cell = this.navCell(x, y)
        const cc = cell % NAV_COLS
        const cr = Math.floor(cell / NAV_COLS)
        const here = this.navDist[cell]!
        let best = -1
        let bestD = here === -1 ? Infinity : here
        for (const [dc, dr] of NAV_STEPS) {
            const nc = cc + dc
            const nr = cr + dr
            if (nc < 0 || nr < 0 || nc >= NAV_COLS || nr >= NAV_ROWS) continue
            const ni = nr * NAV_COLS + nc
            const d = this.navDist[ni]!
            if (d === -1) continue
            if (dc !== 0 && dr !== 0 && (this.navBlocked[cr * NAV_COLS + nc] || this.navBlocked[nr * NAV_COLS + cc])) continue
            if (d < bestD) {
                bestD = d
                best = ni
            }
        }
        if (best < 0) return null
        const tx = (best % NAV_COLS + 0.5) * NAV_CELL
        const ty = (Math.floor(best / NAV_COLS) + 0.5) * NAV_CELL
        const a = Math.atan2(ty - y, tx - x)
        return { x: Math.cos(a), y: Math.sin(a) }
    }

    /** True when nothing solid sits between an enemy and the player. */
    hasLineOfSight(e: Enemy): boolean {
        const p = this.player
        for (const o of this.world.obstacles) {
            if (inSegment(e, p, o.r + e.r * 0.8, o, 0)) return false
        }
        return true
    }

    // ------------------------------------------------------------------ setup

    private makePlayer(weapon: WeaponId): Player {
        return {
            x: ARENA_W / 2, y: ARENA_H / 2, r: 12, facing: 0, aim: 0,
            hp: 100, maxHp: 100,
            weapon, chain: buildChain(WEAPONS[weapon], 0),
            attack: null, comboIndex: 0, comboTimer: 0, comboHits: 0, buffer: 0,
            dodge: null, dodgeCharges: 1, dodgeMax: 1, dodgeRecharge: 0,
            spaceHold: 0, spaceHolding: false, dodgeBuffer: 0, sprinting: false, sprintT: 0,
            special: null, specialCd: 0, specialCdMax: WEAPONS[weapon].special.cooldown,
            invuln: 0, hurtFlash: 0, walk: 0, moving: false,
            upgrades: new Map(), lastMoveX: 1, lastMoveY: 0,
            hitCount: 0, bloodlust: 0, bloodlustT: 0, phoenixUsed: 0, adrenalineT: 0, z: 0,
            abilityCd: { q: 0, e: 0 }, abilityCdMax: { q: WEAPONS[weapon].abilities[0].cooldown, e: WEAPONS[weapon].abilities[1].cooldown },
            fx: { shieldWall: 0, rally: 0, bloodrage: 0, ironSkin: 0, smoke: 0, snared: 0 },
            skewer: null, axeOut: false
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
        const rally = p.fx.rally > 0 ? 1.3 : 1
        const account = this.config.damageMult * (this.companion?.effects.damageMult ?? 1)
        return (1 + 0.15 * this.stack('might')) * (1 + 0.12 * this.stack('oversized')) * (1 + 0.3 * this.stack('colossus')) * berserk * rally * account
    }

    get attackSpeed(): number {
        const rage = this.player.fx.bloodrage > 0 ? 1.5 : 1
        return (1 + 0.12 * this.stack('haste')) * (1 + 0.05 * this.player.bloodlust) * (this.player.adrenalineT > 0 ? 1 + 0.3 * this.stack('adrenaline') : 1) * rage * companionHaste(this.companion)
    }

    get moveSpeed(): number {
        return (1 + 0.1 * this.stack('swift')) * (1 + 0.05 * this.player.bloodlust) * (1 - 0.08 * this.stack('colossus'))
    }

    /** Visual scale of the player sprite (Colossus). */
    get playerScale(): number {
        return 1 + 0.25 * this.stack('colossus')
    }

    get comboWindow(): number {
        return this.weapon.comboWindow * (1 + 0.6 * this.stack('flow'))
    }

    /** Every hit is heavy with the greataxe, the warhammer, or Titan Grip. */
    get allHeavy(): boolean {
        return this.weapon.heavy || this.stack('titangrip') > 0
    }

    get reachMult(): number {
        return (1 + 0.22 * this.stack('oversized')) * (1 + 0.2 * this.stack('colossus'))
    }

    get knockbackMult(): number {
        return 1 + 0.35 * this.stack('bruiser')
    }

    startRun(weapon: WeaponId = 'sword', config: RunConfig = DEFAULT_RUN_CONFIG) {
        this.resetRun(weapon, config)
        this.wave = 0
        this.nextWave()
    }

    /**
     * Picks a run back up from a checkpoint: either at the boon pick it was
     * closed on (offers still up) or at the start of the next wave.
     */
    restoreRun(weapon: WeaponId, save: MeadowbrawlRunSave, config: RunConfig = DEFAULT_RUN_CONFIG) {
        this.resetRun(weapon, config)
        const p = this.player
        for (const [id, stacks] of Object.entries(save.upgrades)) {
            if (UPGRADE_BY_ID[id] && stacks > 0) p.upgrades.set(id, stacks)
        }
        // Rebuild what the stacks imply instead of replaying the picks, so
        // one-shot effects (Mending's heal) don't fire again.
        p.chain = buildChain(this.weapon, this.stack('comboplus'))
        const k = Math.pow(0.75, this.stack('quickspecial'))
        p.specialCdMax = this.weapon.special.cooldown * k
        p.abilityCdMax = { q: this.weapon.abilities[0].cooldown * k, e: this.weapon.abilities[1].cooldown * k }
        p.dodgeMax = 1 + config.dodgeCharges + this.stack('doubledodge')
        p.dodgeCharges = p.dodgeMax
        p.maxHp = save.maxHp
        p.hp = Math.min(save.maxHp, Math.max(1, save.hp))
        p.phoenixUsed = save.phoenixUsed
        this.coins = save.coins
        this.stats = { ...save.stats }
        this.time = save.stats.time
        this.wave = save.wave
        if (save.offers) {
            this.offers = save.offers
                .map(id => UPGRADE_BY_ID[id])
                .filter((u): u is NonNullable<typeof u> => !!u)
                .map(u => ({ upgrade: u, stack: this.stack(u.id) + 1 }))
            this.rerollsLeft = save.rerolled ? 0 : config.rerolls
            this.rerolled = save.rerolled
            if (this.offers.length === 0) this.offers = rollOffers(this.wave, p.upgrades, randomFloat, config.offerCount)
            this.phase = 'upgrade'
        } else {
            this.skipOffers = true
            this.phase = 'calm'
            this.calmTimer = 1.5
            this.banner = { text: 'Welcome back', sub: `Wave ${this.wave + 1} is next`, t: 1.5 }
        }
    }

    /** A checkpoint of the run as it stands at a wave boundary. */
    snapshot(): MeadowbrawlRunSave {
        const p = this.player
        return {
            version: MEADOWBRAWL_SAVE_VERSION,
            wave: this.wave,
            hp: Math.max(0, Math.round(p.hp * 10) / 10),
            maxHp: p.maxHp,
            upgrades: Object.fromEntries(p.upgrades),
            offers: this.phase === 'upgrade' && this.offers.length ? this.offers.map(o => o.upgrade.id) : null,
            rerolled: this.rerolled,
            coins: Math.floor(this.coins),
            phoenixUsed: p.phoenixUsed,
            stats: {
                kills: this.stats.kills,
                elitesKilled: this.stats.elitesKilled,
                damageDealt: Math.round(this.stats.damageDealt),
                damageTaken: Math.round(this.stats.damageTaken),
                highestCombo: this.stats.highestCombo,
                time: Math.round(this.time)
            }
        }
    }

    private checkpoint() {
        if (this.onCheckpoint && this.wave >= 1 && this.wave < TOTAL_WAVES) this.onCheckpoint(this.snapshot())
    }

    /** Fortune: swap the current offers for fresh ones, once per wave. */
    rerollOffers(): boolean {
        if (this.phase !== 'upgrade' || this.rerollsLeft <= 0) return false
        this.rerollsLeft -= 1
        this.rerolled = true
        this.offers = rollOffers(this.wave, this.player.upgrades, randomFloat, this.config.offerCount)
        this.emit('upgrade')
        this.checkpoint()
        return true
    }

    private resetRun(weapon: WeaponId, config: RunConfig) {
        this.config = config
        this.world = generateWorld()
        this.rebuildNav()
        this.player = this.makePlayer(weapon)
        this.companion = config.pet ? makeCompanion(config.pet.id, config.pet.level, this.player.x, this.player.y) : null
        this.player.maxHp = config.maxHp + (this.companion?.effects.maxHp ?? 0)
        this.player.hp = this.player.maxHp
        this.player.dodgeMax = 1 + config.dodgeCharges
        this.player.dodgeCharges = this.player.dodgeMax
        this.coins = 0
        this.coinMult = config.coinMult
        this.coinDrops = []
        this.coinStreak = 0
        this.coinStreakT = 0
        this.rerollsLeft = 0
        this.rerolled = false
        this.skipOffers = false
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
        this.meteors = []
        this.singularities = []
        this.orbitals = []
        this.meteorTimer = 0
        this.swingCount = 0
        this.thrownAxes = []
        this.javelins = []
        this.seismics = []
        this.souls = []
        this.spikes = []
        this.afterimages = []
        this.flash = 0
        this.slowmo = 0
        this.events = []
        this.offers = []
        this.shake = 0
        this.hitstop = 0
        this.timeScale = 1
        this.time = 0
        this.deathT = 0
        this.paused = false
        this.stats = { kills: 0, damageDealt: 0, damageTaken: 0, highestCombo: 0, time: 0, elitesKilled: 0 }
    }

    private nextWave() {
        this.wave += 1
        this.waveElapsed = 0
        this.waveKills = 0
        this.spawnQueue = buildWave(this.wave, randomFloat)
        this.waveTotal = this.spawnQueue.reduce((s, g) => s + g.count, 0)
        // The wave's coin pool is split over its regular spawns by budget
        // weight, so a full clear adds up to exactly the pool.
        const spent = this.spawnQueue.reduce((s, g) => s + ENEMY_COST[g.type] * g.count, 0)
        this.coinPer = spent > 0 ? meadowbrawlWaveCoinPool(this.wave) / spent : 0
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
        this.checkpoint()
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
            case 'quickspecial': {
                const k = Math.pow(0.75, this.stack('quickspecial'))
                p.specialCdMax = this.weapon.special.cooldown * k
                p.specialCd = Math.min(p.specialCd, p.specialCdMax)
                p.abilityCdMax = { q: this.weapon.abilities[0].cooldown * k, e: this.weapon.abilities[1].cooldown * k }
                p.abilityCd = { q: Math.min(p.abilityCd.q, p.abilityCdMax.q), e: Math.min(p.abilityCd.e, p.abilityCdMax.e) }
                break
            }
        }
    }

    restart() {
        this.phase = 'menu'
        this.companion = null
        this.coinDrops = []
        this.enemies = []
        this.projectiles = []
        this.particles = []
        this.floaters = []
        this.trails = []
        this.rings = []
        this.bolts = []
        this.whirlwinds = []
        this.impacts = []
        this.meteors = []
        this.singularities = []
        this.orbitals = []
        this.thrownAxes = []
        this.javelins = []
        this.seismics = []
        this.souls = []
        this.spikes = []
        this.afterimages = []
        this.timeScale = 1
        this.paused = false
    }

    emit(type: GameEvent['type'], x?: number, y?: number, power?: number, variant?: string) {
        this.events.push({ type, x, y, power, variant })
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
        if (this.slowmo > 0) {
            this.slowmo -= rawDt
            dt *= 0.3
        }
        this.flash = Math.max(0, this.flash - rawDt * 3)
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
            this.updateHazards(sub)
            this.updateAbilities(sub)
            this.resolveBodies()
        }
        if (this.companion) updateCompanion(this, this.companion, dt)
        this.updateCoins(dt)
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
        i.qPressed = false
        i.ePressed = false
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
                } else if (this.skipOffers) {
                    this.skipOffers = false
                    this.nextWave()
                } else {
                    this.offers = rollOffers(this.wave, this.player.upgrades, randomFloat, this.config.offerCount)
                    this.rerollsLeft = this.config.rerolls
                    this.rerolled = false
                    this.phase = 'upgrade'
                    this.checkpoint()
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
        const veteran = !def.elite && randomChance(veteranChance(this.wave))
        const hpScale = (def.elite ? 1 + (scale.hp - 1) * 0.6 : scale.hp) * (veteran ? 1.8 : 1)
        const e: Enemy = {
            id: this.nextId++,
            type,
            def,
            x: p.x, y: p.y, vx: 0, vy: 0,
            hp: def.hp * hpScale, maxHp: def.hp * hpScale,
            r: def.radius * (veteran ? 1.15 : 1),
            speed: def.speed * scale.speed * (0.92 + Math.random() * 0.16),
            damage: def.damage * scale.damage * (veteran ? 1.3 : 1),
            facing: angleTo(p, this.player),
            state: 'spawn', stateT: 0,
            attack: null, attackCd: 0.6 + Math.random() * 0.8,
            shield: def.shield ? { hp: def.shield * hpScale, max: def.shield * hpScale, broken: false } : null,
            slow: 0, slowT: 0, frozen: 0, burn: null,
            hitFlash: 0, squash: 0, walk: Math.random() * 10, seed: Math.random(),
            alive: true, deadT: 0, entered: false, sprintHitCd: 0,
            wander: Math.random() * Math.PI * 2, stunT: 0,
            stun: 0, stunMax: STUN_MAX, stunLock: 0, parryT: 0, combo: 0,
            moveT: type === 'briar' ? 4 : type === 'knight' ? 3.5 : 0, brood: [],
            coin: def.elite ? meadowbrawlEliteCoinBonus(this.wave) : Math.round(this.coinPer * ENEMY_COST[type]),
            veteran, marked: 0
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
        p.adrenalineT = Math.max(0, p.adrenalineT - dt)
        p.abilityCd.q = Math.max(0, p.abilityCd.q - dt)
        p.abilityCd.e = Math.max(0, p.abilityCd.e - dt)
        for (const key of Object.keys(p.fx) as (keyof Player['fx'])[]) p.fx[key] = Math.max(0, p.fx[key] - dt)
        if (first && (p.abilityCd.q === 0 || p.abilityCd.e === 0) && this.readyPing) {
            this.readyPing = false
            this.emit('abilityReady', p.x, p.y)
        }
        if (p.abilityCd.q > 0 && p.abilityCd.e > 0) this.readyPing = true
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

        // Space outranks everything: it rolls on the press, cancelling whatever
        // you were doing, and only becomes a sprint once the roll is over.
        if (first) {
            if (input.spacePressed) {
                p.spaceHolding = true
                p.spaceHold = 0
                p.dodgeBuffer = DODGE_BUFFER
            }
            if (input.attackPressed) p.buffer = 0.3
        }
        if (p.dodgeBuffer > 0) {
            if (this.tryDodge()) p.dodgeBuffer = 0
            // Out of charges is a dead press — drop it so a held space can
            // still become a sprint. A committed special keeps it queued.
            else if (p.dodgeCharges <= 0) p.dodgeBuffer = 0
            else p.dodgeBuffer = Math.max(0, p.dodgeBuffer - dt)
        }
        if (p.spaceHolding) {
            p.spaceHold += dt
            if (p.spaceHold >= SPRINT_HOLD && p.dodgeBuffer <= 0 && !p.sprinting && !p.dodge && !p.special) {
                this.startSprint()
            }
        }
        if (first && input.spaceReleased) {
            p.spaceHolding = false
            if (p.sprinting) {
                p.sprinting = false
                p.sprintT = 0
            }
        }
        // The key being up is the source of truth: a release edge lost to a
        // blur or an alt-tab must not leave a phantom hold that later yanks
        // the player into a sprint mid-swing.
        if (!input.spaceDown) {
            p.spaceHolding = false
            if (p.sprinting) {
                p.sprinting = false
                p.sprintT = 0
            }
        }

        // The last stretch of a roll is cancellable, so recoveries never
        // strand you: everything before it is committed.
        const rolling = !!p.dodge && p.dodge.t < p.dodge.dur * DODGE_CANCEL

        // Class abilities: Q and E. They respect the same commit rules as the
        // special, and nothing about them cancels a roll.
        if (first && !rolling && !p.special && !p.skewer) {
            if (input.qPressed && p.abilityCd.q <= 0) {
                if (p.dodge) this.endDodge()
                this.useAbility('q')
            } else if (input.ePressed && p.abilityCd.e <= 0) {
                if (p.dodge) this.endDodge()
                this.useAbility('e')
            }
        }

        // Special: right click.
        if (first && input.specialPressed && p.specialCd <= 0 && !rolling && !p.special && !p.skewer) {
            if (p.dodge) this.endDodge()
            this.startSpecial()
        }

        // Attacks and combo chaining.
        if (p.buffer > 0 && !rolling && !p.special && !p.skewer) {
            if (p.dodge) this.endDodge()
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
        let speed = PLAYER_SPEED * this.moveSpeed * (p.fx.snared > 0 ? 0.55 : 1)
        let vx = 0
        let vy = 0

        if (p.skewer) {
            // Movement handled in updateAbilities; the player is committed.
        } else if (p.dodge) {
            const d = p.dodge
            d.t += dt
            const k = d.t / d.dur
            // Ease-out: most of the distance early, then settle.
            const s = (1 - k) * (1 - k) * 3 * DODGE_DIST / d.dur
            vx = d.dx * s
            vy = d.dy * s
            if (k > 0.1 && k < 0.7 && Math.random() < 0.6) {
                this.puff(p.x - d.dx * 8, p.y - d.dy * 8, 1, '#c9b98c')
            }
            if (d.t >= d.dur) this.endDodge()
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
        if (p.fx.shieldWall > 0) {
            vx *= 0.45
            vy *= 0.45
        }

        p.x += vx * dt
        p.y += vy * dt
        // Afterimages while moving fast.
        const fast = (p.sprinting && p.sprintT > 0.2) || !!p.dodge || p.special?.kind === 'dash' || !!p.skewer
        this.afterimageT -= dt
        if (fast && this.afterimageT <= 0) {
            this.afterimageT = 0.04
            this.afterimages.push({ x: p.x, y: p.y, facing: p.facing, life: 0.3, maxLife: 0.3, color: this.weapon.color, weapon: p.weapon })
        }
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

    /**
     * Specials you cannot roll out of: the movement ones are already an evade,
     * and the short committed ones (slam, sweep, backstab) own their animation.
     * The scythe's one-second channel is fair game.
     */
    private specialBlocksDodge(): boolean {
        const s = this.player.special
        return !!s && s.kind !== 'whirl'
    }

    /** Start a roll now. Returns false if it has to wait or can't happen. */
    private tryDodge(): boolean {
        const p = this.player
        if (p.dodgeCharges <= 0) return false
        if (p.dodge && p.dodge.t < p.dodge.dur * DODGE_CANCEL) return false
        if (this.specialBlocksDodge()) return false
        p.special = null
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
        // Chain-rolling out of the tail still pays out the old roll.
        this.endDodge()
        p.dodge = { t: 0, dur: DODGE_DUR, dx, dy }
        p.invuln = Math.max(p.invuln, DODGE_IFRAMES)
        // Dodging cancels the combo — the tactical cost.
        p.attack = null
        p.buffer = 0
        p.comboIndex = 0
        p.comboTimer = 0
        p.comboHits = 0
        p.sprinting = false
        p.sprintT = 0
        p.spaceHold = 0
        p.facing = Math.atan2(dy, dx)
        // Rolling out of a hit is the whole point — don't sit in its hit-stop.
        this.hitstop = 0
        this.burst(p.x, p.y, 0, 6, 'dust', '#cbbd93', 80, 0.45)
        this.emit('dodge', p.x, p.y)
        return true
    }

    /** End the roll, whether it ran out or was cancelled into another action. */
    private endDodge() {
        const p = this.player
        if (!p.dodge) return
        p.dodge = null
        const rt = this.stack('rollingthunder')
        if (rt > 0) this.thunderclap(p.x, p.y, 90 + 20 * rt, this.weapon.baseDamage * this.damageMult * (0.8 + 0.3 * (rt - 1)))
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
        this.emit('swing', p.x, p.y, def.finisher ? 1 : 0.5, p.weapon)
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
            const mirror = this.stack('mirror')
            for (const e of this.enemies) {
                if (!e.alive || a.hitIds.has(e.id)) continue
                if (shapeHits(a.def.shape, p, a.dir, this.reachMult, e, e.r)) {
                    a.hitIds.add(e.id)
                    this.playerHitEnemy(e, a.def)
                } else if (mirror > 0 && shapeHits(a.def.shape, p, a.dir + Math.PI, this.reachMult, e, e.r)) {
                    a.hitIds.add(e.id)
                    this.playerHitEnemy(e, a.def, 0.5 + 0.15 * (mirror - 1))
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
        this.swingCount += 1
        const spectral = this.stack('spectral')
        if (spectral > 0 && this.swingCount % 4 === 0) {
            this.orbitals.push({ life: 5, maxLife: 5, angle: p.aim, damage: this.weapon.baseDamage * this.damageMult * (0.5 + 0.2 * (spectral - 1)), cooldowns: new Map() })
            this.burst(p.x, p.y, 30, 10, 'spark', '#bfe6ff', 120, 0.4)
        }
        const cleaving = this.stack('cleavingwind')
        if (cleaving > 0 && a.def.finisher) {
            this.projectiles.push({
                id: this.nextId++, x: p.x + Math.cos(a.dir) * 30, y: p.y + Math.sin(a.dir) * 30,
                vx: Math.cos(a.dir) * 520, vy: Math.sin(a.dir) * 520, life: 1.1,
                damage: this.weapon.baseDamage * this.damageMult * (2 + 0.7 * (cleaving - 1)),
                r: 34 * reach, owner: 'player', pierce: 999, hitIds: new Set(), kind: 'crescent', angle: a.dir
            })
        }
        if (shape.kind === 'arc') {
            const half = shape.halfAngle
            this.trails.push({
                x: p.x, y: p.y, angle0: a.dir - half * a.def.sweep, angle1: a.dir + half * a.def.sweep,
                reach: shape.reach * reach, life: 0.22, maxLife: 0.22, color: this.weapon.color, kind: 'arc',
                width: a.def.finisher ? 30 : 20, z: 16, style: p.weapon, finisher: !!a.def.finisher
            })
            this.swingFlourish(a.dir, shape.reach * reach, !!a.def.finisher)
            if (this.stack('mirror') > 0) {
                this.trails.push({
                    x: p.x, y: p.y, angle0: a.dir + Math.PI - half * a.def.sweep, angle1: a.dir + Math.PI + half * a.def.sweep,
                    reach: shape.reach * reach, life: 0.22, maxLife: 0.22, color: '#bfe6ff', kind: 'arc', width: 18, z: 16, style: 'ghost'
                })
            }
        } else if (shape.kind === 'thrust') {
            this.trails.push({
                x: p.x, y: p.y, angle0: a.dir, angle1: a.dir, reach: shape.reach * reach,
                life: 0.18, maxLife: 0.18, color: this.weapon.color, kind: 'thrust', width: shape.width * reach, z: 16, style: p.weapon, finisher: !!a.def.finisher
            })
            this.swingFlourish(a.dir, shape.reach * reach, !!a.def.finisher)
            if (this.stack('mirror') > 0) {
                this.trails.push({
                    x: p.x, y: p.y, angle0: a.dir + Math.PI, angle1: a.dir + Math.PI, reach: shape.reach * reach,
                    life: 0.18, maxLife: 0.18, color: '#bfe6ff', kind: 'thrust', width: shape.width * reach, z: 16, style: 'ghost'
                })
            }
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

    private playerHitEnemy(e: Enemy, def: SwingDef, scale = 1) {
        const p = this.player
        const heavy = !!def.finisher || this.allHeavy
        const flow = this.stack('flow') > 0 ? 1 + Math.min(10, p.comboHits) * 0.06 * this.stack('flow') : 1
        const ambush = p.fx.smoke > 0
        const crit = ambush || (this.stack('crit') > 0 && randomChance(0.15 * this.stack('crit')))
        const dmg = this.weapon.baseDamage * this.damageMult * def.damage * flow * scale * (ambush ? 3 : crit ? 2.5 : 1)
        if (ambush) {
            p.fx.smoke = 0
            this.floaters.push({ x: e.x, y: e.y, z: e.def.height + 18, text: 'AMBUSH', life: 0.9, maxLife: 0.9, color: '#f7d774', size: 16, vx: 0 })
            this.slowmo = Math.max(this.slowmo, 0.25)
            this.emit('ambush', e.x, e.y)
        }
        const dealt = this.damageEnemy(e, dmg, {
            source: p, heavy: heavy || ambush, knockback: def.knockback * (crit ? 1.4 : 1), stagger: def.stagger, tag: 'melee', crit, finisher: !!def.finisher
        })
        if (dealt > 0) {
            p.comboHits += 1
            this.stats.highestCombo = Math.max(this.stats.highestCombo, p.comboHits)
            p.hitCount += 1
            const echo = this.stack('echo')
            if (echo > 0 && p.hitCount % 3 === 0 && e.alive) {
                this.damageEnemy(e, dmg * (0.7 + 0.15 * (echo - 1)), { source: p, heavy, knockback: def.knockback * 0.5, stagger: def.stagger, tag: 'echo', color: '#9fe3ff', finisher: !!def.finisher })
                this.impacts.push({ x: e.x, y: e.y, z: e.def.height * 0.5, life: 0.25, maxLife: 0.25, size: 26, color: '#9fe3ff', kind: 'slash', angle: p.aim + 0.8 })
            }
        }
    }

    // -------------------------------------------------------------- abilities

    private readyPing = false

    private useAbility(key: 'q' | 'e') {
        const p = this.player
        const def = this.weapon.abilities[key === 'q' ? 0 : 1]
        p.abilityCd[key] = p.abilityCdMax[key]
        p.attack = null
        p.buffer = 0
        p.sprinting = false
        p.sprintT = 0
        const base = this.weapon.baseDamage * this.damageMult * def.damage
        const dx = Math.cos(p.aim)
        const dy = Math.sin(p.aim)
        p.facing = p.aim
        this.emit('ability', p.x, p.y, 1, def.id)
        switch (def.id) {
            case 'shieldwall':
                p.fx.shieldWall = 1.5
                this.rings.push({ x: p.x, y: p.y, r0: 8, r1: 60, life: 0.3, maxLife: 0.3, color: '#dbe4f3', width: 6 })
                this.glow(p.x, p.y, 30, 12, '#bcd3ff', 90, 0.5)
                break
            case 'rally': {
                p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.15)
                p.fx.rally = 4
                this.rings.push({ x: p.x, y: p.y, r0: 10, r1: 160, life: 0.45, maxLife: 0.45, color: '#ffd166', width: 10 })
                this.glow(p.x, p.y, 20, 30, '#ffd166', 200, 0.7)
                this.floaters.push({ x: p.x, y: p.y, z: 60, text: 'RALLY', life: 1, maxLife: 1, color: '#ffd166', size: 20, vx: 0 })
                this.shake = Math.max(this.shake, 6)
                for (const e of this.enemies) {
                    if (e.alive && inCircle(p, 140, e, e.r)) {
                        this.setStagger(e, 0.7)
                        e.vx += (e.x - p.x) * 3
                        e.vy += (e.y - p.y) * 3
                    }
                }
                break
            }
            case 'bloodrage':
                p.fx.bloodrage = 5
                this.rings.push({ x: p.x, y: p.y, r0: 10, r1: 90, life: 0.35, maxLife: 0.35, color: '#ff3b3b', width: 8 })
                this.burst(p.x, p.y, 20, 24, 'blood', '#b0121f', 160, 0.7)
                this.glow(p.x, p.y, 24, 16, '#ff5a3c', 120, 0.6)
                this.floaters.push({ x: p.x, y: p.y, z: 60, text: 'RAGE', life: 1, maxLife: 1, color: '#ff5a3c', size: 22, vx: 0 })
                this.shake = Math.max(this.shake, 5)
                break
            case 'rendingthrow':
                p.axeOut = true
                this.thrownAxes.push({ x: p.x + dx * 20, y: p.y + dy * 20, vx: dx * 640, vy: dy * 640, t: 0, phase: 'out', hitIds: new Set(), spin: 0, damage: base })
                break
            case 'skewer':
                p.skewer = { t: 0, dur: 0.42, dx, dy, carried: [], hitIds: new Set() }
                p.invuln = Math.max(p.invuln, 0.45)
                this.burst(p.x, p.y, 0, 12, 'dust', '#cbbd93', 140, 0.5)
                break
            case 'javelinrain': {
                const cx = clamp(this.input.aimX, 40, ARENA_W - 40)
                const cy = clamp(this.input.aimY, 40, ARENA_H - 40)
                for (let i = 0; i < 7; i++) {
                    const a = Math.random() * Math.PI * 2
                    const d = i === 0 ? 0 : Math.sqrt(Math.random()) * 95
                    this.javelins.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, t: 0, delay: 0.35 + i * 0.11, stuck: 1.6, damage: base, angle: -0.6 + Math.random() * 0.4 })
                }
                break
            }
            case 'smokebomb':
                p.fx.smoke = 2.5
                this.burst(p.x, p.y, 6, 28, 'smoke', '#3a3346', 120, 1.2)
                this.glow(p.x, p.y, 16, 10, '#9b8fc0', 60, 0.7)
                for (const e of this.enemies) {
                    if (e.alive && e.state === 'windup') {
                        e.attack = null
                        e.state = 'chase'
                    }
                }
                break
            case 'fanofknives':
                for (let i = 0; i < 9; i++) {
                    const a = p.aim + (i / 8 - 0.5) * (70 * Math.PI / 180)
                    this.projectiles.push({ id: this.nextId++, x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16, vx: Math.cos(a) * 580, vy: Math.sin(a) * 580, life: 0.8, damage: base, r: 8, owner: 'player', pierce: 1, hitIds: new Set(), kind: 'knife', angle: a })
                }
                break
            case 'ironskin':
                p.fx.ironSkin = 4
                this.rings.push({ x: p.x, y: p.y, r0: 8, r1: 80, life: 0.35, maxLife: 0.35, color: '#c8ccd2', width: 8 })
                this.burst(p.x, p.y, 20, 18, 'spark', '#e6ebf2', 160, 0.5)
                this.floaters.push({ x: p.x, y: p.y, z: 60, text: 'IRON', life: 1, maxLife: 1, color: '#e6ebf2', size: 20, vx: 0 })
                break
            case 'seismic':
                this.seismics.push({ x: p.x + dx * 40, y: p.y + dy * 40, dx, dy, t: 0, next: 0, remaining: 9, damage: base })
                this.shake = Math.max(this.shake, 8)
                break
            case 'soulharvest': {
                const radius = 220 * this.reachMult
                this.rings.push({ x: p.x, y: p.y, r0: radius, r1: 10, life: 0.5, maxLife: 0.5, color: '#8fe3c8', width: 10 })
                let hits = 0
                for (const e of this.enemies) {
                    if (!e.alive || !inCircle(p, radius, e, e.r)) continue
                    hits++
                    this.damageEnemy(e, base, { source: p, heavy: true, knockback: 60, stagger: 0.4, tag: 'special', bypassShield: true, color: '#8fe3c8' })
                    this.souls.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 2, targetId: -1, damage: 0 })
                }
                if (hits > 0) {
                    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.04 * hits)
                    this.floaters.push({ x: p.x, y: p.y, z: 60, text: `+${Math.round(p.maxHp * 0.04 * hits)}`, life: 1, maxLife: 1, color: '#8fe3c8', size: 18, vx: 0 })
                }
                this.hitstop = Math.max(this.hitstop, 0.06)
                break
            }
            case 'deathmark': {
                const targets = this.enemies.filter(e => e.alive).map(e => ({ e, d: Math.hypot(e.x - p.x, e.y - p.y) })).filter(t => t.d < 420).sort((a, b) => a.d - b.d).slice(0, 5)
                for (const t of targets) {
                    t.e.marked = 5
                    this.glow(t.e.x, t.e.y, t.e.def.height * 0.6, 6, '#c9a3ff', 40, 0.6)
                }
                break
            }
        }
    }

    private updateAbilities(dt: number) {
        const p = this.player
        const w = this.weapon
        // Skewer Charge — carry enemies on the tip, slam them at the end.
        if (p.skewer) {
            const s = p.skewer
            s.t += dt
            const speed = 300 / s.dur
            p.x += s.dx * speed * dt
            p.y += s.dy * speed * dt
            this.collidePlayer()
            p.facing = Math.atan2(s.dy, s.dx)
            const tipX = p.x + s.dx * 90 * this.reachMult
            const tipY = p.y + s.dy * 90 * this.reachMult
            for (const e of this.enemies) {
                if (!e.alive || s.hitIds.has(e.id)) continue
                if (inSegment(p, { x: tipX, y: tipY }, 26, e, e.r)) {
                    s.hitIds.add(e.id)
                    this.damageEnemy(e, w.baseDamage * this.damageMult * 0.8, { source: p, heavy: true, knockback: 0, stagger: 0.6, tag: 'special' })
                    if (!e.def.elite && e.alive) s.carried.push(e.id)
                }
            }
            for (const id of s.carried) {
                const e = this.enemies.find(o => o.id === id)
                if (!e || !e.alive) continue
                e.x = tipX + (Math.random() - 0.5) * 6
                e.y = tipY + (Math.random() - 0.5) * 6
                e.vx = 0
                e.vy = 0
                e.state = 'stagger'
                e.stunT = Math.max(e.stunT, 0.5)
                e.stateT = 0
                e.attack = null
            }
            if (s.t >= s.dur) {
                const base = w.baseDamage * this.damageMult * w.abilities[0].damage
                this.rings.push({ x: tipX, y: tipY, r0: 10, r1: 110, life: 0.35, maxLife: 0.35, color: '#e7d7b8', width: 10 })
                this.burst(tipX, tipY, 0, 20, 'dust', '#bfae83', 200, 0.6)
                this.decals.push({ x: tipX, y: tipY, r: 30, color: '#4a3a2a', kind: 'crack' })
                this.shake = Math.max(this.shake, 12)
                this.hitstop = Math.max(this.hitstop, 0.08)
                for (const e of this.enemies) {
                    if (!e.alive) continue
                    if (inCircle({ x: tipX, y: tipY }, 100, e, e.r)) this.damageEnemy(e, base, { source: p, heavy: true, knockback: 360, stagger: 1.0, tag: 'special', bypassShield: true })
                }
                p.skewer = null
                this.emit('special', tipX, tipY, 1)
            }
        }
        // Rending Throw — boomerang axe.
        for (let i = this.thrownAxes.length - 1; i >= 0; i--) {
            const a = this.thrownAxes[i]!
            a.t += dt
            a.spin += dt * 22
            if (a.phase === 'out' && a.t >= 0.42) {
                a.phase = 'back'
                a.hitIds.clear()
            }
            if (a.phase === 'back') {
                const d = Math.hypot(p.x - a.x, p.y - a.y)
                const spd = 720
                a.vx = (p.x - a.x) / Math.max(1, d) * spd
                a.vy = (p.y - a.y) / Math.max(1, d) * spd
                if (d < 24) {
                    this.thrownAxes.splice(i, 1)
                    p.axeOut = this.thrownAxes.length > 0
                    this.burst(p.x, p.y, 20, 6, 'spark', '#fff2c4', 120, 0.3)
                    continue
                }
            }
            a.x += a.vx * dt
            a.y += a.vy * dt
            for (const e of this.enemies) {
                if (!e.alive || a.hitIds.has(e.id)) continue
                if (Math.hypot(e.x - a.x, e.y - a.y) <= e.r + 26) {
                    a.hitIds.add(e.id)
                    this.damageEnemy(e, a.damage, { source: a, heavy: true, knockback: 240, stagger: 0.5, tag: 'special' })
                }
            }
            if (Math.random() < 0.5) this.burst(a.x, a.y, 16, 1, 'ember', '#ff9a3c', 30, 0.3)
        }
        // Javelin Rain.
        for (let i = this.javelins.length - 1; i >= 0; i--) {
            const j = this.javelins[i]!
            j.t += dt
            if (j.t >= j.delay && j.t - dt < j.delay) {
                this.burst(j.x, j.y, 0, 10, 'dust', '#bfae83', 120, 0.45)
                this.burst(j.x, j.y, 4, 5, 'spark', '#ffe9a8', 140, 0.25)
                this.impacts.push({ x: j.x, y: j.y, z: 6, life: 0.2, maxLife: 0.2, size: 24, color: '#ffffff', kind: 'ring', angle: 0 })
                this.shake = Math.max(this.shake, 3)
                this.emit('special', j.x, j.y, 0.5, 'javelin')
                for (const e of this.enemies) {
                    if (!e.alive) continue
                    if (inCircle(j, 46, e, e.r)) this.damageEnemy(e, j.damage, { source: j, heavy: true, knockback: 140, stagger: 0.45, tag: 'special', bypassShield: true })
                }
            }
            if (j.t >= j.delay + j.stuck) this.javelins.splice(i, 1)
        }
        // Seismic Line.
        for (let i = this.seismics.length - 1; i >= 0; i--) {
            const sm = this.seismics[i]!
            sm.t += dt
            sm.next -= dt
            if (sm.next <= 0 && sm.remaining > 0) {
                sm.next = 0.055
                sm.remaining--
                const x = clamp(sm.x, 20, ARENA_W - 20)
                const y = clamp(sm.y, 20, ARENA_H - 20)
                this.spikes.push({ x, y, life: 0.5, maxLife: 0.5, angle: Math.atan2(sm.dy, sm.dx), size: 26 + Math.random() * 10 })
                this.burst(x, y, 0, 6, 'chip', '#6b5a48', 220, 0.5)
                this.burst(x, y, 0, 6, 'dust', '#bfae83', 120, 0.4)
                this.decals.push({ x, y, r: 18, color: '#4a3a2a', kind: 'crack' })
                this.shake = Math.max(this.shake, 5)
                for (const e of this.enemies) {
                    if (!e.alive) continue
                    if (inCircle({ x, y }, 44, e, e.r)) this.damageEnemy(e, sm.damage, { source: { x: x - sm.dx * 10, y: y - sm.dy * 10 }, heavy: true, knockback: 320, stagger: 0.7, tag: 'special' })
                }
                sm.x += sm.dx * 44
                sm.y += sm.dy * 44
            }
            if (sm.remaining <= 0) this.seismics.splice(i, 1)
        }
        for (let i = this.spikes.length - 1; i >= 0; i--) {
            const sp = this.spikes[i]!
            sp.life -= dt
            if (sp.life <= 0) this.spikes.splice(i, 1)
        }
        // Souls — heal wisps fly home, hunting souls chase marked prey.
        for (let i = this.souls.length - 1; i >= 0; i--) {
            const so = this.souls[i]!
            so.life -= dt
            let tx = p.x
            let ty = p.y
            if (so.targetId >= 0) {
                let target = this.enemies.find(e => e.id === so.targetId && e.alive)
                if (!target) {
                    let bd = Infinity
                    for (const e of this.enemies) {
                        if (!e.alive) continue
                        const d = Math.hypot(e.x - so.x, e.y - so.y) * (e.marked > 0 ? 0.5 : 1)
                        if (d < bd) {
                            bd = d
                            target = e
                        }
                    }
                    if (target) so.targetId = target.id
                }
                if (target) {
                    tx = target.x
                    ty = target.y
                }
            }
            const d = Math.hypot(tx - so.x, ty - so.y)
            const acc = 1600
            so.vx += (tx - so.x) / Math.max(1, d) * acc * dt
            so.vy += (ty - so.y) / Math.max(1, d) * acc * dt
            const sp = Math.hypot(so.vx, so.vy)
            const max = 520
            if (sp > max) {
                so.vx *= max / sp
                so.vy *= max / sp
            }
            so.x += so.vx * dt
            so.y += so.vy * dt
            if (Math.random() < 0.7) this.glow(so.x, so.y, 18, 1, so.targetId >= 0 ? '#c9a3ff' : '#8fe3c8', 10, 0.35)
            if (d < 18) {
                if (so.targetId >= 0) {
                    const target = this.enemies.find(e => e.id === so.targetId)
                    if (target?.alive) this.damageEnemy(target, so.damage, { source: so, knockback: 80, stagger: 0.2, tag: 'proj', bypassShield: true, color: '#c9a3ff' })
                }
                this.glow(so.x, so.y, 18, 6, so.targetId >= 0 ? '#c9a3ff' : '#8fe3c8', 60, 0.4)
                this.souls.splice(i, 1)
                continue
            }
            if (so.life <= 0) this.souls.splice(i, 1)
        }
        for (const e of this.enemies) if (e.marked > 0) e.marked = Math.max(0, e.marked - dt)
        for (let i = this.afterimages.length - 1; i >= 0; i--) {
            const a = this.afterimages[i]!
            a.life -= dt
            if (a.life <= 0) this.afterimages.splice(i, 1)
        }
    }

    /** Soft additive glow motes. */
    glow(x: number, y: number, z: number, count: number, color: string, speed: number, life: number) {
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2
            const sp = speed * (0.2 + Math.random())
            this.particles.push({ x, y, z: z + (Math.random() - 0.5) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 20 + Math.random() * 40, life: life * (0.6 + Math.random() * 0.6), maxLife: life, size: 6 + Math.random() * 8, color, kind: 'glow', gravity: -10, decal: false })
        }
        if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES)
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
        const singularity = this.stack('singularity')
        if (singularity > 0) {
            this.singularities.push({ x: p.x, y: p.y, life: 3, maxLife: 3, radius: 110 + 30 * (singularity - 1), tick: 0, damage: this.weapon.baseDamage * this.damageMult * (0.3 + 0.15 * (singularity - 1)), spin: 0 })
        }
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
                    this.setStagger(e, 0.35)
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
                this.trails.push({ x: ox, y: oy, angle0: p.aim, angle1: p.aim, reach: Math.hypot(p.x - ox, p.y - oy) + 6, life: 0.2, maxLife: 0.2, color: w.color, kind: 'thrust', width: 40, z: 14, style: p.weapon })
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
                    this.trails.push({ x: p.x, y: p.y, angle0: p.aim, angle1: p.aim + Math.PI * 2, reach: radius, life: 0.3, maxLife: 0.3, color: w.color, kind: 'ring', width: 28, z: 16, style: p.weapon, finisher: true })
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
                    this.trails.push({ x: p.x, y: p.y, angle0: p.aim + s.t * 14, angle1: p.aim + s.t * 14 + 2.4, reach: radius, life: 0.16, maxLife: 0.16, color: w.color, kind: 'arc', width: 26, z: 16, style: p.weapon })
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
                    this.trails.push({ x: p.x, y: p.y, angle0: p.aim - 1.2, angle1: p.aim + 1.2, reach: 62 * this.reachMult, life: 0.2, maxLife: 0.2, color: w.color, kind: 'arc', width: 24, z: 18, style: p.weapon, finisher: true })
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
        /** Hit-reaction flinch hint. Only ordinary enemies ever flinch. */
        stagger?: number
        /** Combo finishers put extra weight behind the stun meter. */
        finisher?: boolean
        tag: 'melee' | 'special' | 'proj' | 'sprint' | 'whirl' | 'shock' | 'lightning' | 'burn' | 'explode' | 'echo' | 'thorns' | 'thunder' | 'blossom'
        bypassShield?: boolean
        color?: string
        crit?: boolean
    }): number {
        if (!e.alive) return 0
        const heavy = !!opts.heavy
        const angleFromEnemy = angleTo(e, opts.source)
        if (e.parryT > 0 && (opts.tag === 'melee' || opts.tag === 'special' || opts.tag === 'echo')) {
            this.parryRiposte(e, angleFromEnemy)
            return 0
        }
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
                        this.addStun(e, STUN_MAX)
                        this.hitstop = Math.max(this.hitstop, 0.07)
                        this.shake = Math.max(this.shake, 7)
                        this.emit('shieldBreak', e.x, e.y)
                    } else {
                        this.setStagger(e, FLINCH_MAX)
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
        if (e.marked > 0) dmg *= 1.4
        if (e.state === 'stagger' && e.stunT > 0) dmg *= STUN_VULN
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
        if (direct && e.hp > 0) this.buildStun(e, dmg, heavy, !!opts.crit, !!opts.finisher)
        // The swing's own stagger figure is now only a hit-reaction hint.
        if (opts.stagger) this.setStagger(e, heavy ? FLINCH_MAX : clamp(opts.stagger, FLINCH_MIN, FLINCH_MAX))

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

        // Procs above can cascade back into this enemy and kill it first.
        if (e.hp <= 0 && e.alive) this.killEnemy(e, kbDir, heavy)
        return dmg
    }

    /**
     * A hit reaction. Elites and poise enemies shrug these off entirely —
     * the only thing that interrupts them is a full stun meter.
     */
    private setStagger(e: Enemy, seconds: number) {
        if (e.def.poise || e.def.elite) return
        if (e.state === 'dead' || e.state === 'spawn') return
        e.stunT = Math.max(e.state === 'stagger' ? e.stunT - e.stateT : 0, seconds)
        e.state = 'stagger'
        e.stateT = 0
        e.attack = null
    }

    /** Feed the poise meter. Share of the target's own pool, per hit. */
    private buildStun(e: Enemy, dmg: number, heavy: boolean, crit: boolean, finisher: boolean) {
        const base = Math.min(STUN_GAIN_CAP, dmg / Math.max(1, e.maxHp) * 100 * (e.def.elite ? STUN_GAIN_ELITE : STUN_GAIN_REGULAR))
        const mods = (heavy ? 2 : 1) * (crit ? 1.5 : 1) * (finisher ? 1.5 : 1) * (1 + 0.35 * this.stack('bruiser'))
        this.addStun(e, base * mods)
    }

    /** Add to the meter, and break the enemy the moment it tops out. */
    addStun(e: Enemy, amount: number) {
        if (!e.alive || e.state === 'dead' || e.state === 'spawn') return
        if (e.stunLock > 0 || (e.state === 'stagger' && e.stunT > 0)) return
        e.stun = Math.min(e.stunMax, e.stun + amount)
        if (e.stun >= e.stunMax) this.stunEnemy(e)
    }

    /** Meter full: a real, poise-ignoring stun with a vulnerability window. */
    private stunEnemy(e: Enemy) {
        e.stun = e.stunMax
        e.stunT = e.def.elite ? STUN_DUR_ELITE : STUN_DUR_REGULAR
        e.state = 'stagger'
        e.stateT = 0
        e.attack = null
        e.parryT = 0
        e.combo = 0
        this.floaters.push({ x: e.x, y: e.y, z: e.def.height + 14, text: 'STUNNED', life: 1, maxLife: 1, color: '#ffd166', size: e.def.elite ? 20 : 15, vx: 0 })
        this.rings.push({ x: e.x, y: e.y, r0: 6, r1: e.r * 3.2, life: 0.4, maxLife: 0.4, color: '#ffe9a8', width: 9 })
        this.impacts.push({ x: e.x, y: e.y, z: e.def.height * 0.6, life: 0.3, maxLife: 0.3, size: e.def.elite ? 60 : 34, color: '#fff3c4', kind: 'ring', angle: 0 })
        this.burst(e.x, e.y, e.def.height * 0.5, e.def.elite ? 18 : 8, 'spark', '#ffe9a8', 220, 0.5)
        this.hitstop = Math.max(this.hitstop, e.def.elite ? 0.12 : 0.05)
        this.shake = Math.max(this.shake, e.def.elite ? 12 : 5)
        this.emit('stun', e.x, e.y, e.def.elite ? 1 : 0.5, e.type)
    }

    /** Hollow Knight turns a blocked blow into a thrust of his own. */
    private parryRiposte(e: Enemy, angleFromEnemy: number) {
        e.parryT = 0
        e.facing = angleFromEnemy
        this.floaters.push({ x: e.x, y: e.y, z: e.def.height + 10, text: 'PARRY', life: 0.8, maxLife: 0.8, color: '#bcd3ff', size: 16, vx: 0 })
        this.burst(e.x + Math.cos(angleFromEnemy) * e.r, e.y + Math.sin(angleFromEnemy) * e.r, e.def.height * 0.5, 12, 'spark', '#dbe9ff', 240, 0.35)
        this.impacts.push({ x: e.x, y: e.y, z: e.def.height * 0.6, life: 0.2, maxLife: 0.2, size: 30, color: '#bcd3ff', kind: 'burst', angle: angleFromEnemy })
        this.hitstop = Math.max(this.hitstop, 0.06)
        this.emit('shieldBlock', e.x, e.y, 1, 'knight')
        this.beginAttack(e, { kind: 'melee', windup: 0.22, reach: 104, halfAngle: 0.42, damage: e.damage * 1.5, knockback: 260, recover: 0.5, tracking: 0.9, lunge: 46 }, angleFromEnemy)
    }

    private onHitProcs(e: Enemy, dmg: number, tag: string) {
        const p = this.player
        const ls = this.stack('lifesteal') + (p.fx.bloodrage > 0 ? 2.5 : 0)
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
        if (!e.alive) return
        e.alive = false
        e.state = 'dead'
        e.deadT = 0
        e.attack = null
        e.vx += Math.cos(dir) * (heavy ? 160 : 80)
        e.vy += Math.sin(dir) * (heavy ? 160 : 80)
        this.stats.kills += 1
        this.waveKills += 1
        if (e.def.elite) this.stats.elitesKilled += 1
        this.dropCoins(e, dir)
        this.burst(e.x, e.y, e.def.height * 0.4, e.def.elite ? 40 : 16, 'blood', '#8f0f1c', e.def.elite ? 220 : 150, 0.9, dir)
        this.decals.push({ x: e.x, y: e.y, r: e.def.elite ? 46 : 16 + e.r, color: 'rgba(120,10,20,0.55)', kind: 'blood' })
        this.hitstop = Math.max(this.hitstop, e.def.elite ? 0.16 : 0.05)
        this.shake = Math.max(this.shake, e.def.elite ? 18 : 4)
        this.emit('kill', e.x, e.y, e.def.elite ? 1 : 0.4, e.type)
        // Every archetype dies its own way.
        switch (e.type) {
            case 'swarmer': this.burst(e.x, e.y, 10, 14, 'leaf', '#8fd15a', 140, 0.8); break
            case 'ranged': this.burst(e.x, e.y, 16, 18, 'spore', '#c48cff', 90, 1.2); this.glow(e.x, e.y, 16, 6, '#d9a6ff', 60, 0.8); break
            case 'charger': this.burst(e.x, e.y, 0, 14, 'dust', '#bfae83', 160, 0.6); break
            case 'shield': this.burst(e.x, e.y, 20, 10, 'chip', '#8c7a5a', 200, 0.6); this.burst(e.x, e.y, 20, 8, 'spark', '#fff2c4', 200, 0.3); break
            case 'ogre':
            case 'warlord':
                this.burst(e.x, e.y, 30, 16, 'bone', '#efe7d6', 260, 1.4)
                this.burst(e.x, e.y, 20, 20, 'chip', '#6b5a48', 240, 0.8)
                this.glow(e.x, e.y, 30, 30, '#ffd166', 200, 1.0)
                this.flash = 0.7
                this.slowmo = Math.max(this.slowmo, 0.55)
                this.emit('eliteKill', e.x, e.y)
                break
            case 'briar':
                // The thicket comes apart: leaves, spores, a burst of petals.
                this.burst(e.x, e.y, 30, 30, 'leaf', '#7fbf4a', 260, 1.3)
                this.burst(e.x, e.y, 24, 20, 'spore', '#d9a6ff', 120, 1.6)
                this.burst(e.x, e.y, 18, 18, 'petal', '#ff6b8a', 200, 1.1)
                for (let i = 0; i < 10; i++) {
                    const ang = i / 10 * Math.PI * 2
                    this.spikes.push({ x: e.x + Math.cos(ang) * 44, y: e.y + Math.sin(ang) * 44, life: 0.6, maxLife: 0.6, angle: ang, size: 24 })
                }
                this.rings.push({ x: e.x, y: e.y, r0: 12, r1: 200, life: 0.5, maxLife: 0.5, color: '#8fd15a', width: 10 })
                this.glow(e.x, e.y, 26, 26, '#9be07a', 200, 1.0)
                this.flash = 0.6
                this.slowmo = Math.max(this.slowmo, 0.55)
                this.emit('eliteKill', e.x, e.y, 1, 'briar')
                break
            case 'knight':
                // Empty armour: the plates clatter and the light goes out.
                this.burst(e.x, e.y, 26, 24, 'chip', '#9aa3b8', 280, 1.1)
                this.burst(e.x, e.y, 30, 14, 'smoke', '#241f36', 120, 1.2)
                this.burst(e.x, e.y, 22, 12, 'spark', '#cfe2ff', 240, 0.5)
                this.rings.push({ x: e.x, y: e.y, r0: 8, r1: 170, life: 0.45, maxLife: 0.45, color: '#bcd3ff', width: 8 })
                this.glow(e.x, e.y, 26, 26, '#9fb4ff', 180, 1.0)
                this.flash = 0.6
                this.slowmo = Math.max(this.slowmo, 0.55)
                this.emit('eliteKill', e.x, e.y, 1, 'knight')
                break
        }
        if (e.marked > 0) {
            for (let i = 0; i < 3; i++) {
                const a = Math.random() * Math.PI * 2
                this.souls.push({ x: e.x, y: e.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, life: 3, targetId: -2, damage: this.weapon.baseDamage * this.damageMult * this.weapon.abilities[1].damage })
            }
        }
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
        const toll = this.stack('reapertoll')
        if (toll > 0) {
            this.rings.push({ x: e.x, y: e.y, r0: 10, r1: 320, life: 0.45, maxLife: 0.45, color: '#b48cff', width: 6 })
            for (const o of this.enemies) {
                if (!o.alive) continue
                o.slow = Math.max(o.slow, 0.6)
                o.slowT = Math.max(o.slowT, 1.2 + 0.4 * (toll - 1))
            }
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
        // Shield Wall: anything from the front is turned away, hard.
        if (p.fx.shieldWall > 0) {
            const diff = Math.abs(normalizeAngle(angleTo(p, from) - p.facing))
            if (diff < 1.25) {
                const hx = p.x + Math.cos(p.facing) * 18
                const hy = p.y + Math.sin(p.facing) * 18
                this.burst(hx, hy, 24, 12, 'spark', '#ffe9a8', 220, 0.3)
                this.impacts.push({ x: hx, y: hy, z: 26, life: 0.2, maxLife: 0.2, size: 28, color: '#bcd3ff', kind: 'burst', angle: p.facing })
                this.floaters.push({ x: p.x, y: p.y, z: 52, text: 'BLOCKED', life: 0.7, maxLife: 0.7, color: '#bcd3ff', size: 14, vx: 0 })
                this.hitstop = Math.max(this.hitstop, 0.05)
                this.shake = Math.max(this.shake, 4)
                this.emit('shieldBlock', p.x, p.y)
                if (attacker?.alive) {
                    this.setStagger(attacker, 0.9)
                    attacker.vx += Math.cos(p.facing) * 260
                    attacker.vy += Math.sin(p.facing) * 260
                    this.damageEnemy(attacker, this.weapon.baseDamage * this.damageMult * this.weapon.abilities[0].damage, { source: p, heavy: true, knockback: 0, stagger: 0.9, tag: 'special' })
                }
                return true
            }
        }
        if (this.companion && companionAbsorbHit(this, this.companion)) {
            p.invuln = HURT_GRACE * 0.6
            return true
        }
        const shell = 1 - (this.companion?.effects.damageReduction ?? 0)
        let dmg = Math.round(amount * (p.fx.ironSkin > 0 ? 0.4 : 1) * (p.fx.bloodrage > 0 ? 1.25 : 1) * shell)
        dmg = Math.max(1, dmg)
        if (p.fx.ironSkin > 0) {
            knockback = 0
            this.burst(p.x, p.y, 24, 6, 'spark', '#e6ebf2', 140, 0.3)
        }
        p.fx.smoke = 0
        p.hp -= dmg
        const adrenaline = this.stack('adrenaline')
        if (adrenaline > 0) {
            p.adrenalineT = 3
            p.dodgeCharges = Math.min(p.dodgeMax, p.dodgeCharges + 1)
        }
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
        if (p.fx.ironSkin <= 0) p.dodge = null
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
        this.navTimer -= dt
        if (this.navTimer <= 0) {
            this.navTimer = 0.1
            this.updateNav()
        }
        // Once the wave has finished spawning and only stragglers remain,
        // they come to you — no kiting the last thornspitter across the map.
        this.finalRush = this.spawnQueue.length === 0 && this.aliveEnemies <= 6
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
            e.stunLock = Math.max(0, e.stunLock - dt)
            e.parryT = Math.max(0, e.parryT - dt)
            e.moveT = Math.max(0, e.moveT - dt)
            // Out of combat the meter bleeds off so nothing stays primed.
            if (e.state !== 'stagger' && e.stunLock <= 0 && e.stun > 0) e.stun = Math.max(0, e.stun - dt * 6)
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
                        // Coming out of a real break, the meter goes cold.
                        if (e.stun >= e.stunMax) {
                            e.stun = 0
                            e.stunLock = e.def.elite ? STUN_LOCK_ELITE : STUN_LOCK_REGULAR
                        }
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
        if (p.fx.smoke > 0) {
            // Lost them in the smoke: mill about, never attack.
            return { x: Math.cos(e.wander + this.time * 0.8) * 0.4, y: Math.sin(e.wander + this.time * 0.8) * 0.4 }
        }
        const los = this.hasLineOfSight(e)
        let mx = Math.cos(toP)
        let my = Math.sin(toP)
        if (!los) {
            const nav = this.navDirection(e.x, e.y)
            if (nav) {
                mx = nav.x
                my = nav.y
            }
        }
        const ready = e.attackCd <= 0
        const dmg = e.damage

        const begin = (a: Partial<EnemyAttack> & { kind: EnemyAttack['kind'], windup: number }) => this.beginAttack(e, a, toP)

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
                if (d < 180 && !this.finalRush && los) {
                    mx = -mx
                    my = -my
                } else if (d < 340 && !this.finalRush && los) {
                    // Hold the line, sidestep a little.
                    const side = Math.sin(e.wander + this.time * 1.3)
                    mx = Math.cos(toP + Math.PI / 2) * side * 0.5
                    my = Math.sin(toP + Math.PI / 2) * side * 0.5
                }
                if (ready && los && d < 420 && d > 120) begin({ kind: 'shot', windup: 0.85, recover: 0.4, tracking: 0.7 })
                break
            }
            case 'charger':
                if (ready && los && d < 320 && d > 40) begin({ kind: 'charge', windup: 0.75, chargeDur: 0.62, chargeSpeed: 560, knockback: 320, recover: 1.0, tracking: 0.65 })
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
                } else if (ready && los && d < 360 && d >= 120) {
                    begin({ kind: 'charge', windup: 0.6, chargeDur: 0.55, chargeSpeed: 540, knockback: 340, recover: 0.8, tracking: 0.75 })
                }
                break
            case 'briar': {
                // She wants the middle distance: thorns and roots from range,
                // brood between them, and she backs off when you close.
                if (!this.finalRush && d < BRIAR_RANGE - 50) {
                    mx = -mx
                    my = -my
                } else if (d <= BRIAR_RANGE + 90 && !this.finalRush) {
                    const sway = Math.sin(e.wander + this.time * 0.9)
                    mx = mx * 0.2 + Math.cos(toP + Math.PI / 2) * sway * 0.8
                    my = my * 0.2 + Math.sin(toP + Math.PI / 2) * sway * 0.8
                }
                if (e.moveT <= 0 && this.broodAlive(e) < BRIAR_BROOD_CAP) {
                    e.moveT = 9
                    begin({ kind: 'brood', windup: 0.7, recover: 0.7, damage: 0, tracking: 0 })
                } else if (ready && d < 460) {
                    if (randomChance(0.4)) begin({ kind: 'snare', windup: 0.8, radius: 92, damage: dmg, knockback: 140, recover: 0.7, tracking: 0, tx: p.x, ty: p.y })
                    else begin({ kind: 'volley', windup: 0.9, damage: dmg * 0.55, recover: 0.6, tracking: 0.7 })
                }
                break
            }
            case 'knight':
                if (e.moveT <= 0 && d < 300) {
                    // Blade up: hit him now and he answers with the point.
                    e.moveT = 7
                    begin({ kind: 'parry', windup: 0.35, recover: 0.9, damage: 0, tracking: 0.9 })
                } else if (ready && los && d > 260) {
                    this.shadowStep(e)
                } else if (ready && d < 92 + p.r) {
                    const step = e.combo % 3
                    if (step === 2) begin({ kind: 'melee', windup: 0.34, reach: 112, halfAngle: 0.8, damage: dmg * 1.3, knockback: 340, recover: 0.7, tracking: 0.5, lunge: 64 })
                    else if (step === 1) begin({ kind: 'melee', windup: 0.24, reach: 88, halfAngle: 1.15, damage: dmg * 0.75, knockback: 180, recover: 0.32, tracking: 0.5, lunge: 14 })
                    else begin({ kind: 'melee', windup: 0.34, reach: 90, halfAngle: 0.85, damage: dmg * 0.8, knockback: 180, recover: 0.32, lunge: 24 })
                }
                break
        }

        // Slide along anything we're brushing against instead of grinding
        // into it; the nav field handles the routing.
        for (const o of this.world.obstacles) {
            const dx = o.x - e.x
            const dy = o.y - e.y
            const od = Math.hypot(dx, dy)
            if (od < o.r + e.r + 6 && od > 0) {
                const into = (dx * mx + dy * my) / od
                if (into > 0) {
                    mx -= dx / od * into
                    my -= dy / od * into
                }
            }
        }
        return { x: mx, y: my }
    }

    private beginAttack(e: Enemy, a: Partial<EnemyAttack> & { kind: EnemyAttack['kind'], windup: number }, dir: number) {
        e.attack = {
            kind: a.kind, windup: a.windup, dir, reach: a.reach ?? 50, halfAngle: a.halfAngle ?? 1,
            radius: a.radius ?? 0, damage: a.damage ?? e.damage, knockback: a.knockback ?? 160, recover: a.recover ?? 0.5,
            tracking: a.tracking ?? 0.6, chargeT: 0, chargeDur: a.chargeDur ?? 0.6, chargeSpeed: a.chargeSpeed ?? 540,
            hit: false, lunge: a.lunge ?? 0, tx: a.tx, ty: a.ty
        }
        e.state = 'windup'
        e.stateT = 0
        this.emit('telegraph', e.x, e.y, a.kind === 'slam' || a.kind === 'snare' ? 1 : 0.4, e.type)
    }

    private releaseAttack(e: Enemy) {
        const a = e.attack!
        const p = this.player
        switch (a.kind) {
            case 'melee': {
                e.x += Math.cos(a.dir) * a.lunge
                e.y += Math.sin(a.dir) * a.lunge
                this.trails.push({ x: e.x, y: e.y, angle0: a.dir - a.halfAngle, angle1: a.dir + a.halfAngle, reach: a.reach, life: 0.18, maxLife: 0.18, color: '#ff7b6b', kind: 'arc', width: 14, z: 12, style: 'enemy' })
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
                this.trails.push({ x: e.x, y: e.y, angle0: 0, angle1: Math.PI * 2, reach: a.radius, life: 0.28, maxLife: 0.28, color: '#ff7b6b', kind: 'ring', width: 22, z: 12, style: 'enemy' })
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
            case 'volley': {
                // A fan of five: the gaps are the dodge.
                const n = 5
                for (let i = 0; i < n; i++) {
                    const ang = a.dir + (i - (n - 1) / 2) * 0.22
                    this.projectiles.push({
                        id: this.nextId++, x: e.x + Math.cos(ang) * e.r, y: e.y + Math.sin(ang) * e.r,
                        vx: Math.cos(ang) * 380, vy: Math.sin(ang) * 380, life: 2.4, damage: a.damage, r: 7,
                        owner: 'enemy', pierce: 0, hitIds: new Set(), kind: 'thorn', angle: ang
                    })
                }
                this.burst(e.x, e.y, e.def.height * 0.5, 10, 'leaf', '#7fbf4a', 160, 0.6, a.dir)
                this.emit('special', e.x, e.y, 0.6, 'briar')
                e.state = 'recover'
                e.stateT = 0
                break
            }
            case 'snare': {
                const tx = a.tx ?? e.x
                const ty = a.ty ?? e.y
                this.rings.push({ x: tx, y: ty, r0: 10, r1: a.radius, life: 0.4, maxLife: 0.4, color: '#7fbf4a', width: 10 })
                this.decals.push({ x: tx, y: ty, r: a.radius * 0.6, color: 'rgba(40,60,25,0.5)', kind: 'crack' })
                for (let i = 0; i < 9; i++) {
                    const ang = i / 9 * Math.PI * 2
                    this.spikes.push({ x: tx + Math.cos(ang) * a.radius * 0.55, y: ty + Math.sin(ang) * a.radius * 0.55, life: 0.55, maxLife: 0.55, angle: ang, size: 22 + Math.random() * 10 })
                }
                this.burst(tx, ty, 0, 18, 'leaf', '#5f9b3a', 200, 0.8)
                this.burst(tx, ty, 0, 10, 'dust', '#6b5a3a', 140, 0.6)
                this.shake = Math.max(this.shake, 9)
                this.emit('special', tx, ty, 1, 'briar')
                if (inCircle({ x: tx, y: ty }, a.radius, p, p.r) && this.hurtPlayer(a.damage, { x: tx, y: ty }, a.knockback, e)) {
                    p.fx.snared = 1.2
                    this.floaters.push({ x: p.x, y: p.y, z: 56, text: 'SNARED', life: 0.9, maxLife: 0.9, color: '#8fd15a', size: 14, vx: 0 })
                }
                e.state = 'recover'
                e.stateT = 0
                break
            }
            case 'brood': {
                const n = randomChance(0.5) ? 4 : 3
                for (let i = 0; i < n; i++) {
                    if (this.broodAlive(e) >= BRIAR_BROOD_CAP) break
                    const ang = randomFloat() * Math.PI * 2
                    const child = this.spawnEnemy('swarmer', 'north')
                    child.x = clamp(e.x + Math.cos(ang) * (e.r + 26), 16, ARENA_W - 16)
                    child.y = clamp(e.y + Math.sin(ang) * (e.r + 26), 16, ARENA_H - 16)
                    child.entered = true
                    child.facing = angleTo(child, p)
                    // Summoned, not scheduled: no share of the wave's pool.
                    child.coin = 0
                    e.brood.push(child.id)
                    this.burst(child.x, child.y, 0, 10, 'leaf', '#8fd15a', 160, 0.7)
                }
                this.rings.push({ x: e.x, y: e.y, r0: 8, r1: 120, life: 0.45, maxLife: 0.45, color: '#8fd15a', width: 8 })
                this.floaters.push({ x: e.x, y: e.y, z: e.def.height + 14, text: 'BROOD', life: 0.9, maxLife: 0.9, color: '#8fd15a', size: 15, vx: 0 })
                this.emit('special', e.x, e.y, 0.8, 'briar')
                e.state = 'recover'
                e.stateT = 0
                break
            }
            case 'parry': {
                e.parryT = 0.9
                this.impacts.push({ x: e.x, y: e.y, z: e.def.height * 0.6, life: 0.3, maxLife: 0.3, size: 34, color: '#dbe9ff', kind: 'ring', angle: 0 })
                this.burst(e.x, e.y, e.def.height * 0.6, 8, 'spark', '#cfe2ff', 90, 0.5)
                this.emit('telegraph', e.x, e.y, 0.9, 'knight')
                e.state = 'recover'
                e.stateT = 0
                break
            }
        }
        if (e.type === 'knight') {
            if (a.kind === 'melee') {
                e.combo += 1
                // Hits one and two chain straight into the next.
                e.attackCd = e.combo % 3 === 0 ? 1.0 + Math.random() * 0.5 : 0.1
            } else {
                e.attackCd = 0.6
            }
        } else if (e.type === 'briar') {
            e.attackCd = a.kind === 'brood' ? 0.9 : 1.5 + Math.random() * 0.9
        } else {
            e.attackCd = e.type === 'swarmer' ? 0.7 + Math.random() * 0.5 : e.type === 'ranged' ? 2.2 : e.type === 'charger' ? 1.4 : 0.9 + Math.random() * 0.5
        }
    }

    /** Spriglings the Matriarch has called that are still standing. */
    private broodAlive(e: Enemy): number {
        let n = 0
        for (const o of this.enemies) {
            if (o.alive && e.brood.includes(o.id)) n += 1
        }
        return n
    }

    /** Hollow Knight: blink to the player's flank and open immediately. */
    private shadowStep(e: Enemy) {
        const p = this.player
        const side = randomChance(0.5) ? 1 : -1
        const ang = angleTo(p, e) + side * Math.PI * 0.55
        const tx = clamp(p.x + Math.cos(ang) * 74, e.r, ARENA_W - e.r)
        const ty = clamp(p.y + Math.sin(ang) * 74, e.r, ARENA_H - e.r)
        const sx = e.x
        const sy = e.y
        for (let i = 1; i <= 5; i++) {
            const k = i / 6
            const ix = sx + (tx - sx) * k
            const iy = sy + (ty - sy) * k
            this.burst(ix, iy, e.def.height * 0.4, 3, 'smoke', '#2f2a44', 30, 0.45)
        }
        this.burst(sx, sy, e.def.height * 0.4, 10, 'smoke', '#241f36', 90, 0.5)
        this.impacts.push({ x: sx, y: sy, z: e.def.height * 0.5, life: 0.24, maxLife: 0.24, size: 40, color: '#8f9bd8', kind: 'ring', angle: 0 })
        e.x = tx
        e.y = ty
        e.vx = 0
        e.vy = 0
        e.entered = true
        e.combo = 0
        this.burst(tx, ty, e.def.height * 0.4, 12, 'smoke', '#241f36', 110, 0.5)
        this.impacts.push({ x: tx, y: ty, z: e.def.height * 0.5, life: 0.24, maxLife: 0.24, size: 40, color: '#8f9bd8', kind: 'ring', angle: 0 })
        this.emit('special', tx, ty, 0.8, 'knight')
        this.beginAttack(e, { kind: 'melee', windup: 0.34, reach: 90, halfAngle: 0.85, damage: e.damage * 0.8, knockback: 180, recover: 0.32, lunge: 24 }, angleTo(e, p))
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
                if (Math.hypot(pr.x - p.x, pr.y - p.y) <= pr.r + p.r + (p.fx.shieldWall > 0 ? 14 : 0)) {
                    if (p.fx.shieldWall > 0 && Math.abs(normalizeAngle(angleTo(p, pr) - p.facing)) < 1.25) {
                        // Batted straight back, and now it's ours.
                        pr.owner = 'player'
                        pr.vx = -pr.vx * 1.4
                        pr.vy = -pr.vy * 1.4
                        pr.angle += Math.PI
                        pr.damage = this.weapon.baseDamage * this.damageMult
                        pr.life = 1.5
                        this.burst(pr.x, pr.y, 20, 6, 'spark', '#ffe9a8', 160, 0.3)
                        this.emit('shieldBlock', p.x, p.y)
                    } else if (p.invuln <= 0) {
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

    // ------------------------------------------------------------------ coins

    /** Scatter an enemy's bounty as a handful of coins. */
    private dropCoins(e: Enemy, dir: number) {
        if (e.coin <= 0) return
        const count = e.def.elite ? 14 : e.coin >= 60 ? 4 : e.coin >= 25 ? 3 : e.coin >= 10 ? 2 : 1
        let left = e.coin
        for (let i = 0; i < count; i++) {
            const value = i === count - 1 ? left : Math.round(e.coin / count)
            left -= value
            if (value <= 0) continue
            const a = dir + (Math.random() - 0.5) * 2.4
            const sp = 60 + Math.random() * 120
            this.coinDrops.push({
                x: e.x, y: e.y, z: e.def.height * 0.4,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 120 + Math.random() * 140,
                value, life: 24 + Math.random() * 2, seed: Math.random(),
                size: e.def.elite ? 6 : value >= 30 ? 5.5 : 4.5, magnet: false
            })
        }
        if (this.coinDrops.length > 260) this.coinDrops.splice(0, this.coinDrops.length - 260)
    }

    private updateCoins(dt: number) {
        const p = this.player
        const pull = 90 * (this.companion?.effects.pickupMult ?? 1) + 20 * this.stack('swift')
        if (this.coinStreakT > 0) {
            this.coinStreakT -= dt
            if (this.coinStreakT <= 0) this.coinStreak = 0
        }
        for (let i = this.coinDrops.length - 1; i >= 0; i--) {
            const c = this.coinDrops[i]!
            c.life -= dt
            if (c.life <= 0) {
                this.coinDrops.splice(i, 1)
                continue
            }
            const dx = p.x - c.x
            const dy = p.y - c.y
            const d = Math.hypot(dx, dy)
            if (!c.magnet && c.z < 4 && d < pull) c.magnet = true
            if (c.magnet) {
                const sp = Math.min(900, 260 + (pull - Math.min(pull, d)) * 9)
                c.vx += (dx / (d || 1) * sp - c.vx) * Math.min(1, dt * 12)
                c.vy += (dy / (d || 1) * sp - c.vy) * Math.min(1, dt * 12)
                c.z = Math.max(0, c.z - c.z * dt * 6)
                c.x += c.vx * dt
                c.y += c.vy * dt
                if (d < p.r + 10) {
                    this.coinDrops.splice(i, 1)
                    this.collectCoin(c)
                }
                continue
            }
            c.vz -= 520 * dt
            c.z += c.vz * dt
            if (c.z <= 0) {
                c.z = 0
                c.vz = c.vz < -60 ? -c.vz * 0.45 : 0
                c.vx *= 0.6
                c.vy *= 0.6
            }
            c.x = clamp(c.x + c.vx * dt, 12, ARENA_W - 12)
            c.y = clamp(c.y + c.vy * dt, 12, ARENA_H - 12)
            for (const o of this.world.obstacles) {
                const ox = c.x - o.x
                const oy = c.y - o.y
                const od = Math.hypot(ox, oy)
                if (od > 0 && od < o.r + 6) {
                    c.x = o.x + ox / od * (o.r + 6)
                    c.y = o.y + oy / od * (o.r + 6)
                }
            }
        }
    }

    private collectCoin(c: Coin) {
        this.coins += c.value
        this.coinStreak += 1
        this.coinStreakT = 0.35
        const p = this.player
        this.glow(p.x, p.y, 16, 2, '#ffe38a', 40, 0.4)
        // One floater per short burst so a pile doesn't wallpaper the screen.
        const recent = this.floaters.find(f => f.text.startsWith('+') && f.text.endsWith('¢') && f.maxLife - f.life < 0.3)
        if (recent) {
            recent.text = `+${Number(recent.text.slice(1, -1)) + c.value}¢`
            recent.life = recent.maxLife
        } else {
            this.floaters.push({ x: p.x + 14, y: p.y, z: 44, text: `+${c.value}¢`, life: 0.7, maxLife: 0.7, color: '#ffd166', size: 12, vx: 8 })
        }
        this.emit('coin', p.x, p.y, Math.min(1, this.coinStreak / 12))
    }

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
            } else if (pt.kind === 'glow' || pt.kind === 'spore') {
                pt.vx *= Math.max(0, 1 - 2.5 * dt)
                pt.vy *= Math.max(0, 1 - 2.5 * dt)
                pt.vx += Math.sin(this.ambientT * 2 + pt.x * 0.05) * 12 * dt
            } else if (pt.kind === 'bone') {
                pt.vx *= Math.max(0, 1 - 2 * dt)
                pt.vy *= Math.max(0, 1 - 2 * dt)
                if (pt.z <= 0 && pt.vz < 0) {
                    pt.z = 0
                    pt.vz = -pt.vz * 0.35
                }
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
        // Fireflies gather as the run heads into dusk.
        const dusk = clamp((this.wave - 8) / 22, 0, 1)
        if (this.phase !== 'menu' && Math.random() < dt * (2 + dusk * 14)) {
            this.particles.push({
                x: Math.random() * (ARENA_W + 300) - 150, y: Math.random() * (ARENA_H + 300) - 150, z: 20 + Math.random() * 50,
                vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, vz: (Math.random() - 0.5) * 10, life: 4 + Math.random() * 3, maxLife: 7, size: 3 + Math.random() * 3,
                color: Math.random() < 0.7 ? '#d9ff7a' : '#ffe27a', kind: 'glow', gravity: 0, decal: false
            })
        }
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
            const size = kind === 'spark' ? 2 + Math.random() * 2 : kind === 'blood' ? 2 + Math.random() * 3.5 : kind === 'dust' || kind === 'smoke' ? 6 + Math.random() * 8 : kind === 'spore' ? 4 + Math.random() * 5 : kind === 'bone' ? 3 + Math.random() * 4 : 3 + Math.random() * 3
            this.particles.push({
                x, y, z: z + Math.random() * 6, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                vz: kind === 'blood' || kind === 'chip' ? 60 + Math.random() * 160 : kind === 'ember' ? 40 + Math.random() * 60 : 10 + Math.random() * 30,
                life: life * (0.6 + Math.random() * 0.6), maxLife: life, size, color, kind,
                gravity: kind === 'blood' || kind === 'chip' || kind === 'bone' ? 520 : kind === 'ember' ? -40 : kind === 'frost' ? 80 : kind === 'spore' ? -15 : 0,
                decal: kind === 'blood' && Math.random() < 0.5
            })
        }
        if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES)
    }

    /** Meteors, singularities and orbiting blades. */
    private updateHazards(dt: number) {
        const p = this.player
        const meteor = this.stack('meteor')
        if (meteor > 0 && this.phase === 'wave') {
            this.meteorTimer -= dt
            if (this.meteorTimer <= 0) {
                this.meteorTimer = 6 / meteor
                const targets = this.enemies.filter(e => e.alive && e.entered)
                if (targets.length) {
                    const t = targets[Math.floor(randomFloat() * targets.length)]!
                    this.meteors.push({ x: t.x, y: t.y, t: 0, delay: 0.9, radius: 110, damage: this.weapon.baseDamage * this.damageMult * 3 })
                }
            }
        }
        for (let i = this.meteors.length - 1; i >= 0; i--) {
            const m = this.meteors[i]!
            m.t += dt
            if (m.t >= m.delay) {
                this.meteors.splice(i, 1)
                this.rings.push({ x: m.x, y: m.y, r0: 10, r1: m.radius + 20, life: 0.4, maxLife: 0.4, color: '#ffb347', width: 12 })
                this.decals.push({ x: m.x, y: m.y, r: m.radius * 0.5, color: 'rgba(30,20,15,0.5)', kind: 'scorch' })
                this.burst(m.x, m.y, 10, 30, 'ember', '#ff8c2a', 260, 0.8)
                this.burst(m.x, m.y, 0, 16, 'chip', '#4a3a2a', 240, 0.6)
                this.shake = Math.max(this.shake, 14)
                this.hitstop = Math.max(this.hitstop, 0.06)
                this.emit('explode', m.x, m.y)
                for (const e of this.enemies) {
                    if (!e.alive) continue
                    if (inCircle(m, m.radius, e, e.r)) this.damageEnemy(e, m.damage, { source: m, heavy: true, knockback: 320, stagger: 0.8, tag: 'explode', bypassShield: true })
                }
            }
        }
        for (let i = this.singularities.length - 1; i >= 0; i--) {
            const sg = this.singularities[i]!
            sg.life -= dt
            sg.spin += dt * 6
            sg.tick -= dt
            for (const e of this.enemies) {
                if (!e.alive || e.def.elite) continue
                const d = Math.hypot(e.x - sg.x, e.y - sg.y)
                if (d < sg.radius * 2.4 && d > 4) {
                    const pull = 520 * (1 - d / (sg.radius * 2.4)) + 120
                    e.vx += (sg.x - e.x) / d * pull * dt * 5
                    e.vy += (sg.y - e.y) / d * pull * dt * 5
                }
            }
            if (sg.tick <= 0) {
                sg.tick = 0.25
                for (const e of this.enemies) {
                    if (!e.alive) continue
                    if (inCircle(sg, sg.radius, e, e.r)) this.damageEnemy(e, sg.damage, { source: sg, knockback: 0, stagger: 0.2, tag: 'shock', bypassShield: true, color: '#c9a3ff' })
                }
            }
            if (Math.random() < 0.6) {
                const a = Math.random() * Math.PI * 2
                const d = sg.radius * (1.2 + Math.random())
                this.particles.push({ x: sg.x + Math.cos(a) * d, y: sg.y + Math.sin(a) * d, z: 6, vx: -Math.cos(a) * 200, vy: -Math.sin(a) * 200, vz: 20, life: 0.5, maxLife: 0.5, size: 3, color: '#c9a3ff', kind: 'spark', gravity: 0, decal: false })
            }
            if (sg.life <= 0) {
                this.singularities.splice(i, 1)
                this.rings.push({ x: sg.x, y: sg.y, r0: 6, r1: sg.radius * 1.6, life: 0.3, maxLife: 0.3, color: '#c9a3ff', width: 8 })
            }
        }
        for (let i = this.orbitals.length - 1; i >= 0; i--) {
            const o = this.orbitals[i]!
            o.life -= dt
            o.angle += dt * 5
            for (const [id, cd] of o.cooldowns) {
                if (cd - dt <= 0) o.cooldowns.delete(id)
                else o.cooldowns.set(id, cd - dt)
            }
            for (let b = 0; b < 3; b++) {
                const a = o.angle + b * Math.PI * 2 / 3
                const bx = p.x + Math.cos(a) * 64
                const by = p.y + Math.sin(a) * 64
                for (const e of this.enemies) {
                    if (!e.alive || o.cooldowns.has(e.id)) continue
                    if (Math.hypot(e.x - bx, e.y - by) <= e.r + 14) {
                        o.cooldowns.set(e.id, 0.4)
                        this.damageEnemy(e, o.damage, { source: { x: bx, y: by }, knockback: 120, stagger: 0.2, tag: 'proj', color: '#bfe6ff' })
                    }
                }
            }
            if (o.life <= 0) this.orbitals.splice(i, 1)
        }
    }

    /** Per-weapon particle flourish on the swing itself. */
    private swingFlourish(dir: number, reach: number, finisher: boolean) {
        const p = this.player
        const tx = p.x + Math.cos(dir) * reach * 0.7
        const ty = p.y + Math.sin(dir) * reach * 0.7
        switch (p.weapon) {
            case 'greataxe':
                this.burst(tx, ty, 4, finisher ? 10 : 5, 'ember', '#ff9a3c', 140, 0.35, dir)
                if (finisher) this.burst(p.x, p.y, 0, 8, 'dust', '#bfae83', 120, 0.4)
                break
            case 'warhammer':
                this.burst(tx, ty, 6, finisher ? 10 : 5, 'spark', '#fff2c4', 200, 0.3, dir)
                if (finisher) this.burst(tx, ty, 0, 8, 'chip', '#6b5a48', 180, 0.5)
                break
            case 'scythe':
                for (let i = 0; i < (finisher ? 8 : 4); i++) {
                    const a = dir + (Math.random() - 0.5) * 2.4
                    this.particles.push({ x: p.x + Math.cos(a) * reach * (0.5 + Math.random() * 0.5), y: p.y + Math.sin(a) * reach * (0.5 + Math.random() * 0.5), z: 14, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, vz: 40, life: 0.6, maxLife: 0.6, size: 5 + Math.random() * 4, color: '#8fe3c8', kind: 'smoke', gravity: 0, decal: false })
                }
                break
            case 'spear':
                this.burst(p.x + Math.cos(dir) * reach, p.y + Math.sin(dir) * reach, 16, 3, 'spark', '#ffe9a8', 160, 0.2, dir)
                break
            case 'daggers':
                this.burst(tx, ty, 14, 2, 'spark', '#fff6d6', 120, 0.18, dir)
                break
            case 'sword':
                if (finisher) this.burst(tx, ty, 14, 6, 'spark', '#dbe4f3', 180, 0.3, dir)
                break
        }
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

