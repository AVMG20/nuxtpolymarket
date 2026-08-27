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
 * SIR supply over the run is 4, so godOneIn=10 (needs 10) is infeasible.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPackTemplate } from '#server/database/schema'
import { commitSet, buyPack, openPack } from '#server/utils/tcg/engine'
import { persistFit, createTemplateSet, fetchEraBasicEnergies } from '#server/utils/tcg/import'
import type { PlaatjesCard, TcgCardInsert, TcgPrintingInsert } from '#server/utils/tcg/import'
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

        it('derives G=2 and creates the god sheets + god template at commit', async () => {
            expect(godPackCount).toBe(2)
            const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, fixture.setId))
            const godSheets = sheets.filter(sheet => sheet.role === 'god')
            expect(godSheets.map(sheet => sheet.name).sort()).toEqual(
                ['god-energy', 'god-illustration-rare', 'god-special-illustration-rare']
            )
            const templates = await db.select().from(tcgPackTemplate)
                .where(eq(tcgPackTemplate.setId, fixture.setId))
            expect(templates.map(t => t.kind).sort()).toEqual(['base', 'god'])
            const godTemplate = templates.find(t => t.kind === 'god')!
            expect(godTemplate.slots.reduce((a, slot) => a + slot.count, 0)).toBe(5)
        })

        it('nets god supply out of the chase sheet, keeping total SIR supply invariant', async () => {
            const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, fixture.setId))
            const chase = sheets.find(sheet => sheet.name === 'chase')!
            const sirIds = new Set(fixture.idsByPrefix.get('sir'))
            const sirOnChase = chase.layout.filter(id => sirIds.has(id)).length
            // no-god supply: 100 packs · 1 slot · 4/100 = 4; god packs deliver
            // G·1 = 2, so the netted chase supplies (N−G)·k·t/M = 98·4/200 ≈ 2.
            const chaseSupply = 98 * chase.packSlots * sirOnChase / chase.layout.length
            expect(chaseSupply + godPackCount * 1).toBeCloseTo(4, 1)
        })

        it('sells exactly G god packs over the run and opens them as 3×IR + 1×SIR + energy', () => {
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

    describe('duplicate guard', () => {
        function draftValues(templateCode: string) {
            return {
                id: crypto.randomUUID(),
                name: `dup guard ${crypto.randomUUID().slice(0, 8)}`,
                code: SET_CODE,
                templateCode,
                publishedRates: template,
                status: 'draft' as const
            }
        }

        it('a burst of 5 concurrent creates for one template yields exactly one set', async () => {
            const templateCode = `tst-dup-${crypto.randomUUID().slice(0, 8)}`
            const results = await Promise.allSettled(
                Array.from({ length: 5 }, () => createTemplateSet(draftValues(templateCode), [], [], [], []))
            )
            const rows = await db.select().from(tcgSet).where(eq(tcgSet.templateCode, templateCode))
            createdSetIds.push(...rows.map(row => row.id))
            expect(rows).toHaveLength(1)
            expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
            for (const result of results) {
                if (result.status === 'rejected') {
                    expect(result.reason).toMatchObject({
                        statusCode: 409, statusMessage: 'Set already exists for this template'
                    })
                }
            }
        }, 30_000)

        it('a sequential second create 409s while the first set is still draft', async () => {
            const templateCode = `tst-dup-${crypto.randomUUID().slice(0, 8)}`
            await createTemplateSet(draftValues(templateCode), [], [], [], [])
            const rows = await db.select().from(tcgSet).where(eq(tcgSet.templateCode, templateCode))
            createdSetIds.push(...rows.map(row => row.id))
            await expect(createTemplateSet(draftValues(templateCode), [], [], [], [])).rejects.toMatchObject({
                statusCode: 409, statusMessage: 'Set already exists for this template'
            })
        })
    })

    describe('infeasible god rate', () => {
        it('commitSet 400s when the run cannot supply the god recipe (1 in 10 needs 10 SIR, run supplies 4)', async () => {
            const fixture = await buildTemplateDraft(100, 10)
            await expect(commitSet(fixture.setId)).rejects.toMatchObject({
                statusCode: 400,
                statusMessage: expect.stringContaining('netted chase rate goes negative')
            })
            // Nothing derived sticks: the transaction rolled back whole.
            const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, fixture.setId))
            expect(sheets.filter(sheet => sheet.role === 'god')).toHaveLength(0)
            const [set] = await db.select().from(tcgSet).where(eq(tcgSet.id, fixture.setId))
            expect(set!.status).toBe('draft')
        }, 60_000)
    })

    // --- Era basic-energy fallback: expansions carry no plain basics, so a
    // template with an energy tier pulls them from the era energy set
    // ('<seriesCode>E' when /sets has it, 'EC' otherwise). Sidecar responses
    // are stubbed the way legacy-import.spec.ts does. ---
    describe('era basic-energy fallback', () => {
        const realFetch = (globalThis as { $fetch?: unknown }).$fetch

        const TYPES = ['G', 'R', 'W', 'L', 'P', 'F', 'D', 'M']

        function energyRecord(num: number, name: string, fields: Partial<PlaatjesCard> = {}): PlaatjesCard {
            return {
                cardId: `sve_${num}`,
                name,
                number: String(num),
                setTotal: '',
                assetNumber: String(num).padStart(3, '0'),
                rarity: 'TCGLFBE',
                rarityCode: 'TCGLFBE',
                category: 'Energy',
                bundle: `sve_en_${String(num).padStart(3, '0')}`,
                foilEffect: 'NonFoil',
                foilMask: null,
                ...fields
            }
        }

        // 8 plain basics plus 8 foil-effect variants that must be deduped away
        const energyItems: PlaatjesCard[] = [
            ...TYPES.map((t, i) => energyRecord(i + 1, `Basic {${t}} Energy`)),
            ...TYPES.map((t, i) => energyRecord(i + 9, `Basic {${t}} Energy`, { rarity: 'TCGLBE', rarityCode: 'TCGLBE', foilEffect: 'Cosmos' }))
        ]

        function stubSidecar() {
            Object.assign(globalThis, {
                $fetch: async (url: string) => {
                    if (String(url).endsWith('/sets')) {
                        return { sets: [{ setCode: 'SVE', seriesCode: 'SV' }, { setCode: 'MEE', seriesCode: 'ME' }, { setCode: 'EC', seriesCode: 'EC' }] }
                    }
                    return { total: energyItems.length, page: 1, limit: 500, returned: energyItems.length, items: energyItems }
                }
            })
        }

        function restoreFetch() {
            Object.assign(globalThis, { $fetch: realFetch })
        }

        it("resolves '<seriesCode>E' when /sets has it and falls back to 'EC'", async () => {
            stubSidecar()
            try {
                const sv = await fetchEraBasicEnergies('SV', 'http://stub.invalid', 8, crypto.randomUUID(), 0)
                expect(sv.energySetCode).toBe('SVE')
                const sm = await fetchEraBasicEnergies('SM', 'http://stub.invalid', 8, crypto.randomUUID(), 0)
                expect(sm.energySetCode).toBe('EC')
            } finally {
                restoreFetch()
            }
        })

        it('dedupes to one plain record per name and warns when the yield differs from the wanted pool', async () => {
            stubSidecar()
            try {
                const era = await fetchEraBasicEnergies('SV', 'http://stub.invalid', 6, crypto.randomUUID(), 0)
                expect(era.cardRows).toHaveLength(8)
                expect(new Set(era.cardRows.map(card => card.name)).size).toBe(8)
                expect(era.cardRows.every(card => card.rarityCode === 'TCGLFBE')).toBe(true)
                expect(era.warnings).toHaveLength(1)
                expect(era.warnings[0]).toContain('8')
                expect(era.warnings[0]).toContain('6')
            } finally {
                restoreFetch()
            }
        })

        it('appends era basics to an energy-less checklist and fits the energy sheet from them only', async () => {
            const setId = crypto.randomUUID()
            const nrgTemplate: RateTemplate = {
                code: `tst-nrg-${crypto.randomUUID().slice(0, 8)}`,
                slug: 'era-energy-fallback',
                name: 'Era Energy Fallback',
                url: 'https://example.test/era-energy-fallback',
                scrapedAt: '2026-08-01T00:00:00Z',
                cardsPerPack: 5,
                packsPerBox: null,
                tiers: [
                    tier('Common', 'guaranteed', 3, 12),
                    tier('Rare', 'hit', 1, 10),
                    tier('Energy', 'energy', 1, 8)
                ]
            }

            // Checklist WITHOUT any energies — the set's own cards only.
            const cardRows: TcgCardInsert[] = []
            const printingRows: TcgPrintingInsert[] = []
            function checklistPool(prefix: string, count: number, rarity: string, rarityCode: string, finish: string) {
                for (let i = 0; i < count; i++) {
                    const cardId = crypto.randomUUID()
                    cardRows.push({
                        id: cardId,
                        setId,
                        plaatjesBaseId: `${prefix}-${i}`,
                        number: `${prefix}${i}`,
                        name: `${prefix} card ${i}`,
                        rarity,
                        rarityCode,
                        category: 'Pokemon',
                        sortOrder: cardRows.length,
                        raw: {}
                    })
                    printingRows.push({
                        id: crypto.randomUUID(),
                        setId,
                        cardId,
                        plaatjesCardId: `${prefix}-${i}`,
                        finish
                    })
                }
            }
            checklistPool('c', 12, 'Common', 'C', 'nonholo')
            checklistPool('r', 10, 'Rare', 'R', 'holo')
            const ownCardCount = cardRows.length

            stubSidecar()
            try {
                const era = await fetchEraBasicEnergies('SV', 'http://stub.invalid', 8, setId, cardRows.length)
                cardRows.push(...era.cardRows)
                printingRows.push(...era.printingRows)
            } finally {
                restoreFetch()
            }

            const cardById = new Map(cardRows.map(card => [card.id!, card]))
            const fitPrintings: FitPrinting[] = printingRows.map((printing) => {
                const card = cardById.get(printing.cardId)!
                return {
                    id: printing.id!,
                    rarity: card.rarity ?? null,
                    rarityCode: card.rarityCode ?? null,
                    finish: printing.finish,
                    pattern: printing.pattern ?? null,
                    category: card.category ?? null,
                    name: card.name ?? null
                }
            })
            const fit = fitSet(nrgTemplate, fitPrintings)
            expect(fit.sheets.map(sheet => sheet.name)).toEqual(['energy', 'common', 'chase'])

            await createTemplateSet({
                id: setId,
                name: `era energy fallback ${crypto.randomUUID().slice(0, 8)}`,
                code: SET_CODE,
                templateCode: nrgTemplate.code,
                publishedRates: nrgTemplate,
                status: 'draft'
            }, cardRows, printingRows, fit.sheets, fit.slots)
            createdSetIds.push(setId)

            // The persisted set gained the appended basic-energy cards …
            const cards = await db.select().from(tcgCard).where(eq(tcgCard.setId, setId))
            expect(cards).toHaveLength(ownCardCount + 8)
            const energyCards = cards.filter(card => card.rarityCode === 'TCGLFBE')
            expect(energyCards).toHaveLength(8)
            expect(new Set(energyCards.map(card => card.name)).size).toBe(8)
            // … appended after the set's own cards …
            const maxOwn = Math.max(...cards.filter(card => card.rarityCode !== 'TCGLFBE').map(card => card.sortOrder))
            expect(Math.min(...energyCards.map(card => card.sortOrder))).toBeGreaterThan(maxOwn)
            // … and the energy sheet references only their printings.
            const prints = await db.select().from(tcgPrinting).where(eq(tcgPrinting.setId, setId))
            const energyCardIds = new Set(energyCards.map(card => card.id))
            const energyPrintingIds = new Set(prints.filter(p => energyCardIds.has(p.cardId)).map(p => p.id))
            expect(energyPrintingIds.size).toBe(8)
            const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, setId))
            const energySheet = sheets.find(sheet => sheet.name === 'energy')!
            expect(energySheet.layout.length).toBeGreaterThan(0)
            expect(energySheet.layout.every(id => energyPrintingIds.has(id))).toBe(true)
            expect(new Set(energySheet.layout).size).toBe(8)
        }, 60_000)
    })
})
