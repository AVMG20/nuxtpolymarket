import { requireUserId } from '#server/utils/auth'
import { galleryFor } from '#server/utils/tcg/gallery'
import type { GalleryPayload } from '#shared/types/tcg'

/**
 * The owned-first collection gallery. `userId` may name another player —
 * collections are public to logged-in users (§10.5).
 */
export default defineEventHandler(async (event): Promise<GalleryPayload> => {
    const callerId = await requireUserId(event)
    const q = getQuery(event)
    const userId = typeof q.userId === 'string' && q.userId ? q.userId : callerId
    return await galleryFor(userId)
})
