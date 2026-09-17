import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedVoidState, voidCharge } from '#server/utils/void'
import { VOID_SKILLS, voidUnlockedSkills } from '#shared/utils/gamelogic/void-skills'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const skill = VOID_SKILLS.find(s => s.id === body?.skillId)
    if (!skill) throw createError({ statusCode: 400, statusMessage: 'Invalid skill' })

    return db.transaction(async (tx) => {
        // Lock-then-read: two parallel unlocks cannot both pay.
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before refitting' })
        const unlocked = voidUnlockedSkills(s)
        if (unlocked.includes(skill.id)) throw createError({ statusCode: 400, statusMessage: 'Already unlocked' })
        if (s.highestSectorCleared < skill.requiresSector) throw createError({ statusCode: 400, statusMessage: `Clear sector ${skill.requiresSector} first` })
        const resources = await voidCharge(tx, userId, s.resources, { resources: skill.cost, coins: skill.coins, gems: skill.gems })
        await tx.update(voidState)
            .set({ unlockedSkills: [...unlocked, skill.id], equippedSkill: skill.id, resources })
            .where(eq(voidState.userId, userId))
        return { skillId: skill.id }
    })
})
