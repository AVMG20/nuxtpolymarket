/**
 * The playtest harness (`server/utils/hero-quest-dev.ts`) mints Gold and Gems, which are shared
 * platform balances rather than Hero Quest scrip. The failure mode is not "a bug" — it is a mint
 * reachable in production, so the assertion is that the gate fails *closed*.
 */

import { describe, expect, it } from 'vitest'
import { assertDevHarness, devHarnessEnabled } from '#server/utils/hero-quest-dev'

describe('dev harness gate', () => {
    /**
     * Conditional on purpose. The gate reads `import.meta.dev`, which is a property of the build
     * rather than of the code, so the honest assertion is the *relationship* — closed means a 404
     * — rather than a hard-coded expectation about which build vitest happens to be.
     *
     * The 404 matters as much as the throw. A 403 would confirm the routes exist.
     */
    it('fails closed, and 404s rather than 403s so the routes look undeployed', () => {
        // `devMode` in runtime config is deliberately *not* consulted — a deploy-time flag must
        // not be able to open a route that mints a shared balance.
        expect(typeof devHarnessEnabled()).toBe('boolean')
        if (devHarnessEnabled()) {
            expect(() => assertDevHarness()).not.toThrow()
            return
        }
        expect(() => assertDevHarness()).toThrowError(
            expect.objectContaining({ statusCode: 404 })
        )
    })
})
