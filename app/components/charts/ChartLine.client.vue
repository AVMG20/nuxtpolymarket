<script setup lang="ts">
import { VisXYContainer, VisLine, VisArea, VisAxis, VisCrosshair, VisTooltip } from '@unovis/vue'

const props = withDefaults(defineProps<{
  data: any[]
  x: (d: any, i: number) => number
  y: (d: any) => number
  color: string
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
</script>

<template>
  <VisXYContainer :data="data" :padding="padding" :class="height" :width="width">
    <VisArea :x="x" :y="y" :color="color" :opacity="areaOpacity" />
    <VisLine :x="x" :y="y" :color="color" />
    <VisAxis type="x" :x="x" :tick-format="tickFormat" />
    <VisCrosshair :color="color" :template="tooltipTemplate" />
    <VisTooltip />
  </VisXYContainer>
</template>