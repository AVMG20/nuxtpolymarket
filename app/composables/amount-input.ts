import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import { parseAmount } from '#shared/utils/parse-amount'

/**
 * Two-way text buffer for a numeric coins/gems ref, so any input can accept
 * shorthand like `10k`, `2.5m` or `1b`. Bind the returned ref with `v-model`
 * on a plain text input (not `type="number"`, which rejects the suffix).
 *
 * Typing updates `amount` as soon as the text parses; blank or unparseable
 * text reads as 0. Setting `amount` from code (½, 2×, All…) rewrites the text,
 * but a value the text already means is left alone, so `100m` stays `100m`.
 */
export function useAmountInput(amount: Ref<number>, options: { integer?: boolean } = {}) {
  const read = (value: string) => {
    const parsed = parseAmount(value) ?? 0
    return options.integer ? Math.floor(parsed) : parsed
  }

  const text = ref(amount.value ? String(amount.value) : '')

  watch(text, (value) => {
    const parsed = read(value)
    if (parsed !== amount.value) amount.value = parsed
  })

  watch(amount, (value) => {
    if (read(text.value) !== value) text.value = value ? String(value) : ''
  })

  return text
}
