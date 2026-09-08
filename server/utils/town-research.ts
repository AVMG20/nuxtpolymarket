import { and, eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { townState, townResearch } from '#server/database/schema'
import { debit } from '#server/utils/balance'
import {
    TOWN_RESEARCH,
    getTownResearch,
    townResearchUnlocked
} from '#shared/utils/gamelogic/town-research'
import { bankFinishedResearch, settleTownState, spendBag } from '#server/utils/town'

const CATEGORY = 'polytown'

/** Project ids this player has finished, in no particular order. */
export async function getTownResearchDone(userId: string): Promise<string[]> {
    const rows = await db.select({ researchId: townResearch.researchId })
        .from(townResearch)
        .where(eq(townResearch.userId, userId))
    return rows.map(r => r.researchId)
}

/**
 * Finish whatever was running if its clock has run out. Called from the read
 * path and before any research mutation, so a project completes the same way
 * production settles: lazily, on the next time anybody looks.
 */
export async function settleTownResearch(userId: string, now = Date.now()) {
    const state = await db.query.townState.findFirst({ where: eq(townState.userId, userId) })
    if (!state?.researchId || !state.researchCompletesAt) return
    if (state.researchCompletesAt.getTime() > now) return
    await db.transaction(tx => bankFinishedResearch(tx, userId, state, now))
}

/**
 * Start a project. One at a time: the conditional UPDATE only matches while
 * nothing is running, so two simultaneous requests cannot both begin one.
 */
export async function startTownResearch(userId: string, researchId: string) {
    const def = getTownResearch(researchId)
    if (!def) throw createError({ statusCode: 400, statusMessage: 'Unknown project' })

    await settleTownResearch(userId)
    return db.transaction(async (tx) => {
        const now = Date.now()
        // Locks town_state first, which is the lock order everything else uses.
        const { state } = await settleTownState(tx, userId, now)
        if (state.researchId) throw createError({ statusCode: 400, statusMessage: 'Another project is already running' })

        const done = await tx.select({ researchId: townResearch.researchId })
            .from(townResearch)
            .where(eq(townResearch.userId, userId))
        const doneIds = done.map(r => r.researchId)
        if (doneIds.includes(researchId)) throw createError({ statusCode: 400, statusMessage: 'Already researched' })
        if (!townResearchUnlocked(def, doneIds)) throw createError({ statusCode: 400, statusMessage: 'Finish the project before it first' })

        if (def.coins > 0) await debit(userId, def.coins.toFixed(4), CATEGORY, tx)
        await spendBag(tx, userId, def.resources)

        const completesAt = new Date(now + def.durationMs)
        const [started] = await tx.update(townState)
            .set({ researchId, researchCompletesAt: completesAt })
            .where(and(eq(townState.id, state.id), sql`${townState.researchId} is null`))
            .returning({ id: townState.id })
        if (!started) throw createError({ statusCode: 409, statusMessage: 'Another project just started' })
        return { researchId, completesAt: completesAt.getTime() }
    })
}

/** Every project with its state, for the research board. */
export async function getTownResearchBoard(userId: string, now = Date.now()) {
    await settleTownResearch(userId, now)
    const [state, done] = await Promise.all([
        db.query.townState.findFirst({ where: eq(townState.userId, userId) }),
        getTownResearchDone(userId)
    ])
    return {
        active: state?.researchId
            ? { researchId: state.researchId, completesAt: state.researchCompletesAt?.getTime() ?? now }
            : null,
        done,
        projects: TOWN_RESEARCH.map(def => ({
            id: def.id,
            branch: def.branch,
            step: def.step,
            name: def.name,
            description: def.description,
            durationMs: def.durationMs,
            coins: def.coins,
            resources: def.resources,
            done: done.includes(def.id),
            unlocked: townResearchUnlocked(def, done)
        }))
    }
}
