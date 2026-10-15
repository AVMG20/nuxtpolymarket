import { requireUserId } from '#server/utils/auth'
import { assertDevHarness, devGrant } from '#server/utils/hero-quest-dev'
import { DEV_GRANT_BODY, readHqBody, type HqDevGrantResponse } from '#server/utils/hero-quest-api'

/**
 * Top up currencies. **Dev only** — see `server/utils/hero-quest-dev.ts` for the gate and the
 * reason it is `import.meta.dev` alone: `gold` and `gems` are shared platform balances, not
 * Hero Quest scrip.
 */
export default defineEventHandler(async (event): Promise<HqDevGrantResponse> => {
    assertDevHarness()
    const userId = await requireUserId(event)
    return devGrant(userId, await readHqBody(event, DEV_GRANT_BODY))
})
