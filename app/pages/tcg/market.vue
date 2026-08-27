<script setup lang="ts">
import type { TcgListingSummary } from '#shared/types/tcg'
import type { LightboxCard } from '~/components/tcg/TcgCardLightbox.client.vue'
import { legacySetOf } from '#shared/utils/tcg/legacy'
import { sellerProceeds, minNextBid } from '#shared/utils/tcg/market'
import { wrapUrl } from '~/utils/tcg/wrap'

/* The market (§7.1): fixed-price listings in Coins, sellers named, every raw
 * listing fully inspectable before purchase. 5% of every sale burns.
 */
const { sets } = useTcg()
const { user } = useAuth()

const selectedSetId = ref<string | undefined>(undefined)
const setOptions = computed(() =>
  sets.value.map(s => ({ label: `${s.name} (${s.code})`, value: s.id })))

const { data: listings, refresh } = useAsyncData('tcg-market-listings', () => apiFetch<TcgListingSummary[]>('/api/tcg/market/listings', { query: { setId: selectedSetId.value } }), {
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

// The caller's open buy orders (§7.1 bid side), shown below the listings.
interface OwnOrderRow {
  id: string
  cardName: string
  cardNumber: string
  finish: string
  pattern: string | null
  printRunLabel: string
  gradeService: string
  grade: string
  gradeDesignation: string | null
  price: number
  quantity: number
  filled: number
  setId: string
  setName: string
}
const { data: buyOrders, refresh: refreshOrders } = useAsyncData('tcg-book-orders', () => apiFetch<OwnOrderRow[]>('/api/tcg/book/orders'))
const browserOpen = ref(false)
const toast = useToast()
const { fetchSession } = useAuth()
async function cancelOrder(orderId: string) {
  try {
    await apiFetch('/api/tcg/book/cancel', { method: 'POST', body: { orderId } })
    toast.add({ title: 'Order cancelled — escrow refunded', color: 'success' })
    await Promise.all([refreshOrders(), fetchSession()])
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not cancel'), color: 'error' })
  }
}

// ── Bulk lots (§7.1): unsorted, uninspected, count + price only ────────────
interface LotRow {
  id: string
  sellerId: string
  sellerName: string
  price: number
  note: string | null
  copies: number
}
const { data: lots, refresh: refreshLots } = useAsyncData('tcg-lots', () => apiFetch<LotRow[]>('/api/tcg/lots', { query: { setId: selectedSetId.value } }), {
  immediate: false,
  watch: [selectedSetId]
})
const lotArmed = ref<string | null>(null)
const lotBuying = ref(false)
async function buyLotClick(lot: LotRow) {
  if (lotBuying.value) return
  if (lotArmed.value !== lot.id) {
    lotArmed.value = lot.id
    return
  }
  lotBuying.value = true
  try {
    const res = await apiFetch<{ copies: number }>('/api/tcg/lots/buy', { method: 'POST', body: { lotId: lot.id } })
    toast.add({ title: `Bought the lot — ${res.copies} cards are yours`, color: 'success' })
    lotArmed.value = null
    await Promise.all([refreshLots(), fetchSession()])
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not buy lot'), color: 'error' })
    lotArmed.value = null
  } finally {
    lotBuying.value = false
  }
}
async function cancelLotClick(lotId: string) {
  try {
    await apiFetch('/api/tcg/lots/cancel', { method: 'POST', body: { lotId } })
    toast.add({ title: 'Lot cancelled', color: 'success' })
    await refreshLots()
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not cancel lot'), color: 'error' })
  }
}

// Lot builder: pick printings and counts; the server picks the copies.
interface RawCountRow {
  printingId: string
  cardName: string
  finish: string
  pattern: string | null
  count: number
}
const lotBuilderOpen = ref(false)
const rawCounts = ref<RawCountRow[] | null>(null)
const lotPicks = ref<Record<string, number>>({})
const lotPrice = ref(100)
const lotNote = ref('')
const lotCreating = ref(false)
watch(lotBuilderOpen, async (open) => {
  if (!open || !selectedSetId.value) return
  lotPicks.value = {}
  rawCounts.value = null
  try {
    rawCounts.value = await apiFetch<RawCountRow[]>('/api/tcg/lots/raw-counts', {
      query: { setId: selectedSetId.value }
    })
  } catch {
    rawCounts.value = []
  }
})
const lotTotal = computed(() =>
  Object.values(lotPicks.value).reduce((sum, n) => sum + (Number(n) || 0), 0))
async function createLotClick() {
  if (!selectedSetId.value || lotCreating.value) return
  lotCreating.value = true
  try {
    const picks = Object.entries(lotPicks.value)
      .filter(([, count]) => (Number(count) || 0) > 0)
      .map(([printingId, count]) => ({ printingId, count: Number(count) }))
    await apiFetch('/api/tcg/lots/create', {
      method: 'POST',
      body: { setId: selectedSetId.value, picks, price: Number(lotPrice.value), note: lotNote.value || null }
    })
    toast.add({ title: 'Bulk lot listed', color: 'success' })
    lotBuilderOpen.value = false
    lotNote.value = ''
    await refreshLots()
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not create lot'), color: 'error' })
  } finally {
    lotCreating.value = false
  }
}

// ── Auctions (§7.1): countdown ticker + bid forms ───────────────────────────
interface AuctionRow {
  id: string
  kind: string
  sellerId: string
  sellerName: string
  startPrice: number
  currentBid: number | null
  currentBidderId: string | null
  endsAt: string
  copyId: string | null
  packId: string | null
  bids: number
  cardName: string | null
  bundle: string | null
  assetNumber: string | null
  plaatjesCardId: string | null
  gradeService: string | null
  grade: string | null
}
const { data: auctions, refresh: refreshAuctions } = useAsyncData('tcg-auctions', () => apiFetch<AuctionRow[]>('/api/tcg/auctions', { query: { setId: selectedSetId.value } }), {
  immediate: false,
  watch: [selectedSetId]
})
const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => {
    now.value = Date.now()
    // A due auction settles server-side on the next read.
    if (auctions.value?.some(a => new Date(a.endsAt).getTime() <= now.value)) refreshAuctions()
  }, 1000)
  onUnmounted(() => clearInterval(t))
})
function msLeft(at: string) {
  return Math.max(0, new Date(at).getTime() - now.value)
}
function formatMs(ms: number) {
  if (ms <= 0) return 'ended'
  const s2 = Math.floor(ms / 1000)
  const m = Math.floor(s2 / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s2 % 60}s`
  return `${s2}s`
}
function auctionMinBid(auction: AuctionRow) {
  return minNextBid(auction.startPrice, auction.currentBid)
}
const bidAmounts = ref<Record<string, number>>({})
const bidding = ref<string | null>(null)
async function placeAuctionBid(auction: AuctionRow) {
  if (bidding.value) return
  const amount = Number(bidAmounts.value[auction.id] ?? auctionMinBid(auction))
  bidding.value = auction.id
  try {
    await apiFetch('/api/tcg/auctions/bid', { method: 'POST', body: { auctionId: auction.id, amount } })
    toast.add({ title: `Bid placed — ${formatNumber(amount, false)} coins escrowed`, color: 'success' })
    await Promise.all([refreshAuctions(), fetchSession()])
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not bid'), color: 'error' })
  } finally {
    bidding.value = null
  }
}
async function cancelAuctionClick(auctionId: string) {
  try {
    await apiFetch('/api/tcg/auctions/cancel', { method: 'POST', body: { auctionId } })
    toast.add({ title: 'Auction cancelled', color: 'success' })
    await refreshAuctions()
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not cancel'), color: 'error' })
  }
}
function auctionThumb(auction: AuctionRow): string | null {
  const base = (useRuntimeConfig().public as { pokemonApiBase?: string }).pokemonApiBase
    ?? 'http://127.0.0.1:8080'
  if (auction.kind === 'pack') return packWrap.value
  if (auction.bundle) return `${base}/images/cards/${auction.bundle}.png`
  if (auction.plaatjesCardId && auction.assetNumber) {
    return `${base}/images/legacy/${legacySetOf(auction.plaatjesCardId)}/${auction.assetNumber}.png`
  }
  return null
}
const packWrap = computed(() => {
  const base = (useRuntimeConfig().public as { pokemonApiBase?: string }).pokemonApiBase
    ?? 'http://127.0.0.1:8080'
  return wrapUrl(base, currentSet.value?.plaatjesSetCode) ?? null
})

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
            <span class="flex items-center gap-1 font-mono tabular-nums text-highlighted"><UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" />{{ formatNumber(listing.price) }}</span>
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
            <span class="flex items-center gap-1 font-mono text-sm tabular-nums text-highlighted"><UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" />{{ formatNumber(listing.price) }}</span>
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

    <section v-if="auctions?.length">
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Auctions</h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <UCard
          v-for="auction in auctions"
          :key="auction.id"
        >
          <div class="flex gap-3">
            <img
              v-if="auctionThumb(auction)"
              :src="auctionThumb(auction)!"
              :alt="auction.cardName ?? 'sealed pack'"
              class="h-24 w-auto shrink-0 self-center rounded object-contain"
            >
            <div class="min-w-0 flex-1 space-y-1">
              <p class="truncate text-sm font-medium text-highlighted">
                <template v-if="auction.kind === 'pack'">Sealed pack</template>
                <template v-else>{{ auction.cardName }}</template>
                <UBadge
                  v-if="auction.grade"
                  color="primary"
                  variant="subtle"
                  size="sm"
                  class="ml-1"
                >{{ auction.gradeService }} {{ auction.grade }}</UBadge>
              </p>
              <p class="text-xs text-muted">
                {{ auction.sellerName }} · {{ auction.bids }} bid{{ auction.bids === 1 ? '' : 's' }} ·
                ends in <b class="tabular-nums text-highlighted">{{ formatMs(msLeft(auction.endsAt)) }}</b>
              </p>
              <p class="text-sm">
                <span class="text-muted">{{ auction.currentBid !== null ? 'current bid' : 'starting at' }}</span>
                <b class="ml-1 font-mono tabular-nums text-highlighted"><UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" /> {{ formatNumber(auction.currentBid ?? auction.startPrice) }}</b>
              </p>
              <div
                v-if="auction.sellerId !== user?.id"
                class="flex items-center gap-2"
              >
                <UInput
                  :model-value="bidAmounts[auction.id] ?? auctionMinBid(auction)"
                  type="number"
                  size="xs"
                  class="w-28"
                  :min="auctionMinBid(auction)"
                  @update:model-value="value => bidAmounts[auction.id] = Number(value)"
                />
                <UButton
                  size="xs"
                  :loading="bidding === auction.id"
                  :label="`Bid (min ${formatNumber(auctionMinBid(auction))})`"
                  @click="placeAuctionBid(auction)"
                />
              </div>
              <div v-else>
                <UButton
                  v-if="auction.currentBid === null"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  label="Cancel auction"
                  @click="cancelAuctionClick(auction.id)"
                />
                <span
                  v-else
                  class="text-xs text-dimmed"
                >your auction — bids are binding</span>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </section>

    <section>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">Bulk lots</h2>
        <UButton
          color="neutral"
          variant="subtle"
          size="xs"
          icon="i-lucide-boxes"
          label="Sell bulk"
          @click="lotBuilderOpen = true"
        />
      </div>
      <div
        v-if="lots?.length"
        class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3"
      >
        <UCard
          v-for="lot in lots"
          :key="lot.id"
        >
          <div class="flex items-center gap-3">
            <UIcon
              name="i-lucide-boxes"
              class="size-8 shrink-0 text-muted"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-highlighted">
                {{ lot.copies }} unsorted cards
              </p>
              <p class="truncate text-xs text-muted">
                {{ lot.sellerName }}<template v-if="lot.note"> · “{{ lot.note }}”</template>
              </p>
              <p class="text-xs text-dimmed">
                uninspected — what you see is the count
              </p>
            </div>
            <div class="flex flex-col items-end gap-1">
              <span class="flex items-center gap-1 font-mono text-sm tabular-nums text-highlighted"><UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" />{{ formatNumber(lot.price) }}</span>
              <UButton
                v-if="lot.sellerId !== user?.id"
                :color="lotArmed === lot.id ? 'error' : 'primary'"
                size="xs"
                :loading="lotBuying && lotArmed === lot.id"
                :label="lotArmed === lot.id ? 'Really buy?' : 'Buy'"
                @click="buyLotClick(lot)"
              />
              <UButton
                v-else
                color="neutral"
                variant="ghost"
                size="xs"
                label="Cancel"
                @click="cancelLotClick(lot.id)"
              />
            </div>
          </div>
        </UCard>
      </div>
      <p
        v-else
        class="rounded-lg bg-elevated p-4 text-sm text-muted"
      >
        No bulk lots in {{ currentSet?.name ?? 'this set' }}.
      </p>
    </section>

    <UModal
      v-model:open="lotBuilderOpen"
      title="Sell bulk"
      description="Pick how many raw copies of each printing go in. The lot sells unsorted and uninspected — buyers see only the count."
    >
      <template #body>
        <div class="space-y-3">
          <div
            v-if="rawCounts === null"
            class="text-sm text-muted"
          >
            Loading your raw cards…
          </div>
          <div
            v-else-if="!rawCounts.length"
            class="text-sm text-muted"
          >
            No free raw copies in this set.
          </div>
          <div
            v-else
            class="max-h-72 space-y-1.5 overflow-y-auto pr-1"
          >
            <div
              v-for="row in rawCounts"
              :key="row.printingId"
              class="flex items-center justify-between gap-2 text-sm"
            >
              <span class="truncate text-muted">
                {{ row.cardName }} · {{ finishLabel(row.finish, row.pattern) }}
                <span class="text-dimmed">({{ row.count }})</span>
              </span>
              <UInput
                :model-value="lotPicks[row.printingId] ?? 0"
                type="number"
                size="xs"
                class="w-20"
                :min="0"
                :max="row.count"
                @update:model-value="value => lotPicks[row.printingId] = Math.min(Number(value) || 0, row.count)"
              />
            </div>
          </div>
          <div class="flex items-end gap-3">
            <UFormField
              label="Price"
              class="flex-1"
            >
              <UInput
                v-model.number="lotPrice"
                type="number"
                :min="1"
              >
                <template #leading>
                  <UIcon
                    name="i-lucide-coins"
                    class="size-3.5 text-yellow-400"
                  />
                </template>
              </UInput>
            </UFormField>
            <UFormField
              label="Note (optional)"
              class="flex-1"
            >
              <UInput
                v-model="lotNote"
                :maxlength="280"
                placeholder="mostly commons"
              />
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full items-center justify-between">
          <span class="flex items-center gap-1 text-xs text-muted">{{ lotTotal }} cards · you receive <UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" />{{ formatNumber(sellerProceeds(Number(lotPrice) || 0)) }}</span>
          <div class="flex gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              label="Cancel"
              @click="lotBuilderOpen = false"
            />
            <UButton
              :disabled="lotTotal < 4"
              :loading="lotCreating"
              label="List lot"
              @click="createLotClick"
            />
          </div>
        </div>
      </template>
    </UModal>

    <section v-if="selectedSetId">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">Buy orders</h2>
        <UButton
          color="neutral"
          variant="subtle"
          size="xs"
          icon="i-lucide-hand-coins"
          label="Place buy order"
          @click="browserOpen = true"
        />
      </div>
      <UCard v-if="buyOrders?.length">
        <ul class="divide-y divide-default">
          <li
            v-for="order in buyOrders"
            :key="order.id"
            class="flex items-center justify-between gap-2 py-1.5 text-sm"
          >
            <span class="text-muted">
              <b class="text-highlighted">{{ order.cardName }}</b> #{{ order.cardNumber }}
              · {{ order.setName }}
              · {{ finishLabel(order.finish, order.pattern) }}
              · {{ order.gradeService }} {{ order.grade }}<template v-if="order.gradeDesignation"> {{ order.gradeDesignation }}</template>
              · <UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" /> <span class="font-mono tabular-nums text-highlighted">{{ formatNumber(order.price) }}</span>
              × {{ order.quantity - order.filled }}
            </span>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              label="Cancel"
              @click="cancelOrder(order.id)"
            />
          </li>
        </ul>
      </UCard>
      <div
        v-else
        class="rounded-lg bg-elevated/50 px-4 py-3 text-sm text-muted"
      >
        No standing bids of yours. Place one on any card and grade — even a slab nobody has pulled yet.
      </div>
    </section>

    <TcgBookBrowser
      v-model:open="browserOpen"
      :set-id="selectedSetId ?? ''"
      @changed="refreshOrders()"
    />

    <TcgCardLightbox
      :card="lightboxCard"
      @close="closeLightbox"
      @changed="refresh(); refreshOrders()"
    />
  </div>
</template>
