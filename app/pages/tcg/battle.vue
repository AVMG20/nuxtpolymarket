<script setup lang="ts">
/**
 * The auto-battler (§12): draft from your collection, build in the shop,
 * fight snapshots. Slice 1 is units only, unranked, escrow live.
 */
import type { RunState, RunPoolCard, RunItemCard, RunBoardUnit, FightResult } from '~~/server/utils/battler/run'
import { ITEM_GLYPH } from '#shared/utils/battler/items'
import { BATTLER, levelFor } from '#shared/utils/battler/shop'
import { legacySetOf } from '#shared/utils/tcg/legacy'

interface RunRow {
    id: string
    state: string
    round: number
    wins: number
    losses: number
    cash: number
    runState: RunState
}

interface HistoryRow {
    id: string
    state: string
    round: number
    wins: number
    losses: number
    deckName: string | null
    createdAt: string
    finishedAt: string | null
}

const toast = useToast()
const { data: view, refresh } = useAsyncData('battler-state', () => apiFetch<{ run: RunRow | null, eligibleCards: number | null, eligibleItems?: number | null }>('/api/battler/state'))
const { data: history, refresh: refreshHistory } = useAsyncData('battler-history', () => apiFetch<HistoryRow[]>('/api/battler/history'))
const { data: decks, refresh: refreshDecks } = useAsyncData('battler-decks', () => apiFetch<{ id: string, name: string, cards: { cardId: string, copies: number }[] }[]>('/api/battler/decks'))
const selectedDeck = ref<string | null>(null)
const deckBuilderOpen = ref(false)
const deckItems = computed(() => [
    { label: 'Full collection', value: null as string | null },
    ...(decks.value ?? []).map(deck => ({ label: `${deck.name} (${deck.cards.length} cards)`, value: deck.id as string | null }))
])
watch(decks, (rows) => {
    if (selectedDeck.value && !rows?.some(deck => deck.id === selectedDeck.value)) selectedDeck.value = null
})
const run = computed(() => view.value?.run ?? null)
const state = computed(() => run.value?.runState ?? null)

function cardOf(cardId: string): RunPoolCard | null {
    return state.value?.pool.find(entry => entry.cardId === cardId) ?? null
}

function itemOf(cardId: string): RunItemCard | null {
    return state.value?.itemPool.find(entry => entry.cardId === cardId) ?? null
}

const stadiumInPlay = computed(() => {
    const stadium = state.value?.stadium
    return stadium ? itemOf(stadium.cardId) : null
})

function renderThumb(render: RunPoolCard['render']) {
    if (render.bundle) return { bundle: render.bundle }
    const legacySet = render.plaatjesCardId ? legacySetOf(render.plaatjesCardId) : null
    return legacySet && render.assetNumber ? { legacySet, assetNumber: render.assetNumber } : null
}

function thumbProps(card: RunPoolCard | null) {
    return card ? renderThumb(card.render) : null
}

const busy = ref(false)
async function act<T>(work: () => Promise<T>): Promise<T | null> {
    if (busy.value) return null
    busy.value = true
    try {
        const result = await work()
        await refresh()
        return result
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not do that'), color: 'error' })
        return null
    } finally {
        busy.value = false
    }
}

const starting = ref(false)
async function start() {
    if (starting.value) return
    starting.value = true
    try {
        await apiFetch('/api/battler/start', { method: 'POST', body: { deckId: selectedDeck.value } })
        await refresh()
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not start'), color: 'error' })
    } finally {
        starting.value = false
    }
}

// ── Buying: pick offer → (attack when several) → board slot ────────────────
const buying = ref<{ offerIndex: number, card: RunPoolCard, attackId: number | null, pendingPosition?: number } | null>(null)

function beginBuy(offerIndex: number) {
    const offer = state.value?.shop[offerIndex]
    if (!offer || !run.value) return
    const card = cardOf(offer.cardId)
    if (!card) return
    if (run.value.cash < card.cost) {
        toast.add({ title: 'Not enough Pokémon Dollars', color: 'error' })
        return
    }
    // Merging into an existing unit needs no slot choice.
    const existing = state.value!.board.find(unit => unit.cardId === card.cardId)
    if (existing) {
        void act(() => apiFetch('/api/battler/buy', { method: 'POST', body: { runId: run.value!.id, offerIndex, attackId: existing.attackId } }))
        return
    }
    buying.value = { offerIndex, card, attackId: card.spec.attacks.length > 1 ? null : card.spec.attacks[0]!.attackId }
}

function placeAt(position: number) {
    if (!buying.value || !run.value) return
    const { offerIndex, attackId } = buying.value
    const chosen = attackId ?? buying.value.card.spec.attacks[0]!.attackId
    buying.value = null
    void act(() => apiFetch('/api/battler/buy', { method: 'POST', body: { runId: run.value!.id, offerIndex, attackId: chosen, position } }))
}

function pickAttack(attackId: number) {
    if (!buying.value) return
    buying.value.attackId = attackId
    // A drag already chose the slot — complete the purchase right away.
    if (buying.value.pendingPosition !== undefined) placeAt(buying.value.pendingPosition)
}

// ── Drag & drop (mirrors the tap flow; taps still work on touch) ───────────
const dragging = ref<{ type: 'offer', offerIndex: number } | { type: 'item', offerIndex: number } | { type: 'unit', key: string } | null>(null)

function dragStart(payload: NonNullable<typeof dragging.value>, event: DragEvent) {
    sellMode.value = false
    dragging.value = payload
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', '')
    }
}

function dropOn(position: number) {
    const drag = dragging.value
    dragging.value = null
    if (!drag || !run.value || !state.value) return
    if (drag.type === 'item') {
        const offer = state.value.itemShop[drag.offerIndex]
        const item = offer ? itemOf(offer.cardId) : null
        if (!offer || !item) return
        if (run.value.cash < item.cost) {
            toast.add({ title: 'Not enough Pokémon Dollars', color: 'error' })
            return
        }
        if (item.spec.subtype === 'tool') {
            const occupant = unitAt(position)
            if (!occupant) {
                toast.add({ title: `Drop ${item.name} on a fielded unit`, color: 'error' })
                return
            }
            void act(() => apiFetch('/api/battler/buy-item', { method: 'POST', body: { runId: run.value!.id, offerIndex: drag.offerIndex, unitKey: occupant.key } }))
            return
        }
        void act(() => apiFetch('/api/battler/buy-item', { method: 'POST', body: { runId: run.value!.id, offerIndex: drag.offerIndex } }))
        return
    }
    if (drag.type === 'unit') {
        if (unitAt(position)?.key !== drag.key) {
            void act(() => apiFetch('/api/battler/move', { method: 'POST', body: { runId: run.value!.id, unitKey: drag.key, position } }))
        }
        return
    }
    const offer = state.value.shop[drag.offerIndex]
    const card = offer ? cardOf(offer.cardId) : null
    if (!offer || !card) return
    if (run.value.cash < card.cost) {
        toast.add({ title: 'Not enough Pokémon Dollars', color: 'error' })
        return
    }
    const existing = state.value.board.find(unit => unit.cardId === card.cardId)
    if (existing) {
        void act(() => apiFetch('/api/battler/buy', { method: 'POST', body: { runId: run.value!.id, offerIndex: drag.offerIndex, attackId: existing.attackId } }))
        return
    }
    if (unitAt(position)) return
    if (card.spec.attacks.length > 1) {
        buying.value = { offerIndex: drag.offerIndex, card, attackId: null, pendingPosition: position }
        return
    }
    buying.value = { offerIndex: drag.offerIndex, card, attackId: card.spec.attacks[0]!.attackId }
    placeAt(position)
}

// ── Items: tools target a unit, the rest resolve immediately ───────────────
const buyingItem = ref<{ offerIndex: number, item: RunItemCard } | null>(null)

function beginBuyItem(offerIndex: number) {
    const offer = state.value?.itemShop[offerIndex]
    if (!offer || !run.value) return
    const item = itemOf(offer.cardId)
    if (!item) return
    if (buyingItem.value?.offerIndex === offerIndex) {
        buyingItem.value = null
        return
    }
    if (run.value.cash < item.cost) {
        toast.add({ title: 'Not enough Pokémon Dollars', color: 'error' })
        return
    }
    if (item.spec.subtype === 'tool') {
        buyingItem.value = { offerIndex, item }
        return
    }
    void act(() => apiFetch('/api/battler/buy-item', { method: 'POST', body: { runId: run.value!.id, offerIndex } }))
}

function attachTo(unitKey: string) {
    if (!buyingItem.value) return
    const { offerIndex } = buyingItem.value
    buyingItem.value = null
    void act(() => apiFetch('/api/battler/buy-item', { method: 'POST', body: { runId: run.value!.id, offerIndex, unitKey } }))
}

function sellAttachment(unitKey: string) {
    void act(() => apiFetch('/api/battler/sell-item', { method: 'POST', body: { runId: run.value!.id, unitKey } }))
}

function sellStadium() {
    void act(() => apiFetch('/api/battler/sell-item', { method: 'POST', body: { runId: run.value!.id, stadium: true } }))
}

// ── Repositioning ──────────────────────────────────────────────────────────
const movingUnit = ref<string | null>(null)
function slotClick(position: number) {
    if (sellMode.value) {
        const occupant = unitAt(position)
        sellMode.value = false
        if (occupant) sell(occupant.key)
        return
    }
    if (buyingItem.value) {
        const occupant = unitAt(position)
        if (occupant) attachTo(occupant.key)
        return
    }
    if (buying.value) {
        if (!unitAt(position)) placeAt(position)
        return
    }
    const occupant = unitAt(position)
    if (movingUnit.value) {
        const key = movingUnit.value
        movingUnit.value = null
        void act(() => apiFetch('/api/battler/move', { method: 'POST', body: { runId: run.value!.id, unitKey: key, position } }))
    } else if (occupant) {
        movingUnit.value = occupant.key
    }
}

function unitAt(position: number): RunBoardUnit | null {
    return state.value?.board.find(unit => unit.position === position) ?? null
}

/** SAP-style hover card: current stats and how far the next merge is. */
function unitInfo(unit: RunBoardUnit) {
    const card = cardOf(unit.cardId)
    if (!card) return null
    const level = levelFor(unit.instances)
    const multiplier = BATTLER.levelMultiplier[level] ?? 1
    const attack = card.spec.attacks.find(entry => entry.attackId === unit.attackId) ?? card.spec.attacks[0]!
    const nextLevel = level < 3 ? level + 1 : null
    const nextAt = nextLevel ? BATTLER.levelThresholds[nextLevel]! : null
    return {
        name: card.name,
        level,
        instances: unit.instances,
        hp: Math.max(1, Math.round(card.spec.hp * multiplier)),
        damage: Math.max(1, Math.round(attack.damage * multiplier)),
        attackName: attack.name,
        charge: attack.charge,
        retreat: card.spec.retreat,
        nextLevel,
        needed: nextAt ? nextAt - unit.instances : 0,
        inPool: card.instancesLeft
    }
}

/** What the sell zone would pay for a unit, attachments included. */
function sellRefundFor(unitKey: string): number {
    const unit = state.value?.board.find(entry => entry.key === unitKey)
    if (!unit) return 0
    const card = cardOf(unit.cardId)
    let refund = card ? Math.max(0, card.cost - 1) * unit.instances : 0
    for (const attached of unit.items) {
        const item = itemOf(attached.cardId)
        if (item) refund += Math.max(0, item.cost - 1)
    }
    return refund
}

const sellZoneActive = computed(() => dragging.value?.type === 'unit' || movingUnit.value !== null)
const sellZonePreview = computed(() => {
    const key = dragging.value?.type === 'unit' ? dragging.value.key : movingUnit.value
    return key ? sellRefundFor(key) : null
})

function sellZoneDrop() {
    const drag = dragging.value
    dragging.value = null
    if (drag?.type === 'unit') sell(drag.key)
}

/** Plain-button mode: arm the zone, then tap the unit to sell. */
const sellMode = ref(false)

function sellZoneClick() {
    if (movingUnit.value) {
        const key = movingUnit.value
        movingUnit.value = null
        sell(key)
        return
    }
    sellMode.value = !sellMode.value
}

function sell(unitKey: string) {
    movingUnit.value = null
    void act(() => apiFetch('/api/battler/sell', { method: 'POST', body: { runId: run.value!.id, unitKey } }))
}

// ── Fighting ───────────────────────────────────────────────────────────────
const fightResult = ref<FightResult | null>(null)
async function startFight() {
    const result = await act(() => apiFetch<FightResult>('/api/battler/fight', { method: 'POST', body: { runId: run.value!.id } }))
    if (result) fightResult.value = result
}

/** The ending fight, kept for the run-over screen's final board. */
const runOver = ref<FightResult | null>(null)

function fightDone() {
    const last = fightResult.value
    fightResult.value = null
    if (last && last.run.state !== 'active') {
        runOver.value = last
        void refreshHistory()
    }
    void refresh()
}

function historyDate(row: HistoryRow): string {
    return new Date(row.finishedAt ?? row.createdAt).toLocaleDateString()
}

async function abandon() {
    await act(() => apiFetch('/api/battler/abandon', { method: 'POST', body: { runId: run.value!.id } }))
    void refreshHistory()
}
</script>

<template>
  <div class="mx-auto w-full max-w-7xl space-y-6 p-4">
    <!-- Run over: the result screen. -->
    <UCard v-if="runOver && !run">
      <div class="flex flex-col items-center gap-4 py-6 text-center">
        <UIcon
          :name="runOver.result === 'win' || runOver.run.wins >= BATTLER.winsToComplete ? 'i-lucide-trophy' : 'i-lucide-skull'"
          class="size-12"
          :class="runOver.run.wins >= BATTLER.winsToComplete ? 'text-warning' : 'text-error'"
        />
        <div>
          <h2 class="text-xl font-bold text-highlighted">
            {{ runOver.run.wins >= BATTLER.winsToComplete ? 'Run complete!' : 'Run over' }}
          </h2>
          <p class="mt-1 text-sm text-muted">
            {{ runOver.run.wins }} {{ runOver.run.wins === 1 ? 'win' : 'wins' }} ·
            {{ runOver.run.losses }} {{ runOver.run.losses === 1 ? 'loss' : 'losses' }} ·
            {{ runOver.run.round }} rounds
          </p>
        </div>
        <div class="flex flex-wrap justify-center gap-2">
          <div
            v-for="unit in runOver.myBoard"
            :key="unit.key"
            class="relative w-20"
          >
            <template v-if="renderThumb(unit.render)">
              <TcgCardThumb v-bind="renderThumb(unit.render)!" />
            </template>
            <UBadge
              v-if="levelFor(unit.instances) > 1"
              color="secondary"
              size="sm"
              class="absolute -left-1.5 -top-1.5"
            >
              L{{ levelFor(unit.instances) }}
            </UBadge>
          </div>
        </div>
        <p class="text-xs text-muted">Your final board is saved — other players will fight it as an opponent.</p>
        <div class="flex items-center gap-2">
          <UButton
            size="lg"
            icon="i-lucide-play"
            label="New run"
            :loading="starting"
            @click="runOver = null; start()"
          />
          <UButton
            size="lg"
            color="neutral"
            variant="subtle"
            label="Done"
            @click="runOver = null"
          />
        </div>
      </div>
    </UCard>

    <!-- No run: the draft gate. -->
    <UCard v-else-if="view && !run">
      <div class="flex flex-col items-center gap-3 py-6 text-center">
        <UIcon
          name="i-lucide-swords"
          class="size-10 text-primary"
        />
        <h2 class="text-lg font-semibold text-highlighted">Auto-battler</h2>
        <p class="max-w-md text-sm text-muted">
          A run drafts ten cards from your collection — the more copies you own of a card,
          the likelier it drafts, and depth is what merges units to higher levels.
          Purchased cards are locked for the run and released when it ends.
        </p>
        <p class="text-xs text-muted">
          <b class="tabular-nums text-highlighted">{{ view.eligibleCards ?? 0 }}</b> of your cards are battle-ready
          <span v-if="view.eligibleItems"> · <b class="tabular-nums text-highlighted">{{ view.eligibleItems }}</b> Trainers</span>
        </p>
        <div class="flex flex-wrap items-center justify-center gap-2">
          <USelect
            v-model="selectedDeck"
            :items="deckItems"
            value-key="value"
            class="w-56"
          />
          <UButton
            size="lg"
            icon="i-lucide-play"
            label="Start a run"
            :loading="starting"
            @click="start"
          />
        </div>
        <UButton
          size="sm"
          color="neutral"
          variant="subtle"
          icon="i-lucide-layers"
          label="Manage decks"
          @click="deckBuilderOpen = true"
        />
      </div>
    </UCard>

    <template v-else-if="run && state">
      <!-- Header: the run at a glance. -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <UBadge
            color="neutral"
            variant="subtle"
          >Round {{ run.round }}</UBadge>
          <span class="flex items-center gap-1 text-sm">
            <UIcon
              name="i-lucide-badge-dollar-sign"
              class="size-4 text-warning"
            />
            <span class="text-muted">₱</span><b class="tabular-nums text-highlighted">{{ run.cash }}</b>
          </span>
          <UTooltip
            v-if="stadiumInPlay"
            :text="`${stadiumInPlay.name} — ${stadiumInPlay.spec.text} (both teams). Click to sell.`"
          >
            <UBadge
              color="neutral"
              variant="subtle"
              class="cursor-pointer"
              @click="sellStadium"
            >🏟️ {{ stadiumInPlay.name }}</UBadge>
          </UTooltip>
          <UBadge
            v-if="state.nextBattle && (state.nextBattle.atk > 0 || state.nextBattle.hp > 0)"
            color="warning"
            variant="subtle"
          >
            Next battle{{ state.nextBattle.atk ? ` +${state.nextBattle.atk} atk` : '' }}{{ state.nextBattle.hp ? ` +${state.nextBattle.hp} HP` : '' }}
          </UBadge>
          <span class="flex items-center gap-0.5">
            <UIcon
              v-for="w in BATTLER.winsToComplete"
              :key="w"
              name="i-lucide-trophy"
              class="size-3.5"
              :class="w <= run.wins ? 'text-warning' : 'text-elevated'"
            />
          </span>
          <span class="flex items-center gap-0.5">
            <UIcon
              v-for="l in BATTLER.maxLosses"
              :key="l"
              name="i-lucide-heart"
              class="size-4"
              :class="l <= BATTLER.maxLosses - run.losses ? 'text-error' : 'text-elevated'"
            />
          </span>
        </div>
        <div class="flex items-center gap-2">
          <!-- The sell zone: drag a unit here, or select one and tap. -->
          <div class="relative">
            <div
              class="flex items-center gap-1.5 rounded-lg border-2 border-dashed px-3 py-1.5 transition"
              :class="[
                sellMode ? 'cursor-pointer border-error bg-error/15 text-error'
                : sellZoneActive ? 'cursor-pointer border-error/70 bg-error/5 text-error'
                  : 'cursor-pointer border-default text-dimmed hover:border-error/50 hover:text-error',
                dragging?.type === 'unit' && 'invisible'
              ]"
              @click="sellZoneClick"
            >
              <UIcon
                name="i-lucide-banknote"
                class="size-4"
              />
              <span class="text-xs font-semibold uppercase tracking-wider">Sell</span>
              <span
                v-if="sellZonePreview !== null"
                class="text-xs font-bold tabular-nums"
              >+₱{{ sellZonePreview }}</span>
              <span
                v-else-if="sellMode"
                class="text-[10px]"
              >tap a unit</span>
            </div>
            <!-- While a unit drags, the target expands to card size so the
                 ghost visibly sits inside the selling frame. -->
            <div
              v-if="dragging?.type === 'unit'"
              class="absolute -top-2 right-0 z-30 flex aspect-[0.718] w-40 flex-col items-center justify-center gap-1.5 rounded-xl border-4 border-dashed border-error/70 bg-error/5 text-error shadow-lg transition [&.drag-over]:scale-105 [&.drag-over]:border-solid [&.drag-over]:border-error [&.drag-over]:bg-error/20"
              @dragover.prevent
              @dragenter="($event.currentTarget as HTMLElement).classList.add('drag-over')"
              @dragleave="($event.currentTarget as HTMLElement).classList.remove('drag-over')"
              @drop.prevent="($event.currentTarget as HTMLElement).classList.remove('drag-over'); sellZoneDrop()"
            >
              <UIcon
                name="i-lucide-banknote"
                class="size-8"
              />
              <span class="text-sm font-bold uppercase tracking-widest">Sell</span>
              <span
                v-if="sellZonePreview !== null"
                class="text-base font-black tabular-nums"
              >+₱{{ sellZonePreview }}</span>
            </div>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            label="Abandon"
            @click="abandon"
          />
          <UButton
            color="primary"
            size="sm"
            icon="i-lucide-swords"
            label="Fight!"
            :disabled="state.board.length === 0 || busy"
            @click="startFight"
          />
        </div>
      </div>

      <!-- The shop track. -->
      <section>
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">Shop</h2>
          <UButton
            color="neutral"
            variant="subtle"
            size="xs"
            icon="i-lucide-dices"
            :label="state.freeRerolls > 0 ? `Reroll free (${state.freeRerolls})` : `Reroll ₱${BATTLER.rerollCost}`"
            :disabled="(state.freeRerolls === 0 && run.cash < BATTLER.rerollCost) || busy"
            @click="act(() => apiFetch('/api/battler/reroll', { method: 'POST', body: { runId: run!.id } }))"
          />
        </div>
        <div class="flex flex-wrap gap-3">
          <div
            v-for="(offer, index) in state.shop"
            :key="`${index}-${offer.cardId}`"
            class="w-36 lg:w-44"
          >
            <div
              class="relative cursor-grab rounded-lg p-1.5 transition [&_img]:pointer-events-none"
              :class="[
                offer.frozen ? 'bg-info/15 ring-1 ring-info' : 'bg-elevated hover:ring-1 hover:ring-primary',
                buying?.offerIndex === index && 'ring-2 ring-primary'
              ]"
              draggable="true"
              @dragstart="dragStart({ type: 'offer', offerIndex: index }, $event)"
              @dragend="dragging = null"
              @click="beginBuy(index)"
            >
              <template v-if="thumbProps(cardOf(offer.cardId))">
                <TcgCardThumb v-bind="thumbProps(cardOf(offer.cardId))!" />
              </template>
              <div
                v-else
                class="flex aspect-[0.718] w-full items-center justify-center rounded bg-default text-[10px] text-muted"
              >
                {{ cardOf(offer.cardId)?.name }}
              </div>
              <UBadge
                color="warning"
                variant="solid"
                size="sm"
                class="absolute -left-1.5 -top-1.5 font-mono"
              >
                ₱{{ cardOf(offer.cardId)?.cost }}
              </UBadge>
            </div>
            <div class="mt-1 flex items-center justify-between px-0.5">
              <span class="truncate text-[10px] text-muted">
                {{ cardOf(offer.cardId)?.spec.hp }}hp · {{ cardOf(offer.cardId)?.spec.attacks[0]?.damage }}atk
              </span>
              <UTooltip :text="offer.frozen ? 'Unfreeze — this offer rerolls normally again' : 'Freeze — keep this offer through rerolls and the next round'">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-snowflake"
                  :class="offer.frozen ? 'text-info' : 'text-dimmed'"
                  @click.stop="act(() => apiFetch('/api/battler/freeze', { method: 'POST', body: { runId: run!.id, offerIndex: index } }))"
                />
              </UTooltip>
            </div>
          </div>
        </div>
        <!-- Attack picker for multi-attack cards. -->
        <div
          v-if="buying && buying.attackId === null"
          class="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-elevated px-3 py-2"
        >
          <span class="text-xs text-muted">Lock an attack for the run:</span>
          <UButton
            v-for="attack in buying.card.spec.attacks"
            :key="attack.attackId"
            size="xs"
            color="neutral"
            variant="subtle"
            :label="`${attack.name} — ${attack.damage} dmg, ${attack.charge}⚡`"
            @click="pickAttack(attack.attackId)"
          />
        </div>
        <p
          v-else-if="buying"
          class="mt-2 text-xs text-primary"
        >
          Tap an empty slot to field {{ buying.card.name }} — or tap the offer again to cancel.
        </p>
        <template v-if="state.itemShop.length > 0">
          <h2 class="mb-2 mt-4 text-sm font-semibold uppercase tracking-wider text-muted">Trainers</h2>
          <div class="flex flex-wrap gap-3">
            <div
              v-for="(offer, index) in state.itemShop"
              :key="`${index}-${offer.cardId}`"
              class="w-32"
            >
              <div
                class="relative cursor-grab rounded-lg p-1.5 transition [&_img]:pointer-events-none"
                :class="buyingItem?.offerIndex === index ? 'ring-2 ring-primary' : 'bg-elevated hover:ring-1 hover:ring-primary'"
                draggable="true"
                @dragstart="dragStart({ type: 'item', offerIndex: index }, $event)"
                @dragend="dragging = null"
                @click="beginBuyItem(index)"
              >
                <template v-if="itemOf(offer.cardId) && renderThumb(itemOf(offer.cardId)!.render)">
                  <TcgCardThumb v-bind="renderThumb(itemOf(offer.cardId)!.render)!" />
                </template>
                <div
                  v-else
                  class="flex aspect-[0.718] w-full items-center justify-center rounded bg-default text-[10px] text-muted"
                >
                  {{ itemOf(offer.cardId)?.name }}
                </div>
                <UBadge
                  color="warning"
                  variant="solid"
                  size="sm"
                  class="absolute -left-1.5 -top-1.5 font-mono"
                >
                  ₱{{ itemOf(offer.cardId)?.cost }}
                </UBadge>
                <UBadge
                  color="neutral"
                  size="sm"
                  class="absolute -right-1.5 -top-1.5"
                >
                  {{ ITEM_GLYPH[itemOf(offer.cardId)?.spec.subtype ?? 'tool'] }}
                </UBadge>
              </div>
              <p class="mt-1 truncate px-0.5 text-[10px] text-muted">
                {{ itemOf(offer.cardId)?.spec.text }}
              </p>
            </div>
          </div>
          <p
            v-if="buyingItem"
            class="mt-2 text-xs text-primary"
          >
            Tap a fielded unit to attach {{ buyingItem.item.name }} — or tap the offer again to cancel.
          </p>
        </template>
      </section>

      <!-- The board: active + bench. -->
      <section>
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">Board</h2>
          <span class="text-xs text-muted">moves left: <b class="tabular-nums text-highlighted">{{ state.repositionLeft }}</b></span>
        </div>
        <div class="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <div
            v-for="position in BATTLER.boardSlots"
            :key="position - 1"
          >
            <p class="mb-1 text-center text-[10px] uppercase tracking-wider text-dimmed">
              {{ position - 1 === 0 ? 'Active' : `Bench ${position - 1}` }}
            </p>
            <div
              class="relative cursor-pointer rounded-lg transition"
              :class="[
                movingUnit === unitAt(position - 1)?.key && 'ring-2 ring-primary',
                dragging?.type === 'item' && unitAt(position - 1) && 'ring-2 ring-primary/60',
                position - 1 === 0 && 'ring-1 ring-warning/40'
              ]"
              @click="slotClick(position - 1)"
              @dragover.prevent
              @drop.prevent="dropOn(position - 1)"
            >
              <template v-if="unitAt(position - 1)">
                <UPopover
                  mode="hover"
                  :open-delay="250"
                  :content="{ side: 'top' }"
                >
                  <template #content>
                    <div
                      v-if="unitInfo(unitAt(position - 1)!)"
                      class="w-52 space-y-1.5 p-3 text-xs"
                    >
                      <p class="flex items-center justify-between font-semibold text-highlighted">
                        {{ unitInfo(unitAt(position - 1)!)!.name }}
                        <UBadge
                          color="secondary"
                          variant="subtle"
                          size="sm"
                        >L{{ unitInfo(unitAt(position - 1)!)!.level }}</UBadge>
                      </p>
                      <p class="text-muted">
                        {{ unitInfo(unitAt(position - 1)!)!.hp }} HP ·
                        {{ unitInfo(unitAt(position - 1)!)!.attackName }}
                        {{ unitInfo(unitAt(position - 1)!)!.damage }} dmg ·
                        {{ unitInfo(unitAt(position - 1)!)!.charge }}⚡ charge
                      </p>
                      <p
                        v-if="unitInfo(unitAt(position - 1)!)!.nextLevel"
                        class="text-primary"
                      >
                        {{ unitInfo(unitAt(position - 1)!)!.needed }} more
                        {{ unitInfo(unitAt(position - 1)!)!.needed === 1 ? 'copy' : 'copies' }}
                        to L{{ unitInfo(unitAt(position - 1)!)!.nextLevel }}
                        <span class="text-muted">({{ unitInfo(unitAt(position - 1)!)!.inPool }} left in your draft)</span>
                      </p>
                      <p
                        v-else
                        class="text-warning"
                      >Max level</p>
                      <p class="text-dimmed">Retreat {{ unitInfo(unitAt(position - 1)!)!.retreat }} — moving costs that much budget</p>
                    </div>
                  </template>
                <div
                  class="relative cursor-grab [&_img]:pointer-events-none"
                  draggable="true"
                  @dragstart="dragStart({ type: 'unit', key: unitAt(position - 1)!.key }, $event)"
                  @dragend="dragging = null"
                >
                  <template v-if="thumbProps(cardOf(unitAt(position - 1)!.cardId))">
                    <TcgCardThumb v-bind="thumbProps(cardOf(unitAt(position - 1)!.cardId))!" />
                  </template>
                  <div
                    v-else
                    class="flex aspect-[0.718] w-full items-center justify-center rounded bg-elevated text-[10px] text-muted"
                  >
                    {{ cardOf(unitAt(position - 1)!.cardId)?.name }}
                  </div>
                  <UBadge
                    v-if="levelFor(unitAt(position - 1)!.instances) > 1"
                    color="secondary"
                    variant="solid"
                    size="sm"
                    class="absolute -left-1.5 -top-1.5"
                  >
                    L{{ levelFor(unitAt(position - 1)!.instances) }}
                  </UBadge>
                  <UBadge
                    color="neutral"
                    size="sm"
                    class="absolute -right-1.5 -top-1.5 tabular-nums"
                  >
                    ×{{ unitAt(position - 1)!.instances }}
                  </UBadge>
                  <UTooltip
                    v-if="unitAt(position - 1)!.items.length > 0"
                    :text="`${unitAt(position - 1)!.items[0]!.name} — ${itemOf(unitAt(position - 1)!.items[0]!.cardId)?.spec.text ?? ''}. Click to sell.`"
                  >
                    <UButton
                      color="neutral"
                      variant="soft"
                      size="xs"
                      class="absolute bottom-1 left-1"
                      @click.stop="sellAttachment(unitAt(position - 1)!.key)"
                    >🔧</UButton>
                  </UTooltip>
                </div>
                </UPopover>
              </template>
              <div
                v-else
                class="flex aspect-[0.718] w-full items-center justify-center rounded-lg border-2 border-dashed border-default"
                :class="(buying || movingUnit || dragging) && 'hover:border-primary [&.drag-over]:border-primary'"
                @dragenter="($event.currentTarget as HTMLElement).classList.add('drag-over')"
                @dragleave="($event.currentTarget as HTMLElement).classList.remove('drag-over')"
                @drop="($event.currentTarget as HTMLElement).classList.remove('drag-over')"
              >
                <UIcon
                  v-if="buying || movingUnit || dragging"
                  name="i-lucide-plus"
                  class="size-5 text-dimmed"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- The drafted pool, for planning. -->
      <section>
        <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Your draft</h2>
        <div class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="card in state.pool"
            :key="card.cardId"
            color="neutral"
            variant="subtle"
            size="sm"
          >
            {{ card.name }} <span class="ml-1 tabular-nums text-dimmed">×{{ card.instancesLeft }}</span>
          </UBadge>
          <UBadge
            v-for="item in state.itemPool"
            :key="item.cardId"
            color="neutral"
            variant="outline"
            size="sm"
          >
            {{ ITEM_GLYPH[item.spec.subtype] }} {{ item.name }} <span class="ml-1 tabular-nums text-dimmed">×{{ item.instancesLeft }}</span>
          </UBadge>
        </div>
      </section>
    </template>

    <!-- Past runs. -->
    <UCard v-if="!run && history && history.length > 0">
      <h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Past runs</h2>
      <ul class="divide-y divide-default">
        <li
          v-for="row in history"
          :key="row.id"
          class="flex items-center justify-between gap-3 py-2 text-sm"
        >
          <div class="flex items-center gap-2.5">
            <UBadge
              :color="row.state === 'won' ? 'success' : row.state === 'lost' ? 'error' : 'neutral'"
              variant="subtle"
              class="w-24 justify-center capitalize"
            >
              {{ row.state }}
            </UBadge>
            <span class="tabular-nums text-highlighted">{{ row.wins }}–{{ row.losses }}</span>
            <span class="text-muted">{{ row.round }} {{ row.round === 1 ? 'round' : 'rounds' }}</span>
            <span
              v-if="row.deckName"
              class="text-xs text-dimmed"
            >· {{ row.deckName }}</span>
          </div>
          <span class="text-xs text-dimmed">{{ historyDate(row) }}</span>
        </li>
      </ul>
    </UCard>

    <TcgBattlerDeckBuilder
      v-model:open="deckBuilderOpen"
      @saved="refreshDecks"
    />

    <!-- The fight overlay. -->
    <UModal
      :open="fightResult !== null"
      :dismissible="false"
      :ui="{ content: 'w-[min(96rem,calc(100vw-2rem))] max-w-none' }"
    >
      <template #content>
        <div class="p-5">
          <TcgBattlerFight
            v-if="fightResult"
            :my-board="fightResult.myBoard"
            :opponent-name="fightResult.opponent.name"
            :opponent-board="fightResult.opponent.board"
            :seed="fightResult.seed"
            :result="fightResult.result"
            :stadium="fightResult.stadium"
            @done="fightDone"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
