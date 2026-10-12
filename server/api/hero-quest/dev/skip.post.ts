import { requireUserId } from '#server/utils/auth'
import { assertDevHarness, devSkip, type SkipMode } from '#server/utils/hero-quest-dev'

/**
 * Time travel. **Dev only** — see `server/utils/hero-quest-dev.ts` for the gate and the rules.
 *
 * `{ hours: 8, mode: 'offline' }` settles one eight-hour window, which is what measures the
 * offline cap and the efficiency tax. `mode: 'online'` instead settles the same span as
 * consecutive presence-length windows, which is what a player sitting at the screen would have
 * earned. They are different experiments and both are worth running.
 */
export default defineEventHandler(async (event) => {
    assertDevHarness()
    const userId = await requireUserId(event)
    const body = await readBody<{ hours?: number; mode?: SkipMode }>(event)

    const mode: SkipMode = body?.mode === 'online' ? 'online' : 'offline'
    return devSkip(userId, Number(body?.hours ?? 1), mode)
})
