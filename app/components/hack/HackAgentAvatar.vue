<script setup lang="ts">
import { RARITY_STYLE, type HackRarity } from '#shared/utils/hack-config'
import { agentIcon } from '~/utils/hack-content'

// Agent portrait: the name's sigil, tinted for its rarity by the shared duotone
// filter (HackRarityDuotone, rendered once in the hack shell). A rarity-bordered
// box with the emblem inset to 72% so it never crowds the surrounding UI. Size and
// corner rounding come from the parent via merged class.
//
// The inset is on the IMG (max-w/max-h), not padding on the box: percentage
// padding on this flex box (a flex item in every call site) round-trips through
// the replaced img's intrinsic size and collapses the whole avatar to 0.
const props = defineProps<{
  name: string
  rarity: HackRarity
}>()

const src = computed(() => agentIcon(props.name, props.rarity))
</script>

<template>
  <div
    class="flex items-center justify-center overflow-hidden bg-elevated border"
    :class="RARITY_STYLE[rarity].border"
  >
    <img
      :src="src"
      alt=""
      class="max-w-[72%] max-h-[72%] object-contain"
      :style="{ filter: `url(#hack-duo-${rarity})` }"
    >
  </div>
</template>
