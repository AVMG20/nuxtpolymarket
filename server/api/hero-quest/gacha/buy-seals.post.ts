import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { buyLadderSeals, sealBalance, settleHq } from '#server/utils/hero-quest'
import { isGachaSystem, sealLadderPrice } from '#shared/utils/hero-quest/gacha'

/** Bulk buys are priced rung by rung, so this bounds the loop and the Gold spent per call. */
const MAX_SEALS_PER_PURCHASE = 10

/**
 * Buy extra Seals for any of the four gachas with Gold, on the daily escalating ladder
 * (`gold-economy.md` §7).
 *
 * The first Seal bought *today* costs `SEAL_LADDER_BASE_GOLD`; each further one that day costs
 * more, at a growth rate calibrated per gacha. The four gachas hold **independent counters
 * behind one shared reset date**, so buying Champion pulls today never moves the price of Skill
 * pulls.
 *
 * This is the designed Gold sink — the reason banked Gold is worth anything at all, since Gold
 * buys nothing else in the game. The ladder's compounding is the brake, and deliberately a smooth
 * one rather than a wall: §7 accepts that a large banked balance buys a real head start (~3% of a
 * roster even for an absurd one-time injection) rather than capping the day.
 *
 * ## Concurrency — lock-then-read, not claim-then-reward
 *
 * The price *depends on the counter's old value*, and the counter lives inside a jsonb map, so
 * there is no single column to compare-and-swap and no flag to conditionally flip. That makes
 * this the textbook case for pattern B: take the `hqState` row lock, read the counter **inside**
 * the lock, price against it, and write everything in the same transaction. A counter read before
 * the lock is already stale, and two concurrent buys would both price at the base rung.
 *
 * `debit` is threaded with `tx` — mandatory, not stylistic. Without it the Gold write goes out on
 * a second pool connection and deadlocks against the lock this transaction is holding.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ system?: string; count?: number }>(event)

    const system = body?.system
    if (typeof system !== 'string' || !isGachaSystem(system)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown gacha' })
    }

    const requested = Math.floor(Number(body?.count ?? 1))
    if (!Number.isFinite(requested) || requested < 1 || requested > MAX_SEALS_PER_PURCHASE) {
        throw createError({
            statusCode: 400,
            statusMessage: `Buy between 1 and ${MAX_SEALS_PER_PURCHASE} Seals at a time`
        })
    }

    // Bank progress first, so the Gold this spends includes everything already earned.
    await settleHq(userId)

    return db.transaction(async (tx) => {
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
        if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })

        // `debit` throws 400 on an insufficient balance — no manual check, and no window between
        // checking and spending.
        const { goldSpent, boughtToday } = await buyLadderSeals(tx, userId, state, system, requested)
        const [updated] = await tx.select().from(hqState).where(eq(hqState.userId, userId))

        return {
            system,
            sealsBought: requested,
            goldSpent,
            seals: updated ? sealBalance(updated, system) : sealBalance(state, system) + requested,
            purchasedToday: boughtToday,
            /** What the next single Seal will cost, so the client never prices anything itself. */
            nextPrice: sealLadderPrice(system, boughtToday)
        }
    })
})
