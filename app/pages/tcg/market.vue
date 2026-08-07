<script setup lang="ts">
import type { TcgListingSummary } from '#shared/types/tcg'
import type { LightboxCard } from '~/components/tcg/TcgCardLightbox.client.vue'
import { legacySetOf } from '#shared/utils/tcg/legacy'

/* The market (§7.1): fixed-price listings in Coins, sellers named, every raw
 * listing fully inspectable before purchase. 5% of every sale burns.
 */
const { sets } = useTcg()
const { user } = useAuth()

const selectedSetId = ref<string | undefined>(undefined)
const setOptions = computed(() =>
  sets.value.map(s => ({ label: `${s.name} (${s.code})`, value: s.id })))

const { data: listings, refresh } = useFetch<TcgListingSummary[]>('/api/tcg/market/listings', {
  key: 'tcg-market-listings',
  query: { setId: selectedSetId },
  immediate: false,
  watch: [selectedSetId]
})

// AFTER useFetch is created, so the watched query ref change actually
// triggers the fetch (same trap as collection.vue).
onMounted(() => {
  watch(sets, (list) => {
    if (selectedSetId.value || !list.length) return
    const newest = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!
    selectedSetId.value = newest.id
  }, { immediate: true })
})

const mine = computed(() => (listings.value ?? []).filter(l => l.sellerId === user.value?.id))
const others = computed(() => (listings.value ?? []).filter(l => l.sellerId !== user.value?.id))
const currentSet = computed(() => sets.value.find(s => s.id === selectedSetId.value) ?? null)

const lightboxCard = ref<LightboxCard | null>(null)

function openListing(listing: TcgListingSummary, event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  lightboxCard.value = {
    origin: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    bundle: listing.render.bundle,
    assetNumber: listing.render.assetNumber,
    maskKind: listing.render.maskKind,
    foilEffect: listing.render.foilEffect,
    pattern: listing.render.pattern,
    printRunLabel: listing.render.printRunLabel,
    finishLabel: finishLabel(listing.render.finish, listing.render.pattern),
    legacySet: listing.render.bundle ? null : legacySetOf(listing.render.plaatjesCardId),
    holo: listing.render.finish === 'holo',
    name: listing.card.name,
    rarity: listing.card.rarity,
    serial: listing.serial,
    copyId: listing.copyId,
    printingId: listing.printingId,
    slabMeta: {
      number: listing.card.number,
      setTotal: listing.card.setTotal,
      setName: listing.card.setName,
      setCode: listing.card.setCode,
      releaseDate: listing.card.releaseDate
    },
    listing: {
      id: listing.id,
      price: listing.price,
      sellerName: listing.sellerName,
      note: listing.note,
      mine: listing.sellerId === user.value?.id,
      grade: listing.grade
    }
  }
}

async function closeLightbox() {
  lightboxCard.value = null
  // A buy or cancel may have happened inside — refresh cheaply either way.
  await refresh()
}

function thumbSrc(listing: TcgListingSummary): string {
  const base = (useRuntimeConfig().public as { pokemonApiBase?: string }).pokemonApiBase
    ?? 'http://127.0.0.1:8080'
  return listing.render.bundle
    ? `${base}/images/cards/${listing.render.bundle}.png`
    : `${base}/images/legacy/${legacySetOf(listing.render.plaatjesCardId)}/${listing.render.assetNumber}.png`
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-5 p-4">
    <div class="flex items-center justify-between gap-3">
      <USelect
        v-model="selectedSetId"
        :items="setOptions"
        placeholder="Choose a set"
        class="w-72"
      />
      <span class="text-xs text-muted">5% of every sale is burned · raw listings: inspect before you buy</span>
    </div>

    <section v-if="mine.length">
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Your listings</h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <button
          v-for="listing in mine"
          :key="listing.id"
          class="cursor-pointer rounded-lg bg-elevated p-2.5 text-left transition hover:ring-1 hover:ring-primary"
          @click="openListing(listing, $event)"
        >
          <img
            :src="thumbSrc(listing)"
            :alt="listing.card.name"
            class="aspect-[0.718] w-full rounded object-cover"
          >
          <div class="mt-1.5 truncate text-sm font-medium text-highlighted">{{ listing.card.name }}</div>
          <div class="flex items-center justify-between text-xs text-muted">
            <span class="font-mono tabular-nums text-highlighted">{{ formatNumber(listing.price) }}</span>
            <UBadge
              color="neutral"
              variant="subtle"
              size="sm"
            >yours</UBadge>
          </div>
        </button>
      </div>
    </section>

    <section>
      <h2
        v-if="mine.length"
        class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted"
      >For sale</h2>
      <div
        v-if="others.length"
        class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
      >
        <button
          v-for="listing in others"
          :key="listing.id"
          class="cursor-pointer rounded-lg bg-elevated p-2.5 text-left transition hover:ring-1 hover:ring-primary"
          @click="openListing(listing, $event)"
        >
          <img
            :src="thumbSrc(listing)"
            :alt="listing.card.name"
            class="aspect-[0.718] w-full rounded object-cover"
          >
          <div class="mt-1.5 truncate text-sm font-medium text-highlighted">{{ listing.card.name }}</div>
          <div class="truncate text-xs text-muted">
            {{ finishLabel(listing.render.finish, listing.render.pattern) }}<template v-if="listing.render.printRunLabel && listing.render.printRunLabel !== '1st'"> · {{ listing.render.printRunLabel }}</template> · {{ listing.sellerName }}
          </div>
          <div class="mt-0.5 flex items-center justify-between">
            <span class="font-mono text-sm tabular-nums text-highlighted">{{ formatNumber(listing.price) }}</span>
            <UBadge
              v-if="listing.grade"
              color="primary"
              variant="subtle"
              size="sm"
            >
              {{ listing.grade.service }} {{ listing.grade.grade }}
            </UBadge>
            <UBadge
              v-else
              color="neutral"
              variant="subtle"
              size="sm"
            >raw</UBadge>
          </div>
        </button>
      </div>
      <p
        v-else
        class="rounded-lg bg-elevated p-4 text-sm text-muted"
      >
        Nothing for sale in {{ currentSet?.name ?? 'this set' }} right now. List a copy from your collection.
      </p>
    </section>

    <TcgCardLightbox
      :card="lightboxCard"
      @close="closeLightbox"
      @changed="refresh"
    />
  </div>
</template>
