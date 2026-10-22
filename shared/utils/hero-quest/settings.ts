import { isHqNotation, type HqNotation } from './numbers'

/**
 * The player's Hero Quest settings, chosen in the Settings scene and kept on `hq_state.settings`.
 *
 * Stored sparse: only what the player changed is written, and everything else reads its default
 * here, so a new setting needs no migration and an old save picks up its default.
 */
export interface HqSettings {
    /** Tutorial tips as you play. Stored now; the tutorials themselves come later. */
    tutorials: boolean
    /** A pull that buys Seals with Gold takes a second press to confirm. */
    confirmGoldSeals: boolean
    /** A purchase paid in Void Shards takes a second press to confirm. */
    confirmVoidShards: boolean
    /** A purchase paid in Gems takes a second press to confirm: Battle Speed, a Gem shop track, a paid Arena refresh or attack. */
    confirmGemSpends: boolean
    /** A Passive Skill Tree respec, which refunds the whole tree, takes a second press to confirm. */
    confirmTreeRespec: boolean
    /** An Auto Roll, a loaded or bought trait set, or a graded save overwritten takes a second press to confirm. */
    confirmTraitSpends: boolean
    /** Fewer flashes and no screen shake, on top of the device's own reduced-motion setting. */
    reduceMotion: boolean
    /** A gacha pull shows its cards turned at once, without the deal. */
    fastReveals: boolean
    /** The Hero's signature skill plays its cinematic; off, it lands like any other skill. */
    skillCinematics: boolean
    /** Damage, heal and miss numbers float off the bodies on the stage. */
    combatNumbers: boolean
    /** Collections details give exact multipliers and full ability text; off, the short rounded lines. */
    detailedDescriptions: boolean
    /** How big numbers read everywhere in the game: 1.23e16 as `1.23e16`, `12.30Qa` or `12.30AA`. */
    numberNotation: HqNotation
    /** The menu's red dots: a free pull, an upgrade, a tree node, a calendar or arena reward. */
    dotFreePulls: boolean
    dotUpgrades: boolean
    dotTreeNodes: boolean
    dotRewards: boolean
}

export const HQ_SETTING_DEFAULTS: Readonly<HqSettings> = {
    tutorials: true,
    confirmGoldSeals: true,
    confirmVoidShards: true,
    confirmGemSpends: true,
    confirmTreeRespec: true,
    confirmTraitSpends: true,
    reduceMotion: false,
    fastReveals: false,
    skillCinematics: true,
    combatNumbers: true,
    detailedDescriptions: false,
    numberNotation: 'scientific',
    dotFreePulls: true,
    dotUpgrades: true,
    dotTreeNodes: true,
    dotRewards: true
}

export type HqSettingKey = keyof HqSettings
/** The settings that are an ON/OFF switch. */
export type HqToggleKey = { [K in HqSettingKey]: HqSettings[K] extends boolean ? K : never }[HqSettingKey]

export function isHqSettingKey(key: unknown): key is HqSettingKey {
    return typeof key === 'string' && Object.hasOwn(HQ_SETTING_DEFAULTS, key)
}

export function isHqToggleKey(key: unknown): key is HqToggleKey {
    return isHqSettingKey(key) && typeof HQ_SETTING_DEFAULTS[key] === 'boolean'
}

/** Whether `value` is one `key` can hold: a boolean for a switch, one of its choices for a pick. */
export function isHqSettingValue<K extends HqSettingKey>(key: K, value: unknown): value is HqSettings[K] {
    if (key === 'numberNotation') return isHqNotation(value)
    return typeof value === 'boolean'
}

/** The stored choices over the defaults, dropping anything stored that is not a known setting's value. */
export function hqSettingsOf(stored: unknown): HqSettings {
    const out: Record<string, unknown> = { ...HQ_SETTING_DEFAULTS }
    if (stored && typeof stored === 'object') {
        for (const [key, value] of Object.entries(stored)) {
            if (isHqSettingKey(key) && isHqSettingValue(key, value)) out[key] = value
        }
    }
    return out as unknown as HqSettings
}
