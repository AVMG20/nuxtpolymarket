import { requireUserId } from '#server/utils/auth'
import { sellToFloor } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return sellToFloor(userId, String(body?.resource ?? ''), Number(body?.quantity))
})
