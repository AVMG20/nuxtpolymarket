<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 30 })
</script>

<template>
  <!-- Two leaves on one stem: the green one for growing, the violet one for mutating. -->
  <svg :width="size" :height="size" viewBox="0 0 32 32" fill="none" aria-hidden="true" class="shrink-0">
    <path d="M16 29V15" stroke="var(--xg-accent)" stroke-width="2.4" stroke-linecap="round" />
    <path d="M16 17C9 17 5.5 12 6 5c7 0 10.5 4.5 10 12z" fill="var(--xg-accent)" fill-opacity=".22" stroke="var(--xg-accent)" stroke-width="2" />
    <path d="M16 14c0-6 3.5-9.5 10-9.5 0 6.5-3.5 9.5-10 9.5z" fill="var(--xg-uv)" fill-opacity=".25" stroke="var(--xg-uv)" stroke-width="2" />
  </svg>
</template>
