<script setup lang="ts">
defineProps<{ class?: string }>()
</script>

<template>
  <svg
    :class="$props.class"
    viewBox="0 0 64 64"
    fill="none"
    aria-label="Aether crystal"
    role="img"
  >
    <g stroke="currentColor" stroke-linejoin="round">
      <path d="m25 53-8-21 7-23 12 7 4 20-7 17z" fill="currentColor" opacity=".92" />
      <path d="m36 16 9-9 8 20-13 9-4-20z" fill="currentColor" opacity=".62" />
      <path d="m17 32 8-21 12 7-12 14z" fill="currentColor" opacity=".46" />
      <path d="m25 53 12-17 7-9 5 10-12 17z" fill="currentColor" opacity=".72" />
      <path d="m25 11 6-5 7 7-1 5z" fill="currentColor" opacity=".78" />
      <path d="m13 43 8-4 4 14-10-4z" fill="currentColor" opacity=".54" />
      <path d="m45 27 7-4 6 13-12 1z" fill="currentColor" opacity=".42" />
      <path d="m25 11 12 7m-12 3 12 0m-12 11 13 4m-5-20 4 20m-4 0 7 9m-20 3 8-7" stroke="white" stroke-width="1.4" opacity=".86" />
    </g>
    <g fill="white">
      <path d="m19 20 1 3 3 1-3 1-1 3-1-3-3-1 3-1z" opacity=".95" />
      <path d="m47 14 .8 2.2L50 17l-2.2.8L47 20l-.8-2.2L44 17l2.2-.8z" opacity=".8" />
      <circle cx="43" cy="43" r="1.1" opacity=".9" />
      <circle cx="29" cy="28" r=".8" opacity=".75" />
    </g>
  </svg>
</template>
