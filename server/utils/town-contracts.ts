import { and, asc, eq, lt, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { townContractDays, townContracts, user } from '#server/database/schema'
import { credit, creditGems } from '#server/utils/balance'
import { getTownState, recordEarnings, settleTownForRead, settleTownState, takeInventory, type SettledTown } from '#server/utils/town'
import { deriveTown, getTownResource, isTownResourceId } from '#shared/utils/gamelogic/town'
import {
    TOWN_CONTRACT_KEEP_DAYS,
    TOWN_CONTRACT_SLOTS,
    rollTownContracts,
    townContractDayBefore,
    townContractDayKey,
    townContractFloorValue,
    townContractRates,
    townContractResetAt
} from '#shared/utils/gamelogic/town-contracts'

/** Prefixed `polytown` so analytics group it with the rest of the town's income. Garnished like any earning. */
const CATEGORY = 'polytown:contract'

const CONTRACT_ID = /^[0-9a-f-]{36}$/i

async function requireTown(userId: string) {
    if (!await getTownState(userId)) throw createError({ statusCode: 400, statusMessage: 'Found a town first' })
}

/**
 * Roll today's contracts unless they exist. The day row is the mutex: it is
 * inserted first with ON CONFLICT DO NOTHING, and only the transaction that
 * got a row back writes the contracts. A parallel first view blocks on the
 * unique index until the winner commits, then reads the winner's roll.
 */
async function ensureContracts(userId: string, day: string, settled: SettledTown, now: number) {
    const [existing] = await db.select({ id: townContractDays.id }).from(townContractDays)
        .where(and(eq(townContractDays.userId, userId), eq(townContractDays.day, day)))
        .limit(1)
    if (existing) return

    const derived = deriveTown(settled.sim, settled.state.happiness, now, settled.satisfied)
    const roll = rollTownContracts(townContractRates(settled.sim, derived, now), derived.storageCap)

    await db.transaction(async (tx) => {
        const [created] = await tx.insert(townContractDays)
            .values({ userId, day, bonusGems: roll.bonusGems })
            .onConflictDoNothing()
            .returning({ id: townContractDays.id })
        if (!created) return
        await tx.insert(townContracts)
            .values(roll.contracts.map(c => ({
                userId,
                day,
                slot: c.slot,
                resource: c.resource,
                quantity: c.quantity,
                reward: c.reward.toFixed(4)
            })))
            .onConflictDoNothing()

        // Day keys sort as text, so anything older than a week goes in one pass.
        const cutoff = townContractDayBefore(now, TOWN_CONTRACT_KEEP_DAYS)
        await tx.delete(townContracts).where(and(eq(townContracts.userId, userId), lt(townContracts.day, cutoff)))
        await tx.delete(townContractDays).where(and(eq(townContractDays.userId, userId), lt(townContractDays.day, cutoff)))
    })
}

export async function getTownContracts(userId: string) {
    await requireTown(userId)
    const now = Date.now()
    const day = townContractDayKey(now)
    const settled = await settleTownForRead(userId)
    await ensureContracts(userId, day, settled, now)

    const [rows, [dayRow]] = await Promise.all([
        db.select().from(townContracts)
            .where(and(eq(townContracts.userId, userId), eq(townContracts.day, day)))
            .orderBy(asc(townContracts.slot)),
        db.select().from(townContractDays)
            .where(and(eq(townContractDays.userId, userId), eq(townContractDays.day, day)))
    ])

    const contracts = rows.map((row) => {
        const resource = isTownResourceId(row.resource) ? row.resource : null
        return {
            id: row.id,
            slot: row.slot,
            resource: row.resource,
            name: getTownResource(row.resource)?.name ?? row.resource,
            quantity: row.quantity,
            reward: parseFloat(row.reward),
            floorValue: resource ? townContractFloorValue(resource, row.quantity) : 0,
            delivered: row.delivered,
            have: resource ? settled.inventory[resource] ?? 0 : 0
        }
    })

    const allDelivered = contracts.length > 0 && contracts.every(c => c.delivered)
    const claimed = dayRow?.bonusClaimed ?? false
    return {
        day,
        serverNow: now,
        resetAt: townContractResetAt(now),
        contracts,
        bonus: { gems: dayRow?.bonusGems ?? 0, claimed, claimable: allDelivered && !claimed },
        allDelivered
    }
}

/**
 * Hand one contract's goods to the hall. All or nothing, and safe under a
 * burst: the settle locks the town (town_state → town_inventory), the
 * delivered flag flips false → true as the guard, the goods leave in a
 * conditional decrement that throws when short (rolling the flip back), and
 * the coins land in the same transaction. Every delivery for one town queues
 * on that lock, so the third one always sees the other two. The gem bonus is
 * not paid here: the player claims it with `claimTownContractBonus`.
 */
export async function deliverTownContract(userId: string, contractId: string) {
    if (!CONTRACT_ID.test(contractId)) throw createError({ statusCode: 400, statusMessage: 'Unknown contract' })
    await requireTown(userId)

    return db.transaction(async (tx) => {
        const now = Date.now()
        const day = townContractDayKey(now)
        // Production up to this instant lands first, so goods made a second ago count.
        await settleTownState(tx, userId, now)

        const [contract] = await tx.update(townContracts)
            .set({ delivered: true, deliveredAt: new Date(now) })
            .where(and(
                eq(townContracts.id, contractId),
                eq(townContracts.userId, userId),
                eq(townContracts.day, day),
                eq(townContracts.delivered, false)
            ))
            .returning()
        if (!contract) {
            const [row] = await tx.select({ delivered: townContracts.delivered }).from(townContracts)
                .where(and(eq(townContracts.id, contractId), eq(townContracts.userId, userId)))
            const message = !row ? 'Unknown contract' : row.delivered ? 'Already delivered' : 'That contract has expired'
            throw createError({ statusCode: 400, statusMessage: message })
        }
        if (!isTownResourceId(contract.resource)) throw createError({ statusCode: 500, statusMessage: 'Unknown contract good' })

        await takeInventory(tx, userId, contract.resource, contract.quantity)
        await credit(userId, contract.reward, CATEGORY, tx)
        // A contract is a sale to the town hall, so it counts toward the merchant goals.
        await recordEarnings(tx, userId, parseFloat(contract.reward))

        const [done] = await tx.select({ count: sql<number>`count(*)::int` }).from(townContracts)
            .where(and(eq(townContracts.userId, userId), eq(townContracts.day, day), eq(townContracts.delivered, true)))
        const allDelivered = (done?.count ?? 0) >= TOWN_CONTRACT_SLOTS

        let bonusReady = false
        if (allDelivered) {
            const [dayRow] = await tx.select({ bonusClaimed: townContractDays.bonusClaimed }).from(townContractDays)
                .where(and(eq(townContractDays.userId, userId), eq(townContractDays.day, day)))
            bonusReady = dayRow ? !dayRow.bonusClaimed : false
        }

        const [wallet] = await tx.select({ balance: user.balance, gems: user.gems }).from(user).where(eq(user.id, userId))
        return {
            id: contract.id,
            resource: contract.resource,
            quantity: contract.quantity,
            reward: parseFloat(contract.reward),
            bonusReady,
            allDelivered,
            balance: wallet?.balance ?? '0',
            gems: wallet?.gems ?? 0
        }
    })
}

/**
 * Pay today's gem bonus once all three contracts are in. Claim-then-reward:
 * the bonus_claimed flag flips false → true only while every one of today's
 * contracts is delivered, and the gems land in the same transaction, so a
 * burst of claims pays once. Yesterday's unclaimed bonus expires with its day.
 */
export async function claimTownContractBonus(userId: string) {
    await requireTown(userId)

    return db.transaction(async (tx) => {
        const day = townContractDayKey(Date.now())
        const delivered = sql<number>`(
            select count(*) from ${townContracts}
            where ${townContracts.userId} = ${userId}
              and ${townContracts.day} = ${day}
              and ${townContracts.delivered} = true
        )`

        const [claimed] = await tx.update(townContractDays)
            .set({ bonusClaimed: true })
            .where(and(
                eq(townContractDays.userId, userId),
                eq(townContractDays.day, day),
                eq(townContractDays.bonusClaimed, false),
                sql`${delivered} >= ${TOWN_CONTRACT_SLOTS}`
            ))
            .returning({ bonusGems: townContractDays.bonusGems })
        if (!claimed) {
            const [row] = await tx.select({ bonusClaimed: townContractDays.bonusClaimed }).from(townContractDays)
                .where(and(eq(townContractDays.userId, userId), eq(townContractDays.day, day)))
            const message = row?.bonusClaimed ? 'Bonus already claimed' : 'Deliver all three contracts first'
            throw createError({ statusCode: 400, statusMessage: message })
        }

        await creditGems(userId, claimed.bonusGems, tx)

        const [wallet] = await tx.select({ balance: user.balance, gems: user.gems }).from(user).where(eq(user.id, userId))
        return {
            gems: claimed.bonusGems,
            balance: wallet?.balance ?? '0',
            userGems: wallet?.gems ?? 0
        }
    })
}
