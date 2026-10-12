<script setup lang="ts">
/**
 * A rule, with its live numbers already in it.
 *
 * Every formula on the wiki is built by interpolating `constants.ts` rather than typed out, so
 * this renders a string the caller has already resolved. The monospace treatment is the signal
 * that what follows is the actual rule the server runs, not a paraphrase.
 */
defineProps<{
    /** What the rule is for, e.g. "Crit chance". Optional when the formula names itself. */
    label?: string
    formula: string
    /** The one caveat worth carrying beside a rule, if any. */
    note?: string
}>()
</script>

<template>
  <div class="rounded-lg border border-default bg-elevated/40 px-3 py-2.5 space-y-1">
    <p
      v-if="label"
      class="text-[0.625rem] uppercase tracking-wide text-muted"
    >
      {{ label }}
    </p>
    <!-- Wide formulas scroll inside the box; the page must never scroll sideways. -->
    <p class="font-mono text-xs text-default overflow-x-auto whitespace-nowrap">
      {{ formula }}
    </p>
    <p
      v-if="note"
      class="text-xs text-muted"
    >
      {{ note }}
    </p>
  </div>
</template>
