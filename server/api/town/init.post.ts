import { requireUserId } from '#server/utils/auth'
import { foundTown } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return foundTown(userId)
})
