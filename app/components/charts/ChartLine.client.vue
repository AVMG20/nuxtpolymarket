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
  <VisXYContainer :data="data" :padding="padding" :class="height" :width="width">
    <VisArea :x="x" :y="negativeColor ? positiveY : y" :color="color" :opacity="areaOpacity" />
    <VisArea v-if="negativeColor" :x="x" :y="negativeY" :color="negativeColor" :opacity="areaOpacity" />
    <VisLine :x="x" :y="negativeColor ? positiveY : y" :color="color" />
    <VisLine v-if="negativeColor" :x="x" :y="negativeY" :color="negativeColor" />
    <VisAxis type="x" :x="x" :tick-format="tickFormat" />
    <VisCrosshair :color="color" :template="tooltipTemplate" />
    <VisTooltip />
  </VisXYContainer>
</template>
