<script setup lang="ts">
/**
 * The login calendar's route, drawn on the stage as the Calendar scene, which is where days are
 * claimed (`shared/utils/hero-quest/calendar.ts`).
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
