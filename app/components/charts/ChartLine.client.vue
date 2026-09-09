<script setup lang="ts">
import { VisXYContainer, VisLine, VisArea, VisAxis, VisCrosshair, VisTooltip } from '@unovis/vue'

const props = withDefaults(defineProps<{
  data: any[]
  x: (d: any, i: number) => number
  y: (d: any) => number
  color: string
  negativeColor?: string
  width: number
  tickFormat: (i: number) => string
  tooltipTemplate: (d: any) => string
  height?: string
  padding?: { top?: number; left?: number; right?: number; bottom?: number }
  areaOpacity?: number
}>(), {
  height: 'h-48',
  padding: () => ({ top: 32, left: 8, right: 8 }),
  areaOpacity: 0.1,
})

const positiveY = (datum: unknown) => {
  const value = props.y(datum)
  return value >= 0 ? value : undefined
}

const negativeY = (datum: unknown) => {
  const value = props.y(datum)
  return value <= 0 ? value : undefined
}
</script>

<template>
  <VisXYContainer :data="data" :padding="padding" :class="[height, 'chart-line']" :width="width">
    <VisArea :x="x" :y="negativeColor ? positiveY : y" :color="color" :opacity="areaOpacity" />
    <VisArea v-if="negativeColor" :x="x" :y="negativeY" :color="negativeColor" :opacity="areaOpacity" />
    <VisLine :x="x" :y="negativeColor ? positiveY : y" :color="color" />
    <VisLine v-if="negativeColor" :x="x" :y="negativeY" :color="negativeColor" />
    <VisAxis type="x" :x="x" :tick-format="tickFormat" />
    <VisCrosshair :color="color" :template="tooltipTemplate" />
    <VisTooltip />
  </VisXYContainer>
</template>

<style scoped>
/*
 * Unovis ships its own palette and picks between its light and dark values off
 * `prefers-color-scheme`, which ignores the class-based theme the app actually
 * uses. Point both branches at the Nuxt UI tokens so the chart follows the
 * theme the user picked instead of the one the OS reports.
 */
.chart-line {
  --vis-axis-grid-color: var(--ui-border);
  --vis-dark-axis-grid-color: var(--ui-border);
  --vis-axis-domain-color: var(--ui-border);
  --vis-dark-axis-domain-color: var(--ui-border);
  --vis-axis-tick-color: transparent;
  --vis-dark-axis-tick-color: transparent;
  --vis-axis-tick-label-color: var(--ui-text-dimmed);
  --vis-dark-axis-tick-label-color: var(--ui-text-dimmed);
  --vis-axis-label-color: var(--ui-text-muted);
  --vis-dark-axis-label-color: var(--ui-text-muted);
  --vis-axis-grid-line-width: 1;
  --vis-axis-tick-line-width: 0;
  --vis-axis-tick-label-font-size: 11px;

  --vis-crosshair-line-stroke-color: var(--ui-border-accented);
  --vis-crosshair-circle-stroke-color: var(--ui-bg);

  --vis-tooltip-background-color: var(--ui-bg-elevated);
  --vis-dark-tooltip-background-color: var(--ui-bg-elevated);
  --vis-tooltip-border-color: var(--ui-border-accented);
  --vis-dark-tooltip-border-color: var(--ui-border-accented);
  --vis-tooltip-text-color: var(--ui-text);
  --vis-dark-tooltip-text-color: var(--ui-text);
  --vis-tooltip-shadow-color: rgb(0 0 0 / 0.25);
  --vis-dark-tooltip-shadow-color: rgb(0 0 0 / 0.5);
  --vis-tooltip-border-radius: var(--ui-radius);
  --vis-tooltip-padding: 4px 8px;
}
</style>
