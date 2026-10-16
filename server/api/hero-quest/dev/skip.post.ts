import { requireUserId } from '#server/utils/auth'
import { assertDevHarness, devSkip } from '#server/utils/hero-quest-dev'
import { DEV_SKIP_BODY, readHqBody, type HqDevSkipResponse } from '#server/utils/hero-quest-api'
import { roundHq } from '#shared/utils/hero-quest/numbers'

/**
 * Time travel. **Dev only** — see `server/utils/hero-quest-dev.ts` for the gate and the rules.
 *
 * `{ hours: 8, mode: 'offline' }` settles one eight-hour window, which is what measures the
 * offline cap and the efficiency tax. `mode: 'online'` instead settles the same span as
 * consecutive presence-length windows, which is what a player sitting at the screen would have
 * earned. They are different experiments and both are worth running.
 */
export default defineEventHandler(async (event): Promise<HqDevSkipResponse> => {
    assertDevHarness()
    const userId = await requireUserId(event)
    const { hours = 1, mode = 'offline' } = await readHqBody(event, DEV_SKIP_BODY)
    const result = await devSkip(userId, hours, mode)
    // the Gold the windows banked is shown only; the run itself is read back from the state
    return { ...result, goldEarned: roundHq(result.goldEarned) }
})
