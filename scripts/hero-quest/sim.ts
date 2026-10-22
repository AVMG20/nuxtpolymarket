/**
 * Combat analysis for Hero Quest.
 *
 * Every number here comes out of the shared pure functions — the same `combat.ts` and
 * `settle.ts` the game itself runs. No formula is restated locally, so a result that looks
 * wrong here is wrong in the game too.
 *
 * Crit-averaged, matching how offline settle resolves (`idle-mechanics.md` §4). There is no
 * per-hit rolling and therefore no variance or win-rate: a verdict here means "wins on
 * expected values", not "wins 60% of the time". Rolled fights are `fight.ts`.
 *
 * Importable directly if you'd rather write your own scratch analysis:
 *
 *     import { analyzeStage, analyzeWorld, minLevelForGate } from './scripts/hero-quest/sim'
 */

import {
    ASCENDANT_KIT_SIZE,
    BASE_ARTIFACT_SLOTS,
    BASE_SKILL_SLOTS,
    BOSS_TIMER_SECONDS,
    LEVELS_PER_STAR,
    MAX_CHAMPION_SLOTS,
    MAX_STAR,
    STAGES_PER_WORLD,
    TRAIT_SLOT_COUNT,
    WIPE_RECOVERY_SECONDS,
    WORLD_COUNT
} from '../../shared/utils/hero-quest/constants'
import {
    applyXp,
    enemyStatsAt,
    goldPerKill,
    incomingDps,
    killsRequired,
    packDps,
    packSize,
    rateAt,
    secondsToDie,
    stageArchetype,
    totalXpForLevel,
    xpPerKill
} from '../../shared/utils/hero-quest/settle'
import { partyAbilityDps } from '../../shared/utils/hero-quest/projection'
import { runFight } from '../../shared/utils/hero-quest/fight'
import { ASCENDANT_ID, ASCENDANT_PICKABLE, CLASS_NODES, MASTER_IDS, classPath, getClass, isDescendantOf } from '../../shared/utils/hero-quest/content/classes'
import { shopTrackCost, voidShardsFor } from '../../shared/utils/hero-quest/content/shop'
import { CHAMPIONS, CHAMPION_ABILITY_POOL, ability, getArchetype } from '../../shared/utils/hero-quest/content/champions'
import { GEAR_SLOTS, gearIdFor } from '../../shared/utils/hero-quest/content/gear'
import { skillsOfRarity } from '../../shared/utils/hero-quest/content/skills'
import { ARTIFACTS } from '../../shared/utils/hero-quest/content/artifacts'
import { RARITIES, RARITY_STAT_MULTIPLIER, investmentScalar } from '../../shared/utils/hero-quest/gacha'
import { ZERO } from '../../shared/utils/hero-quest/numbers'
import type { Decimal } from '../../shared/utils/hero-quest/numbers'
import type { ChampionArchetype, ClassId, HeroSnapshot, OwnedCopy, Rarity, StageArchetype, TraitRoll } from '../../shared/utils/hero-quest/types'
import { TRAIT_GRADES, TRAIT_SETS, TRAIT_STATS, isTraitGrade } from '../../shared/utils/hero-quest/content/traits'
import { rollTrait } from '../../shared/utils/hero-quest/traits'
import { PASSIVE_NODES } from '../../shared/utils/hero-quest/content/passive-tree'
import { passiveBuyBlock, passiveLevelCost, passiveNodeActive, passivePointsEarned } from '../../shared/utils/hero-quest/passive-tree'
import { FEATURE_UNLOCKS } from '../../shared/utils/hero-quest/constants'
import { checkpointReached } from '../../shared/utils/hero-quest/tutorials'

export type Verdict = 'clear' | 'timer_fail' | 'wipe' | 'stalled'

export interface StageReport {
    world: number
    stage: number
    archetype: StageArchetype
    isGate: boolean
    level: number

    /** Per enemy, not per pack — `packSize` says how many of them stand together. */
    enemyHp: Decimal
    packSize: number
    enemyPwr: Decimal
    enemyDef: Decimal

    partyDps: Decimal
    secondsPerKill: number
    killsRequired: number
    clearSeconds: number

    /** Only set on boss stages. `timerMargin` is a fraction: +0.2 means 20% of slack left. */
    timerSeconds: number | null
    timerMargin: number | null

    incomingDps: Decimal
    heroEhp: Decimal
    secondsToDie: number
    /** Seconds the party must survive uninterrupted — the whole stage attempt, boss or wave. */
    survivalWindow: number
    /** secondsToDie / survivalWindow. Below 1 is a wipe; 2 means twice the HP needed. */
    survivalRatio: number

    verdict: Verdict
    goldPerKill: number
}

/** mulberry32, so a `roll:N` board is the same board on every run. */
function seeded(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * A Trait board for the sim to field (`traits.md`), from `--traits`:
 *
 * - `none`: no Traits, the walk as it was tuned.
 * - a grade (`E`, `A`, ...): ATK, SPD, HP, Champion ATK and Hero Skill DMG, all at that grade, one
 *   slot of each Set, so every Set that opens at one piece is live and none is stacked.
 * - `roll:N`: one real Roll with seed N, what a player's first Roll hands them.
 * - a board written out, one `stat:grade:set` per slot, comma-separated, with the `trait_` and
 *   `set_` prefixes dropped: `atk:B:deep_impact,imp:B:deep_impact,champion_atk:D:aggression`.
 */
export function simTraitBoard(spec: string): TraitRoll[] {
    if (spec === 'none' || spec === '') return []
    if (isTraitGrade(spec)) {
        return TRAIT_STATS.slice(0, TRAIT_SETS.length).map((stat, i) => ({ stat: stat.id, grade: spec, set: TRAIT_SETS[i]!.id }))
    }
    const seed = /^roll:(\d+)$/.exec(spec)
    if (seed) {
        const rng = seeded(Number(seed[1]))
        return TRAIT_SETS.map(() => rollTrait(rng))
    }
    if (spec.includes(':')) {
        const slots = spec.split(',').map((slot) => {
            const [stat, grade, set] = slot.split(':')
            const statDef = TRAIT_STATS.find(candidate => candidate.id === `trait_${stat}`)
            const setDef = TRAIT_SETS.find(candidate => candidate.id === `set_${set}`)
            if (!statDef || !grade || !isTraitGrade(grade) || !setDef) {
                throw new Error(`--traits slot "${slot}" is not stat:grade:set (stats ${TRAIT_STATS.map(s => s.id.slice(6)).join(' ')}; sets ${TRAIT_SETS.map(s => s.id.slice(4)).join(' ')})`)
            }
            return { stat: statDef.id, grade, set: setDef.id }
        })
        if (slots.length > TRAIT_SLOT_COUNT) throw new Error(`--traits has ${slots.length} slots, the board holds ${TRAIT_SLOT_COUNT}`)
        return slots
    }
    throw new Error(`--traits takes none, a grade (${TRAIT_GRADES.join(' ')}), roll:N or stat:grade:set slots, not "${spec}"`)
}

/**
 * How the sim spends the Passive Skill Tree's points (`passive-skill-tree.md`), from `--tree`:
 *
 * - `none`: no tree, the walk as it was tuned.
 * - `cheapest`: every point spent as soon as it is earned, on the cheapest next level the tree
 *   opens, ties to the tree's order. A neutral stand-in for a player, not an optimal build. It
 *   skips what the walk cannot see: economy nodes (its XP and Gold never read Hero modifiers),
 *   class-path nodes off the Hero's path, and side nodes for an archetype the party doesn't field.
 *
 * Points come from Hero level, so the tree is filled in wherever the sim fields a Hero
 * (`withSimTree`), and every level the walk gains grows it.
 */
export type SimTreePolicy = 'none' | 'cheapest'

let treePolicy: SimTreePolicy = 'none'

export function setSimTreePolicy(spec: string): SimTreePolicy {
    if (spec !== 'none' && spec !== 'cheapest') throw new Error(`--tree takes none or cheapest, not "${spec}"`)
    treePolicy = spec
    return spec
}

/**
 * The order `cheapest` buys levels in, per class and fielded archetypes. Buying cheapest-first
 * means a smaller budget always stops on a prefix of the same order, so one list serves every
 * level, extended as the walk earns more.
 */
const treePurchases = new Map<string, { id: string, spent: number }[]>()

function simTree(hero: HeroSnapshot, points: number): Record<string, number> {
    const fielded = new Set((hero.champions ?? []).map(champion => champion.archetype))
    const key = `${hero.classId}|${[...fielded].sort().join(',')}`
    const purchases = treePurchases.get(key) ?? []
    treePurchases.set(key, purchases)
    const levels: Record<string, number> = {}
    for (const { id } of purchases) levels[id] = (levels[id] ?? 0) + 1
    const useful = PASSIVE_NODES.filter(node =>
        node.lines.some(line => line.band !== 'economy')
        && passiveNodeActive(node, hero.classId)
        && (node.scope.kind === 'hero' || node.scope.archetype === 'all' || fielded.has(node.scope.archetype)))
    while ((purchases[purchases.length - 1]?.spent ?? 0) < points) {
        let next: { id: string, cost: number } | null = null
        for (const node of useful) {
            if (passiveBuyBlock(node, Number.MAX_SAFE_INTEGER, levels) !== null) continue
            const cost = passiveLevelCost(node, (levels[node.id] ?? 0) + 1)
            if (!next || cost < next.cost) next = { id: node.id, cost }
        }
        if (!next) break
        levels[next.id] = (levels[next.id] ?? 0) + 1
        purchases.push({ id: next.id, spent: (purchases[purchases.length - 1]?.spent ?? 0) + next.cost })
    }
    const held: Record<string, number> = {}
    for (const { id, spent } of purchases) {
        if (spent > points) break
        held[id] = (held[id] ?? 0) + 1
    }
    return held
}

/**
 * Seeded fights per boss gate, from `--boss-fights`. At 0 (the default) a gate takes the
 * expected-value verdict like every other stage. Above it, a gate is fought the way the live game
 * fights one, `runFight` with seeds 1…N, so boss specials, rolled crits and the real timer all
 * count, and it clears when at least half the fights are won: a lost boss waits to be challenged
 * again, so a coin-flip gate is one a player gets through. Waves and elites stay expected-value,
 * as settle resolves them.
 */
let bossFightSeeds = 0

export function setSimBossFights(seeds: number): number {
    if (!Number.isInteger(seeds) || seeds < 0) throw new Error(`--boss-fights takes a whole number of seeds, not "${seeds}"`)
    bossFightSeeds = seeds
    return seeds
}

/** Where `--kit` measures a Skill or Artifact pick: a late first-run stage, at a level that reaches it. */
const KIT_REFERENCE = { level: 200, world: 5, stage: 9 }

/**
 * A kit for the sim to field from the start, from `--kit`: every gacha at one rarity and
 * investment, written `rarity[:star[:level]]` (`rare`, `epic:2:5`). What a player owns at a given
 * point of a run hangs on Seal income, which is unreconciled (#23), so this fields a fixed kit the
 * way `--traits` fields a fixed board:
 *
 * - Gear: one piece in every slot.
 * - Champions: the stand-ins swapped for real Champions of that rarity, in the same archetype order.
 * - Skills and Artifacts: `slots` of each (the starting slots unless the walk has bought more), each
 *   filled with whichever item of that rarity clears `KIT_REFERENCE` fastest given what is already
 *   picked. The picks are cached per class, party and slot count, since the walk asks every stage.
 *
 * The rarity can be a mix, `epic*2+legendary`, which each gacha spreads over its own slots in the
 * same proportions (`apportionKit`), so a mix sets the rarity scale and never a slot count.
 *
 * The collections hold only what is equipped, so the collection passives are understated.
 */
export function withSimKit(
    hero: HeroSnapshot,
    spec: string,
    slots: { skills: number, artifacts: number } = { skills: BASE_SKILL_SLOTS, artifacts: BASE_ARTIFACT_SLOTS }
): HeroSnapshot {
    if (spec === 'none' || spec === '') return hero
    const [mixText = '', starText = '0', levelText = '1'] = spec.split(':')
    const mix = parseKitMix(mixText)
    const star = Number(starText)
    const level = Number(levelText)
    if (!Number.isInteger(star) || star < 0 || star > MAX_STAR || !Number.isInteger(level) || level < 1 || level > LEVELS_PER_STAR) {
        throw new Error(`--kit takes rarity[:star[:level]] (${RARITIES.join(' ')}; star 0–${MAX_STAR}; level 1–${LEVELS_PER_STAR}), not "${spec}"`)
    }
    const copy = (contentId: string): OwnedCopy => ({ contentId, star, level })

    const used = new Set<string>()
    const championRarities = apportionKit(mix, hero.champions?.length ?? 0)
    const champions = (hero.champions ?? []).map((standIn, i) => {
        const r = championRarities[i]!
        const definition = CHAMPIONS.find(c => c.archetype === standIn.archetype && c.rarity === r && !used.has(c.id))
            ?? CHAMPIONS.find(c => c.rarity === r && !used.has(c.id))!
        used.add(definition.id)
        return {
            championId: definition.id,
            archetype: definition.archetype,
            rarityMultiplier: RARITY_STAT_MULTIPLIER[r],
            investment: investmentScalar(star, level),
            strikesPerAttack: definition.strikesPerAttack,
            row: getArchetype(definition.archetype).defaultRow,
            abilities: definition.abilities
        }
    })
    const gearRarities = apportionKit(mix, GEAR_SLOTS.length)
    const gear = GEAR_SLOTS.map((slot, i) => copy(gearIdFor(slot, gearRarities[i]!)))
    let kitted: HeroSnapshot = {
        ...hero,
        champions,
        ownedChampions: champions.map(c => ({ archetype: c.archetype, investment: c.investment })),
        ownedGear: gear,
        equippedGear: Object.fromEntries(GEAR_SLOTS.map((slot, i) => [slot, gear[i]!.contentId])),
        equippedSkills: [],
        ownedSkills: [],
        equippedArtifacts: [],
        ownedArtifacts: []
    }

    const key = [spec, hero.classId, ...(hero.ascendantSkillIds ?? []), ...champions.map(c => c.championId), slots.skills, slots.artifacts].join('|')
    const cached = kitPicks.get(key)
    if (cached) {
        const skills = cached.skills.map(copy)
        const artifacts = cached.artifacts.map(copy)
        return { ...kitted, equippedSkills: skills, ownedSkills: skills, equippedArtifacts: artifacts, ownedArtifacts: artifacts }
    }

    const clearRate = (candidate: HeroSnapshot) => analyzeStage({ ...candidate, heroLevel: KIT_REFERENCE.level },
        0, KIT_REFERENCE.world, KIT_REFERENCE.stage, SIM_MATURE_TENURE_DAYS).secondsPerKill
    const fill = (idsOf: (r: Rarity) => readonly string[], slots: number, field: 'Skills' | 'Artifacts') => {
        for (const r of apportionKit(mix, slots)) {
            let best: { hero: HeroSnapshot, seconds: number } | null = null
            for (const id of idsOf(r)) {
                const equipped = kitted[`equipped${field}`] ?? []
                if (equipped.some(c => c.contentId === id)) continue
                const next = [...equipped, copy(id)]
                const candidate = { ...kitted, [`equipped${field}`]: next, [`owned${field}`]: next }
                const seconds = clearRate(candidate)
                if (!best || seconds < best.seconds) best = { hero: candidate, seconds }
            }
            if (best) kitted = best.hero
        }
    }
    fill(r => skillsOfRarity(r).map(s => s.id), slots.skills, 'Skills')
    fill(r => ARTIFACTS.filter(a => a.rarity === r).map(a => a.id), slots.artifacts, 'Artifacts')
    kitPicks.set(key, {
        skills: (kitted.equippedSkills ?? []).map(c => c.contentId),
        artifacts: (kitted.equippedArtifacts ?? []).map(c => c.contentId)
    })
    return kitted
}

/**
 * The Champions a run fields, by prestige, for `--kit-ladder` (the user's call, 2026-10-22): two Rare
 * on the first run, two Epic, two Epic and a Legendary, an Epic, two Legendary and a Mythic, then every slot Mythic.
 */
export const SIM_KIT_LADDER: readonly string[] = ['rare*2', 'epic*2', 'epic*2+legendary', 'epic+legendary*2+mythic', `mythic*${MAX_CHAMPION_SLOTS}`]

/** A kit's rarity mix, `epic*2+legendary`: one entry per unit, as `--kit` and `--kit-ladder` write it. */
export function parseKitMix(text: string): Rarity[] {
    return text.split('+').flatMap((part) => {
        const [rarity, countText = '1'] = part.split('*')
        const count = Number(countText)
        if (!RARITIES.includes(rarity as Rarity) || !Number.isInteger(count) || count < 1) {
            throw new Error(`a kit rarity is rarity[*count], joined with + (${RARITIES.join(' ')}), not "${text}"`)
        }
        return Array.from({ length: count }, () => rarity as Rarity)
    })
}

/**
 * Spreads a rarity mix over `slots` in its proportions, highest rarity first, by largest remainder.
 * A tie goes to the lower rarity, so a mix never fields more of its best rarity than its share.
 */
export function apportionKit(mix: readonly Rarity[], slots: number): Rarity[] {
    const rarities = RARITIES.filter(r => mix.includes(r))
    const quotas = rarities.map(r => slots * mix.filter(m => m === r).length / mix.length)
    const counts = quotas.map(Math.floor)
    const byRemainder = rarities.map((_r, i) => i).sort((a, b) => (quotas[b]! - counts[b]!) - (quotas[a]! - counts[a]!) || a - b)
    for (let left = slots - counts.reduce((sum, n) => sum + n, 0), k = 0; left > 0; left--, k++) counts[byRemainder[k]!]!++
    return rarities.flatMap((r, i) => Array.from({ length: counts[i]! }, () => r)).reverse()
}

const kitPicks = new Map<string, { skills: string[], artifacts: string[] }>()

/**
 * Whether the walk opens Traits and the Passive Tree on their `FEATURE_UNLOCKS` schedule (`--unlocks`)
 * rather than fielding them from the first stage. Off, every report reads as it was tuned.
 */
let unlockSchedule = false

export function setSimUnlocks(on: boolean): boolean {
    unlockSchedule = on
    return on
}

function featureOpen(feature: 'traits' | 'tree', prestige: number, world: number): boolean {
    const at = FEATURE_UNLOCKS.find(u => u.feature === feature)!.at
    return checkpointReached(at, { prestige, world, stage: 1, runCleared: false, bossLost: false, partyFallen: true })
}

/**
 * The party as the run's position fields it under `--unlocks`: no Trait board before Traits open,
 * no tree before the tree does. A tree that opens has every point banked so far to spend.
 */
export function withSimUnlocks(hero: HeroSnapshot, prestige: number, world: number): HeroSnapshot {
    if (!unlockSchedule) return withSimTree(hero)
    const traitsOpen = featureOpen('traits', prestige, world)
    const treeOpen = featureOpen('tree', prestige, world)
    const fielded = traitsOpen ? hero : { ...hero, traits: [] }
    return treeOpen ? withSimTree(fielded) : { ...fielded, passiveTree: {} }
}

/** The Hero with its tree filled in from its level under the `--tree` policy; unchanged under `none`. */
export function withSimTree(hero: HeroSnapshot): HeroSnapshot {
    if (treePolicy === 'none') return hero
    return { ...hero, passiveTree: simTree(hero, passivePointsEarned(hero.heroLevel)) }
}

export function makeHero(classId: ClassId, heroLevel: number, overrides: Partial<HeroSnapshot> = {}): HeroSnapshot {
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

/**
 * The order stand-in Champions are added in, and therefore what `--party=N` actually fields.
 *
 * A Tank first, because that is the build a player is steered toward — Tank is the only
 * front-row default (`champions-guild-gacha.md` §8.1) and, since the enemy resolves as one
 * attack stream front-row-first, it is the body that actually buys survival time. Projecting
 * an all-Damage party would understate what a real party is worth.
 */
const STAND_IN_ARCHETYPES: readonly ChampionArchetype[] = ['tank', 'damage', 'support', 'control', 'damage']

/**
 * A party of `size` total units: the Hero plus `size - 1` Champion stand-ins riding the Hero's
 * level.
 *
 * Deliberately the *weakest* Champion the model allows — Common (×1.0) and un-invested (scalar
 * 1) — so this measures what *slots* are worth, never what a lucky pull is worth. Real party size
 * runs 3 (Hero + 2) to 6 (`champions-guild-gacha.md` §1).
 */
export function makeParty(classId: ClassId, heroLevel: number, size: number, overrides: Partial<HeroSnapshot> = {}): HeroSnapshot {
    const champions = Array.from({ length: Math.max(0, Math.floor(size) - 1) }, (_unused, index) => {
        const archetype = STAND_IN_ARCHETYPES[index % STAND_IN_ARCHETYPES.length]!
        return {
            championId: `champ_stand_in_${index + 1}`,
            archetype,
            rarityMultiplier: 1,
            investment: 1,
            strikesPerAttack: 1,
            row: getArchetype(archetype).defaultRow,
            /**
             * **One** ability, the first from its archetype's pool — the Common shape, since a
             * Common is what a stand-in is. An empty kit would understate every real party: the
             * idle rate counts abilities (`projection.ts`).
             */
            abilities: [ability(CHAMPION_ABILITY_POOL[archetype][0]!)]
        }
    })
    return makeHero(classId, heroLevel, { champions, ...overrides })
}

/**
 * Full picture for one stage: can the party kill it, how fast, and does it survive doing so.
 *
 * `tenureDays` is account age, which Gold reads through its ceiling. Callers that are
 * asking a pure combat question pass `SIM_MATURE_TENURE_DAYS`; the campaign walk passes its
 * own accumulated clock, which is the only place the ceiling can be seen binding.
 */
export function analyzeStage(fielded: HeroSnapshot, prestige: number, world: number, stage: number, tenureDays: number): StageReport {
    const hero = withSimUnlocks(fielded, prestige, world)
    const position = { prestige, world, stage, killsInStage: 0 }
    // Per-enemy stats for the display columns; the pack for everything that resolves against
    // the whole encounter. A wave stage is still 30 bodies — they just arrive N at a time.
    const enemy = enemyStatsAt(position)
    // Through the same helper `settle()` uses, so a verdict here cannot describe a party the
    // live game does not field — buffs rewrite the party, debuffs rewrite the pack, and the
    // rate counts ability damage alongside autoattacks.
    const { abilities, units, pack, secondsPerKill: spk } = rateAt(hero, position)
    const dps = packDps(units, pack).add(partyAbilityDps(hero, units, enemy.def, packSize(pack)))
    const archetype = stageArchetype(stage)
    const isGate = archetype === 'boss' || archetype === 'super_boss'
    const kills = killsRequired(position)
    // Both branches are "seconds × bodies". A gate is one encounter — the boss plus its
    // escort — so it is `packSize` bodies, not one; `spk` is amortized per enemy, so using it
    // bare would under-report a boss fight by the size of its escort.
    let clearSeconds = isGate ? spk * packSize(pack) : spk * kills

    // Same two functions `settle()` uses, deliberately — a survivability verdict here that
    // the live game disagreed with would make every table in this tool a lie.
    const incoming = incomingDps(units, pack)
    const heroEhp = units.reduce((total, unit) => total.add(unit.maxHp), ZERO)
    const timeToDie = secondsToDie(units, pack, abilities.healingPerSecond)

    const timerSeconds = isGate ? BOSS_TIMER_SECONDS : null
    const timerMargin = timerSeconds === null || !Number.isFinite(clearSeconds)
        ? null
        : (timerSeconds - clearSeconds) / timerSeconds

    /**
     * How long the party must stay alive without a break.
     *
     * HP is one pool that carries across a whole stage attempt and refills only on a clear or
     * a wipe — so a wave stage is the same continuous fight a boss is, just against 30 bodies.
     * The window is the full clear either way.
     *
     * A wave wipe restarts that stage rather than falling the run back one, so this is a
     * wall the run sits at and levels out of, not a loss of ground (`settle.killsBeforeWipe`).
     */
    const survivalWindow = clearSeconds
    const survivalRatio = Number.isFinite(timeToDie) && Number.isFinite(survivalWindow) && survivalWindow > 0
        ? timeToDie / survivalWindow
        : Number.POSITIVE_INFINITY

    let verdict: Verdict = 'clear'
    if (!Number.isFinite(spk)) verdict = 'stalled'
    else if (timeToDie < survivalWindow) verdict = 'wipe'
    else if (isGate && clearSeconds > BOSS_TIMER_SECONDS) verdict = 'timer_fail'

    if (isGate && bossFightSeeds > 0) {
        const fights = Array.from({ length: bossFightSeeds }, (_unused, i) => runFight({ hero, position, seed: i + 1 }))
        const wins = fights.filter(fight => fight.outcome === 'win')
        if (wins.length * 2 >= fights.length) {
            verdict = 'clear'
            clearSeconds = wins.reduce((total, fight) => total + fight.secondsElapsed, 0) / wins.length
        } else {
            const wipes = fights.filter(fight => fight.outcome === 'wipe').length
            verdict = wipes * 2 > fights.length - wins.length ? 'wipe' : 'timer_fail'
        }
    }

    return {
        world,
        stage,
        archetype,
        isGate,
        level: hero.heroLevel,
        enemyHp: enemy.hp,
        packSize: packSize(pack),
        enemyPwr: enemy.pwr,
        enemyDef: enemy.def,
        partyDps: dps,
        secondsPerKill: spk,
        killsRequired: kills,
        clearSeconds,
        timerSeconds,
        timerMargin,
        incomingDps: incoming,
        heroEhp,
        secondsToDie: timeToDie,
        survivalWindow,
        survivalRatio,
        verdict,
        goldPerKill: goldPerKill(prestige, world, stage, tenureDays)
    }
}

export interface WorldReport {
    world: number
    prestige: number
    rows: StageReport[]
    startLevel: number
    endLevel: number
    totalSeconds: number
    totalGold: number
    firstBlocker: StageReport | null
}

/**
 * Walks all ten stages, feeding each stage's XP back in before the next.
 *
 * Deliberately levels mid-walk, unlike `settle` — this projects a real playthrough, so a
 * frozen hero would report clear times for a run nobody plays. Pass `levelUp: false` to
 * hold power fixed and see one snapshot's reach instead.
 */
export function analyzeWorld(hero: HeroSnapshot, prestige: number, world: number, levelUp = true, tenureDays = SIM_MATURE_TENURE_DAYS): WorldReport {
    let level = hero.heroLevel
    let xp = hero.heroXp
    let totalSeconds = 0
    let totalGold = 0
    const rows: StageReport[] = []

    for (let stage = 1; stage <= STAGES_PER_WORLD; stage++) {
        const row = analyzeStage(makeHero(hero.classId, level, { ...hero, heroLevel: level, heroXp: xp }), prestige, world, stage, tenureDays)
        rows.push(row)

        if (Number.isFinite(row.clearSeconds)) totalSeconds += row.clearSeconds
        totalGold += row.goldPerKill * (row.isGate ? 1 : row.killsRequired)

        if (levelUp && Number.isFinite(row.secondsPerKill) && row.killsRequired > 0) {
            const gained = xpPerKill(prestige, world, stage).mul(row.killsRequired)
            const levelled = applyXp(level, xp, gained)
            level = levelled.level
            xp = levelled.xp
        }
    }

    return {
        world,
        prestige,
        rows,
        startLevel: hero.heroLevel,
        endLevel: level,
        totalSeconds,
        totalGold,
        firstBlocker: rows.find(row => row.verdict !== 'clear') ?? null
    }
}

/**
 * Builds the party a report fields. The CLI passes one that adds its `--traits`, `--kit` and
 * `--tree`; the bare `makeParty` is the default for scratch callers.
 */
export type PartyBuilder = (classId: ClassId, heroLevel: number, size: number) => HeroSnapshot

/**
 * Lowest hero level that clears a stage — the number that actually answers "is this gate
 * tuned right". Binary search is valid because damage rises monotonically with level.
 */
export function minLevelForGate(
    classId: ClassId,
    prestige: number,
    world: number,
    stage: number,
    maxLevel = 5000,
    party = 1,
    build: PartyBuilder = makeParty
): number | null {
    return minLevelToClear(build(classId, 1, party), prestige, world, stage, 1, maxLevel)
}

/**
 * Same binary search, but from an existing hero snapshot and an arbitrary floor — the
 * campaign walker already knows the level it is standing on, so it never searches below it.
 */
export function minLevelToClear(
    hero: HeroSnapshot,
    prestige: number,
    world: number,
    stage: number,
    fromLevel = 1,
    maxLevel = 5000
): number | null {
    const at = (level: number) => ({ ...hero, heroLevel: level, heroXp: ZERO })
    const clears = (level: number) => analyzeStage(at(level), prestige, world, stage, SIM_MATURE_TENURE_DAYS).verdict === 'clear'

    const low0 = Math.max(1, Math.floor(fromLevel))
    if (low0 >= maxLevel) return clears(maxLevel) ? maxLevel : null
    if (clears(low0)) return low0
    if (!clears(maxLevel)) return null

    let low = low0
    let high = maxLevel
    while (low + 1 < high) {
        const mid = Math.floor((low + high) / 2)
        if (clears(mid)) high = mid
        else low = mid
    }
    return high
}

export interface GateRow {
    world: number
    bossLevel: number | null
    superBossLevel: number | null
    /** Levels between the two gates — a big jump means the world back-loads its difficulty. */
    gap: number | null
}

/** Min level for every boss gate in the game. The fastest read on whether the curve holds. */
export function gateTable(classId: ClassId, prestige: number, worlds = WORLD_COUNT, party = 1, build: PartyBuilder = makeParty): GateRow[] {
    const rows: GateRow[] = []
    for (let world = 1; world <= worlds; world++) {
        const bossLevel = minLevelForGate(classId, prestige, world, 5, 5000, party, build)
        const superBossLevel = minLevelForGate(classId, prestige, world, STAGES_PER_WORLD, 5000, party, build)
        rows.push({
            world,
            bossLevel,
            superBossLevel,
            gap: bossLevel !== null && superBossLevel !== null ? superBossLevel - bossLevel : null
        })
    }
    return rows
}

// ── Campaign walk ──────────────────────────────────────────────────────────────────────

export type WallReason =
    /** No level inside the search ceiling clears the stage — the curve has outrun the hero. */
    | 'unclearable'
    /** Nowhere left to farm: every earlier stage is a wipe or deals zero damage. */
    | 'unfarmable'
    /** Clearable in principle, but the grind to get there exceeds the time budget. */
    | 'grind_budget'
    /** Ran out of prestiges before running out of road. Not a wall — the walk just stopped. */
    | 'prestige_limit'

/** One forced farming detour: the run got stuck, went back, and levelled until it wasn't. */
export interface GrindEvent {
    prestige: number
    world: number
    stage: number
    /** Why the stage refused the first attempt. */
    blockedBy: Verdict
    farmWorld: number
    farmStage: number
    fromLevel: number
    toLevel: number
    kills: number
    seconds: number
    gold: number
}

export interface CampaignWall {
    reason: WallReason
    prestige: number
    world: number
    stage: number
    archetype: StageArchetype
    verdict: Verdict
    /** Level the stage demands, when one exists inside the search ceiling. */
    requiredLevel: number | null
    level: number
    detail: string
}

export interface CampaignWorldRow {
    prestige: number
    world: number
    startLevel: number
    endLevel: number
    /** Time spent on stages that were cleared on sight. */
    fightSeconds: number
    /** Time spent farming earlier stages to get unstuck. */
    grindSeconds: number
    gold: number
    grinds: number
    /** False on the world the wall landed in. */
    completed: boolean
}

export interface CampaignOptions {
    /** Prestiges to walk before giving up on finding a wall. */
    maxPrestige?: number
    /** Grind allowed per blocked stage before it counts as a wall. */
    grindBudgetSeconds?: number
    /** Ceiling for the level search. A stage needing more than this reads as unclearable. */
    maxLevel?: number
    /** Kit, class and shop growth across the walk (`SimProgression`). Without one the party never changes. */
    progression?: SimProgression
}

export interface CampaignReport {
    rows: CampaignWorldRow[]
    grinds: GrindEvent[]
    wall: CampaignWall
    startPrestige: number
    startLevel: number
    endLevel: number
    fightSeconds: number
    grindSeconds: number
    totalSeconds: number
    totalGold: number
    /** Full ten-world loops finished, i.e. prestiges earned. */
    prestigesCompleted: number
    /** What each prestige paid and bought; empty without a `progression`. */
    prestiges: SimPrestigeRow[]
}

/**
 * Tenure to answer combat-only questions at.
 *
 * Gate searches, class comparisons and single-stage reports all care about verdicts, which do
 * not read Gold at all — but `analyzeStage` reports a Gold figure regardless, and that needs an
 * account age. A mature account keeps the ceiling clear of the progression term so those
 * reports show what the *position* is worth. The campaign walk is the exception and passes its
 * own clock, which is where the ceiling is supposed to be visible.
 */
export const SIM_MATURE_TENURE_DAYS = 3650

export const DEFAULT_CAMPAIGN_MAX_PRESTIGE = 10

/**
 * How long a single blocked stage may be farmed before the walk calls it a wall.
 *
 * A **threshold for "this has stopped being progress"**, so it has to be read against how long a
 * prestige loop is meant to take — about a week. The intended shape puts a grind of many hours
 * to a couple of days in front of late Stage 10 gates, and a tighter budget would report those
 * as walls while the run is pacing as designed.
 *
 * Still a genuine ceiling rather than a rubber stamp: `FIGHT_LENGTH_DRIFT` much above 0.35 blows
 * straight through it.
 */
export const DEFAULT_GRIND_BUDGET_SECONDS = 72 * 3600
export const DEFAULT_CAMPAIGN_MAX_LEVEL = 5000

/** A boss is a single kill; a wave stage is `BASE_KILL_COUNT` of them. */
function killsFor(row: StageReport): number {
    return row.isGate ? 1 : row.killsRequired
}

/**
 * Whether a stage pays XP and Gold, which is a weaker question than whether it can be cleared.
 *
 * **A wave stage the party cannot survive is still a farm.** `settle.killsBeforeWipe` banks
 * every kill landed before the party drops, and the wipe restarts *that same stage* rather
 * than falling the run back — so income continues, slowed by a recovery after each wipe
 * (`secondsPerFarmedKill`), and as `settle`'s own comment puts it, "the Hero levels its way out". Only three things actually stop the income:
 * a gate, which is one fight on a one-way door rather than a kill counter; a stalled stage,
 * where damage has floored and `secondsPerKill` is infinite; and a stage so lethal that the
 * party drops before the first kill lands.
 */
function banksKills(row: StageReport): boolean {
    if (row.isGate) return false
    if (!Number.isFinite(row.secondsPerKill) || row.secondsPerKill <= 0) return false
    return Math.floor(row.secondsToDie / row.secondsPerKill) >= 1
}

/** What a farmed kill costs in wall-clock time: on a stage the party wipes on, each attempt also owes `WIPE_RECOVERY_SECONDS` (`settle.walkWall`). */
function secondsPerFarmedKill(row: StageReport): number {
    const wipeAt = Math.floor(row.secondsToDie / row.secondsPerKill)
    if (!(wipeAt > 0) || wipeAt >= row.killsRequired) return row.secondsPerKill
    return row.secondsPerKill + WIPE_RECOVERY_SECONDS / wipeAt
}

/**
 * Deepest stage the hero can actually farm — **starting with the blocked stage itself**.
 *
 * Mirrors `fallbackStage` — a lost fight sends the run back one stage — but keeps walking
 * when that stage is also unfarmable, crossing world boundaries if it has to. Gates are
 * skipped: a boss is one kill on a one-way door, not a farm.
 *
 * ⚠ **The blocked stage is the first candidate, not the first stage skipped.** A wave stage the
 * party wipes on still banks kills (see `banksKills`), so requiring a `clear` here would report
 * a lethal stage as earning nothing. Farming in place is also what a player would actually do.
 *
 * Note this is the *deepest* farmable stage, not necessarily the XP-optimal one.
 */
function farmStageFor(hero: HeroSnapshot, prestige: number, world: number, stage: number, tenureDays: number): StageReport | null {
    let w = world
    let s = stage
    while (w >= 1) {
        while (s >= 1) {
            const archetype = stageArchetype(s)
            if (archetype !== 'boss' && archetype !== 'super_boss') {
                const row = analyzeStage(hero, prestige, w, s, tenureDays)
                if (banksKills(row)) return row
            }
            s--
        }
        w--
        s = STAGES_PER_WORLD
    }
    return null
}

/**
 * What a player gains between and during runs, for the campaign walk past a first prestige. Each
 * part is off unless its flag asks for it, so the walk still reads as it was tuned:
 *
 * - **Kit** (`--kit-ramp`): the `--kit` spec swapped for a better one at set account ages, written
 *   `spec@days` (`epic:0:1@7,legendary:0:1@30`). Seal income is unreconciled (#23), so what a player
 *   owns at day 30 is an input, not a projection; `open-items.md` #36 measured Rare 0★ Lv1 by day 1
 *   and Epic 0★ Lv1 by day 7 on a first run. A grind that crosses an upgrade stops there and the
 *   stage is retried on the new kit.
 * - **Class** (`--classes`): every prestige's class token, spent the moment it is paid, on the unseen
 *   node one below a node already reached whose best class (itself or anything under it) deals the
 *   most party DPS on the next run's first Stage 9. A token can be spent from any node reached, since switching
 *   back is free (`open-items.md` #42), so once a path is mastered the tokens open the next one
 *   toward the Ascendant, which wants a prestige completed as each of the six masters. The walk
 *   plays a newly bought class only if it beats the one being played, and finishes each run as a
 *   master it has not prestiged with yet, which costs nothing.
 * - **Shop** (`--shop`): every prestige's Void Shards, on Champion, Skill and Artifact slots,
 *   cheapest level first, saving for them until all three are maxed, then on the four stat tracks. A Champion slot
 *   fields one more stand-in, or one more real Champion under a kit.
 *
 * Changes land only at a prestige or a kit age, so `fieldAt` is what the walk asks for every stage.
 */
export interface SimProgressionOptions {
    classId: ClassId
    /** Total units at the start, Hero included, as `--party` gives it. */
    party: number
    traits: readonly TraitRoll[]
    /** The kit from account start, then each upgrade by account age. `none` for no kit. */
    kit: readonly { spec: string, atSeconds: number }[]
    /**
     * Champion rarities per run, from `--kit-ladder`, the last repeating; it replaces `kit`'s rarity
     * (keeping its star and level) and sets the Champion count when that is more than the slots bought.
     */
    kitLadder?: readonly string[]
    classes: boolean
    shop: boolean
}

export interface SimPrestigeRow {
    /** Prestiges completed, counting this one. */
    prestige: number
    atSeconds: number
    level: number
    shardsEarned: Decimal
    /** The class the next run is played as. */
    classId: ClassId
    /** The node the token bought, when it bought one the walk does not play yet. */
    tokenSpentOn: ClassId | null
    champions: number
    skillSlots: number
    artifactSlots: number
    statLevels: number
    kit: string
}

type SimShopTrack = 'championSlots' | 'skillSlots' | 'artifactSlots' | 'statPwr' | 'statDef' | 'statImp' | 'statVit'

const SIM_SLOT_TRACKS: readonly SimShopTrack[] = ['championSlots', 'skillSlots', 'artifactSlots']
const SIM_STAT_TRACKS: readonly SimShopTrack[] = ['statPwr', 'statDef', 'statImp', 'statVit']

export class SimProgression {
    private classId: ClassId
    private ascendantSkillIds: string[] = []
    private readonly seen = new Set<ClassId>()
    private readonly prestigedAs = new Set<ClassId>()
    private shards = ZERO
    private readonly levels: Record<SimShopTrack, number> = {
        championSlots: 0, skillSlots: 0, artifactSlots: 0, statPwr: 0, statDef: 0, statImp: 0, statVit: 0
    }

    constructor(private readonly options: SimProgressionOptions) {
        this.classId = options.classId
        for (const node of classPath(options.classId)) this.seen.add(node.id)
    }

    /** The kit spec in force on run `prestige` at `clockSeconds` of account age. */
    kitAt(prestige: number, clockSeconds: number): string {
        let spec = 'none'
        for (const step of this.options.kit) if (step.atSeconds <= clockSeconds + 1e-6) spec = step.spec
        const ladder = this.options.kitLadder
        if (!ladder?.length) return spec
        const [, star = '0', level = '1'] = spec === 'none' ? [] : spec.split(':')
        return `${ladder[Math.min(prestige, ladder.length - 1)]}:${star}:${level}`
    }

    /** Champions fielded on run `prestige`: the slots bought, or the ladder's count when that is more. */
    championsAt(prestige: number, clockSeconds: number): number {
        const bought = Math.max(0, this.options.party - 1) + this.levels.championSlots
        const laddered = this.options.kitLadder?.length ? parseKitMix(this.kitAt(prestige, clockSeconds).split(':')[0]!).length : 0
        return Math.min(MAX_CHAMPION_SLOTS, Math.max(bought, laddered))
    }

    /** Account age of the next kit upgrade after `clockSeconds`, or Infinity. */
    nextChangeAfter(clockSeconds: number): number {
        return this.options.kit.find(step => step.atSeconds > clockSeconds + 1e-6)?.atSeconds ?? Number.POSITIVE_INFINITY
    }

    fieldAt(prestige: number, level: number, xp: Decimal, clockSeconds: number): HeroSnapshot {
        return this.field(this.classId, this.ascendantSkillIds, level, xp, prestige, clockSeconds)
    }

    private field(classId: ClassId, ascendantSkillIds: readonly string[], level: number, xp: Decimal, prestige: number, clockSeconds: number): HeroSnapshot {
        const kit = this.kitAt(prestige, clockSeconds)
        const party = makeParty(classId, level, this.championsAt(prestige, clockSeconds) + 1, {
            heroXp: xp,
            traits: this.options.traits,
            ascendantSkillIds,
            shopStatLevels: {
                pwr: this.levels.statPwr,
                def: this.levels.statDef,
                imp: this.levels.statImp,
                vit: this.levels.statVit
            }
        })
        return withSimTree(withSimKit(party, kit, {
            skills: BASE_SKILL_SLOTS + this.levels.skillSlots,
            artifacts: BASE_ARTIFACT_SLOTS + this.levels.artifactSlots
        }))
    }

    /** A prestige just completed: credit the class, pay and spend the shards, spend the token. */
    prestiged(prestigeCompleted: number, level: number, xp: Decimal, clockSeconds: number): SimPrestigeRow {
        const earned = voidShardsFor(prestigeCompleted - 1)
        let tokenSpentOn: ClassId | null = null
        if (this.options.classes) {
            const playedNewMaster = getClass(this.classId).tier === 'master' && !this.prestigedAs.has(this.classId)
            this.prestigedAs.add(playedNewMaster
                ? this.classId
                : MASTER_IDS.find(id => this.seen.has(id) && !this.prestigedAs.has(id)) ?? this.classId)
        }
        if (this.options.shop) {
            this.shards = this.shards.add(earned)
            this.spend(SIM_SLOT_TRACKS)
            // Saved for slots until all three are maxed: a stat level is +1%, a slot is a unit.
            if (SIM_SLOT_TRACKS.every(track => shopTrackCost(track, this.levels[track]) === null)) this.spend(SIM_STAT_TRACKS)
        }
        if (this.options.classes) tokenSpentOn = this.spendToken(prestigeCompleted, level, xp, clockSeconds)

        return {
            prestige: prestigeCompleted,
            atSeconds: clockSeconds,
            level,
            shardsEarned: earned,
            classId: this.classId,
            tokenSpentOn,
            champions: this.championsAt(prestigeCompleted, clockSeconds),
            skillSlots: BASE_SKILL_SLOTS + this.levels.skillSlots,
            artifactSlots: BASE_ARTIFACT_SLOTS + this.levels.artifactSlots,
            statLevels: SIM_STAT_TRACKS.reduce((total, track) => total + this.levels[track], 0),
            kit: this.kitAt(prestigeCompleted, clockSeconds)
        }
    }

    /** Cheapest next level among `tracks` until none is affordable or all are capped. */
    private spend(tracks: readonly SimShopTrack[]) {
        for (;;) {
            let cheapest: { track: SimShopTrack, cost: number } | null = null
            for (const track of tracks) {
                const cost = shopTrackCost(track, this.levels[track])
                if (cost !== null && (!cheapest || cost < cheapest.cost)) cheapest = { track, cost }
            }
            if (!cheapest || this.shards.lt(cheapest.cost)) return
            this.shards = this.shards.sub(cheapest.cost)
            this.levels[cheapest.track]++
        }
    }

    private spendToken(prestigeCompleted: number, level: number, xp: Decimal, clockSeconds: number): ClassId | null {
        // Lower is better: party DPS on the next run's first Stage 9, at the level it starts on. DPS
        // rather than seconds per kill, which floors at `MIN_SECONDS_PER_KILL` and ties every class
        // on a stage the party out-levels; a stage far past the level, where the mitigation clamp
        // flattens the classes, would rank them wrongly instead.
        const rate = (classId: ClassId, picks: readonly string[]) => -analyzeStage(this.field(classId, picks, level, xp, prestigeCompleted, clockSeconds),
            prestigeCompleted, 1, STAGES_PER_WORLD - 1, SIM_MATURE_TENURE_DAYS).partyDps.max(1).log10().toNumber()

        const reachable = CLASS_NODES.filter(node => !this.seen.has(node.id)
            && (node.parentId ? this.seen.has(node.parentId) : node.id === ASCENDANT_ID && MASTER_IDS.every(id => this.prestigedAs.has(id))))
        if (!reachable.length) return null

        const rates = new Map<ClassId, number>()
        const rateOf = (id: ClassId) => {
            if (!rates.has(id)) rates.set(id, rate(id, id === ASCENDANT_ID ? this.ascendantPicksFor(rate) : []))
            return rates.get(id)!
        }
        // A node is worth the best class it leads to: a base class can trail the Beginner while
        // its master doubles it, so a one-step pick would never leave the root.
        const promise = (id: ClassId) => Math.min(...CLASS_NODES
            .filter(node => node.id === id || (node.tier !== 'capstone' && isDescendantOf(node.id, id)))
            .map(node => rateOf(node.id)))
        const depth = (id: ClassId) => classPath(id).length
        const pick = [...reachable].sort((a, b) => promise(a.id) - promise(b.id) || depth(b.id) - depth(a.id))[0]!
        this.seen.add(pick.id)

        if (rateOf(pick.id) < rate(this.classId, this.ascendantSkillIds)) {
            this.classId = pick.id
            this.ascendantSkillIds = pick.id === ASCENDANT_ID ? this.ascendantPicksFor(rate) : []
            return null
        }
        return pick.id
    }

    /** The Ascendant's picks, greedily, one slot at a time, by the same rate. */
    private ascendantPicksFor(rate: (classId: ClassId, picks: readonly string[]) => number): string[] {
        const picks: string[] = []
        for (let slot = 0; slot < ASCENDANT_KIT_SIZE; slot++) {
            let best: { id: string, value: number } | null = null
            for (const skill of ASCENDANT_PICKABLE) {
                if (picks.includes(skill.id)) continue
                const value = rate(ASCENDANT_ID, [...picks, skill.id])
                if (!best || value < best.value) best = { id: skill.id, value }
            }
            if (best) picks.push(best.id)
        }
        return picks
    }
}

/**
 * Walk stages → worlds → prestiges until the run cannot continue.
 *
 * Unlike `analyzeWorld`, a failed stage does not end the walk. The run falls back and farms
 * until it out-levels the blocker, exactly as the soft-fail rule describes, and only stops
 * when farming stops working — which is the wall this is built to find. Three shapes it
 * takes, and they want different fixes:
 *
 * - `unclearable` — no level inside the search ceiling clears the stage. The enemy curve has
 *   outrun the hero outright.
 * - `grind_budget` — clearable, but the hours needed exceed `grindBudgetSeconds`. A pacing
 *   problem, not a math one; XP or stat growth is the dial.
 * - `unfarmable` — nowhere left to earn XP at all. Rare, and means the wall is behind you.
 *
 * Prestige carries Hero level and XP forward and resets only the run position, matching
 * `settleHq`'s prestige path.
 */
export function analyzeCampaign(
    hero: HeroSnapshot,
    startPrestige = 0,
    options: CampaignOptions = {}
): CampaignReport {
    const maxPrestige = options.maxPrestige ?? DEFAULT_CAMPAIGN_MAX_PRESTIGE
    const grindBudget = options.grindBudgetSeconds ?? DEFAULT_GRIND_BUDGET_SECONDS
    const maxLevel = options.maxLevel ?? DEFAULT_CAMPAIGN_MAX_LEVEL

    let level = hero.heroLevel
    let xp = hero.heroXp
    let fightSeconds = 0
    let grindSeconds = 0
    let totalGold = 0
    let prestigesCompleted = 0

    const rows: CampaignWorldRow[] = []
    const grinds: GrindEvent[] = []
    const prestiges: SimPrestigeRow[] = []
    const progression = options.progression
    const at = (prestige: number, clock: number) => progression ? progression.fieldAt(prestige, level, xp, clock) : { ...hero, heroLevel: level, heroXp: xp }

    let wall: CampaignWall | null = null

    for (let prestige = startPrestige; prestige <= startPrestige + maxPrestige && !wall; prestige++) {
        for (let world = 1; world <= WORLD_COUNT && !wall; world++) {
            const startLevel = level
            let worldFight = 0
            let worldGrind = 0
            let worldGold = 0
            let worldGrinds = 0
            let completed = true

            for (let stage = 1; stage <= STAGES_PER_WORLD; stage++) {
                const clock = () => fightSeconds + worldFight + grindSeconds + worldGrind
                // Conservative, exactly as `settleHq` is: the clock as the stage opens.
                const tenureDays = clock() / 86_400
                let row = analyzeStage(at(prestige, clock()), prestige, world, stage, tenureDays)
                let stageGrind = 0

                // More than one detour only when a grind stops at a kit upgrade to retry on it.
                while (row.verdict !== 'clear') {
                    const untilChange = progression ? progression.nextChangeAfter(clock()) - clock() : Number.POSITIVE_INFINITY
                    const detour = resolveBlock(at(prestige, clock()), prestige, world, stage, row, level, xp, maxLevel, grindBudget - stageGrind, tenureDays, untilChange)
                    if ('wall' in detour) {
                        wall = detour.wall
                        completed = false
                        break
                    }

                    level = detour.level
                    xp = detour.xp
                    worldGrind += detour.event.seconds
                    stageGrind += detour.event.seconds
                    worldGold += detour.event.gold
                    worldGrinds++
                    grinds.push(detour.event)

                    row = analyzeStage(at(prestige, clock()), prestige, world, stage, tenureDays)
                    if (!detour.partial && row.verdict !== 'clear') {
                        // Levelled past the searched threshold and still stuck: only reachable if
                        // clearing is non-monotonic in level, which would be a combat-math bug.
                        wall = {
                            reason: 'unclearable',
                            prestige,
                            world,
                            stage,
                            archetype: row.archetype,
                            verdict: row.verdict,
                            requiredLevel: null,
                            level,
                            detail: `still ${row.verdict} at level ${level} after grinding to the searched clear level — clearing is not monotonic in level`
                        }
                        completed = false
                        break
                    }
                }
                if (wall) break

                const kills = killsFor(row)
                worldFight += row.clearSeconds
                worldGold += row.goldPerKill * kills
                const levelled = applyXp(level, xp, xpPerKill(prestige, world, stage).mul(kills))
                level = levelled.level
                xp = levelled.xp
            }

            fightSeconds += worldFight
            grindSeconds += worldGrind
            totalGold += worldGold
            rows.push({
                prestige,
                world,
                startLevel,
                endLevel: level,
                fightSeconds: worldFight,
                grindSeconds: worldGrind,
                gold: worldGold,
                grinds: worldGrinds,
                completed
            })

            if (completed && world === WORLD_COUNT) {
                prestigesCompleted++
                if (progression) prestiges.push(progression.prestiged(prestige + 1, level, xp, fightSeconds + grindSeconds))
            }
        }
    }

    return {
        rows,
        grinds,
        wall: wall ?? {
            reason: 'prestige_limit',
            prestige: startPrestige + maxPrestige,
            world: WORLD_COUNT,
            stage: STAGES_PER_WORLD,
            archetype: stageArchetype(STAGES_PER_WORLD),
            verdict: 'clear',
            requiredLevel: null,
            level,
            detail: `no wall inside ${maxPrestige} prestige(s) — raise --max-prestige to keep walking`
        },
        startPrestige,
        startLevel: hero.heroLevel,
        endLevel: level,
        fightSeconds,
        grindSeconds,
        totalSeconds: fightSeconds + grindSeconds,
        totalGold,
        prestigesCompleted,
        prestiges
    }
}

/**
 * Get unstuck, or explain why the run can't be.
 *
 * XP needed is solved from the level curve rather than simulated kill by kill — the deficit
 * reaches magnitudes where a loop would run for millions of iterations.
 */
function resolveBlock(
    hero: HeroSnapshot,
    prestige: number,
    world: number,
    stage: number,
    blocked: StageReport,
    level: number,
    xp: Decimal,
    maxLevel: number,
    grindBudget: number,
    tenureDays: number,
    /** Seconds until the kit next improves. A grind that would outlast it stops there instead. */
    untilChange = Number.POSITIVE_INFINITY
): { level: number; xp: Decimal; event: GrindEvent; partial: boolean } | { wall: CampaignWall } {
    const base: Omit<CampaignWall, 'reason' | 'requiredLevel' | 'detail'> = {
        prestige,
        world,
        stage,
        archetype: blocked.archetype,
        verdict: blocked.verdict,
        level
    }

    const required = minLevelToClear(hero, prestige, world, stage, level + 1, maxLevel)
    const farm = farmStageFor(hero, prestige, world, stage, tenureDays)
    const pending = farm !== null && untilChange <= grindBudget
    if (required === null && !pending) {
        return {
            wall: {
                ...base,
                reason: 'unclearable',
                requiredLevel: null,
                detail: `no level up to ${maxLevel} clears this stage (${blocked.verdict} at level ${level})`
            }
        }
    }

    if (!farm) {
        return {
            wall: {
                ...base,
                reason: 'unfarmable',
                requiredLevel: required,
                detail: `needs level ${required}, and no earlier stage is farmable at level ${level}`
            }
        }
    }

    const perKill = xpPerKill(prestige, farm.world, farm.stage)
    let kills = Number.POSITIVE_INFINITY
    if (required !== null) {
        const deficit = totalXpForLevel(required).sub(totalXpForLevel(level).add(xp))
        kills = deficit.lte(0) ? 0 : deficit.div(perKill).ceil().toNumber()
    }
    let seconds = kills * secondsPerFarmedKill(farm)

    // The kit improves before the grind would end: farm until it does, and let the walk retry.
    const partial = pending && !(seconds <= untilChange)
    if (partial) {
        kills = Math.floor(untilChange / secondsPerFarmedKill(farm))
        seconds = untilChange
    } else if (required === null || !Number.isFinite(seconds) || seconds > grindBudget) {
        return {
            wall: {
                ...base,
                reason: 'grind_budget',
                requiredLevel: required,
                detail: `needs level ${required} (from ${level}) — ${formatGrind(seconds)} of farming W${farm.world}S${farm.stage}, over the ${formatGrind(grindBudget)} budget left`
            }
        }
    }

    const levelled = applyXp(level, xp, perKill.mul(kills))
    return {
        level: levelled.level,
        xp: levelled.xp,
        partial,
        event: {
            prestige,
            world,
            stage,
            blockedBy: blocked.verdict,
            farmWorld: farm.world,
            farmStage: farm.stage,
            fromLevel: level,
            toLevel: levelled.level,
            kills,
            seconds,
            gold: kills * farm.goldPerKill
        }
    }
}

/** Local to the wall messages — `formatSeconds` lives in the shared layer, this is prose. */
function formatGrind(seconds: number): string {
    if (!Number.isFinite(seconds)) return 'unbounded'
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
    return `${(seconds / 86400).toFixed(1)}d`
}

export interface ClassRow {
    classId: ClassId
    name: string
    tier: string
    partyDps: Decimal
    heroEhp: Decimal
    secondsPerKill: number
    clearSeconds: number
    verdict: Verdict
}

/** Every class side by side at the same level and stage. Shows whether the paths diverge. */
export function compareClasses(prestige: number, world: number, stage: number, level: number, party = 1, build: PartyBuilder = makeParty): ClassRow[] {
    return CLASS_NODES.map((node) => {
        const report = analyzeStage(build(node.id, level, party), prestige, world, stage, SIM_MATURE_TENURE_DAYS)
        return {
            classId: node.id,
            name: node.name,
            tier: node.tier,
            partyDps: report.partyDps,
            heroEhp: report.heroEhp,
            secondsPerKill: report.secondsPerKill,
            clearSeconds: report.clearSeconds,
            verdict: report.verdict
        }
    }).sort((a, b) => (b.partyDps.gt(a.partyDps) ? 1 : -1))
}
