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

const { data: rows, pending } = useAsyncData('tcg-pop-report', () => apiFetch<TcgPopReportRow[]>('/api/tcg/pop-report', { query: { setId: selectedSetId.value } }), {
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

// Any line opens its order book: pops double as the shopping catalogue.
const bookIdentity = ref<TcgPopReportRow | null>(null)
const bookOpen = ref(false)
function openBook(line: TcgPopReportRow) {
  bookIdentity.value = line
  bookOpen.value = true
}
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
        <button
          v-for="line in group.lines"
          :key="`${line.service}-${line.grade}-${line.designation ?? ''}`"
          type="button"
          class="flex w-full cursor-pointer items-center justify-between rounded bg-default/60 px-2.5 py-1 text-left text-sm hover:bg-default"
          @click="openBook(line)"
        >
          <span class="text-muted">
            <b class="font-medium text-highlighted">{{ line.service }}</b>
            {{ line.grade }}<template v-if="line.designation"> · {{ line.designation }}</template>
          </span>
          <span class="font-mono tabular-nums text-highlighted">{{ line.count }}</span>
        </button>
      </div>
    </div>

    <UModal v-model:open="bookOpen">
      <template #content>
        <div class="flex flex-col gap-3 p-5">
          <div v-if="bookIdentity">
            <h3 class="text-base font-semibold text-highlighted">{{ bookIdentity.cardName }}</h3>
            <p class="mt-0.5 text-xs text-muted">
              {{ finishLabel(bookIdentity.finish, bookIdentity.pattern) }}
              · {{ bookIdentity.service }} {{ bookIdentity.grade }}<template v-if="bookIdentity.designation"> · {{ bookIdentity.designation }}</template>
            </p>
          </div>
          <TcgBookPanel
            v-if="bookIdentity"
            :printing-id="bookIdentity.printingId"
            :grade-service="bookIdentity.service"
            :grade="bookIdentity.grade"
            :grade-designation="bookIdentity.designation"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
