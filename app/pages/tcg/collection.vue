<script setup lang="ts">
import type { CollectionCard, CollectionPayload, CollectionPrinting } from '#shared/types/tcg'
import { legacySetOf } from '#shared/utils/tcg/legacy'
import type { LightboxCard } from '~/components/tcg/TcgCardLightbox.client.vue'

const { sets } = useTcg()

const selectedSetId = ref<string | undefined>(undefined)

const setOptions = computed(() =>
  sets.value.map(s => ({ label: `${s.name} (${s.code})`, value: s.id })))

const { data: collection, pending, refresh } = useFetch<CollectionPayload>('/api/tcg/collection', {
  key: 'tcg-collection',
  query: { setId: selectedSetId },
  immediate: false,
  watch: [selectedSetId]
})

// Default to the most recently created set once the list arrives — AFTER
// useFetch is created, so the watched query ref change actually triggers the
// fetch. Explicit max(createdAt) rather than list order, so the default
// doesn't silently depend on how the endpoint happens to sort.
onMounted(() => {
  watch(sets, (list) => {
    if (selectedSetId.value || !list.length) return
    const newest = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!
    selectedSetId.value = newest.id
  }, { immediate: true })
})

const stats = computed(() => collection.value?.stats ?? null)
const currentSet = computed(() => sets.value.find(s => s.id === selectedSetId.value) ?? null)

function pct(owned: number, total: number) {
  return total > 0 ? Math.round((owned / total) * 100) : 0
}

/** Thumb props for a printing — legacy scans have no bundle. */
function thumbProps(printing: CollectionPrinting) {
  if (printing.bundle) return { bundle: printing.bundle }
  const legacySet = legacySetOf(printing.plaatjesCardId)
  return legacySet && printing.assetNumber
    ? { legacySet, assetNumber: printing.assetNumber }
    : null
}

// Large single-card viewer. Unowned printings open in full colour too —
// inspecting what a printing looks like is fine; only the grid tile is dimmed.
const lightboxCard = ref<LightboxCard | null>(null)

function openLightbox(card: CollectionCard, printing: CollectionPrinting, event: MouseEvent) {
  if (!thumbProps(printing)) return // nothing renderable for this printing
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  lightboxCard.value = {
    origin: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    bundle: printing.bundle,
    assetNumber: printing.assetNumber,
    maskKind: printing.maskKind,
    foilEffect: printing.foilEffect,
    legacySet: printing.bundle ? null : legacySetOf(printing.plaatjesCardId),
    holo: printing.finish === 'holo',
    name: card.name,
    rarity: card.rarity,
    pattern: printing.pattern,
    printRunLabel: printing.printRunLabel,
    finishLabel: finishLabel(printing.finish, printing.pattern),
    // For the slab label when a graded copy of this printing is inspected.
    slabMeta: {
      number: card.number,
      setTotal: card.setTotal,
      setName: currentSet.value?.name ?? null,
      setCode: currentSet.value?.code ?? null,
      releaseDate: currentSet.value?.releaseDate ?? null
    },
    // Owned printings get the copy picker + wear inspection; unowned ones
    // stay a clean render of what the printing looks like.
    printingId: printing.id,
    owned: printing.owned
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-4 p-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <USelect
        v-model="selectedSetId"
        :items="setOptions"
        placeholder="Choose a set"
        class="min-w-56"
      />
      <div
        v-if="stats"
        class="flex flex-wrap items-center gap-6"
      >
        <div class="w-44">
          <div class="mb-1 flex justify-between text-xs text-muted">
            <span>Base set</span>
            <span class="tabular-nums">{{ stats.cardsOwnedAnyFinish }}/{{ stats.cardsTotal }}</span>
          </div>
          <UProgress
            :model-value="pct(stats.cardsOwnedAnyFinish, stats.cardsTotal)"
            color="primary"
            size="sm"
          />
        </div>
        <div class="w-44">
          <div class="mb-1 flex justify-between text-xs text-muted">
            <span>Master set</span>
            <span class="tabular-nums">{{ stats.printingsOwned }}/{{ stats.printingsTotal }}</span>
          </div>
          <UProgress
            :model-value="pct(stats.printingsOwned, stats.printingsTotal)"
            color="secondary"
            size="sm"
          />
        </div>
      </div>
    </div>

    <UCard v-if="pending && !collection">
      <p class="text-sm text-muted">
        Loading collection…
      </p>
    </UCard>

    <div
      v-else-if="collection"
      class="space-y-2"
    >
      <UCard
        v-for="card in collection.cards"
        :key="card.id"
      >
        <div class="flex flex-wrap items-center gap-4">
          <div class="w-44 shrink-0">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ card.name }}
            </p>
            <p class="text-xs tabular-nums text-muted">
              {{ card.number }}<span v-if="card.setTotal">/{{ card.setTotal }}</span>
            </p>
            <UBadge
              v-if="card.rarity"
              :color="rarityColor(card.rarity)"
              variant="subtle"
              size="sm"
              class="mt-1"
            >
              {{ card.rarity }}
            </UBadge>
          </div>

          <div class="flex flex-1 flex-wrap gap-3">
            <div
              v-for="printing in card.printings"
              :key="printing.id"
              class="w-20"
              :class="thumbProps(printing) && 'cursor-pointer'"
              @click="openLightbox(card, printing, $event)"
            >
              <div class="relative">
                <template v-if="thumbProps(printing)">
                  <TcgCardThumb
                    v-bind="thumbProps(printing)!"
                    :class="printing.owned === 0 && 'opacity-40 grayscale'"
                  />
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
              </div>
              <p
                class="mt-1 truncate text-center text-[10px]"
                :class="printing.owned > 0 ? 'text-muted' : 'text-dimmed'"
              >
                {{ finishLabel(printing.finish, printing.pattern) }}
              </p>
            </div>
          </div>
        </div>
      </UCard>
    </div>

    <TcgCardLightbox
      :card="lightboxCard"
      @close="lightboxCard = null"
      @changed="refresh"
    />
  </div>
</template>
