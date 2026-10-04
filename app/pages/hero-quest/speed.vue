<script setup lang="ts">
/**
 * Battle Speed's route, drawn on the stage as the Speed scene, which is where blocks are bought
 * (`idle-mechanics.md` §3).
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
