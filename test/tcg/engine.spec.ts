/**
 * Integration tests for the TCG sheet engine (commit / buy / open) against the
 * real Postgres from .env. Skips when DATABASE_URL is unset.
 *
 * Fixture: one base sheet M=12 k=4 (12 distinct printings), one base "hit"
 * sheet M=6 k=1, one god sheet M=4 k=2; N=60, godOneIn=10 → G=6. Base sheets
 * serve 54 packs, the god sheet serves 6.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPackTemplate, tcgPack, tcgCopy } from '#server/database/schema'
import { commitSet, buyPack, openPack, returnPack } from '#server/utils/tcg/engine'
import type { OpenedPackResult } from '#shared/types/tcg'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-tcg-engine-user'
const createdSetIds: string[] = []

type PackRow = typeof tcgPack.$inferSelect

interface Fixture {
    setId: string
    baseSheetId: string
    hitSheetId: string
    godSheetId: string | null
    basePrintingIds: string[]
    hitPrintingIds: string[]
    godPrintingIds: string[]
}

async function makePrintings(setId: string, prefix: string, count: number): Promise<string[]> {
    const cards = await db.insert(tcgCard).values(
        Array.from({ length: count }, (_, i) => ({
            setId,
            plaatjesBaseId: `${prefix}-${i}`,
            number: `${prefix}${i}`,
            name: `${prefix} card ${i}`,
            raw: {}
        }))
    ).returning()
    const printings = await db.insert(tcgPrinting).values(
        cards.map((card, i) => ({
            setId,
            cardId: card.id,
            plaatjesCardId: `${prefix}-${i}`,
            finish: 'nonholo'
        }))
    ).returning()
    return printings.map(p => p.id)
}

async function buildCommittedSet(N: number, godOneIn: number | null): Promise<Fixture> {
    const [set] = await db.insert(tcgSet).values({
        name: `engine spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'ENG',
        status: 'draft',
        targetPackCount: N,
        godPackOneIn: godOneIn
    }).returning()
    const setId = set!.id
    createdSetIds.push(setId)

    const basePrintingIds = await makePrintings(setId, 'base', 12)
    const hitPrintingIds = await makePrintings(setId, 'hit', 6)
    const [baseSheet] = await db.insert(tcgSheet).values({
        setId, name: 'commons', role: 'base', packSlots: 4, layout: basePrintingIds
    }).returning()
    const [hitSheet] = await db.insert(tcgSheet).values({
        setId, name: 'hits', role: 'base', packSlots: 1, layout: hitPrintingIds
    }).returning()

    let godSheetId: string | null = null
    let godPrintingIds: string[] = []
    if (godOneIn !== null) {
        godPrintingIds = await makePrintings(setId, 'god', 4)
        const [godSheet] = await db.insert(tcgSheet).values({
            setId, name: 'god', role: 'god', packSlots: 2, layout: godPrintingIds
        }).returning()
        godSheetId = godSheet!.id
        await db.insert(tcgPackTemplate).values({
            setId, kind: 'god', slots: [{ sheetId: godSheetId, count: 2 }]
        })
    }
    await db.insert(tcgPackTemplate).values({
        setId,
        kind: 'base',
        slots: [
            { sheetId: baseSheet!.id, count: 4 },
            { sheetId: hitSheet!.id, count: 1 }
        ]
    })

    await commitSet(setId)
    return {
        setId,
        baseSheetId: baseSheet!.id,
        hitSheetId: hitSheet!.id,
        godSheetId,
        basePrintingIds,
        hitPrintingIds,
        godPrintingIds
    }
}

describe.skipIf(SKIP)('tcg engine integration', () => {
    beforeAll(async () => {
        await cleanupSets()
        await cleanupUser(USER_ID)
        await seedUser(USER_ID)
    })

    afterAll(async () => {
        await cleanupSets()
        await cleanupUser(USER_ID)
        await db.$client.end()
    })

    async function cleanupSets() {
        if (createdSetIds.length > 0) {
            await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
            createdSetIds.length = 0
        }
        // Leftovers from an earlier aborted run
        await db.delete(tcgSet).where(eq(tcgSet.code, 'ENG'))
    }

    describe('full run (N=60, G=6)', () => {
        let fixture: Fixture
        let packs: PackRow[] = []
        let opened: OpenedPackResult[] = []
        let soldOutError: unknown

        beforeAll(async () => {
            fixture = await buildCommittedSet(60, 10)
            packs = []
            for (let i = 0; i < 60; i++) {
                packs.push(await buyPack(fixture.setId, USER_ID))
            }
            try {
                await buyPack(fixture.setId, USER_ID)
            } catch (err) {
                soldOutError = err
            }
            opened = []
            for (const pack of packs) {
                opened.push(await openPack(pack.id, USER_ID))
            }
        }, 120_000)

        it('(a) sells exactly N packs, then 400 Sold out', () => {
            expect(packs).toHaveLength(60)
            expect(soldOutError).toMatchObject({ statusCode: 400, statusMessage: 'Sold out' })
        })

        it('(a) per-printing copy counts equal packsServed·k·m/M ± 1', async () => {
            const copies = await db.select().from(tcgCopy).where(eq(tcgCopy.setId, fixture.setId))
            const counts = new Map<string, number>()
            for (const copy of copies) {
                counts.set(copy.printingId, (counts.get(copy.printingId) ?? 0) + 1)
            }
            // base sheet: 54 packs · 4 slots · 1/12 = 18 per printing
            for (const id of fixture.basePrintingIds) {
                expect(Math.abs((counts.get(id) ?? 0) - 18)).toBeLessThanOrEqual(1)
            }
            // hit sheet: 54 packs · 1 slot · 1/6 = 9 per printing
            for (const id of fixture.hitPrintingIds) {
                expect(Math.abs((counts.get(id) ?? 0) - 9)).toBeLessThanOrEqual(1)
            }
            // god sheet: 6 packs · 2 slots · 1/4 = 3 per printing
            for (const id of fixture.godPrintingIds) {
                expect(Math.abs((counts.get(id) ?? 0) - 3)).toBeLessThanOrEqual(1)
            }
            // total copies: 54·5 + 6·2 = 282
            expect(copies).toHaveLength(282)
        })

        it('(a) every minted copy carries a rolled condition', async () => {
            const copies = await db.select().from(tcgCopy).where(eq(tcgCopy.setId, fixture.setId))
            expect(copies.length).toBeGreaterThan(0)
            for (const copy of copies) {
                expect(copy.condition).not.toBeNull()
                expect(copy.condition!.sites).toHaveLength(16)
                expect(copy.condition!.subs).toHaveLength(8)
                expect(copy.condition!.subs.every(v => v >= 6.3 && v <= 10)).toBe(true)
            }
        })

        it('(a) final cursors equal cursorLimits', async () => {
            const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, fixture.setId))
            expect(sheets).toHaveLength(3)
            for (const sheet of sheets) {
                expect(sheet.cursor).toBe(sheet.cursorLimit)
            }
            const byId = new Map(sheets.map(s => [s.id, s]))
            expect(byId.get(fixture.baseSheetId)!.cursorLimit).toBe(54)
            expect(byId.get(fixture.hitSheetId)!.cursorLimit).toBe(54)
            expect(byId.get(fixture.godSheetId!)!.cursorLimit).toBe(6)
        })

        it('(b) no pack contains the same printing twice', () => {
            for (const result of opened) {
                const printingIds = result.cards.map(card => card.printingId)
                expect(new Set(printingIds).size).toBe(printingIds.length)
            }
        })

        it('(c) exactly G=6 god packs, cut only from god sheets', () => {
            const godPacks = packs.filter(pack => pack.isGod)
            expect(godPacks).toHaveLength(6)
            const godOpened = opened.filter(result => result.isGod)
            expect(godOpened).toHaveLength(6)
            for (const pack of godPacks) {
                for (const cut of pack.cuts) {
                    expect(cut.sheetId).toBe(fixture.godSheetId)
                }
            }
            for (const result of godOpened) {
                expect(result.cards).toHaveLength(2)
                for (const card of result.cards) {
                    expect(fixture.godPrintingIds).toContain(card.printingId)
                }
            }
            for (const result of opened.filter(r => !r.isGod)) {
                expect(result.cards).toHaveLength(5)
            }
        })

        it('(d) open reveals exactly the printings the buy-time cuts imply', async () => {
            const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, fixture.setId))
            const sheetById = new Map(sheets.map(s => [s.id, s]))
            const openedById = new Map(opened.map(result => [result.packId, result]))
            const sample = [packs[0]!, packs[7]!, packs[29]!, packs[59]!]
            for (const pack of sample) {
                const expected: string[] = []
                for (const cut of pack.cuts) {
                    const sheet = sheetById.get(cut.sheetId)!
                    const M = sheet.layout.length
                    const start = (cut.cut * sheet.packSlots) % (M * sheet.impressions!)
                    for (let i = 0; i < sheet.packSlots; i++) {
                        expected.push(sheet.layout[(start + i) % M]!)
                    }
                }
                const actual = openedById.get(pack.id)!.cards.map(card => card.printingId)
                expect(actual).toEqual(expected)
            }
        })
    })

    describe('commit validation', () => {
        interface DraftFixture {
            setId: string
            sheetId: string
            printingIds: string[]
        }

        async function buildDraftSet(): Promise<DraftFixture> {
            const [set] = await db.insert(tcgSet).values({
                name: `engine spec draft ${crypto.randomUUID().slice(0, 8)}`,
                code: 'ENG',
                status: 'draft',
                targetPackCount: 60
            }).returning()
            const setId = set!.id
            createdSetIds.push(setId)
            const printingIds = await makePrintings(setId, 'val', 12)
            const [sheet] = await db.insert(tcgSheet).values({
                setId, name: 'commons', role: 'base', packSlots: 4, layout: printingIds
            }).returning()
            return { setId, sheetId: sheet!.id, printingIds }
        }

        it('rejects a template that references the same sheet twice', async () => {
            const { setId, sheetId } = await buildDraftSet()
            await db.insert(tcgPackTemplate).values({
                setId,
                kind: 'base',
                slots: [
                    { sheetId, count: 4 },
                    { sheetId, count: 4 }
                ]
            })
            await expect(commitSet(setId)).rejects.toMatchObject({
                statusCode: 400,
                statusMessage: expect.stringContaining('more than once')
            })
        })

        it('rejects a layout referencing unknown printing ids', async () => {
            const { setId, sheetId } = await buildDraftSet()
            const staleLayout = Array.from({ length: 12 }, () => crypto.randomUUID())
            await db.update(tcgSheet).set({ layout: staleLayout }).where(eq(tcgSheet.id, sheetId))
            await db.insert(tcgPackTemplate).values({
                setId, kind: 'base', slots: [{ sheetId, count: 4 }]
            })
            await expect(commitSet(setId)).rejects.toMatchObject({
                statusCode: 400,
                statusMessage: expect.stringContaining('do not exist in this set')
            })
        })

        it('rejects packSlots greater than the layout size', async () => {
            const { setId, sheetId } = await buildDraftSet()
            await db.update(tcgSheet).set({ packSlots: 13 }).where(eq(tcgSheet.id, sheetId))
            await db.insert(tcgPackTemplate).values({
                setId, kind: 'base', slots: [{ sheetId, count: 13 }]
            })
            await expect(commitSet(setId)).rejects.toMatchObject({
                statusCode: 400,
                statusMessage: expect.stringContaining('greater than its layout size')
            })
        })
    })

    describe('concurrency', () => {
        let fixture: Fixture
        let contested: PackRow

        beforeAll(async () => {
            fixture = await buildCommittedSet(20, null)
            for (let i = 0; i < 15; i++) {
                await buyPack(fixture.setId, USER_ID)
            }
            const [pack] = await db.select().from(tcgPack)
                .where(eq(tcgPack.setId, fixture.setId)).limit(1)
            contested = pack!
        }, 60_000)

        it('(e) burst of 20 buys with 5 packs remaining: exactly 5 succeed', async () => {
            const result = await burst(20, () => buyPack(fixture.setId, USER_ID))
            expect(result).toEqual({ ok: 5, rejected: 15 })
            const [set] = await db.select().from(tcgSet).where(eq(tcgSet.id, fixture.setId))
            expect(set!.packsSold).toBe(20)
            const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, fixture.setId))
            for (const sheet of sheets) {
                expect(sheet.cursor).toBe(sheet.cursorLimit)
            }
        }, 60_000)

        it('(f) burst of 10 opens of the same pack: exactly 1 succeeds', async () => {
            const result = await burst(10, () => openPack(contested.id, USER_ID))
            expect(result).toEqual({ ok: 1, rejected: 9 })
            const copies = await db.select().from(tcgCopy).where(eq(tcgCopy.packId, contested.id))
            expect(copies).toHaveLength(5) // base pack: 4 commons + 1 hit
        }, 60_000)
    })

    describe('restock pool', () => {
        it('(a) returning an opened pack pools it without rewinding counters or cursors', async () => {
            const fixture = await buildCommittedSet(10, null)
            const packs: PackRow[] = []
            for (let i = 0; i < 3; i++) packs.push(await buyPack(fixture.setId, USER_ID))
            const target = packs[1]!
            await openPack(target.id, USER_ID)

            const cursorsBefore = new Map(
                (await db.select().from(tcgSheet).where(eq(tcgSheet.setId, fixture.setId)))
                    .map(sheet => [sheet.id, sheet.cursor])
            )

            const result = await returnPack(target.id, USER_ID)
            expect(result).toEqual({ packIndex: target.packIndex, pooled: 1 })

            const copies = await db.select().from(tcgCopy).where(eq(tcgCopy.packId, target.id))
            expect(copies).toHaveLength(0)
            const [set] = await db.select().from(tcgSet).where(eq(tcgSet.id, fixture.setId))
            expect(set!.restockPool).toHaveLength(1)
            expect(set!.restockPool[0]).toEqual({
                packIndex: target.packIndex, isGod: target.isGod, cuts: target.cuts
            })
            expect(set!.packsSold).toBe(3)
            expect(set!.basePacksSold).toBe(3)
            const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, fixture.setId))
            for (const sheet of sheets) {
                expect(sheet.cursor).toBe(cursorsBefore.get(sheet.id))
            }
        }, 60_000)

        it('(b) after sellout a pooled reservation resurfaces with identical contents, then truly sold out', async () => {
            const fixture = await buildCommittedSet(3, null)
            const packs: PackRow[] = []
            for (let i = 0; i < 3; i++) packs.push(await buyPack(fixture.setId, USER_ID))
            const target = packs[2]!
            const original = await openPack(target.id, USER_ID)
            await returnPack(target.id, USER_ID)

            // remainingFresh is 0 and the pool holds 1 — the next buy must
            // deterministically receive the pooled reservation.
            const rebought = await buyPack(fixture.setId, USER_ID)
            expect(rebought.packIndex).toBe(target.packIndex)
            expect(rebought.cuts).toEqual(target.cuts)
            expect(rebought.isGod).toBe(target.isGod)
            const reopened = await openPack(rebought.id, USER_ID)
            expect(reopened.cards.map(card => card.printingId))
                .toEqual(original.cards.map(card => card.printingId))

            const [set] = await db.select().from(tcgSet).where(eq(tcgSet.id, fixture.setId))
            expect(set!.restockPool).toHaveLength(0)
            expect(set!.packsSold).toBe(3)
            await expect(buyPack(fixture.setId, USER_ID)).rejects.toMatchObject({
                statusCode: 400, statusMessage: 'Sold out'
            })
        }, 60_000)

        it('(c) buying beyond N fails only while the pool is empty', async () => {
            const fixture = await buildCommittedSet(2, null)
            const first = await buyPack(fixture.setId, USER_ID)
            await buyPack(fixture.setId, USER_ID)
            await expect(buyPack(fixture.setId, USER_ID)).rejects.toMatchObject({
                statusCode: 400, statusMessage: 'Sold out'
            })
            await returnPack(first.id, USER_ID)
            const rebought = await buyPack(fixture.setId, USER_ID)
            expect(rebought.packIndex).toBe(first.packIndex)
            await expect(buyPack(fixture.setId, USER_ID)).rejects.toMatchObject({
                statusCode: 400, statusMessage: 'Sold out'
            })
        }, 60_000)

        it('(c) rejects returning an opened pack with a missing copy', async () => {
            const fixture = await buildCommittedSet(5, null)
            const pack = await buyPack(fixture.setId, USER_ID)
            const opened = await openPack(pack.id, USER_ID)
            await db.delete(tcgCopy).where(eq(tcgCopy.id, opened.cards[0]!.copyId))
            await expect(returnPack(pack.id, USER_ID)).rejects.toMatchObject({
                statusCode: 400, statusMessage: 'Pack contents are no longer intact'
            })
        }, 60_000)

        it('(d) burst of 10 returns of the same pack: exactly 1 succeeds', async () => {
            const fixture = await buildCommittedSet(5, null)
            const pack = await buyPack(fixture.setId, USER_ID)
            await openPack(pack.id, USER_ID)
            const result = await burst(10, () => returnPack(pack.id, USER_ID))
            expect(result).toEqual({ ok: 1, rejected: 9 })
            const [set] = await db.select().from(tcgSet).where(eq(tcgSet.id, fixture.setId))
            expect(set!.restockPool).toHaveLength(1)
            expect(set!.packsSold).toBe(1)
        }, 60_000)

        it('(e) concurrent buys with a non-empty pool never issue a reservation twice', async () => {
            const fixture = await buildCommittedSet(20, null)
            const bought: PackRow[] = []
            for (let i = 0; i < 8; i++) bought.push(await buyPack(fixture.setId, USER_ID))
            await openPack(bought[0]!.id, USER_ID)
            await returnPack(bought[0]!.id, USER_ID)
            await returnPack(bought[3]!.id, USER_ID)
            await returnPack(bought[6]!.id, USER_ID)

            // 3 pooled + 12 fresh = 15 outstanding reservations
            const result = await burst(20, () => buyPack(fixture.setId, USER_ID))
            expect(result).toEqual({ ok: 15, rejected: 5 })

            const packs = await db.select().from(tcgPack).where(eq(tcgPack.setId, fixture.setId))
            expect(packs).toHaveLength(20)
            const indexes = packs.map(pack => pack.packIndex)
            expect(new Set(indexes).size).toBe(20)
            const [set] = await db.select().from(tcgSet).where(eq(tcgSet.id, fixture.setId))
            expect(set!.packsSold).toBe(20)
            expect(set!.basePacksSold).toBe(20)
            expect(set!.restockPool).toHaveLength(0)
            const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, fixture.setId))
            for (const sheet of sheets) {
                expect(sheet.cursor).toBe(sheet.cursorLimit)
            }
        }, 60_000)

        it('(f) open racing return of a sealed pack never destroys minted copies', async () => {
            const fixture = await buildCommittedSet(20, null)
            const cardsPerPack = 5 // commons k=4 + hits k=1
            for (let round = 0; round < 8; round++) {
                const pack = await buyPack(fixture.setId, USER_ID)
                const [openResult, returnResult] = await Promise.allSettled([
                    openPack(pack.id, USER_ID),
                    returnPack(pack.id, USER_ID)
                ])
                const [row] = await db.select().from(tcgPack).where(eq(tcgPack.id, pack.id))
                const copies = await db.select().from(tcgCopy).where(eq(tcgCopy.packId, pack.id))
                const [set] = await db.select().from(tcgSet).where(eq(tcgSet.id, fixture.setId))
                const pooled = set!.restockPool.some(entry => entry.packIndex === pack.packIndex)
                if (row) {
                    // Return lost: the pack must be fully opened with every
                    // copy intact and nothing pooled.
                    expect(returnResult.status).toBe('rejected')
                    expect(openResult.status).toBe('fulfilled')
                    expect(row.state).toBe('opened')
                    expect(copies).toHaveLength(cardsPerPack)
                    expect(pooled).toBe(false)
                    await returnPack(pack.id, USER_ID) // clean up for next round
                } else {
                    // Return won (sealed, or opened-then-intact-return): the
                    // reservation is pooled and no orphaned copies survive.
                    expect(returnResult.status).toBe('fulfilled')
                    expect(copies).toHaveLength(0)
                    expect(pooled).toBe(true)
                }
            }
        }, 60_000)
    })
})
