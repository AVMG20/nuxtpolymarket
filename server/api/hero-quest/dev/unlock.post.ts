import { requireUserId } from '#server/utils/auth'
import { assertDevHarness, devUnlock } from '#server/utils/hero-quest-dev'
import { DEV_UNLOCK_BODY, readHqBody, type HqDevUnlockResponse } from '#server/utils/hero-quest-api'

/**
 * Own every roster entry at a chosen star/level, and optionally max the prestige shop.
 * **Dev only** — see `server/utils/hero-quest-dev.ts`.
 *
 * `{ star: 5, level: 10 }` is the top of the `(star × 10 + level)` investment scalar, which is
 * the only way to see what Gear, Artifacts and the Skill potency curve look like fully invested.
 */
export default defineEventHandler(async (event): Promise<HqDevUnlockResponse> => {
    assertDevHarness()
    const userId = await requireUserId(event)
    return devUnlock(userId, await readHqBody(event, DEV_UNLOCK_BODY))
})
