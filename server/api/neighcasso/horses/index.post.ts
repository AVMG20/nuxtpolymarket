import { requireUserId } from '#server/utils/auth'
import { createHorse, parseHorseBody } from '#server/utils/neighcasso'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const { name, drawing } = parseHorseBody(await readBody(event))
    return createHorse(userId, name, drawing)
})
