export default function (value: number | bigint | Intl.StringNumericLiteral, compact: boolean = true, minimumFractionDigits: number = 0) {
  const { format: formatNumber } = Intl.NumberFormat('nl-NL', {
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits,
    maximumFractionDigits: 2
  })

  const formatted = formatNumber(value)
  if (!compact) return formatted

  return formatted
    .replace(/[\s\u00a0]*mln\.?/gi, 'm')
    .replace(/[\s\u00a0]*mld\.?/gi, 'B')
    .replace(/[\s\u00a0]*bln\.?/gi, 'T')
}

