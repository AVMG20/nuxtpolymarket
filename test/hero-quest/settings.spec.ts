import { describe, expect, it } from 'vitest'
import { HQ_SETTING_DEFAULTS, hqSettingsOf, isHqSettingKey } from '#shared/utils/hero-quest/settings'

describe('hero-quest settings', () => {
    it('confirms every Gold, Void Shard and Gem spend, and shows tutorials, until the player says otherwise', () => {
        expect(hqSettingsOf({})).toEqual({ tutorials: true, confirmGoldSeals: true, confirmVoidShards: true, confirmGemSpeed: true })
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
