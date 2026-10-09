import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqShopUpgrades, hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { debitGems } from '#server/utils/balance'
import { claimShopLevel, spendVoidShards } from '#server/utils/hero-quest'
import { getShopTrack, isShopTrackId, shopTrackCost } from '#shared/utils/hero-quest/content/shop'

/**
 * Buy one level of a prestige-shop track.
 *
 * Claim-then-reward, twice over, and both guards matter:
 *
 * 1. The level bump is a conditional `UPDATE … WHERE level = <what we read>`. Only the
 *    request that finds the row still at that level wins; the rest match nothing and throw
 *    before any currency moves. Integer compare-and-swap is safe here in a way a timestamp
 *    CAS never is (Postgres keeps microseconds, JS `Date` does not).
 * 2. The balance is spent under a guard of its own — the shard read happens *inside* the
 *    `hqState` row lock and is written in the same transaction, and `debitGems` carries its
 *    `gems >= cost` check in its own WHERE clause. Either way two purchases cannot both spend
 *    the same currency.
 *
 * Without the first, N parallel clicks all read level 3 and all pay for level 4. Without the
 * second, two different tracks bought at once could each debit against the same balance.
 *
 * ## Two currencies
 *
 * Loadout slots are priced in **Gems** (`loadouts.md` §3), every other track in Void Shards. Gems
 * are a shared platform balance, so that path goes through `balance.ts` with the transaction
 * threaded, never `user.gems` directly.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'prestige')
    const body = await readBody<{ upgradeId?: string }>(event)
    const upgradeId = body?.upgradeId

    if (typeof upgradeId !== 'string' || !isShopTrackId(upgradeId)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown upgrade' })
    }
    const track = getShopTrack(upgradeId)

    return db.transaction(async (tx) => {
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
        if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })

        const [row] = await tx.select().from(hqShopUpgrades)
            .where(and(eq(hqShopUpgrades.userId, userId), eq(hqShopUpgrades.upgradeId, upgradeId)))
        const level = row?.level ?? 0

        const cost = shopTrackCost(upgradeId, level)
        if (cost === null) {
            throw createError({ statusCode: 400, statusMessage: `${track.name} is already maxed` })
        }

        // Affordability is checked before the level is claimed, so a player who cannot pay never
        // burns the claim and forces everyone else into a 409.
        const remaining = track.currency === 'voidShards'
            ? spendVoidShards(state.voidShards, cost)
            : null
        if (track.currency === 'voidShards' && remaining === null) {
            throw createError({ statusCode: 400, statusMessage: 'Not enough Void Shards' })
        }

        const claimed = await claimShopLevel(tx, userId, upgradeId, level)
        if (!claimed) {
            throw createError({ statusCode: 409, statusMessage: 'That upgrade is already being bought, try again' })
        }

        if (track.currency === 'voidShards') {
            await tx.update(hqState).set({ voidShards: remaining! }).where(eq(hqState.userId, userId))
        } else {
            // `debitGems` guards `gems >= cost` in its own WHERE and throws 400 otherwise, so the
            // check and the spend are one statement. The tx is threaded because this transaction
            // already holds the `hqState` lock — without it the write goes out on a second pool
            // connection and deadlocks against a lock this request is holding.
            await debitGems(userId, Math.round(cost), tx)
        }

        return {
            upgradeId,
            level: claimed.level,
            spent: cost,
            currency: track.currency,
            voidShards: remaining ?? state.voidShards,
            nextCost: shopTrackCost(upgradeId, claimed.level)
        }
    })
})
