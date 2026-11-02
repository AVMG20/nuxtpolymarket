import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNitroRushConfirmTap } from '../../app/composables/useNitroRushConfirmTap'

describe('two-tap confirm', () => {
    const scope = effectScope()
    const confirm = () => scope.run(useNitroRushConfirmTap)!

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('confirms on the second tap of the same key', () => {
        const { armed, tap } = confirm()
        expect(tap('a')).toBe(false)
        expect(armed.value).toBe('a')
        expect(tap('a')).toBe(true)
        expect(armed.value).toBeNull()
    })

    it('starts over on another key', () => {
        const { armed, tap } = confirm()
        tap('a')
        expect(tap('b')).toBe(false)
        expect(armed.value).toBe('b')
    })

    it('forgets the first tap after a moment', () => {
        const { armed, tap } = confirm()
        tap('a')
        vi.advanceTimersByTime(3000)
        expect(armed.value).toBeNull()
        expect(tap('a')).toBe(false)
    })
})
