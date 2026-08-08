import { requirePokemonAdmin } from '#server/utils/auth'

/**
 * Every set the pokemonplaatjes sidecar can render — not just the ones
 * imported into tcg_sets. Design harnesses pick from this so any card in the
 * catalogue can be put on screen without committing a set first.
 *
 * Degrades to an empty list rather than throwing, so a harness still loads
 * with no sidecar running (same contract as the templates index).
 */

interface PlaatjesSetsResponse {
    sets: { setCode?: string | null, cards?: number | null, seriesCode?: string | null }[]
}

interface PullRatesIndex {
    sets: { name: string, setCode: string | null }[]
}

/** Untyped fetch for sidecar URLs — route-type inference over the grown API
 *  union hits TS's instantiation depth even for external template URLs. */
const sidecarFetch = <T = unknown>(url: string, opts?: Record<string, unknown>): Promise<T> =>
    ($fetch as (url: string, opts?: Record<string, unknown>) => Promise<T>)(url, opts)

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const config = useRuntimeConfig(event)

    let sidecar: PlaatjesSetsResponse
    try {
        sidecar = await sidecarFetch<PlaatjesSetsResponse>(`${config.pokemonApiBase}/sets`, { timeout: 5000 })
    } catch {
        return { sets: [], sidecarUnavailable: true as const }
    }

    // Names are a nicety — /sets only carries codes. A pull-rates outage (or a
    // set with no scraped rates, which is most older ones) still leaves a
    // usable list, just code-labelled.
    let names = new Map<string, string>()
    try {
        const index = await sidecarFetch<PullRatesIndex>(`${config.pokemonApiBase}/pull-rates`, { timeout: 5000 })
        names = new Map(index.sets
            .filter(entry => entry.setCode)
            .map(entry => [entry.setCode!.toLowerCase(), entry.name]))
    } catch { /* codes only */ }

    // Sidecar order is preserved: it is the catalogue's own ordering, and the
    // picker searches rather than scans.
    const sets = sidecar.sets
        .filter(set => set.setCode)
        .map(set => ({
            setCode: set.setCode!,
            name: names.get(set.setCode!.toLowerCase()) ?? set.setCode!,
            seriesCode: set.seriesCode ?? null,
            cards: set.cards ?? null
        }))

    return { sets }
})
