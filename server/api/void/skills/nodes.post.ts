import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedVoidState } from '#server/utils/void'
import { voidPilotLevel, voidUnlockedSkills, voidValidateSkillNodes } from '#shared/utils/gamelogic/void-skills'

/** Replaces a skill's allocated nodes. Respecs are free. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const skillId = String(body?.skillId)

    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before refitting' })
        if (!voidUnlockedSkills(s).includes(skillId)) throw createError({ statusCode: 400, statusMessage: 'Skill not unlocked' })
        const nodes = voidValidateSkillNodes(skillId, body?.nodes, voidPilotLevel(s.pilotXp))
        if (!nodes) throw createError({ statusCode: 400, statusMessage: 'Invalid skill tree' })
        await tx.update(voidState)
            .set({ skillNodes: { ...(s.skillNodes ?? {}), [skillId]: nodes } })
            .where(eq(voidState.userId, userId))
        return { skillId, nodes }
    })
})
