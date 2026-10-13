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
    dotFreePulls: true,
    dotUpgrades: true,
    dotTreeNodes: true,
    dotRewards: true
}

export type HqSettingKey = keyof HqSettings

export function isHqSettingKey(key: unknown): key is HqSettingKey {
    return typeof key === 'string' && Object.hasOwn(HQ_SETTING_DEFAULTS, key)
}

/** The stored choices over the defaults, dropping anything stored that is not a known boolean. */
export function hqSettingsOf(stored: unknown): HqSettings {
    const out = { ...HQ_SETTING_DEFAULTS }
    if (stored && typeof stored === 'object') {
        for (const [key, value] of Object.entries(stored)) {
            if (isHqSettingKey(key) && typeof value === 'boolean') out[key] = value
        }
    }
    return out
}
