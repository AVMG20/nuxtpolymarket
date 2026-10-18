import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { deadFrontProfile } from '#server/database/schema'
import type { DfMatchResult, DfProfileView, DfProgressReport } from '#shared/utils/dead-front/types'
import { dfMergeMatchResult, dfNormalizeProfile } from './dead-front-profile-rules'

// Dead Front progression storage. Every JSON-merging write is lock-then-read:
// SELECT ... FOR UPDATE inside a transaction, merge, write with the same tx.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function ensureRow(userId: string): Promise<void> {
    await db.insert(deadFrontProfile).values({ userId }).onConflictDoNothing()
}

/** The player's profile, created with defaults on first read. */
export async function getDfProfile(userId: string): Promise<DfProfileView> {
    await ensureRow(userId)
    const [row] = await db.select().from(deadFrontProfile).where(eq(deadFrontProfile.userId, userId)).limit(1)
    if (!row) throw createError({ statusCode: 500, statusMessage: 'Profile missing' })
    return dfNormalizeProfile(row)
}

/**
 * Runs `fn` on the locked, normalised profile and writes back what it returns.
 * `fn` may throw to abort (nothing is written).
 */
export async function withLockedDfProfile<T>(
    userId: string,
    fn: (view: DfProfileView, tx: Tx) => { next: DfProfileView, out: T } | Promise<{ next: DfProfileView, out: T }>
): Promise<T> {
    await ensureRow(userId)
    return db.transaction(async (tx) => {
        const [row] = await tx.select().from(deadFrontProfile).where(eq(deadFrontProfile.userId, userId)).for('update')
        if (!row) throw createError({ statusCode: 500, statusMessage: 'Profile missing' })
        const { next, out } = await fn(dfNormalizeProfile(row), tx)
        await tx.update(deadFrontProfile).set({
            unlockedWeapons: next.unlockedWeapons,
            weaponXp: next.weaponXp,
            loadout: next.loadout,
            researchPerk: next.researchPerk,
            perkXp: next.perkXp,
            perkMods: next.perkMods,
            gamesPlayed: next.gamesPlayed,
            bestRound: next.bestRound,
            totalKills: next.totalKills,
            eggsCompleted: next.eggsCompleted,
            updatedAt: sql`now()`
        }).where(eq(deadFrontProfile.userId, userId))
        return out
    })
}

/**
 * Applies one match's result (weapon unlocks, weapon XP, perk research XP,
 * stats) under a row lock. Called exactly once per player per match by the
 * server match (on game over, or when the player leaves mid-match).
 */
export async function applyDfMatchResult(userId: string, result: DfMatchResult): Promise<DfProgressReport> {
    return withLockedDfProfile(userId, (view) => {
        const { next, report } = dfMergeMatchResult(view, result)
        return { next, out: report }
    })
}
