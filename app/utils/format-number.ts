export default function (value: number | bigint | Intl.StringNumericLiteral, compact: boolean = true, minimumFractionDigits: number = 0) {
  const { format: formatNumber } = Intl.NumberFormat('nl-NL', {
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits,
    maximumFractionDigits: 2
  })

  return formatNumber(value)
}
