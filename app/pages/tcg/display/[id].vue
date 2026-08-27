<script setup lang="ts">
import type { DisplayView, DisplaySlotView, DisplayCandidate } from '~~/server/utils/tcg/display'
import type { LightboxCard } from '~/components/tcg/TcgCardLightbox.client.vue'
import { legacySetOf } from '#shared/utils/tcg/legacy'
import { TCG_DISPLAY } from '#shared/utils/tcg/display'

/* One binder or shelf (§10.5). Anyone can browse it; the owner can arrange.
 * The layout is edited locally and saved whole — pockets are the unit of
 * expression, so an explicit Save beats surprise autosaves.
 */
const route = useRoute()
const { user } = useAuth()
const toast = useToast()
const displayId = route.params.id as string

const { data: display, refresh } = await useAsyncData(`tcg-display-${displayId}`, () => apiFetch<DisplayView>(`/api/tcg/displays/${displayId}`))
const isOwner = computed(() => display.value?.ownerId === user.value?.id)
const unit = computed(() => display.value?.kind === 'binder' ? TCG_DISPLAY.binder.slotsPerPage : TCG_DISPLAY.shelf.slotsPerRow)
const maxCapacity = computed(() => display.value?.kind === 'binder' ? TCG_DISPLAY.binder.maxCapacity : TCG_DISPLAY.shelf.maxCapacity)

// Local layout: position → slot view (edit mutates this, save posts it).
const layout = ref<(DisplaySlotView | null)[]>([])
const capacity = ref(0)
const name = ref('')
watch(display, (view) => {
  if (!view) return
  capacity.value = view.capacity
  name.value = view.name
  const next: (DisplaySlotView | null)[] = Array.from({ length: view.capacity }, () => null)
  for (const slot of view.slots) next[slot.position] = slot
  layout.value = next
}, { immediate: true })

const page = ref(0)
const pageCount = computed(() => Math.max(1, Math.ceil(capacity.value / unit.value)))
const pageSlots = computed(() => {
  if (display.value?.kind !== 'binder') return layout.value
  const start = page.value * unit.value
  return layout.value.slice(start, start + unit.value)
})
function positionOf(indexOnPage: number) {
  return display.value?.kind === 'binder' ? page.value * unit.value + indexOnPage : indexOnPage
}

function thumbProps(slot: DisplaySlotView) {
  if (slot.bundle) return { bundle: slot.bundle }
  const legacySet = legacySetOf(slot.plaatjesCardId)
  return legacySet && slot.assetNumber ? { legacySet, assetNumber: slot.assetNumber } : null
}

// ── Editing ────────────────────────────────────────────────────────────────
const editing = ref(false)
const dirty = ref(false)
const pickerOpen = ref(false)
const pickerPosition = ref(0)
const pickerSearch = ref('')
const candidates = ref<DisplayCandidate[] | null>(null)

async function openPicker(position: number) {
  pickerPosition.value = position
  pickerSearch.value = ''
  pickerOpen.value = true
  if (!candidates.value && display.value) {
    try {
      candidates.value = await apiFetch<DisplayCandidate[]>('/api/tcg/displays/candidates', {
        query: { kind: display.value.kind }
      })
    } catch {
      candidates.value = []
    }
  }
}

const placedIds = computed(() => new Set(layout.value.filter(Boolean).map(slot => slot!.copyId)))
const pickerItems = computed(() => {
  const needle = pickerSearch.value.trim().toLowerCase()
  return (candidates.value ?? [])
    .filter(candidate => !placedIds.value.has(candidate.copyId))
    .filter(candidate => candidate.displayId === null || candidate.displayId === displayId)
    .filter(candidate => !needle || candidate.cardName.toLowerCase().includes(needle))
    .slice(0, 60)
})

function place(candidate: DisplayCandidate) {
  layout.value[pickerPosition.value] = {
    position: pickerPosition.value,
    copyId: candidate.copyId,
    cardName: candidate.cardName,
    serial: candidate.serial,
    finish: candidate.finish,
    pattern: candidate.pattern,
    printRunLabel: '1st',
    bundle: candidate.bundle,
    plaatjesCardId: candidate.plaatjesCardId,
    assetNumber: candidate.assetNumber,
    maskKind: null,
    foilEffect: null,
    rarity: null,
    cardNumber: null,
    setTotal: null,
    setName: candidate.setName,
    setCode: null,
    releaseDate: null,
    gradeService: candidate.gradeService,
    grade: candidate.grade,
    gradeDesignation: null,
    gradePayload: null
  }
  dirty.value = true
  pickerOpen.value = false
}

function clearPocket(position: number) {
  layout.value[position] = null
  dirty.value = true
}

function addPage() {
  if (capacity.value + unit.value > maxCapacity.value) return
  capacity.value += unit.value
  layout.value.push(...Array.from({ length: unit.value }, () => null))
  dirty.value = true
  if (display.value?.kind === 'binder') page.value = pageCount.value - 1
}

const saving = ref(false)
async function save() {
  if (saving.value) return
  saving.value = true
  try {
    await apiFetch(`/api/tcg/displays/${displayId}`, {
      method: 'PUT',
      body: {
        name: name.value,
        capacity: capacity.value,
        slots: layout.value.map(slot => slot?.copyId ?? null)
      }
    })
    toast.add({ title: 'Display saved', color: 'success' })
    dirty.value = false
    editing.value = false
    await refresh()
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not save'), color: 'error' })
  } finally {
    saving.value = false
  }
}

// ── Inspection ─────────────────────────────────────────────────────────────
const lightboxCard = ref<LightboxCard | null>(null)
function inspect(slot: DisplaySlotView, event: MouseEvent) {
  if (editing.value) return
  if (!thumbProps(slot)) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  lightboxCard.value = {
    origin: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    bundle: slot.bundle,
    assetNumber: slot.assetNumber,
    maskKind: slot.maskKind,
    foilEffect: slot.foilEffect,
    legacySet: slot.bundle ? null : legacySetOf(slot.plaatjesCardId),
    holo: slot.finish === 'holo',
    name: slot.cardName,
    rarity: slot.rarity,
    pattern: slot.pattern,
    printRunLabel: slot.printRunLabel,
    finishLabel: finishLabel(slot.finish, slot.pattern),
    serial: slot.serial,
    slabMeta: {
      number: slot.cardNumber,
      setTotal: slot.setTotal,
      setName: slot.setName,
      setCode: slot.setCode,
      releaseDate: slot.releaseDate
    },
    // The full public grade report renders the 3D slab for ANY viewer (§10.4).
    grade: slot.gradePayload,
    // Wear inspection is the owner's privilege; visitors get the clean render.
    copyId: isOwner.value ? slot.copyId : null
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-5 p-4">
    <div
      v-if="display"
      class="flex flex-wrap items-center justify-between gap-3"
    >
      <div class="flex items-center gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          to="/tcg/display"
        />
        <template v-if="editing">
          <UInput
            v-model="name"
            size="sm"
            class="w-56"
            :maxlength="TCG_DISPLAY.nameMaxLength"
            @update:model-value="dirty = true"
          />
        </template>
        <template v-else>
          <h1 class="text-base font-semibold text-highlighted">{{ display.name }}</h1>
        </template>
        <UBadge
          color="neutral"
          variant="subtle"
          size="sm"
        >
          {{ display.kind === 'binder' ? 'Binder' : 'Shelf' }} · {{ display.ownerName }}
        </UBadge>
      </div>
      <div
        v-if="isOwner"
        class="flex items-center gap-2"
      >
        <UButton
          v-if="editing && capacity + unit <= maxCapacity"
          color="neutral"
          variant="subtle"
          size="sm"
          icon="i-lucide-plus"
          :label="display.kind === 'binder' ? 'Add page' : 'Add row'"
          @click="addPage"
        />
        <UButton
          v-if="editing"
          size="sm"
          :loading="saving"
          :disabled="!dirty"
          label="Save"
          @click="save"
        />
        <UButton
          :color="editing ? 'neutral' : 'primary'"
          :variant="editing ? 'ghost' : 'subtle'"
          size="sm"
          :icon="editing ? 'i-lucide-x' : 'i-lucide-pencil'"
          :label="editing ? 'Done' : 'Arrange'"
          @click="editing = !editing"
        />
      </div>
    </div>

    <template v-if="display">
      <!-- Binder: one page of nine at a time, like the real object. -->
      <div
        v-if="display.kind === 'binder'"
        class="mx-auto max-w-xl"
      >
        <div class="rounded-xl border border-default bg-elevated/60 p-4">
          <div class="grid grid-cols-3 gap-3">
            <div
              v-for="(slot, index) in pageSlots"
              :key="positionOf(index)"
              class="relative"
              :class="(slot || editing) && 'cursor-pointer'"
              @click="slot ? (editing ? clearPocket(positionOf(index)) : inspect(slot, $event)) : (editing && openPicker(positionOf(index)))"
            >
              <template v-if="slot && thumbProps(slot)">
                <TcgCardThumb v-bind="thumbProps(slot)!" />
                <div
                  v-if="editing"
                  class="absolute inset-0 flex items-center justify-center rounded bg-black/50 opacity-0 transition hover:opacity-100"
                >
                  <UIcon
                    name="i-lucide-x"
                    class="size-6 text-white"
                  />
                </div>
              </template>
              <div
                v-else
                class="flex aspect-[0.718] w-full items-center justify-center rounded border-2 border-dashed border-default transition"
                :class="editing && 'hover:border-primary'"
              >
                <UIcon
                  v-if="editing"
                  name="i-lucide-plus"
                  class="size-5 text-dimmed"
                />
              </div>
            </div>
          </div>
        </div>
        <div class="mt-3 flex items-center justify-center gap-3">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-chevron-left"
            :disabled="page === 0"
            @click="page--"
          />
          <span class="text-xs tabular-nums text-muted">page {{ page + 1 }}/{{ pageCount }}</span>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-chevron-right"
            :disabled="page >= pageCount - 1"
            @click="page++"
          />
        </div>
      </div>

      <!-- Shelf: the wall of slabs, rows of six. -->
      <div
        v-else
        class="rounded-xl border border-default bg-elevated/60 p-4"
      >
        <div class="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <div
            v-for="(slot, index) in layout"
            :key="index"
            class="relative"
            :class="(slot || editing) && 'cursor-pointer'"
            @click="slot ? (editing ? clearPocket(index) : inspect(slot, $event)) : (editing && openPicker(index))"
          >
            <template v-if="slot && thumbProps(slot)">
              <div class="rounded-lg bg-neutral-900/80 p-1.5 pb-0.5 ring-1 ring-neutral-700">
                <TcgCardThumb v-bind="thumbProps(slot)!" />
                <p class="truncate py-1 text-center font-mono text-[10px] text-neutral-300">
                  {{ slot.gradeService }} {{ slot.grade }}
                </p>
              </div>
              <div
                v-if="editing"
                class="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition hover:opacity-100"
              >
                <UIcon
                  name="i-lucide-x"
                  class="size-6 text-white"
                />
              </div>
            </template>
            <div
              v-else
              class="flex aspect-[0.65] w-full items-center justify-center rounded-lg border-2 border-dashed border-default transition"
              :class="editing && 'hover:border-primary'"
            >
              <UIcon
                v-if="editing"
                name="i-lucide-plus"
                class="size-5 text-dimmed"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <UModal v-model:open="pickerOpen">
      <template #content>
        <div class="flex max-h-[70vh] flex-col gap-3 p-5">
          <UInput
            v-model="pickerSearch"
            icon="i-lucide-search"
            :placeholder="display?.kind === 'binder' ? 'Search your raw cards…' : 'Search your slabs…'"
          />
          <div class="grid grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
            <div
              v-for="candidate in pickerItems"
              :key="candidate.copyId"
              class="cursor-pointer rounded p-1 transition hover:bg-elevated"
              @click="place(candidate)"
            >
              <TcgCardThumb
                v-if="candidate.bundle"
                :bundle="candidate.bundle"
              />
              <TcgCardThumb
                v-else-if="legacySetOf(candidate.plaatjesCardId) && candidate.assetNumber"
                :legacy-set="legacySetOf(candidate.plaatjesCardId)!"
                :asset-number="candidate.assetNumber"
              />
              <p class="mt-1 truncate text-center text-[10px] text-muted">
                {{ candidate.cardName }}
                <template v-if="candidate.grade"> · {{ candidate.gradeService }} {{ candidate.grade }}</template>
              </p>
            </div>
          </div>
          <p
            v-if="candidates && pickerItems.length === 0"
            class="text-sm text-muted"
          >
            Nothing left to place.
          </p>
        </div>
      </template>
    </UModal>

    <TcgCardLightbox
      :card="lightboxCard"
      @close="lightboxCard = null"
      @changed="refresh"
    />
  </div>
</template>
