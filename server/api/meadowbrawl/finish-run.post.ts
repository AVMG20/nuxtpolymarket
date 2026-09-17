import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '#server/database'
import { meadowbrawlRuns, meadowbrawlState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getLockedMeadowbrawlState } from '#server/utils/meadowbrawl'
import { meadowbrawlSettleRun } from '#shared/utils/gamelogic/meadowbrawl-meta'

/**
 * Ends a run and settles its payout.
 *
 * The client reports the wave it died on, the base coins it picked up and
 * whether it won. Depth is capped by the last checkpoint the server stored
 * (every cleared wave writes one), the coins by what those waves could
 * have dropped, and the cash comes off the coin multiplier snapshotted at
 * the start. `abandoned` settles from the checkpoint alone — the player
 * gave the run up from the lobby and collects what it had banked.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const reportedWave = Number(body?.wave ?? 0)
    const reportedCoins = Number(body?.coins ?? 0)
    const reportedKills = Math.min(100_000, Math.max(0, Math.floor(Number(body?.kills) || 0)))
    const reportedPlayedMs = Number(body?.playedMs ?? 0)
    const won = body?.won === true
    const abandoned = body?.abandoned === true
    if (!Number.isFinite(reportedWave) || !Number.isFinite(reportedCoins) || !Number.isFinite(reportedPlayedMs)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid run report' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedMeadowbrawlState(tx, userId)
        if (!state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'No active Meadowbrawl run' })

        const elapsedMs = Date.now() - state.runStartedAt.getTime()
        const result = meadowbrawlSettleRun(state, {
            wave: reportedWave,
            coins: reportedCoins,
            won,
            abandoned
        }, elapsedMs)
        const durationSeconds = reportedPlayedMs > 0
            ? Math.min(Math.round(elapsedMs / 1000), Math.round(reportedPlayedMs / 1000))
            : Math.max(1, Math.round(elapsedMs / 1000))

        // Clearing the active-run lock *is* the claim: a second request in
        // flight finds it already null, throws, and pays nothing.
        const [claimed] = await tx.update(meadowbrawlState).set({
            runStartedAt: null,
            runWeapon: null,
            runPet: null,
            runPetLevel: 0,
            runCoinMult: null,
            runSave: null,
            runSaveRevision: 0,
            lastRunFinishedAt: new Date(),
            runsPlayed: result.runsPlayed,
            victories: result.victories,
            totalEarned: result.totalEarned,
            bestEarned: result.bestEarned,
            bestWave: result.bestWave,
            bestWaveByWeapon: result.bestWaveByWeapon,
            unlockedWeapons: result.unlockedWeapons
        }).where(and(eq(meadowbrawlState.userId, userId), isNotNull(meadowbrawlState.runStartedAt)))
            .returning({ userId: meadowbrawlState.userId })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'No active Meadowbrawl run' })

        await tx.insert(meadowbrawlRuns).values({
            userId,
            weapon: result.weapon,
            pet: state.runPet,
            wavesCleared: result.cleared,
            won: result.won,
            coins: result.counted,
            awarded: result.awarded,
            capped: result.capped,
            kills: reportedKills,
            durationSeconds: Math.max(1, durationSeconds)
        })

        if (result.awarded > 0) await credit(userId, result.awarded.toFixed(4), 'meadowbrawl', tx)

        return {
            awarded: result.awarded,
            counted: result.counted,
            capped: result.capped,
            coinMult: result.coinMult,
            cleared: result.cleared,
            won: result.won,
            bestWave: result.bestWave,
            bestEarned: result.bestEarned,
            newlyUnlocked: result.newlyUnlocked,
            unlockedWeapons: result.unlockedWeapons
        }
    })
})
