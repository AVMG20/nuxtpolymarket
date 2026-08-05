/**
 * The prestige shop: tokens are actually charged, limits actually hold, the
 * effects actually land in each game's tables, and an ascent takes every perk
 * back while restoring the allowance that paid for it.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import {
    bankState,
    colonyBuilderJobs,
    colonyBugs,
    colonyState,
    colonyUpgrades,
    hackAgents,
    hackItems,
    minerState,
    prestigePurchases,
    user,
    xenoPlants,
    xenoPlantsUnlocked
} from '#server/database/schema'
import { buyPrestigeShopItem, getPrestigePurchaseCount } from '#server/utils/prestige-shop'
import { prestigeUser } from '#server/utils/prestige'
import {
    COLONY_BROOD_PACKS,
    COLONY_HIVE_SNAILS_PER_PURCHASE,
    COLONY_HIVE_SNAIL_TYPE_ID,
    CREDIT_LINE_PER_PURCHASE,
    HACK_DARKNET_AGENTS,
    HACK_DARKNET_ITEMS,
    MINER_CORE_RIG_GRANT,
    XENO_LEAP_PLANTS_PER_TYPE,
    minerRigMaxLevel,
    prestigeShopItem
} from '#shared/utils/prestige-shop'
import { LOAN_MULTIPLIER } from '#shared/utils/gamelogic/bank'
import { CATALYST_MAX_LEVEL, OVERCLOCK_MAX_LEVEL } from '#shared/utils/miner-config'
import { PRESTIGE_TIERS } from '#shared/utils/prestige'
import { PLANT_TYPES } from '#shared/utils/xeno'
import { BASE_BUILDER_COUNT, HABITAT_BUILDER_JOB_ID, UPGRADE_TRACKS, gemTickMs, getBug, habitatTrackRequirement } from '#shared/utils/colony'
import { getBuilderCount } from '#server/utils/colony'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-prestige-shop-user'
const TIER_2 = PRESTIGE_TIERS[1]!

/** Seed an account that has already prestiged once, with `tokens` to spend. */
async function seedPrestiged(tokens: number) {
    await seedUser(USER_ID)
    await db.update(user)
        .set({ prestige: 1, prestigeTokens: tokens })
        .where(eq(user.id, USER_ID))
}

async function readUser() {
    return db.query.user.findFirst({ where: eq(user.id, USER_ID) })
}

async function cleanup() {
    await cleanupUser(USER_ID)
}

describe.skipIf(SKIP)('prestige shop', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('charges the token price and records the purchase', async () => {
        await seedPrestiged(5)

        const result = await buyPrestigeShopItem(USER_ID, 'colony-brood')

        expect(result.spent).toBe(1)
        expect(result.owned).toBe(1)
        expect(result.tokensLeft).toBe(4)
        expect((await readUser())?.prestigeTokens).toBe(4)
        expect(await getPrestigePurchaseCount(USER_ID, 'colony-brood')).toBe(1)
    })

    it('refuses to sell to an account that has never prestiged', async () => {
        await seedUser(USER_ID)
        // Tokens without a level should still not open the shop.
        await db.update(user).set({ prestigeTokens: 5 }).where(eq(user.id, USER_ID))

        await expect(buyPrestigeShopItem(USER_ID, 'colony-brood')).rejects.toThrow(/prestige at least once/i)
    })

    it('refuses a purchase the player cannot afford, and charges nothing', async () => {
        await seedPrestiged(2)

        await expect(buyPrestigeShopItem(USER_ID, 'colony-uplink')).rejects.toThrow(/token/i)
        expect((await readUser())?.prestigeTokens).toBe(2)
        expect(await getPrestigePurchaseCount(USER_ID, 'colony-uplink')).toBe(0)
    })

    it('stops selling an item once its per-run limit is reached', async () => {
        await seedPrestiged(20)
        const item = prestigeShopItem('colony-brood')!

        for (let i = 0; i < item.maxOwned; i++) await buyPrestigeShopItem(USER_ID, item.id)

        await expect(buyPrestigeShopItem(USER_ID, item.id)).rejects.toThrow(/fully bought/i)
        expect(await getPrestigePurchaseCount(USER_ID, item.id)).toBe(item.maxOwned)
    })

    it('escalates the Xenogenesis Leap price with each purchase', async () => {
        await seedPrestiged(20)

        const first = await buyPrestigeShopItem(USER_ID, 'xeno-leap')
        const second = await buyPrestigeShopItem(USER_ID, 'xeno-leap')
        const third = await buyPrestigeShopItem(USER_ID, 'xeno-leap')

        expect([first.spent, second.spent, third.spent]).toEqual([1, 2, 3])
        expect((await readUser())?.prestigeTokens).toBe(20 - 6)
    })

    // Every escalating item reads its own count and then writes a price derived
    // from it. Without the FOR UPDATE lock on the user row, N concurrent buys
    // would all read the same count and all pay the same (cheapest) price.
    it('serialises a burst of concurrent buys against one token budget', async () => {
        await seedPrestiged(3)

        // 1 + 2 = 3 tokens buys exactly two leaps; the rest must be rejected.
        const result = await burst(6, () => buyPrestigeShopItem(USER_ID, 'xeno-leap'))

        expect(result.ok).toBe(2)
        expect(result.rejected).toBe(4)
        expect((await readUser())?.prestigeTokens).toBe(0)
        expect(await getPrestigePurchaseCount(USER_ID, 'xeno-leap')).toBe(2)
    })

    it('raises the miner ceilings and hands over the granted levels', async () => {
        await seedPrestiged(5)

        await buyPrestigeShopItem(USER_ID, 'miner-core')

        const [state] = await db.select().from(minerState).where(eq(minerState.userId, USER_ID))
        // Fresh state starts at rig 1, so the grant lands in full.
        expect(state?.rigLevel).toBe(1 + MINER_CORE_RIG_GRANT)
        expect(minerRigMaxLevel(await getPrestigePurchaseCount(USER_ID, 'miner-core'))).toBe(105)
    })

    it('never pushes a maxed rig past the ceiling it just raised', async () => {
        await seedPrestiged(5)
        await db.insert(minerState).values({ userId: USER_ID, rigLevel: 100, vaultLevel: 100 })

        await buyPrestigeShopItem(USER_ID, 'miner-core')

        const [state] = await db.select().from(minerState).where(eq(minerState.userId, USER_ID))
        expect(state?.rigLevel).toBe(105)
        expect(state?.rigLevel).toBeLessThanOrEqual(minerRigMaxLevel(1))
    })

    it('stocks every plant up to T3 on the first Xenogenesis Leap', async () => {
        await seedPrestiged(5)

        await buyPrestigeShopItem(USER_ID, 'xeno-leap')

        const expectedTypes = PLANT_TYPES.filter(plant => plant.tier <= 3)
        const plants = await db.select().from(xenoPlants).where(eq(xenoPlants.userId, USER_ID))
        const unlocked = await db.select().from(xenoPlantsUnlocked).where(eq(xenoPlantsUnlocked.userId, USER_ID))

        expect(plants.length).toBe(expectedTypes.length * XENO_LEAP_PLANTS_PER_TYPE)
        expect(unlocked.length).toBe(expectedTypes.length)
        // The second leap stocks only its own tier, not everything again.
        await buyPrestigeShopItem(USER_ID, 'xeno-leap')
        const t4 = PLANT_TYPES.filter(plant => plant.tier === 4)
        const after = await db.select().from(xenoPlants).where(eq(xenoPlants.userId, USER_ID))
        expect(after.length).toBe((expectedTypes.length + t4.length) * XENO_LEAP_PLANTS_PER_TYPE)
    })

    it('completes the track requirements and raises the habitat level', async () => {
        await seedPrestiged(5)

        await buyPrestigeShopItem(USER_ID, 'colony-uplink')

        const [state] = await db.select().from(colonyState).where(eq(colonyState.userId, USER_ID))
        expect(state?.habitatLevel).toBe(2)
        const jobs = await db.select().from(colonyBuilderJobs).where(eq(colonyBuilderJobs.userId, USER_ID))
        expect(jobs).toEqual([])

        const levels = await db.select().from(colonyUpgrades).where(eq(colonyUpgrades.userId, USER_ID))
        for (const track of UPGRADE_TRACKS) {
            const row = levels.find(entry => entry.trackId === track.id)
            // Requirements are indexed by the level being left behind — 1 here.
            expect(row?.level).toBe(habitatTrackRequirement(track.id, 1))
        }
    })

    it('hands over the escalating Brood Seed packs, not the same one twice', async () => {
        await seedPrestiged(5)

        const first = await buyPrestigeShopItem(USER_ID, 'colony-brood')
        expect(first.spent).toBe(1)
        const afterFirst = await db.select().from(colonyBugs).where(eq(colonyBugs.userId, USER_ID))
        expect(afterFirst.length).toBe(COLONY_BROOD_PACKS[0]!.reduce((n, e) => n + e.quantity, 0))

        const second = await buyPrestigeShopItem(USER_ID, 'colony-brood')
        expect(second.spent).toBe(3)
        const afterSecond = await db.select().from(colonyBugs).where(eq(colonyBugs.userId, USER_ID))
        // Pack 2 is the T2/T3 scale-up — it must contain species pack 1 did not.
        expect(afterSecond.filter(bug => bug.typeId === 'cricket').length).toBe(1)
        expect(afterSecond.filter(bug => bug.typeId === 'ant').length).toBe(1)
    })

    it('grants social Hive Snails, which are not otherwise obtainable', async () => {
        await seedPrestiged(5)

        await buyPrestigeShopItem(USER_ID, 'colony-hive-snail')

        const bugs = await db.select().from(colonyBugs).where(eq(colonyBugs.userId, USER_ID))
        expect(bugs.length).toBe(COLONY_HIVE_SNAILS_PER_PURCHASE)
        expect(bugs.every(bug => bug.typeId === COLONY_HIVE_SNAIL_TYPE_ID)).toBe(true)
        // The whole point: five of them hold the base cycle, where five
        // ordinary Gem Snails crowd each other into a longer one. Social does
        // NOT make them faster — gemTickMs clamps the multiplier at 1.
        const hive = { typeId: COLONY_HIVE_SNAIL_TYPE_ID }
        const base = getBug(COLONY_HIVE_SNAIL_TYPE_ID)!.baseTickMs
        expect(gemTickMs(hive, COLONY_HIVE_SNAILS_PER_PURCHASE)).toBe(base)
        expect(gemTickMs(hive, 1)).toBe(base)
        expect(gemTickMs({ typeId: 'gem_snail' }, COLONY_HIVE_SNAILS_PER_PURCHASE)).toBeGreaterThan(base)
    })

    it('sells the gem tracks in two halves, cheap half first', async () => {
        await seedPrestiged(6)

        const first = await buyPrestigeShopItem(USER_ID, 'miner-overclock')
        expect(first.spent).toBe(1)
        let [state] = await db.select().from(minerState).where(eq(minerState.userId, USER_ID))
        expect(state?.overclockLevel).toBe(5)

        const second = await buyPrestigeShopItem(USER_ID, 'miner-overclock')
        expect(second.spent).toBe(2)
        ;[state] = await db.select().from(minerState).where(eq(minerState.userId, USER_ID))
        expect(state?.overclockLevel).toBe(OVERCLOCK_MAX_LEVEL)

        await buyPrestigeShopItem(USER_ID, 'miner-catalyst')
        ;[state] = await db.select().from(minerState).where(eq(minerState.userId, USER_ID))
        expect(state?.catalystLevel).toBe(5)
        await buyPrestigeShopItem(USER_ID, 'miner-catalyst')
        ;[state] = await db.select().from(minerState).where(eq(minerState.userId, USER_ID))
        expect(state?.catalystLevel).toBe(CATALYST_MAX_LEVEL)
    })

    // A player who ground the gem shop up to level 8 must not be knocked back
    // to 5 by buying the cheap half.
    it('never lowers a gem track a player already paid gems for', async () => {
        await seedPrestiged(5)
        await db.insert(minerState).values({ userId: USER_ID, overclockLevel: 8 })

        await buyPrestigeShopItem(USER_ID, 'miner-overclock')

        const [state] = await db.select().from(minerState).where(eq(minerState.userId, USER_ID))
        expect(state?.overclockLevel).toBe(8)
    })

    it('raises the builder count without writing colony state', async () => {
        await seedPrestiged(20)
        expect(await getBuilderCount(USER_ID)).toBe(BASE_BUILDER_COUNT)

        await buyPrestigeShopItem(USER_ID, 'colony-builder')
        expect(await getBuilderCount(USER_ID)).toBe(BASE_BUILDER_COUNT + 1)

        await buyPrestigeShopItem(USER_ID, 'colony-builder')
        expect(await getBuilderCount(USER_ID)).toBe(BASE_BUILDER_COUNT + 2)

        await expect(buyPrestigeShopItem(USER_ID, 'colony-builder')).rejects.toThrow(/fully bought/i)
    })

    // The uplink retargets any track it raises — a builder on that track would
    // collect a level nobody paid for — but a track the player already pushed
    // PAST the requirement is untouched, so cancelling its build would burn
    // the coins and items already spent on it.
    it('cancels only the builds the uplink actually invalidated', async () => {
        await seedPrestiged(5)
        await db.insert(colonyState).values({ userId: USER_ID })

        // capacity needs level 2 for habitat 1→2; put the player well past it.
        const required = habitatTrackRequirement('capacity', 1)
        await db.insert(colonyUpgrades).values({ userId: USER_ID, trackId: 'capacity', level: required + 3 })
        await db.insert(colonyBuilderJobs).values([
            { userId: USER_ID, trackId: 'capacity' },
            { userId: USER_ID, trackId: 'speed_boost' },
            { userId: USER_ID, trackId: HABITAT_BUILDER_JOB_ID }
        ])

        await buyPrestigeShopItem(USER_ID, 'colony-uplink')

        const jobs = await db.select().from(colonyBuilderJobs).where(eq(colonyBuilderJobs.userId, USER_ID))
        // capacity was above the requirement, so its build still targets the
        // level it was sold and survives. speed_boost was raised, and the
        // habitat job built the level just granted — both go.
        expect(jobs.map(job => job.trackId)).toEqual(['capacity'])

        // ...and the untouched track keeps the level it already had.
        const [capacity] = await db.select().from(colonyUpgrades)
            .where(and(eq(colonyUpgrades.userId, USER_ID), eq(colonyUpgrades.trackId, 'capacity')))
        expect(capacity?.level).toBe(required + 3)
    })

    it('delivers a whole HackOps package of agents and items', async () => {
        await seedPrestiged(5)

        await buyPrestigeShopItem(USER_ID, 'hack-darknet')

        const agents = await db.select().from(hackAgents).where(eq(hackAgents.userId, USER_ID))
        const items = await db.select().from(hackItems).where(eq(hackItems.userId, USER_ID))
        expect(agents.length).toBe(HACK_DARKNET_AGENTS)
        expect(items.length).toBe(HACK_DARKNET_ITEMS)
    })

    it('grants borrowing power against an empty bank', async () => {
        await seedPrestiged(5)

        await buyPrestigeShopItem(USER_ID, 'account-credit')

        const [bank] = await db.select().from(bankState).where(eq(bankState.userId, USER_ID))
        // maxPrincipal x LOAN_MULTIPLIER is the loan allowance, so the row
        // holds a tenth of what the player can actually borrow.
        expect(parseFloat(bank!.maxPrincipal) * LOAN_MULTIPLIER).toBe(CREDIT_LINE_PER_PURCHASE)
    })

    it('unlocks rakeback on the user row', async () => {
        await seedPrestiged(5)

        await buyPrestigeShopItem(USER_ID, 'account-rakeback')

        expect((await readUser())?.rakebackUnlocked).toBe(true)
    })

    // The whole reason perks are safe to hand out: the next ascent takes them
    // back, and hands back the allowance that bought them.
    it('wipes every perk on the next ascent and restores the full allowance', async () => {
        await seedPrestiged(5)
        await buyPrestigeShopItem(USER_ID, 'miner-core')
        await buyPrestigeShopItem(USER_ID, 'colony-brood')
        await buyPrestigeShopItem(USER_ID, 'hack-darknet')
        expect((await readUser())?.prestigeTokens).toBe(2)

        await db.update(user)
            .set({ balance: `${TIER_2.coinCost}.0000`, gems: TIER_2.gemCost })
            .where(eq(user.id, USER_ID))

        const result = await prestigeUser(USER_ID)

        expect(result.tokens).toBe(TIER_2.tokens)
        const [purchases, miner, bugs, agents] = await Promise.all([
            db.select().from(prestigePurchases).where(eq(prestigePurchases.userId, USER_ID)),
            db.select().from(minerState).where(eq(minerState.userId, USER_ID)),
            db.select().from(colonyBugs).where(eq(colonyBugs.userId, USER_ID)),
            db.select().from(hackAgents).where(eq(hackAgents.userId, USER_ID))
        ])
        expect(purchases.length).toBe(0)
        expect(miner.length).toBe(0)
        expect(bugs.length).toBe(0)
        expect(agents.length).toBe(0)
        // The raised miner ceiling is gone with the purchase row.
        expect(minerRigMaxLevel(await getPrestigePurchaseCount(USER_ID, 'miner-core'))).toBe(100)
    })

    it('keeps a rejected purchase from leaving a partial effect behind', async () => {
        await seedPrestiged(1)

        // colony-uplink costs 3; the transaction must roll back whole.
        await expect(buyPrestigeShopItem(USER_ID, 'colony-uplink')).rejects.toThrow()

        const rows = await db.select().from(colonyUpgrades)
            .where(and(eq(colonyUpgrades.userId, USER_ID), eq(colonyUpgrades.trackId, 'capacity')))
        expect(rows.length).toBe(0)
        expect((await readUser())?.prestigeTokens).toBe(1)
    })
})
