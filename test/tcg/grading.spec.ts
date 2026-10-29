/**
 * Integration tests for grading (§6.4/§6.5) against the real Postgres from
 * .env. Skips when DATABASE_URL is unset. Copies are seeded directly with a
 * minted condition — no pack opening required.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { user, tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPack, tcgCopy, tcgSubmission } from '#server/database/schema'
import { submitForGrading, collectSubmission, crackSlab } from '#server/utils/tcg/grading'
import type { CrackRng } from '#server/utils/tcg/grading'
import { mintCondition } from '#shared/utils/tcg/condition'
import { gradingFeeFor } from '#shared/utils/tcg/grading-fees'
import { getGemGuidePrice } from '#server/utils/gem-exchange'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USERS = {
    main: 'test-tcg-grading-main',
    broke: 'test-tcg-grading-broke',
    other: 'test-tcg-grading-other'
}
const createdSetIds: string[] = []

interface Fixture {
    setId: string
    printingId: string
    sheetId: string
    packId: string
}

let fx: Fixture

async function buildFixture(): Promise<Fixture> {
    const [set] = await db.insert(tcgSet).values({
        name: `grading spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'GRDE',
        status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    const [card] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'grd-0', number: '001', name: 'Gradeling', raw: {}
    }).returning()
    const [printing] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: card!.id, plaatjesCardId: 'grd-0', finish: 'nonholo'
    }).returning()
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'g', role: 'base', packSlots: 1, layout: [printing!.id]
    }).returning()
    const [pack] = await db.insert(tcgPack).values({
        setId: set!.id, ownerId: USERS.main, packIndex: 0, cuts: [], state: 'opened'
    }).returning()
    return { setId: set!.id, printingId: printing!.id, sheetId: sheet!.id, packId: pack!.id }
}

let nextSlot = 0

async function seedCopy(ownerId: string): Promise<string> {
    const [copy] = await db.insert(tcgCopy).values({
        printingId: fx.printingId,
        setId: fx.setId,
        ownerId,
        packId: fx.packId,
        sheetId: fx.sheetId,
        cutIndex: 0,
        slotOffset: nextSlot++,
        condition: mintCondition()
    }).returning()
    return copy!.id
}

async function forceReturnable(submissionId: string) {
    await db.update(tcgSubmission)
        .set({ returnsAt: sql`now() - interval '1 second'` })
        .where(eq(tcgSubmission.id, submissionId))
}

async function balanceOf(userId: string): Promise<number> {
    const [row] = await db.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
    return parseFloat(row!.balance)
}

describe.skipIf(SKIP)('tcg grading integration', () => {
    beforeAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) {
            await cleanupUser(id)
            await seedUser(id, { balance: id === USERS.broke ? '0' : '100000000' })
        }
        fx = await buildFixture()
    }, 60_000)

    afterAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) await cleanupUser(id)
        await db.$client.end()
    })

    async function cleanupSets() {
        if (createdSetIds.length > 0) {
            await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
            createdSetIds.length = 0
        }
        await db.delete(tcgSet).where(eq(tcgSet.code, 'GRDE'))
    }

    it('submit debits the coin fee (guide-anchored), claims the copy, and records the prediction', async () => {
        const copyId = await seedCopy(USERS.main)
        const before = await balanceOf(USERS.main)
        const expected = gradingFeeFor('PSI', await getGemGuidePrice())
        const row = await submitForGrading(USERS.main, copyId, 'PSI', '9.5')
        expect(Number(row.fee)).toBe(expected)
        expect(row.predictedGrade).toBe('9.5')
        expect(await balanceOf(USERS.main)).toBeCloseTo(before - expected, 4)
        const [copy] = await db.select({ lifecycle: tcgCopy.lifecycle }).from(tcgCopy).where(eq(tcgCopy.id, copyId))
        expect(copy!.lifecycle).toBe('grading')
    })

    it('double-submit burst: exactly one submission wins, one fee debited', async () => {
        const copyId = await seedCopy(USERS.main)
        const before = await balanceOf(USERS.main)
        const result = await burst(10, () => submitForGrading(USERS.main, copyId, 'CCC', null))
        expect(result).toEqual({ ok: 1, rejected: 9 })
        const subs = await db.select().from(tcgSubmission).where(eq(tcgSubmission.copyId, copyId))
        expect(subs).toHaveLength(1)
        expect(await balanceOf(USERS.main)).toBeCloseTo(before - Number(subs[0]!.fee), 4)
    }, 30_000)

    it('insufficient coins rolls the lifecycle claim back', async () => {
        const copyId = await seedCopy(USERS.broke)
        await expect(submitForGrading(USERS.broke, copyId, 'PSI', null))
            .rejects.toMatchObject({ statusCode: 400 })
        const [copy] = await db.select({ lifecycle: tcgCopy.lifecycle }).from(tcgCopy).where(eq(tcgCopy.id, copyId))
        expect(copy!.lifecycle).toBe('raw')
        const subs = await db.select().from(tcgSubmission).where(eq(tcgSubmission.copyId, copyId))
        expect(subs).toHaveLength(0)
    })

    it('rejects foreign copies, unknown services and bad predictions', async () => {
        const copyId = await seedCopy(USERS.other)
        await expect(submitForGrading(USERS.main, copyId, 'PSI', null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is not available for grading' })
        await expect(submitForGrading(USERS.other, copyId, 'XYZ', null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Unknown grading service' })
        await expect(submitForGrading(USERS.other, copyId, 'PSI', '11'))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Invalid predicted grade' })
    })

    it('collect before the turnaround is refused', async () => {
        const copyId = await seedCopy(USERS.main)
        const row = await submitForGrading(USERS.main, copyId, 'PSI', null)
        await expect(collectSubmission(USERS.main, row.id))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Still at the grader' })
    })

    it('collect slabs the copy with the grade it reports', async () => {
        const copyId = await seedCopy(USERS.main)
        const row = await submitForGrading(USERS.main, copyId, 'GAG', null)
        await forceReturnable(row.id)
        const collected = await collectSubmission(USERS.main, row.id)

        const grade = collected.result.grade
        expect(grade).toBeGreaterThanOrEqual(1)
        expect(grade).toBeLessThanOrEqual(10)
        const [copy] = await db.select().from(tcgCopy).where(eq(tcgCopy.id, copyId))
        expect(copy!.lifecycle).toBe('slabbed')
        expect(copy!.grade).toBe(String(grade))
        expect(copy!.gradeService).toBe('GAG')
        expect(copy!.certNumber).toBe(collected.certNumber)
    })

    it('collect burst grades exactly once', async () => {
        const copyId = await seedCopy(USERS.main)
        const row = await submitForGrading(USERS.main, copyId, 'PSI', null)
        await forceReturnable(row.id)
        const result = await burst(10, () => collectSubmission(USERS.main, row.id))
        expect(result).toEqual({ ok: 1, rejected: 9 })
    }, 30_000)

    it('crack returns the copy to raw; forced damage lowers exactly one site', async () => {
        const copyId = await seedCopy(USERS.main)
        const row = await submitForGrading(USERS.main, copyId, 'PSI', null)
        await forceReturnable(row.id)
        await collectSubmission(USERS.main, row.id)

        const [before] = await db.select({ condition: tcgCopy.condition }).from(tcgCopy).where(eq(tcgCopy.id, copyId))
        const damageRng: CrackRng = {
            chance: () => true,
            pick: items => items[0]!,
            float: () => 0.5
        }
        const cracked = await crackSlab(USERS.main, copyId, damageRng)
        expect(cracked.damaged).toBe(true)

        const [after] = await db.select().from(tcgCopy).where(eq(tcgCopy.id, copyId))
        expect(after!.lifecycle).toBe('raw')
        expect(after!.grade).toBeNull()
        expect(after!.certNumber).toBeNull()
        const bSite = before!.condition!.sites[0]!
        const aSite = after!.condition!.sites[0]!
        expect(aSite.value).toBeCloseTo(Math.max(6.3, bSite.value - 1.0), 10)
        expect(after!.condition!.subs[aSite.category]!).toBeLessThanOrEqual(aSite.value)
    })

    it('crack burst wins once, undamaged leaves the condition alone; a raw copy cannot be cracked', async () => {
        const copyId = await seedCopy(USERS.main)
        const row = await submitForGrading(USERS.main, copyId, 'PSI', null)
        await forceReturnable(row.id)
        await collectSubmission(USERS.main, row.id)
        const [before] = await db.select({ condition: tcgCopy.condition }).from(tcgCopy).where(eq(tcgCopy.id, copyId))
        const safeRng: CrackRng = { chance: () => false, pick: items => items[0]!, float: () => 0 }
        const result = await burst(10, () => crackSlab(USERS.main, copyId, safeRng))
        expect(result).toEqual({ ok: 1, rejected: 9 })
        const [after] = await db.select({ condition: tcgCopy.condition }).from(tcgCopy).where(eq(tcgCopy.id, copyId))
        expect(after!.condition).toEqual(before!.condition)
        await expect(crackSlab(USERS.main, copyId, safeRng))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is not slabbed' })
    }, 30_000)
})
