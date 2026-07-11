<script setup lang="ts">
import { RARITY_STYLE, type HackRarity } from '#shared/utils/hack-config'
import { agentIcon } from '~/utils/hack-content'

// Agent portrait: the name's sigil, tinted for its rarity by the shared duotone
// filter (HackRarityDuotone, rendered once in the hack shell). Sits in a padded,
// rarity-bordered box so the emblem never crowds the surrounding UI. Size and
// corner rounding come from the parent via merged class.
const props = defineProps<{
  name: string
  rarity: HackRarity
}>()

const src = computed(() => agentIcon(props.name, props.rarity))
</script>

<template>
  <div
    class="flex items-center justify-center overflow-hidden bg-elevated border p-[14%]"
    :class="RARITY_STYLE[rarity].border"
  >
    <img
      :src="src"
      alt=""
      class="w-full h-full object-contain"
      :style="{ filter: `url(#hack-duo-${rarity})` }"
    >
  </div>
</template>
