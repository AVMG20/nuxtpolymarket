<script setup lang="ts">
// Ambient drifting spores. Purely decorative, so Math.random() is fine here —
// nothing about game state depends on it.
const props = withDefaults(defineProps<{ count?: number }>(), { count: 22 })

const spores = Array.from({ length: props.count }, (_, i) => {
  const size = 2 + Math.random() * 5
  return {
    id: i,
    style: {
      left: `${Math.random() * 100}%`,
      top: `${20 + Math.random() * 80}%`,
      width: `${size}px`,
      height: `${size}px`,
      '--dur': `${10 + Math.random() * 14}s`,
      '--delay': `${-Math.random() * 20}s`,
      '--dx': `${(Math.random() * 2 - 1) * 60}px`,
      '--dy': `${-60 - Math.random() * 160}px`,
      '--peak': String(0.12 + Math.random() * 0.3)
    }
  }
})
</script>

<template>
  <ClientOnly>
    <div class="xeno-spores" aria-hidden="true">
      <span v-for="s in spores" :key="s.id" class="xeno-spore" :style="s.style" />
    </div>
  </ClientOnly>
</template>
