import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { townContractDays, townContracts, townInventory, user } from '#server/database/schema'
import { deleteTownForUser, foundTown } from '#server/utils/town'
import { claimTownContractBonus, deliverTownContract, getTownContracts } from '#server/utils/town-contracts'
import { townContractDayKey } from '#shared/utils/gamelogic/town-contracts'
import { SKIP, burst, cleanupUser, lockTownRealm, moveTownToFlatGround, seedUser } from '../setup/db-helpers'

const OWNER = 'test-town-contracts-owner'

async function cleanup() {
    await db.delete(townContracts).where(eq(townContracts.userId, OWNER))
    await db.delete(townContractDays).where(eq(townContractDays.userId, OWNER))
    await deleteTownForUser(OWNER)
    await cleanupUser(OWNER)
}

async function town() {
    await seedUser(OWNER, { balance: '0', gems: 0 })
    const { plotId } = await foundTown(OWNER)
    await moveTownToFlatGround(plotId)
}

async function stock(resource: string, amount: number) {
    await db.insert(townInventory).values({ userId: OWNER, resource, amount })
        .onConflictDoUpdate({ target: [townInventory.userId, townInventory.resource], set: { amount } })
}

async function wallet() {
    const [row] = await db.select({ balance: user.balance, gems: user.gems }).from(user).where(eq(user.id, OWNER))
    return { balance: parseFloat(row!.balance), gems: row!.gems }
}

describe.skipIf(SKIP)('Polytown contracts (database)', () => {
    let releaseRealm: () => Promise<void>
    beforeAll(async () => { releaseRealm = await lockTownRealm() }, 120_000)

    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => {
        await releaseRealm()
        await db.$client.end()
    })

    it('rolls one set per day, even for parallel first views', async () => {
        await town()
        const views = await Promise.all(Array.from({ length: 6 }, () => getTownContracts(OWNER)))
        const ids = views.map(v => v.contracts.map(c => c.id).join(','))
        expect(new Set(ids).size).toBe(1)
        expect(views[0]!.contracts).toHaveLength(3)
        expect(new Set(views[0]!.contracts.map(c => c.resource)).size).toBe(3)

        const rows = await db.select().from(townContracts)
            .where(and(eq(townContracts.userId, OWNER), eq(townContracts.day, townContractDayKey(Date.now()))))
        expect(rows).toHaveLength(3)
        const days = await db.select().from(townContractDays).where(eq(townContractDays.userId, OWNER))
        expect(days).toHaveLength(1)
        expect(days[0]!.bonusGems).toBeGreaterThanOrEqual(1)
        expect(days[0]!.bonusGems).toBeLessThanOrEqual(5)
    })

    it('pays a burst of deliveries for one contract exactly once', async () => {
        await town()
        const { contracts } = await getTownContracts(OWNER)
        const c = contracts[0]!
        await stock(c.resource, c.quantity * 5)

        const result = await burst(10, () => deliverTownContract(OWNER, c.id))
        expect(result.ok).toBe(1)
        expect(result.rejected).toBe(9)

        const [inv] = await db.select().from(townInventory)
            .where(and(eq(townInventory.userId, OWNER), eq(townInventory.resource, c.resource)))
        expect(inv!.amount).toBeLessThanOrEqual(c.quantity * 4)
        expect((await wallet()).balance).toBeGreaterThan(0)
    })

    it('refuses a short delivery and leaves the contract open', async () => {
        await town()
        const { contracts } = await getTownContracts(OWNER)
        const c = contracts[0]!
        await stock(c.resource, c.quantity - 1)

        await expect(deliverTownContract(OWNER, c.id)).rejects.toThrow(/Not enough/)
        const [row] = await db.select().from(townContracts).where(eq(townContracts.id, c.id))
        expect(row!.delivered).toBe(false)
        expect((await wallet()).balance).toBe(0)
    })

    it('leaves the gem bonus for a manual claim after the third delivery', async () => {
        await town()
        const { contracts, bonus } = await getTownContracts(OWNER)
        expect(bonus.claimable).toBe(false)
        for (const c of contracts) await stock(c.resource, c.quantity * 3)

        const first = await deliverTownContract(OWNER, contracts[0]!.id)
        expect(first.bonusReady).toBe(false)
        // The last two at once: whichever lands second completes the set.
        const rest = await Promise.all(contracts.slice(1).map(c => deliverTownContract(OWNER, c.id)))
        expect(rest.filter(r => r.bonusReady)).toHaveLength(1)
        expect(rest.every(r => r.gems === 0)).toBe(true)

        expect((await wallet()).gems).toBe(0)
        const view = await getTownContracts(OWNER)
        expect(view.allDelivered).toBe(true)
        expect(view.bonus.claimed).toBe(false)
        expect(view.bonus.claimable).toBe(true)
    })

    it('refuses the bonus before all three are delivered', async () => {
        await town()
        const { contracts } = await getTownContracts(OWNER)
        await expect(claimTownContractBonus(OWNER)).rejects.toThrow(/Deliver all three/)

        for (const c of contracts.slice(0, 2)) {
            await stock(c.resource, c.quantity)
            await deliverTownContract(OWNER, c.id)
        }
        await expect(claimTownContractBonus(OWNER)).rejects.toThrow(/Deliver all three/)
        expect((await wallet()).gems).toBe(0)
        const view = await getTownContracts(OWNER)
        expect(view.bonus.claimed).toBe(false)
        expect(view.bonus.claimable).toBe(false)
    })

    it('pays a burst of bonus claims exactly once', async () => {
        await town()
        const { contracts, bonus } = await getTownContracts(OWNER)
        for (const c of contracts) {
            await stock(c.resource, c.quantity)
            await deliverTownContract(OWNER, c.id)
        }

        const result = await burst(10, () => claimTownContractBonus(OWNER))
        expect(result.ok).toBe(1)
        expect(result.rejected).toBe(9)
        expect((await wallet()).gems).toBe(bonus.gems)

        await expect(claimTownContractBonus(OWNER)).rejects.toThrow(/already claimed/)
        const view = await getTownContracts(OWNER)
        expect(view.bonus.claimed).toBe(true)
        expect(view.bonus.claimable).toBe(false)
    })

    it('rejects ids that are not a contract of this town', async () => {
        await town()
        await expect(deliverTownContract(OWNER, 'nope')).rejects.toThrow(/Unknown contract/)
        await expect(deliverTownContract(OWNER, crypto.randomUUID())).rejects.toThrow(/Unknown contract/)
    })
})
