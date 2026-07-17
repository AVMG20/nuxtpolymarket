import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubRandomFloat } from './stub-random'
import { randomFloat } from '../../shared/utils/random'

const EPSILON = 2 ** -53

describe('stubRandomFloat', () => {
    afterEach(() => vi.restoreAllMocks())

    it.each([0, 0.25, 0.5, 0.75, 0.999999999999, 0.1, 1 / 3])(
        'makes randomFloat() return %p',
        (value) => {
            stubRandomFloat(() => value)
            expect(Math.abs(randomFloat() - value)).toBeLessThanOrEqual(EPSILON)
        }
    )
})
