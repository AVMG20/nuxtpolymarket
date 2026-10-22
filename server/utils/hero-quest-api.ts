/**
 * Hero Quest's wire contract (issue #27): every route's request body and response, by name.
 *
 * One file, so the shape of a payload is read here rather than reverse-engineered from a serializer.
 * The serializers and the action functions return these types, so a field added on one side and not
 * the other fails the typecheck; the client (`useHeroQuest`) imports them with `import type`.
 *
 * The roster payloads (`GuildPayload`, `ForgePayload`, `TrainingPayload`, `DigSitePayload`,
 * `LoadoutsPayload`) live beside their serializers in `hero-quest.ts`, as they did before, and are
 * re-exported here.
 *
 * Numbers: Decimals go out as strings, untouched. A float that is only ever shown is rounded at the
 * serializer (`roundHq`, `roundHqFraction`); a float the client feeds back into the shared sim or
 * its between-poll projection (`killFraction`, `secondsPerKill`, `tenureDays`, the Gold and XP
 * bonuses, cooldowns, fight logs) goes out exact.
 *
 * Bodies are read with `readHqBody`, which checks every field against its rule and answers the
 * route's own 400 for the first that fails, then hands back only the declared fields.
 */

import type { H3Event } from 'h3'
import type { ArenaCandidate } from '#server/utils/hero-quest-arena'
import type { DevGrant, DevSet, DevSkipResult, DevUnlock, SkipMode } from '#server/utils/hero-quest-dev'
import type { DigSitePayload, ForgePayload, GuildPayload, LoadoutsPayload, TrainingPayload } from '#server/utils/hero-quest'
import type { ArenaDefenseLoadout, ArenaShopItem } from '#shared/utils/hero-quest/arena'
import type { HqAwayReport } from '#shared/utils/hero-quest/away-report'
import { isBattleSpeedDuration, isBattleSpeedTier, type BattleSpeedDuration, type BattleSpeedTier } from '#shared/utils/hero-quest/battle-speed'
import type { CalendarDayState } from '#shared/utils/hero-quest/calendar'
import { ARENA_SHOP_MAX_QUANTITY, MAX_TRAIT_SAVE_SLOTS, TEN_PULL_SIZE, TRAIT_SLOT_COUNT, type CalendarReward, type HqFeature } from '#shared/utils/hero-quest/constants'
import { isHolidayId, type HolidayId } from '#shared/utils/hero-quest/content/holidays'
import type { PassivePath } from '#shared/utils/hero-quest/content/passive-tree'
import { isRaidId, type RaidId } from '#shared/utils/hero-quest/content/raids'
import { isShopTrackId, type ShopCurrency, type ShopTrackId } from '#shared/utils/hero-quest/content/shop'
import { isTraitGrade } from '#shared/utils/hero-quest/content/traits'
import type { FightEvent, FightOutcome } from '#shared/utils/hero-quest/fight'
import { isGachaSystem, type GachaSystem } from '#shared/utils/hero-quest/gacha'
import { isLoadoutTarget, type LoadoutPreferences, type LoadoutTarget } from '#shared/utils/hero-quest/loadout-session'
import type { MilestoneReward, MilestoneRow } from '#shared/utils/hero-quest/milestones'
import type { PassiveBuyBlock } from '#shared/utils/hero-quest/passive-tree'
import { isHqSettingKey, isHqSettingValue, type HqSettingKey, type HqSettings } from '#shared/utils/hero-quest/settings'
import { isTutorialRecord, type TutorialRecord } from '#shared/utils/hero-quest/tutorials'
import type { TraitAutoRollStop } from '#shared/utils/hero-quest/traits'
import type {
    ClassId,
    ClassSkill,
    ClassTier,
    FormationRow,
    HqStatKey,
    OfflineWindow,
    Rarity,
    RunPosition,
    StageArchetype,
    TraitGrade,
    TraitSetId,
    TraitStatId
} from '#shared/utils/hero-quest/types'

// ── Reading a body ─────────────────────────────────────────────────────────────────

/**
 * One body field's rule: the check its value has to pass, and the 400 the route answers when it
 * doesn't. A field the type marks optional says so with `optional`, and the route fills its default.
 *
 * `read` is how the route has always taken the raw value, applied before anything else: an index
 * sent as `"2"` or `2.7` reads as 2, a flag is on only when it is `true`. A read that gives
 * `undefined` leaves an optional field out, as if it had not been sent.
 */
interface FieldRule<V> {
    read?: (value: unknown) => unknown
    check: (value: unknown) => value is Exclude<V, undefined>
    message: string
}

type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T]

/** A rule for every field of the request type `T`, checked in the order they are written. */
export type BodySchema<T> = {
    [K in keyof T]-?: K extends OptionalKeys<T>
        ? FieldRule<T[K]> & { optional: true }
        : FieldRule<T[K]> & { optional?: never }
}

/**
 * Check a body against its schema. A missing body reads as an empty one, so a route with every
 * field optional takes none; the first field that breaks its rule answers that rule's 400. Returns
 * only the declared fields.
 */
export function validateHqBody<T>(body: unknown, schema: BodySchema<T>): T {
    const source = isRecord(body) ? body : {}
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(schema) as (keyof T & string)[]) {
        const rule = schema[key] as { read?: (value: unknown) => unknown, check: (value: unknown) => boolean, message: string, optional?: boolean }
        const value = rule.read ? rule.read(source[key]) : source[key]
        if (value === undefined && rule.optional) continue
        if (!rule.check(value)) throw createError({ statusCode: 400, statusMessage: rule.message })
        out[key] = value
    }
    return out as T
}

/** `readBody`, checked against the route's request type. */
export async function readHqBody<T>(event: H3Event, schema: BodySchema<T>): Promise<T> {
    return validateHqBody(await readBody<unknown>(event), schema)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isIdList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)
const indexBelow = (max: number) => (value: unknown): value is number => isIndex(value) && value < max
const intBetween = (lo: number, hi: number) => (value: unknown): value is number => Number.isInteger(value) && (value as number) >= lo && (value as number) <= hi
const isGacha = (value: unknown): value is GachaSystem => isString(value) && isGachaSystem(value)

// how the routes have always read a raw value (see `FieldRule.read`)
/** A number sent as text counts. */
const asNumber = (value: unknown) => Number(value)
/** A number sent as text counts, and a fraction rounds down. */
const asWhole = (value: unknown) => Math.floor(Number(value))
/** Like `asWhole`, but null reads as left out: the route's `?? default`. */
const asWholeOrDefault = (value: unknown) => value === undefined || value === null ? undefined : asWhole(value)
/** On only when it is `true`; anything else is off. */
const asFlag = (value: unknown) => value === true
// ── Requests ───────────────────────────────────────────────────────────────────────

export interface HqArenaAttackRequest {
    /** The list slot, and who the player saw in it: a list redrawn in between refuses the attack. */
    slot: number
    opponent: string
}
export const ARENA_ATTACK_BODY: BodySchema<HqArenaAttackRequest> = {
    slot: { read: asNumber, check: isIndex, message: 'Pick an opponent from the list' },
    opponent: { check: isString, message: 'Pick an opponent from the list' }
}

export interface HqArenaShopBuyRequest {
    itemId: string
    /** One by default. */
    quantity?: number
}
export const ARENA_SHOP_BUY_BODY: BodySchema<HqArenaShopBuyRequest> = {
    itemId: { check: isString, message: 'Unknown item' },
    quantity: { read: asWholeOrDefault, check: intBetween(1, ARENA_SHOP_MAX_QUANTITY), message: `Buy between 1 and ${ARENA_SHOP_MAX_QUANTITY}`, optional: true }
}

export interface HqAwayDismissRequest {
    id: string
}
export const AWAY_DISMISS_BODY: BodySchema<HqAwayDismissRequest> = {
    id: { check: isString, message: 'Missing report id' }
}

export interface HqCalendarClaimRequest {
    /** Claim the oldest missed day rather than today's; only `true` does. */
    makeup?: boolean
}
export const CALENDAR_CLAIM_BODY: BodySchema<HqCalendarClaimRequest> = {
    makeup: { read: asFlag, check: isBoolean, message: 'Say whether it is a make-up', optional: true }
}

/** Bulk Seal buys are priced rung by rung, so this bounds the loop and the Gold spent per call. */
export const MAX_SEALS_PER_PURCHASE = 10

export interface HqBuySealsRequest {
    system: GachaSystem
    /** One by default. */
    count?: number
}
export const BUY_SEALS_BODY: BodySchema<HqBuySealsRequest> = {
    system: { check: isGacha, message: 'Unknown gacha' },
    count: { read: asWholeOrDefault, check: intBetween(1, MAX_SEALS_PER_PURCHASE), message: `Buy between 1 and ${MAX_SEALS_PER_PURCHASE} Seals at a time`, optional: true }
}

export interface HqCraftRequest {
    system: GachaSystem
    contentId: string
}
export const CRAFT_BODY: BodySchema<HqCraftRequest> = {
    system: { check: isGacha, message: 'Unknown gacha' },
    contentId: { check: isString, message: 'Unknown item' }
}

export interface HqPullRequest {
    system: GachaSystem
    /** 10 for a 10-pull; anything else is a single. A free pull is always ten and ignores it. */
    count?: 1 | 10
    /** Spend one of the day's free 10-pulls instead of Seals; only `true` does. */
    free?: boolean
    /** Buy the Seals the pull is short off the day's Gold ladder, at no more than `maxGold`: the price the button showed. */
    autoBuy?: { maxGold: number }
}
export const PULL_BODY: BodySchema<HqPullRequest> = {
    system: { check: isGacha, message: 'Unknown gacha' },
    count: { read: value => value === TEN_PULL_SIZE ? TEN_PULL_SIZE : 1, check: (value): value is 1 | 10 => value === 1 || value === 10, message: 'Pull one or ten at a time', optional: true },
    free: { read: asFlag, check: isBoolean, message: 'Say whether the pull is free', optional: true },
    autoBuy: {
        // a price sent as text counts; one that is missing or not a number is refused
        read: value => value === undefined ? undefined : { maxGold: Number((value as { maxGold?: unknown } | null)?.maxGold) },
        check: (value): value is { maxGold: number } => isRecord(value) && isNumber(value.maxGold) && value.maxGold >= 0,
        message: 'An auto-buy needs the price it was shown',
        optional: true
    }
}

export interface HqHolidayClaimRequest {
    holidayId: HolidayId
}
export const HOLIDAY_CLAIM_BODY: BodySchema<HqHolidayClaimRequest> = {
    holidayId: { check: isHolidayId, message: 'Unknown holiday' }
}

export interface HqLoadoutSlotRequest {
    slotIndex: number
}
export const LOADOUT_APPLY_BODY: BodySchema<HqLoadoutSlotRequest> = {
    slotIndex: { read: asWhole, check: isIndex, message: 'Pick a loadout slot' }
}

export interface HqLoadoutRenameRequest {
    slotIndex: number
    name: string
}
export const LOADOUT_RENAME_BODY: BodySchema<HqLoadoutRenameRequest> = {
    slotIndex: { read: asWhole, check: isIndex, message: 'Pick a loadout slot' },
    name: { check: (value): value is string => isString(value) && value.trim().length > 0, message: 'Name the loadout' }
}

export interface HqLoadoutSaveRequest {
    slotIndex: number
    /** "Loadout N" when left out, blank or not text. */
    name?: string
}
export const LOADOUT_SAVE_BODY: BodySchema<HqLoadoutSaveRequest> = {
    slotIndex: { read: asWhole, check: isIndex, message: 'Pick a loadout slot' },
    name: { read: value => isString(value) ? value : undefined, check: isString, message: 'Name the loadout', optional: true }
}

export interface HqLoadoutPreferenceRequest {
    target: LoadoutTarget
    /** The saved slot the target applies on a fresh engage; null (or left out) for none. */
    slotIndex?: number | null
}
export const LOADOUT_PREFERENCE_BODY: BodySchema<HqLoadoutPreferenceRequest> = {
    target: { check: isLoadoutTarget, message: 'Unknown raid' },
    slotIndex: {
        read: value => value === undefined || value === null ? null : asWhole(value),
        check: (value): value is number | null => value === null || isIndex(value),
        message: 'Pick a loadout slot',
        optional: true
    }
}

/** Any part of the live loadout; a field left out stays as it is (`loadout/set.post.ts`). */
export interface HqLoadoutSetRequest {
    championIds?: string[]
    /** Null keeps the stored formation (refiltered to the party). */
    formation?: Record<string, FormationRow> | null
    skillIds?: string[]
    artifactIds?: string[]
    /** A null or empty id clears its slot. */
    gear?: Record<string, string | null>
    ascendantSkillIds?: string[]
}
export const LOADOUT_SET_BODY: BodySchema<HqLoadoutSetRequest> = {
    championIds: { check: isIdList, message: 'championIds must be an array of ids', optional: true },
    // which rows are legal is `validateLiveLoadout`'s to say, with the unit named
    formation: { check: (value): value is Record<string, FormationRow> | null => value === null || isRecord(value), message: 'formation must map each unit to a row', optional: true },
    skillIds: { check: isIdList, message: 'skillIds must be an array of ids', optional: true },
    artifactIds: { check: isIdList, message: 'artifactIds must be an array of ids', optional: true },
    // which slots and pieces are legal is `validateLiveLoadout`'s to say, with the slot or piece named
    gear: { check: (value): value is Record<string, string | null> => isRecord(value), message: 'gear must be a slot → item map', optional: true },
    ascendantSkillIds: { check: isIdList, message: 'ascendantSkillIds must be an array of ids', optional: true }
}

export interface HqMilestonesClaimRequest {
    track: string
}
export const MILESTONES_CLAIM_BODY: BodySchema<HqMilestonesClaimRequest> = {
    track: { check: isString, message: 'Pick a milestone' }
}

export interface HqPickClassRequest {
    classId: string
}
export const PICK_CLASS_BODY: BodySchema<HqPickClassRequest> = {
    classId: { check: isString, message: 'classId is required' }
}

export interface HqRaidRequest {
    raidId: RaidId
}
export const RAID_BODY: BodySchema<HqRaidRequest> = {
    raidId: { check: isRaidId, message: 'Unknown raid' }
}

/** One setting and its new value, the value of that setting's own kind (`isHqSettingValue`). */
export type HqSettingRequest = { [K in HqSettingKey]: { key: K, value: HqSettings[K] } }[HqSettingKey]
interface HqSettingFields {
    key: HqSettingKey
    value: HqSettings[HqSettingKey]
}
const SETTING_FIELDS: BodySchema<HqSettingFields> = {
    key: { check: isHqSettingKey, message: 'Unknown setting' },
    value: { check: (value): value is HqSettings[HqSettingKey] => isBoolean(value) || isString(value), message: 'Unknown setting' }
}

/** The fields alone cannot say a switch takes only a boolean and a pick only its choices: the pair is checked here. */
export function validateSettingBody(body: unknown): HqSettingRequest {
    const { key, value } = validateHqBody(body, SETTING_FIELDS)
    if (!isHqSettingValue(key, value)) throw createError({ statusCode: 400, statusMessage: 'Unknown setting' })
    return { key, value } as HqSettingRequest
}

export interface HqShopBuyRequest {
    upgradeId: ShopTrackId
}
export const SHOP_BUY_BODY: BodySchema<HqShopBuyRequest> = {
    upgradeId: { check: (value): value is ShopTrackId => isString(value) && isShopTrackId(value), message: 'Unknown upgrade' }
}

export interface HqSpeedBuyRequest {
    speed: BattleSpeedTier
    minutes: BattleSpeedDuration
}
export const SPEED_BUY_BODY: BodySchema<HqSpeedBuyRequest> = {
    speed: { check: isBattleSpeedTier, message: 'Unknown Battle Speed block' },
    minutes: { check: isBattleSpeedDuration, message: 'Unknown Battle Speed block' }
}

export interface HqTraitAutoRollRequest {
    /** Stop once a rerolled slot lands at this grade or better. */
    minGrade: TraitGrade
}
export const TRAIT_AUTO_ROLL_BODY: BodySchema<HqTraitAutoRollRequest> = {
    minGrade: { check: isTraitGrade, message: 'Pick a grade to stop at' }
}

export interface HqTraitSaveSlotRequest {
    saveSlotIndex: number
}
export const TRAIT_SAVE_SLOT_BODY: BodySchema<HqTraitSaveSlotRequest> = {
    saveSlotIndex: { read: asNumber, check: indexBelow(MAX_TRAIT_SAVE_SLOTS), message: 'Pick a Trait save slot' }
}

export interface HqTraitLockRequest {
    slotIndex: number
    /** The state to set, not a toggle, so a double-tap can't undo itself. */
    locked: boolean
}
export const TRAIT_LOCK_BODY: BodySchema<HqTraitLockRequest> = {
    slotIndex: { read: asNumber, check: indexBelow(TRAIT_SLOT_COUNT), message: 'Pick a Trait slot' },
    locked: { check: isBoolean, message: 'Say whether to lock it' }
}

export interface HqTreeBuyRequest {
    nodeId: string
}
export const TREE_BUY_BODY: BodySchema<HqTreeBuyRequest> = {
    nodeId: { check: isString, message: 'Pick a node' }
}

export interface HqTutorialSeenRequest {
    id: TutorialRecord
}
export const TUTORIAL_SEEN_BODY: BodySchema<HqTutorialSeenRequest> = {
    id: { check: isTutorialRecord, message: 'Unknown tutorial' }
}

// the playtest harness's bodies, typed in `hero-quest-dev.ts`; a number sent as text counts, as it always has
const asDevNumber = (value: unknown) => value === undefined ? undefined : Number(value)
/** A currency to grant: `devGrant` skips a zero (or a null, which reads as one). */
const devCount = (field: string) => ({ read: asDevNumber, check: (value: unknown): value is number => isNumber(value) && value >= 0, message: `${field} must be a non-negative number`, optional: true as const })
/** A position or level to set: `devSet` and `devUnlock` floor and clamp it into range. */
const devNumber = (field: string) => ({ read: asDevNumber, check: isNumber, message: `${field} must be a number`, optional: true as const })
/** A switch: anything truthy turns it on, as `Boolean()` always read it. */
const devSwitch = { read: (value: unknown) => value === undefined ? undefined : Boolean(value), check: isBoolean, optional: true as const }

export type HqDevGrantRequest = DevGrant
export const DEV_GRANT_BODY: BodySchema<HqDevGrantRequest> = {
    gold: devCount('gold'),
    gems: devCount('gems'),
    voidShards: devCount('voidShards'),
    seals: devCount('seals'),
    essence: devCount('essence'),
    traitGems: devCount('traitGems'),
    medals: devCount('medals')
}

export type HqDevSetRequest = DevSet
export const DEV_SET_BODY: BodySchema<HqDevSetRequest> = {
    prestige: devNumber('prestige'),
    world: devNumber('world'),
    stage: devNumber('stage'),
    killCount: devNumber('killCount'),
    heroLevel: devNumber('heroLevel'),
    heroNodeId: { check: isString, message: 'heroNodeId must be a class id', optional: true },
    runCleared: { ...devSwitch, message: 'runCleared must be true or false' },
    bossLost: { ...devSwitch, message: 'bossLost must be true or false' }
}

export type HqDevUnlockRequest = DevUnlock
export const DEV_UNLOCK_BODY: BodySchema<HqDevUnlockRequest> = {
    systems: { check: (value): value is GachaSystem[] => Array.isArray(value) && value.every(isGacha), message: 'systems must list gachas', optional: true },
    star: devNumber('star'),
    level: devNumber('level'),
    maxShop: { ...devSwitch, message: 'maxShop must be true or false' }
}

export interface HqDevSkipRequest {
    /** One by default. */
    hours?: number
    /** Offline unless it is `online`. */
    mode?: SkipMode
}
export const DEV_SKIP_BODY: BodySchema<HqDevSkipRequest> = {
    // `skipPlan` refuses one that is not positive, or past the cap, with its own 400
    hours: { read: value => value === undefined || value === null ? undefined : Number(value), check: isNumber, message: 'hours must be a positive number', optional: true },
    mode: { read: value => value === 'online' ? 'online' : 'offline', check: (value): value is SkipMode => value === 'offline' || value === 'online', message: 'mode is offline or online', optional: true }
}

// ── The state read (`state.get.ts`) ────────────────────────────────────────────────

/** The run: where it stands, the enemy, and what it earns. */
export interface HqRunPayload {
    prestige: number
    world: number
    stage: number
    worldName: string
    enemyName: string
    archetype: StageArchetype
    killCount: number
    /** The banked part of the next kill, exact: the client's projection resumes from it. */
    killFraction: number
    /** Wipe recovery still owed, exact, for the projection. */
    recoverySeconds: number
    killsRequired: number
    atBossGate: boolean
    runCleared: boolean
    bossLost: boolean
    bossTimerSeconds: number
    progress: { cleared: number, total: number }
    worldCount: number
    stagesPerWorld: number
    /** Per enemy, not per pack: `packSize` says how many stand. */
    enemyHp: string
    enemyPwr: string
    enemyDef: string
    packSize: number
    packHp: string
    partyDps: string
    /** Exact: the projection walks kills on it. Null when the party can't kill. */
    secondsPerKill: number | null
    secondsPerPack: number | null
    goldPerKill: number
    goldPerHour: number
    /** Account age in days, exact: the projection prices Gold off it. */
    tenureDays: number
    goldCappedByTenure: boolean
    /** Exact, as fractions: the projection multiplies by them. */
    goldBonusPct: number
    xpBonusPct: number
    offlineEfficiency: number
    killsBeforeWipe: number | null
    walled: boolean
}

/** A unit's kit on its live cooldowns, exact: what the battle stage times its swings and casts by. */
export interface HqUnitKit {
    id: string
    attackSeconds: number
    strikesPerAttack: number
    skills: { id: string, cooldownSeconds: number, damaging: boolean }[]
}

export interface HqHeroPayload {
    classId: ClassId
    className: string
    tier: ClassTier
    level: number
    xp: string
    xpToNextLevel: string
    xpProgress: number
    skills: ClassSkill[]
    kits: HqUnitKit[]
    stats: {
        pwr: string
        def: string
        maxHp: string
        spd: string
        attacksPerSecond: number
        strikesPerAttack: number
        critChance: number
        critMultiplier: string
        eva: number
    }
    /** The Global Power Number and the two sums it is the geometric mean of. */
    power: { gpn: string, dps: string, ehp: string }
}

export interface HqShopTrackPayload {
    id: ShopTrackId
    name: string
    description: string
    level: number
    /** Null for an uncapped track. */
    maxLevel: number | null
    currency: ShopCurrency
    /** Null once maxed. */
    nextCost: number | null
    effect: { current: string, next: string | null }
}

export interface HqClassNodePayload {
    id: ClassId
    name: string
    parentId: ClassId | null
    tier: ClassTier
    skill: ClassSkill
    seen: boolean
    pickable: boolean
    /** Taking it would spend the class token. */
    costsToken: boolean
    current: boolean
}

export interface HqAscendantPayload {
    mastersPrestiged: ClassId[]
    masters: readonly ClassId[]
    skillIds: string[]
    kitSize: number
    pickable: { id: string, name: string, classId: ClassId, reached: boolean }[]
}

export interface HqBattleSpeedPayload {
    multiplier: number
    expiresAt: number | null
    /** Exact: the projection dilates its clock by it. */
    remainingSeconds: number
    tiers: { speed: BattleSpeedTier, blocks: { minutes: BattleSpeedDuration, gems: number }[] }[]
}

export interface HqRaidPayload {
    id: RaidId
    open: boolean
    keys: number
    keyCap: number
    /** The next UTC midnight; null at the cap. */
    nextKeyAt: number | null
    best: number
    /** What a quick-clear of the best pays; 0 before a first round. */
    bestReward: number
}

export interface HqCalendarPayload {
    /** 0-based. */
    today: number
    days: {
        day: number
        state: CalendarDayState
        kind: CalendarReward['kind']
        system: GachaSystem | null
        raid: RaidId | null
        /** Whole coins for a day of Gold, else the count. */
        amount: string
    }[]
    makeupsLeft: number
    /** 0-based; null when none is missed. */
    makeupDay: number | null
    nextDayAt: number
    endsAt: number
}

export interface HqHolidayPayload {
    id: HolidayId
    name: string
    year: number
    closesAt: number
    claimed: boolean
    gold: string
    gems: number
    seals: { system: GachaSystem, amount: number }[]
}

export interface HqHolidaysPayload {
    open: HqHolidayPayload[]
}

export interface HqTutorialsPayload {
    unlocked: HqFeature[]
    seen: string[]
}

/** One Trait slot as the scene shows it; `value` is the stat at its grade, a fraction. */
export interface HqTraitSlotView {
    stat: TraitStatId
    statName: string
    grade: TraitGrade
    set: TraitSetId
    setName: string
    value: number
    locked: boolean
}

export interface TraitsPayload {
    traitGems: number
    slots: (HqTraitSlotView | null)[]
    locked: number
    rollCost: number
    canRoll: boolean
    sets: {
        id: TraitSetId
        name: string
        effect: string
        pieces: number
        /** The tier reached, 0-based; null below the first count. */
        tier: number | null
        tiers: { pieces: number, magnitude: number }[]
    }[]
    saves: {
        unlocked: number
        max: number
        /** Null once every save slot is owned. */
        nextSlotCostGems: number | null
        cost: number
        slots: { index: number, unlocked: boolean, slots: (HqTraitSlotView | null)[] | null }[]
    }
}

export interface HqPassiveTreePayload {
    pointsEarned: number
    pointsLeft: number
    respecFree: boolean
    respecGems: number
    paths: PassivePath[]
    nodes: { id: string, level: number, maxLevel: number | null, nextCost: number | null, block: PassiveBuyBlock | null, active: boolean }[]
}

export interface HqArenaSeasonReward {
    season: number
    rank: number
    rating: number
    medals: number
}

export interface HqArenaPayload {
    medals: number
    rating: number
    matches: number
    season: number
    seasonEndsAt: number
    attempts: { free: number, used: number, purchased: number, left: number, nextPrice: number }
    refreshes: { free: number, used: number, nextPrice: number }
    /** `gpn` is typed nullable as `defenseGpnNow` returns it; set whenever a defence is. */
    defense: (Omit<ArenaDefenseLoadout, 'traits'> & { gpn: string | null, traits: (HqTraitSlotView | null)[] }) | null
    unclaimed: HqArenaSeasonReward[]
}

export interface HqLoadoutSessionPayload {
    target: LoadoutTarget
    /** The slot it applied; null when the raid runs on the player's own loadout. */
    slotIndex: number | null
}

/** What a read's own settle banked. */
export interface HqSettledPayload {
    online: boolean
    kills: number
    goldEarned: number
    xpEarned: string
    levelsGained: number
    heroLevel: number
    effectiveSeconds: number
    blockedAtBoss: boolean
    wipedOnWave: boolean
    awaySeconds: number
    offline: OfflineWindow | null
    from: RunPosition
    to: RunPosition
}

interface HqStateCommon {
    /** Lets the client interpolate accrual without drifting against its own clock. */
    serverNow: number
    refreshIntervalMs: number
    worldCount: number
    stagesPerWorld: number
    settings: HqSettings
}

/** Before the run is founded: the same fields, empty. */
export interface HqStateUninitialized extends HqStateCommon {
    initialized: false
    run: null
    hero: null
    shop: []
    guild: null
    forge: null
    training: null
    digSite: null
    loadouts: null
    loadoutPreferences: LoadoutPreferences
    loadoutSession: null
    classTree: []
    classToken: false
    ascendant: null
    battleSpeed: null
    raids: []
    calendar: null
    holidays: null
    milestones: []
    tutorials: HqTutorialsPayload
    traits: null
    passiveTree: null
    arena: null
    voidShards: string
    chestGold: string
    nextPrestigeReward: string
    awayReport: null
    settled: null
}

export interface HqStateInitialized extends HqStateCommon {
    initialized: true
    run: HqRunPayload
    hero: HqHeroPayload
    shop: HqShopTrackPayload[]
    classTree: HqClassNodePayload[]
    /** A prestige's class token is waiting to be spent on a new class. */
    classToken: boolean
    ascendant: HqAscendantPayload
    battleSpeed: HqBattleSpeedPayload
    raids: HqRaidPayload[]
    calendar: HqCalendarPayload
    holidays: HqHolidaysPayload
    tutorials: HqTutorialsPayload
    milestones: MilestoneRow[]
    arena: HqArenaPayload
    guild: GuildPayload
    forge: ForgePayload
    training: TrainingPayload
    digSite: DigSitePayload
    loadouts: LoadoutsPayload
    /** Raid (or `arena`) → the saved slot it applies on a fresh engage. */
    loadoutPreferences: LoadoutPreferences
    /** The open raid session, if any. */
    loadoutSession: HqLoadoutSessionPayload | null
    traits: TraitsPayload
    passiveTree: HqPassiveTreePayload
    voidShards: string
    /** Gold the settles banked in the chest, paid out when the player opens it. */
    chestGold: string
    nextPrestigeReward: string
    /** The welcome-back card waiting to be put away. */
    awayReport: HqAwayReport | null
    settled: HqSettledPayload | null
}

/** `GET /api/hero-quest/state`: the one read the client makes. */
export type HqStateResponse = HqStateUninitialized | HqStateInitialized

/** `GET /api/hero-quest/stats`: where every stat on every fielded unit comes from. */
export interface HqStatsResponse {
    heroLevel: number
    pacing: {
        statGrowthPerLevel: number
        defenceGrowthPerLevel: number
        enemyStepBase: number
        dpsStatExponent: number
        stagesPerLevel: number
        /** Null when no level covers a stage (JSON has no Infinity). */
        levelsPerStage: number | null
    }
    units: {
        label: string
        role: string | null
        heroLevel: number
        derived: { key: string, label: string, value: string, amount?: string, formula: string, note?: string }[]
        stats: {
            key: HqStatKey
            label: string
            tier: string
            final: string
            stagesOfCurve: number
            stages: {
                id: string
                label: string
                factor: string
                running: string
                unbounded: boolean
                floored: boolean
                formula: string
                parts: { label: string, amount: number }[]
            }[]
        }[]
    }[]
}

// ── Fights ─────────────────────────────────────────────────────────────────────────

/** What every replayed fight carries for the stage: the seeded log and both sides' bodies. */
interface HqFightReplay {
    seed: number
    outcome: FightOutcome
    /** Exact: the replay ends on it. */
    secondsElapsed: number
    events: FightEvent[]
    /** The party in the fight's `unitIndex` order: the Hero's class, then each fielded Champion. */
    partyIds: string[]
    partyMaxHps: string[]
    enemyMaxHps: string[]
}

/** `POST boss/engage`: the boss fight, resolved on the server, for the stage to replay. */
export interface HqBossResponse extends HqFightReplay {
    damageDealtPct: number
    enemyMaxHp: string
    enemyHpRemaining: string
    landing: { world: number, stage: number }
    runComplete: boolean
    /** Battle Speed at engage: how much faster the replay plays. */
    playbackSpeed: number
}

/** `POST raid/engage`. */
export interface HqRaidRoundResponse extends HqFightReplay {
    raidId: RaidId
    /** The level fought (a boss) or reached (the dummy). */
    level: number
    /** The dummy's damage; null for a boss. */
    damage: string | null
    reward: number
    best: number
    newBest: boolean
    keys: number
    /** The preferred Loadout slot the round was fought with; null for the player's own. */
    loadoutSlot: number | null
}

/** `POST arena/attack`. */
export interface HqArenaRoundResponse extends HqFightReplay {
    dummy: boolean
    opponentName: string
    won: boolean
    medals: number
    rating: number
    ratingChange: number
    attemptsLeft: number
    /** The defence as the fight indexed it; null for the Training Dummy. */
    enemy: { classId: string, heroRow: FormationRow, champions: { id: string, row: FormationRow }[] } | null
}

// ── Action responses ───────────────────────────────────────────────────────────────

/** `POST init`. */
export interface HqInitResponse {
    initialized: true
    heroNodeId: string
}

/** `POST prestige/execute`. */
export interface HqPrestigeResponse {
    prestige: number
    voidShardsEarned: string
    voidShards: string
    heroLevel: number
    nextPrestigeReward: string
}

/** `POST prestige/pick-class`. */
export interface HqPickClassResponse {
    classId: ClassId
    className: string
    heroLevel: number
    seenNodeIds: string[]
}

/** `POST shop/buy`. */
export interface HqShopBuyResponse {
    upgradeId: ShopTrackId
    level: number
    spent: number
    currency: ShopCurrency
    voidShards: string
    /** The Gold balance after a Gold purchase, for the header; null otherwise. */
    balance: string | null
    nextCost: number | null
}

/** `POST speed/buy`. */
export interface HqSpeedBuyResponse {
    spent: number
    /** The Gems balance left. */
    gems: number
    battleSpeed: HqBattleSpeedPayload
}

/** `POST raid/quick-clear`. */
export interface HqQuickClearResponse {
    raidId: RaidId
    level: number
    reward: number
    keys: number
}

/** `POST raid/leave`. */
export interface HqRaidLeaveResponse {
    restored: boolean
}

/** One slot on the Arena's opponent list. */
export type HqArenaCandidate = ArenaCandidate

/** `GET arena/candidates`: the opponent list, by slot. */
export type HqArenaCandidatesResponse = HqArenaCandidate[]

/** `GET arena/log`: one battle log entry. */
export interface HqArenaLogEntry {
    id: string
    role: 'attacker' | 'defender'
    won: boolean
    ratingChange: number
    medalsEarned: number
    isDummy: boolean
    opponentName: string
    at: number
}

/** `GET arena/log`: the last matches, newest first. */
export type HqArenaLogResponse = HqArenaLogEntry[]

/** `GET arena/leaderboard`. */
export interface HqArenaBoardResponse {
    season: number
    endsAt: number
    top: { rank: number, name: string, rating: number, you: boolean }[]
    /** Null before the viewer has fought this season. */
    me: { rank: number, rating: number } | null
    around: { rank: number, name: string, rating: number, you: boolean }[]
}

/** `POST arena/refresh-candidates`. */
export interface HqArenaRefreshResponse {
    gemsSpent: number
    nextPrice: number
    candidates: HqArenaCandidate[]
}

/** `POST arena/buy-attempt`. */
export interface HqArenaAttemptResponse {
    gemsSpent: number
    attemptsLeft: number
    nextPrice: number
}

/** `POST arena/defense-set`. */
export interface HqArenaDefenseResponse {
    defense: ArenaDefenseLoadout
    defenseGpn: string
}

/** `POST arena/shop-buy`. */
export interface HqArenaShopBuyResponse {
    itemId: string
    kind: ArenaShopItem['kind']
    quantity: number
    amount: number
    medalsSpent: number
    arenaMedals: number
    /** A raid Key's raid. */
    raidName?: string
}

/** `POST arena/claim-season`. */
export interface HqArenaClaimResponse {
    seasons: { season: number, rank: number, medals: number }[]
    medals: number
    arenaMedals: number
}

/** `POST settings/set`. */
export interface HqSettingResponse {
    settings: HqSettings
}

/** `POST tutorials/seen`. */
export interface HqTutorialSeenResponse {
    id: TutorialRecord
}

/** `POST tutorials/reset`. */
export interface HqTutorialsResetResponse {
    reset: true
}

/** `POST calendar/claim`. */
export interface HqCalendarClaimResponse {
    /** 1-based. */
    day: number
    makeup: boolean
    kind: CalendarReward['kind']
    amount: string
}

/** `POST away/dismiss`. */
export interface HqAwayDismissResponse {
    id: string
}

/** `POST chest/collect`. */
export interface HqChestResponse {
    collected: string
    /** The Gold balance after it. */
    balance: string
}

/** `POST holiday/claim`. */
export interface HqHolidayClaimResponse {
    holidayId: HolidayId
    year: number
    gold: string
    gems: number
    seals: { system: GachaSystem, amount: number }[]
}

/** `POST milestones/claim`. */
export interface HqMilestonesClaimResponse {
    claimed: { id: string, from: number, to: number }[]
    rewards: MilestoneReward[]
}

/** `POST trait/roll`. */
export interface HqTraitRollResponse {
    spent: number
    traitGems: number
    slots: (HqTraitSlotView | null)[]
}

/** `POST trait/auto-roll`: one batch. */
export interface HqTraitAutoRollResponse extends HqTraitRollResponse {
    rolls: number
    stoppedBy: TraitAutoRollStop
}

/** `POST trait/lock`. */
export interface HqTraitLockResponse {
    slotIndex: number
    locked: boolean
}

/** `POST trait/save`. */
export interface HqTraitSaveResponse {
    saveSlotIndex: number
    spent: number
    traitGems: number
}

/** `POST trait/load`. */
export interface HqTraitLoadResponse extends HqTraitSaveResponse {
    slots: (HqTraitSlotView | null)[]
}

/** `POST tree/buy`. */
export interface HqTreeBuyResponse {
    nodeId: string
    level: number
    pointsLeft: number
}

/** `POST tree/respec`. */
export interface HqTreeRespecResponse {
    free: boolean
    pointsLeft: number
}

/** One pull's copy. */
export interface HqPullRecord {
    contentId: string
    name: string
    rarity: Rarity
    /** True the first time this item is ever obtained. */
    isNew: boolean
    /** Star and level after this pull landed: the copy's new state. */
    star: number
    level: number
    /** Essence it produced, non-zero only on a copy already at 5★ Lv10. */
    essence: number
}

/** `POST gacha/pull`. */
export interface HqPullResponse {
    system: GachaSystem
    pulls: HqPullRecord[]
    /** True when it came out of the daily entitlement rather than the Seal balance. */
    free: boolean
    sealsSpent: number
    seals: number
    essence: number
    gachaLevel: number
    /** Pulls toward the next gacha level, a whole count. */
    gachaProgress: number
    essenceGained: number
}

/** `POST gacha/craft`. */
export interface HqCraftResponse {
    system: GachaSystem
    contentId: string
    name: string
    rarity: Rarity
    isNew: boolean
    star: number
    level: number
    spent: number
    refunded: number
    essence: number
}

/** `POST gacha/buy-seals`. */
export interface HqBuySealsResponse {
    system: GachaSystem
    sealsBought: number
    goldSpent: number
    seals: number
    purchasedToday: number
    /** What the next single Seal costs, so the client never prices anything itself. */
    nextPrice: number
}

/** The live loadout as a write leaves it. */
export interface HqLiveLoadout {
    partyChampionIds: string[]
    formation: Record<string, FormationRow>
    equippedSkillIds: string[]
    equippedArtifactIds: string[]
    equippedGear: Record<string, string>
    ascendantSkillIds: string[]
}

/** `POST loadout/set`. */
export interface HqLoadoutSetResponse extends HqLiveLoadout {
    slots: { champions: number, skills: number, artifacts: number }
}

/** `POST loadout/apply`. */
export interface HqLoadoutApplyResponse extends HqLiveLoadout {
    slotIndex: number
    name: string
}

/** `POST loadout/save`. */
export interface HqLoadoutSaveResponse {
    slotIndex: number
    name: string
    saved: boolean
}

/** `POST loadout/rename`. */
export interface HqLoadoutRenameResponse {
    slotIndex: number
    name: string
}

/** `POST loadout/set-raid-preference`. */
export interface HqLoadoutPreferenceResponse {
    target: LoadoutTarget
    slotIndex: number | null
    preferences: LoadoutPreferences
}

/** `POST dev/skip`. */
export type HqDevSkipResponse = DevSkipResult

/** `POST dev/away`. */
export interface HqDevAwayResponse {
    awaySeconds: number
}

/** `POST dev/grant`. */
export interface HqDevGrantResponse {
    voidShards: string
    guildSeals: number
}

/** `POST dev/set`: the run as the jump left it. */
export interface HqDevSetResponse {
    prestige: number
    world: number
    stage: number
    killCount: number
    atBossGate: boolean
    heroLevel: number
    heroNodeId: string
    runCleared: boolean
    bossLost: boolean
}

/** `POST dev/unlock`. */
export interface HqDevUnlockResponse {
    systems: GachaSystem[]
    /** Collection rows written. */
    granted: number
    star: number
    level: number
    maxShop: boolean
}

/** `POST dev/reset`. */
export interface HqDevResetResponse {
    reset: true
}
