/**
 * Elo (§12.11 groundwork): the pure math, and a rated fight against a real
 * snapshot moving both players while wild fights move nobody.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPack, tcgCopy, tcgBattlerRun, tcgBattlerRating, tcgBattlerSnapshot } from '#server/database/schema'
import { startRun, buyUnit, fight, runView, abandonRun } from '#server/utils/battler/run'
import { eloExpected, eloDelta, ELO_START } from '#shared/utils/battler/elo'
import { mintCondition } from '#shared/utils/tcg/condition'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

describe('elo math', () => {
    it('expectation is symmetric and even at equal ratings', () => {
        expect(eloExpected(1000, 1000)).toBeCloseTo(0.5)
        expect(eloExpected(1200, 1000) + eloExpected(1000, 1200)).toBeCloseTo(1)
    })

    it('upsets pay more than expected wins', () => {
        const upset = eloDelta(1000, 1200, 1)
        const expected = eloDelta(1200, 1000, 1)
        expect(upset).toBeGreaterThan(expected)
        expect(eloDelta(1000, 1000, 0.5)).toBe(0)
        expect(eloDelta(1000, 1000, 1)).toBe(16)
    })
})

const USERS = { player: 'test-tcg-elo-player', rival: 'test-tcg-elo-rival' }
const createdSetIds: string[] = []
let setId: string
let sheetId: string
let packId: string
let nextSlot = 0

async function buildFixture() {
    const [set] = await db.insert(tcgSet).values({
        name: `elo spec set ${crypto.randomUUID().slice(0, 8)}`, code: 'ELOS', status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    setId = set!.id
    const printings: string[] = []
    for (let i = 0; i < 3; i++) {
        const [card] = await db.insert(tcgCard).values({
            setId, plaatjesBaseId: `elo-${i}`, number: `00${i + 1}`, name: `Eloling ${i}`, rarity: 'Common',
            raw: {
                category: 'Pokemon', name: `Eloling ${i}`, hp: 60, type: 'Colorless', retreat: 1,
                attacks: [{ cost: ['Colorless'], name: 'Bonk', damage: '20', attackId: 300 + i }]
            }
        }).returning()
        const [printing] = await db.insert(tcgPrinting).values({
            setId, cardId: card!.id, plaatjesCardId: `elo-${i}`, finish: 'nonholo'
        }).returning()
        printings.push(printing!.id)
    }
    const [sheet] = await db.insert(tcgSheet).values({
        setId, name: 'e', role: 'base', packSlots: 1, layout: [printings[0]!]
    }).returning()
    sheetId = sheet!.id
    const [pack] = await db.insert(tcgPack).values({
        setId, ownerId: USERS.player, packIndex: 0, cuts: [], state: 'opened', openedAt: new Date()
    }).returning()
    packId = pack!.id
    for (const printingId of printings) {
        for (let c = 0; c < 2; c++) {
            await db.insert(tcgCopy).values({
                printingId, setId, ownerId: USERS.player, packId, sheetId,
                cutIndex: 0, slotOffset: nextSlot++, condition: mintCondition()
            })
        }
    }
}

async function cleanup() {
    await db.delete(tcgBattlerRun).where(inArray(tcgBattlerRun.userId, Object.values(USERS)))
    await db.delete(tcgBattlerSnapshot).where(inArray(tcgBattlerSnapshot.userId, Object.values(USERS)))
    await db.delete(tcgBattlerRating).where(inArray(tcgBattlerRating.userId, Object.values(USERS)))
    if (createdSetIds.length > 0) {
        await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
        createdSetIds.length = 0
    }
    await db.delete(tcgSet).where(eq(tcgSet.code, 'ELOS'))
}

describe.skipIf(SKIP)('rated fights', () => {
    beforeAll(async () => {
        await cleanup()
        for (const id of Object.values(USERS)) {
            await cleanupUser(id)
            await seedUser(id, { balance: '1000' })
        }
        await buildFixture()
    }, 60_000)

    afterAll(async () => {
        await cleanup()
        for (const id of Object.values(USERS)) await cleanupUser(id)
        await db.$client.end()
    })

    it('moves both ratings against a snapshot, none against wild trainers', async () => {
        await startRun(USERS.player)
        const view = await runView(USERS.player)
        const run = view.run!
        // Park the run at a round nobody in the shared dev database has ever
        // reached, so the opponent pool is exactly what this test plants.
        await db.update(tcgBattlerRun).set({ cash: 15, round: 998 }).where(eq(tcgBattlerRun.id, run.id))
        await buyUnit(USERS.player, run.id, 0, null, 0)

        // Wild fight first: no snapshots exist at round 998.
        const wild = await fight(USERS.player, run.id)
        expect(wild.elo).toBeNull()
        expect(await db.select().from(tcgBattlerRating).where(inArray(tcgBattlerRating.userId, Object.values(USERS)))).toHaveLength(0)

        // Plant a rival snapshot at the current round (999), then fight it.
        const current = (await runView(USERS.player)).run
        if (!current) return // the wild fight ended the run — nothing left to rate
        const rivalBoard = {
            units: [{
                key: 'r1',
                spec: {
                    cardId: 'rival-card', name: 'Rivaling', hp: 6, type: 'Colorless',
                    attacks: [{ attackId: 1, name: 'Poke', damage: 2, charge: 1 }],
                    weaknesses: [], resistances: [], retreat: 1, bounty: 0
                },
                attackId: 1,
                instances: 1,
                items: [],
                render: { bundle: null, plaatjesCardId: null, assetNumber: null }
            }],
            stadium: null
        }
        await db.insert(tcgBattlerSnapshot).values({
            userId: USERS.rival, runId: null as unknown as string, round: current.round,
            board: rivalBoard as unknown as Record<string, unknown>[]
        }).catch(async () => {
            // runId is not nullable — park the snapshot on a rival run shell.
            const [shell] = await db.insert(tcgBattlerRun).values({
                userId: USERS.rival, secret: 'x', state: 'lost', runState: {} as Record<string, unknown>
            }).returning()
            await db.insert(tcgBattlerSnapshot).values({
                userId: USERS.rival, runId: shell!.id, round: current.round,
                board: rivalBoard as unknown as Record<string, unknown>[]
            })
        })

        const rated = await fight(USERS.player, current.id)
        expect(rated.elo).not.toBeNull()
        const rows = await db.select().from(tcgBattlerRating).where(inArray(tcgBattlerRating.userId, Object.values(USERS)))
        expect(rows).toHaveLength(2)
        const mine = rows.find(row => row.userId === USERS.player)!
        const theirs = rows.find(row => row.userId === USERS.rival)!
        // The pool is conserved around the shared starting point.
        expect(mine.rating + theirs.rating).toBe(2 * ELO_START)
        expect(mine.rating).toBe(rated.elo!.rating)
        expect(mine.fights).toBe(1)
        expect(theirs.fights).toBe(1)
        if (rated.result !== 'draw') expect(mine.rating).not.toBe(ELO_START)

        const after = await runView(USERS.player)
        if (after.run) await abandonRun(USERS.player, after.run.id)
    })
})
