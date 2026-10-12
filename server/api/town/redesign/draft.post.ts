import { requireUserId } from '#server/utils/auth'
import { saveRedesignDraft } from '#server/utils/town'
import { townSanitizeDraft } from '#shared/utils/gamelogic/town-storage'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const draft = townSanitizeDraft(await readBody(event))
    if (!draft) throw createError({ statusCode: 400, statusMessage: 'That draft cannot be saved' })
    return saveRedesignDraft(userId, draft)
})
