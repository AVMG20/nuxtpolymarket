<script setup lang="ts">
// Renders one rolled mod/trait: bold value + muted uppercase label, no icon.
// Formatting (MOD_LABEL/formatModValue vs AGENT_TRAIT_LABEL/formatTraitValue)
// stays with the caller so this stays reusable for both item mods and agent
// traits — see PLAN.md §13.1 (no emoji on trait/attribute displays).
defineProps<{
  label: string
  value: string
  /** Loadout compare: colors the value green/red vs. the equipped item's same
   * trait. Omitted or 'same' keeps the default neutral color. */
  compareDir?: 'up' | 'down' | 'same' | null
  /** Roll quality 0–100 (rollPct of the value within its range). When set, a
   * thin progress bar along the chip's bottom edge fills to that percentile so
   * a floor roll and a god roll read at a glance, and hovering reveals the
   * rolled value against the max. Only passed for single rolls with a known
   * range (item mods) — combined/total-bonus chips omit it. */
  pct?: number | null
  /** Formatted max of the roll's range, shown in the hover popover next to the
   * rolled value. Passed alongside pct for graded chips. */
  valueMax?: string
}>()
</script>

<template>
  <UTooltip
    :disabled="pct == null"
    :delay-duration="150"
    :ui="{ content: 'flex flex-col gap-1.5 p-2.5 w-44 h-auto' }"
  >
    <span
      class="hack-mod-chip"
      :class="{ 'hack-mod-chip-graded': pct != null }"
    >
      <span
        v-if="pct != null"
        class="hack-mod-chip-fill"
        :style="{ width: `${pct}%` }"
      />
      <b
        :class="{ 'text-success': compareDir === 'up', 'text-error': compareDir === 'down' }"
      >{{ value }}</b>
      <span class="hack-mod-chip-label">{{ label }}</span>
    </span>

    <template #content>
      <div class="flex items-center justify-between gap-3 text-xs font-mono">
        <span class="uppercase tracking-wide text-muted">{{ label }}</span>
        <span class="font-bold text-primary">{{ pct }}%</span>
      </div>
      <div class="hack-roll-tip-bar">
        <div
          class="hack-range-fill"
          :style="{ width: `${pct}%` }"
        />
      </div>
      <div class="flex items-center justify-between gap-3 text-xs font-mono">
        <b class="text-highlighted">{{ value }}</b>
        <span class="text-muted">max {{ valueMax }}</span>
      </div>
    </template>
  </UTooltip>
</template>
