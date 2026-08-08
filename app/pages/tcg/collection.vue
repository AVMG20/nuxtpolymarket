<script setup lang="ts">
import type { GalleryPayload, GalleryPrinting, GallerySet } from '#shared/types/tcg'
import { legacySetOf } from '#shared/utils/tcg/legacy'
import type { LightboxCard } from '~/components/tcg/TcgCardLightbox.client.vue'

/* The collection as a gallery (§10): every set at once, owned cards only,
 * images first. The per-set completion view with its grey holes lives on as
 * the secondary Progress view at /tcg/progress.
 */
const { data: gallery, pending, refresh } = useAsyncData('tcg-gallery', () => apiFetch<GalleryPayload>('/api/tcg/collection/gallery'))

const search = ref('')

const visibleSets = computed<GallerySet[]>(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return gallery.value ?? []
  return (gallery.value ?? [])
    .map(set => ({
      ...set,
      printings: set.printings.filter(printing => printing.cardName.toLowerCase().includes(needle))
    }))
    .filter(set => set.printings.length > 0)
})

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
      <div class="flex items-center gap-4">
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
      <div class="mb-3 flex items-baseline justify-between gap-3">
        <h2 class="text-base font-semibold text-highlighted">
          {{ set.name }}
          <span class="ml-1.5 text-xs font-normal text-muted">{{ set.code }}</span>
        </h2>
        <span class="text-xs tabular-nums text-muted">{{ set.printings.length }}/{{ set.printingsTotal }} printings</span>
      </div>
      <div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
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
