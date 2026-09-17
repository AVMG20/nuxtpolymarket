import { requireUserId } from '#server/utils/auth'
import { voidCraftItem } from '#server/utils/void'
import { VOID_ITEM_KINDS, type VoidItemKind } from '#shared/utils/gamelogic/void-items'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const kind = String(body?.kind) as VoidItemKind
    if (!VOID_ITEM_KINDS.includes(kind)) throw createError({ statusCode: 400, statusMessage: 'Invalid blueprint' })
    return voidCraftItem(userId, kind, String(body?.type), Number(body?.tier))
})
