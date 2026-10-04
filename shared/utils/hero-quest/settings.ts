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
    /** A Battle Speed block, paid in Gems, takes a second press to confirm. */
    confirmGemSpeed: boolean
}

export const HQ_SETTING_DEFAULTS: Readonly<HqSettings> = {
    tutorials: true,
    confirmGoldSeals: true,
    confirmVoidShards: true,
    confirmGemSpeed: true
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
