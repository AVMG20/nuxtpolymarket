import { requireUserId } from '#server/utils/auth'
import { assertDevHarness, devSet, type DevSet } from '#server/utils/hero-quest-dev'

/**
 * Teleport the run — prestige, world, stage, hero level, class node, `runCleared`, `bossLost`.
 * **Dev only** — see `server/utils/hero-quest-dev.ts`.
 *
 * `atBossGate` is always derived from the landing stage rather than accepted from the body, so a
 * jump can never store a flag that disagrees with the stage.
 */
export default defineEventHandler(async (event) => {
    assertDevHarness()
    const userId = await requireUserId(event)
    const body = await readBody<DevSet>(event)
    return devSet(userId, body ?? {})
})
