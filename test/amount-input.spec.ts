import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { useAmountInput } from '../app/composables/amount-input'

describe('useAmountInput', () => {
    it('writes shorthand through to the numeric ref', async () => {
        const amount = ref(0)
        const text = useAmountInput(amount)
        text.value = '2.5m'
        await nextTick()
        expect(amount.value).toBe(2_500_000)
        expect(text.value).toBe('2.5m')
    })

    it('reads blank or junk text as 0', async () => {
        const amount = ref(10)
        const text = useAmountInput(amount)
        text.value = 'abc'
        await nextTick()
        expect(amount.value).toBe(0)
        expect(text.value).toBe('abc')
    })

    it('rewrites the text when the ref changes from code', async () => {
        const amount = ref(100)
        const text = useAmountInput(amount)
        text.value = '10k'
        await nextTick()
        amount.value = 20_000
        await nextTick()
        expect(text.value).toBe('20000')
    })

    it('floors integer amounts without clobbering the typed text', async () => {
        const amount = ref(1)
        const text = useAmountInput(amount, { integer: true })
        text.value = '1.5k'
        await nextTick()
        expect(amount.value).toBe(1500)
        text.value = '1.5'
        await nextTick()
        expect(amount.value).toBe(1)
        expect(text.value).toBe('1.5')
    })
})
