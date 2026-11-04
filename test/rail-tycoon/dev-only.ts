// Concurrency bursts, fuzzing, long soaks and cap-sized inputs run on a developer's machine. The
// pipeline (CI is set there) runs only the tests that check rules and paths, so it stays fast.
import { it } from 'vitest'

/** True in the pipeline, where the dev-only tests are skipped. */
export const rtInPipeline = Boolean(process.env.CI)

/** `it` for a dev-only test: skipped in the pipeline, run everywhere else. */
export const devIt = it.skipIf(rtInPipeline)
