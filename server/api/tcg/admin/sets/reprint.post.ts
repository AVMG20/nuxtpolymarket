import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { fetchPlaatjesChecklist, fetchEraBasicEnergies, createTemplateSet } from '#server/utils/tcg/import'
import type { PlaatjesCard } from '#server/utils/tcg/import'
import { fitSet, isBasicEnergy } from '#shared/utils/tcg/rate-fitter'
import type { RateTemplate, FitPrinting } from '#shared/utils/tcg/rate-fitter'

/**
 * Author a reprint (§3.6): a new print run of a committed set, as its own
 * linked set row — its own printings, packs and populations, never fungible
 * with the original. Two mandates enforced here:
 *
 * - distinguishable: every printing carries the run's `printRunLabel`,
 *   which the client renders as a stamp on the card;
 * - announced: `onSaleAt` is required and must be in the future — the run
 *   is visible from commit but sells nothing until the date passes.
 *
 * The result is a normal draft: review and commit through the same flow as
 * any set.
 */
export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const body = await readBody(event)
    const parentId = typeof body?.setId === 'string' ? body.setId : ''
    const printRunLabel = typeof body?.printRunLabel === 'string' ? body.printRunLabel.trim() : ''
    const onSaleAt = typeof body?.onSaleAt === 'string' ? new Date(body.onSaleAt) : null

    if (!parentId) throw createError({ statusCode: 400, statusMessage: 'setId is required' })
    if (!printRunLabel || printRunLabel.length > 24) {
        throw createError({ statusCode: 400, statusMessage: 'printRunLabel is required (max 24 chars)' })
    }
    if (!onSaleAt || Number.isNaN(onSaleAt.getTime())) {
        throw createError({ statusCode: 400, statusMessage: 'onSaleAt is required' })
    }
    if (onSaleAt.getTime() <= Date.now()) {
        throw createError({ statusCode: 400, statusMessage: 'A reprint must be announced before it lands — onSaleAt must be in the future' })
    }

    const [parent] = await db.select().from(tcgSet).where(eq(tcgSet.id, parentId))
    if (!parent) throw createError({ statusCode: 404, statusMessage: 'Set not found' })
    if (parent.status !== 'committed') {
        throw createError({ statusCode: 400, statusMessage: 'Only a committed set can be reprinted' })
    }
    if (parent.printRunLabel.toLowerCase() === printRunLabel.toLowerCase()) {
        throw createError({ statusCode: 400, statusMessage: 'The reprint label must differ from the run it reprints' })
    }
    if (!parent.templateCode || !parent.plaatjesSetCode || !parent.publishedRates) {
        throw createError({ statusCode: 400, statusMessage: 'Only template-created sets can be reprinted' })
    }

    const config = useRuntimeConfig(event)
    const template = parent.publishedRates as RateTemplate

    // Same pipeline as create-from-template: fresh checklist ids, energy
    // fill-in, sheet fitting — a reprint's press run is its own fit.
    const setId = crypto.randomUUID()
    const { cardRows, printingRows } = await fetchPlaatjesChecklist(parent.plaatjesSetCode, config.pokemonApiBase, setId)

    const energyWarnings: string[] = []
    const energyTier = template.tiers.find(t => t.group === 'energy')
    const hasBasicEnergy = cardRows.some(card => isBasicEnergy({ rarityCode: card.rarityCode ?? null, name: card.name, rarity: card.rarity ?? null }))
    if (energyTier != null && !hasBasicEnergy) {
        const seriesCode = String((cardRows[0]?.raw as PlaatjesCard | undefined)?.seriesCode ?? '')
        const era = await fetchEraBasicEnergies(
            seriesCode,
            config.pokemonApiBase,
            energyTier.poolSize ?? 8,
            setId,
            cardRows.length
        )
        cardRows.push(...era.cardRows)
        printingRows.push(...era.printingRows)
        energyWarnings.push(...era.warnings)
    }

    // The distinguishability mandate, applied at the source of truth: every
    // printing of this run carries the label the stamp renders from.
    for (const printing of printingRows) printing.printRunLabel = printRunLabel

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

    const fit = fitSet(template, fitPrintings)
    if (fit.sheets.length === 0 || fit.slots.length === 0) {
        throw createError({
            statusCode: 422,
            statusMessage: `The fitter produced no usable sheets for the reprint`,
            data: { warnings: fit.warnings }
        })
    }

    await createTemplateSet({
        id: setId,
        name: `${parent.name} — ${printRunLabel}`,
        code: parent.code,
        plaatjesSetCode: parent.plaatjesSetCode,
        templateCode: parent.templateCode,
        publishedRates: template,
        status: 'draft',
        reprintOfSetId: parent.id,
        printRunLabel,
        onSaleAt
    }, cardRows, printingRows, fit.sheets, fit.slots)

    return {
        setId,
        warnings: [...energyWarnings, ...fit.warnings],
        diagnostics: fit.diagnostics,
        cards: cardRows.length,
        printings: printingRows.length
    }
})
