import { requirePokemonAdmin } from '#server/utils/auth'
import { fetchPlaatjesChecklist, fetchEraBasicEnergies, createTemplateSet } from '#server/utils/tcg/import'
import type { PlaatjesCard } from '#server/utils/tcg/import'
import { fitSet, isBasicEnergy } from '#shared/utils/tcg/rate-fitter'
import type { RateTemplate, FitPrinting } from '#shared/utils/tcg/rate-fitter'

interface PullRatesIndex {
    total: number
    sets: { code: string, setCode: string | null }[]
}

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const body = await readBody(event)
    const pricedexCode = typeof body?.pricedexCode === 'string' ? body.pricedexCode.trim().toLowerCase() : ''
    if (!/^[a-z0-9]+$/.test(pricedexCode)) {
        throw createError({ statusCode: 400, statusMessage: 'pricedexCode is required' })
    }

    const config = useRuntimeConfig(event)
    let index: PullRatesIndex
    try {
        index = await $fetch<PullRatesIndex>(`${config.pokemonApiBase}/pull-rates`, { timeout: 5000 })
    } catch {
        throw createError({
            statusCode: 502,
            statusMessage: `Could not reach the pokemonplaatjes sidecar at ${config.pokemonApiBase} — is it running?`
        })
    }
    const entry = index.sets.find(set => set.code === pricedexCode)
    if (!entry) throw createError({ statusCode: 404, statusMessage: `Unknown rate template '${pricedexCode}'` })
    const plaatjesSetCode = entry.setCode
    if (!plaatjesSetCode) {
        throw createError({ statusCode: 400, statusMessage: `No sidecar checklist coverage for template '${pricedexCode}'` })
    }

    let template: RateTemplate
    try {
        template = await $fetch<RateTemplate>(`${config.pokemonApiBase}/sets/${plaatjesSetCode}/pull-rates`, { timeout: 5000 })
    } catch (error) {
        const status = (error as { statusCode?: number, status?: number }).statusCode
            ?? (error as { status?: number }).status
        if (status === 404) {
            throw createError({ statusCode: 404, statusMessage: `Unknown rate template '${pricedexCode}'` })
        }
        throw createError({
            statusCode: 502,
            statusMessage: `Could not reach the pokemonplaatjes sidecar at ${config.pokemonApiBase} — is it running?`
        })
    }

    // Checklist fetch stays outside the transaction — row ids are assigned in
    // the mapping, so the fitter can work on the exact ids that get inserted.
    const setId = crypto.randomUUID()
    const { cardRows, printingRows } = await fetchPlaatjesChecklist(plaatjesSetCode, config.pokemonApiBase, setId)

    // Expansions do not contain their own plain basics — when the template
    // expects an energy slot and the checklist carries no basic energies,
    // append the era's energy set (SVE/MEE, EC fallback) so the energy sheet
    // has printings to fit from.
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
            statusMessage: `The fitter produced no usable sheets for '${pricedexCode}'`,
            data: { warnings: fit.warnings }
        })
    }

    // createTemplateSet serializes concurrent submits per template code via an
    // advisory lock and 409s when a draft/committed set for it already exists.
    await createTemplateSet({
        id: setId,
        name: template.name,
        code: pricedexCode.toUpperCase(),
        plaatjesSetCode,
        templateCode: template.code,
        publishedRates: template,
        status: 'draft'
    }, cardRows, printingRows, fit.sheets, fit.slots)

    return {
        setId,
        warnings: [...energyWarnings, ...fit.warnings],
        diagnostics: fit.diagnostics,
        cards: cardRows.length,
        printings: printingRows.length
    }
})
