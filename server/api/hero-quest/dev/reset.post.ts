import { requireUserId } from '#server/utils/auth'
import { assertDevHarness, devReset } from '#server/utils/hero-quest-dev'

/**
 * Wipe Hero Quest back to unfounded, so the next `init` is a genuinely fresh account.
 * **Dev only** — see `server/utils/hero-quest-dev.ts`.
 *
 * Gold and Gems survive: they are shared platform balances, and a game reset has no business
 * deleting a balance earned elsewhere.
 */
export default defineEventHandler(async (event) => {
    assertDevHarness()
    const userId = await requireUserId(event)
    return devReset(userId)
})
