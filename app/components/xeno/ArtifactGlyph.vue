<script setup lang="ts">
import { getArtifact } from '#shared/utils/xeno'
import { artifactFamily, roman } from '~/lib/xeno-ui'

// Artifact as a neutral tile with its family icon and level numeral.
const props = withDefaults(defineProps<{
  typeId: string
  gemCrafted?: boolean
  size?: number
  showLevel?: boolean
}>(), { gemCrafted: false, size: 44, showLevel: true })

const family = computed(() => artifactFamily(props.typeId))
const level = computed(() => getArtifact(props.typeId)?.level ?? 1)
const iconPx = computed(() => Math.round(props.size * 0.45))
</script>

<template>
  <span
    class="xg-glyph"
    :class="[family.cls, gemCrafted ? 'gem' : '']"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :title="gemCrafted ? 'Gem-crafted: +1 level on every effect' : undefined"
  >
    <UIcon :name="family.icon" :style="{ width: `${iconPx}px`, height: `${iconPx}px` }" />
    <span v-if="showLevel" class="xg-rn">{{ roman(level) }}</span>
  </span>
</template>
