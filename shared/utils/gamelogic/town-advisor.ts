import { getTownBuilding, getTownResource, townBuildingMaxLevel } from './town'

// The builders popover's "recommended upgrades" come from classifier.dev.
// The client sends every upgrade that is open and what the town is short of;
// the classifier scores each one and the best few are the suggestions. Names, tiers, inputs and outputs come from the catalogue rather than
// the request. The ranking is advice only: nothing here spends or grants value.

/** Candidates beyond this are dropped. */
export const TOWN_ADVISOR_MAX_CANDIDATES = 40
/** Suggestions the popover shows. */
export const TOWN_ADVISOR_PICKS = 5

export const TOWN_ADVISOR_INSTRUCTIONS = [
    'You advise a player of Polytown, a city builder, on which buildings their free builder crews should upgrade next.',
    'Choose the upgrades that grow the town fastest right now.',
    'Fixing a good the town is running out of beats everything, especially one another building consumes.',
    'When jobs exceed residents, houses come next, since unstaffed buildings produce nothing.',
    'Prefer upgrades the player can afford now, and buildings that feed higher-tier chains or earn the most.',
    'Avoid upgrading a producer whose output is already piling up unused.'
].join(' ')

export interface TownAdvisorCandidate {
    /** Building type. One candidate per type. */
    type: string
    level: number
    affordable: boolean
    /** The good this building makes that the town is running down. */
    short?: string
    residents?: boolean
}

export interface TownAdvisorRequest {
    happiness: number
    mood: string
    jobs: number
    residents: number
    coins: number
    buildersFree: number
    /** Net change per hour of every good the town makes or uses. */
    netPerHour: Record<string, number>
    stock: Record<string, number>
    candidates: TownAdvisorCandidate[]
}

function finite(v: unknown, fallback = 0): number {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
}

function numberBag(v: unknown): Record<string, number> {
    const out: Record<string, number> = {}
    if (!v || typeof v !== 'object') return out
    for (const [id, q] of Object.entries(v)) {
        if (getTownResource(id)) out[id] = finite(q)
    }
    return out
}

/** Keep only what the prompt can use: known goods, known buildings, one per type. */
export function parseTownAdvisorRequest(body: unknown): TownAdvisorRequest | null {
    if (!body || typeof body !== 'object') return null
    const b = body as Record<string, unknown>
    if (!Array.isArray(b.candidates)) return null
    const seen = new Set<string>()
    const candidates: TownAdvisorCandidate[] = []
    for (const raw of b.candidates) {
        if (!raw || typeof raw !== 'object') continue
        const c = raw as Record<string, unknown>
        const type = String(c.type ?? '')
        const def = getTownBuilding(type)
        const level = Math.floor(finite(c.level))
        if (!def || def.kind === 'road' || seen.has(type)) continue
        if (level < 1 || level >= townBuildingMaxLevel(def)) continue
        seen.add(type)
        const short = typeof c.short === 'string' && getTownResource(c.short) ? c.short : undefined
        candidates.push({ type, level, affordable: c.affordable === true, short, residents: c.residents === true })
        if (candidates.length >= TOWN_ADVISOR_MAX_CANDIDATES) break
    }
    return {
        happiness: finite(b.happiness),
        mood: String(b.mood ?? '').slice(0, 40),
        jobs: finite(b.jobs),
        residents: finite(b.residents),
        coins: finite(b.coins),
        buildersFree: finite(b.buildersFree),
        netPerHour: numberBag(b.netPerHour),
        stock: numberBag(b.stock),
        candidates
    }
}

function round(n: number) {
    return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10
}

/** The label the classifier sees for a candidate. Unique, since types are. */
export function townAdvisorLabel(c: TownAdvisorCandidate): string {
    return `${getTownBuilding(c.type)?.name ?? c.type} to level ${c.level + 1}`
}

/** The town as plain text for the classifier, one fact per line. */
export function townAdvisorInput(req: TownAdvisorRequest): string {
    const name = (id: string) => getTownResource(id)?.name ?? id
    const lines = [
        `Mood: ${req.mood || 'unknown'}, happiness ${Math.round(req.happiness)}/100.`,
        `Jobs ${req.jobs} for ${req.residents} residents${req.jobs > req.residents ? ' (short of workers)' : ''}.`,
        `Coins: ${Math.floor(req.coins)}. Free builders: ${req.buildersFree}.`
    ]
    const net = Object.entries(req.netPerHour).filter(([, n]) => n !== 0)
    const falling = net.filter(([, n]) => n < 0).sort((a, b) => a[1] - b[1])
    const rising = net.filter(([, n]) => n > 0)
    if (falling.length) lines.push(`Running down: ${falling.map(([id, n]) => `${name(id)} ${round(n)}/h (stock ${Math.floor(req.stock[id] ?? 0)})`).join(', ')}.`)
    if (rising.length) lines.push(`Stocking up: ${rising.map(([id, n]) => `${name(id)} +${round(n)}/h (stock ${Math.floor(req.stock[id] ?? 0)})`).join(', ')}.`)
    lines.push('Upgrades open:')
    for (const c of req.candidates) {
        const def = getTownBuilding(c.type)!
        const makes = Object.keys(def.outputs).map(name).join(', ')
        const uses = Object.keys(def.inputs).map(name).join(', ')
        const notes = [
            `tier ${def.tier} ${def.kind}`,
            makes && `makes ${makes}`,
            uses && `uses ${uses}`,
            def.popCap > 0 && `houses ${def.popCap} per level`,
            def.happiness > 0 && `+${def.happiness} happiness nearby`,
            c.short && `town is short of ${name(c.short)}`,
            c.residents && 'adds residents',
            c.affordable ? 'affordable now' : 'cannot afford yet'
        ].filter(Boolean)
        lines.push(`- ${townAdvisorLabel(c)}: ${notes.join('; ')}.`)
    }
    return lines.join('\n')
}

/** The best-scored candidate types, best first; ties keep the request's order. */
export function townAdvisorPicks(candidates: TownAdvisorCandidate[], scores: Record<string, number>, count = TOWN_ADVISOR_PICKS): string[] {
    return candidates
        .map((c, i) => ({ type: c.type, i, score: finite(scores[townAdvisorLabel(c)]) }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .slice(0, count)
        .map(c => c.type)
}
