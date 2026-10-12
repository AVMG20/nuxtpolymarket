/**
 * What the battle screen shows, projected forward from one server payload.
 *
 * Two functions, in order. `projectRun` walks the run forward from the last payload — kills,
 * stage, world, Gold, XP, level — and `battleReadout` turns the position it lands on into bars.
 * Everything on screen is a function of the one quantity `projectRun` accrues, so nothing on
 * screen can disagree with anything else on it.
 *
 * ## Why the client is allowed to do this at all
 *
 * `settle()` is the authority and this is not a second one. What makes the projection safe is
 * that it is the *same walk*, over the same pure helpers (`killsRequired`, `nextStage`,
 * `goldPerKill`, `xpPerKill`, `applyXp`, `offlineFarmStage`), against a rate the server handed
 * over. The next payload overwrites all of it. No projected number is ever sent back, and
 * nothing here decides anything — the server stays the authority.
 *
 * ## The one rate
 *
 * `secondsPerKill` and `killsBeforeWipe` come from the payload and are held for the whole
 * projection, including across a stage or world boundary. That is not an approximation the
 * client invented: `settle()` does exactly the same thing, deliberately ("offline holds one
 * rate… a window that carries the run into deeper stages fights all of them at the departure
 * stage's difficulty"). Holding them is what keeps the projection and the settle in agreement;
 * recomputing them would make the screen disagree with the server it is drawing.
 *
 * Position-only quantities are a different case and are **not** held — pack size, per-enemy HP
 * and pack HP depend on nothing but `RunPosition`, so `battleReadout`'s caller recomputes them
 * exactly from the projected position rather than showing World 3's HP total on World 4.
 *
 * Pure, and separate from the components, because the edge cases are worth pinning: a pack
 * rolling over, a party the server calls undying, a walled stage that restarts instead of
 * clearing, a boss gate that stops the walk, and a `secondsPerKill` of zero or null.
 */

import { D, ZERO, type Decimal } from '#shared/utils/hero-quest/numbers'
import {
    applyXp,
    goldPerKill,
    killsRequired,
    nextStage,
    offlineFarmStage,
    stageArchetype,
    walkWall,
    xpPerKill,
    xpToNextLevel
} from '#shared/utils/hero-quest/settle'

/**
 * The last thing the server said, and everything the walk needs to carry on from it.
 *
 * Every field is served as-is by `state.get.ts` — this holds no game math and derives no input
 * of its own.
 */
export interface RunAnchor {
    prestige: number
    world: number
    stage: number
    /** Server truth: kills banked into this stage attempt. */
    killCount: number
    /**
     * Server truth as well: the part-kill banked toward the next body, in `[0, 1)`.
     *
     * The settle carries this across windows, so the projection has to start from it too —
     * anchoring at the whole `killCount` alone would rewind the current enemy's HP bar by up
     * to one body every time a payload landed.
     */
    killFraction: number
    /** Server truth: wipe recovery still owed, in seconds, served before anything else. */
    recoverySeconds: number
    /** Held for the whole projection. `null` when the party cannot kill anything. */
    secondsPerKill: number | null
    /** Held likewise. `null` when the server calls the party undying. */
    killsBeforeWipe: number | null
    /** Already carries every passive and burst source, so nothing is stacked here. */
    goldBonusPct: number
    xpBonusPct: number
    heroLevel: number
    /** Decimal, as a string — XP passes `Number.MAX_SAFE_INTEGER` early. */
    heroXp: string
    /**
     * Account age in days as of the last settle, straight from the server.
     *
     * Held constant for the projection rather than advanced with the animation clock: the
     * server will price the next window off the same figure, so a client that crept it forward
     * would draw Gold the settle is about to refuse to pay.
     */
    tenureDays: number
}

export interface RunForecast {
    prestige: number
    world: number
    stage: number
    /**
     * Kills into the current stage attempt, **fractional**.
     *
     * `settle()` floors its kill budget because it is banking whole kills into a database. A
     * bar redrawn ten times a second is not, and flooring here would step the enemy bar in
     * whole bodies. The two disagree by less than one kill, and the next payload settles it.
     */
    killsInStage: number
    killsRequired: number
    atBossGate: boolean
    /** The stage restarts rather than clearing: `killsBeforeWipe` is under `killsRequired`. */
    walled: boolean
    /** Seconds the wiped party has left to recover before its next attempt; 0 when it is fighting. */
    recoverySeconds: number
    heroLevel: number
    heroXp: Decimal
    xpToNextLevel: Decimal
    /** 0–1, for the XP bar. */
    xpProgress: number
    /** Since the payload — the "you earned this while watching" figures. */
    goldEarned: number
    killsLanded: number
    levelsGained: number
}

/**
 * A run walking off the end of World 10 is a super boss, which the boss branch stops at, so the
 * loop cannot spin on `nextStage`'s fixed point. This guards the case anyway, because the loop
 * runs on a 100ms ticker in the browser rather than once per settle: a content edit that made
 * some stage requirement zero would otherwise hang the tab rather than fail a test.
 */
const MAX_STAGE_STEPS = 1000

function isBossStage(stage: number): boolean {
    const archetype = stageArchetype(stage)
    return archetype === 'boss' || archetype === 'super_boss'
}

/**
 * Walk the run forward by `elapsedSeconds` of presence.
 *
 * Deliberately the same branch order as `settle()`'s loop — boss gate, then wave wall, then
 * ordinary progress — because those three are what decide whether the run moves at all, and a
 * screen that advanced past a gate the server parks at would be lying about where the player is.
 */
export function projectRun(anchor: RunAnchor, elapsedSeconds: number): RunForecast {
    const spk = anchor.secondsPerKill
    const heroXp = D(anchor.heroXp)

    const prestige = anchor.prestige
    let world = anchor.world
    let stage = anchor.stage
    // The carried part-kill rides along with the whole ones, dropped outside `[0, 1)` on the
    // same rule `settle()` applies — the two have to land on the same body, and a payload is
    // not a thing to trust unchecked.
    const carry = anchor.killFraction
    const carried = Number.isFinite(carry) && carry > 0 && carry < 1 ? carry : 0
    let killsInStage = Math.max(0, anchor.killCount) + carried

    // A recovery the server says is owed is served first, as `settle()` serves it.
    const owed = Number.isFinite(anchor.recoverySeconds) && anchor.recoverySeconds > 0 ? anchor.recoverySeconds : 0
    const served = Math.min(owed, Math.max(0, elapsedSeconds))
    let recoverySeconds = owed - served
    let budget = spk !== null && spk > 0 && recoverySeconds <= 0 ? (Math.max(0, elapsedSeconds) - served) / spk : 0
    const goldMultiplier = 1 + anchor.goldBonusPct
    const xpMultiplier = D(1 + anchor.xpBonusPct)
    const wipeAt = anchor.killsBeforeWipe

    let gold = 0
    let xp = ZERO
    let landed = 0
    let atBossGate = isBossStage(stage)
    // recovery is only ever owed on a walled stage
    let walled = recoverySeconds > 0

    const earn = (kills: number, atWorld: number, atStage: number) => {
        gold += kills * goldPerKill(prestige, atWorld, atStage, anchor.tenureDays) * goldMultiplier
        xp = xp.add(xpPerKill(prestige, atWorld, atStage).mul(kills).mul(xpMultiplier))
        landed += kills
    }

    for (let step = 0; budget > 0 && step < MAX_STAGE_STEPS; step++) {
        if (isBossStage(stage)) {
            // The gate. Every remaining kill farms the preceding wave stage and position holds,
            // so the player lands *at* the boss with the fight still to engage.
            atBossGate = true
            const farm = offlineFarmStage({ prestige, world, stage, killsInStage })
            earn(budget, farm.world, farm.stage)
            budget = 0
            break
        }

        const required = killsRequired({ prestige, world, stage, killsInStage })

        if (wipeAt !== null && wipeAt < required) {
            // The party drops before the counter fills, so the attempt restarts from zero and
            // the stage can never clear at this power level, recovering after each wipe.
            walled = true
            const wall = walkWall(killsInStage, 0, budget * spk!, wipeAt, spk!)
            if (wall.kills > 0) earn(wall.kills, world, stage)
            killsInStage = wall.killsInStage
            recoverySeconds = wall.recoverySeconds
            budget = 0
            break
        }

        const applied = Math.min(budget, Math.max(0, required - killsInStage))
        if (applied <= 0) {
            ({ world, stage, killsInStage } = nextStage({ prestige, world, stage, killsInStage }))
            continue
        }

        earn(applied, world, stage)
        budget -= applied
        killsInStage += applied

        if (killsInStage >= required) {
            ({ world, stage, killsInStage } = nextStage({ prestige, world, stage, killsInStage }))
            atBossGate = isBossStage(stage)
        }
    }

    const levelled = applyXp(anchor.heroLevel, heroXp, xp)
    const needed = xpToNextLevel(levelled.level)

    return {
        prestige,
        world,
        stage,
        killsInStage,
        killsRequired: killsRequired({ prestige, world, stage, killsInStage }),
        atBossGate,
        walled,
        recoverySeconds,
        heroLevel: levelled.level,
        heroXp: levelled.xp,
        xpToNextLevel: needed,
        xpProgress: needed.lte(0) ? 0 : Math.min(1, levelled.xp.div(needed).toNumber()),
        goldEarned: gold,
        killsLanded: landed,
        levelsGained: levelled.level - anchor.heroLevel
    }
}

export interface BattleReadoutInput {
    /** Straight from `projectRun` — fractional, and already past any stage rollover. */
    killsInStage: number
    killsRequired: number
    /** Kills one attempt survives, or `null` when the server calls the party undying. */
    killsBeforeWipe: number | null
    /** For the projected position, not the payload's — bodies change with the stage. */
    packSize: number
    atBossGate: boolean
}

export interface BattleReadout {
    /** The integer the stage counter shows. */
    displayKills: number
    /** Stage bar, 0–100. */
    killProgress: number
    /** How far through the current pack, in [0, 1). */
    packProgress: number
    /** Bodies still up. Never 0 mid-encounter — the last dies as the pack rolls over. */
    enemiesStanding: number
    /** Enemy bar, 0–100, over the whole pack. */
    enemyHpPct: number
    /** Hero bar, 0–100. */
    heroHpPct: number
}

export function battleReadout(input: BattleReadoutInput): BattleReadout {
    const size = Math.max(0, Math.floor(input.packSize))
    const kills = Math.max(0, input.killsInStage)

    if (input.atBossGate) {
        // A boss is a fight, not a counter. Nothing here is being worn down over time, and a
        // mixed boss pack has no single body size to divide by, so the bars sit full.
        return {
            displayKills: Math.floor(kills),
            killProgress: input.killsRequired <= 0 ? 100 : 0,
            packProgress: 0,
            enemiesStanding: size,
            enemyHpPct: 100,
            heroHpPct: 100
        }
    }

    const displayKills = Math.floor(kills)
    const killProgress = input.killsRequired <= 0
        ? 100
        : Math.min(100, (displayKills / input.killsRequired) * 100)

    // A pack of identical bodies dies one at a time, so progress through it is the fractional
    // part of the kill count over the pack size.
    const packProgress = size <= 1 ? kills % 1 : (kills % size) / size
    const enemiesStanding = size <= 0 ? 0 : Math.max(1, size - Math.floor(kills % size))

    /**
     * HP is one pool across a whole stage attempt, so the fraction spent is kills over
     * `killsBeforeWipe`. On a walled stage `killsInStage` cycles as the attempt restarts, which
     * is what makes this bar sawtooth rather than pin at empty — the restart is the thing the
     * player needs to see happening.
     */
    const wipeAt = input.killsBeforeWipe
    const heroHpPct = wipeAt === null || wipeAt <= 0
        ? 100
        : Math.max(0, Math.min(100, (1 - kills / wipeAt) * 100))

    return {
        displayKills,
        killProgress,
        packProgress,
        enemiesStanding,
        enemyHpPct: Math.max(0, Math.min(100, (1 - packProgress) * 100)),
        heroHpPct
    }
}

export interface HeroHpInput extends BattleReadoutInput {
    /** Which stage attempt this is: a change of it starts the bar afresh. */
    attempt: string
}

/**
 * The Hero's HP share across one stage attempt: it never rises within one, and it still runs out
 * on exactly the kill the party wipes on.
 *
 * `battleReadout`'s share is kills over `killsBeforeWipe`, and a payload after level-ups raises
 * that budget, so drawn as-is the Hero heals once a minute. Here, when the budget changes
 * mid-attempt the bar carries on from where it stands and drains in a line to 0 at the new wipe
 * kill. A new attempt id, or kills falling back a whole kill or more (a walled stage restarting;
 * a payload's correction moves them by under one), fills it again from the readout.
 */
export class HeroHpGauge {
    private attempt = ''
    private kills = 0
    private shown = 100
    private anchor = { pct: 100, kills: 0, wipeAt: null as number | null }

    next(input: HeroHpInput): number {
        const kills = Math.max(0, input.killsInStage)
        const wipeAt = input.killsBeforeWipe
        if (input.attempt !== this.attempt || kills < this.kills - 1) {
            const pct = battleReadout(input).heroHpPct
            this.anchor = { pct, kills, wipeAt }
            this.shown = pct
        } else if (wipeAt !== this.anchor.wipeAt) {
            this.anchor = { pct: this.shown, kills, wipeAt }
        }
        const { pct: from, kills: at } = this.anchor
        const pct = input.atBossGate || wipeAt === null || wipeAt <= 0
            ? from
            : wipeAt <= at ? 0 : from * Math.max(0, wipeAt - kills) / (wipeAt - at)
        // a payload can pull kills back by part of one; that never shows as a heal
        this.shown = Math.min(this.shown, pct)
        this.attempt = input.attempt
        this.kills = kills
        return this.shown
    }
}
