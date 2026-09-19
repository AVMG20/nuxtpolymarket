// classifier.dev: a free, keyless zero-shot classifier (TypeSafe's Jev model).
// It picks one of 2–100 labels for a text, or with `multi` every label that
// applies, and scores each. Limits are per IP, so every player shares the
// server's: 2,000 smart or 20,000 fast classifications a day. A null answer
// means the classifier is unavailable, and callers must cope without it.

const CLASSIFIER_URL = 'https://classifier.dev'
const CLASSIFIER_TIMEOUT_MS = 4_000
const CACHE_TTL_MS = 10 * 60_000
const CACHE_MAX = 500

export type ClassifierTier = 'fast' | 'smart'

export interface ClassifierRequest {
    input: string
    labels: string[]
    instructions?: string
    tier?: ClassifierTier
    /** Score every label on its own instead of splitting one choice between them. */
    multi?: boolean
}

export interface ClassifierAnswer {
    /** Every label that applies: the single pick, or with `multi` all of them. */
    labels: string[]
    scores: Record<string, number>
    tier: ClassifierTier
}

interface ClassifierResponse {
    tier?: ClassifierTier
    results?: Array<{ label?: string, labels?: string[], scores?: Record<string, number> }>
}

const cache = new Map<string, { at: number, answer: ClassifierAnswer }>()

function post(req: ClassifierRequest, tier: ClassifierTier) {
    return fetch(CLASSIFIER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: req.input, labels: req.labels, instructions: req.instructions, multi: req.multi, tier }),
        signal: AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS)
    })
}

/**
 * Classify `input` into one of `labels`. The same question inside ten minutes
 * is answered from memory. A smart request that hits the daily cap retries on
 * the fast tier. Returns null on any failure.
 */
export async function classify(req: ClassifierRequest): Promise<ClassifierAnswer | null> {
    const labels = [...new Set(req.labels)]
    if (labels.length < 2) return null
    const tier = req.tier ?? 'fast'
    const key = JSON.stringify([req.input, labels, req.instructions ?? '', tier, !!req.multi])
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.answer

    try {
        let res = await post({ ...req, labels }, tier)
        if (res.status === 429 && tier === 'smart') res = await post({ ...req, labels }, 'fast')
        if (!res.ok) return null
        const data = await res.json() as ClassifierResponse
        const result = data.results?.[0]
        if (!result?.scores) return null
        const answer: ClassifierAnswer = {
            labels: result.labels ?? (result.label ? [result.label] : []),
            scores: result.scores,
            tier: data.tier ?? tier
        }
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
        cache.set(key, { at: Date.now(), answer })
        return answer
    } catch {
        return null
    }
}
