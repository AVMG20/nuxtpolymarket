import { PATHWARDEN_DEFENSE_BLUEPRINTS } from './pathwarden'

export type PathwardenSimulationDifficulty = 1 | 2 | 3 | 4 | 5
export type PathwardenSimulationStrategy = 'balanced' | 'aether-reserve' | 'life-preserve' | 'damage-rush' | 'control'

export interface PathwardenSimulationOptions {
    difficulty: PathwardenSimulationDifficulty
    strategy: PathwardenSimulationStrategy
    runs?: number
    seed?: number
}

export interface PathwardenSimulationWaveResult {
    wave: number
    survivalRate: number
    averageLives: number
    averageAether: number
    averageDamage: number
    averageProgress: number
    averageLeaks: number
}

export interface PathwardenSimulationResult {
    runs: number
    difficulty: PathwardenSimulationDifficulty
    strategy: PathwardenSimulationStrategy
    successRate: number
    averageFinalLives: number
    averageAetherPreserved: number
    averageDamage: number
    averageEnemyProgress: number
    upgradePriorities: string[]
    waves: PathwardenSimulationWaveResult[]
}

interface StrategyProfile {
    reserve: number
    damage: number
    control: number
    life: number
    priorities: string[]
}

const STRATEGIES: Record<PathwardenSimulationStrategy, StrategyProfile> = {
    balanced: {
        reserve: 0.2,
        damage: 1,
        control: 1,
        life: 0.35,
        priorities: ['Damage', 'Bounty', 'Haste', 'Fortify']
    },
    'aether-reserve': {
        reserve: 0.8,
        damage: 0.92,
        control: 0.9,
        life: 0.15,
        priorities: ['Interest', 'Bounty', 'Range', 'Damage']
    },
    'life-preserve': {
        reserve: 0.05,
        damage: 1.04,
        control: 1.2,
        life: 1,
        priorities: ['Fortify', 'Frost', 'Range', 'Haste']
    },
    'damage-rush': {
        reserve: 0,
        damage: 1.18,
        control: 0.8,
        life: 0.1,
        priorities: ['Damage', 'Haste', 'Bounty', 'Range']
    },
    control: {
        reserve: 0.15,
        damage: 0.94,
        control: 1.35,
        life: 0.45,
        priorities: ['Frost', 'Range', 'Haste', 'Fortify']
    }
}

const STARTER_DEFENSES = PATHWARDEN_DEFENSE_BLUEPRINTS.filter(defense =>
    ['bolt', 'mortar', 'frost', 'ember', 'storm', 'radiant'].includes(defense.id)
)

function seededRandom(seed: number) {
    let state = seed >>> 0
    return () => {
        state += 0x6D2B79F5
        let value = state
        value = Math.imul(value ^ value >>> 15, value | 1)
        value ^= value + Math.imul(value ^ value >>> 7, value | 61)
        return ((value ^ value >>> 14) >>> 0) / 4294967296
    }
}

/**
 * Longer roads expose enemies to more defenses. This modest, sub-linear
 * increase lets them survive several firing positions without making compact
 * routes disproportionately punishing.
 */
export function pathwardenRouteHealthMultiplier(routeLength: number) {
    return Math.min(1.55, 0.92 + Math.sqrt(Math.max(0, routeLength - 6)) * 0.1)
}

export function pathwardenSimulationStrategy(strategy: PathwardenSimulationStrategy) {
    return STRATEGIES[strategy]
}

export function runPathwardenSimulations(options: PathwardenSimulationOptions): PathwardenSimulationResult {
    const runs = Math.max(1, Math.min(10_000, Math.floor(options.runs ?? 1000)))
    const difficulty = Math.max(1, Math.min(5, Math.floor(options.difficulty))) as PathwardenSimulationDifficulty
    const strategy = STRATEGIES[options.strategy]
    const random = seededRandom(options.seed ?? 0x50415448)
    const waveTotals = Array.from({ length: 12 }, (_, index) => ({
        wave: index + 1,
        survivors: 0,
        lives: 0,
        aether: 0,
        damage: 0,
        progress: 0,
        leaks: 0
    }))
    let wins = 0
    let finalLives = 0
    let finalAether = 0
    let totalDamage = 0
    let enemyProgress = 0

    for (let run = 0; run < runs; run++) {
        let lives = 20
        let aether = 205
        let towerPower = 0
        let towerControl = 0
        let towerCount = 0
        let damageRelics = 0
        let bountyRelics = 0
        let interestRelics = 0
        let runDamage = 0
        let runProgress = 0
        let simulatedWaves = 0

        for (let wave = 1; wave <= 12; wave++) {
            const reserveTarget = strategy.reserve * (205 + wave * 14)
            const cheapestDefense = Math.min(...STARTER_DEFENSES.map(defense => defense.aetherCost))
            const spendable = Math.max(
                towerPower === 0 ? Math.min(aether, cheapestDefense) : 0,
                aether - reserveTarget
            )
            let spent = 0
            while (spent < spendable && STARTER_DEFENSES.length) {
                const affordable = STARTER_DEFENSES.filter(defense =>
                    spent + defense.aetherCost * (1 + towerCount * 0.28) <= spendable)
                if (!affordable.length) break
                const defense = affordable[Math.floor(random() * affordable.length)]!
                const cost = defense.aetherCost * (1 + towerCount * 0.28)
                spent += cost
                const dps = defense.damage / Math.max(0.25, defense.rate)
                towerPower += dps * (0.78 + random() * 0.44)
                towerControl += (defense.slow * 2.2 + defense.range / 900 + defense.splash / 520)
                    * (0.75 + random() * 0.5)
                towerCount++
            }
            aether -= spent

            const routeLength = 9 + wave * 1.65 + random() * 8
            const enemyCount = 7 + wave * 3 + Math.floor(random() * (2 + difficulty))
            let leaks = 0
            let waveDamage = 0
            let progressTotal = 0
            for (let enemyIndex = 0; enemyIndex < enemyCount; enemyIndex++) {
                const boss = wave % 4 === 0 && enemyIndex === enemyCount - 1
                const brute = !boss && wave >= 3 && enemyIndex % 5 === 0
                const runner = !boss && !brute && wave >= 2 && enemyIndex % 3 === 0
                const healthProfile = boss ? 8.5 : brute ? 2.5 : runner ? 0.7 : 1
                const hp = (95 + wave * 28)
                    * healthProfile
                    * (1 + (difficulty - 1) * 0.22)
                    * pathwardenRouteHealthMultiplier(routeLength)
                const exposure = routeLength
                    * (0.54 + random() * 0.22)
                    * (1 + towerControl * 0.012 * strategy.control)
                const dealt = towerPower
                    * exposure
                    * 0.85
                    * strategy.damage
                    * (1 + damageRelics * 0.08)
                    * (0.84 + random() * 0.32)
                const progress = Math.min(1, hp / Math.max(1, dealt))
                waveDamage += Math.min(hp, dealt)
                progressTotal += progress
                if (dealt < hp) {
                    leaks++
                    lives -= boss ? 5 : brute ? 2 : 1
                } else {
                    aether += (2.5 + wave * 0.5) * (boss ? 9 : brute ? 2.1 : runner ? 1.2 : 1)
                        * (1 + bountyRelics * 0.08)
                }
            }
            runDamage += waveDamage
            runProgress += progressTotal / enemyCount
            simulatedWaves++

            if (wave % 2 === 0 && lives > 0) {
                const priority = strategy.priorities[(wave / 2 - 1) % strategy.priorities.length]!
                if (priority === 'Damage' || priority === 'Haste') damageRelics++
                else if (priority === 'Bounty') bountyRelics++
                else if (priority === 'Interest') interestRelics++
                else if (priority === 'Fortify') {
                    lives = Math.min(30, lives + Math.max(1, Math.round(2 * strategy.life)))
                } else towerControl += 1.5
            }
            aether *= 1 + interestRelics * 0.015

            const totals = waveTotals[wave - 1]!
            if (lives > 0) totals.survivors++
            totals.lives += Math.max(0, lives)
            totals.aether += Math.max(0, aether)
            totals.damage += waveDamage
            totals.progress += progressTotal / enemyCount
            totals.leaks += leaks
            if (lives <= 0) break
        }

        if (lives > 0) wins++
        finalLives += Math.max(0, lives)
        finalAether += Math.max(0, aether)
        totalDamage += runDamage
        enemyProgress += runProgress / Math.max(1, simulatedWaves)
    }

    return {
        runs,
        difficulty,
        strategy: options.strategy,
        successRate: wins / runs,
        averageFinalLives: finalLives / runs,
        averageAetherPreserved: finalAether / runs,
        averageDamage: totalDamage / runs,
        averageEnemyProgress: enemyProgress / runs,
        upgradePriorities: [...strategy.priorities],
        waves: waveTotals.map(total => ({
            wave: total.wave,
            survivalRate: total.survivors / runs,
            averageLives: total.lives / runs,
            averageAether: total.aether / runs,
            averageDamage: total.damage / runs,
            averageProgress: total.progress / runs,
            averageLeaks: total.leaks / runs
        }))
    }
}
