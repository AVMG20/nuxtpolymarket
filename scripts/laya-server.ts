/**
 * Serves Laya (`@receptron/laya`, ONNX Runtime) on this machine with the same
 * wire format as `laya_server.py`, so the site's auto-play (Shapezz, Pirate
 * Raid, Hackerz) can ask it without Python. `bun scripts/laya-server.ts`
 *
 *     POST /v1/systemone  { "state"?: ..., "questions": { name: { type, instructions, criteria?, state? } } }
 *     GET  /health
 *
 * A question may carry its own `state`, which replaces the shared one for that
 * question, as in `laya_server.py`: short per-question states answer faster
 * and better than one long shared state. Questions that share a state are
 * asked in one forward pass.
 *
 * Binds 127.0.0.1:8000 by default (`LAYA_HOST`, `LAYA_PORT`). It has no
 * authentication, so it never binds anywhere else unless told to.
 */
import { Laya } from '@receptron/laya'

const host = process.env.LAYA_HOST ?? '127.0.0.1'
const port = Number(process.env.LAYA_PORT ?? 8000)

console.log('loading Laya…')
const laya = await Laya.load()
console.log('Laya loaded')

type Question = { type: string, instructions: string, criteria?: unknown, state?: unknown }

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // Chrome asks before a public page may call a local address.
    'Access-Control-Allow-Private-Network': 'true'
}

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}

/** Questions grouped by the state they are asked over, one model run per group. */
async function answer(shared: unknown, questions: Record<string, Question>) {
    const answers: Record<string, unknown> = {}
    const groups = new Map<string, { state: unknown, questions: Record<string, Question> }>()
    for (const [name, { state, ...question }] of Object.entries(questions)) {
        // A choice with a single option has its answer already, and the model
        // cannot take one: its top-2 step fails on a one-wide axis.
        const options = question.type === 'choice' && question.criteria && typeof question.criteria === 'object'
            ? Object.keys(question.criteria as object)
            : null
        if (options && options.length < 2) {
            answers[name] = options.length
                ? { type: 'choice', choice: options[0], probabilities: { [options[0]!]: 1 }, confidence: 1 }
                : { type: 'choice', choice: null, probabilities: {}, confidence: 0 }
            continue
        }
        const own = state ?? shared ?? ''
        const key = typeof own === 'string' ? own : JSON.stringify(own)
        const group = groups.get(key) ?? { state: own, questions: {} }
        group.questions[name] = question as Question
        groups.set(key, group)
    }
    for (const group of groups.values()) {
        if (!Object.keys(group.questions).length) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await laya.systemOne(group.state as any, group.questions as any)
        Object.assign(answers, result.answers)
    }
    return answers
}

// One question at a time through the model: it is not safe to run in parallel.
let queue: Promise<unknown> = Promise.resolve()

Bun.serve({
    hostname: host,
    port,
    async fetch(request) {
        const url = new URL(request.url)
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
        if (url.pathname === '/health') return json({ status: 'ok' })
        if (url.pathname !== '/v1/systemone' || request.method !== 'POST') return json({ error: 'not found' }, 404)
        let body: { state?: unknown, questions?: Record<string, Question> }
        try {
            body = await request.json()
        } catch {
            return json({ error: 'body is not JSON' }, 400)
        }
        if (!body.questions || typeof body.questions !== 'object') return json({ error: 'questions missing' }, 400)
        const run = queue.then(() => answer(body.state, body.questions!))
        queue = run.catch(() => undefined)
        try {
            return json({ id: crypto.randomUUID(), answers: await run })
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 500)
        }
    }
})
console.log(`Laya listening on http://${host}:${port}`)
