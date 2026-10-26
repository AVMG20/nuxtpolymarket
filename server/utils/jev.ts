import { OPENROUTER_API_BASE, openRouterHeaders } from '#server/utils/openrouter'

// TypeSafe's Jev through OpenRouter's decisions endpoint. Jev answers typed
// questions (choice, score, noul) about one `state` in a single call, in a few
// hundred milliseconds. A null result means Jev is unavailable, and callers
// must cope without it.

const JEV_URL = `${OPENROUTER_API_BASE}/alpha/decisions`
const JEV_MODEL = '~typesafe/jev-latest'
const JEV_TIMEOUT_MS = 3_000

export interface JevAnswer {
    type: 'choice' | 'score' | 'noul'
    choice?: string
    score?: number
    noul?: number
    probabilities?: Record<string, number>
    confidence?: number
}

export async function askJev(state: unknown, questions: Record<string, unknown>): Promise<Record<string, JevAnswer> | null> {
    const headers = openRouterHeaders()
    if (!headers) return null
    try {
        const res = await fetch(JEV_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: JEV_MODEL, state, questions }),
            signal: AbortSignal.timeout(JEV_TIMEOUT_MS)
        })
        if (!res.ok) return null
        const data = await res.json() as { answers?: Record<string, JevAnswer> }
        return data.answers ?? null
    } catch {
        return null
    }
}
