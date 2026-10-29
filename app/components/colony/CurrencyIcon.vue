<script setup lang="ts">
withDefaults(defineProps<{
  kind?: 'coin' | 'gem'
  size?: number
}>(), { kind: 'coin', size: 16 })
</script>

<template>
  <svg
    v-if="kind === 'coin'"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
    class="shrink-0"
  >
    <circle cx="12" cy="12" r="10" fill="#d97706" />
    <circle cx="12" cy="12" r="7.5" fill="#fbbf24" />
    <path d="M9 9.5a4 4 0 0 1 6 0" stroke="#fff7d6" stroke-width="1.6" fill="none" stroke-linecap="round" />
  </svg>
  <svg
    v-else
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
    class="shrink-0"
  >
    <path d="M6 3h12l4 6-10 12L2 9z" fill="#38bdf8" />
    <path d="M2 9h20M9 3l3 6 3-6M12 9v12" stroke="#075985" stroke-width="1.2" fill="none" opacity=".55" />
  </svg>
</template>
