<script setup lang="ts">
// Renders one rolled mod/trait: bold value + muted uppercase label, no icon.
// Formatting (MOD_LABEL/formatModValue vs AGENT_TRAIT_LABEL/formatTraitValue)
// stays with the caller so this stays reusable for both item mods and agent
// traits — see PLAN.md §13.1 (no emoji on trait/attribute displays).
defineProps<{
  label: string
  value: string
}>()
</script>

<template>
  <span class="hack-mod-chip">
    <b>{{ value }}</b>
    <span class="hack-mod-chip-label">{{ label }}</span>
  </span>
</template>
