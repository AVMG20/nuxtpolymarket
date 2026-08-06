import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgSheet, tcgPackTemplate, tcgCard, tcgPrinting } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { loadFitContext } from '#server/utils/tcg/import'
import { validateWindow, derivedImpressions, populationTable, godFeasibility, type SheetSpec } from '#shared/utils/tcg/sheet-math'
import { resolveTierPrintings, applyGodConfig } from '#shared/utils/tcg/rate-fitter'
import type { FitResult } from '#shared/utils/tcg/rate-fitter'
import type { PrintRunPreview, PopulationPreviewRow, SheetImpressions, TcgFinish, RateDiagnosticRow, GodPreview } from '#shared/types/tcg'

export default defineEventHandler(async (event): Promise<PrintRunPreview> => {
    await requirePokemonAdmin(event)

    const setId = getQuery(event).setId
    if (typeof setId !== 'string' || !setId) throw createError({ statusCode: 400, statusMessage: 'Invalid setId' })

    const [set] = await db.select().from(tcgSet).where(eq(tcgSet.id, setId))
    if (!set) throw createError({ statusCode: 404, statusMessage: 'Set not found' })

    const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, setId))
    const templates = await db.select().from(tcgPackTemplate).where(eq(tcgPackTemplate.setId, setId))
    const sheetById = new Map(sheets.map(sheet => [sheet.id, sheet]))

    const errors: string[] = []
    const warnings: string[] = []

    const N = set.targetPackCount ?? 0
    if (!set.targetPackCount || set.targetPackCount < 1) {
        errors.push('Target pack count (N) is not set')
    }

    const baseTemplate = templates.find(template => template.kind === 'base')
    const godTemplate = templates.find(template => template.kind === 'god')
    if (!baseTemplate || baseTemplate.slots.length === 0) {
        errors.push('No base pack template')
    }

    // Window constraint per sheet — server-side, authoritative.
    const dirtySheetIds = new Set<string>()
    for (const sheet of sheets) {
        const violations = validateWindow(sheet.layout, sheet.packSlots)
        if (violations.length > 0) {
            dirtySheetIds.add(sheet.id)
            errors.push(`Sheet '${sheet.name}' has ${violations.length} window-constraint violation(s)`)
        }
        if (sheet.layout.length === 0) {
            warnings.push(`Sheet '${sheet.name}' has an empty layout`)
        }
    }

    // God feasibility: G = round(N / oneIn), hard checks mirror commitSet.
    // Template-created drafts derive their god sheets/template AT commit, so
    // their absence is not an error here — godPreview carries the verdict.
    const derivesGodAtCommit = set.publishedRates != null && set.status === 'draft'
    const godSheets = sheets.filter(sheet => sheet.role === 'god')
    const feasibility = godFeasibility(
        N,
        set.godPackOneIn ?? 0,
        Boolean(godTemplate && godTemplate.slots.length > 0) || derivesGodAtCommit,
        godSheets.every(sheet => !dirtySheetIds.has(sheet.id))
    )
    const G = feasibility.G
    errors.push(...feasibility.errors)
    if (G >= 1 && godSheets.length === 0 && !derivesGodAtCommit) {
        errors.push('God packs are enabled but no god sheets exist')
    }
    if (set.godPackOneIn && G === 0) {
        warnings.push(`God rate 1 in ${set.godPackOneIn} rounds to zero god packs for this run`)
    }

    // Template slot sanity + which sheets actually serve packs.
    const referencedIds = new Set<string>()
    for (const template of templates) {
        for (const slot of template.slots) {
            const sheet = sheetById.get(slot.sheetId)
            if (!sheet) {
                errors.push(`Template '${template.kind}' references a missing sheet`)
                continue
            }
            if (sheet.role !== template.kind) {
                errors.push(`Template '${template.kind}' references sheet '${sheet.name}' with role '${sheet.role}'`)
            }
            if (slot.count !== sheet.packSlots) {
                errors.push(`Template '${template.kind}' slot count ${slot.count} does not match packSlots ${sheet.packSlots} of sheet '${sheet.name}'`)
            }
            referencedIds.add(sheet.id)
        }
    }
    for (const sheet of sheets) {
        if (!referencedIds.has(sheet.id)) {
            warnings.push(`Sheet '${sheet.name}' is not referenced by any pack template`)
        }
    }

    // Per-sheet impressions for sheets that serve packs: base sheets serve
    // N − G packs, god sheets serve G.
    const sheetImpressions: SheetImpressions[] = []
    const baseSpecs: SheetSpec[] = []
    const godSpecs: SheetSpec[] = []
    for (const sheet of sheets) {
        if (!referencedIds.has(sheet.id) || sheet.layout.length === 0) continue
        const served = sheet.role === 'god' ? G : Math.max(N - G, 0)
        const spec: SheetSpec = { id: sheet.id, k: sheet.packSlots, layout: sheet.layout }
        if (sheet.role === 'god') godSpecs.push(spec)
        else baseSpecs.push(spec)
        if (served <= 0) continue
        const derived = derivedImpressions(served, 0, sheet.packSlots, sheet.layout.length)
        sheetImpressions.push({ sheetId: sheet.id, ...derived })
    }

    // Population table joined with card/printing display fields.
    const { rows, exactWithinOne } = populationTable(N, G, baseSpecs, godSpecs)
    const printingRows = await db.select({ printing: tcgPrinting, card: tcgCard })
        .from(tcgPrinting)
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .where(eq(tcgPrinting.setId, setId))
    const printingById = new Map(printingRows.map(row => [row.printing.id, row]))

    const population: PopulationPreviewRow[] = []
    for (const row of rows) {
        const resolved = printingById.get(row.printingId)
        if (!resolved) {
            errors.push(`Layout references unknown printing '${row.printingId}'`)
            continue
        }
        population.push({
            printingId: row.printingId,
            population: row.population,
            cardName: resolved.card.name,
            cardNumber: resolved.card.number,
            rarity: resolved.card.rarity ?? '',
            finish: resolved.printing.finish as TcgFinish,
            pattern: resolved.printing.pattern
        })
    }
    population.sort((a, b) => a.population - b.population || (a.cardNumber < b.cardNumber ? -1 : 1))

    // Template-created sets: published vs authored rates per scraped tier,
    // plus the applyGodConfig verdict the commit would enforce.
    let rateDiagnostics: RateDiagnosticRow[] | undefined
    let godPreview: GodPreview | null | undefined
    if (set.publishedRates != null) {
        const fitContext = await loadFitContext(db, setId)
        const { matched, warnings: resolveWarnings } = resolveTierPrintings(set.publishedRates, fitContext.printings)
        warnings.push(...resolveWarnings)

        // Published rates describe the whole run, so once god packs exist the
        // authored rate must blend both channels: base sheets serve N−G of N
        // packs, god sheets the remaining G. Chase-only would read ~−60% on a
        // netted tier even though total supply matches published.
        const baseWeight = N > 0 ? Math.max(N - G, 0) / N : 1
        const godWeight = N > 0 ? G / N : 0
        rateDiagnostics = matched.map(({ tier, printings: pool }) => {
            const poolIds = new Set(pool.map(printing => printing.id))
            let authored = 0
            for (const sheet of sheets) {
                const M = sheet.layout.length
                if (M === 0) continue
                let mults = 0
                for (const id of sheet.layout) {
                    if (poolIds.has(id)) mults += 1
                }
                const perPack = sheet.packSlots * mults / M
                authored += perPack * (sheet.role === 'god' ? godWeight : baseWeight)
            }
            return {
                label: tier.label,
                publishedPerPack: tier.perPack,
                authoredPerPack: authored,
                deltaPct: tier.perPack > 0 ? (authored / tier.perPack - 1) * 100 : 0
            }
        })

        // Published tiers that matched zero printings never reach `matched`,
        // so surface them inline as authored-zero rows.
        const matchedLabels = new Set(matched.map(m => m.tier.label))
        for (const tier of set.publishedRates.tiers) {
            if (matchedLabels.has(tier.label)) continue
            rateDiagnostics.push({
                label: tier.label,
                publishedPerPack: tier.perPack,
                authoredPerPack: 0,
                deltaPct: -100
            })
        }

        godPreview = null
        if ((set.godPackOneIn ?? 0) > 0 && set.status === 'draft') {
            const fit: FitResult = { sheets: fitContext.sheets, slots: fitContext.slots, diagnostics: [], warnings: [] }
            const god = applyGodConfig(fit, set.publishedRates, fitContext.printings, N, set.godPackOneIn!)
            warnings.push(...god.warnings)
            godPreview = { feasible: god.feasible, G: god.G }
            if (god.reason != null) godPreview.reason = god.reason
            // The commit derives god sheets and nets their supply out of the
            // chase sheet; this preview shows the pre-netting sheets while
            // already subtracting G from the base channel.
            if (god.G > 0) {
                warnings.push('God netting is applied at commit — populations shown are pre-netting')
            }
        }
    }

    return {
        godPackCount: G,
        sheets: sheetImpressions,
        population,
        exactWithinOne,
        errors,
        warnings,
        rateDiagnostics,
        godPreview
    }
})
