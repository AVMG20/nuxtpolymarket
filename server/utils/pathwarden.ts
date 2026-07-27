import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import type { PathwardenBoostLevels } from '#shared/utils/gamelogic/pathwarden'

export type LockedPathwardenState = typeof pathwardenState.$inferSelect

export function pathwardenLevels(state: LockedPathwardenState): PathwardenBoostLevels {
    return {
        bulwark: state.bulwarkLevel,
        artificer: state.artificerLevel,
        lens: state.lensLevel,
        reservoir: state.reservoirLevel,
        banner: state.bannerLevel,
        bounty: state.bountyLevel
    }
}

export async function getLockedPathwardenState(tx: DbExecutor, userId: string) {
    await tx.insert(pathwardenState).values({ userId }).onConflictDoNothing()
    const [state] = await tx.select()
        .from(pathwardenState)
        .where(eq(pathwardenState.userId, userId))
        .for('update')
    if (!state) {
        throw createError({ statusCode: 500, statusMessage: 'Could not initialize Pathwarden state' })
    }
    return state
}
