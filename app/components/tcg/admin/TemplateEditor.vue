<script setup lang="ts">
import type { TcgSetDetailPayload, TcgPackKind } from '#shared/types/tcg'

const props = defineProps<{ detail: TcgSetDetailPayload }>()
const emit = defineEmits<{ refresh: [] }>()

const { call } = useTcgAdmin()

const committed = computed(() => props.detail.set.status === 'committed')
const kinds = computed<TcgPackKind[]>(() =>
  props.detail.set.godPackOneIn != null ? ['base', 'god'] : ['base'])

const sheetById = computed(() => new Map(props.detail.sheets.map(s => [s.id, s])))

/** Editable slot rows per template kind — count is always derived from the sheet. */
const drafts = reactive<Record<TcgPackKind, { sheetId: string }[]>>({ base: [], god: [] })
const saving = reactive<Record<TcgPackKind, boolean>>({ base: false, god: false })

function savedSlots(kind: TcgPackKind): { sheetId: string }[] {
  const template = props.detail.templates.find(t => t.kind === kind)
  return (template?.slots ?? []).map(slot => ({ sheetId: slot.sheetId }))
}

function resetDrafts() {
  drafts.base = savedSlots('base')
  drafts.god = savedSlots('god')
}
watch(() => props.detail, resetDrafts, { immediate: true })

function sheetsFor(kind: TcgPackKind) {
  return props.detail.sheets.filter(s => s.role === kind)
}

function sheetOptions(kind: TcgPackKind) {
  return sheetsFor(kind).map(s => ({
    label: `${s.name} — ${s.packSlots} ${s.packSlots === 1 ? 'card' : 'cards'}`,
    value: s.id
  }))
}

function slotCount(sheetId: string): number | null {
  return sheetById.value.get(sheetId)?.packSlots ?? null
}

function cardsPerPack(kind: TcgPackKind): number {
  return drafts[kind].reduce((sum, slot) => sum + (slotCount(slot.sheetId) ?? 0), 0)
}

function isDirty(kind: TcgPackKind): boolean {
  const saved = savedSlots(kind)
  const draft = drafts[kind]
  return saved.length !== draft.length || saved.some((s, i) => s.sheetId !== draft[i]!.sheetId)
}

/** Client mirror of template/save validation — inline hints, never the only guard. */
function hints(kind: TcgPackKind): string[] {
  const out: string[] = []
  if (drafts[kind].length === 0) out.push('Add at least one slot so packs pull cards from a sheet.')
  if (drafts[kind].some(slot => !slot.sheetId)) out.push('Every slot needs a sheet.')
  if (sheetsFor(kind).length === 0) out.push(`No ${kind} sheets exist yet — create one in the Sheets tab.`)
  return out
}

function addSlot(kind: TcgPackKind) {
  drafts[kind].push({ sheetId: sheetsFor(kind)[0]?.id ?? '' })
}
function removeSlot(kind: TcgPackKind, index: number) {
  drafts[kind].splice(index, 1)
}
function moveSlot(kind: TcgPackKind, index: number, delta: -1 | 1) {
  const target = index + delta
  if (target < 0 || target >= drafts[kind].length) return
  const [slot] = drafts[kind].splice(index, 1)
  drafts[kind].splice(target, 0, slot!)
}

async function save(kind: TcgPackKind) {
  if (saving[kind]) return
  saving[kind] = true
  try {
    await call('/api/tcg/admin/template/save', {
      setId: props.detail.set.id,
      kind,
      slots: drafts[kind].map(slot => ({ sheetId: slot.sheetId, count: slotCount(slot.sheetId) }))
    }, `${kind === 'god' ? 'God' : 'Base'} template saved`)
    emit('refresh')
  } catch {
    // call() already toasted the error
  } finally {
    saving[kind] = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-if="committed"
      color="neutral"
      variant="subtle"
      icon="i-lucide-lock"
      title="Set committed"
      description="Pack templates are frozen. This view is read-only."
    />

    <div class="grid gap-4" :class="kinds.length > 1 ? 'lg:grid-cols-2' : 'max-w-2xl'">
      <div
        v-for="kind in kinds"
        :key="kind"
        class="rounded-lg border border-default"
      >
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-default bg-elevated/50 px-4 py-2.5">
          <div class="flex items-center gap-2">
            <UIcon :name="kind === 'god' ? 'i-lucide-sparkles' : 'i-lucide-package'" class="size-4 text-muted" />
            <span class="text-xs font-medium uppercase tracking-wider text-muted">
              {{ kind === 'god' ? 'God pack template' : 'Base pack template' }}
            </span>
          </div>
          <span class="text-xs text-muted">
            <span class="font-medium text-highlighted tabular-nums">{{ cardsPerPack(kind) }}</span> cards / pack
          </span>
        </div>

        <!-- Slot rows -->
        <div class="p-4">
          <p v-if="drafts[kind].length === 0" class="py-4 text-center text-sm text-dimmed">
            No slots yet — a pack of this kind would contain no cards.
          </p>
          <ol v-else class="space-y-2">
            <li
              v-for="(slot, index) in drafts[kind]"
              :key="index"
              class="flex items-center gap-2"
            >
              <span class="w-5 shrink-0 text-right font-mono text-xs text-dimmed tabular-nums">{{ index + 1 }}</span>
              <USelect
                v-model="slot.sheetId"
                :items="sheetOptions(kind)"
                :disabled="committed"
                placeholder="Choose a sheet"
                size="sm"
                class="min-w-0 flex-1"
              />
              <UBadge color="neutral" variant="subtle" size="sm" class="shrink-0 font-mono tabular-nums">
                ×{{ slotCount(slot.sheetId) ?? '?' }}
              </UBadge>
              <template v-if="!committed">
                <UButton
                  icon="i-lucide-chevron-up"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :disabled="index === 0"
                  aria-label="Move slot up"
                  @click="moveSlot(kind, index, -1)"
                />
                <UButton
                  icon="i-lucide-chevron-down"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :disabled="index === drafts[kind].length - 1"
                  aria-label="Move slot down"
                  @click="moveSlot(kind, index, 1)"
                />
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Remove slot"
                  @click="removeSlot(kind, index)"
                />
              </template>
            </li>
          </ol>

          <ul v-if="!committed && hints(kind).length" class="mt-3 space-y-1">
            <li v-for="hint in hints(kind)" :key="hint" class="flex items-start gap-1.5 text-xs text-warning">
              <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-3.5 shrink-0" />
              <span>{{ hint }}</span>
            </li>
          </ul>
        </div>

        <!-- Footer actions -->
        <div v-if="!committed" class="flex items-center justify-between border-t border-default px-4 py-2.5">
          <UButton
            label="Add slot"
            icon="i-lucide-plus"
            color="neutral"
            variant="subtle"
            size="sm"
            :disabled="sheetsFor(kind).length === 0"
            @click="addSlot(kind)"
          />
          <UButton
            label="Save template"
            icon="i-lucide-save"
            size="sm"
            :loading="saving[kind]"
            :disabled="!isDirty(kind) || drafts[kind].length === 0 || drafts[kind].some(slot => !slot.sheetId)"
            @click="save(kind)"
          />
        </div>
      </div>
    </div>

    <p v-if="detail.set.godPackOneIn == null" class="text-xs text-dimmed">
      God packs are disabled for this set — set a god-pack rate in the Print run tab to configure a god template.
    </p>
  </div>
</template>
