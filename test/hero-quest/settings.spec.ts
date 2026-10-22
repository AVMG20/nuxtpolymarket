import { describe, expect, it } from 'vitest'
import { HQ_SETTING_DEFAULTS, hqSettingsOf, isHqSettingKey, isHqSettingValue, isHqToggleKey } from '#shared/utils/hero-quest/settings'

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
            numberNotation: 'scientific',
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

    it('keeps a stored notation only when it is one of the three', () => {
        expect(hqSettingsOf({ numberNotation: 'standard' }).numberNotation).toBe('standard')
        expect(hqSettingsOf({ numberNotation: 'alphabetical' }).numberNotation).toBe('alphabetical')
        expect(hqSettingsOf({ numberNotation: 'engineering' }).numberNotation).toBe('scientific')
        expect(hqSettingsOf({ numberNotation: true }).numberNotation).toBe('scientific')
        expect(hqSettingsOf({ tutorials: 'standard' }).tutorials).toBe(true)
    })

    it('types each setting\'s value by its key', () => {
        expect(isHqSettingValue('numberNotation', 'standard')).toBe(true)
        expect(isHqSettingValue('numberNotation', false)).toBe(false)
        expect(isHqSettingValue('tutorials', false)).toBe(true)
        expect(isHqSettingValue('tutorials', 'standard')).toBe(false)
        expect(isHqToggleKey('tutorials')).toBe(true)
        expect(isHqToggleKey('numberNotation')).toBe(false)
    })
})
