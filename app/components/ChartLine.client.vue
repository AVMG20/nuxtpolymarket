<script setup lang="ts">
import { VisXYContainer, VisLine, VisArea, VisAxis, VisCrosshair, VisTooltip } from '@unovis/vue'

defineProps<{
  data: any[]
  x: (d: any, i: number) => number
  y: (d: any) => number
  color: string
  width: number
  tickFormat: (i: number) => string
  tooltipTemplate: (d: any) => string
}>()
</script>

<template>
  <VisXYContainer :data="data" :padding="{ top: 32, left: 8, right: 8 }" class="h-52" :width="width">
    <VisArea :x="x" :y="y" :color="color" :opacity="0.08" />
    <VisLine :x="x" :y="y" :color="color" />
    <VisAxis type="x" :x="x" :tick-format="tickFormat" />
    <VisCrosshair :color="color" :template="tooltipTemplate" />
    <VisTooltip />
  </VisXYContainer>
</template>