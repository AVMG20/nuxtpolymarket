<script setup lang="ts">
/** Tilt Neon has no tabular figures, so live readouts box each digit to stop them jittering. */
defineProps<{ text: string | number }>()
</script>

<template>
  <span><span v-for="(c, i) in String(text)" :key="i" :class="{ 'nr-digit': c >= '0' && c <= '9' }">{{ c }}</span></span>
</template>

<style scoped>
.nr-digit {
    display: inline-block;
    width: 0.6em;
    text-align: center;
}
</style>
