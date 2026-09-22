/**
 * SHAPEZZ playtest: the real engine, headless, at 60 fps, driven by a heuristic bot.
 *
 *   bun run balance:shapezz-playtest                        full matrix (tiers x weapons x difficulties)
 *   bun run balance:shapezz-playtest --tiers fresh --difficulties spark,surge --seeds 8
 *   bun run balance:shapezz-playtest --upgrades             per-upgrade value study (forced first two picks)
 *   bun run balance:shapezz-playtest --upgrades --config mid:blaster:overdrive --seeds 16
 *
 * Flags
 *   --tiers fresh,mid,max        investment tiers
 *   --weapons blaster,launcher,shotgun,arcCoil
 *   --difficulties spark,surge,overdrive,mayhem,annihilation
 *   --seeds N                    runs per cell (default 4; 12 for --upgrades)
 *   --cap-min M                  sim-time cap per run (default 20)
 *   --picks random|greedy        checkpoint pick strategy (default random)
 *   --force <upgradeId>          take this upgrade as the first --force-count picks (default 2)
 *   --upgrades                   run the upgrade value study instead of the matrix
 *   --config tier:weapon:difficulty[,…]   configs for --upgrades (default fresh:blaster:surge,mid:blaster:overdrive,max:blaster:mayhem)
 *   --jobs N                     parallel worker processes (default cores - 1)
 *   --json <file>                also write every run record as JSON
 *   --verbose                    one line per run
 *
 * The bot is roughly a decent human: it reads every hostile shot, beam and
 * telegraph, simulates its own jump arc for each move it could make over the
 * next ~0.65s, and takes the move with the least expected damage plus a few
 * positional preferences (off the walls, away from rammers, toward health when
 * hurt, toward coins when safe). It leads its shots by bullet travel time.
 * Runs are seeded (Math.random and crypto are both replaced per run), so a
 * seed replays the same run for the same flags.
 */

import { FLOOR_Y, GRAVITY, WIDTH, distanceToSegmentSquared, type Enemy } from '../app/utils/shapezz/world'
import {
    SHAPEZZ_BOMBER_BLAST_RADIUS, SHAPEZZ_BOSSES, SHAPEZZ_CHECKPOINT_MS, SHAPEZZ_ENEMIES, SHAPEZZ_DIFFICULTY_IDS, SHAPEZZ_MAX_KILL_HEAL_LEVEL,
    SHAPEZZ_MAX_PERMANENT_LEVEL, SHAPEZZ_RUN_UPGRADES, SHAPEZZ_RUN_UPGRADE_IDS, SHAPEZZ_WEAPON_TYPES,
    shapezzMaxPayoutForRun, shapezzPayoutForRun, shapezzPlayerStats, shapezzWeapon,
    type ShapezzDifficultyId, type ShapezzPermanentLevels, type ShapezzRunUpgradeId,
    type ShapezzWeaponRarity, type ShapezzWeaponType
} from '../shared/utils/gamelogic/shapezz'
import { ShapezzEngine, type ShapezzEngine as ShapezzEngineType } from '../app/utils/shapezz-engine'

// ─── Config ─────────────────────────────────────────────────────────────────

type TierId = 'fresh' | 'mid' | 'max'
const TIERS: Record<TierId, { label: string, levels: ShapezzPermanentLevels, rarity: ShapezzWeaponRarity }> = {
    fresh: { label: 'fresh', levels: { core: 0, overclock: 0, armor: 0, thrusters: 0, magnet: 0, killHeal: 0 }, rarity: 'common' },
    mid: { label: 'mid', levels: { core: 7, overclock: 7, armor: 7, thrusters: 6, magnet: 6, killHeal: 1 }, rarity: 'epic' },
    max: {
        label: 'maxed',
        levels: {
            core: SHAPEZZ_MAX_PERMANENT_LEVEL, overclock: SHAPEZZ_MAX_PERMANENT_LEVEL, armor: SHAPEZZ_MAX_PERMANENT_LEVEL,
            thrusters: SHAPEZZ_MAX_PERMANENT_LEVEL, magnet: SHAPEZZ_MAX_PERMANENT_LEVEL, killHeal: SHAPEZZ_MAX_KILL_HEAL_LEVEL
        },
        rarity: 'mythic'
    }
}

/** Greedy pick order: a fixed "what a good player grabs first" list. */
const GREEDY_ORDER: ShapezzRunUpgradeId[] = [
    'ceilingBattery', 'orbitals', 'twinFang', 'explosive', 'chainLightning', 'deathNova', 'overcharge',
    'giantRounds', 'splitstorm', 'prismLance', 'droneSwarm', 'railPierce', 'hyperVelocity', 'frenzy',
    'executioner', 'ricochet', 'blackHole', 'aegisPlating', 'vampireBurst', 'afterimage', 'killShockwave',
    'overkillDividend', 'bulletTime'
]

/** Which damage source an upgrade shows up as. */
const UPGRADE_SOURCE: Partial<Record<ShapezzRunUpgradeId, string>> = {
    splitstorm: 'splitstorm', explosive: 'explosive', chainLightning: 'chain', orbitals: 'orbital', droneSwarm: 'drone',
    blackHole: 'singularity', afterimage: 'turret', deathNova: 'nova', killShockwave: 'killquake', executioner: 'execute',
    overkillDividend: 'overkill', ceilingBattery: 'ceiling', prismLance: 'lance'
}

interface Job {
    tier: TierId
    weapon: ShapezzWeaponType
    difficulty: ShapezzDifficultyId
    seed: number
    picks: 'random' | 'greedy'
    force: ShapezzRunUpgradeId | null
    forceCount: number
    capMs: number
    group: string
}

interface BossFight {
    kind: string
    checkpoint: number
    startMs: number
    durationMs: number | null
    damageTaken: number
    maxHp: number
    died: boolean
}

interface RunRecord {
    job: Job
    elapsedMs: number
    capped: boolean
    checkpoints: number
    coins: number
    kills: number
    /** Payout offered at each checkpoint reached, in order. */
    offers: number[]
    deathCause: string | null
    damageBySource: Record<string, number>
    damageTakenByCause: Record<string, number>
    bosses: BossFight[]
    upgrades: Record<string, number>
    maxHp: number
}

function parseArgs(argv: string[]) {
    const flags = new Map<string, string>()
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!
        if (!arg.startsWith('--')) continue
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
            flags.set(arg.slice(2), next)
            i++
        } else flags.set(arg.slice(2), 'true')
    }
    return flags
}

const flags = parseArgs(process.argv.slice(2))
const list = <T extends string>(key: string, all: readonly T[], fallback: readonly T[] = all) => {
    const raw = flags.get(key)
    if (!raw) return [...fallback]
    const picked = raw.split(',').map(value => value.trim()).filter(Boolean) as T[]
    for (const value of picked) if (!all.includes(value)) throw new Error(`Unknown ${key} value: ${value}`)
    return picked
}

function hash(text: string) {
    let h = 2166136261
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

function buildJobs(): Job[] {
    const capMs = Number(flags.get('cap-min') ?? 20) * 60_000
    const picks = (flags.get('picks') ?? 'random') as Job['picks']
    const forceCount = Number(flags.get('force-count') ?? 2)
    const jobs: Job[] = []
    if (flags.has('upgrades')) {
        const seeds = Number(flags.get('seeds') ?? 12)
        const configs = (flags.get('config') ?? 'fresh:blaster:surge,mid:blaster:overdrive,max:blaster:mayhem').split(',')
        for (const config of configs) {
            const [tier, weapon, difficulty] = config.split(':') as [TierId, ShapezzWeaponType, ShapezzDifficultyId]
            const variants: (ShapezzRunUpgradeId | null)[] = [null, ...list('only', SHAPEZZ_RUN_UPGRADE_IDS)]
            for (const force of variants) {
                for (let s = 0; s < seeds; s++) {
                    jobs.push({ tier, weapon, difficulty, seed: hash(`${config}:${s}`), picks, force, forceCount, capMs, group: config })
                }
            }
        }
        return jobs
    }
    const seeds = Number(flags.get('seeds') ?? 4)
    const force = (flags.get('force') ?? null) as ShapezzRunUpgradeId | null
    for (const tier of list<TierId>('tiers', ['fresh', 'mid', 'max'])) {
        for (const weapon of list('weapons', SHAPEZZ_WEAPON_TYPES)) {
            for (const difficulty of list('difficulties', SHAPEZZ_DIFFICULTY_IDS)) {
                for (let s = 0; s < seeds; s++) {
                    jobs.push({ tier, weapon, difficulty, seed: hash(`${tier}:${weapon}:${difficulty}:${s}`), picks, force, forceCount, capMs, group: 'matrix' })
                }
            }
        }
    }
    return jobs
}

// ─── Seeded randomness ──────────────────────────────────────────────────────

function installSeed(seed: number) {
    let a = seed >>> 0 || 1
    let b = 0x9E3779B9
    let c = 0x243F6A88
    let d = 0xB7E15162
    const next = () => {
        // sfc32
        const t = (((a + b) >>> 0) + d) >>> 0
        d = (d + 1) >>> 0
        a = b ^ (b >>> 9)
        b = (c + (c << 3)) >>> 0
        c = ((c << 21) | (c >>> 11)) >>> 0
        c = (c + t) >>> 0
        return t
    }
    for (let i = 0; i < 12; i++) next()
    Math.random = () => next() / 4294967296
    const values = crypto as unknown as { getRandomValues: <T extends ArrayBufferView>(array: T) => T }
    values.getRandomValues = <T extends ArrayBufferView>(array: T) => {
        const view = new Uint32Array(array.buffer, array.byteOffset, Math.floor(array.byteLength / 4))
        for (let i = 0; i < view.length; i++) view[i] = next()
        return array
    }
}

// ─── Bot ────────────────────────────────────────────────────────────────────

const PLAN_DT = 1 / 30
const PLAN_STEPS = 20
const PLAYER_BULLET_REACH = 36 * 0.45
const PLAYER_CONTACT_REACH = 36 * 0.48
const RAMMERS = new Set(['melee', 'dasher', 'tank', 'splitter', 'shard', 'bomber'])

interface Threat { x: number, y: number, vx: number, vy: number, r: number, damage: number, from: number, diesAtFloor: boolean }
interface Chaser { x: number, y: number, vx: number, vy: number, r: number, damage: number, speed: number, homing: boolean }

interface PlanPoint { x: number, y: number }

/** The cube's own path for a move (switching to `then` halfway), replaying the engine's movement and platform rules. */
function simulatePlayer(engine: ShapezzEngineType, move: number, action: 'none' | 'jump' | 'drop', then = move): PlanPoint[] {
    const p = engine.player
    const stats = engine.stats
    let { x, y, vx, vy } = p
    let onGround = p.onGround
    let dropTimer = 0
    if (action === 'jump' && onGround) {
        vy = -stats.jumpSpeed
        onGround = false
    }
    if (action === 'drop' && onGround) {
        dropTimer = 0.2
        vy = Math.max(vy, 120)
        y += 5
        onGround = false
    }
    const points: PlanPoint[] = []
    const half = p.size / 2
    for (let i = 0; i < PLAN_STEPS; i++) {
        const dt = PLAN_DT
        dropTimer -= dt
        const target = (i < PLAN_STEPS / 2 ? move : then) * stats.moveSpeed
        vx += (target - vx) * Math.min(1, dt * (onGround ? 16 : 8))
        vy += GRAVITY * dt
        const previousBottom = y + half
        x = Math.max(half, Math.min(WIDTH - half, x + vx * dt))
        y += vy * dt
        onGround = false
        const bottom = y + half
        for (const platform of engine.platforms) {
            if (dropTimer > 0 && platform.y < FLOOR_Y) continue
            const withinX = x + p.size * 0.35 > platform.x && x - p.size * 0.35 < platform.x + platform.width
            if (withinX && vy >= 0 && previousBottom <= platform.y + 4 && bottom >= platform.y) {
                y = platform.y - half
                vy = 0
                onGround = true
                break
            }
        }
        points.push({ x, y })
    }
    return points
}

function onElevatedPlatform(engine: ShapezzEngineType) {
    const p = engine.player
    if (!p.onGround) return false
    const feet = p.y + p.size / 2
    return engine.platforms.some(platform => platform.y < FLOOR_Y && Math.abs(feet - platform.y) <= 4
        && p.x + p.size * 0.35 > platform.x && p.x - p.size * 0.35 < platform.x + platform.width)
}

class Bot {
    private move: -1 | 0 | 1 = 0
    private action: 'none' | 'jump' | 'drop' = 'none'
    private frame = 0
    private targetId = -1

    constructor(private engine: ShapezzEngineType) {}

    tick() {
        const engine = this.engine
        if (flags.get('bot') === 'idle') this.move = 0
        else if (this.frame++ % 2 === 0) this.plan()
        else if (this.action !== 'drop') this.action = 'none'
        const aim = this.aim()
        engine.setAutopilotInput({
            move: this.move,
            jump: this.action === 'jump',
            drop: this.action === 'drop',
            aimX: aim.x,
            aimY: aim.y,
            fire: aim.fire
        })
    }

    describe() {
        return `${this.move}/${this.action} cost ${this.lastCost.toFixed(1)}`
    }

    private lastCost = 0

    private threats() {
        const engine = this.engine
        const p = engine.player
        const horizon = PLAN_DT * PLAN_STEPS
        const bullets: Threat[] = []
        for (const bullet of engine.enemyBullets) {
            const speed = Math.hypot(bullet.vx, bullet.vy)
            const d = Math.hypot(bullet.x - p.x, bullet.y - p.y)
            if (bullet.splitIn > 0 && bullet.splitIn < horizon) {
                const bx = bullet.x + bullet.vx * bullet.splitIn
                const by = bullet.y + bullet.vy * bullet.splitIn
                const spin = bullet.spin + bullet.splitIn * 6
                for (let s = 0; s < bullet.splitCount; s++) {
                    const angle = s / bullet.splitCount * Math.PI * 2 + spin
                    bullets.push({ x: bx, y: by, vx: Math.cos(angle) * 230, vy: Math.sin(angle) * 230, r: 6, damage: bullet.damage * 0.6, from: bullet.splitIn, diesAtFloor: true })
                }
            }
            if (d - speed * horizon > 80) continue
            bullets.push({ x: bullet.x, y: bullet.y, vx: bullet.vx, vy: bullet.vy, r: bullet.radius, damage: bullet.damage, from: 0, diesAtFloor: bullet.shape !== 'wave' })
        }
        const boss = engine.enemies.find(enemy => enemy.boss)
        for (const warning of engine.warnings) {
            if (warning.kind === 'column' && warning.life < horizon) {
                bullets.push({ x: warning.x, y: -10 - 560 * warning.life, vx: 0, vy: 560, r: 9, damage: (boss?.damage ?? 30) * 0.8, from: warning.life, diesAtFloor: true })
            }
        }
        const chasers: Chaser[] = []
        for (const enemy of engine.enemies) {
            if (enemy.hp <= 0) continue
            const d = Math.hypot(enemy.x - p.x, enemy.y - p.y)
            if (d > 700) continue
            const homing = RAMMERS.has(enemy.type) && !(enemy.type === 'bomber' && enemy.state === 1)
            const speed = enemy.type === 'dasher' ? enemy.speed * 1.6 : enemy.speed
            chasers.push({ x: enemy.x, y: enemy.y, vx: enemy.vx, vy: enemy.vy, r: enemy.radius, damage: enemy.damage * (enemy.bossKind === 'polygon' && enemy.state === 10 ? 1.1 : 0.62), speed, homing })
        }
        return { bullets, chasers }
    }

    private cost(points: PlanPoint[], threats: ReturnType<Bot['threats']>, move: number) {
        const engine = this.engine
        const p = engine.player
        const maxHp = engine.stats.maxHp
        let danger = 0
        // Hostile shots, predicted in a straight line (splits and rain columns included).
        for (const bullet of threats.bullets) {
            const reach = bullet.r + PLAYER_BULLET_REACH + 5
            const reach2 = reach * reach
            for (let i = 0; i < points.length; i++) {
                const t = (i + 1) * PLAN_DT
                if (t < bullet.from) continue
                const bt = t - bullet.from
                const bx = bullet.x + bullet.vx * bt
                const by = bullet.y + bullet.vy * bt
                if (bullet.diesAtFloor && by > FLOOR_Y && bullet.vy > 0) break
                const dx = bx - points[i]!.x
                const dy = by - points[i]!.y
                if (dx * dx + dy * dy < reach2) {
                    danger += bullet.damage * (1 - i / points.length * 0.35)
                    break
                }
            }
        }
        // Contact: rammers home on where the cube will be.
        for (const enemy of threats.chasers) {
            const reach = enemy.r + PLAYER_CONTACT_REACH + 6
            let ex = enemy.x
            let ey = enemy.y
            let evx = enemy.vx
            let evy = enemy.vy
            for (let i = 0; i < points.length; i++) {
                const point = points[i]!
                if (enemy.homing) {
                    const dx = point.x - ex
                    const dy = point.y - ey
                    const inv = 1 / (Math.hypot(dx, dy) || 1)
                    evx += (dx * inv * enemy.speed - evx) * Math.min(1, PLAN_DT * 4)
                    evy += (dy * inv * enemy.speed - evy) * Math.min(1, PLAN_DT * 4)
                }
                ex += evx * PLAN_DT
                ey += evy * PLAN_DT
                const dx = ex - point.x
                const dy = ey - point.y
                if (dx * dx + dy * dy < reach * reach) {
                    danger += enemy.damage * (1 - i / points.length * 0.35)
                    break
                }
            }
            // Keep some air between the cube and anything that rams.
            if (enemy.homing) {
                const end = points[points.length - 1]!
                const d = Math.hypot(end.x - ex, end.y - ey) - enemy.r
                if (d < 140) danger += enemy.damage * 0.25 * ((140 - d) / 140) ** 2
            }
        }
        // Armed bombers: out of the blast before the fuse runs out.
        for (const enemy of engine.enemies) {
            if (enemy.type !== 'bomber' || enemy.hp <= 0) continue
            const radius = SHAPEZZ_BOMBER_BLAST_RADIUS * (enemy.elite ? 1.3 : 1) + 36 * 0.4 + 12
            if (enemy.state === 1) {
                const index = Math.min(points.length - 1, Math.max(0, Math.round(enemy.stateTimer / PLAN_DT) - 1))
                const point = points[index]!
                if (Math.hypot(point.x - enemy.x, point.y - enemy.y) < radius) danger += enemy.damage
            } else {
                const end = points[points.length - 1]!
                const d = Math.hypot(end.x - enemy.x, end.y - enemy.y)
                if (d < 190) danger += enemy.damage * 0.3 * (190 - d) / 190
            }
        }
        // Boss beams: telegraphed while warming up, then they burn and sweep.
        for (const laser of engine.lasers) {
            const reach = laser.width / 2 + 36 * 0.38 + 10
            for (let i = 0; i < points.length; i++) {
                const t = (i + 1) * PLAN_DT
                if (t < laser.warmup - 0.05 || t > laser.warmup + laser.life) continue
                const angle = laser.angle + laser.sweep * Math.max(0, t - laser.warmup)
                const endX = laser.x + Math.cos(angle) * laser.length
                const endY = laser.y + Math.sin(angle) * laser.length
                if (distanceToSegmentSquared(points[i]!.x, points[i]!.y, laser.x, laser.y, endX, endY) < reach * reach) {
                    danger += laser.damage * 1.5
                    break
                }
            }
        }
        // Telegraphs: charge lines, slam circles, blink landing spots.
        for (const warning of engine.warnings) {
            if (warning.kind === 'line') {
                const reach = warning.radius + PLAYER_CONTACT_REACH + 20
                let hit = false
                for (let i = 0; i < points.length && !hit; i += 2) {
                    if (distanceToSegmentSquared(points[i]!.x, points[i]!.y, warning.x, warning.y, warning.x2, warning.y2) < reach * reach) hit = true
                }
                if (hit) danger += 30
            } else if (warning.kind === 'circle') {
                const floorSlam = warning.y >= FLOOR_Y - 1
                const end = points[points.length - 1]!
                const d = Math.hypot(end.x - warning.x, (floorSlam ? Math.min(end.y, FLOOR_Y) : end.y) - (floorSlam ? FLOOR_Y - 60 : warning.y))
                const radius = warning.radius + (floorSlam ? 60 : 140)
                if (d < radius) danger += 25 * (radius - d) / radius
            }
        }
        // Standing next to a boss is never where you want to be.
        for (const enemy of engine.enemies) {
            if (!enemy.boss) continue
            const end = points[points.length - 1]!
            const d = Math.hypot(end.x - enemy.x, end.y - enemy.y) - enemy.radius
            if (d < 180) danger += enemy.damage * 0.3 * (180 - d) / 180
        }

        // Positional preferences, in hit-point-ish units.
        const end = points[points.length - 1]!
        let preference = 0
        const wall = Math.min(end.x, WIDTH - end.x)
        if (wall < 130) preference += 6 * (130 - wall) / 130
        // Room to breathe: the fewer shapes around where the cube ends up, the more ways out.
        let crowd = 0
        for (const enemy of engine.enemies) {
            if (enemy.boss || enemy.hp <= 0) continue
            const d = Math.hypot(enemy.x - end.x, enemy.y - end.y)
            if (d < 320) crowd += (1 - d / 320) ** 2
        }
        preference += Math.min(12, crowd * 1.2)
        const hpShare = (p.hp + p.shield) / maxHp
        let bestHealth = Infinity
        let bestCoin = Infinity
        for (const pickup of engine.pickups) {
            const d = Math.hypot(pickup.x - end.x, pickup.y - end.y)
            if (pickup.kind === 'health') bestHealth = Math.min(bestHealth, d)
            else if (pickup.life > 1) bestCoin = Math.min(bestCoin, d)
        }
        if (bestHealth < Infinity && hpShare < 0.8) preference += (1 - hpShare) * 30 * Math.min(1, bestHealth / 700)
        if (bestCoin < Infinity) preference += 2.5 * Math.min(1, bestCoin / 600)
        // Arc Coil only reaches ~235px: it has to stay in touch with the crowd.
        const target = engine.enemies.find(enemy => enemy.id === this.targetId)
        if (engine.weapon.type === 'arcCoil' && target) {
            const d = Math.hypot(target.x - end.x, target.y - end.y) - target.radius
            if (d > engine.weapon.chainRange * 0.8) preference += 5 * Math.min(1, (d - engine.weapon.chainRange * 0.8) / 300)
        } else if (engine.weapon.type === 'shotgun' && target) {
            const d = Math.hypot(target.x - end.x, target.y - end.y)
            if (d > 420) preference += 2 * Math.min(1, (d - 420) / 300)
        }
        // Mild pull toward the middle third, and a small cost for dithering.
        preference += Math.abs(end.x - WIDTH / 2) / WIDTH
        if (move !== this.move) preference += 0.4
        return danger + preference
    }

    private plan() {
        const engine = this.engine
        const threats = this.threats()
        const actions: ('none' | 'jump' | 'drop')[] = ['none']
        if (engine.player.onGround) actions.push('jump')
        if (onElevatedPlatform(engine)) actions.push('drop')
        let best = { cost: Infinity, move: 0 as -1 | 0 | 1, action: 'none' as 'none' | 'jump' | 'drop' }
        for (const move of [-1, 0, 1] as const) {
            for (const then of [-1, 0, 1] as const) {
                for (const action of actions) {
                    const points = simulatePlayer(engine, move, action, then)
                    // A jump or drop costs position for a while: a small tax keeps the cube from hopping for nothing.
                    const cost = this.cost(points, threats, move) + (action === 'none' ? 0 : 0.8) + (then === move ? 0 : 0.3)
                    if (cost < best.cost) best = { cost, move, action }
                }
            }
        }
        this.move = best.move
        this.action = best.action
        this.lastCost = best.cost
    }

    private aim() {
        const engine = this.engine
        const p = engine.player
        const weapon = engine.weapon
        const range = weapon.type === 'arcCoil' ? weapon.chainRange : 1400
        let best: Enemy | null = null
        let bestScore = Infinity
        for (const enemy of engine.enemies) {
            if (enemy.hp <= 0 || enemy.x < -10 || enemy.x > WIDTH + 10) continue
            const d = Math.hypot(enemy.x - p.x, enemy.y - p.y)
            if (weapon.type === 'arcCoil' && d > range + enemy.radius) continue
            const closeThreat = (RAMMERS.has(enemy.type) || enemy.boss) && d < 220
            const tierRank = closeThreat ? 0 : enemy.type === 'warden' ? 1 : enemy.type === 'sniper' ? 2 : enemy.boss ? 3 : 4
            const score = tierRank * 10_000 + d
            if (score < bestScore) {
                bestScore = score
                best = enemy
            }
        }
        if (!best) {
            // Nothing in reach (Arc Coil): point at the nearest shape so the cube is ready.
            const nearest = engine.enemies.reduce<Enemy | null>((acc, enemy) => {
                if (enemy.hp <= 0) return acc
                return !acc || Math.hypot(enemy.x - p.x, enemy.y - p.y) < Math.hypot(acc.x - p.x, acc.y - p.y) ? enemy : acc
            }, null)
            this.targetId = nearest?.id ?? -1
            return { x: nearest?.x ?? WIDTH / 2, y: nearest?.y ?? 300, fire: weapon.type !== 'arcCoil' && !!nearest }
        }
        this.targetId = best.id
        if (weapon.type === 'arcCoil') return { x: best.x, y: best.y, fire: true }
        // Lead the target by the projectile's travel time.
        const speed = engine.autopilotView().weapon.bulletSpeed
        const ox = p.x
        const oy = p.y - 6
        let tx = best.x
        let ty = best.y
        for (let i = 0; i < 3; i++) {
            const t = Math.hypot(tx - ox, ty - oy) / speed
            tx = best.x + best.vx * t
            ty = Math.min(FLOOR_Y - 10, best.y + best.vy * t)
        }
        return { x: tx, y: ty, fire: true }
    }
}

// ─── One run ────────────────────────────────────────────────────────────────

const FRAME = 1 / 60

const SHOT_OWNERS = new Map<string, string>([
    ...Object.entries(SHAPEZZ_ENEMIES).filter(([type]) => type !== 'boss').map(([type, config]) => [config.color, type] as [string, string]),
    ...Object.entries(SHAPEZZ_BOSSES).flatMap(([kind, config]) => [[config.color, `boss ${kind}`], [config.accent, `boss ${kind}`]] as [string, string][])
])

async function runJob(job: Job): Promise<RunRecord> {
    installSeed(job.seed)
    const tier = TIERS[job.tier]
    const stats = shapezzPlayerStats(tier.levels)
    const weapon = shapezzWeapon(job.weapon, tier.rarity)
    let pendingOffers: ShapezzRunUpgradeId[] | null = null
    let over = false
    const offers: number[] = []
    const bosses: BossFight[] = []
    const fights = new Map<number, BossFight>()
    let pairSpawn = false
    let engineRef: ShapezzEngineType | null = null
    const taken = () => Object.values(engineRef?.getCombatStats().damageTakenByCause ?? {}).reduce((sum, value) => sum + value, 0)

    const engine: ShapezzEngineType = new ShapezzEngine(null, stats, weapon, job.difficulty, {
        onHud: () => {},
        onCheckpoint: (offered, snapshot) => {
            pendingOffers = offered
            offers.push(shapezzPayoutForRun(snapshot.coins, snapshot.elapsedMs, job.difficulty))
        },
        onBoss: (name) => { pairSpawn = name.includes('+') },
        onGameOver: () => { over = true }
    })
    engineRef = engine
    const bot = new Bot(engine)
    // The engine files every hostile orb as "enemy shot"; the shot's colour says who fired it.
    const takenByCause: Record<string, number> = {}
    let deathCause: string | null = null
    const hooked = engine as unknown as { damagePlayer: (amount: number, cause: string) => void }
    const damagePlayer = hooked.damagePlayer.bind(engine)
    hooked.damagePlayer = (amount, cause) => {
        const p = engine.player
        if (p.invulnerable <= 0 && engine.running) {
            let refined = cause
            if (cause === 'enemy shot' || cause === 'sniper/rain shot') {
                let nearest: { color: string, d: number } | null = null
                for (const bullet of engine.enemyBullets) {
                    const d = Math.hypot(bullet.x - p.x, bullet.y - p.y) - bullet.radius
                    if (!nearest || d < nearest.d) nearest = { color: bullet.color, d }
                }
                refined = nearest ? `${SHOT_OWNERS.get(nearest.color) ?? 'unknown'} shot` : cause
            }
            takenByCause[refined] = (takenByCause[refined] ?? 0) + amount
            if (p.hp + p.shield - amount <= 0) deathCause = refined
            if (flags.has('trace')) {
                const near = engine.enemyBullets.filter(bullet => Math.hypot(bullet.x - p.x, bullet.y - p.y) < 250).length
                console.error(`${(engine.elapsedMs / 1000).toFixed(2)}s ${refined} -${amount.toFixed(0)} hp ${p.hp.toFixed(0)} at ${p.x.toFixed(0)},${p.y.toFixed(0)} ground ${p.onGround} bot ${bot.describe()} bullets<250 ${near} enemies ${engine.enemies.length}`)
            }
        }
        damagePlayer(amount, cause)
    }
    engine.start()
    const pickCount = () => Object.values(engine.upgrades).reduce((sum, value) => sum + (value ?? 0), 0)

    while (!over && engine.elapsedMs < job.capMs) {
        if (pendingOffers) {
            const offered: ShapezzRunUpgradeId[] = pendingOffers
            pendingOffers = null
            let choice: ShapezzRunUpgradeId
            if (job.force && pickCount() < job.forceCount) choice = job.force
            else if (job.picks === 'greedy') choice = [...offered].sort((a, b) => GREEDY_ORDER.indexOf(a) - GREEDY_ORDER.indexOf(b))[0]!
            else choice = offered[Math.floor(Math.random() * offered.length)]!
            engine.chooseUpgrade(choice)
        }
        bot.tick()
        engine.step(FRAME)
        if (flags.has('trace') && Math.floor(engine.elapsedMs / 15_000) !== Math.floor((engine.elapsedMs - FRAME * 1000) / 15_000)) {
            const c = engine.getCombatStats()
            console.error(`-- ${(engine.elapsedMs / 1000).toFixed(0)}s cp${offers.length} enemies ${engine.enemies.length} kills ${c.kills} hp ${engine.player.hp.toFixed(0)} taken ${Object.values(takenByCause).reduce((a, b) => a + b, 0).toFixed(0)} upgrades ${JSON.stringify(engine.upgrades)}`)
        }
        // One fight per boss shape: from the frame it appears until it is gone.
        let alive = 0
        for (const enemy of engine.enemies) {
            if (!enemy.boss || enemy.hp <= 0) continue
            alive++
            if (fights.has(enemy.id)) continue
            const fight: BossFight = {
                kind: `${enemy.bossKind}${pairSpawn ? ' (pair)' : ''}`,
                checkpoint: Math.floor(engine.elapsedMs / SHAPEZZ_CHECKPOINT_MS),
                startMs: engine.elapsedMs, durationMs: null, damageTaken: -taken(), maxHp: stats.maxHp, died: false
            }
            fights.set(enemy.id, fight)
            bosses.push(fight)
        }
        if (alive < [...fights.values()].filter(fight => fight.durationMs === null).length) {
            const total = taken()
            for (const [id, fight] of fights) {
                if (fight.durationMs !== null || engine.enemies.some(enemy => enemy.id === id && enemy.hp > 0)) continue
                fight.durationMs = engine.elapsedMs - fight.startMs
                fight.damageTaken += total
            }
        }
    }
    const total = taken()
    for (const fight of fights.values()) {
        if (fight.durationMs !== null) continue
        fight.damageTaken += total
        fight.died = over
    }
    // No destroy(): headless there is no animation frame or listener to release.
    const combat = engine.getCombatStats()
    return {
        job,
        elapsedMs: combat.elapsedMs,
        capped: !over,
        checkpoints: offers.length,
        coins: combat.coins,
        kills: combat.kills,
        offers,
        deathCause: over ? deathCause ?? combat.deathCause : null,
        damageBySource: combat.damageBySource as Record<string, number>,
        damageTakenByCause: takenByCause,
        bosses,
        upgrades: combat.upgrades as Record<string, number>,
        maxHp: stats.maxHp
    }
}

// ─── Workers ────────────────────────────────────────────────────────────────

async function worker() {
    const jobs = buildJobs()
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of Bun.stdin.stream()) {
        buffer += decoder.decode(chunk)
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
            const line = buffer.slice(0, newline).trim()
            buffer = buffer.slice(newline + 1)
            newline = buffer.indexOf('\n')
            if (line === 'exit') process.exit(0)
            const job = jobs[Number(line)]!
            const record = await runJob(job)
            process.stdout.write(`${JSON.stringify({ index: Number(line), record })}\n`)
        }
    }
}

async function runAll(jobs: Job[]): Promise<RunRecord[]> {
    const workers = Math.max(1, Math.min(jobs.length, Number(flags.get('jobs') ?? Math.max(1, navigator.hardwareConcurrency - 1))))
    const results: RunRecord[] = new Array(jobs.length)
    // Longest jobs first so the tail doesn't wait on one straggler.
    const expected = (job: Job) => ({ fresh: 1, mid: 3, max: 9 }[job.tier]) / (1 + SHAPEZZ_DIFFICULTY_IDS.indexOf(job.difficulty) * 0.4)
    const queue = jobs.map((job, index) => ({ job, index })).sort((a, b) => expected(b.job) - expected(a.job)).map(entry => entry.index)
    let done = 0
    const started = performance.now()
    const tsconfig = new URL('./tsconfig.shapezz-playtest.json', import.meta.url).pathname
    const script = new URL(import.meta.url).pathname
    const verbose = flags.has('verbose')

    await Promise.all(Array.from({ length: workers }, async () => {
        const child = Bun.spawn([process.execPath, '--tsconfig-override', tsconfig, script, ...process.argv.slice(2), '--worker'], {
            stdin: 'pipe', stdout: 'pipe', stderr: 'pipe'
        })
        void (async () => {
            const text = await new Response(child.stderr).text()
            const lines = text.split('\n').filter(line => line.trim() && !line.includes('directory mismatch'))
            if (lines.length) console.error(lines.join('\n'))
        })()
        const sendNext = () => {
            const next = queue.shift()
            child.stdin.write(next === undefined ? 'exit\n' : `${next}\n`)
            child.stdin.flush()
            return next !== undefined
        }
        if (!sendNext()) return
        const decoder = new TextDecoder()
        let buffer = ''
        for await (const chunk of child.stdout) {
            buffer += decoder.decode(chunk)
            let newline = buffer.indexOf('\n')
            while (newline >= 0) {
                const line = buffer.slice(0, newline)
                buffer = buffer.slice(newline + 1)
                newline = buffer.indexOf('\n')
                const { index, record } = JSON.parse(line) as { index: number, record: RunRecord }
                results[index] = record
                done++
                if (verbose) {
                    const j = record.job
                    console.log(`${j.tier}/${j.weapon}/${j.difficulty}${j.force ? `/${j.force}` : ''} seed ${j.seed}: ${clock(record.elapsedMs)} cp${record.checkpoints} coins ${compact(record.coins)} bank ${compact(record.offers.at(-1) ?? 0)} ${record.deathCause ?? 'capped'}`)
                } else if (process.stderr.isTTY) {
                    process.stderr.write(`\r${done}/${jobs.length} runs, ${((performance.now() - started) / 1000).toFixed(0)}s`)
                }
                if (!sendNext()) {
                    child.stdin.end()
                }
            }
        }
        await child.exited
    }))
    const missing = results.filter(result => !result).length
    if (missing) throw new Error(`${missing} runs did not report back (a worker crashed)`)
    if (process.stderr.isTTY) process.stderr.write('\n')
    console.log(`${jobs.length} runs in ${((performance.now() - started) / 1000).toFixed(1)}s on ${workers} workers\n`)
    return results
}

// ─── Report ─────────────────────────────────────────────────────────────────

const pad = (value: string | number, width: number) => String(value).padStart(width)
const padRight = (value: string | number, width: number) => String(value).padEnd(width)
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`
const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const percent = (value: number) => `${(value * 100).toFixed(0)}%`

function quantile(values: number[], q: number) {
    if (!values.length) return NaN
    const sorted = [...values].sort((a, b) => a - b)
    const position = (sorted.length - 1) * q
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN

function heading(title: string) {
    console.log(`\n═══ ${title} ═══\n`)
}

/** Payout if the player always cashes out at checkpoint k (zero if they die first). */
function policyEv(runs: RunRecord[], k: number) {
    return mean(runs.map(run => run.offers[k - 1] ?? 0))
}

function bestPolicy(runs: RunRecord[]) {
    let best = { k: 0, ev: 0 }
    for (let k = 1; k <= 26; k++) {
        const ev = policyEv(runs, k)
        if (ev > best.ev) best = { k, ev }
    }
    return best
}

function groupBy<T>(items: T[], key: (item: T) => string) {
    const groups = new Map<string, T[]>()
    for (const item of items) {
        const k = key(item)
        const group = groups.get(k)
        if (group) group.push(item)
        else groups.set(k, [item])
    }
    return groups
}

function runRow(label: string, runs: RunRecord[]) {
    const survival = runs.map(run => run.elapsedMs)
    const cps = runs.map(run => run.checkpoints)
    const banked = runs.map(run => run.offers.at(-1) ?? 0)
    const coinsCollected = runs.map(run => run.coins)
    const capAtEnd = runs.map(run => shapezzMaxPayoutForRun(run.elapsedMs, run.job.difficulty))
    const policy = bestPolicy(runs)
    const capped = runs.filter(run => run.capped).length
    return padRight(label, 34)
        + pad(runs.length, 4)
        + pad(`${clock(quantile(survival, 0.1))}/${clock(quantile(survival, 0.5))}/${clock(quantile(survival, 0.9))}`, 20)
        + pad(`${quantile(cps, 0.1).toFixed(0)}/${quantile(cps, 0.5).toFixed(0)}/${quantile(cps, 0.9).toFixed(0)}`, 10)
        + pad(compact(quantile(coinsCollected, 0.5)), 9)
        + pad(percent(quantile(coinsCollected.map((value, i) => value / Math.max(1, capAtEnd[i]!)), 0.5)), 7)
        + pad(compact(quantile(banked, 0.5)), 9)
        + pad(compact(quantile(banked, 0.9)), 9)
        + pad(policy.k ? `cp${policy.k} ${compact(policy.ev)}` : '-', 13)
        + pad(capped ? `${capped}` : '', 5)
}

function runHeader(first: string) {
    console.log(padRight(first, 34) + pad('n', 4) + pad('survive p10/50/90', 20) + pad('cp', 10) + pad('coins', 9) + pad('%cap', 7)
        + pad('bank50', 9) + pad('bank90', 9) + pad('best policy', 13) + pad('cap', 5))
    console.log('─'.repeat(120))
}

function shareTable(title: string, groups: Map<string, RunRecord[]>, pick: (run: RunRecord) => Record<string, number>, top = 9) {
    heading(title)
    for (const [label, runs] of groups) {
        const totals: Record<string, number> = {}
        for (const run of runs) {
            for (const [key, value] of Object.entries(pick(run))) totals[key] = (totals[key] ?? 0) + value
        }
        const sum = Object.values(totals).reduce((acc, value) => acc + value, 0) || 1
        const parts = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, top).map(([key, value]) => `${key} ${percent(value / sum)}`)
        console.log(`${padRight(label, 26)}${parts.join(', ')}`)
    }
}

function deathTable(title: string, groups: Map<string, RunRecord[]>) {
    heading(title)
    for (const [label, runs] of groups) {
        const deaths = runs.filter(run => !run.capped)
        const counts = groupBy(deaths, run => run.deathCause ?? 'unknown')
        const parts = [...counts].sort((a, b) => b[1].length - a[1].length).map(([cause, list]) => `${cause} ${percent(list.length / Math.max(1, deaths.length))}`)
        console.log(`${padRight(label, 26)}${parts.join(', ')}`)
    }
}

function bossTable(runs: RunRecord[]) {
    heading('Bosses (all runs): time to kill and damage taken during the fight')
    console.log(padRight('boss', 26) + padRight('tier', 8) + pad('fights', 8) + pad('killed', 8) + pad('died in', 9) + pad('ttk p50', 9) + pad('ttk p90', 9) + pad('dmg p50', 9) + pad('dmg p90', 9))
    console.log('─'.repeat(95))
    const fights = runs.flatMap(run => run.bosses.map(fight => ({ fight, tier: run.job.tier })))
    const groups = groupBy(fights, entry => `${entry.fight.kind}|${entry.tier}`)
    for (const [key, list] of [...groups].sort()) {
        const [kind, tier] = key.split('|')
        const killed = list.filter(entry => entry.fight.durationMs !== null)
        const died = list.filter(entry => entry.fight.died).length
        const ttk = killed.map(entry => entry.fight.durationMs! / 1000)
        const damage = list.map(entry => entry.fight.damageTaken / entry.fight.maxHp)
        console.log(padRight(kind!, 26) + padRight(tier!, 8) + pad(list.length, 8) + pad(percent(killed.length / list.length), 8) + pad(percent(died / list.length), 9)
            + pad(ttk.length ? `${quantile(ttk, 0.5).toFixed(1)}s` : '-', 9) + pad(ttk.length ? `${quantile(ttk, 0.9).toFixed(1)}s` : '-', 9)
            + pad(percent(quantile(damage, 0.5)), 9) + pad(percent(quantile(damage, 0.9)), 9))
    }
}

function matrixReport(runs: RunRecord[]) {
    heading('Survival and payout by tier, weapon and difficulty (bank = offer at the last checkpoint reached)')
    runHeader('tier / weapon / difficulty')
    const cells = groupBy(runs, run => `${run.job.tier}|${run.job.weapon}|${run.job.difficulty}`)
    for (const [key, list] of cells) {
        const [tier, weapon, difficulty] = key.split('|')
        console.log(runRow(`${TIERS[tier as TierId].label} ${weapon} ${difficulty}`, list))
    }

    heading('By tier and difficulty (all weapons)')
    runHeader('tier / difficulty')
    for (const [key, list] of groupBy(runs, run => `${run.job.tier}|${run.job.difficulty}`)) {
        const [tier, difficulty] = key.split('|')
        console.log(runRow(`${TIERS[tier as TierId].label} ${difficulty}`, list))
    }

    heading('Weapons at equal rarity (all difficulties): median checkpoints and survival')
    console.log(padRight('tier', 10) + SHAPEZZ_WEAPON_TYPES.map(weapon => pad(weapon, 18)).join(''))
    for (const [tier, tierRuns] of groupBy(runs, run => run.job.tier)) {
        const byWeapon = groupBy(tierRuns, run => run.job.weapon)
        console.log(padRight(TIERS[tier as TierId].label, 10) + SHAPEZZ_WEAPON_TYPES.map((weapon) => {
            const list = byWeapon.get(weapon) ?? []
            return pad(list.length ? `${mean(list.map(run => run.checkpoints)).toFixed(1)}cp ${clock(quantile(list.map(run => run.elapsedMs), 0.5))}` : '-', 18)
        }).join(''))
    }

    deathTable('Death causes by tier', groupBy(runs, run => TIERS[run.job.tier].label))
    deathTable('Death causes by difficulty', groupBy(runs, run => run.job.difficulty))
    shareTable('Damage taken by cause (share of all damage), by tier', groupBy(runs, run => TIERS[run.job.tier].label), run => run.damageTakenByCause)
    shareTable('Damage dealt by source, by tier and weapon', groupBy(runs, run => `${TIERS[run.job.tier].label} ${run.job.weapon}`), run => run.damageBySource)
    bossTable(runs)
}

function upgradeReport(runs: RunRecord[]) {
    for (const [group, groupRuns] of groupBy(runs, run => run.job.group)) {
        heading(`Upgrade value — ${group} (forced as the first ${groupRuns[0]!.job.forceCount} picks, then ${groupRuns[0]!.job.picks})`)
        const baseline = groupRuns.filter(run => !run.job.force)
        const baseCp = mean(baseline.map(run => run.checkpoints))
        const baseSurvival = quantile(baseline.map(run => run.elapsedMs), 0.5)
        const baseBank = mean(baseline.map(run => run.offers.at(-1) ?? 0))
        console.log(`baseline (random picks): ${baseline.length} runs, ${baseCp.toFixed(2)} cp mean, ${clock(baseSurvival)} median, bank mean ${compact(baseBank)}\n`)
        console.log(padRight('upgrade', 20) + padRight('rarity', 13) + pad('cp mean', 9) + pad('Δcp', 8) + pad('surv p50', 10) + pad('Δsurv', 8) + pad('bank', 9) + pad('Δbank', 8) + pad('src dmg', 9) + '  deaths')
        console.log('─'.repeat(120))
        const rows = groupBy(groupRuns.filter(run => run.job.force), run => run.job.force!)
        const table = [...rows].map(([id, list]) => {
            const cp = mean(list.map(run => run.checkpoints))
            const survival = quantile(list.map(run => run.elapsedMs), 0.5)
            const bank = mean(list.map(run => run.offers.at(-1) ?? 0))
            const source = UPGRADE_SOURCE[id as ShapezzRunUpgradeId]
            const share = source ? mean(list.map((run) => {
                const total = Object.values(run.damageBySource).reduce((acc, value) => acc + value, 0) || 1
                return (run.damageBySource[source] ?? 0) / total
            })) : NaN
            const deaths = groupBy(list.filter(run => !run.capped), run => run.deathCause ?? '?')
            const topDeaths = [...deaths].sort((a, b) => b[1].length - a[1].length).slice(0, 2).map(([cause, l]) => `${cause} ${l.length}`).join(', ')
            return { id, cp, survival, bank, share, topDeaths }
        }).sort((a, b) => b.cp - a.cp)
        for (const row of table) {
            const rarity = SHAPEZZ_RUN_UPGRADES.find(upgrade => upgrade.id === row.id)!.rarity
            console.log(padRight(row.id, 20) + padRight(rarity, 13) + pad(row.cp.toFixed(2), 9) + pad(`${row.cp - baseCp >= 0 ? '+' : ''}${(row.cp - baseCp).toFixed(2)}`, 8)
                + pad(clock(row.survival), 10) + pad(`${row.survival >= baseSurvival ? '+' : '-'}${Math.round(Math.abs(row.survival - baseSurvival) / 1000)}s`, 8)
                + pad(compact(row.bank), 9) + pad(`${((row.bank / Math.max(1, baseBank) - 1) * 100).toFixed(0)}%`, 8)
                + pad(Number.isNaN(row.share) ? '' : percent(row.share), 9) + `  ${row.topDeaths}`)
        }
        const byRarity = groupBy(table, row => SHAPEZZ_RUN_UPGRADES.find(upgrade => upgrade.id === row.id)!.rarity)
        console.log(`\nmean Δcp by rarity: ${[...byRarity].map(([rarity, list]) => `${rarity} ${(mean(list.map(row => row.cp)) - baseCp).toFixed(2)}`).join(', ')}`)
    }
}

async function main() {
    if (flags.has('worker')) return worker()
    const jobs = buildJobs()
    const runs = await runAll(jobs)
    if (flags.has('json')) await Bun.write(flags.get('json')!, JSON.stringify(runs))
    if (flags.has('upgrades')) upgradeReport(runs)
    else matrixReport(runs)
}

await main()
