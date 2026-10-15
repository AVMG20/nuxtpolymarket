import { requireUserId } from '#server/utils/auth'
import { assertDevHarness, devSet } from '#server/utils/hero-quest-dev'
import { DEV_SET_BODY, readHqBody, type HqDevSetResponse } from '#server/utils/hero-quest-api'

/**
 * Teleport the run — prestige, world, stage, hero level, class node, `runCleared`, `bossLost`.
 * **Dev only** — see `server/utils/hero-quest-dev.ts`.
 *
 * `atBossGate` is always derived from the landing stage rather than accepted from the body, so a
 * jump can never store a flag that disagrees with the stage.
 */
export default defineEventHandler(async (event): Promise<HqDevSetResponse> => {
    assertDevHarness()
    const userId = await requireUserId(event)
    return devSet(userId, await readHqBody(event, DEV_SET_BODY))
})
