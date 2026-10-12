import { requireUserId } from '#server/utils/auth'
import { assertDevHarness, devGrant, type DevGrant } from '#server/utils/hero-quest-dev'

/**
 * Top up currencies. **Dev only** — see `server/utils/hero-quest-dev.ts` for the gate and the
 * reason it is `import.meta.dev` alone: `gold` and `gems` are shared platform balances, not
 * Hero Quest scrip.
 */
export default defineEventHandler(async (event) => {
    assertDevHarness()
    const userId = await requireUserId(event)
    const body = await readBody<DevGrant>(event)
    return devGrant(userId, body ?? {})
})
