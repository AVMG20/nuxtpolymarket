import { requirePokemonAdmin } from '#server/utils/auth'

interface PullRatesIndexEntry {
    code: string
    name: string
    slug?: string | null
    setCode: string | null
    cardsPerPack: number | null
    packsPerBox: number | null
    tiers: number
    url: string
    scrapedAt: string
}

interface PullRatesIndex {
    total: number
    sets: PullRatesIndexEntry[]
}

interface PlaatjesSetsResponse {
    sets: { setCode: string, cards: number }[]
}

const sidecarFetch = <T = unknown>(url: string, opts?: Record<string, unknown>): Promise<T> =>
    ($fetch as (url: string, opts?: Record<string, unknown>) => Promise<T>)(url, opts)

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const config = useRuntimeConfig(event)
    let index: PullRatesIndex
    let sidecarSets: { setCode: string, cards: number }[]
    try {
        [index, { sets: sidecarSets }] = await Promise.all([
            sidecarFetch<PullRatesIndex>(`${config.pokemonApiBase}/pull-rates`, { timeout: 5000 }),
            sidecarFetch<PlaatjesSetsResponse>(`${config.pokemonApiBase}/sets`, { timeout: 5000 })
        ])
    } catch {
        return { templates: [], sidecarUnavailable: true as const }
    }
    const cardsBySetCode = new Map(sidecarSets.map(set => [set.setCode.toLowerCase(), set.cards]))

    const templates = index.sets.map(entry => ({
        code: entry.code,
        name: entry.name,
        slug: entry.slug ?? null,
        cardsPerPack: entry.cardsPerPack,
        packsPerBox: entry.packsPerBox,
        tierCount: entry.tiers,
        plaatjesSetCode: entry.setCode,
        cards: entry.setCode != null
            ? cardsBySetCode.get(entry.setCode.toLowerCase()) ?? null
            : null
    }))

    return { templates }
})
