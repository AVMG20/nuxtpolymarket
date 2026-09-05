<script setup lang="ts">
// Ambient drifting fireflies behind the whole colony. Decorative only.
const props = withDefaults(defineProps<{ count?: number }>(), { count: 14 })

const flies = Array.from({ length: props.count }, (_, i) => {
  const size = 2 + Math.random() * 3
  return {
    id: i,
    style: {
      left: `${Math.random() * 100}%`,
      top: `${10 + Math.random() * 90}%`,
      width: `${size}px`,
      height: `${size}px`,
      '--dur': `${12 + Math.random() * 16}s`,
      '--delay': `${-Math.random() * 20}s`,
      '--blink': `${2 + Math.random() * 4}s`,
      '--dx': `${(Math.random() * 2 - 1) * 90}px`,
      '--dy': `${-40 - Math.random() * 140}px`,
      '--peak': String(0.25 + Math.random() * 0.45)
    }
  }
})
</script>

<template>
  <ClientOnly>
    <div
      class="colony-fireflies"
      aria-hidden="true"
    >
      <span
        v-for="f in flies"
        :key="f.id"
        class="colony-firefly"
        :style="f.style"
      />
    </div>
  </ClientOnly>
</template>
