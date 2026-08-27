<script setup lang="ts">
import { multiplicities, validateWindow, autoLayout } from '#shared/utils/tcg/sheet-math'
import type { WindowViolation, TcgSheetRole, TcgSetDetailPayload, TcgAdminCard, TcgAdminPrinting } from '#shared/types/tcg'

const props = defineProps<{ detail: TcgSetDetailPayload }>()
const emit = defineEmits<{ refresh: [] }>()

const { call } = useTcgAdmin()

const readonly = computed(() => props.detail.set.status === 'committed')

// ── Sheet selection ───────────────────────────────────────────────
const selectedId = ref<string | null>(null)
const selected = computed(() => props.detail.sheets.find(s => s.id === selectedId.value) ?? null)

watch(() => props.detail.sheets, (sheets) => {
  if (!sheets.some(s => s.id === selectedId.value)) selectedId.value = sheets[0]?.id ?? null
}, { immediate: true })

// Violation count per saved sheet (server keeps saved layouts clean, but the
// list badge is the truth of what is stored, not an assumption).
const savedViolations = computed(() => {
  const counts = new Map<string, number>()
  for (const sheet of props.detail.sheets) {
    counts.set(sheet.id, validateWindow(sheet.layout, sheet.packSlots).length)
  }
  return counts
})

const referencedSheetIds = computed(() => {
  const ids = new Set<string>()
  for (const template of props.detail.templates) {
    for (const slot of template.slots) ids.add(slot.sheetId)
  }
  return ids
})

// ── New sheet form ────────────────────────────────────────────────
const newSheet = reactive({ name: '', role: 'base' as TcgSheetRole, packSlots: 1 })
const creating = ref(false)

async function createSheet () {
  if (!newSheet.name.trim() || creating.value) return
  creating.value = true
  try {
    const created = await call<{ id: string }>('/api/tcg/admin/sheets/save', {
      setId: props.detail.set.id,
      name: newSheet.name.trim(),
      role: newSheet.role,
      packSlots: newSheet.packSlots,
      layout: [],
      sortOrder: props.detail.sheets.length
    }, 'Sheet created')
    newSheet.name = ''
    newSheet.role = 'base'
    newSheet.packSlots = 1
    if (created?.id) selectedId.value = created.id
    emit('refresh')
  } catch {
    // toasted by useTcgAdmin
  } finally {
    creating.value = false
  }
}

// ── Draft state for the selected sheet ────────────────────────────
const draft = reactive({
  name: '',
  packSlots: 1,
  mults: {} as Record<string, number>
})
const serverViolations = ref<WindowViolation[] | null>(null)
const staleDropped = ref(0)

function loadDraft () {
  const sheet = selected.value
  serverViolations.value = null
  staleDropped.value = 0
  draft.name = sheet?.name ?? ''
  draft.packSlots = sheet?.packSlots ?? 1
  const mults: Record<string, number> = {}
  for (const printing of props.detail.printings) mults[printing.id] = 0
  if (sheet) {
    const known = new Set(props.detail.printings.map(p => p.id))
    for (const [id, m] of multiplicities(sheet.layout)) {
      if (known.has(id)) mults[id] = m
      else staleDropped.value += m
    }
  }
  draft.mults = mults
}

watch(selected, loadDraft, { immediate: true })

const dirty = computed(() => {
  const sheet = selected.value
  if (!sheet) return false
  if (draft.name.trim() !== sheet.name || draft.packSlots !== sheet.packSlots) return true
  const saved = multiplicities(sheet.layout)
  const current = Object.entries(draft.mults).filter(([, m]) => m > 0)
  if (current.length !== saved.size) return true
  return current.some(([id, m]) => saved.get(id) !== m)
})

// ── Live derived numbers (pure shared math, no server round-trip) ──
const entries = computed<[string, number][]>(() =>
  Object.entries(draft.mults).filter(([, m]) => m > 0))

const sheetSize = computed(() => entries.value.reduce((sum, [, m]) => sum + m, 0))

const layoutPreview = computed<string[]>(() => {
  try {
    return autoLayout(entries.value, sheetSize.value)
  } catch {
    return []
  }
})

const violations = computed(() => validateWindow(layoutPreview.value, draft.packSlots))
const violatingIds = computed(() => new Set(violations.value.map(v => v.printingId)))

/** No printing may exceed floor(M/k) copies — the window-infeasibility cause. */
const multCap = computed(() => draft.packSlots > 1 ? Math.floor(sheetSize.value / draft.packSlots) : Infinity)
const overCap = computed(() => entries.value
  .filter(([, m]) => m > multCap.value)
  .map(([id, m]) => ({ id, m, label: printingLabel(id) })))

function oneInFor (m: number): number | null {
  if (m <= 0 || sheetSize.value === 0) return null
  return sheetSize.value / (draft.packSlots * m)
}

// ── Checklist rows grouped by rarity ──────────────────────────────
interface Row { printing: TcgAdminPrinting, card: TcgAdminCard }

const printingsByCard = computed(() => {
  const map = new Map<string, TcgAdminPrinting[]>()
  for (const printing of props.detail.printings) {
    const list = map.get(printing.cardId)
    if (list) list.push(printing)
    else map.set(printing.cardId, [printing])
  }
  return map
})

const printingIndex = computed(() => {
  const cards = new Map(props.detail.cards.map(c => [c.id, c]))
  const map = new Map<string, Row>()
  for (const printing of props.detail.printings) {
    const card = cards.get(printing.cardId)
    if (card) map.set(printing.id, { printing, card })
  }
  return map
})

function printingLabel (printingId: string): string {
  const row = printingIndex.value.get(printingId)
  if (!row) return printingId
  const suffix = row.printing.finish !== 'nonholo' || row.printing.pattern
    ? ` (${[row.printing.finish !== 'nonholo' ? row.printing.finish : null, row.printing.pattern].filter(Boolean).join(' ')})`
    : ''
  return `#${row.card.number} ${row.card.name}${suffix}`
}

const search = ref('')

const groups = computed(() => {
  const q = search.value.trim().toLowerCase()
  const out: { rarity: string, rows: Row[] }[] = []
  const byRarity = new Map<string, Row[]>()
  const sortedCards = [...props.detail.cards].sort((a, b) => a.sortOrder - b.sortOrder)
  for (const card of sortedCards) {
    if (q && !card.name.toLowerCase().includes(q) && !card.number.toLowerCase().includes(q)) continue
    for (const printing of printingsByCard.value.get(card.id) ?? []) {
      const rarity = card.rarity ?? 'Unknown'
      let rows = byRarity.get(rarity)
      if (!rows) {
        rows = []
        byRarity.set(rarity, rows)
        out.push({ rarity, rows })
      }
      rows.push({ printing, card })
    }
  }
  return out
})

/** Per-rarity totals over the full checklist, unaffected by the search filter. */
const groupTotals = computed(() => {
  const totals = new Map<string, number>()
  for (const [printingId, row] of printingIndex.value) {
    const rarity = row.card.rarity ?? 'Unknown'
    totals.set(rarity, (totals.get(rarity) ?? 0) + (draft.mults[printingId] ?? 0))
  }
  return totals
})

// ── Save / delete ─────────────────────────────────────────────────
const saving = ref(false)
const deleting = ref(false)

async function saveSheet () {
  const sheet = selected.value
  if (!sheet || saving.value) return
  saving.value = true
  try {
    await call('/api/tcg/admin/sheets/save', {
      setId: props.detail.set.id,
      sheetId: sheet.id,
      name: draft.name.trim() || sheet.name,
      role: sheet.role,
      packSlots: draft.packSlots,
      layout: layoutPreview.value,
      sortOrder: sheet.sortOrder
    }, 'Sheet saved')
    serverViolations.value = null
    emit('refresh')
  } catch (e) {
    const data = (e as { data?: { data?: { violations?: WindowViolation[] } } })?.data?.data
    serverViolations.value = data?.violations ?? null
  } finally {
    saving.value = false
  }
}

async function deleteSheet () {
  const sheet = selected.value
  if (!sheet || deleting.value) return
  deleting.value = true
  try {
    await call('/api/tcg/admin/sheets/delete', { sheetId: sheet.id }, 'Sheet deleted')
    emit('refresh')
  } catch {
    // 400 (template reference) is toasted by useTcgAdmin
  } finally {
    deleting.value = false
  }
}

const revert = loadDraft

const roleItems = [
  { label: 'base', value: 'base' },
  { label: 'god', value: 'god' }
]
</script>

<template>
  <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
    <!-- ── Sheet list ─────────────────────────────────────────── -->
    <aside class="w-full lg:w-64 shrink-0 space-y-3">
      <div class="rounded-lg border border-default divide-y divide-default overflow-hidden">
        <button
          v-for="sheet in detail.sheets"
          :key="sheet.id"
          type="button"
          class="w-full px-3 py-2 text-left transition-colors"
          :class="sheet.id === selectedId ? 'bg-elevated' : 'hover:bg-elevated/50'"
          @click="selectedId = sheet.id"
        >
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium truncate" :class="sheet.id === selectedId ? 'text-highlighted' : 'text-default'">{{ sheet.name }}</span>
            <UBadge :color="sheet.role === 'god' ? 'warning' : 'neutral'" variant="subtle" size="sm">{{ sheet.role }}</UBadge>
            <UBadge v-if="savedViolations.get(sheet.id)" color="error" variant="subtle" size="sm">
              {{ savedViolations.get(sheet.id) }}
            </UBadge>
          </div>
          <div class="mt-0.5 font-mono text-xs text-muted tabular-nums">
            M {{ sheet.layout.length }} · k {{ sheet.packSlots }}
          </div>
        </button>
        <p v-if="detail.sheets.length === 0" class="px-3 py-4 text-sm text-muted">
          No sheets yet. Create one below to start authoring.
        </p>
      </div>

      <div v-if="!readonly" class="rounded-lg border border-default p-3 space-y-2">
        <p class="text-xs font-medium uppercase tracking-wide text-muted">New sheet</p>
        <UInput v-model="newSheet.name" placeholder="Sheet name" size="sm" />
        <div class="flex gap-2">
          <USelect v-model="newSheet.role" :items="roleItems" size="sm" class="flex-1" />
          <UInputNumber v-model="newSheet.packSlots" :min="1" size="sm" class="w-24" aria-label="Pack slots (k)" />
        </div>
        <UButton
          size="sm"
          block
          icon="i-lucide-plus"
          :loading="creating"
          :disabled="!newSheet.name.trim()"
          @click="createSheet"
        >
          Create sheet
        </UButton>
      </div>
    </aside>

    <!-- ── Editor ─────────────────────────────────────────────── -->
    <div v-if="selected" class="min-w-0 flex-1 rounded-lg border border-default flex flex-col">
      <div class="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2">
        <UInput v-model="draft.name" size="sm" class="w-48" :disabled="readonly" aria-label="Sheet name" />
        <UBadge :color="selected.role === 'god' ? 'warning' : 'neutral'" variant="subtle">{{ selected.role }}</UBadge>
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-muted">k</span>
          <UInputNumber v-model="draft.packSlots" :min="1" size="sm" class="w-24" :disabled="readonly" aria-label="Pack slots (k)" />
        </div>
        <div class="ms-auto flex items-center gap-2">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="Filter cards"
            size="sm"
            class="w-44"
          />
          <UTooltip :text="referencedSheetIds.has(selected.id) ? 'Referenced by a pack template' : 'Delete sheet'">
            <UButton
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              size="sm"
              :loading="deleting"
              :disabled="readonly || referencedSheetIds.has(selected.id)"
              aria-label="Delete sheet"
              @click="deleteSheet"
            />
          </UTooltip>
        </div>
      </div>

      <UAlert
        v-if="readonly"
        icon="i-lucide-lock"
        color="neutral"
        variant="subtle"
        title="Set is committed — sheets are frozen and read-only."
        :ui="{ root: 'rounded-none border-b border-default' }"
      />
      <UAlert
        v-if="staleDropped > 0"
        icon="i-lucide-triangle-alert"
        color="warning"
        variant="subtle"
        :title="`${staleDropped} position${staleDropped === 1 ? '' : 's'} referenced printings that no longer exist (checklist was re-imported) — they were removed; save to persist.`"
        :ui="{ root: 'rounded-none border-b border-default' }"
      />
      <UAlert
        v-if="serverViolations"
        icon="i-lucide-server-crash"
        color="error"
        variant="subtle"
        title="Server rejected the layout"
        :description="`${serverViolations.length} window-constraint violation${serverViolations.length === 1 ? '' : 's'} at positions ${serverViolations.slice(0, 8).map(v => v.position).join(', ')}${serverViolations.length > 8 ? '…' : ''}`"
        :ui="{ root: 'rounded-none border-b border-default' }"
      />

      <div class="max-h-[65vh] overflow-y-auto">
        <table class="w-full border-collapse">
          <tbody v-for="group in groups" :key="group.rarity">
            <tr class="border-b border-default">
              <th colspan="3" class="sticky top-0 z-10 bg-elevated px-3 py-1.5 text-left">
                <span class="text-xs font-semibold uppercase tracking-wide text-default">{{ group.rarity }}</span>
              </th>
              <th colspan="2" class="sticky top-0 z-10 bg-elevated px-3 py-1.5 text-right font-mono text-xs font-normal text-muted tabular-nums whitespace-nowrap">
                Σ {{ groupTotals.get(group.rarity) ?? 0 }}<template v-if="sheetSize > 0 && (groupTotals.get(group.rarity) ?? 0) > 0">
                  · {{ (draft.packSlots * (groupTotals.get(group.rarity) ?? 0) / sheetSize).toFixed(2) }}/pack
                </template>
              </th>
            </tr>
            <TcgAdminSheetDesignerRow
              v-for="row in group.rows"
              :key="row.printing.id"
              v-model="draft.mults[row.printing.id]"
              :bundle="row.printing.bundle"
              :number="row.card.number"
              :name="row.card.name"
              :rarity="group.rarity"
              :finish="row.printing.finish"
              :pattern="row.printing.pattern"
              :one-in="oneInFor(draft.mults[row.printing.id] ?? 0)"
              :disabled="readonly"
              :invalid="violatingIds.has(row.printing.id) || (draft.mults[row.printing.id] ?? 0) > multCap"
            />
          </tbody>
        </table>
        <p v-if="groups.length === 0" class="px-3 py-6 text-sm text-muted">
          <template v-if="detail.cards.length === 0">No checklist imported yet — import one in the Checklist tab first.</template>
          <template v-else>No cards match "{{ search }}".</template>
        </p>
      </div>

      <!-- ── Instrument footer ──────────────────────────────── -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-default bg-elevated px-3 py-2">
        <div class="flex items-center gap-4 font-mono text-xs tabular-nums text-default">
          <span><span class="text-muted">M</span> {{ sheetSize }}</span>
          <span><span class="text-muted">k</span> {{ draft.packSlots }}</span>
          <span v-if="Number.isFinite(multCap)"><span class="text-muted">max/card</span> {{ multCap }}</span>
        </div>

        <div class="flex items-center gap-1.5 text-xs">
          <template v-if="sheetSize === 0">
            <UIcon name="i-lucide-circle-dashed" class="size-4 text-muted" />
            <span class="text-muted">Empty sheet</span>
          </template>
          <template v-else-if="violations.length === 0">
            <UIcon name="i-lucide-circle-check" class="size-4 text-success" />
            <span class="text-success">Window clean</span>
          </template>
          <template v-else>
            <UIcon name="i-lucide-circle-x" class="size-4 text-error" />
            <span class="text-error">
              {{ violations.length }} violation{{ violations.length === 1 ? '' : 's' }}<template v-if="overCap.length">
                — over ⌊M/k⌋: {{ overCap.slice(0, 3).map(o => `${o.label} ×${o.m}`).join(', ') }}<template v-if="overCap.length > 3"> +{{ overCap.length - 3 }} more</template>
              </template>
            </span>
          </template>
        </div>

        <div v-if="!readonly" class="ms-auto flex items-center gap-2">
          <span v-if="dirty" class="text-xs text-warning">Unsaved changes</span>
          <UButton
            v-if="dirty"
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-undo-2"
            @click="revert"
          >
            Revert
          </UButton>
          <UButton
            size="sm"
            icon="i-lucide-save"
            :loading="saving"
            :disabled="!dirty || violations.length > 0"
            @click="saveSheet"
          >
            Save sheet
          </UButton>
        </div>
      </div>
    </div>

    <div v-else class="flex-1 rounded-lg border border-dashed border-default px-6 py-16 text-center text-sm text-muted">
      Select a sheet on the left, or create one to start laying out printings.
    </div>
  </div>
</template>
