import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { townBuildings, townState, townStorage, user } from '#server/database/schema'
import {
    deleteTownForUser,
    discardRedesignDraft,
    foundTown,
    getRedesignDraft,
    placeBuilding,
    placeStoredBuilding,
    redesignTown,
    saveRedesignDraft,
    settleTownForRead,
    storeBuildings
} from '#server/utils/town'
import { TOWN_FREE_BUILDERS } from '#shared/utils/gamelogic/town'
import { SKIP, burst, cleanupUser, lockTownRealm, moveTownToFlatGround, seedUser } from '../setup/db-helpers'

const OWNER = 'test-town-storage-owner'
const DAY = 24 * 3_600_000
const MIN = 60_000

async function cleanup() {
    await deleteTownForUser(OWNER)
    await cleanupUser(OWNER)
}

async function gems() {
    const [row] = await db.select({ gems: user.gems }).from(user).where(eq(user.id, OWNER))
    return row!.gems
}

async function storedRows() {
    return db.select().from(townStorage).where(eq(townStorage.userId, OWNER))
}

/** A finished building at `level` on (tileX, 3). */
async function standing(plotId: string, tileX: number, level = 3, type = 'house') {
    const [row] = await db.insert(townBuildings)
        .values({ userId: OWNER, plotId, type, tileX, tileY: 3, rotation: 0, level, completesAt: new Date(Date.now() - MIN) })
        .returning()
    return row!
}

/** A house under construction on (tileX, 3), finishing `ms` from now. */
async function site(plotId: string, tileX: number, ms: number) {
    const [row] = await db.insert(townBuildings)
        .values({ userId: OWNER, plotId, type: 'house', tileX, tileY: 3, rotation: 0, level: 0, completesAt: new Date(Date.now() + ms) })
        .returning()
    return row!
}

describe.skipIf(SKIP)('Polytown storage (database)', () => {
    let releaseRealm: () => Promise<void>
    let plotId: string
    beforeAll(async () => { releaseRealm = await lockTownRealm() }, 120_000)

    beforeEach(async () => {
        await cleanup()
        await seedUser(OWNER, { balance: '100000000000', gems: 100 })
        plotId = (await foundTown(OWNER)).plotId
        await moveTownToFlatGround(plotId)
    })
    afterEach(cleanup)
    afterAll(async () => { await releaseRealm() })

    it('takes a building off the map into storage, for nothing', async () => {
        const house = await standing(plotId, 0)
        await storeBuildings(OWNER, [house.id])
        expect((await storedRows()).map(r => r.id)).toEqual([house.id])
        expect(await db.select().from(townBuildings).where(eq(townBuildings.id, house.id))).toEqual([])
        expect(await gems()).toBe(100)
    })

    it('keeps a stored building as it was, however many days pass', async () => {
        const house = await standing(plotId, 0, 5)
        await storeBuildings(OWNER, [house.id])
        await db.update(townState).set({ lastSettledAt: new Date(Date.now() - 10 * DAY) }).where(eq(townState.userId, OWNER))
        await settleTownForRead(OWNER)
        const [row] = await storedRows()
        expect(row!.level).toBe(5)
        expect(await gems()).toBe(100)
    })

    it('stores roads, and lays them back for free', async () => {
        const { buildingId } = await placeBuilding(OWNER, plotId, 0, 0, 'road')
        await storeBuildings(OWNER, [buildingId])
        expect((await storedRows()).map(r => r.type)).toEqual(['road'])
        const [before] = await db.select({ balance: user.balance }).from(user).where(eq(user.id, OWNER))
        await placeStoredBuilding(OWNER, { buildingId, plotId, tileX: 5, tileY: 0, rotation: 0 })
        const [after] = await db.select({ balance: user.balance }).from(user).where(eq(user.id, OWNER))
        expect(after!.balance).toBe(before!.balance)
        expect(await db.select().from(townBuildings).where(eq(townBuildings.id, buildingId))).toHaveLength(1)
    })

    it('keeps a road a redesign stores, and still removes one it names nowhere', async () => {
        const kept = await placeBuilding(OWNER, plotId, 0, 0, 'road')
        const dropped = await placeBuilding(OWNER, plotId, 1, 0, 'road')
        const res = await redesignTown(OWNER, { moves: [], roads: [], store: [kept.buildingId] })
        expect(res.removed).toEqual([dropped.buildingId])
        expect((await storedRows()).map(r => r.id)).toEqual([kept.buildingId])
    })

    it('stores a building once under a burst of identical requests', async () => {
        const house = await standing(plotId, 0)
        const r = await burst(10, () => storeBuildings(OWNER, [house.id]))
        expect(r.ok).toBe(1)
        expect(await storedRows()).toHaveLength(1)
    })

    it('places a stored building once under a burst, never on two tiles', async () => {
        const house = await standing(plotId, 0)
        await storeBuildings(OWNER, [house.id])
        const r = await burst(10, i => placeStoredBuilding(OWNER, { buildingId: house.id, plotId, tileX: i % 8, tileY: 6, rotation: 0 }))
        expect(r.ok).toBe(1)
        expect(await db.select().from(townBuildings).where(eq(townBuildings.id, house.id))).toHaveLength(1)
        expect(await storedRows()).toEqual([])
    })

    it('pauses a construction in storage, frees its crew, and resumes it with the time it had left', async () => {
        const job = await site(plotId, 0, 30 * MIN)
        await storeBuildings(OWNER, [job.id])
        const [row] = await storedRows()
        expect(row!.remainingMs).toBeGreaterThan(29 * MIN)
        expect(row!.remainingMs).toBeLessThanOrEqual(30 * MIN)

        // The crew is free while the site sits in storage: all three can build.
        for (let x = 1; x <= TOWN_FREE_BUILDERS; x++) await placeBuilding(OWNER, plotId, x, 5, 'house')
        // ...so bringing the paused site back is refused until one frees up.
        await expect(placeStoredBuilding(OWNER, { buildingId: job.id, plotId, tileX: 0, tileY: 3, rotation: 0 }))
            .rejects.toMatchObject({ statusCode: 400 })

        await db.delete(townBuildings).where(eq(townBuildings.tileY, 5))
        const before = Date.now()
        await placeStoredBuilding(OWNER, { buildingId: job.id, plotId, tileX: 0, tileY: 3, rotation: 0 })
        const [back] = await db.select().from(townBuildings).where(eq(townBuildings.id, job.id))
        expect(back!.level).toBe(0)
        expect(back!.completesAt.getTime() - before).toBeGreaterThan(29 * MIN)
        expect(await storedRows()).toEqual([])
    })

    it('stores and places back in one redesign save', async () => {
        const a = await standing(plotId, 0)
        const b = await standing(plotId, 1)
        const c = await standing(plotId, 2)
        await storeBuildings(OWNER, [c.id])

        await redesignTown(OWNER, {
            moves: [{ buildingId: a.id, plotId, tileX: 0, tileY: 3, rotation: 0 }],
            roads: [],
            store: [b.id],
            place: [{ buildingId: c.id, plotId, tileX: 4, tileY: 4, rotation: 1 }]
        })
        expect((await storedRows()).map(r => r.id)).toEqual([b.id])
        const [back] = await db.select().from(townBuildings).where(eq(townBuildings.id, c.id))
        expect(back).toMatchObject({ tileX: 4, tileY: 4, rotation: 1, level: 3 })
    })

    it('refuses a redesign that forgets a building, rather than losing it', async () => {
        await standing(plotId, 0)
        const b = await standing(plotId, 1)
        await expect(redesignTown(OWNER, { moves: [{ buildingId: b.id, plotId, tileX: 1, tileY: 3, rotation: 0 }], roads: [] }))
            .rejects.toMatchObject({ statusCode: 400 })
    })

    it('counts stored buildings toward the cap', async () => {
        // One pyramid per town. Research credit skips the tier lock, so the
        // cap is the only thing that can refuse the second one.
        await db.update(townState).set({ monumentCredit: { pyramid: 1 } }).where(eq(townState.userId, OWNER))
        const pyramid = await standing(plotId, 0, 1, 'pyramid')
        await storeBuildings(OWNER, [pyramid.id])
        await expect(placeBuilding(OWNER, plotId, 4, 4, 'pyramid')).rejects.toMatchObject({ statusCode: 400 })
        // Control: with the stored one gone, the same placement goes through.
        await db.delete(townStorage).where(eq(townStorage.id, pyramid.id))
        await placeBuilding(OWNER, plotId, 4, 4, 'pyramid')
    })
})

describe.skipIf(SKIP)('Polytown redesign drafts (database)', () => {
    let releaseRealm: () => Promise<void>
    let plotId: string
    beforeAll(async () => { releaseRealm = await lockTownRealm() }, 120_000)

    beforeEach(async () => {
        await cleanup()
        await seedUser(OWNER, { balance: '100000000000', gems: 100 })
        plotId = (await foundTown(OWNER)).plotId
        await moveTownToFlatGround(plotId)
    })
    afterEach(cleanup)
    afterAll(async () => { await releaseRealm() })

    const spot = (tileX: number) => ({ plotId: '', tileX, tileY: 3, rotation: 0 })

    it('keeps a half-done redesign without touching the town, and the last save wins', async () => {
        const a = await standing(plotId, 0)
        await saveRedesignDraft(OWNER, { placed: { [a.id]: { ...spot(5), plotId } }, newRoads: {}, toStore: [] })
        await saveRedesignDraft(OWNER, { placed: { [a.id]: { ...spot(6), plotId } }, newRoads: {}, toStore: [] })
        const saved = await getRedesignDraft(OWNER)
        expect(saved!.draft.placed[a.id]!.tileX).toBe(6)
        // A plan only: the building has not moved.
        const [row] = await db.select().from(townBuildings).where(eq(townBuildings.id, a.id))
        expect(row!.tileX).toBe(0)
    })

    it('spends the draft when the redesign is saved in full', async () => {
        const a = await standing(plotId, 0)
        await saveRedesignDraft(OWNER, { placed: {}, newRoads: {}, toStore: [a.id] })
        await redesignTown(OWNER, { moves: [], roads: [], store: [a.id] })
        expect(await getRedesignDraft(OWNER)).toBeNull()
    })

    it('keeps the draft when the full save is refused', async () => {
        await standing(plotId, 0)
        const b = await standing(plotId, 1)
        await saveRedesignDraft(OWNER, { placed: {}, newRoads: {}, toStore: [] })
        await expect(redesignTown(OWNER, { moves: [{ buildingId: b.id, plotId, tileX: 1, tileY: 3, rotation: 0 }], roads: [] })).rejects.toBeTruthy()
        expect(await getRedesignDraft(OWNER)).not.toBeNull()
    })

    it('discards a draft on request', async () => {
        await saveRedesignDraft(OWNER, { placed: {}, newRoads: {}, toStore: [] })
        await discardRedesignDraft(OWNER)
        expect(await getRedesignDraft(OWNER)).toBeNull()
    })

    it('refuses a draft for a mayor without a town', async () => {
        await expect(saveRedesignDraft('test-town-storage-nobody', { placed: {}, newRoads: {}, toStore: [] })).rejects.toMatchObject({ statusCode: 400 })
    })
})
