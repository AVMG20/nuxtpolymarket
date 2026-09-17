import { requireUserId } from '#server/utils/auth'
import { convertJewels } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return convertJewels(userId, Number(body?.gems))
})
