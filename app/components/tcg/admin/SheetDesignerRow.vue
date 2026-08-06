<script setup lang="ts">
defineProps<{
  bundle: string | null
  number: string
  name: string
  rarity: string
  finish: string
  pattern: string | null
  oneIn: number | null
  disabled: boolean
  invalid: boolean
}>()

const mult = defineModel<number>({ default: 0 })

function fmtOneIn (x: number): string {
  if (!Number.isFinite(x)) return '—'
  if (x >= 100) return formatNumber(Math.round(x), false)
  if (x >= 10) return x.toFixed(1)
  return x.toFixed(2)
}
</script>

<template>
  <tr
    class="border-b border-default last:border-b-0"
    :class="mult > 0 ? 'bg-elevated/50' : ''"
  >
    <td class="py-1 pl-3 pr-2 w-10">
      <TcgCardThumb v-if="bundle" :bundle="bundle" class="w-8" />
      <div v-else class="aspect-[0.718] w-8 rounded bg-elevated" />
    </td>
    <td class="py-1 pr-3 w-16 font-mono text-xs text-muted tabular-nums whitespace-nowrap">
      {{ number }}
    </td>
    <td class="py-1 pr-3">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="text-sm truncate" :class="mult > 0 ? 'text-highlighted font-medium' : 'text-default'">{{ name }}</span>
        <UBadge :color="rarityColor(rarity)" variant="outline" size="sm" class="shrink-0">{{ rarity }}</UBadge>
        <UBadge v-if="finish !== 'nonholo'" color="neutral" variant="subtle" size="sm" class="shrink-0">{{ finish }}</UBadge>
        <UBadge v-if="pattern" color="primary" variant="subtle" size="sm" class="shrink-0">{{ pattern }}</UBadge>
      </div>
    </td>
    <td class="py-1 pr-3 w-24 text-right font-mono text-xs tabular-nums whitespace-nowrap" :class="mult > 0 ? 'text-default' : 'text-dimmed'">
      <template v-if="oneIn !== null">1 in {{ fmtOneIn(oneIn) }}</template>
      <template v-else>—</template>
    </td>
    <td class="py-1 pr-3 w-32">
      <div class="flex items-center justify-end gap-1.5">
        <UTooltip v-if="invalid" text="Exceeds the window constraint for this sheet">
          <UIcon name="i-lucide-triangle-alert" class="size-4 text-error" />
        </UTooltip>
        <UInputNumber
          v-model="mult"
          :min="0"
          :disabled="disabled"
          size="xs"
          class="w-24"
          :color="invalid ? 'error' : undefined"
          :highlight="invalid"
        />
      </div>
    </td>
  </tr>
</template>
