/**
 * Hero Quest balance projections.
 *
 * Reads the tuning registry and the pure settle math and prints tables. No database, no
 * Nitro, no game around it — so untuned constants get their values from projections rather
 * than from guesses that go load-bearing later.
 *
 *   bun run balance:hero-quest --table=time-to-boss --prestige=0 --world=1
 *
 * Tuning order matters — earlier links feed later ones:
 *   stat tiers → enemy base stats → K → BASE_GOLD → GOLD_STEP_BASE
 */

import {
    BASE_ATTACK_INTERVAL_SECONDS,
    BASE_KILL_COUNT,
    BOSS_TIMER_SECONDS,
    BASE_GOLD,
    GOLD_BOUND_HORIZON_DAYS,
    GOLD_TENURE_CRAWL,
    GOLD_TENURE_DAYS,
    MAX_BATTLE_SPEED,
    MAX_OFFLINE_EFFICIENCY_LEVEL,
    MIN_ATTACK_INTERVAL_SECONDS,
    MIN_SECONDS_PER_KILL,
    STAGES_PER_WORLD,
    WORLD_COUNT
} from '../shared/utils/hero-quest/constants'
import {
    applyXp,
    enemyPackAt,
    packSize,
    enemyStatsAt,
    goldPerKill,
    goldProgressionFactor,
    curveIndex,
    goldTenureCeiling,
    platformCeiling,
    killsRequired,
    maxGoldPerHour,
    offlineCapHours,
    offlineEfficiency,
    secondsPerKill,
    settle,
    stageArchetype,
    xpPerKill,
    xpToNextLevel
} from '../shared/utils/hero-quest/settle'
import { attacksPerSecondFor, partyDps } from '../shared/utils/hero-quest/combat'
import { heroStatBlock, partyUnitStats } from '../shared/utils/hero-quest/stats'
import { CLASS_NODES } from '../shared/utils/hero-quest/content/classes'
import { ZERO, formatHq, formatSeconds } from '../shared/utils/hero-quest/numbers'
import type { ClassId, HeroSnapshot, HqStatBlock, HqStatKey } from '../shared/utils/hero-quest/types'

const STAT_KEYS: readonly HqStatKey[] = ['pwr', 'spd', 'lck', 'imp', 'vit', 'def']

// ── args ───────────────────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
    const hit = process.argv.find(entry => entry.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : fallback
}

/** How far the Gold tables walk. Gold has no prestige cap, so this is a display choice. */
const GOLD_CURVE_PRESTIGES = 20

const table = arg('table', 'time-to-boss')
const prestige = Number(arg('prestige', '0'))
/** Account age these projections are read at — Gold is capped by it (`GOLD_TENURE_CEILING`). */
const tenureDays = Number(arg('tenure-days', String(GOLD_BOUND_HORIZON_DAYS)))
const world = Number(arg('world', '1'))
const classId = arg('class', 'class_beginner') as ClassId
const heroLevel = Number(arg('level', '1'))

function hero(overrides: Partial<HeroSnapshot> = {}): HeroSnapshot {
    return {
        classId,
        heroLevel,
        heroXp: ZERO,
        goldBonusPct: 0,
        offlineEfficiencyLevel: 0,
        offlineCapLevel: 0,
        ...overrides
    }
}

function compact(value: number): string {
    if (!Number.isFinite(value)) return '∞'
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

/** Party DPS against a specific stage's enemy, which is where DEF mitigation bites. */
function dpsAt(snapshot: HeroSnapshot, p: number, w: number, s: number) {
    const enemy = enemyStatsAt({ prestige: p, world: w, stage: s, killsInStage: 0 })
    return partyDps(partyUnitStats(snapshot), enemy.def)
}

// ── tables ─────────────────────────────────────────────────────────────────────────────

/**
 * Walks a full world stage by stage, feeding each stage's XP back into the hero before the
 * next one. Unlike `settle`, this deliberately *does* level mid-walk — it's a projection of
 * a real playthrough, not an offline settle, so §4's freeze rule doesn't bind it. A static
 * hero would report clear times for a run nobody actually plays.
 */
function timeToBoss() {
    console.log(`\nTime to clear — ${classId} from level ${heroLevel}, prestige ${prestige}, world ${world}`)
    console.log('(hero levels as it walks — XP from each stage is applied before the next)\n')

    let level = heroLevel
    let xp = ZERO
    const rows = []
    let cumulative = 0

    for (let stage = 1; stage <= STAGES_PER_WORLD; stage++) {
        const pos = { prestige, world, stage, killsInStage: 0 }
        const enemy = enemyStatsAt(pos)
        const snapshot = hero({ heroLevel: level, heroXp: xp })
        const dps = dpsAt(snapshot, prestige, world, stage)
        // Amortized per enemy, so `spk × kills` is still the stage's clear time even though
        // the enemies now arrive `packSizeFor(stage)` at a time.
        const spk = secondsPerKill(partyUnitStats(snapshot), enemyPackAt(pos))
        const archetype = stageArchetype(stage)
        const gate = archetype === 'boss' || archetype === 'super_boss'
        const kills = killsRequired(pos)
        // `spk` is amortized per enemy, so a gate is `packSize` of them — the boss and the
        // escort standing with it — not a single body.
        const clear = gate ? spk * packSize(enemyPackAt(pos)) : spk * kills
        if (Number.isFinite(clear)) cumulative += clear

        const startLevel = level
        if (Number.isFinite(spk) && kills > 0) {
            const gained = xpPerKill(prestige, world, stage).mul(kills)
            const levelled = applyXp(level, xp, gained)
            level = levelled.level
            xp = levelled.xp
        }

        rows.push({
            stage,
            type: archetype,
            level: startLevel === level ? startLevel : `${startLevel}→${level}`,
            'enemy HP': formatHq(enemy.hp),
            'enemy DEF': formatHq(enemy.def),
            'party DPS': formatHq(dps),
            's/kill': Number.isFinite(spk) ? spk.toFixed(2) : '∞ (0 dmg)',
            kills: gate ? '—' : kills,
            'clear time': formatSeconds(clear),
            'vs 30s timer': gate ? (clear <= BOSS_TIMER_SECONDS ? 'PASS' : 'FAIL') : '',
            cumulative: formatSeconds(cumulative)
        })
    }
    console.table(rows)
    console.log(`Hero finished the world at level ${level} (started ${heroLevel}).`)

    const gold = settle({
        hero: hero(),
        position: { prestige, world, stage: 1, killsInStage: 0 },
        elapsedSeconds: 3600,
        online: true,
        tenureDays
    })
    console.log(`Live Gold/hr from stage 1: ${compact(gold.goldEarned)}  (${gold.kills} kills, ${gold.secondsPerKill.toFixed(2)}s/kill)`)
    console.log(`One-hour settle takes the hero to level ${gold.heroLevel}. Blocked at boss: ${gold.blockedAtBoss}\n`)
}

function offlineTable() {
    console.log(`\nOffline accrual — ${classId} @ level ${heroLevel}, prestige ${prestige}, world ${world} stage 1\n`)
    const rows = []
    for (const hours of [1, 4, 8, 24, 48, 72]) {
        const row: Record<string, string | number> = { 'offline hrs': hours }
        for (let level = 0; level <= MAX_OFFLINE_EFFICIENCY_LEVEL; level++) {
            const result = settle({
                hero: hero({ offlineEfficiencyLevel: level, offlineCapLevel: 32 }),
                position: { prestige, world, stage: 1, killsInStage: 0 },
                elapsedSeconds: hours * 3600,
                online: false,
                tenureDays
            })
            row[`eff ${Math.round(offlineEfficiency(level) * 100)}%`] = compact(result.goldEarned)
        }
        rows.push(row)
    }
    console.table(rows)

    console.log('Offline cap track:')
    console.table([0, 4, 8, 16, 24, 32].map(level => ({
        level,
        'cap hours': offlineCapHours(level)
    })))
}

function goldCurve() {
    console.log('\nGold curve — progression against the tenure ceiling that gates it\n')
    console.log('Mid-run reference point: world 5, stage 5. "payable from" is the account age at which')
    console.log('the ceiling stops binding, i.e. when this prestige is actually worth what it says.')
    console.log('"uncapped/hr" is the progression term alone — what a position would pay with no')
    console.log('ceiling at all. Past a few prestiges nobody is ever paid it; see --table=tenure.\n')
    const rows = []
    for (let p = 0; p <= GOLD_CURVE_PRESTIGES; p++) {
        const factor = goldProgressionFactor(p, 5, 5)
        const perKill = BASE_GOLD * factor
        // Smallest tenure whose ceiling clears this progression factor, to the nearest day.
        let payableFrom = 0
        while (payableFrom < 4000 && goldTenureCeiling(payableFrom) < factor) payableFrom++
        rows.push({
            prestige: p,
            'curve index': curveIndex(p, 5, 5),
            'progress factor': compact(factor),
            'gold/kill': compact(perKill),
            'uncapped/hr': compact(perKill * (3600 / MIN_SECONDS_PER_KILL)),
            'payable from': payableFrom >= 4000 ? '> 10y' : `day ${payableFrom}`
        })
    }
    console.table(rows)
}

function tenureCurve() {
    console.log('\nTenure ceiling — what an account of a given age may be paid, against the platform\n')
    const rows = GOLD_TENURE_DAYS.map((day) => {
        const ceiling = goldTenureCeiling(day)
        return {
            day,
            ceiling: compact(ceiling),
            'gold/hr @floor': compact(BASE_GOLD * ceiling * (3600 / MIN_SECONDS_PER_KILL)),
            'platform/hr': compact(BASE_GOLD * platformCeiling(day) * (3600 / MIN_SECONDS_PER_KILL)),
            'vs platform': `${(ceiling / platformCeiling(day)).toFixed(2)}x`,
            'binds until prestige': (() => {
                let p = 0
                while (p <= GOLD_CURVE_PRESTIGES && goldProgressionFactor(p, 5, 5) < ceiling) p++
                return p > GOLD_CURVE_PRESTIGES ? `> p${GOLD_CURVE_PRESTIGES}` : `p${p}`
            })()
        }
    })
    console.table(rows)
    console.log(`Past day ${GOLD_TENURE_DAYS.at(-1)} the ceiling crawls at ${((GOLD_TENURE_CRAWL - 1) * 100).toFixed(2)}%/day.`)
    console.log('Regenerate GOLD_TENURE_CEILING from scripts/lib/economy-stages.ts after any Colony or Xeno retune.\n')
}

function attackRate() {
    const capPerSecond = 1 / MIN_ATTACK_INTERVAL_SECONDS
    console.log(`\nSPD → attack rate (basic attacks; 1 per ${BASE_ATTACK_INTERVAL_SECONDS}s at SPD 0, hard cap ${capPerSecond}/sec)\n`)
    console.table([0, 10, 25, 50, 100, 200, 400, 800, 10_000].map(spd => ({
        SPD: spd,
        'interval (s)': (1 / attacksPerSecondFor(spd)).toFixed(3),
        'attacks/sec': attacksPerSecondFor(spd).toFixed(3),
        // Tolerance, not an exact compare: the rate is a reciprocal of a clamped float.
        'at cap': attacksPerSecondFor(spd) >= capPerSecond - 0.001 ? 'yes' : ''
    })))
}

function levelCurve() {
    // Stat blocks are Decimal, and `console.table` renders a Decimal as its object shape —
    // so every stat is formatted on the way out. `formatHq` rather than `toFixed` because
    // geometric growth eventually takes these past what a fixed-point string can show.
    const stats = (block: HqStatBlock) => ({
        PWR: formatHq(block.pwr),
        SPD: formatHq(block.spd),
        LCK: formatHq(block.lck),
        IMP: formatHq(block.imp),
        VIT: formatHq(block.vit),
        DEF: formatHq(block.def)
    })

    console.log(`\nLevel curve — ${classId}\n`)
    console.table([1, 5, 10, 25, 50, 100, 250, 500].map(level => {
        const block = heroStatBlock(classId, level)
        return {
            level,
            ...stats(block),
            'atk/sec': attacksPerSecondFor(block.spd).toFixed(2),
            'xp to next': formatHq(xpToNextLevel(level))
        }
    }))

    console.log('\nLevel-1 stat totals per class (spreads are directional — totals are not balanced by construction)\n')
    console.table(CLASS_NODES.map((node) => {
        const block = heroStatBlock(node.id, 1)
        // `.add`, not `+` — summing Decimals with `+` silently concatenates their string
        // forms instead of adding them.
        const total = STAT_KEYS.reduce((sum, key) => sum.add(block[key]), ZERO)
        return {
            class: node.name,
            tier: node.tier,
            ...stats(block),
            total: formatHq(total),
            strikes: node.strikesPerAttack
        }
    }))
}

function boundTable() {
    console.log('\nGold/hour ceiling — bounded by construction (capped per-kill value × floored kill rate)\n')
    console.table([
        { scenario: 'no stack, no boost', 'max gold/hr': compact(maxGoldPerHour(1, 1)) },
        { scenario: 'x2 gold stack', 'max gold/hr': compact(maxGoldPerHour(2, 1)) },
        { scenario: 'x4 stack, x4 battle speed', 'max gold/hr': compact(maxGoldPerHour(4, 4)) },
        { scenario: `x4 stack, x${MAX_BATTLE_SPEED} battle speed (top tier)`, 'max gold/hr': compact(maxGoldPerHour(4, MAX_BATTLE_SPEED)) }
    ])
    console.log(`user.balance is numeric(19,4) — a ~1e15 ceiling. Headroom at the worst case: ${compact(1e15 / maxGoldPerHour(4, MAX_BATTLE_SPEED))}x\n`)
    console.log(`XP per kill at p0 W1S1: ${formatHq(xpPerKill(0, 1, 1))}, at p10 W10S10: ${formatHq(xpPerKill(10, 10, 10))}`)
}

// ── dispatch ───────────────────────────────────────────────────────────────────────────

{
    switch (table) {
        case 'time-to-boss': timeToBoss(); break
        case 'offline': offlineTable(); break
        case 'gold-curve': goldCurve(); break
        case 'tenure': tenureCurve(); break
        case 'attack-rate': attackRate(); break
        case 'level-curve': levelCurve(); break
        case 'bound': boundTable(); break
        default:
            console.log(`Unknown table "${table}".`)
            console.log('Tables: time-to-boss, offline, gold-curve, tenure, attack-rate, level-curve, bound')
            console.log('Filters: --prestige=N --world=N --class=class_beginner --level=N')
    }
}

console.log(`Kill count per wave stage: ${BASE_KILL_COUNT} | worlds: ${WORLD_COUNT} | throughput floor: ${MIN_SECONDS_PER_KILL}s`)
