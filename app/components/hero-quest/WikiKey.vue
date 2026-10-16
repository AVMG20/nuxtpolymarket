<script setup lang="ts">
/**
 * A legend: what each button does or each symbol means, one row per item.
 *
 * The screen articles are mostly this, so it gets one treatment rather than a dozen hand-rolled
 * lists. `tone` colours the term the way the game colours it (a semantic token, never a palette
 * colour), so "green" in the prose and green on the page agree.
 */
defineProps<{
    items: readonly {
        term: string
        text: string
        /** A semantic text class for the term, e.g. `text-success`. */
        tone?: string
    }[]
}>()
</script>

<template>
  <dl class="divide-y divide-default rounded-lg border border-default bg-elevated/40">
    <div
      v-for="item in items"
      :key="item.term"
      class="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_1fr] sm:gap-3"
    >
      <dt
        class="text-xs font-medium"
        :class="item.tone ?? 'text-highlighted'"
      >
        {{ item.term }}
      </dt>
      <dd class="text-xs text-muted leading-relaxed">
        {{ item.text }}
      </dd>
    </div>
  </dl>
</template>
