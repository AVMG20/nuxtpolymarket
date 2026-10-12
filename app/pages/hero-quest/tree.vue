<script setup lang="ts">
/**
 * The Passive Skill Tree's route, drawn on the stage as the tree scene, which is where its nodes are
 * bought and the tree is respecced (`shared/utils/hero-quest/passive-tree.ts`).
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
