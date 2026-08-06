<script setup lang="ts">
import type { TcgPopReportRow } from '#shared/types/tcg'

/* Population report (§6.5): graded copies only, per printing × service ×
 * grade × designation. Raw and sealed populations are genuinely unknown —
 * the report understates supply, and that's the point.
 */
const { sets } = useTcg()

const selectedSetId = ref<string | undefined>(undefined)
const setOptions = computed(() =>
  sets.value.map(s => ({ label: `${s.name} (${s.code})`, value: s.id })))

const { data: rows, pending } = useFetch<TcgPopReportRow[]>('/api/tcg/pop-report', {
  key: 'tcg-pop-report',
  query: { setId: selectedSetId },
  immediate: false,
  watch: [selectedSetId]
})

// AFTER useFetch is created, so the watched query ref change actually
// triggers the fetch (same trap as collection.vue).
watch(sets, (list) => {
  if (selectedSetId.value || !list.length) return
  const newest = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!
  selectedSetId.value = newest.id
}, { immediate: true })

interface PopGroup {
  printingId: string
  cardName: string
  finishLabel: string
  rarity: string | null
  total: number
  lines: TcgPopReportRow[]
}

// Grouped per printing, each with its service/grade lines; "none higher"
// falls out of reading the top line.
const groups = computed<PopGroup[]>(() => {
  const byPrinting = new Map<string, PopGroup>()
  for (const row of rows.value ?? []) {
    let group = byPrinting.get(row.printingId)
    if (!group) {
      group = {
        printingId: row.printingId,
        cardName: row.cardName,
        finishLabel: finishLabel(row.finish, row.pattern),
        rarity: row.rarity,
        total: 0,
        lines: []
      }
      byPrinting.set(row.printingId, group)
    }
    group.total += row.count
    group.lines.push(row)
  }
  for (const group of byPrinting.values()) {
    group.lines.sort((a, b) => a.service.localeCompare(b.service)
      || parseFloat(b.grade) - parseFloat(a.grade))
  }
  return [...byPrinting.values()].sort((a, b) => b.total - a.total || a.cardName.localeCompare(b.cardName))
})
</script>

<template>
  <div class="mx-auto w-full max-w-3xl space-y-4 p-4">
    <div class="flex items-center justify-between gap-3">
      <USelect
        v-model="selectedSetId"
        :items="setOptions"
        placeholder="Choose a set"
        class="w-72"
      />
      <span class="text-xs text-muted">graded copies only — raw population is unknown</span>
    </div>

    <div
      v-if="pending"
      class="rounded-lg bg-elevated p-4 text-sm text-muted"
    >
      Counting…
    </div>
    <div
      v-else-if="!groups.length"
      class="rounded-lg bg-elevated p-4 text-sm text-muted"
    >
      No graded copies in this set yet. The first slab starts the report.
    </div>

    <div
      v-for="group in groups"
      :key="group.printingId"
      class="rounded-lg bg-elevated p-3"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="min-w-0">
          <span class="font-medium text-highlighted">{{ group.cardName }}</span>
          <span class="ml-2 text-xs text-muted">{{ group.finishLabel }}</span>
          <UBadge
            v-if="group.rarity"
            color="neutral"
            variant="subtle"
            size="sm"
            class="ml-2"
          >
            {{ group.rarity }}
          </UBadge>
        </div>
        <span class="shrink-0 font-mono text-xs tabular-nums text-muted">pop {{ group.total }}</span>
      </div>
      <div class="grid gap-1">
        <div
          v-for="line in group.lines"
          :key="`${line.service}-${line.grade}-${line.designation ?? ''}`"
          class="flex items-center justify-between rounded bg-default/60 px-2.5 py-1 text-sm"
        >
          <span class="text-muted">
            <b class="font-medium text-highlighted">{{ line.service }}</b>
            {{ line.grade }}<template v-if="line.designation"> · {{ line.designation }}</template>
          </span>
          <span class="font-mono tabular-nums text-highlighted">{{ line.count }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
