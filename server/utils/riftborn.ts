import { and, eq } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { riftbornState } from '#server/database/schema'
import {
    riftbornCleanSkills,
    riftbornLevelForXp,
    riftbornMetaEffects,
    riftbornNewAchievements,
    riftbornRunXp,
    riftbornSanitiseReport,
    riftbornSkillPoints,
    riftbornSkillPointsSpent,
    riftbornUnlockedClasses
} from '#shared/utils/gamelogic/riftborn'

export type RiftbornStateRow = typeof riftbornState.$inferSelect

export async function getLockedRiftbornState(tx: DbExecutor, userId: string) {
    const [state] = await tx.select().from(riftbornState).where(eq(riftbornState.userId, userId)).for('update')
    if (!state) throw createError({ statusCode: 404, statusMessage: 'Riftborn state not initialized' })
    return state
}

/** The player's row, created on first visit. */
export async function ensureRiftbornState(userId: string): Promise<RiftbornStateRow> {
    const [existing] = await db.select().from(riftbornState).where(eq(riftbornState.userId, userId))
    if (existing) return existing
    // Two first-visit requests can race the insert: the loser reads the
    // winner's row instead of failing on the unique constraint.
    const [created] = await db.insert(riftbornState).values({ userId }).onConflictDoNothing().returning()
    if (created) return created
    const [row] = await db.select().from(riftbornState).where(eq(riftbornState.userId, userId))
    return row!
}

export function riftbornProgress(state: Pick<RiftbornStateRow, 'xp' | 'achievements' | 'skills'>) {
    const level = riftbornLevelForXp(state.xp)
    const skills = riftbornCleanSkills(state.skills)
    return {
        xp: state.xp,
        level: level.level,
        xpIntoLevel: level.xpIntoLevel,
        xpForNext: level.xpForNext,
        skillPoints: riftbornSkillPoints(level.level, state.achievements),
        pointsSpent: riftbornSkillPointsSpent(skills),
        skills,
        effects: riftbornMetaEffects(skills),
        achievements: state.achievements,
        unlockedClasses: riftbornUnlockedClasses(state.achievements)
    }
}

export function riftbornStateView(state: RiftbornStateRow) {
    return {
        ...riftbornProgress(state),
        stats: {
            runsPlayed: state.runsPlayed,
            victories: state.victories,
            bestTime: state.bestTime,
            bestKills: state.bestKills,
            bestLevel: state.bestLevel,
            totalKills: state.totalKills
        },
        activeRun: state.runId && state.runStartedAt
            ? { runId: state.runId, classId: state.runClass, startedAt: state.runStartedAt }
            : null
    }
}

/**
 * Settles a run into Rift XP, records and achievements. The report comes
 * from the client, so every number is capped by the time the server has seen
 * the run running for.
 */
export async function settleRiftbornRun(userId: string, runId: string, rawReport: unknown) {
    return db.transaction(async (tx) => {
        const state = await getLockedRiftbornState(tx, userId)
        if (state.runId !== runId || !state.runStartedAt) {
            throw createError({ statusCode: 400, statusMessage: 'This run is already over' })
        }

        const report = riftbornSanitiseReport(rawReport, Date.now() - state.runStartedAt.getTime())
        const xpGained = riftbornRunXp(report)
        const xp = state.xp + xpGained
        const runsPlayed = state.runsPlayed + 1
        const totalKills = state.totalKills + report.kills
        const victories = state.victories + (report.victory ? 1 : 0)
        const unlocked = riftbornNewAchievements(state.achievements, {
            report,
            classId: state.runClass ?? '',
            runsPlayed,
            totalKills,
            victories,
            level: riftbornLevelForXp(xp).level
        })
        const achievements = [...state.achievements, ...unlocked.map(a => a.id)]

        // Clearing the runId is the claim: a second finish in flight finds it
        // gone and counts nothing.
        const [claimed] = await tx.update(riftbornState).set({
            runId: null,
            runClass: null,
            runStartedAt: null,
            runSkills: null,
            xp,
            achievements,
            runsPlayed,
            victories,
            totalKills,
            bestTime: Math.max(state.bestTime, report.time),
            bestKills: Math.max(state.bestKills, report.kills),
            bestLevel: Math.max(state.bestLevel, report.level)
        }).where(and(eq(riftbornState.userId, userId), eq(riftbornState.runId, runId)))
            .returning()
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'This run is already over' })

        return {
            report,
            xpGained,
            levelBefore: riftbornLevelForXp(state.xp).level,
            progress: riftbornProgress(claimed),
            newAchievements: unlocked.map(a => ({
                id: a.id,
                name: a.name,
                description: a.description,
                icon: a.icon,
                points: a.points,
                unlocks: a.unlocks ?? null
            })),
            newBest: {
                time: report.time > state.bestTime,
                kills: report.kills > state.bestKills
            }
        }
    })
}
