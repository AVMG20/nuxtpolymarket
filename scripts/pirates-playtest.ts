/**
 * Pirate Raid playtest: the real PirateSim, headless, at 60 fps, driven by a heuristic bot.
 *
 *   bun run balance:pirates-playtest                              ability matrix (tiers x abilities x difficulties)
 *   bun run balance:pirates-playtest --tiers mid --abilities bomb,tidal --seeds 12
 *   bun run balance:pirates-playtest --upgrades --tiers mid       forced salvage study (each upgrade at full stacks from the start)
 *   bun run balance:pirates-playtest --curve                      difficulty curve per tier (keg only)
 *
 * Flags
 *   --tiers fresh,mid,max        investment tiers (each has its own ability level and difficulty band)
 *   --abilities bomb,seekers,...  equipped ability
 *   --difficulties 0,100,...     override the tier's difficulty band
 *   --level N                    override the ability level (1-5)
 *   --seeds N                    runs per cell (default 8)
 *   --no-crates                  the bot ignores salvage crates (isolates the ability)
 *   --jobs N                     parallel worker processes (default cores - 1)
 *   --by-tier                    split damage taken by the enemy tier that dealt it
 *   --idle                       the ship never moves or casts (baseline for the bot)
 *   --verbose                    one line per run
 *
 * The bot plays like a careful human: every 100 ms it scores a ring of
 * candidate waypoints against every telegraph, contact projectile, mine,
 * hostile zone, fire ship and enemy gun range, keeps the fleet near the edge
 * of its own cannon reach, and grabs crates and repair kits when the water is
 * safe. It casts its ability where a human would: kegs, whirlpools and
 * Hellfire at the densest cluster, the Rogue Wave down the lane with the most
 * ships (or at incoming shot), Hunter's Chain and the Consort on cooldown.
 * Runs are seeded (Math.random and crypto are both replaced per run), so a
 * seed replays the same run for the same flags.
 */

import {
    PIRATE_ABILITIES, PIRATE_POWER_UPS, PIRATE_RUN_DURATION_MS, PIRATE_ROGUE_WAVE_LENGTH, PIRATE_ROGUE_WAVE_WIDTH,
    PIRATE_HELLFIRE_ZONE_RADIUS, PIRATE_MAELSTROM_RADIUS, pirateCannonTier, pirateDefenseRating, pirateMaxHp, piratePowerLevel, pirateRegenRate,
    pirateShipSpeed, type PirateAbilityId, type PiratePowerUpId
} from '../shared/utils/gamelogic/pirates'
import { PirateSim, type PirateDamageSource } from '../app/utils/pirates-engine/sim'
import type { PirateGameOverResult, PirateShipStats } from '../app/utils/pirates-engine/types'
import { WORLD_H, WORLD_W } from '../app/utils/pirates-engine/constants'

// ─── Flags ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const flags = new Map<string, string>()
for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) continue
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
        flags.set(arg.slice(2), next)
        i++
    } else {
        flags.set(arg.slice(2), 'true')
    }
}
const list = (key: string) => flags.get(key)?.split(',').map(value => value.trim()).filter(Boolean)

// ─── Loadouts ───────────────────────────────────────────────────────────────

type TierId = 'fresh' | 'mid' | 'max'

interface Tier {
    levels: { hull: number, speed: number, defense: number, ammoCapacity: number, regen: number }
    cannons: string[]
    ammo: number
    abilityLevel: number
    difficulties: number[]
}

const TIERS: Record<TierId, Tier> = {
    // A few hundred thousand in: two cheap guns, first stat levels.
    fresh: { levels: { hull: 2, speed: 2, defense: 2, ammoCapacity: 1, regen: 1 }, cannons: ['swivel', 'carronade'], ammo: 0, abilityLevel: 1, difficulties: [0, 50] },
    // Mid game: four good guns, stats at 5.
    mid: { levels: { hull: 5, speed: 5, defense: 5, ammoCapacity: 5, regen: 3 }, cannons: ['longgun', 'longgun', 'basilisk', 'basilisk'], ammo: 300, abilityLevel: 3, difficulties: [0, 100, 200] },
    // Everything bought.
    max: { levels: { hull: 10, speed: 10, defense: 10, ammoCapacity: 10, regen: 5 }, cannons: Array(8).fill('leviathan'), ammo: 900, abilityLevel: 5, difficulties: [500, 700, 1000] }
}

function shipStats(tier: Tier, abilityId: PirateAbilityId, abilityLevel: number): { stats: PirateShipStats, power: number } {
    const power = piratePowerLevel({ levels: tier.levels, cannonTierIds: tier.cannons, cannonSlots: tier.cannons.length })
    return {
        power,
        stats: {
            maxHp: pirateMaxHp(tier.levels.hull),
            speed: pirateShipSpeed(tier.levels.speed),
            defenseRating: pirateDefenseRating(tier.levels.defense),
            regenRate: pirateRegenRate(tier.levels.regen),
            ammo: tier.ammo,
            gemAmmo: 0,
            skinId: 'starter',
            abilityId,
            abilityLevel,
            cannons: tier.cannons.map((id, slotIndex) => {
                const t = pirateCannonTier(id)
                return { slotIndex, tierId: t.id, attackRating: t.attackRating, maxDamage: t.maxDamage, reloadMs: t.reloadMs, range: t.range, shotColor: t.shotColor, shotTrail: !!t.shotTrail }
            })
        }
    }
}

// ─── Jobs ───────────────────────────────────────────────────────────────────

interface Job {
    tier: TierId
    ability: PirateAbilityId
    level: number
    difficulty: number
    seed: number
    force: PiratePowerUpId | null
    crates: boolean
    group: string
}

function hash(text: string) {
    let h = 2166136261
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
    return h >>> 0
}

function buildJobs(): Job[] {
    const tiers = (list('tiers') ?? ['fresh', 'mid', 'max']) as TierId[]
    const abilities = (list('abilities') ?? PIRATE_ABILITIES.map(a => a.id)) as PirateAbilityId[]
    const seeds = Number(flags.get('seeds') ?? 8)
    const crates = !flags.has('no-crates')
    const jobs: Job[] = []
    for (const tierId of tiers) {
        const tier = TIERS[tierId]
        const difficulties = list('difficulties')?.map(Number) ?? tier.difficulties
        const level = Number(flags.get('level') ?? tier.abilityLevel)
        if (flags.has('upgrades')) {
            const forced: (PiratePowerUpId | null)[] = [null, ...PIRATE_POWER_UPS.map(p => p.id)]
            for (const force of forced) {
                for (const difficulty of difficulties) {
                    for (let s = 0; s < seeds; s++) {
                        jobs.push({ tier: tierId, ability: 'bomb', level, difficulty, seed: hash(`${tierId}:${difficulty}:${s}`), force, crates: false, group: 'upgrades' })
                    }
                }
            }
            continue
        }
        const pool: PirateAbilityId[] = flags.has('curve') ? ['bomb'] : abilities
        for (const ability of pool) {
            for (const difficulty of difficulties) {
                for (let s = 0; s < seeds; s++) {
                    // Same seed across abilities so each cell sails the same seas.
                    jobs.push({ tier: tierId, ability, level, difficulty, seed: hash(`${tierId}:${difficulty}:${s}`), force: null, crates, group: 'matrix' })
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

const DECIDE_MS = 100
const HIT_R = 34
const CANDIDATE_RADII = [70, 150]
const CANDIDATE_DIRECTIONS = 12

interface Pt { x: number, y: number }

const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2
const dst = (ax: number, ay: number, bx: number, by: number) => Math.sqrt(d2(ax, ay, bx, by))

function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
    const dx = bx - ax
    const dy = by - ay
    const len = dx * dx + dy * dy
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len))
    return dst(ax + dx * t, ay + dy * t, px, py)
}

/** Danger of sitting at `c` over the next second or so. Lower is better. */
function danger(sim: PirateSim, c: Pt, range: number) {
    let score = 0
    for (const t of sim.telegraphs) {
        if (!t.hostile) continue
        const urgency = 1 + Math.min(1, t.ageMs / Math.max(1, t.durationMs)) * 2
        if (t.kind === 'line') {
            if (segDist(t.x, t.y, t.x2, t.y2, c.x, c.y) < t.width + HIT_R + 16) score += 60 * urgency
        } else if (d2(t.x, t.y, c.x, c.y) < (t.r + HIT_R) ** 2) {
            score += 80 * urgency
        }
    }
    for (const p of sim.projectiles) {
        if (p.owner !== 'enemy') continue
        if (p.kind === 'spiral' || p.kind === 'skiff' || p.kind === 'mine' || p.kind === 'harpoon' || p.kind === 'sniper') {
            // Where it will be in ~0.3s.
            const ax = p.x + Math.cos(p.angle) * 90
            const ay = p.y + Math.sin(p.angle) * 90
            if (segDist(p.x, p.y, ax, ay, c.x, c.y) < HIT_R + 22) score += 25
        }
    }
    for (const mine of sim.mines) {
        if (d2(mine.x, mine.y, c.x, c.y) < 85 * 85) score += 120
    }
    for (const z of sim.zones) {
        if ((z.kind === 'whirlpool' || z.kind === 'ink') && d2(z.x, z.y, c.x, c.y) < z.r * z.r) score += z.kind === 'whirlpool' ? 40 : 15
    }
    let nearest = Infinity
    for (const e of sim.enemies) {
        if (e.state === 'submerged' || e.state === 'diving') continue
        const d = dst(e.x, e.y, c.x, c.y)
        if (e.tier.id === 'fireship') {
            const reach = e.state === 'burning' ? 190 : 130
            if (d < reach) score += (reach - d) * (e.state === 'burning' ? 1.2 : 0.4)
            continue
        }
        nearest = Math.min(nearest, d)
        // Gun reach: being inside several ranges at once is what sinks ships.
        if (d < e.tier.range) score += (1 - d / Math.max(1, e.tier.range)) * (e.tier.boss ? 8 : 3)
        if (d < 110) score += (110 - d) * 0.3
    }
    // Keep the fleet near the edge of our own reach so the guns keep working.
    if (nearest < Infinity) {
        const ideal = range * 0.85
        score += Math.abs(nearest - ideal) / 60
    }
    // Stay off the edges and corners, where a ship gets pinned.
    const edge = Math.min(c.x, c.y, WORLD_W - c.x, WORLD_H - c.y)
    if (edge < 140) score += (140 - edge) * 0.08
    return score
}

function densest(sim: PirateSim, radius: number): { x: number, y: number, n: number, boss: boolean } | null {
    let best: { x: number, y: number, n: number, boss: boolean } | null = null
    const live = sim.enemies.filter(e => e.state === 'sailing' || e.state === 'burning')
    for (const centre of live) {
        let n = 0
        let sx = 0
        let sy = 0
        let boss = false
        for (const e of live) {
            if (d2(e.x, e.y, centre.x, centre.y) > radius * radius) continue
            n += e.tier.boss ? 3 : 1
            sx += e.x
            sy += e.y
            boss = boss || !!e.tier.boss
        }
        const count = live.filter(e => d2(e.x, e.y, centre.x, centre.y) <= radius * radius).length
        if (!best || n > best.n) best = { x: sx / count, y: sy / count, n, boss }
    }
    return best
}

interface BotState {
    decideMs: number
    readySinceMs: number
}

function botTick(sim: PirateSim, bot: BotState, crates: boolean) {
    if (flags.has('idle')) return
    const p = sim.player
    const range = sim.cannonRange
    const hurt = p.hp / p.maxHp

    // ─── Helm ───
    let best: Pt | null = null
    let bestScore = danger(sim, p, range) - 0.5 // small bias toward holding still
    for (const r of CANDIDATE_RADII) {
        for (let i = 0; i < CANDIDATE_DIRECTIONS; i++) {
            const a = i / CANDIDATE_DIRECTIONS * Math.PI * 2
            const c = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r }
            if (c.x < 50 || c.y < 50 || c.x > WORLD_W - 50 || c.y > WORLD_H - 50 || sim.blocked(c.x, c.y)) continue
            // Halfway point too: the ship has to sail through it.
            const mid = { x: (p.x + c.x) / 2, y: (p.y + c.y) / 2 }
            const score = danger(sim, c, range) * 0.7 + danger(sim, mid, range) * 0.3 + r / 400
            if (score < bestScore) {
                bestScore = score
                best = c
            }
        }
    }
    // Pickups when the water is calm enough.
    let pickupGoal: Pt | null = null
    let pickupD = Infinity
    for (const pickup of sim.pickups) {
        if (pickup.kind === 'crate' && !crates) continue
        if (pickup.kind === 'repair' && hurt > 0.8) continue
        const d = dst(p.x, p.y, pickup.x, pickup.y)
        const want = pickup.kind === 'repair' ? (hurt < 0.45 ? 900 : 500) : 600
        if (d > want || d >= pickupD) continue
        if (danger(sim, pickup, range) > 30) continue
        pickupGoal = pickup
        pickupD = d
    }
    if (pickupGoal && bestScore < 20) {
        sim.sailTo(pickupGoal.x, pickupGoal.y, false)
    } else if (best) {
        sim.sailTo(best.x, best.y, false)
    } else {
        sim.heaveTo()
    }

    // ─── Ability ───
    if (!sim.abilityReady) {
        bot.readySinceMs = -1
        return
    }
    if (bot.readySinceMs < 0) bot.readySinceMs = sim.elapsedMs
    const waited = sim.elapsedMs - bot.readySinceMs
    const live = sim.enemies.filter(e => e.state === 'sailing' || e.state === 'burning')
    if (!live.length) return
    switch (sim.abilityId) {
        case 'seekers':
        case 'consort':
            sim.castAbility(p.x, p.y)
            return
        case 'bomb':
        case 'maelstrom': {
            const target = densest(sim, sim.abilityId === 'bomb' ? 120 : PIRATE_MAELSTROM_RADIUS * 0.8)
            if (target && (target.n >= 3 || target.boss || waited > 4000 || hurt < 0.4)) sim.castAbility(target.x, target.y)
            return
        }
        case 'firestorm': {
            const target = densest(sim, PIRATE_HELLFIRE_ZONE_RADIUS * 0.8)
            if (target && (target.n >= 4 || target.boss || waited > 5000 || hurt < 0.4)) sim.castAbility(target.x, target.y)
            return
        }
        case 'tidal': {
            // The lane from the ship with the most hulls and incoming shot.
            let bestAngle = 0
            let bestValue = 0
            for (let i = 0; i < 16; i++) {
                const a = i / 16 * Math.PI * 2
                const cos = Math.cos(a)
                const sin = Math.sin(a)
                let value = 0
                const inLane = (x: number, y: number) => {
                    const along = (x - p.x) * cos + (y - p.y) * sin
                    const across = Math.abs(-(x - p.x) * sin + (y - p.y) * cos)
                    return along > 0 && along < PIRATE_ROGUE_WAVE_LENGTH && across < PIRATE_ROGUE_WAVE_WIDTH / 2
                }
                for (const e of live) if (inLane(e.x, e.y)) value += e.tier.boss ? 3 : 1
                for (const proj of sim.projectiles) if (proj.owner === 'enemy' && inLane(proj.x, proj.y)) value += 0.4
                if (value > bestValue) {
                    bestValue = value
                    bestAngle = a
                }
            }
            if (bestValue >= 3 || (bestValue >= 1 && (waited > 4000 || hurt < 0.4))) {
                sim.castAbility(p.x + Math.cos(bestAngle) * 300, p.y + Math.sin(bestAngle) * 300)
            }
        }
    }
}

// ─── One run ────────────────────────────────────────────────────────────────

interface RunRecord {
    job: Job
    survived: boolean
    elapsedMs: number
    kills: number
    bosses: number
    casts: number
    damage: Record<PirateDamageSource, number>
    taken: Record<string, number>
    death: string | null
    upgrades: number
}

/** Who hurt the player: the sim method two frames up the stack from damagePlayer. */
function damageLabel(stack: string) {
    const frames = stack.split('\n').slice(2, 7).map(line => line.trim().split(' ')[1] ?? '')
    const known = ['fireshipExplode', 'krakenSlam', 'phantomSpiral', 'fireHarpoon', 'fireMortar', 'fireSniper', 'launchDriftMine', 'launchFrenzyBomb', 'launchSkiffs', 'updateMines', 'updateZones', 'enemyShot']
    for (const frame of frames) {
        const name = frame.split('.').pop() ?? frame
        const hit = known.find(k => name.includes(k))
        if (hit) return hit
    }
    return frames.map(f => f.split('.').pop()).join('<')
}

function runJob(job: Job): RunRecord {
    installSeed(job.seed)
    const tier = TIERS[job.tier]
    const { stats, power } = shipStats(tier, job.ability, job.level)
    let over: PirateGameOverResult | null = null
    const sim = new PirateSim({ onGameOver: (result) => { over = result } })
    sim.prepare(stats)

    const taken: Record<string, number> = {}
    let lastHit: string | null = null
    // Attribute incoming damage: enemy projectiles carry their kind into their
    // landing/contact callbacks, and scheduled strikes carry the method that
    // scheduled them. Anything else falls back to the call stack.
    let label = ''
    type Callback = ((...args: unknown[]) => unknown) | null
    const labelled = (fn: Callback, tag: string): Callback => fn && ((...args: unknown[]) => {
        const previous = label
        label = tag
        try {
            return fn(...args)
        } finally {
            label = previous
        }
    })
    const raw = sim as unknown as {
        damagePlayer: (amount: number, heavy?: boolean) => void
        applyPowerUp: (pickup: object) => void
        baseProjectile: (kind: string, owner: string, ...rest: unknown[]) => Record<string, unknown>
        schedule: (delayMs: number, fn: () => void) => void
    }
    // Which enemy tier is acting right now, so damage can be pinned on it.
    let actor = ''
    const methods = raw as unknown as Record<string, (enemy: { tier: { id: string } }, ...rest: unknown[]) => unknown>
    for (const method of ['enemyShot', 'useEnemyAbility', 'fireMortar', 'updateFireship', 'updateKraken']) {
        const original = methods[method]!.bind(sim)
        methods[method] = (enemy, ...rest) => {
            const previous = actor
            actor = enemy.tier.id
            try {
                return original(enemy, ...rest)
            } finally {
                actor = previous
            }
        }
    }
    const baseProjectile = raw.baseProjectile.bind(sim)
    raw.baseProjectile = (kind, owner, ...rest) => {
        const projectile = baseProjectile(kind, owner, ...rest)
        if (owner !== 'enemy') return projectile
        const tag = flags.has('by-tier') && actor ? `${kind}@${actor}` : kind
        for (const key of ['onLand', 'onContact']) {
            let fn: Callback = null
            Object.defineProperty(projectile, key, { get: () => fn, set: (next: Callback) => { fn = labelled(next, tag) }, enumerable: true, configurable: true })
        }
        return projectile
    }
    const schedule = raw.schedule.bind(sim)
    raw.schedule = (delayMs, fn) => {
        const caller = (new Error().stack ?? '').split('\n')[2]?.trim().split(' ')[1]?.split('.').pop() ?? ''
        const tag = label || (flags.has('by-tier') && actor ? `${caller}@${actor}` : caller)
        schedule(delayMs, labelled(fn as Callback, tag) as () => void)
    }
    const damagePlayer = raw.damagePlayer.bind(sim)
    raw.damagePlayer = (amount: number, heavy?: boolean) => {
        const before = sim.player.hp + sim.player.shield
        damagePlayer(amount, heavy)
        const lost = before - sim.player.hp - sim.player.shield
        if (lost <= 0) return
        lastHit = label || damageLabel(new Error().stack ?? '') + (flags.has('by-tier') && actor ? `@${actor}` : '')
        taken[lastHit] = (taken[lastHit] ?? 0) + lost
    }

    sim.start(stats, power, job.difficulty)
    if (job.force) {
        const def = PIRATE_POWER_UPS.find(p => p.id === job.force)!
        for (let i = 0; i < def.maxStacks; i++) raw.applyPowerUp({ powerUpId: def.id, rarity: def.rarity, x: sim.player.x, y: sim.player.y })
    }
    const bot: BotState = { decideMs: 0, readySinceMs: -1 }
    const step = 1000 / 60
    let guard = 0
    while (!over && guard++ < (PIRATE_RUN_DURATION_MS + 5000) / step) {
        sim.step(step)
        sim.drainEvents()
        bot.decideMs -= step
        if (bot.decideMs <= 0) {
            bot.decideMs = DECIDE_MS
            botTick(sim, bot, job.crates)
        }
    }
    const result = over as PirateGameOverResult | null
    const survived = result?.reason === 'timeout'
    return {
        job,
        survived,
        elapsedMs: result?.elapsedMs ?? sim.elapsedMs,
        kills: result?.kills ?? 0,
        bosses: result?.bossesSunk ?? 0,
        casts: result?.abilitiesUsed ?? 0,
        damage: { ...sim.damageBySource },
        taken,
        death: survived ? null : lastHit,
        upgrades: result?.powerUps.reduce((sum, p) => sum + p.stacks, 0) ?? 0
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
            const record = runJob(jobs[Number(line)]!)
            process.stdout.write(`${JSON.stringify({ index: Number(line), record })}\n`)
        }
    }
}

async function runAll(jobs: Job[]): Promise<RunRecord[]> {
    const workers = Math.max(1, Math.min(jobs.length, Number(flags.get('jobs') ?? Math.max(1, navigator.hardwareConcurrency - 1))))
    const results: RunRecord[] = new Array(jobs.length)
    const queue = jobs.map((_, index) => index)
    let done = 0
    const started = performance.now()
    const tsconfig = new URL('./tsconfig.shapezz-playtest.json', import.meta.url).pathname
    const script = new URL(import.meta.url).pathname
    await Promise.all(Array.from({ length: workers }, async () => {
        const child = Bun.spawn([process.execPath, '--tsconfig-override', tsconfig, script, ...argv, '--worker'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
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
                if (flags.has('verbose')) {
                    const j = record.job
                    console.log(`${j.tier}/${j.ability}/${j.difficulty}${j.force ? `/${j.force}` : ''} seed ${j.seed}: ${clock(record.elapsedMs)} kills ${record.kills} ${record.death ?? 'CLEAR'}`)
                } else if (process.stderr.isTTY) {
                    process.stderr.write(`\r${done}/${jobs.length} runs, ${((performance.now() - started) / 1000).toFixed(0)}s`)
                }
                if (!sendNext()) child.stdin.end()
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

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`
const pad = (value: string | number, width: number) => String(value).padStart(width)
const padRight = (value: string | number, width: number) => String(value).padEnd(width)
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
const k = (n: number) => n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0)

function summarise(runs: RunRecord[]) {
    const minutes = runs.map(r => r.elapsedMs / 60_000)
    const perMin = (pick: (r: RunRecord) => number) => mean(runs.map(r => pick(r) / Math.max(0.1, r.elapsedMs / 60_000)))
    const total = (r: RunRecord) => r.damage.cannon + r.damage.ability + r.damage.upgrade + r.damage.hazard
    return {
        runs: runs.length,
        clear: runs.filter(r => r.survived).length / runs.length,
        time: mean(runs.map(r => r.elapsedMs)),
        kills: mean(runs.map(r => r.kills)),
        bosses: mean(runs.map(r => r.bosses)),
        abilityPerMin: perMin(r => r.damage.ability),
        cannonPerMin: perMin(r => r.damage.cannon),
        upgradePerMin: perMin(r => r.damage.upgrade),
        share: mean(runs.map(r => r.damage.ability / Math.max(1, total(r)))),
        casts: mean(runs.map((r, i) => r.casts / Math.max(0.1, minutes[i]!))),
        takenPerMin: perMin(r => Object.values(r.taken).reduce((a, b) => a + b, 0))
    }
}

function header(first: string) {
    console.log(padRight(first, 28) + pad('clear', 7) + pad('time', 7) + pad('kills', 7) + pad('boss', 6) + pad('abil/min', 10) + pad('guns/min', 10) + pad('share', 7) + pad('upg/min', 9) + pad('casts/m', 9) + pad('hurt/min', 10))
    console.log('─'.repeat(110))
}

function row(label: string, s: ReturnType<typeof summarise>) {
    console.log(
        padRight(label, 28)
        + pad(`${Math.round(s.clear * 100)}%`, 7)
        + pad(clock(s.time), 7)
        + pad(s.kills.toFixed(0), 7)
        + pad(s.bosses.toFixed(1), 6)
        + pad(k(s.abilityPerMin), 10)
        + pad(k(s.cannonPerMin), 10)
        + pad(`${Math.round(s.share * 100)}%`, 7)
        + pad(k(s.upgradePerMin), 9)
        + pad(s.casts.toFixed(1), 9)
        + pad(k(s.takenPerMin), 10)
    )
}

function report(runs: RunRecord[]) {
    const groups = new Map<string, RunRecord[]>()
    const key = (r: RunRecord) => flags.has('upgrades')
        ? `${r.job.tier} d${r.job.difficulty} ${r.job.force ?? '(none)'}`
        : `${r.job.tier} d${r.job.difficulty} ${r.job.ability}`
    for (const r of runs) groups.set(key(r), [...(groups.get(key(r)) ?? []), r])
    header(flags.has('upgrades') ? 'tier / difficulty / forced' : 'tier / difficulty / ability')
    let lastPrefix = ''
    for (const [label, group] of groups) {
        const prefix = label.split(' ').slice(0, 2).join(' ')
        if (lastPrefix && prefix !== lastPrefix) console.log('')
        lastPrefix = prefix
        row(label, summarise(group))
    }
    if (!flags.has('upgrades')) {
        console.log('\nAbility overall (all tiers and difficulties pooled, normalised to the mean):')
        const byAbility = new Map<string, RunRecord[]>()
        for (const r of runs) byAbility.set(r.job.ability, [...(byAbility.get(r.job.ability) ?? []), r])
        // Normalise each cell to its tier+difficulty mean so hard cells don't dominate.
        const cellMean = new Map<string, { abil: number, time: number }>()
        const cells = new Map<string, RunRecord[]>()
        for (const r of runs) {
            const cell = `${r.job.tier}:${r.job.difficulty}`
            cells.set(cell, [...(cells.get(cell) ?? []), r])
        }
        for (const [cell, group] of cells) {
            const s = summarise(group)
            cellMean.set(cell, { abil: s.abilityPerMin, time: s.time })
        }
        console.log(padRight('ability', 12) + pad('abil dmg', 10) + pad('survival', 10) + pad('clear', 8))
        for (const [ability, group] of byAbility) {
            const rel = (pick: (r: RunRecord) => number, base: (m: { abil: number, time: number }) => number) =>
                mean(group.map(r => pick(r) / Math.max(1, base(cellMean.get(`${r.job.tier}:${r.job.difficulty}`)!))))
            const abil = rel(r => r.damage.ability / Math.max(0.1, r.elapsedMs / 60_000), m => m.abil)
            const time = rel(r => r.elapsedMs, m => m.time)
            console.log(padRight(ability, 12) + pad(`${(abil * 100).toFixed(0)}%`, 10) + pad(`${(time * 100).toFixed(0)}%`, 10) + pad(`${Math.round(group.filter(r => r.survived).length / group.length * 100)}%`, 8))
        }
    }
    const causes = new Map<string, number>()
    const totals = new Map<string, number>()
    for (const r of runs) {
        if (r.death) causes.set(r.death, (causes.get(r.death) ?? 0) + 1)
        for (const [source, amount] of Object.entries(r.taken)) totals.set(source, (totals.get(source) ?? 0) + amount)
    }
    const grand = [...totals.values()].reduce((a, b) => a + b, 0)
    console.log('\nDamage taken by source (all runs):')
    for (const [source, amount] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        console.log(`  ${padRight(source, 26)} ${pad(`${(amount / grand * 100).toFixed(1)}%`, 7)}   killing blows ${causes.get(source) ?? 0}`)
    }
}

if (flags.has('worker')) {
    await worker()
} else {
    const jobs = buildJobs()
    const runs = await runAll(jobs)
    report(runs)
}
