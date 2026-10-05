/**
 * Seeded boss resolution (`tech-architecture.md` §4c).
 *
 * A boss cannot be lazily settled — offline never engages one — and cannot be resolved by
 * the client, because Gold and Void Shards are real balances. So the server runs this, and
 * hands the client the seed. The client then runs the *identical* function and animates the
 * exact authoritative fight, blow for blow. Divergence is impossible because it is the same
 * pure code on both sides; the client renders, it never decides.
 *
 * ## Rolled here, averaged in `settle`
 *
 * Wave farming is a *rate*, so `settle.ts` averages crit. A boss is a *fight*, so this rolls
 * it — real variance, still fully deterministic and replayable. That is a deliberate
 * asymmetry (`tech-architecture.md` §4c recommends it; `open-items.md` #3 records that it is
 * a recommendation rather than a lock).
 *
 * ## The randomness rule, and why a PRNG here is not a violation
 *
 * The platform forbids `Math.random()` for anything deciding an outcome, and forbids rolling
 * your own generator from `crypto.getRandomValues`. Neither applies: the entropy that
 * decides this fight is the **seed**, which the server draws with `randomInt` from
 * `#shared/utils/random` before calling in. Everything past that point must be reproducible
 * from the seed alone or the replay would not match, which is exactly what a CSPRNG cannot
 * give you. Same shape as `shared/utils/gamelogic/pathwarden-simulator.ts`.
 *
 * ## Skills
 *
 * Every skill auto-fires the instant its cooldown completes — there is no manual mode anywhere
 * in this game (`classes-and-combat.md` §3). **Every unit fires its own kit**: the Hero's is
 * cumulative down the class path plus equipped Skill Actives (`heroKit`), while a Champion
 * brings the 1–3 its rarity grants (`champions-guild-gacha.md` §2). Each ability's behaviour —
 * targeting, statuses, heals, shields — comes from its `AbilityEffect` (`effects.ts`).
 *
 * The wave rate sees these only as averages (`projection.ts`), so a boss fight and the idle rate
 * agree within the tolerance `projection.spec.ts` asserts, not exactly.
 *
 * Ability *count* is a real rarity payoff: a Mythic's three abilities out-damage a Common's one
 * on top of the ×2.5 stat multiplier — the intended shape, never balanced against it.
 */

import {
    BOSS_TIMER_SECONDS,
    FIGHT_TICK_SECONDS,
    MIN_DAMAGE,
    SKILL_STATUS_DURATION_SECONDS
} from './constants'
import {
    attackIntervalFor,
    attacksPerSecondFor,
    cooldownFor,
    partyMitigation,
    rawHitDamage,
    targetingOrder,
    wealthFactorFor
} from './combat'
import { columnOf, enemyPackAt, rowOf } from './settle'
import { partyUnitStats } from './stats'
import { heroKit } from './content/skills'
import {
    SINGLE_TARGET,
    executeMultiplier,
    isAllyTarget,
    resolveAllyTargets,
    resolveEnemyTargets
} from './effects'
import type { AbilityEffect } from './effects'
import {
    absorbDamage,
    applyStatus,
    canAutoattack,
    canCastAbilities,
    cleanse,
    extendHostile,
    hasStatus,
    reflectFraction,
    statMultiplier,
    tickStatuses
} from './status'
import type { StatusInstance } from './status'
import { ONE, ZERO, decMax } from './numbers'
import type { Decimal } from './numbers'
import type { ClassSkill, EnemyPack, EnemyStats, HeroSnapshot, RunPosition, UnitStats } from './types'

export type FightOutcome = 'win' | 'timeout' | 'wipe'

export type FightEventKind =
    | 'attack' | 'skill' | 'enemy_attack' | 'unit_down' | 'enemy_down'
    /**
     * Damage bounced back at an attacker. Its own kind rather than an `attack`, because nobody
     * cast anything and the client should not draw a swing for it.
     */
    | 'reflect'
    /** A reinforcement joins the fight (`Encounter.reinforcements`); it can be hit and swings from now on. */
    | 'enemy_arrive'
    /** A rampaging boss's gauge filled (`Encounter.rampage`): it is a level up, its gauge refilled to `remainingHp`. */
    | 'enemy_level'
    // Status-engine events.
    | 'heal' | 'shield' | 'status_applied' | 'status_expired' | 'status_tick'

/**
 * One thing that happened, at one moment. The replay log is nothing but these — the client
 * walks them in order against its own clock and never recomputes a number.
 *
 * Decimals are serialized as strings (`tech-architecture.md` §5): this crosses the wire, and
 * damage at depth is well past what JSON numbers hold.
 */
export interface FightEvent {
    /** Sim-seconds from the start of the fight. */
    at: number
    kind: FightEventKind
    /** Index into the party for unit-sourced events; absent for enemy-sourced ones. */
    unitIndex?: number
    /**
     * Which enemy the event concerns — the one struck, or the one that struck. Encounters hold
     * a boss plus its escort, so "the enemy" is no longer a single implied body.
     */
    enemyIndex?: number
    /** Skill that fired, for `kind: 'skill'`. */
    skillId?: string
    /** Status involved, for the status kinds. Its `id`, so the client can group stacks. */
    statusId?: string
    /** Whether the status event concerns an enemy rather than a party member. */
    onEnemy?: boolean
    /** Decimal as a string. */
    damage?: string
    crit?: boolean
    /** Remaining HP after the event, as a string. */
    remainingHp?: string
    /** The level reached, for `kind: 'enemy_level'`. */
    level?: number
}

export interface FightInput {
    hero: HeroSnapshot
    position: RunPosition
    seed: number
    /**
     * A fight against something other than the run's boss gate: a raid. Its own enemies, its own
     * round length, and `passive` for enemies that never swing (the Training Grounds dummy).
     * Absent, the fight is the gate at `position`, on `BOSS_TIMER_SECONDS`.
     */
    encounter?: Encounter
}

export interface Encounter {
    pack: EnemyPack
    seconds: number
    passive?: boolean
    reinforcements?: Reinforcements
    gauntlet?: Gauntlet
    rampage?: Rampage
}

/**
 * A boss that can't die (the `rampaging_boss` fight type, `raid-system.md` *Rampaging Boss*). Its
 * HP is a gauge: emptied, it goes a level up, refilled to `thresholdAt(level)` less the overkill,
 * and its stats become `statsAt(level)`. The pack's one member starts at level 1, its HP being
 * `thresholdAt(1)`. The fight only ends when the party falls, or at the encounter's seconds, which
 * are a guard rail rather than a clock.
 */
export interface Rampage {
    thresholdAt: (level: number) => Decimal
    statsAt: (level: number) => EnemyStats
}

/**
 * The pack fought one at a time, in order (the `boss_gauntlet` fight type): each member walks out
 * `handoff` seconds after the last falls, logged as an `enemy_arrive`, and every kill adds
 * `bonusSeconds` to the clock. The fight is won when the last is down.
 */
export interface Gauntlet {
    handoff: number
    bonusSeconds: number
}

/**
 * Adds that join a raid boss on a timer (the `reinforced_boss` fight type). There is one burrow per
 * member; every `every` seconds a wave fills each burrow whose last add is down, so no more than
 * `members.length` stand at once. The pack is still the fight: it is won when the pack is down,
 * whatever adds are left.
 *
 * Adds are logged ahead of the pack, wave by wave (wave w's add from burrow b is enemy
 * `w * members.length + b`), so they draw the party's focus off the boss as they arrive, and a
 * replay finds an add's burrow as its index modulo the burrow count.
 */
export interface Reinforcements {
    every: number
    members: readonly EnemyStats[]
}

export interface FightResult {
    outcome: FightOutcome
    /** When it ended. Equal to `BOSS_TIMER_SECONDS` on a timeout. */
    secondsElapsed: number
    events: FightEvent[]
    /**
     * HP left across the **whole encounter** — boss and escort together — 0 on a win.
     * String-encoded Decimal.
     */
    enemyHpRemaining: string
    enemyMaxHp: string
    /**
     * Each body's own starting HP, in encounter order (escort first, boss last).
     *
     * The client cannot derive this: a boss pack is *mixed*, so it cannot divide `enemyMaxHp`
     * by the count. Without it a replay cannot tell an untouched minion from a dead one, and
     * the HP bar jumps as focus moves between bodies.
     */
    enemyMaxHps: string[]
    /** Fraction of the encounter's HP removed, for a "so close" readout on a loss. */
    damageDealtPct: number
    seed: number
}

/**
 * mulberry32 — small, fast, and reproducible across every JS engine, which is the only
 * property that matters here. Not a CSPRNG and not used as one; see the header.
 */
function seededRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state += 0x6D2B79F5
        let value = state
        value = Math.imul(value ^ value >>> 15, value | 1)
        value ^= value + Math.imul(value ^ value >>> 7, value | 61)
        return ((value ^ value >>> 14) >>> 0) / 4294967296
    }
}

interface Combatant {
    stats: UnitStats
    hp: Decimal
    /** Sim-seconds until the next autoattack. */
    attackTimer: number
    /** `cooldownSeconds` is the base; each reset re-reads SPD, so Haste shortens the next cooldown. */
    skills: { id: string; cooldownSeconds: number; timer: number; multiplier: number; effect: AbilityEffect }[]
    /**
     * Live status effects. Mutable and separate from `stats`, which `stats.ts` builds once and
     * never rewrites — see the `status.ts` header for why that split exists.
     */
    statuses: StatusInstance[]
}

/** One enemy in the encounter. Bosses bring an escort, so there can be several. */
interface EnemyCombatant {
    stats: EnemyStats
    hp: Decimal
    attackTimer: number
    statuses: StatusInstance[]
    /** In the fight: false for a reinforcement until its wave comes, and for good if its burrow was full. */
    present: boolean
    /** A reinforcement, which the fight can be won without. */
    add: boolean
    /** A rampaging boss's level; 0 for every other body. */
    level: number
}

/**
 * Resolve a boss or super-boss fight.
 *
 * Bounded work by construction: `BOSS_TIMER_SECONDS / FIGHT_TICK_SECONDS` iterations, fixed,
 * whatever the party's strength or the run's depth. Battle Speed never enters here — the
 * server always computes the full sim-second outcome, and a boost only changes how fast the
 * client plays the log back (`tech-architecture.md` §4b).
 */
export function runFight(input: FightInput): FightResult {
    const random = seededRandom(input.seed)
    const pack = input.encounter?.pack ?? enemyPackAt(input.position)
    const roundSeconds = input.encounter?.seconds ?? BOSS_TIMER_SECONDS
    const passive = input.encounter?.passive ?? false
    const gauntlet = input.encounter?.gauntlet
    const units = partyUnitStats(input.hero)

    /**
     * One kit per unit, in the order `partyUnitStats` builds the party: the Hero's kit first,
     * then each fielded Champion's own abilities. Mirrors `projection.armedParty`.
     */
    const kits: readonly (readonly ClassSkill[])[] = [
        heroKit(input.hero),
        ...(input.hero.champions ?? []).map(champion => champion.abilities)
    ]

    /**
     * The Gambler's Strike family's bounded modulation, resolved once for the whole fight.
     *
     * Once, not per cast, because banked Gold does not move during a 30-second boss fight — the
     * player is not farming while the gate resolves.
     */
    const wealth = wealthFactorFor(input.hero.wealthHours)

    const party: Combatant[] = units.map((stats, index) => ({
        stats,
        hp: stats.maxHp,
        attackTimer: 0,
        statuses: [],
        // Every unit fires its own kit. Cooldowns are shortened by that unit's own SPD — so a
        // Control Champion cycles its abilities faster than a Tank standing next to it — and by
        // its `cooldownFactor`, which carries Artifacts' Tempo lines.
        skills: (kits[index] ?? []).map((entry) => {
            const effect = entry.effect ?? SINGLE_TARGET
            return {
                id: entry.id,
                cooldownSeconds: entry.cooldownSeconds,
                // Nothing carries a status at t=0, so the base stats are the live ones here.
                timer: cooldownFor(entry.cooldownSeconds, stats.cooldownSpd, stats.cooldownFactor),
                multiplier: entry.abilityMultiplier * (effect.wealthScaled ? wealth : 1),
                effect
            }
        })
    }))

    /**
     * Who the enemy hits next: front row first, back row only once the front is empty or dead,
     * and within the eligible row whoever carries the most threat.
     *
     * Recomputed per swing rather than fixed once, because **taunt is a status** — a Tank that
     * taunts mid-fight has to start pulling immediately, and one whose taunt expires has to stop.
     *
     * Shares `targetingOrder` with `settle.ts` so the projection and the fight can never
     * disagree about who is soaking.
     */
    const chooseDefender = (): Combatant | undefined => {
        const living = party.filter(unit => unit.hp.gt(0))
        if (living.length === 0) return undefined
        const taunting = living.filter(unit => hasStatus(unit.statuses, 'taunt'))
        // A taunt only outranks row eligibility among units already eligible, per §8.4 — so
        // it is applied to whichever row the enemy can currently reach, not across both.
        const pool = taunting.length > 0 ? taunting : living
        const front = pool.filter(unit => unit.stats.row === 'front')
        const eligible = front.length > 0 ? front : pool
        const ordered = targetingOrder(eligible.map(unit => unit.stats))
        return eligible.find(unit => unit.stats === ordered[0])
    }

    /**
     * The enemy side, in the order the party works through it: escort first, boss last (see
     * `enemyPackAt`). Each keeps its own HP and its own attack timer, so a three-body boss
     * encounter is three attack streams until the adds go down.
     */
    const reinforcements = input.encounter?.reinforcements
    const burrows = reinforcements?.members.length ?? 0
    const waves = reinforcements && burrows > 0 ? Math.floor((roundSeconds - 1e-9) / reinforcements.every) : 0
    const enemies: EnemyCombatant[] = [
        ...Array.from({ length: waves * burrows }, (_, k) => ({ stats: reinforcements!.members[k % burrows]!, add: true, present: false })),
        ...pack.members.map((stats, k) => ({ stats, add: false, present: !gauntlet || k === 0 }))
    ].map(foe => ({ ...foe, hp: foe.stats.hp, attackTimer: attackIntervalFor(0), statuses: [], level: 0 }))
    const rampage = input.encounter?.rampage
    if (rampage) {
        const beast = enemies[enemies.length - 1]!
        beast.level = 1
        beast.stats = { ...rampage.statsAt(1), hp: rampage.thresholdAt(1) }
        beast.hp = beast.stats.hp
    }
    let wavesIn = 0
    // the gauntlet's next boss walks out at this time; the clock grows with each kill
    let nextOut = Number.POSITIVE_INFINITY
    let deadline = roundSeconds

    const events: FightEvent[] = []
    const enemyMaxHps = enemies.map(foe => foe.stats.hp)

    /** A rampaging boss whose gauge a hit emptied goes up as many levels as the overkill fills, logged once. */
    const rampageUp = (foe: EnemyCombatant) => {
        if (!rampage || foe.level === 0 || foe.hp.gt(0)) return
        while (foe.hp.lte(0)) {
            foe.level++
            foe.hp = foe.hp.add(rampage.thresholdAt(foe.level))
        }
        foe.stats = { ...rampage.statsAt(foe.level), hp: rampage.thresholdAt(foe.level) }
        events.push({ at: elapsed, kind: 'enemy_level', enemyIndex: enemies.indexOf(foe), level: foe.level, remainingHp: foe.hp.toString() })
    }
    let elapsed = 0

    const livingEnemies = () => enemies.filter(foe => foe.present && foe.hp.gt(0))
    // the pack is the fight: adds left standing when it falls don't hold the win back
    const packDown = () => enemies.every(foe => foe.add || foe.hp.lte(0))
    const enemyHpLeft = () => enemies.reduce((total, foe) => foe.add ? total : total.add(decMaxZero(foe.hp)), ZERO)
    const packMaxHps = enemies.flatMap(foe => foe.add ? [] : [foe.stats.hp])

    /**
     * Mitigation is resolved from the party's *summed* PWR against **the current target's**
     * DEF — pooled on the party side, never on the enemy side (`classes-and-combat.md` §7).
     * Recomputed per target rather than once, because a boss and its escort have different
     * DEF and pooling theirs would make each of them individually harder to hurt.
     *
     * Both sides go through their live statuses: an Empowered unit adds its buffed PWR to the
     * pool, and a Shatter Armor on the target lowers the DEF the pool is divided against.
     */
    const penetrationAgainst = (foe: EnemyCombatant) => ONE.sub(partyMitigation(
        party.map(member => liveUnitStats(member.stats, member.statuses)),
        liveEnemyStats(foe.stats, foe.statuses).def
    ))

    /**
     * Advance one combatant's statuses, applying periodic damage and healing and logging what
     * expired. Runs before anyone acts, so a burn that kills finishes the body before it gets
     * another swing — and so an expiring stun frees its bearer on the tick it runs out.
     *
     * Healing never exceeds max HP, and a `dot` can kill: both are what make DoT and HoT worth
     * the same currency as a direct hit.
     */
    const advanceStatuses = (
        holder: { hp: Decimal; statuses: StatusInstance[] },
        maxHp: Decimal,
        indexes: { unitIndex?: number; enemyIndex?: number; onEnemy: boolean }
    ) => {
        if (holder.statuses.length === 0) return
        const { damage, healing, expired } = tickStatuses(holder.statuses, FIGHT_TICK_SECONDS)

        if (damage.gt(0)) {
            holder.hp = holder.hp.sub(damage)
            events.push({
                at: elapsed,
                kind: 'status_tick',
                ...indexes,
                damage: damage.toString(),
                remainingHp: decMaxZero(holder.hp).toString()
            })
        }
        if (healing.gt(0) && holder.hp.gt(0)) {
            const before = holder.hp
            holder.hp = holder.hp.add(healing).gt(maxHp) ? maxHp : holder.hp.add(healing)
            events.push({
                at: elapsed,
                kind: 'heal',
                ...indexes,
                damage: holder.hp.sub(before).toString(),
                remainingHp: holder.hp.toString()
            })
        }
        for (const status of expired) {
            events.push({ at: elapsed, kind: 'status_expired', ...indexes, statusId: status.id })
        }
    }

    // re-read each tick: a gauntlet kill moves the deadline out
    for (let tick = 0; tick < Math.ceil(deadline / FIGHT_TICK_SECONDS); tick++) {
        elapsed = Math.min(deadline, (tick + 1) * FIGHT_TICK_SECONDS)

        if (gauntlet) {
            const current = enemies.findIndex(foe => !foe.add && foe.present && foe.hp.gt(0))
            const next = enemies.findIndex(foe => !foe.add && !foe.present)
            if (current < 0 && next >= 0) {
                // the last one fell: time comes back for it, and the next sets out
                if (nextOut === Number.POSITIVE_INFINITY) {
                    nextOut = elapsed + gauntlet.handoff
                    deadline += gauntlet.bonusSeconds
                }
                if (elapsed >= nextOut - 1e-9) {
                    enemies[next]!.present = true
                    nextOut = Number.POSITIVE_INFINITY
                    events.push({ at: elapsed, kind: 'enemy_arrive', enemyIndex: next })
                }
            }
        }

        // a wave comes up into each burrow standing empty
        if (wavesIn < waves && elapsed >= (wavesIn + 1) * reinforcements!.every) {
            for (let b = 0; b < burrows; b++) {
                const occupied = enemies.some((foe, at) => foe.add && foe.present && foe.hp.gt(0) && at % burrows === b)
                if (occupied) continue
                const index = wavesIn * burrows + b
                enemies[index]!.present = true
                events.push({ at: elapsed, kind: 'enemy_arrive', enemyIndex: index })
            }
            wavesIn++
        }

        for (const [index, unit] of party.entries()) {
            if (unit.hp.gt(0)) advanceStatuses(unit, unit.stats.maxHp, { unitIndex: index, onEnemy: false })
            if (unit.hp.lte(0) && !events.some(e => e.kind === 'unit_down' && e.unitIndex === index)) {
                events.push({ at: elapsed, kind: 'unit_down', unitIndex: index, remainingHp: '0' })
            }
        }
        for (const [index, foe] of enemies.entries()) {
            if (!foe.present) continue
            if (foe.hp.gt(0)) advanceStatuses(foe, foe.stats.hp, { enemyIndex: index, onEnemy: true })
            rampageUp(foe)
            if (foe.hp.lte(0) && !events.some(e => e.kind === 'enemy_down' && e.enemyIndex === index)) {
                events.push({ at: elapsed, kind: 'enemy_down', enemyIndex: index, remainingHp: '0' })
            }
        }

        if (packDown()) {
            return result('win', elapsed, events, ZERO, enemyMaxHps, packMaxHps, input.seed)
        }
        if (party.every(unit => unit.hp.lte(0))) {
            return result('wipe', elapsed, events, enemyHpLeft(), enemyMaxHps, packMaxHps, input.seed)
        }

        for (const [index, unit] of party.entries()) {
            if (unit.hp.lte(0)) continue

            /**
             * Resolve one ability — or one autoattack, which is the same thing with the
             * default single-target effect.
             *
             * Targeting comes from the ability, not the caster: `champions-guild-gacha.md`
             * §8.3 requires exactly that, and says it "will apply often, not as a rare
             * exception". The focus anchor is the front-most living enemy, the same body a
             * plain swing would hit; patterns spread out from there.
             *
             * Returns false only when there is nothing left to act on, so the caller can stop
             * a multi-strike loop swinging at an empty board.
             */
            const cast = (multiplier: number, effect: AbilityEffect, skillId?: string): boolean => {
                const living = enemies.flatMap((foe, at) => foe.present && foe.hp.gt(0) ? [at] : [])
                if (living.length === 0) return false

                const statusFrom = (spec: NonNullable<AbilityEffect['status']>) => ({
                    id: skillId ?? 'autoattack',
                    kind: spec.kind,
                    ...(spec.stat === undefined ? {} : { stat: spec.stat }),
                    duration: spec.duration,
                    magnitude: spec.scalesWithPwr
                        ? unit.stats.pwr.mul(spec.magnitude ?? 0)
                        : (spec.magnitude ?? 0),
                    ...(spec.stacks === undefined ? {} : { stacks: spec.stacks })
                })

                /**
                 * The caster's own half, under its own instance id. Enrage lands both halves on the
                 * Berserker — a PWR buff via `selfStatus` and a DEF debuff via `status` — and under
                 * one shared id `applyStatus` would merge the second into the first as a refresh,
                 * leaving a single double-stacked debuff and no buff. The event still names the
                 * ability, which is what the replay feed shows.
                 */
                const landSelfStatus = () => {
                    if (!effect.selfStatus) return
                    applyStatus(unit.statuses, {
                        ...statusFrom(effect.selfStatus),
                        id: `${skillId ?? 'autoattack'}_self`
                    })
                    events.push({
                        at: elapsed, kind: 'status_applied', unitIndex: index,
                        statusId: skillId ?? 'autoattack'
                    })
                }

                /**
                 * Every ability that fires shows up as a `skill` event, even a pure-utility one
                 * that deals no damage — Haste, Enrage, Totem Storm. Without this a replay
                 * would show a buff appearing with nothing having cast it, and "did this
                 * ability fire" would be unanswerable from the log.
                 *
                 * Damage-dealing abilities log per target instead, so this only fills the gap.
                 */
                let dealtDamage = false
                const noteUtilityCast = () => {
                    if (dealtDamage || skillId === undefined) return
                    events.push({
                        at: elapsed, kind: 'skill', unitIndex: index, skillId, damage: '0'
                    })
                }

                if (isAllyTarget(effect.target)) {
                    const roster = party.map(member => ({
                        alive: member.hp.gt(0),
                        hpFraction: member.stats.maxHp.lte(0)
                            ? 0
                            : member.hp.div(member.stats.maxHp).toNumber(),
                        power: member.stats.pwr.toNumber()
                    }))
                    const allies = resolveAllyTargets(effect.target, index, roster, Boolean(effect.revive))

                    for (const allyIndex of allies) {
                        const ally = party[allyIndex]!
                        if (effect.revive && ally.hp.lte(0)) {
                            ally.hp = ally.stats.maxHp.mul(effect.revive)
                            events.push({
                                at: elapsed, kind: 'heal', unitIndex: allyIndex,
                                ...(skillId === undefined ? {} : { skillId }),
                                damage: ally.hp.toString(),
                                remainingHp: ally.hp.toString()
                            })
                        }
                        if (effect.cleanse) {
                            for (const removed of cleanse(ally.statuses)) {
                                events.push({
                                    at: elapsed, kind: 'status_expired',
                                    unitIndex: allyIndex, statusId: removed.id
                                })
                            }
                        }
                        if (effect.heal) {
                            const before = ally.hp
                            const healed = ally.hp.add(unit.stats.pwr.mul(effect.heal))
                            ally.hp = healed.gt(ally.stats.maxHp) ? ally.stats.maxHp : healed
                            events.push({
                                at: elapsed, kind: 'heal', unitIndex: allyIndex,
                                ...(skillId === undefined ? {} : { skillId }),
                                damage: ally.hp.sub(before).toString(),
                                remainingHp: ally.hp.toString()
                            })
                        }
                        if (effect.shield) {
                            applyStatus(ally.statuses, {
                                id: `${skillId ?? 'shield'}_shield`,
                                kind: 'shield',
                                duration: effect.status?.duration ?? SKILL_STATUS_DURATION_SECONDS,
                                magnitude: unit.stats.pwr.mul(effect.shield)
                            })
                            events.push({
                                at: elapsed, kind: 'shield', unitIndex: allyIndex,
                                damage: unit.stats.pwr.mul(effect.shield).toString()
                            })
                        }
                        if (effect.status) {
                            applyStatus(ally.statuses, statusFrom(effect.status))
                            events.push({
                                at: elapsed, kind: 'status_applied', unitIndex: allyIndex,
                                statusId: skillId ?? 'autoattack'
                            })
                        }
                    }
                    landSelfStatus()
                    noteUtilityCast()
                    return true
                }

                const targets = resolveEnemyTargets(
                    effect.target, living[0]!, living, enemies.length, { columnOf, rowOf }
                )

                for (const foeIndex of targets) {
                    const foe = enemies[foeIndex]!
                    if (multiplier > 0) {
                        // Split into `hits` separate rolls — same total, but each rolls its own
                        // crit, which is what makes a barrage worth more to a high-crit build.
                        const hits = Math.max(1, Math.floor(effect.hits ?? 1))
                        for (let hit = 0; hit < hits; hit++) {
                            const hpFraction = foe.stats.hp.lte(0)
                                ? 0
                                : decMaxZero(foe.hp).div(foe.stats.hp).toNumber()
                            const scaled = (multiplier / hits) * executeMultiplier(effect, hpFraction)
                            const { damage, crit } = rollDamage(
                                liveUnitStats(unit.stats, unit.statuses),
                                penetrationAgainst(foe), scaled, random, effect
                            )
                            foe.hp = foe.hp.sub(damage)
                            dealtDamage = true
                            events.push({
                                at: elapsed,
                                kind: skillId === undefined ? 'attack' : 'skill',
                                unitIndex: index,
                                enemyIndex: foeIndex,
                                ...(skillId === undefined ? {} : { skillId }),
                                damage: damage.toString(),
                                crit,
                                remainingHp: decMaxZero(foe.hp).toString()
                            })
                            rampageUp(foe)
                            if (foe.hp.lte(0)) break
                        }
                    }
                    if (effect.extendDebuffs) {
                        extendHostile(foe.statuses, effect.extendDebuffs)
                    }
                    if (effect.status) {
                        const id = skillId ?? 'autoattack'
                        applyStatus(foe.statuses, statusFrom(effect.status))
                        events.push({
                            at: elapsed, kind: 'status_applied', enemyIndex: foeIndex,
                            onEnemy: true, statusId: id
                        })

                        // Frostbind's freeze: a second effect that lands once the stacking
                        // debuff has built far enough. Checked against the stacks actually on
                        // the target after this application, so it fires on whichever cast
                        // crosses the line rather than on a fixed cast number.
                        const built = foe.statuses.find(status => status.id === id)
                        if (effect.escalation && built && built.stacks >= effect.escalation.atStacks) {
                            const escalationId = `${id}_escalation`
                            applyStatus(foe.statuses, {
                                ...statusFrom(effect.escalation.status),
                                id: escalationId
                            })
                            events.push({
                                at: elapsed, kind: 'status_applied', enemyIndex: foeIndex,
                                onEnemy: true, statusId: escalationId
                            })
                        }
                    }
                    if (foe.hp.lte(0)) {
                        events.push({
                            at: elapsed, kind: 'enemy_down', enemyIndex: foeIndex, remainingHp: '0'
                        })
                    }
                }
                landSelfStatus()
                noteUtilityCast()
                return true
            }

            const strike = (multiplier: number, skillId?: string) =>
                cast(multiplier, SINGLE_TARGET, skillId)

            unit.attackTimer -= FIGHT_TICK_SECONDS
            if (unit.attackTimer <= 0) {
                // The next interval is read off live SPD, so a Haste landing mid-fight speeds up
                // the swing after this one.
                unit.attackTimer += attackIntervalFor(liveUnitStats(unit.stats, unit.statuses).spd)
                // A stun stops the swing but the timer still ran — the attack is lost, not
                // banked, which is what makes hard control worth more than a slow.
                if (canAutoattack(unit.statuses)) {
                    // Multi-strike kits need no special case; each strike rolls its own crit,
                    // per §7. Overkill rolls onto the next body rather than being wasted.
                    for (let hit = 0; hit < unit.stats.strikesPerAttack; hit++) {
                        if (!strike(1)) break
                    }
                }
            }
            if (packDown() || livingEnemies().length === 0) break

            // Silence stops abilities while leaving autoattacks alone; stun stops both.
            // Cooldowns keep running underneath either, so control delays a kit rather than
            // erasing it — the difference the two ability rosters draw between them.
            const silenced = !canCastAbilities(unit.statuses)
            for (const skill of unit.skills) {
                skill.timer -= FIGHT_TICK_SECONDS
                if (skill.timer > 0) continue
                skill.timer += cooldownFor(
                    skill.cooldownSeconds,
                    liveUnitStats(unit.stats, unit.statuses).cooldownSpd,
                    unit.stats.cooldownFactor
                )
                if (silenced) continue
                if (!cast(skill.multiplier, skill.effect, skill.id)) break
            }
            if (packDown() || livingEnemies().length === 0) break
        }

        if (packDown()) {
            return result('win', elapsed, events, ZERO, enemyMaxHps, packMaxHps, input.seed)
        }

        // Every living enemy strikes the front row, reaching the back row only once the front
        // is empty or dead (`classes-and-combat.md` §6). Same rule the wave-survivability
        // projection applies, so the boss fight and the idle rate can never disagree about who
        // is taking the hits — and an escort is genuinely extra incoming damage, not flavour.
        // a passive enemy (the Training Grounds dummy) never swings
        for (const foe of passive ? [] : enemies) {
            if (!foe.present || foe.hp.lte(0)) continue
            foe.attackTimer -= FIGHT_TICK_SECONDS
            if (foe.attackTimer > 0) continue
            foe.attackTimer += attackIntervalFor(0)
            if (!canAutoattack(foe.statuses)) continue

            const target = chooseDefender()
            if (!target) break
            const targetIndex = party.indexOf(target)
            // Through the shared helper rather than re-deriving the formula here, so the
            // enemy's swing picks up the MIN_DAMAGE floor exactly as the party's does. Live
            // stats on both sides: Weaken lowers the attacker's PWR, Bulwark Stance raises the
            // defender's DEF, and Enrage's penalty lowers the Berserker's own.
            const raw = rawHitDamage(
                liveEnemyStats(foe.stats, foe.statuses).pwr,
                liveUnitStats(target.stats, target.statuses).def
            )
            // Shields eat what mitigation left, never the raw hit — see `absorbDamage`.
            const { throughput, absorbed, broken } = absorbDamage(target.statuses, raw)
            target.hp = target.hp.sub(throughput)

            if (absorbed.gt(0)) {
                events.push({
                    at: elapsed,
                    kind: 'shield',
                    unitIndex: targetIndex,
                    enemyIndex: enemies.indexOf(foe),
                    damage: absorbed.toString()
                })
            }
            events.push({
                at: elapsed,
                kind: 'enemy_attack',
                unitIndex: targetIndex,
                enemyIndex: enemies.indexOf(foe),
                damage: throughput.toString(),
                remainingHp: decMaxZero(target.hp).toString()
            })

            /**
             * Reflect — the fraction a defender bounces back at whoever hit it.
             *
             * Two sources, summed: the timed `reflect` status (Guardian's Reflect) and the passive
             * `reflectFraction` on the unit's stat block (Immortal Vanguard). Computed off
             * `throughput` — what actually landed — so a hit a shield ate reflects nothing.
             */
            const reflected = reflectFraction(target.statuses)
                .add(target.stats.reflectFraction)
                .mul(throughput)
            if (reflected.gt(0)) {
                foe.hp = foe.hp.sub(reflected)
                events.push({
                    at: elapsed,
                    kind: 'reflect',
                    unitIndex: targetIndex,
                    enemyIndex: enemies.indexOf(foe),
                    damage: reflected.toString(),
                    remainingHp: decMaxZero(foe.hp).toString()
                })
                rampageUp(foe)
                if (foe.hp.lte(0)) {
                    events.push({
                        at: elapsed, kind: 'enemy_down',
                        enemyIndex: enemies.indexOf(foe), remainingHp: '0'
                    })
                }
            }
            for (const shield of broken) {
                events.push({
                    at: elapsed,
                    kind: 'status_expired',
                    unitIndex: targetIndex,
                    statusId: shield.id
                })
            }
            if (target.hp.lte(0)) {
                events.push({ at: elapsed, kind: 'unit_down', unitIndex: targetIndex, remainingHp: '0' })
            }
        }

        if (party.every(unit => unit.hp.lte(0))) {
            return result('wipe', elapsed, events, enemyHpLeft(), enemyMaxHps, packMaxHps, input.seed)
        }
    }

    return result('timeout', deadline, events, enemyHpLeft(), enemyMaxHps, packMaxHps, input.seed)
}

/**
 * A party member's stats with its live `buff` / `debuff` statuses applied.
 *
 * `UnitStats` is built once by `stats.ts` and never rewritten, so statuses resolve here at the
 * point of use (see the `status.ts` header). Only the stats combat reads per action move: PWR
 * (damage dealt, pooled penetration), DEF (mitigation) and SPD (attack interval, cooldowns).
 *
 * Heal, shield and DoT magnitudes stay on the caster's base PWR — a buff to *damage output* is
 * not a buff to healing, and `projection.ts` prices sustain off base PWR the same way.
 */
function liveUnitStats(stats: UnitStats, statuses: readonly StatusInstance[]): UnitStats {
    if (statuses.length === 0) return stats
    const spd = stats.spd.mul(statMultiplier(statuses, 'spd'))
    return {
        ...stats,
        pwr: stats.pwr.mul(statMultiplier(statuses, 'pwr')),
        def: stats.def.mul(statMultiplier(statuses, 'def')),
        cooldownSpd: stats.cooldownSpd.mul(statMultiplier(statuses, 'spd')),
        spd,
        attacksPerSecond: attacksPerSecondFor(spd)
    }
}

/**
 * An enemy's stats with its live statuses applied — PWR and DEF, the two an enemy is read on.
 *
 * ⚠ Enemies attack at SPD 0 (`attackIntervalFor(0)`), so a SPD debuff has nothing to multiply:
 * the slow half of Slow, Chain Bind and Frostbind is inert, though Frostbind's freeze still lands.
 * `projection.ts` ignores enemy SPD debuffs for the same reason.
 */
function liveEnemyStats(stats: EnemyStats, statuses: readonly StatusInstance[]): EnemyStats {
    if (statuses.length === 0) return stats
    return {
        ...stats,
        pwr: stats.pwr.mul(statMultiplier(statuses, 'pwr')),
        def: stats.def.mul(statMultiplier(statuses, 'def'))
    }
}

/** Crit rolled per strike, not averaged — the one place in the game that does. */
function rollDamage(
    unit: UnitStats,
    penetration: Decimal,
    abilityMultiplier: number,
    random: () => number,
    effect?: AbilityEffect
): { damage: Decimal; crit: boolean } {
    if (unit.pwr.lte(0)) return { damage: ZERO, crit: false }
    // `alwaysCrits` skips the roll rather than forcing the chance to 1, so it consumes no
    // entropy — the replay stays reproducible whatever a Kill Shot lands on.
    const crit = effect?.alwaysCrits === true || random() < unit.critChance
    // Floored before crit, mirroring `combat.rawHitDamage`: a fully-mitigated hit lands for
    // MIN_DAMAGE, and a fully-mitigated *crit* for MIN_DAMAGE × critMultiplier.
    const base = decMax(MIN_DAMAGE, unit.pwr.mul(penetration).mul(abilityMultiplier))
    if (!crit) return { damage: base, crit }
    // Kill Shot's "double crit damage" multiplies the crit itself, not the base hit — so it
    // compounds with IMP investment rather than replacing it.
    const critFactor = unit.critMultiplier.mul(effect?.critDamageMultiplier ?? 1)
    return { damage: base.mul(critFactor), crit }
}

function decMaxZero(value: Decimal): Decimal {
    return value.lt(0) ? ZERO : value
}

function result(
    outcome: FightOutcome,
    secondsElapsed: number,
    events: FightEvent[],
    enemyHpRemaining: Decimal,
    enemyMaxHps: readonly Decimal[],
    /** The pack's own, which the totals are over: reinforcements are logged, not counted. */
    packMaxHps: readonly Decimal[],
    seed: number
): FightResult {
    const enemyMaxHp = packMaxHps.reduce((total, hp) => total.add(hp), ZERO)
    const remaining = decMaxZero(enemyHpRemaining)
    const dealt = enemyMaxHp.lte(0) ? 1 : ONE.sub(remaining.div(enemyMaxHp)).toNumber()
    return {
        outcome,
        secondsElapsed,
        events,
        enemyHpRemaining: remaining.toString(),
        enemyMaxHp: enemyMaxHp.toString(),
        enemyMaxHps: enemyMaxHps.map(hp => hp.toString()),
        damageDealtPct: Math.min(1, Math.max(0, dealt)),
        seed
    }
}
