import { describe, expect, it } from 'vitest'
import { ARENA_BOT_RATING_MAX, BASE_ARTIFACT_SLOTS, BASE_CHAMPION_SLOTS, BASE_SKILL_SLOTS } from '#shared/utils/hero-quest/constants'
import { ARENA_DUMMY_ID } from '#shared/utils/hero-quest/arena'
import { ARENA_BOT_PREFIX, arenaBots, getArenaBot, isArenaBotId } from '#shared/utils/hero-quest/content/arena-bots'
import { CHAMPIONS, isChampionId } from '#shared/utils/hero-quest/content/champions'
import { GEAR_SLOTS, getGear, isGearId } from '#shared/utils/hero-quest/content/gear'
import { isSkillId } from '#shared/utils/hero-quest/content/skills'
import { isArtifactId } from '#shared/utils/hero-quest/content/artifacts'

describe('arena bots', () => {
    const bots = arenaBots()

    it('have unique prefixed IDs that can never be a user ID or the dummy', () => {
        expect(new Set(bots.map(bot => bot.id)).size).toBe(bots.length)
        expect(new Set(bots.map(bot => bot.name)).size).toBe(bots.length)
        for (const bot of bots) {
            expect(bot.id.startsWith(ARENA_BOT_PREFIX)).toBe(true)
            expect(isArenaBotId(bot.id)).toBe(true)
            expect(getArenaBot(bot.id)).toBe(bot)
        }
        expect(isArenaBotId(ARENA_DUMMY_ID)).toBe(false)
        expect(isArenaBotId(crypto.randomUUID())).toBe(false)
    })

    it('sit at or below the Rating cap', () => {
        expect(bots.every(bot => bot.rating <= ARENA_BOT_RATING_MAX)).toBe(true)
        expect(Math.max(...bots.map(bot => bot.rating))).toBe(ARENA_BOT_RATING_MAX)
    })

    it('field only real content, within the slots a new player has', () => {
        for (const bot of bots) {
            expect(bot.champions.length).toBeGreaterThan(0)
            expect(bot.champions.length).toBeLessThanOrEqual(BASE_CHAMPION_SLOTS)
            expect(bot.skills.length).toBeLessThanOrEqual(BASE_SKILL_SLOTS)
            expect(bot.artifacts.length).toBeLessThanOrEqual(BASE_ARTIFACT_SLOTS)
            expect(bot.champions.every(c => isChampionId(c.contentId))).toBe(true)
            expect(bot.skills.every(c => isSkillId(c.contentId))).toBe(true)
            expect(bot.artifacts.every(c => isArtifactId(c.contentId))).toBe(true)
            expect(bot.gear.every(c => isGearId(c.contentId))).toBe(true)
            expect(bot.gear.map(c => getGear(c.contentId).slot)).toEqual([...GEAR_SLOTS])
            for (const list of [bot.champions, bot.skills, bot.artifacts]) {
                expect(new Set(list.map(c => c.contentId)).size).toBe(list.length)
            }
        }
    })

    it('are never named after a Champion', () => {
        const taken = new Set(CHAMPIONS.map(c => c.givenName.toLowerCase()))
        expect(bots.filter(bot => taken.has(bot.name.toLowerCase()))).toEqual([])
    })

    it('grow stronger up the ladder', () => {
        const byRating = [...bots].sort((a, b) => a.rating - b.rating)
        for (let i = 1; i < byRating.length; i++) expect(byRating[i]!.heroLevel).toBeGreaterThanOrEqual(byRating[i - 1]!.heroLevel)
    })
})
