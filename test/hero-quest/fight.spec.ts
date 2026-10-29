import { describe, expect, it } from 'vitest'
import { runFight } from '#shared/utils/hero-quest/fight'
import {
    BOSS_STAGE,
    BOSS_TIMER_SECONDS,
    ENRAGE_PWR_BONUS,
    FIGHT_TICK_SECONDS,
    HASTE_SPD_BONUS,
    MIN_DAMAGE,
    SUPER_BOSS_STAGE
} from '#shared/utils/hero-quest/constants'
import { attackIntervalFor } from '#shared/utils/hero-quest/combat'
import { bossMinionStats, enemyStatsAt } from '#shared/utils/hero-quest/settle'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { D, ZERO } from '#shared/utils/hero-quest/numbers'
import { ASCENDANT_ID, MASTER_IDS, getClass, kitFor } from '#shared/utils/hero-quest/content/classes'
import {
    RARITY_STAT_MULTIPLIER,
    getChampion,
    type ChampionDefinition
} from '#shared/utils/hero-quest/content/champions'
import type { ChampionSnapshot, ClassId, HeroSnapshot, RunPosition } from '#shared/utils/hero-quest/types'

function hero(heroLevel: number, classId: ClassId = 'class_beginner'): HeroSnapshot {
    return { classId, heroLevel, heroXp: ZERO, goldBonusPct: 0, offlineEfficiencyLevel: 0, offlineCapLevel: 0 }
}

function at(world: number, stage: number, prestige = 0): RunPosition {
    return { prestige, world, stage, killsInStage: 0 }
}

/**
 * A fielded Champion, built from real roster content so the ability shapes under test are
 * the ones the game actually ships rather than fixtures that can drift from them.
 *
 * Back row by default: the Warrior line the Hero fixtures use defaults to the front, so the
 * Hero soaks the boss and the Champion survives long enough to be measured.
 */
function snapshotOf(definition: ChampionDefinition, overrides: Partial<ChampionSnapshot> = {}): ChampionSnapshot {
    return {
        championId: definition.id,
        archetype: definition.archetype,
        rarityMultiplier: RARITY_STAT_MULTIPLIER[definition.rarity],
        investment: 1,
        strikesPerAttack: definition.strikesPerAttack,
        row: 'back',
        abilities: definition.abilities,
        ...overrides
    }
}

function withParty(base: HeroSnapshot, champions: ChampionSnapshot[]): HeroSnapshot {
    return { ...base, champions }
}

describe('hero-quest seeded fights', () => {
    describe('determinism — the whole point of the replay model', () => {
        it('produces an identical outcome and log for the same seed', () => {
            const input = { hero: hero(40), position: at(1, BOSS_STAGE), seed: 123456 }
            const first = runFight(input)
            const second = runFight(input)

            expect(second.outcome).toBe(first.outcome)
            expect(second.secondsElapsed).toBe(first.secondsElapsed)
            expect(second.enemyHpRemaining).toBe(first.enemyHpRemaining)
            expect(second.events).toEqual(first.events)
        })

        it('diverges on a different seed, so crit is genuinely rolled', () => {
            const base = { hero: hero(40), position: at(1, BOSS_STAGE) }
            const logs = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => runFight({ ...base, seed })
                .events.filter(event => event.kind === 'attack').map(event => event.crit).join(''))

            // Averaged crit would make every seed identical; rolled crit must not.
            expect(new Set(logs).size).toBeGreaterThan(1)
        })
    })

    describe('outcomes', () => {
        it('wins when the party out-damages the boss inside the timer', () => {
            const result = runFight({ hero: hero(200), position: at(1, BOSS_STAGE), seed: 7 })
            expect(result.outcome).toBe('win')
            expect(result.enemyHpRemaining).toBe('0')
            expect(result.damageDealtPct).toBe(1)
            expect(result.secondsElapsed).toBeLessThanOrEqual(BOSS_TIMER_SECONDS)
            expect(result.events.at(-1)!.kind).toBe('enemy_down')
        })

        it('wipes when the boss kills the party first', () => {
            const result = runFight({ hero: hero(1), position: at(6, SUPER_BOSS_STAGE), seed: 7 })
            expect(result.outcome).toBe('wipe')
            expect(result.secondsElapsed).toBeLessThan(BOSS_TIMER_SECONDS)
            expect(result.events.some(event => event.kind === 'unit_down')).toBe(true)
        })

        it('never reports negative enemy HP after an overkill', () => {
            const result = runFight({ hero: hero(500), position: at(1, BOSS_STAGE), seed: 7 })
            expect(D(result.enemyHpRemaining).gte(0)).toBe(true)
            for (const event of result.events) {
                if (event.remainingHp) expect(D(event.remainingHp).gte(0)).toBe(true)
            }
        })
    })

    describe('the minimum-damage floor', () => {
        // Deep enough that enemy DEF is far past the party's PWR × K clamp.
        const hopeless = (seed: number) => runFight({ hero: hero(1), position: at(8, SUPER_BOSS_STAGE), seed })

        it('still chips for MIN_DAMAGE once enemy DEF passes the PWR × K threshold', () => {
            // Swept across seeds rather than pinned to one: a hopeless fight is short, so any
            // single seed may happen to crit every swing, and a crit multiplies *up* from the
            // floor. Over a dozen seeds at least one plain hit lands on it exactly.
            const hits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
                .flatMap(seed => hopeless(seed).events)
                .filter(event => event.kind === 'attack' || event.kind === 'skill')
                .map(event => D(event.damage!))

            expect(hits.length).toBeGreaterThan(0)
            // Never zero — that hard stall is exactly what MIN_DAMAGE replaced.
            for (const damage of hits) expect(damage.gte(MIN_DAMAGE), damage.toString()).toBe(true)

            const smallest = hits.reduce((low, damage) => damage.lt(low) ? damage : low)
            expect(smallest.toNumber()).toBe(MIN_DAMAGE)
        })

        it('still ends, never past the boss timer, when neither side can meaningfully hurt the other', () => {
            const result = hopeless(7)
            expect(['timeout', 'wipe']).toContain(result.outcome)
            expect(result.secondsElapsed).toBeLessThanOrEqual(BOSS_TIMER_SECONDS)
        })
    })

    describe('effects, resolved in a real fight', () => {
        /**
         * Long enough that every class's first cast lands. Cooldowns ignore the level curve and
         * deeper classes wait longest, so a fixture that ends in a few seconds proves nothing
         * about effects — no kit ever gets to fire.
         *
         * Two opposite failure modes bound it: too strong and the party fells a body before the
         * first AoE volley resolves, too weak and it dies before casting at all. A *deep*
         * encounter satisfies both — the enemy pool is large enough that nothing dies early and
         * the party's own pool has grown into it. If this breaks, re-scan for the level band
         * where every spec below holds and take its middle rather than nudging.
         */
        const position = at(3, SUPER_BOSS_STAGE)
        // Bosses stand alone now, so the board an AoE or a pierce needs is built here: the old
        // escort of two trash minions in front, the boss behind, on the boss's own timer.
        const board = {
            pack: { members: [bossMinionStats(position), bossMinionStats(position), enemyStatsAt(position)] },
            seconds: BOSS_TIMER_SECONDS
        }
        const fight = (classId: ClassId, level = 93) =>
            runFight({ hero: hero(level, classId), position, seed: 7, encounter: board })

        it('lands an AoE on every living body at once', () => {
            // Marksman's Arrow Rain hits every spot; the board holds three.
            const result = fight('class_marksman')
            const rain = result.events.filter(event => event.skillId === 'skill_arrow_rain')
            const firstVolley = rain.filter(event => event.at === rain[0]!.at)

            expect(new Set(firstVolley.map(event => event.enemyIndex)).size).toBe(board.pack.members.length)
        })

        it('always crits with Kill Shot, and harder than a normal crit', () => {
            const result = fight('class_hunter')
            const killShots = result.events.filter(event => event.skillId === 'skill_kill_shot')
            expect(killShots.length).toBeGreaterThan(0)
            expect(killShots.every(event => event.crit === true)).toBe(true)

            // Against the same body, a Kill Shot must beat this unit's ordinary crit — that is
            // the whole of "double crit damage".
            const ordinaryCrit = result.events.find(event =>
                event.kind === 'attack' && event.crit === true)
            if (ordinaryCrit) {
                expect(D(killShots[0]!.damage!).gt(D(ordinaryCrit.damage!))).toBe(true)
            }
        })

        it('heals the party with an ally-targeted ability', () => {
            // Paladin's Disciple tends the party rather than striking anything.
            const result = fight('class_paladin')
            expect(result.events.some(event => event.kind === 'heal')).toBe(true)
        })

        it('burns a target down over time from Meteor Shower', () => {
            const result = fight('class_sorcerer')
            expect(result.events.some(event =>
                event.kind === 'status_applied' && event.statusId === 'skill_meteor_shower')).toBe(true)
            expect(result.events.some(event => event.kind === 'status_tick')).toBe(true)
        })

        it('stays deterministic with effects in play', () => {
            const input = { hero: hero(60, 'class_sorcerer'), position: at(4, SUPER_BOSS_STAGE), seed: 4242 }
            expect(runFight(input).events).toEqual(runFight(input).events)
        })
    })

    describe('champion kits', () => {
        const kaira = getChampion('champ_kaira')

        /**
         * A boss tanky enough that every kit gets to cycle before the fight resolves.
         *
         * Deliberately not a quick win. A Mythic's abilities sit five ranks up the cooldown
         * ladder, so a short fight ends before they come round and a three-ability Mythic reads
         * as fewer — a property of the fixture rather than of the kit. At this depth the Hero's
         * four skills and a Mythic's three all come off cooldown at least once.
         *
         * Taken from the middle of the longest *contiguous* level band where every Berserker
         * skill and every Kaira ability fires. Contiguity is the part worth
         * measuring: casts batch onto the tick grid, so a viable level can sit next to a dead
         * one, and a min–max reading of a sparse set picks a middle that does not work. Re-scan
         * rather than nudge.
         */
        const deepFight = (champions: ChampionSnapshot[]) => runFight({
            hero: withParty(hero(399, 'class_berserker'), champions),
            position: at(10, SUPER_BOSS_STAGE),
            seed: 7
        })

        it('fires a fielded Champion\'s own abilities alongside every skill the Hero\'s class path owns', () => {
            const result = deepFight([snapshotOf(kaira)])
            const fired = new Set(result.events.filter(event => event.kind === 'skill').map(event => event.skillId))

            for (const ability of kaira.abilities) {
                expect(fired.has(ability.id), ability.id).toBe(true)
            }
            // The Hero's kit must not have been displaced by the Champion's.
            for (const skill of kitFor('class_berserker')) {
                expect(fired.has(skill.id), skill.id).toBe(true)
            }
        })
    })

    describe('multi-strike', () => {
        it('folds Hunter\'s triple strike into one attack instant', () => {
            const result = runFight({ hero: hero(60, 'class_hunter'), position: at(5, BOSS_STAGE), seed: 7 })
            const firstInstant = result.events.find(event => event.kind === 'attack')!.at
            const strikes = result.events.filter(event => event.kind === 'attack' && event.at === firstInstant)
            expect(strikes).toHaveLength(3)
        })
    })

    /**
     * `buff` and `debuff` statuses have to move the stats combat reads, not just sit in the
     * registry. Each spec compares the same kind of event either side of the first cast, so the
     * change can only come from the status.
     *
     * Shallow gates on purpose: the Hero's SPD is far from the attack-rate cap and its hits are
     * well clear of `MIN_DAMAGE`, so neither ceiling can hide the effect.
     */
    describe('live buffs and debuffs', () => {
        const firstCast = (events: readonly { skillId?: string; kind: string; at: number }[], id: string) =>
            events.find(event => event.skillId === id && event.kind === 'skill')?.at

        it('shortens the swing interval once Haste is up', () => {
            const result = runFight({ hero: hero(1), position: at(1, BOSS_STAGE), seed: 7 })
            const haste = firstCast(result.events, 'skill_haste')!
            // Two strikes per swing share a timestamp; one entry per swing.
            const swings = [...new Set(result.events
                .filter(event => event.kind === 'attack' && event.unitIndex === 0)
                .map(event => event.at))]

            const beforeGap = swings[1]! - swings[0]!
            const after = swings.findIndex(at => at >= haste)
            const afterGap = swings[after + 1]! - swings[after]!

            const spd = partyUnitStats(hero(1))[0]!.spd.toNumber()
            expect(beforeGap).toBeCloseTo(attackIntervalFor(spd), 0)
            // The swing after Haste lands schedules its successor off doubled SPD. One tick of
            // slack, since timers resolve on the fight grid.
            expect(afterGap).toBeLessThanOrEqual(attackIntervalFor(spd * (1 + HASTE_SPD_BONUS)) + FIGHT_TICK_SECONDS)
            expect(afterGap).toBeLessThan(beforeGap)
        })

        it('multiplies the Berserker\'s hits once Enrage is up — both halves land', () => {
            // Enrage puts a PWR buff *and* a DEF debuff on the Berserker. They must stay two
            // statuses: merged under one id, the buff would vanish into a double-stacked debuff.
            const result = runFight({ hero: hero(60, 'class_berserker'), position: at(4, BOSS_STAGE), seed: 7 })
            const enrage = firstCast(result.events, 'skill_enrage')!
            const plain = result.events.filter(event =>
                event.kind === 'attack' && event.unitIndex === 0 && event.crit === false)

            const before = plain.filter(event => event.at < enrage).at(-1)!
            const after = plain.find(event => event.at > enrage && event.enemyIndex === before.enemyIndex)!

            // At least the buff: pooled penetration rises with the buffed PWR too.
            const ratio = D(after.damage!).div(D(before.damage!)).toNumber()
            expect(ratio).toBeGreaterThanOrEqual(1 + ENRAGE_PWR_BONUS - 1e-9)
        })
    })
})

describe('hero-quest Ascendant in a fight', () => {
    it('fires Convergence as every master skill on one tick, inside the boss timer', () => {
        const ascendant: HeroSnapshot = { ...hero(20, ASCENDANT_ID), ascendantSkillIds: ['skill_haste', 'skill_kill_shot'] }
        // a World deeper than its picks' test: at the capstone's PWR a World 2 boss falls mid-volley
        const result = runFight({ hero: ascendant, position: at(3, 5), seed: 7 })
        const masterSkills = new Set(MASTER_IDS.map(id => getClass(id).skill.id))
        const casts = result.events.filter(event => event.unitIndex === 0 && event.skillId !== undefined && masterSkills.has(event.skillId))
        const first = Math.min(...casts.map(event => event.at))
        expect(first).toBeLessThan(BOSS_TIMER_SECONDS)
        expect(new Set(casts.filter(event => event.at === first).map(event => event.skillId))).toEqual(masterSkills)
    })

    it('fires its picks alongside', () => {
        const ascendant: HeroSnapshot = { ...hero(20, ASCENDANT_ID), ascendantSkillIds: ['skill_kill_shot'] }
        const result = runFight({ hero: ascendant, position: at(2, 5), seed: 7 })
        expect(result.events.some(event => event.unitIndex === 0 && event.skillId === 'skill_kill_shot')).toBe(true)
    })
})
