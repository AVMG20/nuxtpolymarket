/**
 * Integration tests for template-created sets (slice 2) against the real
 * Postgres from .env — no sidecar dependency: a synthetic RateTemplate plus
 * directly-inserted cards/printings stand in for the scraped + imported data.
 * Persistence goes through persistFit (the same helper the endpoint uses) so
 * the real code path is exercised, then commitSet derives the god config.
 *
 * Fixture (cardsPerPack 5, hit rates sum to 1.0):
 *   Common guaranteed 3/pack pool 12 → sheet 'common' k=3 M=12
 *   Rare 0.86 / IR 0.1 / SIR 0.04 pools 10/6/3 → sheet 'chase' k=1 M=100
 *   Energy 1/pack pool 4 → sheet 'energy' k=1 M=4
 * N=100, godOneIn=50 → G=2; god recipe 3×IR + 1×SIR + energy slot.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet } from '#server/database/schema'
import { commitSet, buyPack, openPack } from '#server/utils/tcg/engine'
import { persistFit } from '#server/utils/tcg/import'
import { fitSet } from '#shared/utils/tcg/rate-fitter'
import type { FitPrinting, RateTemplate, RateTemplateTier } from '#shared/utils/tcg/rate-fitter'
import type { OpenedPackResult } from '#shared/types/tcg'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-tcg-template-user'
const SET_CODE = 'TPL'
const createdSetIds: string[] = []

function tier(
    label: string,
    group: RateTemplateTier['group'],
    perPack: number,
    poolSize: number
): RateTemplateTier {
    return { label, group, pattern: null, baseRarity: null, perPack, specificOneIn: null, poolSize }
}

const template: RateTemplate = {
    code: 'tst1',
    slug: 'template-spec',
    name: 'Template Spec',
    url: 'https://example.test/template-spec',
    scrapedAt: '2026-08-01T00:00:00Z',
    cardsPerPack: 5,
    packsPerBox: null,
    tiers: [
        tier('Common', 'guaranteed', 3, 12),
        tier('Rare', 'hit', 0.86, 10),
        tier('Illustration Rare', 'hit', 0.1, 6),
        tier('Special Illustration Rare', 'hit', 0.04, 3),
        tier('Energy', 'energy', 1, 4)
    ]
}

interface PoolSpec {
    prefix: string
    count: number
    rarity: string
    rarityCode: string
    finish: string
    category: string
    name?: string
}

const POOLS: PoolSpec[] = [
    { prefix: 'c', count: 12, rarity: 'Common', rarityCode: 'C', finish: 'nonholo', category: 'Pokemon' },
    { prefix: 'r', count: 10, rarity: 'Rare', rarityCode: 'R', finish: 'holo', category: 'Pokemon' },
    { prefix: 'ir', count: 6, rarity: 'Illustration Rare', rarityCode: 'IR', finish: 'holo', category: 'Pokemon' },
    { prefix: 'sir', count: 3, rarity: 'Special Illustration Rare', rarityCode: 'SIR', finish: 'holo', category: 'Pokemon' },
    { prefix: 'nrg', count: 4, rarity: 'Common', rarityCode: 'C', finish: 'nonholo', category: 'Energy', name: 'Basic {G} Energy' }
]

interface Fixture {
    setId: string
    printings: FitPrinting[]
    idsByPrefix: Map<string, string[]>
}

/** Insert a draft set + checklist and persist the fitter output — the same shape create-from-template writes. */
async function buildTemplateDraft(N: number, godOneIn: number): Promise<Fixture> {
    const [set] = await db.insert(tcgSet).values({
        name: `template spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: SET_CODE,
        status: 'draft',
        templateCode: template.code,
        publishedRates: template,
        targetPackCount: N,
        godPackOneIn: godOneIn
    }).returning()
    const setId = set!.id
    createdSetIds.push(setId)

    const printings: FitPrinting[] = []
    const idsByPrefix = new Map<string, string[]>()
    for (const pool of POOLS) {
        const cards = await db.insert(tcgCard).values(
            Array.from({ length: pool.count }, (_, i) => ({
                setId,
                plaatjesBaseId: `${pool.prefix}-${i}`,
                number: `${pool.prefix}${i}`,
                name: pool.name ?? `${pool.prefix} card ${i}`,
                rarity: pool.rarity,
                rarityCode: pool.rarityCode,
                category: pool.category,
                raw: {}
            }))
        ).returning()
        const rows = await db.insert(tcgPrinting).values(
            cards.map((card, i) => ({
                setId,
                cardId: card.id,
                plaatjesCardId: `${pool.prefix}-${i}`,
                finish: pool.finish
            }))
        ).returning()
        idsByPrefix.set(pool.prefix, rows.map(row => row.id))
        printings.push(...rows.map(row => ({
            id: row.id,
            rarity: pool.rarity,
            rarityCode: pool.rarityCode,
            finish: pool.finish,
            pattern: null,
            category: pool.category,
            name: pool.name ?? null
        })))
    }

    const fit = fitSet(template, printings)
    expect(fit.sheets.map(sheet => sheet.name)).toEqual(['energy', 'common', 'chase'])
    expect(fit.slots.reduce((a, slot) => a + slot.count, 0)).toBe(5)
    await db.transaction(async (tx) => {
        await persistFit(tx, setId, fit.sheets, fit.slots, 'base')
    })
    return { setId, printings, idsByPrefix }
}

describe.skipIf(SKIP)('template-created sets: commit-time god derivation', () => {
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
        await db.delete(tcgSet).where(eq(tcgSet.code, SET_CODE))
    }

    describe('feasible god rate (N=100, 1 in 50 → G=2)', () => {
        let fixture: Fixture
        let opened: OpenedPackResult[] = []
        let godPackCount = 0

        beforeAll(async () => {
            fixture = await buildTemplateDraft(100, 50)
            const committed = await commitSet(fixture.setId)
            godPackCount = committed.godPackCount

            opened = []
            for (let i = 0; i < 100; i++) {
                const pack = await buyPack(fixture.setId, USER_ID)
                opened.push(await openPack(pack.id, USER_ID))
            }
        }, 180_000)

        it('derives G=2 at commit, sells exactly G god packs and opens them as 3×IR + 1×SIR + energy', () => {
            expect(godPackCount).toBe(2)
            const godOpened = opened.filter(result => result.isGod)
            expect(godOpened).toHaveLength(2)
            const irIds = new Set(fixture.idsByPrefix.get('ir'))
            const sirIds = new Set(fixture.idsByPrefix.get('sir'))
            const nrgIds = new Set(fixture.idsByPrefix.get('nrg'))
            for (const result of godOpened) {
                expect(result.cards).toHaveLength(5)
                const ids = result.cards.map(card => card.printingId)
                expect(ids.filter(id => irIds.has(id))).toHaveLength(3)
                expect(ids.filter(id => sirIds.has(id))).toHaveLength(1)
                expect(ids.filter(id => nrgIds.has(id))).toHaveLength(1)
            }
        })

        it('every pack opens cleanly with 5 cards and exhausts the run', async () => {
            expect(opened).toHaveLength(100)
            for (const result of opened) {
                expect(result.cards).toHaveLength(5)
            }
            await expect(buyPack(fixture.setId, USER_ID)).rejects.toMatchObject({
                statusCode: 400, statusMessage: 'Sold out'
            })
            const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, fixture.setId))
            for (const sheet of sheets) {
                expect(sheet.cursor, sheet.name).toBe(sheet.cursorLimit)
            }
        })
    })
})
