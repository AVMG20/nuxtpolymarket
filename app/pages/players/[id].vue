<script setup lang="ts">
import type { DisplaySummary } from '~~/server/utils/tcg/display'
import type { GalleryPayload, GalleryPrinting, GallerySet } from '#shared/types/tcg'
import type { LightboxCard } from '~/components/tcg/TcgCardLightbox.client.vue'
import { legacySetOf } from '#shared/utils/tcg/legacy'

/* A public player profile (§10.5): who they are, what they've collected, and
 * the binders and shelves they've put together. In a seven-player game there
 * is no privacy tier — every logged-in player can browse every collection.
 */
const route = useRoute()
const playerId = route.params.id as string

const [{ data: player }, { data: gallery }, { data: displays }] = await Promise.all([
  useAsyncData(`player-${playerId}`, () => apiFetch<{ id: string, name: string, emblem: string | null }>(`/api/players/${playerId}`)),
  useAsyncData(`player-gallery-${playerId}`, () => apiFetch<GalleryPayload>('/api/tcg/collection/gallery', { query: { userId: playerId } })),
  useAsyncData(`player-displays-${playerId}`, () => apiFetch<DisplaySummary[]>('/api/tcg/displays', { query: { userId: playerId } }))
])

const totals = computed(() => {
  const sets = gallery.value ?? []
  return {
    cards: sets.reduce((sum, set) => sum + set.printings.reduce((n, p) => n + p.owned, 0), 0),
    sets: sets.length,
    slabs: sets.reduce((sum, set) => sum + set.printings.reduce((n, p) => n + p.slabbed, 0), 0)
  }
})

/** Their best graded cards, for the trophy strip. */
const topSlabs = computed(() =>
  (gallery.value ?? [])
    .flatMap(set => set.printings.filter(p => p.topGrade).map(printing => ({ printing, set })))
    .sort((a, b) => Number(b.printing.topGrade!.grade) - Number(a.printing.topGrade!.grade))
    .slice(0, 6))

// The trophy strip opens the real thing: the 3D slab viewer, grade report
// and all — reports are public (§10.4).
const lightboxCard = ref<LightboxCard | null>(null)
function inspectSlab(printing: GalleryPrinting, set: GallerySet, event: MouseEvent) {
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
    grade: printing.topGrade
  }
}

function thumbProps(printing: { bundle: string | null, plaatjesCardId: string, assetNumber: string | null }) {
  if (printing.bundle) return { bundle: printing.bundle }
  const legacySet = legacySetOf(printing.plaatjesCardId)
  return legacySet && printing.assetNumber ? { legacySet, assetNumber: printing.assetNumber } : null
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-6 p-4">
    <div
      v-if="player"
      class="flex items-center gap-4"
    >
      <ProfileEmblem
        :emblem="player.emblem"
        :name="player.name"
        class="size-16 text-2xl"
      />
      <div>
        <h1 class="text-xl font-semibold text-highlighted">{{ player.name }}</h1>
        <p class="text-sm text-muted">
          <b class="tabular-nums text-highlighted">{{ formatNumber(totals.cards, false) }}</b> cards across
          <b class="tabular-nums text-highlighted">{{ totals.sets }}</b> sets ·
          <b class="tabular-nums text-highlighted">{{ totals.slabs }}</b> slabs
        </p>
      </div>
    </div>

    <section v-if="topSlabs.length">
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Best slabs</h2>
      <div class="grid grid-cols-3 gap-3 sm:grid-cols-6">
        <div
          v-for="{ printing, set } in topSlabs"
          :key="printing.id"
          class="relative cursor-pointer transition hover:scale-[1.02]"
          @click="inspectSlab(printing, set, $event)"
        >
          <template v-if="thumbProps(printing)">
            <TcgCardThumb v-bind="thumbProps(printing)!" />
          </template>
          <div
            v-else
            class="aspect-[0.718] w-full rounded bg-elevated"
          />
          <UBadge
            color="secondary"
            variant="solid"
            size="sm"
            class="absolute -left-1.5 -top-1.5"
          >
            {{ printing.topGrade!.service }} {{ printing.topGrade!.grade }}
          </UBadge>
        </div>
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Displays</h2>
      <div
        v-if="displays?.length"
        class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
      >
        <NuxtLink
          v-for="display in displays"
          :key="display.id"
          :to="`/tcg/display/${display.id}`"
          class="block cursor-pointer rounded-lg bg-elevated p-3 transition hover:ring-1 hover:ring-primary"
        >
          <div class="mx-auto w-24">
            <template v-if="display.cover && thumbProps(display.cover)">
              <TcgCardThumb v-bind="thumbProps(display.cover)!" />
            </template>
            <div
              v-else
              class="flex aspect-[0.718] w-full items-center justify-center rounded border border-dashed border-default"
            >
              <UIcon
                :name="display.kind === 'binder' ? 'i-lucide-book-open' : 'i-lucide-gallery-thumbnails'"
                class="size-6 text-dimmed"
              />
            </div>
          </div>
          <p class="mt-2 truncate text-center text-sm font-medium text-highlighted">{{ display.name }}</p>
          <p class="text-center text-xs tabular-nums text-muted">{{ display.kind }} · {{ display.filled }}/{{ display.capacity }}</p>
        </NuxtLink>
      </div>
      <div
        v-else
        class="rounded-lg bg-elevated/50 px-4 py-3 text-sm text-muted"
      >
        Nothing on display yet.
      </div>
    </section>

    <section v-if="gallery?.length">
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Sets</h2>
      <div class="space-y-1.5">
        <div
          v-for="set in gallery"
          :key="set.id"
          class="flex items-center justify-between rounded bg-elevated/50 px-3 py-1.5 text-sm"
        >
          <span class="text-highlighted">{{ set.name }}</span>
          <span class="tabular-nums text-muted">{{ set.printings.length }}/{{ set.printingsTotal }} printings</span>
        </div>
      </div>
    </section>

    <TcgCardLightbox
      :card="lightboxCard"
      @close="lightboxCard = null"
    />
  </div>
</template>
