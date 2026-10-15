import { requireUserId } from '#server/utils/auth'
import { assertDevHarness, devAway } from '#server/utils/hero-quest-dev'
import type { HqDevAwayResponse } from '#server/utils/hero-quest-api'

/**
 * End the session, as an hour away would: the next read settles the gap and opens on the splash.
 * **Dev only** — see `server/utils/hero-quest-dev.ts`.
 */
export default defineEventHandler(async (event): Promise<HqDevAwayResponse> => {
    assertDevHarness()
    const userId = await requireUserId(event)
    return devAway(userId)
})
