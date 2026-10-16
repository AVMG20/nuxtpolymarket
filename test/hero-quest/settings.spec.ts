import { describe, expect, it } from 'vitest'
import { HQ_SETTING_DEFAULTS, hqSettingsOf, isHqSettingKey } from '#shared/utils/hero-quest/settings'

describe('hero-quest settings', () => {
    it('confirms every spend, and shows tutorials, the full show and every dot, until the player says otherwise', () => {
        expect(hqSettingsOf({})).toEqual({
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
            dotFreePulls: true,
            dotUpgrades: true,
            dotTreeNodes: true,
            dotRewards: true
        })
        expect(hqSettingsOf(null)).toEqual(HQ_SETTING_DEFAULTS)
    })

    it('keeps what was stored over the defaults', () => {
        expect(hqSettingsOf({ confirmGoldSeals: false }).confirmGoldSeals).toBe(false)
    })

    it('drops anything stored that is not a known boolean setting', () => {
        expect(hqSettingsOf({ confirmGoldSeals: 'no', bogus: true })).toEqual(HQ_SETTING_DEFAULTS)
        expect(isHqSettingKey('toString')).toBe(false)
        expect(isHqSettingKey('confirmGoldSeals')).toBe(true)
    })
})
