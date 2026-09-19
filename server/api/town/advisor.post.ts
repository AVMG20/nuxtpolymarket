import { requireUserId } from '#server/utils/auth'
import { classify } from '#server/utils/classifier'
import {
    parseTownAdvisorRequest,
    TOWN_ADVISOR_INSTRUCTIONS,
    townAdvisorInput,
    townAdvisorLabel,
    townAdvisorPicks
} from '#shared/utils/gamelogic/town-advisor'

/**
 * The builders popover's suggested upgrades, picked by classifier.dev from
 * the candidates the client sends. A lone candidate needs no model. `picks`
 * is null when the classifier is unavailable.
 */
export default defineEventHandler(async (event) => {
    await requireUserId(event)
    const req = parseTownAdvisorRequest(await readBody(event))
    if (!req) throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
    if (req.candidates.length < 2) return { picks: req.candidates.map(c => c.type) }

    const answer = await classify({
        input: townAdvisorInput(req),
        labels: req.candidates.map(townAdvisorLabel),
        instructions: TOWN_ADVISOR_INSTRUCTIONS,
        tier: 'smart',
        multi: true
    })
    return { picks: answer ? townAdvisorPicks(req.candidates, answer.scores) : null }
})
