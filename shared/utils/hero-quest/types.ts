/**
 * Shared shapes for Hero Quest.
 *
 * Structural only — no behaviour lives here. Every downstream module needs the same types, and
 * housing them in `stats.ts` would force `content/classes.ts` to import upward from its own
 * consumer.
 */

import type { Decimal } from './numbers'
import type { AbilityEffect } from './effects'

export type HqStatKey = 'pwr' | 'spd' | 'lck' | 'imp' | 'vit' | 'def'

/** The four weighting tiers used by the class spread table (`classes-and-combat.md` §2). */
export type StatTier = 'low' | 'mid' | 'mid_high' | 'high'

/**
 * The 6 main stats, identical for Hero and Champions. HP and EVA are secondary — HP is
 * derived from VIT, EVA is granted only by external sources (Traits, Phase 4).
 *
 * **Decimal, not `number`** — stat growth is geometric (`STAT_PER_LEVEL_GROWTH`), so a float
 * block overflows to `Infinity` at a hero level unbounded prestige reaches. Everything
 * downstream — damage, HP, mitigation — is Decimal too.
 */
export type HqStatBlock = Record<HqStatKey, Decimal>

/**
 * A class node's specialization shift, authored as plain numbers.
 *
 * Deliberately **not** `Partial<HqStatBlock>`: these are small hand-written content values
 * (`DELTA_MODEST`, `-DELTA_NORMAL`, …) and forcing 16 content rows to wrap every entry in
 * `D()` would buy nothing — they are converted once, in `baseSpreadFor`, at the boundary
 * where the block is built.
 */
export type HqStatDelta = Partial<Record<HqStatKey, number>>

export type ClassId =
    | 'class_beginner'
    | 'class_warrior'
    | 'class_barbarian'
    | 'class_berserker'
    | 'class_knight'
    | 'class_paladin'
    | 'class_mage'
    | 'class_wizard'
    | 'class_sorcerer'
    | 'class_shaman'
    | 'class_witch_doctor'
    | 'class_archer'
    | 'class_bowman'
    | 'class_marksman'
    | 'class_hunter'
    | 'class_beast_master'

export type ClassTier = 'beginner' | 'base' | 'elite' | 'master'

/**
 * Autoattack target selection (`classes-and-combat.md` §7).
 *
 * ⚠ Authored on every class node and archetype but **not yet read by combat** — `fight.ts`
 * focuses the front-most living enemy regardless. Only the wiki displays it.
 */
export type AutoTarget = 'lowest_hp_pct' | 'highest_pwr'

/**
 * A position on the flat 3-front / 3-back grid (`classes-and-combat.md` §6).
 *
 * Rows are **capacities, not quotas**: a party smaller than 6 leaves positions empty, in any
 * split it likes, and an empty front row is legal. What the row actually decides is who the
 * enemy is allowed to hit — see `targetingOrder`.
 */
export type FormationRow = 'front' | 'back'

/** The four Champion archetypes (`champions-guild-gacha.md` §1). No class node involved. */
export type ChampionArchetype = 'damage' | 'tank' | 'support' | 'control'

/** The shared 6-tier rarity ladder, identical across all four gachas. */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic'

/**
 * One owned copy of anything from any of the four gachas, as the math layer needs it.
 *
 * Exactly the three columns that decide a copy's power: what it is, and how far it has been
 * levelled. `star` and `level` collapse to the `(star × 10 + level)` investment scalar that Gear,
 * Artifacts and the Champion passive all read (`gacha-shared-system.md` §6), so one shape serves
 * all four systems — the same reason `hqCollection` is one table.
 *
 * Deliberately *not* the DB row: `hqCollection` also carries `userId`, `system`, `dupeProgress`
 * and `acquiredAt`, none of which any formula reads.
 */
export interface OwnedCopy {
    contentId: string
    /** 0–5. */
    star: number
    /** 1–10 within the current star. */
    level: number
}

/** A named ability — a class node's skill, a Champion ability, or an equipped Skill Active. */
export interface ClassSkill {
    /**
     * What this ability does beyond raw damage, and who it lands on.
     *
     * Optional, defaulting to `effects.SINGLE_TARGET`, so a content entry with nothing
     * distinctive to say stays a one-line declaration.
     */
    effect?: AbilityEffect
    /** Stable string ID — DB rows and loadouts reference IDs only, never indices. */
    id: string
    name: string
    /** Base cooldown before SPD shortens it (`combat.cooldownFor`). */
    cooldownSeconds: number
    /** Multiplier on the damage formula's `abilityMultiplier` term. */
    abilityMultiplier: number
}

export interface ClassNode {
    id: ClassId
    name: string
    parentId: ClassId | null
    tier: ClassTier
    skill: ClassSkill
    spread: Record<HqStatKey, StatTier>
    /** Specialization shift, applied cumulatively down the class path. */
    delta: HqStatDelta
    /** Baked into the kit, not a stat — see each node in `content/classes.ts`. */
    strikesPerAttack: number
    autoTarget: AutoTarget
    /** Suggested row only — every slot stays manually reassignable (`classes-and-combat.md` §6). */
    defaultRow: FormationRow
}

/** A combat-ready unit: stat block resolved into the values the damage formulas consume. */
export interface UnitStats {
    pwr: Decimal
    def: Decimal
    maxHp: Decimal
    attacksPerSecond: number
    /**
     * Where this unit stands. Load-bearing for survivability, not cosmetic: the enemy's
     * single attack stream chews through the front row before the back row is targetable at
     * all, so this is what makes a Tank worth fielding.
     */
    row: FormationRow
    /**
     * Kept alongside `attacksPerSecond` rather than folded into it, because SPD drives two
     * separate things: the autoattack interval (already folded) and skill cooldowns (which
     * `fight.ts` derives per skill). Recovering it by inverting `attackIntervalFor` would be
     * lossy — that function clamps at both ends.
     */
    spd: Decimal
    /**
     * The SPD skill cooldowns read: `spd` without the level curve, every multiplier kept. On the
     * curve cooldowns hit `MIN_COOLDOWN_SECONDS` by level ~200 and skills fired back to back.
     */
    cooldownSpd: Decimal
    strikesPerAttack: number
    /**
     * How hard this unit pulls enemy attacks **within the row it stands in**.
     *
     * A weight, not a stat: it never makes a back-lined unit targetable while the front row
     * stands (`champions-guild-gacha.md` §8.4). `BASE_THREAT` for everyone except the Tank
     * archetype and the Warrior class path, which are the game's two documented aggro anchors.
     */
    threat: number
    /** A probability, so it stays a `number` — clamped to [0, 1] by `critChanceFor`. */
    critChance: number
    /** Decimal: IMP is unbounded, so the crit multiplier it drives is too. */
    critMultiplier: Decimal
    eva: number
    /**
     * Multiplier on every one of this unit's skill cooldowns, from Artifacts' Tempo category.
     *
     * Kept off SPD deliberately: SPD also drives the autoattack interval, so folding a
     * cooldown-only bonus into it would silently speed up basic attacks too. 1 means untouched.
     */
    cooldownFactor: number
    /** Fraction of incoming damage this unit reflects, from passive modifiers. */
    reflectFraction: number
}

/**
 * One enemy's stats. **Not** a claim about how many are present — see `EnemyPack`.
 *
 * Every pairwise formula in `combat.ts` resolves against exactly one of these, so packs never
 * touch the damage model.
 */
export interface EnemyStats {
    hp: Decimal
    pwr: Decimal
    def: Decimal
}

/**
 * One encounter's worth of enemies (`classes-and-combat.md` §7).
 *
 * Members are **individually addressable** rather than a `{ template, count }` pair, because
 * every targeting rule the docs specify selects *among* enemies — "lowest-HP% enemy",
 * "highest-PWR enemy", "chains between enemies", "hits 3 random enemies". A count cannot
 * express a mixed pack, and boss encounters are mixed: `BOSS_MINION_COUNT` minions, then the
 * boss (`settle.enemyPackAt`).
 */
export interface EnemyPack {
    readonly members: readonly EnemyStats[]
}

export type StageArchetype = 'wave' | 'boss' | 'elite' | 'super_boss'

export interface RunPosition {
    prestige: number
    world: number
    stage: number
    killsInStage: number
}

/**
 * A fielded Champion, as far as the math layer is concerned.
 *
 * Champions have **no XP level of their own** — they level only by consuming duplicates, on
 * the `(star × 10 + level)` scalar shared by all four gachas (`gacha-shared-system.md` §6),
 * which is bounded at 60. Their unbounded axis is the Hero's level, which is what keeps them
 * from becoming dead weight against a curve that never stops.
 */
export interface ChampionSnapshot {
    /** Stable string ID, never an index. */
    championId: string
    archetype: ChampionArchetype
    /** Flat rarity multiplier, Common 1.0 → Mythic 2.5 (`champions-guild-gacha.md` §2). */
    rarityMultiplier: number
    /** The gacha investment scalar, `star × 10 + level`: 1 at 0★/Lv1, 60 at 5★/Lv10. */
    investment: number
    /** Baked into the kit, exactly as for the Hero's class node. */
    strikesPerAttack: number
    /** Where the player has actually placed it, defaults from the archetype (§8.1). */
    row: FormationRow
    /**
     * This Champion's own abilities, 1–3 by rarity (`champions-guild-gacha.md` §2).
     *
     * Carried on the snapshot rather than looked up from `championId` inside `fight.ts`,
     * because everything else content-derived on this type is already denormalized the same
     * way (`archetype`, `rarityMultiplier`, `strikesPerAttack`) — the server resolves content
     * once at the boundary and the sim hands the shape whatever it wants to measure.
     *
     * **Required, deliberately.** If optional, a caller could omit it and abilities authored in
     * content would silently never reach combat. An omission should be a type error.
     */
    abilities: readonly ClassSkill[]
}

export interface HeroSnapshot {
    classId: ClassId
    /** Overrides the class node's `defaultRow` when the player has moved the Hero. */
    heroRow?: FormationRow
    heroLevel: number
    /** Progress toward the next level. Decimal — it rides the same curve as enemy scaling. */
    heroXp: Decimal
    /**
     * Additive Gold% from sources outside the modifier pipeline.
     *
     * Skills and Artifacts no longer come through here — they declare `gold` modifier lines and
     * `stats.economyBonuses` sums them, so this channel is for anything that has no content entry
     * to hang a modifier on (a future prestige-shop Gold% track, an event bonus). Stays additive
     * with the modifier total, per `gold-economy.md` §5.
     */
    goldBonusPct: number
    offlineEfficiencyLevel: number
    offlineCapLevel: number

    /**
     * **Every owned Gear piece**, equipped or not — an unequipped piece still pays a smaller
     * passive (`gear-equipment.md` §3), so unlike Skills and Artifacts the whole collection is
     * the input here.
     */
    ownedGear?: readonly OwnedCopy[]
    /**
     * Gear slot → contentId. The player's **manual** choice (§3, revised from auto-equip), which
     * is why it has to be persisted rather than derived: the strongest owned piece and the
     * equipped one are allowed to differ, and closing that gap is the player's job.
     */
    equippedGear?: Readonly<Record<string, string>>
    /**
     * Equipped Skills only, up to the purchased slot count. Actives join the Hero's firing kit;
     * Passives fold into the stat pipeline at full strength.
     */
    equippedSkills?: readonly OwnedCopy[]
    /**
     * **Every owned Skill**, equipped or not. Unequipped Passives pay the Hero a small collection
     * passive (`skillCollectionModifiers`); equipped copies are skipped there, since
     * `equippedSkills` already pays them in full.
     */
    ownedSkills?: readonly OwnedCopy[]
    /**
     * Equipped Artifacts only. **Party-wide** — every one applies to the Hero and every fielded
     * Champion alike (`artifacts-dig-site-gacha.md` §1), which is what separates them from Gear.
     */
    equippedArtifacts?: readonly OwnedCopy[]
    /**
     * **Every owned Artifact**, equipped or not. Unequipped copies pay a small, Hero-only collection
     * passive (`artifactCollectionModifiers`).
     */
    ownedArtifacts?: readonly OwnedCopy[]
    /**
     * Hours of the player's *current* Gold income sitting banked — the Gambler's Strike family's
     * only input (`skills-gacha.md` §4¹).
     *
     * Resolved by the caller and passed in rather than computed here, because the party's own rate
     * is what denominates it: banked Gold ÷ Gold-per-hour is self-referential once a wealth-scaled
     * ability affects DPS. The server resolves it against the wealth-neutral rate — one iteration,
     * stated rather than pretended away. Absent means exactly 1.0, the neutral factor.
     */
    wealthHours?: number
    /** Fielded party, up to the purchased slot count. */
    champions?: readonly ChampionSnapshot[]
    /**
     * **Every owned Champion, fielded or not** — the input to the §7 passive collection
     * bonus. Deliberately separate from `champions`: the passive is what makes pulling
     * broadly worth doing, while `champions` is what makes fielding well worth doing, and
     * conflating them would collapse the two reward loops into one.
     */
    ownedChampions?: readonly { archetype: ChampionArchetype; investment: number }[]
}

export interface SettleInput {
    hero: HeroSnapshot
    position: RunPosition
    elapsedSeconds: number
    online: boolean
    /**
     * Wall-clock age of the account in days, measured at the **start** of this window.
     *
     * Feeds the Gold tenure ceiling (`GOLD_TENURE_CEILING`). Taking it at the window's start
     * rather than its end is the conservative reading: the ceiling only climbs, so a long
     * offline window is paid at the price the account had when it went away.
     */
    tenureDays: number
    /**
     * Progress toward the *next* kill carried in from the previous window, in kills — always
     * in `[0, 1)`.
     *
     * Without it a settle is lossy by up to one whole kill, and every read is a settle (polling,
     * mutations, reloads). A player refreshing faster than `secondsPerKill` would earn nothing
     * at all, because each window floors to zero kills.
     *
     * Carried in **kills rather than seconds**, which is what makes it safe to bank. Seconds are
     * only worth kills at the rate that measured them, so a player parked at a wall would
     * accumulate hours of unspent time and cash it all the moment an upgrade cut the rate. A
     * fraction of a kill is a fraction of a kill at any rate, and can never exceed one.
     */
    killFraction?: number
    /** Battle Speed. Not wired up yet — every caller passes `undefined`. */
    speedBoost?: { multiplier: number; overlapSeconds: number }
}

export interface SettleResult {
    position: RunPosition
    kills: number
    goldEarned: number
    xpEarned: Decimal
    /**
     * Hero level *after* the window. The whole window is fought at the departure level —
     * `idle-mechanics.md` §4 forbids re-simulating leveling mid-projection — so levels
     * gained land in one step at the end.
     */
    heroLevel: number
    /** Progress toward the next level once `heroLevel` has absorbed everything it can. */
    heroXp: Decimal
    secondsPerKill: number
    /** True when accrual stopped at a boss gate — offline never resolves a boss. */
    blockedAtBoss: boolean
    /**
     * True when the party cannot outlast a wave stage's kill requirement, so the stage
     * restarts instead of clearing. The run holds position and keeps earning; it is a wall
     * levelling resolves, not a fallback.
     */
    wipedOnWave: boolean
    effectiveSeconds: number
    /**
     * What is left over toward the next kill, in `[0, 1)` — persist it and hand it back as the
     * next window's `killFraction` or the window is lossy. See that field for why.
     */
    killFraction: number
}
