import { requireUserId } from '#server/utils/auth'
import { getGemGuidePrice } from '#server/utils/gem-exchange'
import { gradingFeeFor } from '#shared/utils/tcg/grading-fees'
import type { TcgServiceKey } from '#shared/utils/tcg/grading-model-types'

/** Current per-service grading fees in coins, anchored to the gem guide price. */
export default defineEventHandler(async (event): Promise<Record<TcgServiceKey, number>> => {
    await requireUserId(event)
    const guide = await getGemGuidePrice()
    return {
        PSI: gradingFeeFor('PSI', guide),
        CCC: gradingFeeFor('CCC', guide),
        BRK: gradingFeeFor('BRK', guide),
        GAG: gradingFeeFor('GAG', guide)
    }
})
