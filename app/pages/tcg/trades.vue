<script setup lang="ts">
/**
 * Direct trades (§7.1): card-for-card ± Coins, directed, no anonymity —
 * the social heart of collecting. Offers escrow nothing; everything is
 * validated when the receiver accepts.
 *
 * Every card on this page — in an offer or in the builder — opens the same
 * 3D lightbox the market uses, because a trade is a judgement about specific
 * copies and nobody should have to accept one sight-unseen. Condition still
 * stays server-side for cards you don't own: the counterpart's raw cards
 * render clean, exactly as unknowable as they are on the market.
 */
import { useDebounceFn } from '@vueuse/core'
import type { TradeCardView, TradeItemView, TradeOfferView, CounterpartCopy, TradeableCopies } from '~~/server/utils/tcg/trade'
import type { LightboxCard } from '~/components/tcg/TcgCardLightbox.client.vue'
import { legacySetOf } from '#shared/utils/tcg/legacy'

const { sets } = useTcg()
const { user, fetchSession } = useAuth()
const toast = useToast()

const { data: offers, refresh } = useAsyncData('tcg-trades', () => apiFetch<TradeOfferView[]>('/api/tcg/trades'))
const incoming = computed(() => (offers.value ?? []).filter(offer => offer.toUserId === user.value?.id))
const outgoing = computed(() => (offers.value ?? []).filter(offer => offer.fromUserId === user.value?.id))

function sideItems(offer: TradeOfferView, side: string): TradeItemView[] {
  return offer.items.filter(item => item.side === side)
}

// ── Card inspection ─────────────────────────────────────────────────────────
// No `owned` count is passed, so the lightbox stays a viewer: no serial-chip
// strip and no vendor/list/grade/crack rail. `printingId` is still handed over
// for the recent-sales panel — price context is exactly what you want when
// weighing an offer.
const lightboxCard = ref<LightboxCard | null>(null)
function inspect(card: TradeCardView, event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  lightboxCard.value = {
    origin: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    bundle: card.render.bundle,
    assetNumber: card.render.assetNumber,
    maskKind: card.render.maskKind,
    foilEffect: card.render.foilEffect,
    foilMask: card.render.foilMask,
    legacySet: card.render.bundle ? null : legacySetOf(card.render.plaatjesCardId),
    holo: card.render.finish === 'holo',
    name: card.card.name,
    rarity: card.card.rarity,
    pattern: card.render.pattern,
    finishLabel: finishLabel(card.render.finish, card.render.pattern),
    printRunLabel: card.render.printRunLabel,
    serial: card.serial,
    copyId: card.copyId,
    printingId: card.printingId,
    slabMeta: {
      number: card.card.number,
      setTotal: card.card.setTotal,
      setName: card.card.setName,
      setCode: card.card.setCode,
      releaseDate: card.card.releaseDate
    },
    grade: card.grade
  }
}

const acting = ref<string | null>(null)
async function act(offerId: string, action: 'accept' | 'decline' | 'cancel') {
  if (acting.value) return
  acting.value = offerId
  try {
    await apiFetch(`/api/tcg/trades/${action}`, { method: 'POST', body: { offerId } })
    await Promise.all([refresh(), fetchSession()])
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not do that'), color: 'error' })
  } finally {
    acting.value = null
  }
}

// ── Offer builder ───────────────────────────────────────────────────────────
interface PlayerRow { id: string, name: string }
const builderOpen = ref(false)
const { data: players } = useAsyncData('tcg-trade-players', () => apiFetch<PlayerRow[]>('/api/tcg/trades/players'))
const playerItems = computed(() => (players.value ?? []).map(p => ({ label: p.name, value: p.id })))
const partnerId = ref<string | undefined>(undefined)
const builderSetId = ref<string | undefined>(undefined)
const setOptions = computed(() => sets.value.map(s => ({ label: `${s.name} (${s.code})`, value: s.id })))

type BuilderSide = 'mine' | 'theirs'
const emptyList = (): TradeableCopies => ({ copies: [], truncated: false })
const myList = ref<TradeableCopies | null>(null)
const theirList = ref<TradeableCopies | null>(null)
const mySearch = ref('')
const theirSearch = ref('')
// Picked copies are kept whole, so one stays on its list while a search hides it.
const pickedMine = ref(new Map<string, CounterpartCopy>())
const pickedTheirs = ref(new Map<string, CounterpartCopy>())

// Only a side's latest request may land, so a slow answer to an older search can't replace a newer one.
const listRequest: Record<BuilderSide, number> = { mine: 0, theirs: 0 }
async function loadCopies(side: BuilderSide) {
  const list = side === 'mine' ? myList : theirList
  const ownerId = side === 'mine' ? user.value?.id : partnerId.value
  const request = ++listRequest[side]
  if (!ownerId || !builderSetId.value) {
    list.value = null
    return
  }
  const search = (side === 'mine' ? mySearch : theirSearch).value.trim()
  try {
    const result = await apiFetch<TradeableCopies>('/api/tcg/trades/collection', {
      query: { userId: ownerId, setId: builderSetId.value, ...(search ? { search } : {}) }
    })
    if (request === listRequest[side]) list.value = result
  } catch {
    if (request === listRequest[side]) list.value = emptyList()
  }
}

// A new set starts both sides over; a new partner only theirs, so your picks survive choosing who to trade with.
watch(builderSetId, () => {
  pickedMine.value = new Map()
  mySearch.value = ''
  myList.value = null
  loadCopies('mine')
})
watch([partnerId, builderSetId], () => {
  pickedTheirs.value = new Map()
  theirSearch.value = ''
  theirList.value = null
  loadCopies('theirs')
})
const searchMine = useDebounceFn(() => loadCopies('mine'), 250)
const searchTheirs = useDebounceFn(() => loadCopies('theirs'), 250)
watch(mySearch, searchMine)
watch(theirSearch, searchTheirs)

/** Picked copies the current search hides, then the search's results. */
function shownCopies(picked: Map<string, CounterpartCopy>, list: TradeableCopies | null) {
  const copies = list?.copies ?? []
  const listed = new Set(copies.map(copy => copy.copyId))
  return [...[...picked.values()].filter(copy => !listed.has(copy.copyId)), ...copies]
}
const myShown = computed(() => shownCopies(pickedMine.value, myList.value))
const theirShown = computed(() => shownCopies(pickedTheirs.value, theirList.value))

function toggle(picked: Map<string, CounterpartCopy>, copy: CounterpartCopy) {
  if (picked.has(copy.copyId)) picked.delete(copy.copyId)
  else picked.set(copy.copyId, copy)
}

// The collection's Trade button lands here as `?set=…&give=<copyId>&name=…`: open the builder on
// that set with the copy already given, and the give side searched to its name so it's in view.
const route = useRoute()
const router = useRouter()
onMounted(async () => {
  const { set, give, name } = route.query
  if (typeof set !== 'string' || typeof give !== 'string' || !user.value) return
  const search = typeof name === 'string' ? name.slice(0, 100) : ''
  // Off the URL, so a reload or Back doesn't open the builder again.
  await router.replace({ query: {} })
  builderSetId.value = set
  builderOpen.value = true
  // Past the set watcher, which clears the search for a new set.
  await nextTick()
  mySearch.value = search
  try {
    const found = await apiFetch<TradeableCopies>('/api/tcg/trades/collection', {
      query: { userId: user.value.id, setId: set, ...(search ? { search } : {}) }
    })
    const copy = found.copies.find(c => c.copyId === give)
    if (copy && builderSetId.value === set) pickedMine.value.set(copy.copyId, copy)
  } catch {
    // The builder is open on the set either way; the card can still be picked by hand.
  }
})

const coinDirection = ref<'none' | 'pay' | 'ask'>('none')
const coinAmount = ref(0)
const coinAmountText = useAmountInput(coinAmount)
/**
 * Coins offered are escrowed on send, so an amount over the balance is a
 * refusal waiting to happen — say so before the round trip. Coins ASKED for
 * are the other player's problem at accept, so they are not checked here.
 */
const overOffered = computed(() => coinDirection.value === 'pay'
  && Number(coinAmount.value) > parseFloat(user.value?.balance ?? '0'))
const offerNote = ref('')
const creating = ref(false)
async function submitOffer() {
  if (!partnerId.value || creating.value) return
  creating.value = true
  try {
    await apiFetch('/api/tcg/trades/create', {
      method: 'POST',
      body: {
        toUserId: partnerId.value,
        senderCopyIds: [...pickedMine.value.keys()],
        receiverCopyIds: [...pickedTheirs.value.keys()],
        senderCoins: coinDirection.value === 'pay' ? Number(coinAmount.value) : 0,
        receiverCoins: coinDirection.value === 'ask' ? Number(coinAmount.value) : 0,
        note: offerNote.value || null
      }
    })
    builderOpen.value = false
    offerNote.value = ''
    coinDirection.value = 'none'
    coinAmount.value = 0
    // The coins left the balance with the offer, so the header has to know.
    await Promise.all([refresh(), fetchSession()])
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not send offer'), color: 'error' })
  } finally {
    creating.value = false
  }
}

function copyChipLabel(copy: CounterpartCopy) {
  const grade = copy.grade ? ` · ${copy.grade.service} ${copy.grade.grade}` : ''
  return `${copy.card.name} ${copy.serial}${grade}`
}

function thumbProps(copy: CounterpartCopy) {
  if (copy.render.bundle) return { bundle: copy.render.bundle }
  const legacySet = legacySetOf(copy.render.plaatjesCardId)
  return legacySet && copy.render.assetNumber ? { legacySet, assetNumber: copy.render.assetNumber } : null
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-5 p-4">
    <div class="flex items-center justify-between">
      <span class="text-xs text-muted">Card-for-card, coins optional · 5% of any coin sweetener is burned · offers hold nothing until accepted</span>
      <UButton
        icon="i-lucide-handshake"
        label="New offer"
        size="sm"
        @click="builderOpen = true"
      />
    </div>

    <section>
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Incoming</h2>
      <div
        v-if="incoming.length"
        class="space-y-3"
      >
        <UCard
          v-for="offer in incoming"
          :key="offer.id"
        >
          <div class="space-y-3">
            <p class="text-sm">
              <b class="text-highlighted">{{ offer.fromName }}</b> offers:
            </p>
            <TcgTradeCardStrip
              v-if="sideItems(offer, 'sender').length"
              :cards="sideItems(offer, 'sender')"
              tone="get"
              @inspect="inspect"
            />
            <UTooltip
              v-if="offer.senderCoins > 0"
              :text="offer.senderEscrow > 0
                ? 'Already taken from their balance and held until this offer is answered'
                : 'Paid when you accept'"
            >
              <UBadge
                color="success"
                variant="subtle"
                size="sm"
              >+ <UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" /> {{ formatNumber(offer.senderCoins) }}<template v-if="offer.senderEscrow > 0"> held</template></UBadge>
            </UTooltip>
            <p class="text-sm text-muted">
              for your:
            </p>
            <TcgTradeCardStrip
              v-if="sideItems(offer, 'receiver').length"
              :cards="sideItems(offer, 'receiver')"
              tone="give"
              @inspect="inspect"
            />
            <UBadge
              v-if="offer.receiverCoins > 0"
              color="warning"
              variant="subtle"
              size="sm"
            >+ <UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" /> {{ formatNumber(offer.receiverCoins) }} from you</UBadge>
            <p
              v-if="offer.note"
              class="text-xs italic text-muted"
            >
              “{{ offer.note }}”
            </p>
            <div class="flex items-center justify-end gap-2">
              <span class="mr-auto text-xs text-dimmed">Click a card for the full 3D view</span>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                label="Decline"
                :disabled="acting !== null"
                @click="act(offer.id, 'decline')"
              />
              <UButton
                color="primary"
                size="xs"
                label="Accept trade"
                :loading="acting === offer.id"
                @click="act(offer.id, 'accept')"
              />
            </div>
          </div>
        </UCard>
      </div>
      <p
        v-else
        class="rounded-lg bg-elevated p-4 text-sm text-muted"
      >
        No incoming offers.
      </p>
    </section>

    <section>
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Outgoing</h2>
      <div
        v-if="outgoing.length"
        class="space-y-3"
      >
        <UCard
          v-for="offer in outgoing"
          :key="offer.id"
        >
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-2">
              <p class="text-sm text-muted">
                To <b class="text-highlighted">{{ offer.toName }}</b>
              </p>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                label="Cancel"
                :disabled="acting !== null"
                @click="act(offer.id, 'cancel')"
              />
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <p class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                  You give
                  <template v-if="offer.senderCoins > 0"> · {{ formatNumber(offer.senderCoins) }} coins<template v-if="offer.senderEscrow > 0"> (held)</template></template>
                </p>
                <TcgTradeCardStrip
                  v-if="sideItems(offer, 'sender').length"
                  :cards="sideItems(offer, 'sender')"
                  tone="give"
                  @inspect="inspect"
                />
                <p
                  v-else
                  class="text-xs text-dimmed"
                >No cards.</p>
              </div>
              <div>
                <p class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                  You get
                  <template v-if="offer.receiverCoins > 0"> · {{ formatNumber(offer.receiverCoins) }} coins</template>
                </p>
                <TcgTradeCardStrip
                  v-if="sideItems(offer, 'receiver').length"
                  :cards="sideItems(offer, 'receiver')"
                  tone="get"
                  @inspect="inspect"
                />
                <p
                  v-else
                  class="text-xs text-dimmed"
                >No cards.</p>
              </div>
            </div>
            <p
              v-if="offer.note"
              class="text-xs italic text-muted"
            >
              “{{ offer.note }}”
            </p>
          </div>
        </UCard>
      </div>
      <p
        v-else
        class="rounded-lg bg-elevated p-4 text-sm text-muted"
      >
        No outgoing offers.
      </p>
    </section>

    <UModal
      v-model:open="builderOpen"
      title="New trade offer"
      description="Pick a player and a set, then click cards on either side. Click a thumbnail to inspect it in 3D first. Raw cards trade as unknowns — same as the market."
      :ui="{ content: 'max-w-2xl' }"
      :dismissible="!lightboxCard"
    >
      <template #body>
        <div class="space-y-3">
          <div class="flex gap-3">
            <USelect
              v-model="partnerId"
              :items="playerItems"
              placeholder="Trade with…"
              class="flex-1"
            />
            <UButton
              v-if="partnerId"
              color="neutral"
              variant="subtle"
              icon="i-lucide-user"
              label="Profile"
              :to="`/players/${partnerId}`"
              target="_blank"
            />
            <USelect
              v-model="builderSetId"
              :items="setOptions"
              placeholder="Set"
              class="flex-1"
            />
          </div>
          <div
            v-if="builderSetId"
            class="grid grid-cols-2 gap-3"
          >
            <div>
              <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">You give ({{ pickedMine.size }})</p>
              <UInput
                v-model="mySearch"
                icon="i-lucide-search"
                placeholder="Search name or number…"
                size="xs"
                class="mb-1 w-full"
              />
              <div class="max-h-72 space-y-1 overflow-y-auto pr-1">
                <div
                  v-for="copy in myShown"
                  :key="copy.copyId"
                  class="flex items-center gap-2 rounded pr-1"
                  :class="pickedMine.has(copy.copyId) ? 'bg-primary/20' : 'hover:bg-elevated'"
                >
                  <button
                    class="w-8 shrink-0 cursor-zoom-in rounded transition hover:scale-105"
                    :title="`Inspect ${copy.card.name}`"
                    @click="inspect(copy, $event)"
                  >
                    <TcgCardThumb
                      v-if="thumbProps(copy)"
                      v-bind="thumbProps(copy)!"
                    />
                    <div
                      v-else
                      class="aspect-[0.718] w-full rounded bg-elevated"
                    />
                  </button>
                  <button
                    class="min-w-0 flex-1 cursor-pointer truncate py-1.5 text-left text-xs"
                    :class="pickedMine.has(copy.copyId) ? 'text-highlighted' : 'text-muted'"
                    @click="toggle(pickedMine, copy)"
                  >
                    {{ copyChipLabel(copy) }}
                  </button>
                </div>
                <p
                  v-if="myList && !myList.copies.length"
                  class="text-xs text-dimmed"
                >
                  {{ mySearch.trim() ? 'No cards match.' : 'Nothing tradeable here.' }}
                </p>
                <p
                  v-if="myList?.truncated"
                  class="text-xs text-dimmed"
                >
                  Showing the first {{ myList.copies.length }}. Search to find the rest.
                </p>
              </div>
            </div>
            <div>
              <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">You get ({{ pickedTheirs.size }})</p>
              <UInput
                v-model="theirSearch"
                icon="i-lucide-search"
                placeholder="Search name or number…"
                size="xs"
                class="mb-1 w-full"
                :disabled="!partnerId"
              />
              <p
                v-if="!partnerId"
                class="text-xs text-dimmed"
              >
                Pick who to trade with to see their cards.
              </p>
              <div class="max-h-72 space-y-1 overflow-y-auto pr-1">
                <div
                  v-for="copy in theirShown"
                  :key="copy.copyId"
                  class="flex items-center gap-2 rounded pr-1"
                  :class="pickedTheirs.has(copy.copyId) ? 'bg-primary/20' : 'hover:bg-elevated'"
                >
                  <button
                    class="w-8 shrink-0 cursor-zoom-in rounded transition hover:scale-105"
                    :title="`Inspect ${copy.card.name}`"
                    @click="inspect(copy, $event)"
                  >
                    <TcgCardThumb
                      v-if="thumbProps(copy)"
                      v-bind="thumbProps(copy)!"
                    />
                    <div
                      v-else
                      class="aspect-[0.718] w-full rounded bg-elevated"
                    />
                  </button>
                  <button
                    class="min-w-0 flex-1 cursor-pointer truncate py-1.5 text-left text-xs"
                    :class="pickedTheirs.has(copy.copyId) ? 'text-highlighted' : 'text-muted'"
                    @click="toggle(pickedTheirs, copy)"
                  >
                    {{ copyChipLabel(copy) }}
                  </button>
                </div>
                <p
                  v-if="theirList && !theirList.copies.length"
                  class="text-xs text-dimmed"
                >
                  {{ theirSearch.trim() ? 'No cards match.' : 'They have nothing tradeable here.' }}
                </p>
                <p
                  v-if="theirList?.truncated"
                  class="text-xs text-dimmed"
                >
                  Showing the first {{ theirList.copies.length }}. Search to find the rest.
                </p>
              </div>
            </div>
          </div>
          <div class="flex items-end gap-3">
            <UFormField
              label="Coins"
              class="w-40"
            >
              <USelect
                v-model="coinDirection"
                class="w-full"
                :items="[
                  { label: 'No coins', value: 'none' },
                  { label: 'You add coins', value: 'pay' },
                  { label: 'You ask coins', value: 'ask' }
                ]"
              />
            </UFormField>
            <UFormField
              v-if="coinDirection !== 'none'"
              label="Amount"
              class="w-32"
              :help="coinDirection === 'pay' ? 'Held until they answer' : 'They pay on accept'"
              :error="overOffered ? 'More than you hold' : undefined"
            >
              <UInput
                v-model="coinAmountText"
                autocomplete="off"
              >
                <template #leading>
                  <UIcon
                    name="i-lucide-coins"
                    class="size-3.5 text-yellow-400"
                  />
                </template>
                <template v-if="amountPreview(coinAmountText)" #trailing>
                  <span class="text-xs tabular-nums text-muted">{{ amountPreview(coinAmountText) }}</span>
                </template>
              </UInput>
            </UFormField>
            <UFormField
              label="Note (optional)"
              class="flex-1"
            >
              <UInput
                v-model="offerNote"
                :maxlength="280"
              />
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="builderOpen = false"
          />
          <UButton
            :disabled="!partnerId || (pickedMine.size === 0 && pickedTheirs.size === 0) || overOffered"
            :loading="creating"
            label="Send offer"
            @click="submitOffer"
          />
        </div>
      </template>
    </UModal>

    <TcgCardLightbox
      :card="lightboxCard"
      @close="lightboxCard = null"
    />
  </div>
</template>
