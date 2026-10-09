/**
 * Training Grounds — the 36-skill roster (`skills-gacha.md`).
 *
 * **Hero-only.** Champions carry their own kits, fixed at recruitment, and this system never
 * touches them (§1). Equipped in 2–5 dedicated slots bought through the prestige shop (§6);
 * every equipped Active auto-fires the instant its cooldown ends, exactly like a class-tree
 * skill, because there is no manual-cast mode anywhere in this game.
 *
 * ## The roster is doc-authored, which makes this pass a transcription
 *
 * Unlike the class tree — where seven skills had nothing but a name in a diagram — §4 gives a
 * complete 36-entry draft: name, type, and a one-line effect for every one. The doc's
 * own wording is quoted above each entry so a later reading can check the transcription rather
 * than re-derive intent. What is *not* in the doc is any magnitude ("small", "medium–large",
 * "a portion"), which is why every number here comes from `constants.ts`.
 *
 * ## Two types, two mechanisms
 *
 * - **Active** → an `AbilityEffect`, joining the Hero's kit in `fight.ts` and `projection.ts`.
 *   Plugs into the existing cooldown/SPD system with no new combat code (§3).
 * - **Passive** → `HqModifier` lines, folded into the stat pipeline and the economy rates. A
 *   Passive is "always on, no cooldown, no button" (§3) — a stat modifier, not a status with a
 *   duration.
 *
 * 18 of each: 3 Active and 3 Passive per rarity (§3).
 *
 * §3's universality rule — no skill may reference a path-specific stat, since any Hero can equip
 * any skill — holds trivially because every class shares the same six stats; `content.spec.ts`
 * asserts it anyway.
 */

import {
    EXECUTE_BONUS,
    GOLD_BURST_COOLDOWN_SECONDS,
    GOLD_BURST_MINUTES,
    SKILL_BASE_ABILITY_MULTIPLIER,
    SKILL_BASE_COOLDOWN_SECONDS,
    SKILL_BUFF_FRACTION,
    SKILL_COLLECTION_PASSIVE_FRACTION,
    SKILL_COOLDOWN_REFUND_FRACTION,
    SKILL_DEBUFF_FRACTION,
    SKILL_DOT_MULTIPLIER,
    SKILL_ECONOMY_COEFFICIENT,
    SKILL_HEAL_MULTIPLIER,
    SKILL_PASSIVE_MAGNITUDE,
    SKILL_PIERCE_MULTIPLIER,
    SKILL_POTENCY_PER_POINT,
    SKILL_STATUS_DURATION_SECONDS
} from '../constants'
import { onCooldownRank, scaleEffect } from '../effects'
import type { AbilityEffect } from '../effects'
import { RARITIES, RARITY_EFFECT_LINES, investmentScalar, rarityIndex } from '../gacha'
import { COLLECTION_PASSIVE_KINDS, type HqModifier } from '../modifiers'
import type { ClassId, ClassSkill, HeroSnapshot, HqStatKey, OwnedCopy, Rarity } from '../types'
import { classPath, kitFor } from './classes'

export type SkillType = 'active' | 'passive'

export interface SkillDefinition {
    /** Stable string ID. Save data references this, never an index or a display name. */
    id: string
    name: string
    type: SkillType
    rarity: Rarity
    /**
     * One entry per effect line, in the doc's own words.
     *
     * The count is the structural invariant §3 locks — 1 line at Common/Uncommon/Rare, 2 at
     * Epic/Legendary, 3 at Mythic — and it is asserted against `RARITY_EFFECT_LINES` in
     * `content.spec.ts`. Carrying the prose rather than deriving a count from the mechanical
     * payload is deliberate: "damage, and a debuff" is two lines by design intent, and no
     * automatic count of populated fields would reliably agree with that reading.
     */
    lines: readonly string[]
    /** Actives only — what the ability does when it fires. */
    effect?: AbilityEffect
    /** Actives only — base cooldown before SPD and Tempo modifiers shorten it. */
    cooldownSeconds?: number
    /** Actives only. Zero for the pure-utility ones, exactly as Champion abilities do it. */
    abilityMultiplier?: number
    /** Passives only — always-on modifier lines, one per effect line. */
    modifiers?: readonly HqModifier[]
}

/**
 * `Coin Toss` → `skill_coin_toss`, `King's Ransom` → `skill_kings_ransom`.
 *
 * Apostrophes are **dropped** rather than turned into a separator, which is what keeps
 * `skill_kings_ransom` from reading as `skill_king_s_ransom`. Worth being deliberate about: these
 * ids are persisted in `hqCollection.contentId` and in `hqState.equippedSkillIds`, so the scheme
 * is fixed the moment anything ships — a later "tidy-up" of the slug would orphan every save.
 */
export function skillIdFor(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    return `skill_${slug}`
}

// ── Authoring helpers ──────────────────────────────────
//
// The magnitude of every line comes from the rarity band, never from a literal — which is what
// makes the whole 36-skill balance pass one edit in `constants.ts`.

/** A stat line at this rarity's magnitude. */
const stat = (rarity: Rarity, key: HqStatKey): HqModifier =>
    ({ kind: 'stat', stat: key, magnitude: SKILL_PASSIVE_MAGNITUDE[rarityIndex(rarity)]! })

/** An economy line, throttled by `SKILL_ECONOMY_COEFFICIENT` — Gold compounds forever. */
const economy = (rarity: Rarity, kind: 'gold' | 'xp' | 'offlineEfficiency'): HqModifier =>
    ({
        kind,
        magnitude: SKILL_PASSIVE_MAGNITUDE[rarityIndex(rarity)]! * SKILL_ECONOMY_COEFFICIENT
    })

const other = (rarity: Rarity, kind: 'maxHp' | 'damageTaken' | 'controlResist' | 'reflect'): HqModifier =>
    ({ kind, magnitude: SKILL_PASSIVE_MAGNITUDE[rarityIndex(rarity)]! })

const TIMED = SKILL_STATUS_DURATION_SECONDS
const selfBuff = (key: HqStatKey) =>
    ({ kind: 'buff' as const, stat: key, duration: TIMED, magnitude: SKILL_BUFF_FRACTION })

/**
 * The cooldown a "chance to refund / reset / trigger again" clause is rendered as — a permanently
 * shorter cooldown with the conditionality dropped. See `SKILL_COOLDOWN_REFUND_FRACTION`.
 */
const REFUNDED_COOLDOWN = SKILL_BASE_COOLDOWN_SECONDS * (1 - SKILL_COOLDOWN_REFUND_FRACTION)

function active(
    name: string,
    rarity: Rarity,
    lines: readonly string[],
    effect: AbilityEffect,
    options: { cooldownSeconds?: number; abilityMultiplier?: number; offLadder?: boolean } = {}
): SkillDefinition {
    const cadence = {
        effect,
        cooldownSeconds: options.cooldownSeconds ?? SKILL_BASE_COOLDOWN_SECONDS,
        abilityMultiplier: options.abilityMultiplier ?? SKILL_BASE_ABILITY_MULTIPLIER
    }
    return {
        id: skillIdFor(name),
        name,
        type: 'active',
        rarity,
        lines,
        ...(options.offLadder ? cadence : onCooldownRank(cadence, rarityIndex(rarity)))
    }
}

function passive(
    name: string,
    rarity: Rarity,
    lines: readonly string[],
    modifiers: readonly HqModifier[]
): SkillDefinition {
    return { id: skillIdFor(name), name, type: 'passive', rarity, lines, modifiers }
}

/** A Gold or XP burst's size at this rarity, in minutes of current income (`gold-economy.md` §6). */
const burst = (rarity: Rarity) => GOLD_BURST_MINUTES[rarityIndex(rarity)]!

// ── The roster ─────────────────────────────────────────  skills-gacha.md §4

/**
 * All 36, in the doc's own order: three Actives then three Passives per rarity.
 *
 * Quoted `//` comments are §4's effect column verbatim. Where the engine cannot express a clause
 * the entry says what was dropped — the same convention `content/champions.ts` uses, and for the
 * same reason: "the doc said this" and "we approximated this" must never become
 * indistinguishable later.
 */
export const SKILLS: readonly SkillDefinition[] = [
    // ── Common ─────────────────────────────────────────
    /** "Hit your current target for a small % of your PWR. Short cooldown." */
    active('Quick Strike', 'common', ['Hit your current target for a small share of your PWR.'],
        { target: 'enemy_single' }),
    /** "Self-only: restore a small % of max HP. Medium cooldown." */
    active('Steadying Breath', 'common', ['Restore a small share of your maximum HP.'],
        { target: 'self', heal: SKILL_HEAL_MULTIPLIER }, { abilityMultiplier: 0 }),
    /**
     * "Deals no damage — instantly grants a small burst of bonus Gold."
     *
     * The burst is minutes of current income, never a flat amount (`gold-economy.md` §6), and it
     * rides `GOLD_BURST_COOLDOWN_SECONDS` rather than the shared base — see that constant for
     * why a pure-economy Active cannot share a damage skill's cadence.
     */
    active('Coin Toss', 'common', ['Grants a small burst of bonus Gold. Deals no damage.'],
        { target: 'self', goldBurstMinutes: burst('common') },
        { abilityMultiplier: 0, cooldownSeconds: GOLD_BURST_COOLDOWN_SECONDS, offLadder: true }),

    /** "+SPD% (small)." */
    passive('Marching Drill', 'common', ['+SPD.'], [stat('common', 'spd')]),
    /** "+DEF% (small)." */
    passive('Iron Discipline', 'common', ['+DEF.'], [stat('common', 'def')]),
    /** "+Gold gain% (small)." */
    passive("Apprentice's Ledger", 'common', ['+Gold gain.'], [economy('common', 'gold')]),

    // ── Uncommon ───────────────────────────────────────
    /** "Hit your current target for a larger % of your PWR. Short cooldown." */
    active('Focused Blow', 'uncommon', ['Hit your current target for a larger share of your PWR.'],
        { target: 'enemy_single' }),
    /** "Self-only: restore a moderate % of max HP. Medium cooldown." */
    active('Adrenaline Surge', 'uncommon', ['Restore a moderate share of your maximum HP.'],
        { target: 'self', heal: SKILL_HEAL_MULTIPLIER }, { abilityMultiplier: 0 }),
    /** "Deals no damage — grants a moderate burst of bonus Gold on cast." */
    active("Prospector's Instinct", 'uncommon', ['Grants a moderate burst of bonus Gold.'],
        { target: 'self', goldBurstMinutes: burst('uncommon') },
        { abilityMultiplier: 0, cooldownSeconds: GOLD_BURST_COOLDOWN_SECONDS, offLadder: true }),

    /** "+LCK% (small–medium)." */
    passive('Sharpened Reflexes', 'uncommon', ['+LCK.'], [stat('uncommon', 'lck')]),
    /**
     * "+VIT% / flat HP (small–medium)."
     *
     * Read as VIT rather than flat HP: VIT *is* the HP stat (`HP = BASE_HP + VIT × HP_PER_VIT`),
     * so a VIT line already grants HP, and a flat-HP line would go irrelevant within a few levels
     * against a geometric stat curve while a percentage never does.
     */
    passive('Endurance Training', 'uncommon', ['+VIT, and the HP it carries.'],
        [stat('uncommon', 'vit')]),
    /** "+XP gain% (small)." */
    passive("Scholar's Notes", 'uncommon', ['+XP gain.'], [economy('uncommon', 'xp')]),

    // ── Rare ───────────────────────────────────────────
    /**
     * "Hit your current target for a solid % of your PWR, ignoring a small portion of target DEF."
     *
     * The DEF bypass lands as a short armour-shred debuff — the same shape Shatter Armor uses, and
     * the one the projection already folds into `enemyDefFactor`. A true per-hit penetration term
     * would be a second mitigation path in the damage formula for one skill.
     */
    active('Piercing Focus', 'rare',
        ['Hit your current target hard, ignoring a portion of its DEF.'],
        {
            target: 'enemy_single',
            status: { kind: 'debuff', stat: 'def', duration: TIMED, magnitude: SKILL_DEBUFF_FRACTION }
        },
        { abilityMultiplier: SKILL_BASE_ABILITY_MULTIPLIER * SKILL_PIERCE_MULTIPLIER }),
    /** "Self-only: restore a large % of max HP. Medium-long cooldown." */
    active('Vigor Renewal', 'rare', ['Restore a large share of your maximum HP.'],
        { target: 'self', heal: SKILL_HEAL_MULTIPLIER }, { abilityMultiplier: 0 }),
    /** "Hit your current target for your PWR, boosted or dampened by … banked Gold." */
    active("Gambler's Strike", 'rare',
        ['Hit your current target for your PWR, scaled by the hours of income you have banked.'],
        { target: 'enemy_single', wealthScaled: true }),

    /** "+IMP% (small–medium)." */
    passive('Battle Focus', 'rare', ['+IMP.'], [stat('rare', 'imp')]),
    /** "+DEF% (medium)." */
    passive('Fortified Resolve', 'rare', ['+DEF.'], [stat('rare', 'def')]),
    /** "+Gold gain% (medium)." */
    passive("Merchant's Eye", 'rare', ['+Gold gain.'], [economy('rare', 'gold')]),

    // ── Epic ───────────────────────────────────────────
    /** "Hit your current target for a % of your PWR, AND apply a minor stacking DoT debuff." */
    active('Twin Strike', 'epic',
        ['Hit your current target.', 'Applies a stacking burn.'],
        {
            target: 'enemy_single',
            status: {
                kind: 'dot', duration: TIMED, magnitude: SKILL_DOT_MULTIPLIER,
                scalesWithPwr: true, stacks: 1
            }
        }),
    /** "Self-only: restore a % of max HP, AND grant yourself a brief +SPD buff." */
    active('Battlefield Surge', 'epic',
        ['Restore a share of your maximum HP.', 'Grants yourself a brief +SPD buff.'],
        { target: 'self', heal: SKILL_HEAL_MULTIPLIER, selfStatus: selfBuff('spd') },
        { abilityMultiplier: 0 }),
    /** "Hit … wealth-modulated as Gambler's Strike, AND grant yourself a small Gold burst." */
    active("Treasure Hunter's Gambit", 'epic',
        ['A wealth-scaled hit on your current target.', 'Grants a burst of bonus Gold on the same cast.'],
        { target: 'enemy_single', wealthScaled: true, goldBurstMinutes: burst('epic') }),

    /** "+SPD% AND +LCK% (both medium)." */
    passive("Veteran's Instincts", 'epic', ['+SPD.', '+LCK.'],
        [stat('epic', 'spd'), stat('epic', 'lck')]),
    /** "+Gold gain% AND +XP gain% (both medium)." */
    passive("Warlord's Ledger", 'epic', ['+Gold gain.', '+XP gain.'],
        [economy('epic', 'gold'), economy('epic', 'xp')]),
    /**
     * "+DEF% (medium), AND each hit taken has a chance to grant yourself a small temporary shield."
     *
     * The shield lands as a flat reduction in damage taken. There is no on-hit trigger to hang a
     * proc off, and in every model the game actually runs — the averaged idle rate and the tick
     * fight alike — a shield that periodically absorbs and mitigation that always applies sit on
     * exactly the same axis. What is lost is the burstiness, not the value.
     */
    passive('Adaptive Plating', 'epic', ['+DEF.', 'Reduces the damage you take.'],
        [stat('epic', 'def'), other('epic', 'damageTaken')]),

    // ── Legendary ──────────────────────────────────────
    /**
     * "Hit … for bonus damage that scales up the lower that target's HP% is, AND refund a portion
     * of this skill's own cooldown if the hit kills."
     */
    active("Executioner's Edge", 'legendary',
        ['Bonus damage that grows as the target weakens.', 'Comes back off cooldown faster.'],
        { target: 'enemy_single', executeBonus: EXECUTE_BONUS },
        { cooldownSeconds: REFUNDED_COOLDOWN }),
    /** "Self-only: restore a large % of max HP, AND cleanse all debuffs currently on you." */
    active('Phoenix Draught', 'legendary',
        ['Restore a large share of your maximum HP.', 'Cleanses every debuff on you.'],
        { target: 'self', heal: SKILL_HEAL_MULTIPLIER, cleanse: true },
        { abilityMultiplier: 0 }),
    /** "A larger wealth-modulated hit …, AND have a chance to trigger the hit a second time." */
    active("Fortune's Gambit", 'legendary',
        ['A larger wealth-scaled hit on your current target.', 'Fires more often.'],
        { target: 'enemy_single', wealthScaled: true },
        { cooldownSeconds: REFUNDED_COOLDOWN }),

    /** "+IMP% AND +LCK% (both medium–large)." */
    passive("Grandmaster's Focus", 'legendary', ['+IMP.', '+LCK.'],
        [stat('legendary', 'imp'), stat('legendary', 'lck')]),
    /** "+Gold gain% AND +offline-efficiency% (both medium–large)." */
    passive("Tycoon's Vault", 'legendary', ['+Gold gain.', '+Offline efficiency.'],
        [economy('legendary', 'gold'), economy('legendary', 'offlineEfficiency')]),
    /**
     * "+DEF%/VIT (medium–large), AND resistance to (reduced chance/duration of) one debuff type."
     *
     * The resistance line is a `controlResist` modifier, which shortens what boss specials land.
     */
    passive('Unbreakable Will', 'legendary', ['+DEF.', 'Shortens debuffs applied to you.'],
        [stat('legendary', 'def'), other('legendary', 'controlResist')]),

    // ── Mythic ─────────────────────────────────────────
    /** "Hit … hard, AND apply a strong stacking debuff, AND a chance to reset its own cooldown." */
    active('Ragnarok Strike', 'mythic',
        ['Hit your current target hard.', 'Applies a strong stacking burn.', 'Comes back off cooldown faster.'],
        {
            target: 'enemy_single',
            status: {
                kind: 'dot', duration: TIMED, magnitude: SKILL_DOT_MULTIPLIER,
                scalesWithPwr: true, stacks: 2
            }
        },
        { cooldownSeconds: REFUNDED_COOLDOWN }),
    /** "Restore a large % of max HP, AND cleanse all debuffs, AND a brief +DEF/mitigation buff." */
    active('Aegis of Renewal', 'mythic',
        ['Restore a large share of your maximum HP.', 'Cleanses every debuff on you.', 'Grants yourself a brief +DEF buff.'],
        { target: 'self', heal: SKILL_HEAL_MULTIPLIER, cleanse: true, selfStatus: selfBuff('def') },
        { abilityMultiplier: 0 }),
    /** "A massive wealth-modulated hit …, AND a large Gold burst, AND a chance at a bonus XP burst." */
    active("King's Ransom", 'mythic',
        ['A massive wealth-scaled hit on your current target.', 'Grants a large burst of bonus Gold.', 'Grants a burst of bonus XP.'],
        {
            target: 'enemy_single',
            wealthScaled: true,
            goldBurstMinutes: burst('mythic'),
            xpBurstMinutes: burst('mythic')
        }),

    /** "+SPD% AND +LCK% AND +IMP% (all large)." */
    passive("Ascendant's Grace", 'mythic', ['+SPD.', '+LCK.', '+IMP.'],
        [stat('mythic', 'spd'), stat('mythic', 'lck'), stat('mythic', 'imp')]),
    /** "+Gold gain% AND +XP gain% AND +offline-efficiency% (all large)." */
    passive("Emperor's Treasury", 'mythic', ['+Gold gain.', '+XP gain.', '+Offline efficiency.'],
        [economy('mythic', 'gold'), economy('mythic', 'xp'), economy('mythic', 'offlineEfficiency')]),
    /**
     * "+DEF%/VIT (large), AND a chance to reflect a portion of incoming damage, AND resistance to
     * debuffs."
     *
     * Reflect is real and wired — `fight.ts` already resolves a reflect fraction — with the
     * "chance to" dropped to always-on, the same call `Guardian's Reflect` made and for the same
     * reason: a proc roll would stack a second source of variance on top of crit for no gain.
     * The resistance line is `controlResist`, as above.
     */
    passive('Immortal Vanguard', 'mythic',
        ['+DEF.', 'Reflects part of the damage you take.', 'Shortens debuffs applied to you.'],
        [stat('mythic', 'def'), other('mythic', 'reflect'), other('mythic', 'controlResist')])
]

export const SKILL_BY_ID: Readonly<Record<string, SkillDefinition>> = Object.fromEntries(
    SKILLS.map(entry => [entry.id, entry])
)

export function getSkill(id: string): SkillDefinition {
    const entry = SKILL_BY_ID[id]
    if (!entry) throw new Error(`Unknown skill id: ${id}`)
    return entry
}

export function isSkillId(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(SKILL_BY_ID, id)
}

export function skillsOfRarity(rarity: Rarity): SkillDefinition[] {
    return SKILLS.filter(entry => entry.rarity === rarity)
}

/** All six rarities carry six skills each. */
export function skillRarityHasContent(rarity: Rarity): boolean {
    return SKILLS.some(entry => entry.rarity === rarity)
}

export function skillFromRoll(rarity: Rarity, roll: number): SkillDefinition {
    const pool = skillsOfRarity(rarity)
    if (pool.length === 0) throw new Error(`No Skill authored at rarity: ${rarity}`)
    const index = Math.min(pool.length - 1, Math.floor(Math.min(1, Math.max(0, roll)) * pool.length))
    return pool[index]!
}

export type TrainingGroundsArt = 'barracks' | 'archery_range' | 'wizard_tower'

/**
 * Which art the Training Grounds shows (§1) — Barracks / Archery Range / Wizard Tower.
 *
 * Purely cosmetic: same pool, same currency, same shared gacha level whichever is showing, so
 * re-specializing at prestige swaps the picture and nothing else. Resolved from the **class
 * path** rather than a hard-coded ID list, so a future node added under Mage inherits the Wizard
 * Tower for free instead of silently falling through to the Barracks default.
 */
export function trainingGroundsArt(classId: ClassId): TrainingGroundsArt {
    const path = classPath(classId).map(node => node.id)
    if (path.includes('class_mage')) return 'wizard_tower'
    if (path.includes('class_archer')) return 'archery_range'
    // Warrior line, and Beginner by default — §1's table makes Barracks the unspecialized art.
    return 'barracks'
}

// ── Levelling a copy ───────────────────────────────────

/**
 * potency(star, level) = 1 + (star × 10 + level − 1) × SKILL_POTENCY_PER_POINT
 *
 * **What a levelled Skill copy is worth.** Identity at minimum: a 0★/Lv1 copy returns exactly 1.0,
 * so §4's authored magnitude bands stay the reference point. See `SKILL_POTENCY_PER_POINT` for why
 * this shape rather than Artifacts' proportional one.
 */
export function skillPotency(star: number, level: number): number {
    return 1 + Math.max(0, investmentScalar(star, level) - 1) * SKILL_POTENCY_PER_POINT
}

// ── Equipped skills → the two mechanisms ───────────────

/**
 * Every equipped Passive's modifier lines, at that copy's potency.
 *
 * **Equipped only** — the collection passive every owned copy pays, this one included, is
 * `skillCollectionModifiers`; an equipped Passive pays both.
 *
 * Every line scales, economy lines included: a levelled Merchant's Eye is a better Merchant's Eye.
 * `SKILL_ECONOMY_COEFFICIENT` still holds the Gold family under the combat lines, so §5's stack
 * target moves with the ladder rather than being escaped by it.
 */
export function skillModifiers(equipped: readonly OwnedCopy[]): HqModifier[] {
    return equipped.flatMap((copy) => {
        if (!isSkillId(copy.contentId)) return []
        const definition = getSkill(copy.contentId)
        if (definition.type !== 'passive') return []

        const potency = skillPotency(copy.star, copy.level)
        return (definition.modifiers ?? []).map(line => ({
            ...line,
            magnitude: line.magnitude * potency
        }))
    })
}

/**
 * The collection passive: what every **owned** Passive Skill gives the Hero, equipped or not.
 *
 * Mirrors Gear's `passiveBonus` (decided 2026-09-15 — no doc granted unequipped Skills anything
 * before): each copy contributes `SKILL_COLLECTION_PASSIVE_FRACTION` of its own equipped lines, at
 * its own potency, so levelling a benched Skill still shows up. Only combat-stat kinds pass
 * (`COLLECTION_PASSIVE_KINDS`). Additive with equipping (decided 2026-10-04): an equipped copy
 * pays this as well as its full lines through `skillModifiers`.
 */
export function skillCollectionModifiers(owned: readonly OwnedCopy[]): HqModifier[] {
    return owned.flatMap((copy) => {
        if (!isSkillId(copy.contentId)) return []
        const definition = getSkill(copy.contentId)
        if (definition.type !== 'passive') return []

        const potency = skillPotency(copy.star, copy.level)
        return (definition.modifiers ?? []).flatMap((line) => {
            const share = skillCollectionShare({ ...line, magnitude: line.magnitude * potency })
            return share === null ? [] : [{ ...line, magnitude: share }]
        })
    })
}

/**
 * What one Passive line, at the magnitude it pays equipped, pays through the collection passive
 * while its copy is owned; null for a line that does not pass (`COLLECTION_PASSIVE_KINDS`).
 */
export function skillCollectionShare(line: HqModifier): number | null {
    return COLLECTION_PASSIVE_KINDS.has(line.kind) ? line.magnitude * SKILL_COLLECTION_PASSIVE_FRACTION : null
}

/**
 * Every equipped Active, as a firing kit entry, at that copy's potency.
 *
 * Both halves of "how hard does this hit" scale: the `abilityMultiplier` that drives damage, and
 * the effect's own magnitudes via `scaleEffect` — so a levelled Twin Strike hits harder *and*
 * burns harder, while its cooldown and its burn's duration stay where §4 put them.
 *
 * The `id` is deliberately unchanged by levelling: `fight.ts` keys status instances off it, so a
 * per-level id would make a re-applied burn stack against itself instead of refreshing.
 */
export function skillActives(equipped: readonly OwnedCopy[]): ClassSkill[] {
    return equipped.flatMap((copy) => {
        if (!isSkillId(copy.contentId)) return []
        const definition = getSkill(copy.contentId)
        if (definition.type !== 'active') return []

        const potency = skillPotency(copy.star, copy.level)
        const base = definition.abilityMultiplier ?? SKILL_BASE_ABILITY_MULTIPLIER
        return [{
            id: definition.id,
            name: definition.name,
            // Cooldown is untouched: levelling makes a skill stronger, not more frequent. Cadence
            // is SPD's job and Tempo's, and mixing the two axes here would double-count both.
            cooldownSeconds: definition.cooldownSeconds ?? SKILL_BASE_COOLDOWN_SECONDS,
            abilityMultiplier: base * potency,
            effect: definition.effect === undefined
                ? undefined
                : scaleEffect(definition.effect, potency)
        }]
    })
}

/**
 * The Hero's complete firing kit: the class tree's accumulated skills plus every equipped
 * Training Grounds Active.
 *
 * One function so `fight.ts` and `projection.ts` cannot disagree about what the Hero brings. §7's
 * square-vs-circle UI split is presentation only; mechanically both feed the same cooldown system
 * (§5).
 */
export function heroKit(hero: HeroSnapshot): ClassSkill[] {
    return [...kitFor(hero.classId, hero.ascendantSkillIds), ...skillActives(hero.equippedSkills ?? [])]
}

/** Rarities in ladder order — re-exported so a Skills-facing caller has one import. */
export { RARITIES, RARITY_EFFECT_LINES }
