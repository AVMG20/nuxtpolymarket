import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { prestigeResetValues, settleHq, voidShardsFor } from '#server/utils/hero-quest'
import { fromStore, toStore } from '#shared/utils/hero-quest/numbers'

/**
 * Complete a prestige: pay Void Shards, reset the run, start over harder.
 *
 * Lock-then-read, because the payout depends on the old `prestige` value and there is no
 * flag to conditionally flip that also carries the number. Reading `runCleared` *before*
 * taking the lock would let a burst of concurrent calls each see a cleared run and each get
 * paid; inside the lock, the first one clears the flag and the rest find it false.
 *
 * `runCleared` — not position — is the gate. A win at World 10 / Stage 10 leaves the run
 * standing on that same stage, so position alone cannot tell "beat the game" from "walked up
 * to the final boss", and paying off position would reward merely arriving.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    // Bank anything still owed at the old position before the reset wipes it.
    await settleHq(userId)

    return db.transaction(async (tx) => {
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
        if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run to prestige' })

        if (!state.runCleared) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Beat the World 10 super boss before prestiging'
            })
        }

        // Fixed payout on a full clear only — no partial credit for an incomplete run
        // (`core-progression-and-prestige.md` §4).
        const earned = voidShardsFor(state.prestige)
        const shards = toStore(fromStore(state.voidShards).add(earned))

        // Hero level, XP, class node, seen nodes, Void Shards and every shop row are
        // deliberately absent from this set. There is no relevel anywhere in the game.
        const [updated] = await tx.update(hqState)
            .set({
                ...prestigeResetValues(state),
                runCleared: false,
                // The prestige's Seals and Gems are a milestone, claimed in the Milestones scene.
                voidShards: shards
            })
            .where(eq(hqState.userId, userId))
            .returning()

        return {
            prestige: updated?.prestige ?? state.prestige + 1,
            voidShardsEarned: earned.toString(),
            voidShards: shards,
            /** Unchanged on purpose — proof the reset kept what it is supposed to keep. */
            heroLevel: updated?.heroLevel ?? state.heroLevel,
            nextPrestigeReward: voidShardsFor((updated?.prestige ?? state.prestige + 1)).toString()
        }
    })
})
