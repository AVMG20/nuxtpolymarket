export default function(value:number | bigint |  Intl.StringNumericLiteral, compact:boolean = true) {
  const { format: formatNumber }  = Intl.NumberFormat('nl-NL', {
    notation: compact ? 'compact' : 'standard',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
  })

  return formatNumber(value);
}
