import { requireUserId } from '#server/utils/auth'
import { assertDevHarness, devUnlock, type DevUnlock } from '#server/utils/hero-quest-dev'

/**
 * Own every roster entry at a chosen star/level, and optionally max the prestige shop.
 * **Dev only** — see `server/utils/hero-quest-dev.ts`.
 *
 * `{ star: 5, level: 10 }` is the top of the `(star × 10 + level)` investment scalar, which is
 * the only way to see what Gear, Artifacts and the Skill potency curve look like fully invested.
 */
export default defineEventHandler(async (event) => {
    assertDevHarness()
    const userId = await requireUserId(event)
    const body = await readBody<DevUnlock>(event)
    return devUnlock(userId, body ?? {})
})
