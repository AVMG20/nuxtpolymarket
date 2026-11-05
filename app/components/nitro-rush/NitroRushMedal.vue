<script setup lang="ts">
import type { Medal } from '~/utils/nitro-rush/medals'

/** A small medal mark in the medal's colour, sized by the text around it; nothing without a medal. */
defineProps<{ medal: Medal | null }>()
</script>

<template>
  <span v-if="medal" class="nr-medal" :class="`medal-${medal}`" role="img" :aria-label="`${medal} medal`" :title="`${medal[0]!.toUpperCase()}${medal.slice(1)}`">
    <UIcon name="i-lucide-medal" class="size-full" />
  </span>
</template>
