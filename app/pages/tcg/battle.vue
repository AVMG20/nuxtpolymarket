<script setup lang="ts">
/**
 * The auto-battler (§12): draft from your collection, build in the shop,
 * fight snapshots. Slice 1 is units only, unranked, escrow live.
 */
import type { RunState, RunPoolCard, RunBoardUnit, FightResult } from '~~/server/utils/battler/run'
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

const toast = useToast()
const { data: view, refresh } = useAsyncData('battler-state', () => apiFetch<{ run: RunRow | null, eligibleCards: number | null }>('/api/battler/state'))
const run = computed(() => view.value?.run ?? null)
const state = computed(() => run.value?.runState ?? null)

function cardOf(cardId: string): RunPoolCard | null {
    return state.value?.pool.find(entry => entry.cardId === cardId) ?? null
}

function thumbProps(card: RunPoolCard | null) {
    if (!card) return null
    if (card.render.bundle) return { bundle: card.render.bundle }
    const legacySet = card.render.plaatjesCardId ? legacySetOf(card.render.plaatjesCardId) : null
    return legacySet && card.render.assetNumber ? { legacySet, assetNumber: card.render.assetNumber } : null
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
        await apiFetch('/api/battler/start', { method: 'POST' })
        await refresh()
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not start'), color: 'error' })
    } finally {
        starting.value = false
    }
}

// ── Buying: pick offer → (attack when several) → board slot ────────────────
const buying = ref<{ offerIndex: number, card: RunPoolCard, attackId: number | null } | null>(null)

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

// ── Repositioning ──────────────────────────────────────────────────────────
const movingUnit = ref<string | null>(null)
function slotClick(position: number) {
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

function fightDone() {
    fightResult.value = null
    void refresh()
}

async function abandon() {
    await act(() => apiFetch('/api/battler/abandon', { method: 'POST', body: { runId: run.value!.id } }))
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-5 p-4">
    <!-- No run: the draft gate. -->
    <UCard v-if="view && !run">
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
          <span class="text-dimmed">(vintage cards need stats before they can fight)</span>
        </p>
        <UButton
          size="lg"
          icon="i-lucide-play"
          label="Start a run"
          :loading="starting"
          @click="start"
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
            <b class="tabular-nums text-highlighted">₱{{ run.cash }}</b>
          </span>
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
            :label="`Reroll ₱${BATTLER.rerollCost}`"
            :disabled="run.cash < BATTLER.rerollCost || busy"
            @click="act(() => apiFetch('/api/battler/reroll', { method: 'POST', body: { runId: run!.id } }))"
          />
        </div>
        <div class="flex flex-wrap gap-3">
          <div
            v-for="(offer, index) in state.shop"
            :key="`${index}-${offer.cardId}`"
            class="w-28"
          >
            <div
              class="relative cursor-pointer rounded-lg p-1.5 transition"
              :class="[
                offer.frozen ? 'bg-info/15 ring-1 ring-info' : 'bg-elevated hover:ring-1 hover:ring-primary',
                buying?.offerIndex === index && 'ring-2 ring-primary'
              ]"
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
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="offer.frozen ? 'i-lucide-snowflake' : 'i-lucide-snowflake'"
                :class="offer.frozen ? 'text-info' : 'text-dimmed'"
                @click.stop="act(() => apiFetch('/api/battler/freeze', { method: 'POST', body: { runId: run!.id, offerIndex: index } }))"
              />
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
            @click="buying!.attackId = attack.attackId"
          />
        </div>
        <p
          v-else-if="buying"
          class="mt-2 text-xs text-primary"
        >
          Tap an empty slot to field {{ buying.card.name }} — or tap the offer again to cancel.
        </p>
      </section>

      <!-- The board: active + bench. -->
      <section>
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">Board</h2>
          <span class="text-xs text-muted">moves left: <b class="tabular-nums text-highlighted">{{ state.repositionLeft }}</b></span>
        </div>
        <div class="flex gap-2">
          <div
            v-for="position in BATTLER.boardSlots"
            :key="position - 1"
            class="w-24"
          >
            <p class="mb-1 text-center text-[10px] uppercase tracking-wider text-dimmed">
              {{ position - 1 === 0 ? 'Active' : `Bench ${position - 1}` }}
            </p>
            <div
              class="relative cursor-pointer rounded-lg transition"
              :class="[
                movingUnit === unitAt(position - 1)?.key && 'ring-2 ring-primary',
                position - 1 === 0 && 'ring-1 ring-warning/40'
              ]"
              @click="slotClick(position - 1)"
            >
              <template v-if="unitAt(position - 1)">
                <div class="relative">
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
                  <UButton
                    color="error"
                    variant="soft"
                    size="xs"
                    icon="i-lucide-banknote"
                    class="absolute bottom-1 right-1"
                    @click.stop="sell(unitAt(position - 1)!.key)"
                  />
                </div>
              </template>
              <div
                v-else
                class="flex aspect-[0.718] w-full items-center justify-center rounded-lg border-2 border-dashed border-default"
                :class="(buying || movingUnit) && 'hover:border-primary'"
              >
                <UIcon
                  v-if="buying || movingUnit"
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
        </div>
      </section>
    </template>

    <!-- The fight overlay. -->
    <UModal
      :open="fightResult !== null"
      :dismissible="false"
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
            @done="fightDone"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
