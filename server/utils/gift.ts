import { inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { credit, creditGems, debit, debitGems } from '#server/utils/balance'
import { GIFT_MAX_COINS, GIFT_MAX_GEMS } from '#shared/utils/limits'

export interface GiftInput {
    coins?: unknown
    gems?: unknown
}

// Only a number or a numeric string counts — Number(true) is 1 and Number([])
// is 0, and neither should quietly turn into a gift.
function toNumber(value: unknown) {
    if (value === undefined || value === null || value === '') return 0
    if (typeof value === 'number') return value
    if (typeof value === 'string') return Number(value)
    return NaN
}

function parseCoins(value: unknown) {
    const amount = toNumber(value)
    if (!Number.isFinite(amount) || amount < 0 || amount > GIFT_MAX_COINS) {
        throw createError({ statusCode: 400, statusMessage: 'Enter a valid coin amount' })
    }
    return Number(amount.toFixed(2))
}

function parseGems(value: unknown) {
    const amount = toNumber(value)
    if (!Number.isInteger(amount) || amount < 0 || amount > GIFT_MAX_GEMS) {
        throw createError({ statusCode: 400, statusMessage: 'Enter a whole number of gems' })
    }
    return amount
}

/**
 * Move coins and/or gems from one player to another. Both wallet rows are
 * locked up front in id order so two players gifting each other at the same
 * moment cannot deadlock; the debit guards (`balance >= amount` in the WHERE)
 * are what stop a burst of gifts from overspending.
 */
export async function giftToUser(fromUserId: string, toUserId: string, input: GiftInput) {
    if (!toUserId || typeof toUserId !== 'string') throw createError({ statusCode: 400, statusMessage: 'Pick a player to gift' })
    if (toUserId === fromUserId) throw createError({ statusCode: 400, statusMessage: 'You cannot gift yourself' })

    const coins = parseCoins(input.coins)
    const gems = parseGems(input.gems)
    if (coins <= 0 && gems <= 0) throw createError({ statusCode: 400, statusMessage: 'Enter an amount to gift' })

    return db.transaction(async (tx) => {
        const rows = await tx.select({ id: user.id })
            .from(user)
            .where(inArray(user.id, [fromUserId, toUserId]))
            .orderBy(user.id)
            .for('update')
        if (rows.length !== 2) throw createError({ statusCode: 404, statusMessage: 'Player not found' })

        if (coins > 0) {
            const amount = coins.toFixed(4)
            await debit(fromUserId, amount, 'gift:sent', tx)
            await credit(toUserId, amount, 'gift:received', tx)
        }
        if (gems > 0) {
            await debitGems(fromUserId, gems, tx)
            await creditGems(toUserId, gems, tx)
        }
        return { coins, gems }
    })
}
