<script setup lang="ts">
/**
 * The Shop's Battle Speed tab, drawn on the stage, which is where blocks are bought
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
