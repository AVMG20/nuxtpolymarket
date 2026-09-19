// TypeSafe's Jev through OpenRouter's decisions endpoint. Jev answers typed
// questions (choice, score, noul) about one `state` in a single call, in a few
// hundred milliseconds. A null result means Jev is unavailable, and callers
// must cope without it.

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
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
    const config = useRuntimeConfig()
    if (!config.openRouterApiKey) return null
    try {
        const res = await fetch(JEV_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.openRouterApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': config.betterAuthUrl,
                'X-OpenRouter-Title': 'Polynux'
            },
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
