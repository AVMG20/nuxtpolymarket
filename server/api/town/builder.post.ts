import { requireUserId } from '#server/utils/auth'
import { hireTownBuilder } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return hireTownBuilder(userId)
})
