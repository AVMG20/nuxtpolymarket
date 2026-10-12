<script setup lang="ts">
/**
 * The Traits' route, drawn on the stage as the Traits scene, which is where they are rolled,
 * locked, stored and loaded (`shared/utils/hero-quest/traits.ts`).
 */
const { initialized } = useHeroQuest()
</script>

<template>
  <div
    v-if="!initialized"
    class="text-center py-16 text-muted"
  >
    Start a run first.
  </div>
</template>
