/**
 * A headless model of a HACKERZ run.
 *
 * The point of this file is that the balance targets in `hackerz.ts` are
 * checkable rather than asserted. "A fully-invested account on Zero Day should
 * end somewhere in the low-to-mid twenties" is a claim about an interaction
 * between eleven upgrade curves, a compounding health multiplier and a wave
 * budget, and the only honest way to hold that claim is to run it.
 *
 * It is an approximation and says so:
 *
 * - The player is modelled as a damage-per-second figure with an uptime factor,
 *   not as a mouse. Aiming skill is a constant here.
 * - Enemies are spawned on the *expected* composition of a wave rather than a
 *   rolled one, so a run is deterministic and a regression is a real change and
 *   not a seed.
 * - Positions, travel times, standoffs, the trap band and the end-of-wave purge
 *   are simulated properly, because those are what decide whether a wave leaks.
 *
 * Used by `test/hackerz/balance.spec.ts` and `scripts/hackerz-balance.ts`.
 */

import {
    HACKERZ_MAX_WAVE, HACKERZ_SPAWN_WINDOW_MS, HACKERZ_WAVE_MS,
    hackerzBountyMultiplier, hackerzClearBonus, hackerzCoinValue, hackerzDamageMultiplier,
    hackerzDifficulty, hackerzEmptyLevels, hackerzEmptyMainframe, hackerzHpMultiplier,
    hackerzIsAirborne, hackerzIsBossWave, hackerzBossFor, hackerzEnemy,
    hackerzLoadout, hackerzMainframeEffects, hackerzTypeMultiplier, hackerzUpgrade,
    hackerzSpawnWeight, hackerzUpgradeCost, hackerzWaveBudget, hackerzWavePool, hackerzWeapon,
    hackerzWeaponUnlockWave, hackerzSlots, hackerzTurret, HACKERZ_UPGRADES,
    type HackerzDifficultyId, type HackerzEnemyDefinition, type HackerzLoadout,
    type HackerzMainframeLevels, type HackerzTurretId, type HackerzUpgradeId,
    type HackerzUpgradeLevels, type HackerzWeaponId
} from './hackerz'

/** Matches the engine: enemies walk this far before the wall stops them. */
const FIELD_WIDTH = 1042
const SPIKE_BAND = 168
const STEP_MS = 100

/**
 * What fraction of the theoretical weapon DPS a player actually lands. Covers
 * misses, target switching, and the seconds a wave spends with nothing in range.
 * Turrets are exempt — they never miss and never stop.
 */
export const SIM_PLAYER_UPTIME = 0.68

export interface HackerzSimBuild {
    levels: HackerzUpgradeLevels
    mainframe: HackerzMainframeLevels
    weapon: HackerzWeaponId
    turrets: (HackerzTurretId | null)[]
}

export interface HackerzSimWave {
    wave: number
    /** Wall health at the end of the wave, before any uplink repair. */
    wallHp: number
    wallMaxHp: number
    hostiles: number
    kills: number
    /** Enemies the purge had to clean up — a proxy for "the wave outran you". */
    survivors: number
    credits: number
    coins: number
    /** Total effective damage per second the build was putting out. */
    dps: number
    breached: boolean
}

export interface HackerzSimResult {
    /** Deepest wave started. `HACKERZ_MAX_WAVE` with `victory` is a clear. */
    endedWave: number
    victory: boolean
    coins: number
    waves: HackerzSimWave[]
}

interface SimEnemy {
    def: HackerzEnemyDefinition
    hp: number
    x: number
    standoff: number
    attackTimer: number
    spawnAt: number
    /** Bombers kill themselves on the wall and pay no bounty for it. */
    detonated?: boolean
}

/** A build with every in-run upgrade and every Mainframe level bought. */
export function hackerzMaxBuild(): HackerzSimBuild {
    const levels = hackerzEmptyLevels()
    for (const def of HACKERZ_UPGRADES) levels[def.id] = def.max
    const mainframe = hackerzEmptyMainframe()
    mainframe.bulwark = 12
    mainframe.munitions = 12
    mainframe.foundry = 12
    mainframe.grant = 10
    mainframe.salvage = 13
    mainframe.capacitor = 10
    mainframe.charter = 4
    mainframe.arsenal = 4
    const slots = hackerzSlots(levels.spire, mainframe.charter)
    return {
        levels,
        mainframe,
        weapon: 'sniper',
        turrets: Array.from({ length: slots }, () => 'lance' as HackerzTurretId)
    }
}

/**
 * A mid-progression account: roughly half the Mainframe, nothing bought in-run
 * yet. This is the tier the difficulty ladder is actually pitched at — the point
 * of checking it is that Siege and Blackout should be *possible* here, not that
 * they should be possible on a bare account.
 */
export function hackerzGearedBuild(): HackerzSimBuild {
    const mainframe = hackerzEmptyMainframe()
    mainframe.bulwark = 6
    mainframe.munitions = 6
    mainframe.foundry = 6
    mainframe.grant = 5
    mainframe.salvage = 6
    mainframe.capacitor = 5
    mainframe.charter = 2
    mainframe.arsenal = 2
    return {
        levels: hackerzEmptyLevels(),
        mainframe,
        weapon: 'rail',
        turrets: Array.from({ length: hackerzSlots(0, mainframe.charter) }, () => null)
    }
}

/** A build that has bought nothing at all — the shape of wave one. */
export function hackerzFreshBuild(): HackerzSimBuild {
    const mainframe = hackerzEmptyMainframe()
    return {
        levels: hackerzEmptyLevels(),
        mainframe,
        weapon: 'rail',
        turrets: Array.from({ length: hackerzSlots(0, 0) }, () => null)
    }
}

/**
 * Sustained damage per second from the player's gun, including the reload it has
 * to take and the average value of its crit chance.
 */
export function hackerzWeaponDps(loadout: HackerzLoadout) {
    const weapon = loadout.weapon
    const cycleMs = weapon.magazine * weapon.fireIntervalMs + weapon.reloadMs
    const shotDamage = weapon.damage * weapon.pellets
    const avgCrit = 1 + loadout.critChance * (loadout.critMultiplier - 1)
    return (weapon.magazine * shotDamage * avgCrit) / (cycleMs / 1000)
}

export function hackerzTurretDps(loadout: HackerzLoadout) {
    return loadout.turrets.reduce((sum, t) => sum + t.damage / (t.intervalMs / 1000), 0)
}

/**
 * How much more than one target a source is worth in a crowd.
 *
 * Pierce, chain and splash all resolve to "this shot also hurt things that were
 * not the thing you shot", and the crowd is only ever a few deep at the wall, so
 * one saturating factor covers all three closely enough for a balance model.
 */
function spreadFactor(loadout: HackerzLoadout, alive: number) {
    const weapon = loadout.weapon
    let extra = weapon.pierce * 0.6
    if (weapon.chain > 0) {
        let share = weapon.chainFalloff
        for (let i = 0; i < weapon.chain; i++) {
            extra += share
            share *= weapon.chainFalloff
        }
    }
    if (weapon.splashRadius > 0 && weapon.damage > 0) {
        extra += (weapon.splashDamage / weapon.damage) * 1.8
    }
    return 1 + extra * Math.min(1, Math.max(0, alive - 1) / 4)
}

/** The expected composition of a wave, in whole enemies, matching the scheduler. */
export function hackerzExpectedWave(wave: number, difficultyId: HackerzDifficultyId) {
    const difficulty = hackerzDifficulty(difficultyId)
    const pool = hackerzWavePool(wave)
    const weight = (def: HackerzEnemyDefinition) => hackerzSpawnWeight(def, wave)
    const totalWeight = pool.reduce((sum, def) => sum + weight(def), 0)
    const expectedCost = pool.reduce((sum, def) => sum + (weight(def) / totalWeight) * def.cost, 0)
    const picks = hackerzWaveBudget(wave, difficulty) / expectedCost

    // The engine also keeps hackers topped up on the field, but those pay no
    // coins and do not hit the wall, so the sim leaves them out.
    const composition: { def: HackerzEnemyDefinition, count: number }[] = []
    for (const def of pool) {
        const count = Math.round(picks * (weight(def) / totalWeight))
        if (count > 0) composition.push({ def, count })
    }
    if (hackerzIsBossWave(wave)) {
        composition.push({ def: hackerzEnemy(hackerzBossFor(wave)), count: 1 })
    }
    return composition
}

/**
 * Runs one wave against a fixed loadout and reports what it cost the wall.
 *
 * `wallHp` goes in and comes out; everything else is derived. The purge at the
 * end pays survivors out at the reduced rate, exactly as the engine does.
 */
export function hackerzSimulateWave(
    wave: number,
    loadout: HackerzLoadout,
    difficultyId: HackerzDifficultyId,
    wallHp: number
): HackerzSimWave {
    const difficulty = hackerzDifficulty(difficultyId)
    const hpMultiplier = hackerzHpMultiplier(wave) * difficulty.enemyHp
    const damageMultiplier = hackerzDamageMultiplier(wave) * difficulty.enemyDamage
    const bountyMultiplier = hackerzBountyMultiplier(wave)

    const composition = hackerzExpectedWave(wave, difficultyId)
    const queue: SimEnemy[] = []
    let index = 0
    const total = composition.reduce((sum, entry) => sum + entry.count, 0)
    for (const { def, count } of composition) {
        for (let i = 0; i < count; i++) {
            queue.push({
                def,
                hp: def.hp * hpMultiplier,
                x: 0,
                standoff: def.range ?? 30,
                attackTimer: 0,
                // Bosses walk in first; everything else spreads over the window.
                spawnAt: def.boss ? 900 : (total <= 1 ? 0 : (index / total) * HACKERZ_SPAWN_WINDOW_MS)
            })
            index++
        }
    }
    queue.sort((a, b) => a.spawnAt - b.spawnAt)

    const weaponDps = hackerzWeaponDps(loadout) * SIM_PLAYER_UPTIME
    const turretDps = hackerzTurretDps(loadout)
    const maxWallHp = loadout.wallMaxHp

    let shield = loadout.shieldMax
    let msSinceHit = 99_999
    let credits = 0
    let coins = 0
    let killed = 0
    let hp = wallHp
    let breached = false

    const alive: SimEnemy[] = []
    let released = 0

    const kill = (enemy: SimEnemy, payout: number) => {
        const bounty = enemy.def.bounty * bountyMultiplier
        credits += Math.round(bounty * payout)
        coins += Math.round(hackerzCoinValue(bounty, wave, difficulty, loadout.coinMultiplier) * payout)
        killed++
    }

    const takeDamage = (amount: number) => {
        let remaining = amount
        if (shield > 0) {
            const absorbed = Math.min(shield, remaining)
            shield -= absorbed
            remaining -= absorbed
        }
        msSinceHit = 0
        hp = Math.max(0, hp - remaining)
        if (hp <= 0) breached = true
    }

    for (let t = 0; t < HACKERZ_WAVE_MS && !breached; t += STEP_MS) {
        const dt = STEP_MS / 1000
        while (released < queue.length && (queue[released] as SimEnemy).spawnAt <= t) {
            alive.push(queue[released] as SimEnemy)
            released++
        }

        // Move, then attack. Threat order is distance travelled, so the model
        // focuses the same target a player would.
        for (const enemy of alive) {
            const stopX = FIELD_WIDTH - enemy.standoff
            if (enemy.x < stopX) {
                enemy.x = Math.min(stopX, enemy.x + enemy.def.speed * dt)
                continue
            }
            enemy.attackTimer -= STEP_MS
            if (enemy.attackTimer > 0) continue
            enemy.attackTimer = enemy.def.attackMs
            takeDamage(enemy.def.damage * damageMultiplier)
            if (enemy.def.kind === 'bomber') {
                enemy.hp = 0
                enemy.detonated = true
            }
        }
        alive.sort((a, b) => b.x - a.x)

        // The trap only touches ground units standing in the band.
        if (loadout.spikeDps > 0) {
            for (const enemy of alive) {
                if (hackerzIsAirborne(enemy.def)) continue
                if (enemy.x < FIELD_WIDTH - SPIKE_BAND) continue
                enemy.hp -= loadout.spikeDps * dt * hackerzTypeMultiplier('kinetic', enemy.def.armored)
            }
        }

        // Focus fire with overkill carrying to the next target, which is what a
        // high-DPS build actually does to a queue at the wall.
        const spread = spreadFactor(loadout, alive.length)
        let weaponBudget = weaponDps * spread * dt
        let turretBudget = turretDps * dt
        for (const enemy of alive) {
            if (enemy.hp <= 0) continue
            if (weaponBudget > 0) {
                const mult = hackerzTypeMultiplier(loadout.weapon.damageType, enemy.def.armored)
                const used = Math.min(weaponBudget * mult, enemy.hp)
                enemy.hp -= used
                weaponBudget -= used / mult
            }
            if (enemy.hp > 0 && turretBudget > 0) {
                // The turret mix is modelled as one pool; the type bonus is taken
                // as kinetic, which is what the mounts worth buying end up being.
                const mult = hackerzTypeMultiplier('kinetic', enemy.def.armored)
                const used = Math.min(turretBudget * mult, enemy.hp)
                enemy.hp -= used
                turretBudget -= used / mult
            }
            if (weaponBudget <= 0 && turretBudget <= 0) break
        }

        for (let i = alive.length - 1; i >= 0; i--) {
            const enemy = alive[i] as SimEnemy
            if (enemy.hp > 0) continue
            // A sapper that reached the wall died on its own charge and pays
            // nothing; anything else was shot down.
            if (!enemy.detonated) kill(enemy, 1)
            alive.splice(i, 1)
        }

        msSinceHit += STEP_MS
        if (loadout.repairPerSec > 0) hp = Math.min(maxWallHp, hp + loadout.repairPerSec * dt)
        if (shield < loadout.shieldMax && msSinceHit > 3000) {
            shield = Math.min(loadout.shieldMax, shield + loadout.shieldRegenPerSec * dt)
        }
    }

    // The purge takes whatever is left, at the reduced rate.
    const survivors = alive.length
    for (const enemy of alive) kill(enemy, 0.25)

    if (!breached) {
        credits += hackerzClearBonus(wave, maxWallHp > 0 ? hp / maxWallHp : 0)
    }

    return {
        wave,
        wallHp: hp,
        wallMaxHp: maxWallHp,
        hostiles: queue.length,
        kills: killed,
        survivors,
        credits,
        coins,
        dps: weaponDps + turretDps,
        breached
    }
}

/**
 * Spends a wave's credits the way a competent player would: keep the wall
 * standing, then keep the damage climbing. Used for the fresh-account curve —
 * a run that never buys anything says nothing about the game's pacing.
 */
const BUY_PRIORITY: HackerzUpgradeId[] = [
    'damage', 'turretPower', 'integrity', 'firerate', 'spire',
    'autoloader', 'crit', 'shield', 'repair', 'spikes', 'pulse', 'overclock'
]

function autoSpend(build: HackerzSimBuild, credits: number, nextWave: number) {
    let purse = credits
    const effects = hackerzMainframeEffects(build.mainframe)

    // Guns first — a weapon upgrade is worth more than any number of levels.
    for (let i = 4; i >= 1; i--) {
        const def = hackerzWeapon(['rail', 'flak', 'arc', 'missile', 'sniper'][i] as HackerzWeaponId)
        if (build.weapon === def.id) break
        if (nextWave < hackerzWeaponUnlockWave(def, effects.arsenal)) continue
        if (purse < def.cost) continue
        purse -= def.cost
        build.weapon = def.id
        break
    }

    // Then fill and upgrade the mounts.
    const best = [...['lance', 'warhead', 'needler', 'gun'] as HackerzTurretId[]]
        .find(id => nextWave >= hackerzTurret(id).unlockWave)
    if (best) {
        for (let slot = 0; slot < build.turrets.length; slot++) {
            const current = build.turrets[slot]
            if (current === best) continue
            const def = hackerzTurret(best)
            const refund = current ? Math.round(hackerzTurret(current).cost * 0.5) : 0
            if (purse + refund < def.cost) break
            purse += refund - def.cost
            build.turrets[slot] = best
        }
    }

    // Then levels, cheapest-first within the priority order, until broke.
    let bought = true
    while (bought) {
        bought = false
        for (const id of BUY_PRIORITY) {
            const def = hackerzUpgrade(id)
            const level = build.levels[id]
            if (level >= def.max) continue
            const cost = hackerzUpgradeCost(def, level)
            if (purse < cost) continue
            purse -= cost
            build.levels[id] = level + 1
            if (id === 'spire') {
                const slots = hackerzSlots(build.levels.spire, effects.startingMounts)
                build.turrets = Array.from({ length: slots }, (_, i) => build.turrets[i] ?? null)
            }
            bought = true
        }
    }
    return purse
}

export interface HackerzSimOptions {
    /** Spend the run's credits between waves instead of holding the build fixed. */
    autoUpgrade?: boolean
    /** Repair the wall to full between waves when it can be afforded. */
    repair?: boolean
}

export function hackerzSimulateRun(
    startBuild: HackerzSimBuild,
    difficultyId: HackerzDifficultyId,
    options: HackerzSimOptions = {}
): HackerzSimResult {
    const build: HackerzSimBuild = {
        levels: { ...startBuild.levels },
        mainframe: { ...startBuild.mainframe },
        weapon: startBuild.weapon,
        turrets: [...startBuild.turrets]
    }
    const effects = hackerzMainframeEffects(build.mainframe)
    let credits = effects.startingCredits
    let coins = 0
    const waves: HackerzSimWave[] = []

    const makeLoadout = () => hackerzLoadout({
        levels: build.levels,
        owned: [build.weapon],
        active: build.weapon,
        turrets: build.turrets
    }, build.mainframe, difficultyId)

    let hp = makeLoadout().wallMaxHp

    for (let wave = 1; wave <= HACKERZ_MAX_WAVE; wave++) {
        if (options.autoUpgrade) credits = autoSpend(build, credits, wave)
        const loadout = makeLoadout()
        // Buying Integrity mid-run is handed out as healing, matching the engine.
        hp = Math.min(loadout.wallMaxHp, hp)
        if (options.repair !== false && credits > 0) {
            const missing = loadout.wallMaxHp - hp
            const cost = Math.max(10, Math.round(missing * 0.3 / 5) * 5)
            if (missing > 4 && credits >= cost) {
                credits -= cost
                hp = loadout.wallMaxHp
            }
        }

        const result = hackerzSimulateWave(wave, loadout, difficultyId, hp)
        waves.push(result)
        coins += result.coins
        credits += result.credits
        hp = result.wallHp

        if (result.breached) return { endedWave: wave, victory: false, coins, waves }
    }

    return { endedWave: HACKERZ_MAX_WAVE, victory: true, coins, waves }
}
