<script setup lang="ts">
/**
 * Direct trades (§7.1): card-for-card ± Coins, directed, no anonymity —
 * the social heart of collecting. Offers escrow nothing; everything is
 * validated when the receiver accepts.
 */
const { sets } = useTcg()
const { user, fetchSession } = useAuth()
const toast = useToast()

interface TradeItemView {
  copyId: string
  side: string
  cardName: string
  serial: string
  gradeService: string | null
  grade: string | null
}
interface TradeOfferView {
  id: string
  fromUserId: string
  fromName: string
  toUserId: string
  toName: string
  senderCoins: number
  receiverCoins: number
  note: string | null
  state: string
  createdAt: string
  items: TradeItemView[]
}
const { data: offers, refresh } = useAsyncData('tcg-trades', () => apiFetch<TradeOfferView[]>('/api/tcg/trades'))
const incoming = computed(() => (offers.value ?? []).filter(offer => offer.toUserId === user.value?.id))
const outgoing = computed(() => (offers.value ?? []).filter(offer => offer.fromUserId === user.value?.id))

function sideItems(offer: TradeOfferView, side: string) {
  return offer.items.filter(item => item.side === side)
}
function itemLabel(item: TradeItemView) {
  const grade = item.grade ? ` · ${item.gradeService} ${item.grade}` : ''
  return `${item.cardName} (${item.serial})${grade}`
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
interface CounterpartCopy {
  copyId: string
  cardName: string
  serial: string
  finish: string
  pattern: string | null
  gradeService: string | null
  grade: string | null
}
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
  const grade = copy.grade ? ` · ${copy.gradeService} ${copy.grade}` : ''
  return `${copy.cardName} ${copy.serial}${grade}`
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
          <div class="space-y-2">
            <p class="text-sm">
              <b class="text-highlighted">{{ offer.fromName }}</b> offers:
            </p>
            <div class="flex flex-wrap gap-1.5">
              <UBadge
                v-for="item in sideItems(offer, 'sender')"
                :key="item.copyId"
                color="success"
                variant="subtle"
                size="sm"
              >{{ itemLabel(item) }}</UBadge>
              <UBadge
                v-if="offer.senderCoins > 0"
                color="success"
                variant="subtle"
                size="sm"
              >+ <UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" /> {{ formatNumber(offer.senderCoins) }}</UBadge>
            </div>
            <p class="text-sm text-muted">
              for your:
            </p>
            <div class="flex flex-wrap gap-1.5">
              <UBadge
                v-for="item in sideItems(offer, 'receiver')"
                :key="item.copyId"
                color="warning"
                variant="subtle"
                size="sm"
              >{{ itemLabel(item) }}</UBadge>
              <UBadge
                v-if="offer.receiverCoins > 0"
                color="warning"
                variant="subtle"
                size="sm"
              >+ <UIcon name="i-lucide-coins" class="inline-block size-3.5 shrink-0 align-[-2px] text-yellow-400" /> {{ formatNumber(offer.receiverCoins) }} from you</UBadge>
            </div>
            <p
              v-if="offer.note"
              class="text-xs italic text-muted"
            >
              “{{ offer.note }}”
            </p>
            <div class="flex justify-end gap-2">
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
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm text-muted">
              To <b class="text-highlighted">{{ offer.toName }}</b> ·
              {{ sideItems(offer, 'sender').length }} of yours for {{ sideItems(offer, 'receiver').length }} of theirs
              <template v-if="offer.senderCoins > 0"> + {{ formatNumber(offer.senderCoins) }} coins</template>
              <template v-if="offer.receiverCoins > 0"> for {{ formatNumber(offer.receiverCoins) }} coins</template>
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
      description="Pick a player and a set, then click cards on either side. Raw cards trade as unknowns — same as the market."
      :ui="{ content: 'max-w-2xl' }"
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
              <div class="max-h-56 space-y-1 overflow-y-auto pr-1">
                <button
                  v-for="copy in myCopies ?? []"
                  :key="copy.copyId"
                  class="block w-full cursor-pointer truncate rounded px-2 py-1 text-left text-xs"
                  :class="pickedMine.has(copy.copyId) ? 'bg-primary/20 text-highlighted' : 'text-muted hover:bg-elevated'"
                  @click="toggle(pickedMine, copy.copyId)"
                >
                  {{ copyChipLabel(copy) }}
                </button>
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
              <div class="max-h-56 space-y-1 overflow-y-auto pr-1">
                <button
                  v-for="copy in theirCopies ?? []"
                  :key="copy.copyId"
                  class="block w-full cursor-pointer truncate rounded px-2 py-1 text-left text-xs"
                  :class="pickedTheirs.has(copy.copyId) ? 'bg-primary/20 text-highlighted' : 'text-muted hover:bg-elevated'"
                  @click="toggle(pickedTheirs, copy.copyId)"
                >
                  {{ copyChipLabel(copy) }}
                </button>
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
  </div>
</template>
