<script setup lang="ts">
/**
 * The Calendar's Milestones tab, drawn on the stage, which is where they are
 * claimed (`shared/utils/hero-quest/milestones.ts`).
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
