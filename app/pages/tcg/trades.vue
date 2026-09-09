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
import type { TradeCardView, TradeItemView, TradeOfferView, CounterpartCopy } from '~~/server/utils/tcg/trade'
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
    toast.add({
      title: action === 'accept' ? 'Trade completed' : action === 'decline' ? 'Offer declined' : 'Offer cancelled',
      color: 'success'
    })
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

const theirCopies = ref<CounterpartCopy[] | null>(null)
const myCopies = ref<CounterpartCopy[] | null>(null)
const pickedTheirs = ref<Set<string>>(new Set())
const pickedMine = ref<Set<string>>(new Set())

watch([partnerId, builderSetId], async ([partner, set]) => {
  pickedTheirs.value = new Set()
  pickedMine.value = new Set()
  theirCopies.value = null
  myCopies.value = null
  if (!partner || !set || !user.value) return
  try {
    [theirCopies.value, myCopies.value] = await Promise.all([
      apiFetch<CounterpartCopy[]>('/api/tcg/trades/collection', { query: { userId: partner, setId: set } }),
      apiFetch<CounterpartCopy[]>('/api/tcg/trades/collection', { query: { userId: user.value.id, setId: set } })
    ])
  } catch {
    theirCopies.value = []
    myCopies.value = []
  }
})

function toggle(picked: Set<string>, copyId: string) {
  if (picked.has(copyId)) picked.delete(copyId)
  else picked.add(copyId)
}

const coinDirection = ref<'none' | 'pay' | 'ask'>('none')
const coinAmount = ref(0)
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
        senderCopyIds: [...pickedMine.value],
        receiverCopyIds: [...pickedTheirs.value],
        senderCoins: coinDirection.value === 'pay' ? Number(coinAmount.value) : 0,
        receiverCoins: coinDirection.value === 'ask' ? Number(coinAmount.value) : 0,
        note: offerNote.value || null
      }
    })
    toast.add({ title: 'Offer sent', color: 'success' })
    builderOpen.value = false
    offerNote.value = ''
    coinDirection.value = 'none'
    coinAmount.value = 0
    await refresh()
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
            <UBadge
              v-if="offer.senderCoins > 0"
              color="success"
              variant="subtle"
              size="sm"
            >+ <UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" /> {{ formatNumber(offer.senderCoins) }}</UBadge>
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
                  <template v-if="offer.senderCoins > 0"> · {{ formatNumber(offer.senderCoins) }} coins</template>
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
            v-if="partnerId && builderSetId"
            class="grid grid-cols-2 gap-3"
          >
            <div>
              <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">You give ({{ pickedMine.size }})</p>
              <div class="max-h-72 space-y-1 overflow-y-auto pr-1">
                <div
                  v-for="copy in myCopies ?? []"
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
                    @click="toggle(pickedMine, copy.copyId)"
                  >
                    {{ copyChipLabel(copy) }}
                  </button>
                </div>
                <p
                  v-if="myCopies && !myCopies.length"
                  class="text-xs text-dimmed"
                >
                  Nothing tradeable here.
                </p>
              </div>
            </div>
            <div>
              <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">You get ({{ pickedTheirs.size }})</p>
              <div class="max-h-72 space-y-1 overflow-y-auto pr-1">
                <div
                  v-for="copy in theirCopies ?? []"
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
                    @click="toggle(pickedTheirs, copy.copyId)"
                  >
                    {{ copyChipLabel(copy) }}
                  </button>
                </div>
                <p
                  v-if="theirCopies && !theirCopies.length"
                  class="text-xs text-dimmed"
                >
                  They have nothing tradeable here.
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
            >
              <UInput
                v-model.number="coinAmount"
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
            :disabled="!partnerId || (pickedMine.size === 0 && pickedTheirs.size === 0)"
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
