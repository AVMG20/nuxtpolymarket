<script setup lang="ts">
// Confetti shower inside a positioned parent. Decorative — Math.random() is fine.
const props = withDefaults(defineProps<{ count?: number; colors?: string[] }>(), {
  count: 28,
  colors: () => ['var(--ui-primary)', 'var(--ui-secondary)', '#facc15', '#f472b6', '#38bdf8', '#ffffff']
})

const pieces = Array.from({ length: props.count }, (_, i) => ({
  id: i,
  style: {
    left: `${Math.random() * 100}%`,
    background: props.colors[i % props.colors.length],
    '--dx': `${(Math.random() * 2 - 1) * 60}px`,
    '--rot': `${360 + Math.random() * 720}deg`,
    '--dur': `${1.6 + Math.random() * 1.4}s`,
    '--delay': `${Math.random() * 0.5}s`,
    width: `${5 + Math.random() * 5}px`,
    height: `${8 + Math.random() * 6}px`
  }
}))
</script>

<template>
  <!-- Client-only: the random piece layout would never match the server render. -->
  <ClientOnly>
    <div class="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <span v-for="p in pieces" :key="p.id" class="xeno-confetti" :style="p.style" />
    </div>
  </ClientOnly>
</template>
