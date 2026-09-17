import { parseAmount } from '#shared/utils/parse-amount'
import formatNumber from './format-number'

/**
 * Full-number readout for shorthand typed into an amount input: `10m` →
 * `10.000.000`. Empty when the text doesn't parse or already reads the same,
 * so `500` doesn't echo `500` next to itself.
 */
export function amountPreview(text: string | undefined, integer = false): string {
  const parsed = parseAmount(text ?? '')
  if (parsed === null) return ''
  const formatted = formatNumber(integer ? Math.floor(parsed) : parsed, false)
  return formatted === text?.trim() ? '' : formatted
}
