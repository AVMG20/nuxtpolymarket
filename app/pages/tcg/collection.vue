<script setup lang="ts">
import type { GalleryPayload, GalleryPrinting, GallerySet, TcgRealPrice } from '#shared/types/tcg'
import { legacySetOf } from '#shared/utils/tcg/legacy'
import { sortPrintings, COLLECTION_SORT_MODES } from '#shared/utils/tcg/collection-sort'
import type { CollectionSortMode, CollectionSortDirection } from '#shared/utils/tcg/collection-sort'
import type { LightboxCard } from '~/components/tcg/TcgCardLightbox.client.vue'

/* The collection as a gallery (§10): every set at once, owned cards only,
 * images first. The per-set completion view with its grey holes lives on as
 * the secondary Progress view at /tcg/progress.
 */
const { data: gallery, pending, refresh } = useAsyncData('tcg-gallery', () => apiFetch<GalleryPayload>('/api/tcg/collection/gallery'))

const search = ref('')

// ── Sorting ────────────────────────────────────────────────────────────────
// The server hands sets back in card-number order, which stays the default;
// everything else re-orders on the client from that same list.
const sortMode = ref<CollectionSortMode>('number')
const sortDirection = ref<CollectionSortDirection>('asc')

/**
 * Real-world prices, fetched the first time the value sort is picked and kept
 * for the rest of the visit. One sidecar request per distinct card lives
 * behind this, so it is never part of the gallery load itself.
 */
const prices = ref<Record<string, TcgRealPrice | null> | null>(null)
const pricesPending = ref(false)

async function loadPrices() {
  if (prices.value || pricesPending.value) return
  pricesPending.value = true
  try {
    const res = await apiFetch<{ prices: Record<string, TcgRealPrice | null> }>('/api/tcg/collection/prices')
    prices.value = res.prices
  } catch {
    // Degrade like every other price read: no prices means the value sort
    // leaves the tiles in card order rather than erroring at the player.
    prices.value = {}
  } finally {
    pricesPending.value = false
  }
}

watch(sortMode, (mode) => {
  if (mode === 'value') loadPrices()
})

/** EUR is what the sidecar sorts on; USD is the fallback for US-only cards. */
function priceOf(printing: GalleryPrinting): number | null {
  const price = prices.value?.[printing.id]
  return price?.eur ?? price?.usd ?? null
}

const visibleSets = computed<GallerySet[]>(() => {
  const needle = search.value.trim().toLowerCase()
  const sets = needle
    ? (gallery.value ?? [])
        .map(set => ({
          ...set,
          printings: set.printings.filter(printing => printing.cardName.toLowerCase().includes(needle))
        }))
        .filter(set => set.printings.length > 0)
    : (gallery.value ?? [])
  if (sortMode.value === 'number' && sortDirection.value === 'asc') return sets
  return sets.map(set => ({
    ...set,
    printings: sortPrintings(set.printings, sortMode.value, sortDirection.value, priceOf)
  }))
})

// ── Collapsing ─────────────────────────────────────────────────────────────
// Which sets are folded away, remembered per browser: a collection spanning a
// dozen sets is a lot of scrolling to redo on every visit.
const STORAGE_KEY = 'tcg-collection-collapsed'
const collapsed = ref<Set<string>>(new Set())

onMounted(() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) collapsed.value = new Set(JSON.parse(stored) as string[])
  } catch {
    // A private window or blocked storage just means nothing is remembered.
  }
})

function persistCollapsed() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed.value]))
  } catch {
    // Not worth telling anyone about — the fold still works this session.
  }
}

function toggleSet(setId: string) {
  const next = new Set(collapsed.value)
  if (next.has(setId)) next.delete(setId)
  else next.add(setId)
  collapsed.value = next
  persistCollapsed()
}

const allCollapsed = computed(() => visibleSets.value.length > 0
  && visibleSets.value.every(set => collapsed.value.has(set.id)))

function toggleAll() {
  collapsed.value = allCollapsed.value
    ? new Set()
    : new Set(visibleSets.value.map(set => set.id))
  persistCollapsed()
}

/** Cards the viewer owns in this set — the count worth seeing while folded. */
function ownedIn(set: GallerySet): number {
  return set.printings.reduce((sum, printing) => sum + printing.owned, 0)
}

const totals = computed(() => {
  const sets = gallery.value ?? []
  return {
    cards: sets.reduce((sum, set) => sum + set.printings.reduce((n, p) => n + p.owned, 0), 0),
    printings: sets.reduce((sum, set) => sum + set.printings.length, 0)
  }
})

/** Thumb props for a printing — legacy scans have no bundle. */
function thumbProps(printing: GalleryPrinting) {
  if (printing.bundle) return { bundle: printing.bundle }
  const legacySet = legacySetOf(printing.plaatjesCardId)
  return legacySet && printing.assetNumber
    ? { legacySet, assetNumber: printing.assetNumber }
    : null
}

const lightboxCard = ref<LightboxCard | null>(null)

function openLightbox(set: GallerySet, printing: GalleryPrinting, event: MouseEvent) {
  if (!thumbProps(printing)) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  lightboxCard.value = {
    origin: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    bundle: printing.bundle,
    assetNumber: printing.assetNumber,
    maskKind: printing.maskKind,
    foilEffect: printing.foilEffect,
    legacySet: printing.bundle ? null : legacySetOf(printing.plaatjesCardId),
    holo: printing.finish === 'holo',
    name: printing.cardName,
    rarity: printing.rarity,
    pattern: printing.pattern,
    printRunLabel: printing.printRunLabel,
    finishLabel: finishLabel(printing.finish, printing.pattern),
    slabMeta: {
      number: printing.cardNumber,
      setTotal: printing.setTotal,
      setName: set.name,
      setCode: set.code,
      releaseDate: set.releaseDate
    },
    printingId: printing.id,
    owned: printing.owned
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-6 p-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search your cards…"
        class="w-64"
      />
      <div class="flex flex-wrap items-center gap-3">
        <USelect
          v-model="sortMode"
          :items="COLLECTION_SORT_MODES"
          value-key="value"
          size="sm"
          class="w-44"
          icon="i-lucide-arrow-down-wide-narrow"
          :loading="pricesPending"
        />
        <UButton
          color="neutral"
          variant="subtle"
          size="sm"
          :icon="sortDirection === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'"
          :aria-label="sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'"
          @click="sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'"
        />
        <UButton
          v-if="visibleSets.length > 1"
          color="neutral"
          variant="ghost"
          size="sm"
          :icon="allCollapsed ? 'i-lucide-chevrons-up-down' : 'i-lucide-chevrons-down-up'"
          :label="allCollapsed ? 'Expand all' : 'Collapse all'"
          @click="toggleAll"
        />
        <span
          v-if="gallery"
          class="text-xs text-muted"
        >
          <b class="tabular-nums text-highlighted">{{ formatNumber(totals.cards, false) }}</b> cards ·
          <b class="tabular-nums text-highlighted">{{ totals.printings }}</b> printings
        </span>
        <UButton
          color="neutral"
          variant="subtle"
          size="sm"
          icon="i-lucide-goal"
          label="Progress"
          to="/tcg/progress"
        />
      </div>
    </div>

    <UCard v-if="pending && !gallery">
      <p class="text-sm text-muted">
        Loading collection…
      </p>
    </UCard>

    <UCard v-else-if="gallery && gallery.length === 0">
      <p class="text-sm text-muted">
        Nothing here yet — open a pack in the shop and your pulls will show up as a gallery.
      </p>
    </UCard>

    <section
      v-for="set in visibleSets"
      :key="set.id"
    >
      <button
        type="button"
        class="mb-3 flex w-full items-baseline justify-between gap-3 text-left"
        :aria-expanded="!collapsed.has(set.id)"
        @click="toggleSet(set.id)"
      >
        <h2 class="flex items-baseline gap-1.5 text-base font-semibold text-highlighted">
          <UIcon
            :name="collapsed.has(set.id) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
            class="size-4 self-center text-muted"
          />
          {{ set.name }}
          <span class="text-xs font-normal text-muted">{{ set.code }}</span>
        </h2>
        <span class="text-xs tabular-nums text-muted">
          <template v-if="collapsed.has(set.id)">{{ formatNumber(ownedIn(set), false) }} cards · </template>
          {{ set.printings.length }}/{{ set.printingsTotal }} printings
        </span>
      </button>
      <div
        v-if="!collapsed.has(set.id)"
        class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
      >
        <div
          v-for="printing in set.printings"
          :key="printing.id"
          :class="thumbProps(printing) && 'cursor-pointer transition hover:scale-[1.02]'"
          @click="openLightbox(set, printing, $event)"
        >
          <div class="relative">
            <template v-if="thumbProps(printing)">
              <TcgCardThumb v-bind="thumbProps(printing)!" />
            </template>
            <div
              v-else
              class="aspect-[0.718] w-full rounded bg-elevated"
            />
            <UBadge
              v-if="printing.owned > 1"
              color="primary"
              size="sm"
              class="absolute -right-1.5 -top-1.5 tabular-nums"
            >
              ×{{ printing.owned }}
            </UBadge>
            <UBadge
              v-if="printing.topGrade"
              color="secondary"
              variant="solid"
              size="sm"
              class="absolute -left-1.5 -top-1.5"
            >
              {{ printing.topGrade.service }} {{ printing.topGrade.grade }}
            </UBadge>
          </div>
          <p class="mt-1 truncate text-center text-[11px] text-muted">
            {{ printing.cardName }}
            <span class="text-dimmed">· {{ finishLabel(printing.finish, printing.pattern) }}</span>
          </p>
          <p
            v-if="sortMode === 'value' || sortMode === 'serial'"
            class="truncate text-center text-[11px] tabular-nums text-dimmed"
          >
            <template v-if="sortMode === 'value'">{{ priceOf(printing) !== null ? `€${priceOf(printing)!.toFixed(2)}` : '—' }}</template>
            <template v-else>{{ printing.serial ?? '—' }}</template>
          </p>
        </div>
      </div>
    </section>

    <TcgCardLightbox
      :card="lightboxCard"
      @close="lightboxCard = null"
      @changed="refresh"
    />
  </div>
</template>
