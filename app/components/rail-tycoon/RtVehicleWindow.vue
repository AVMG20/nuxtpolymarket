<script setup lang="ts">
// Rail Tycoon — one vehicle's window: model, age, reliability, breakdowns, value, profit, cargo
// aboard and capacity; the orders list with add station and add depot (each a click on the map
// through RtTools pick mode), remove, move up and down and the full load, unload and no
// unloading flags, sent as setOrders after validateOrders passes; Start or Stop, Send to depot,
// Reverse for trains and Sell, which only works stopped in a depot. A follow toggle keeps the
// camera on it. Another company's vehicle shows the same facts, read only.
import { RtCommandKind, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import { RT_MAX_ORDERS, rtOrdersToggleFlag, validateOrders } from '#shared/utils/rail-tycoon/orders'
import { RtOrderFlag, RtOrderKind, RtVehicleKind, RtVehicleState, type RtOrder } from '#shared/utils/rail-tycoon/types'
import { rtVehicleSellValue } from '#shared/utils/rail-tycoon/vehicles'
import RtWindow from './RtWindow.vue'
import { rtVehicleBadge } from '~/utils/rail-tycoon/vehicle-draw'
import { RtToolKind, type RtPicked, type RtPickKind } from '~/utils/rail-tycoon/tools'
import { rtCompanyCss, rtFormatMoney, useRtGame, useRtWindows } from '~/utils/rail-tycoon/windows'
import { rtConsistSummary, rtConsistText } from '~/utils/rail-tycoon/buy-view'
import {
  rtOrderErrorText,
  rtOrdersInsert,
  rtOrdersMove,
  rtOrdersRemove,
  rtOrderText,
  rtReliabilityPercent,
  rtVehicleCargo,
  rtVehicleName,
  rtVehicleStatus
} from '~/utils/rail-tycoon/vehicle-view'
import { rtAgeText } from '~/utils/rail-tycoon/view-format'

const props = withDefaults(defineProps<{
  windowKey: string
  /** The vehicle id. */
  id?: number | null
}>(), {
  id: null
})

const game = useRtGame()
const windows = useRtWindows()
const toast = useToast()
const pickOwner = game.orderPickOwner

const selected = ref(-1)
const follow = ref(false)
const pickKind = ref<RtPickKind | null>(null)
const picking = computed(() => pickOwner.value === props.windowKey ? pickKind.value : null)

/** Whether the command would pass its rule now, tried without applying it. */
function allowed(command: RtCommand): boolean {
  return game.tryCommand(command)?.ok === true
}

const view = computed(() => {
  void game.tick.value
  void game.status.value
  const ls = game.lockstep.value
  if (!ls || props.id === null) return null
  const world = ls.world
  const vehicle = world.vehicle(props.id)
  if (!vehicle) return null
  const owner = world.company(vehicle.owner)
  const mine = game.companyId.value !== null && vehicle.owner === game.companyId.value
  const can = mine && game.canCommand()
  const crashed = vehicle.state === RtVehicleState.crashed
  const inDepot = vehicle.state === RtVehicleState.inDepot
  const summary = rtConsistSummary(vehicle.consist)
  return {
    name: rtVehicleName(vehicle),
    ownerName: owner?.name ?? 'No company',
    accent: owner ? rtCompanyCss(owner.colour) : null,
    mine,
    isTrain: vehicle.kind === RtVehicleKind.rail,
    badge: rtVehicleBadge(vehicle),
    status: rtVehicleStatus(world, vehicle),
    model: rtConsistText(vehicle.consist),
    speed: vehicle.speed,
    maxSpeed: summary.maxSpeed,
    runningCost: summary.runningCost,
    age: rtAgeText(vehicle.age),
    value: vehicle.value,
    reliability: rtReliabilityPercent(vehicle.reliability),
    breakdowns: vehicle.breakdownsSinceService,
    profitThisYear: vehicle.profitThisYear,
    profitLastYear: vehicle.profitLastYear,
    cargo: rtVehicleCargo(vehicle),
    stopped: vehicle.stopped,
    haltInDepot: vehicle.haltInDepot,
    orders: vehicle.orders.map((order, k) => ({
      key: `${k}:${order.kind}:${order.target}:${order.flags}`,
      text: rtOrderText(world, order),
      current: k === vehicle.orderIndex,
      station: order.kind === RtOrderKind.gotoStation,
      foreign: order.kind === RtOrderKind.gotoStation
        ? world.station(order.target)?.owner !== vehicle.owner
        : world.map.validTile(order.target) && world.map.owner[order.target] !== vehicle.owner,
      flags: order.flags
    })),
    can: can && !crashed,
    canStartStop: can && allowed({ kind: RtCommandKind.startStop, vehicle: vehicle.id, stopped: !vehicle.stopped }),
    // sendToDepot's rule runs a pathfinder search: judge it by state, the server has the last word
    canDepot: can && !crashed && !inDepot,
    canReverse: can && vehicle.kind === RtVehicleKind.rail && allowed({ kind: RtCommandKind.reverseTrain, vehicle: vehicle.id }),
    canSell: can && allowed({ kind: RtCommandKind.sellVehicle, vehicle: vehicle.id }),
    sellValue: rtVehicleSellValue(vehicle),
    head: vehicle.tiles[0] ?? null
  }
})

// a sold, crashed and cleared or otherwise removed vehicle closes its window
watch(view, (next) => {
  if (game.lockstep.value && !next) windows.close(props.windowKey)
})

const selectedOrder = computed(() => {
  const v = view.value
  return v && selected.value >= 0 ? v.orders[selected.value] ?? null : null
})

watch(() => view.value?.orders.length ?? 0, (length) => {
  if (selected.value >= length) selected.value = length - 1
})

// ─── Commands ────────────────────────────────────────────────────────────

function send(command: RtCommand) {
  game.sendCommandOrWarn(command)
}

function startStop() {
  const v = view.value
  if (!v || props.id === null) return
  send({ kind: RtCommandKind.startStop, vehicle: props.id, stopped: !v.stopped })
}

function sendToDepot() {
  if (props.id !== null) send({ kind: RtCommandKind.sendToDepot, vehicle: props.id })
}

function reverse() {
  if (props.id !== null) send({ kind: RtCommandKind.reverseTrain, vehicle: props.id })
}

function sell() {
  if (props.id !== null) send({ kind: RtCommandKind.sellVehicle, vehicle: props.id })
}

/** Checks a new order list with the server's own rule first, so a refusal shows here and nothing is sent. */
function setOrders(next: RtOrder[]): boolean {
  const ls = game.lockstep.value
  const vehicle = props.id !== null ? ls?.world.vehicle(props.id) : undefined
  if (!ls || !vehicle) return false
  const world = ls.world
  const checked = validateOrders(next, world.stations, world.map, vehicle.owner, world.settings.sharing, vehicle)
  if (!checked.ok) {
    toast.add({ title: rtOrderErrorText(checked.error), color: 'error' })
    return false
  }
  send({ kind: RtCommandKind.setOrders, vehicle: vehicle.id, orders: checked.orders })
  return true
}

function currentOrders(): RtOrder[] {
  const vehicle = props.id !== null ? game.lockstep.value?.world.vehicle(props.id) : undefined
  return vehicle ? vehicle.orders : []
}

function removeOrder() {
  if (selected.value < 0) return
  if (setOrders(rtOrdersRemove(currentOrders(), selected.value))) selected.value = Math.min(selected.value, currentOrders().length - 2)
}

function moveOrder(delta: -1 | 1) {
  const orders = currentOrders()
  const to = selected.value + delta
  if (selected.value < 0 || to < 0 || to >= orders.length) return
  if (setOrders(rtOrdersMove(orders, selected.value, delta))) selected.value = to
}

function toggleFlag(flag: number) {
  if (selected.value < 0) return
  setOrders(rtOrdersToggleFlag(currentOrders(), selected.value, flag))
}

function hasFlag(flag: number): boolean {
  return ((selectedOrder.value?.flags ?? 0) & flag) !== 0
}

// ─── Picking a station or depot on the map ───────────────────────

function startPick(kind: RtPickKind) {
  if (!view.value?.can) return
  if (picking.value === kind) {
    stopPick()
    return
  }
  pickOwner.value = props.windowKey
  pickKind.value = kind
  game.tools.enterPick([kind])
  // the map's Escape leaves pick mode; a focused button in here would close the window instead
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

/** Leaves pick mode the way Escape does, back to the tool chosen before. */
function stopPick() {
  if (pickOwner.value !== props.windowKey) return
  pickOwner.value = null
  pickKind.value = null
  if (game.tools.tool === RtToolKind.pick) game.tools.key('Escape')
}

function onPicked(picked: RtPicked) {
  if (pickOwner.value !== props.windowKey) return
  pickOwner.value = null
  pickKind.value = null
  const order: RtOrder = picked.kind === 'station'
    ? { kind: RtOrderKind.gotoStation, target: picked.id, flags: 0 }
    : { kind: RtOrderKind.gotoDepot, target: picked.id, flags: 0 }
  const orders = currentOrders()
  const at = selected.value >= 0 && selected.value < orders.length ? selected.value + 1 : orders.length
  if (setOrders(rtOrdersInsert(orders, selected.value, order))) selected.value = at
}

function onPickEnd() {
  if (pickOwner.value === props.windowKey) pickOwner.value = null
  pickKind.value = null
}

// ─── Camera ──────────────────────────────────────────────────────────────

function centre() {
  const head = view.value?.head
  if (head !== null && head !== undefined) game.centreOnTile(head)
}

watch(() => game.tick.value, () => {
  if (follow.value) centre()
})

watch(follow, (on) => {
  if (on) centre()
})

const offs: (() => void)[] = []

onMounted(() => {
  offs.push(game.tools.on('picked', onPicked), game.tools.on('pickEnd', onPickEnd))
})

onBeforeUnmount(() => {
  stopPick()
  for (const off of offs) off()
  offs.length = 0
})
</script>

<template>
  <RtWindow
    :title="view?.name ?? 'Vehicle'"
    :window-key="windowKey"
    :accent="view?.accent ?? null"
  >
    <template v-if="view" #actions>
      <button
        type="button"
        class="rt-veh-bar-btn"
        :class="{ 'rt-veh-bar-on': follow }"
        :aria-pressed="follow"
        :title="follow ? 'Stop following' : 'Follow with the view'"
        @click="follow = !follow"
      >
        <UIcon name="i-lucide-crosshair" class="size-3.5" />
      </button>
      <button type="button" class="rt-veh-bar-btn" title="Centre the view on it" @click="centre">
        <UIcon name="i-lucide-locate" class="size-3.5" />
      </button>
    </template>

    <div v-if="view" class="rt-veh">
      <div class="rt-veh-status">
        <span v-if="view.badge" class="rt-veh-badge">{{ view.badge === 'parked' ? 'Parked' : 'Parking' }}</span>
        <span>{{ view.status }}</span>
        <span v-if="view.speed > 0" class="rt-veh-speed">{{ view.speed }} km/h</span>
      </div>

      <dl class="rt-veh-facts">
        <dt>Model</dt>
        <dd>{{ view.model }}</dd>
        <template v-if="!view.mine">
          <dt>Owner</dt>
          <dd>{{ view.ownerName }}</dd>
        </template>
        <dt>Age</dt>
        <dd>{{ view.age }}</dd>
        <dt>Max speed</dt>
        <dd>{{ view.maxSpeed }} km/h</dd>
        <dt>Reliability</dt>
        <dd>{{ view.reliability }}%</dd>
        <dt>Breakdowns</dt>
        <dd>{{ view.breakdowns }} since last service</dd>
        <dt>Value</dt>
        <dd>{{ rtFormatMoney(view.value) }}</dd>
        <dt>Running cost</dt>
        <dd>{{ rtFormatMoney(view.runningCost) }}/yr</dd>
        <dt>Profit this year</dt>
        <dd :class="{ 'rt-veh-neg': view.profitThisYear < 0 }">{{ rtFormatMoney(view.profitThisYear) }}</dd>
        <dt>Profit last year</dt>
        <dd :class="{ 'rt-veh-neg': view.profitLastYear < 0 }">{{ rtFormatMoney(view.profitLastYear) }}</dd>
        <template v-for="cargo in view.cargo" :key="cargo.cargo">
          <dt>{{ cargo.name }}</dt>
          <dd>{{ cargo.aboard }} of {{ cargo.capacity }}</dd>
        </template>
      </dl>

      <section class="rt-veh-orders" aria-label="Orders">
        <div class="rt-veh-orders-head">
          <span>Orders</span>
          <span class="rt-veh-orders-count">{{ view.orders.length }} / {{ RT_MAX_ORDERS }}</span>
        </div>
        <ol v-if="view.orders.length > 0" class="rt-veh-order-list">
          <li v-for="(order, k) in view.orders" :key="order.key">
            <button
              type="button"
              class="rt-veh-order"
              :class="{ 'rt-veh-order-on': selected === k, 'rt-veh-order-current': order.current }"
              :aria-current="order.current ? 'step' : undefined"
              :disabled="!view.can"
              @click="selected = selected === k ? -1 : k"
            >
              <span class="rt-veh-order-num">{{ k + 1 }}</span>
              <span>{{ order.text }}</span>
            </button>
          </li>
        </ol>
        <p v-else class="rt-veh-muted">No orders: the vehicle wanders.</p>
        <p v-if="picking" class="rt-veh-picking">
          <UIcon name="i-lucide-mouse-pointer-click" class="size-3.5" />
          Click {{ picking === 'station' ? 'a station' : 'a depot' }} on the map (Escape cancels)
        </p>

        <div v-if="view.can" class="rt-veh-order-tools">
          <button
            type="button"
            class="rt-veh-btn"
            :class="{ 'rt-veh-btn-on': picking === 'station' }"
            :disabled="view.orders.length >= RT_MAX_ORDERS"
            @click="startPick('station')"
          >
            Go to station
          </button>
          <button
            type="button"
            class="rt-veh-btn"
            :class="{ 'rt-veh-btn-on': picking === 'depot' }"
            :disabled="view.orders.length >= RT_MAX_ORDERS"
            @click="startPick('depot')"
          >
            Go to depot
          </button>
          <button type="button" class="rt-veh-btn rt-veh-btn-icon" aria-label="Move order up" :disabled="selected <= 0" @click="moveOrder(-1)">
            <UIcon name="i-lucide-arrow-up" class="size-3.5" />
          </button>
          <button
            type="button"
            class="rt-veh-btn rt-veh-btn-icon"
            aria-label="Move order down"
            :disabled="selected < 0 || selected >= view.orders.length - 1"
            @click="moveOrder(1)"
          >
            <UIcon name="i-lucide-arrow-down" class="size-3.5" />
          </button>
          <button type="button" class="rt-veh-btn" :disabled="selected < 0" @click="removeOrder">
            Delete
          </button>
        </div>
        <div v-if="view.can && selectedOrder?.station" class="rt-veh-order-tools">
          <button
            type="button"
            class="rt-veh-btn"
            :class="{ 'rt-veh-btn-on': hasFlag(RtOrderFlag.fullLoad) }"
            :aria-pressed="hasFlag(RtOrderFlag.fullLoad)"
            :disabled="selectedOrder.foreign && !hasFlag(RtOrderFlag.fullLoad)"
            :title="selectedOrder.foreign ? 'Full load is only allowed at your own stations' : undefined"
            @click="toggleFlag(RtOrderFlag.fullLoad)"
          >
            Full load
          </button>
          <button
            type="button"
            class="rt-veh-btn"
            :class="{ 'rt-veh-btn-on': hasFlag(RtOrderFlag.unload) }"
            :aria-pressed="hasFlag(RtOrderFlag.unload)"
            @click="toggleFlag(RtOrderFlag.unload)"
          >
            Unload all
          </button>
          <button
            type="button"
            class="rt-veh-btn"
            :class="{ 'rt-veh-btn-on': hasFlag(RtOrderFlag.noUnload) }"
            :aria-pressed="hasFlag(RtOrderFlag.noUnload)"
            @click="toggleFlag(RtOrderFlag.noUnload)"
          >
            No unloading
          </button>
        </div>
      </section>

      <div v-if="view.mine" class="rt-veh-actions">
        <button type="button" class="rt-veh-btn rt-veh-btn-main" :disabled="!view.canStartStop" @click="startStop">
          <UIcon :name="view.stopped ? 'i-lucide-play' : 'i-lucide-square'" class="size-3.5" />
          {{ view.stopped ? 'Start' : 'Stop' }}
        </button>
        <button type="button" class="rt-veh-btn" :disabled="!view.canDepot" @click="sendToDepot">
          <UIcon name="i-lucide-warehouse" class="size-3.5" />
          {{ view.haltInDepot ? 'Cancel depot' : 'Send to depot' }}
        </button>
        <button v-if="view.isTrain" type="button" class="rt-veh-btn" :disabled="!view.canReverse" @click="reverse">
          <UIcon name="i-lucide-repeat" class="size-3.5" />
          Reverse
        </button>
        <button
          type="button"
          class="rt-veh-btn rt-veh-btn-danger"
          :disabled="!view.canSell"
          :title="view.canSell ? undefined : 'Stop it inside a depot to sell it'"
          @click="sell"
        >
          <UIcon name="i-lucide-badge-pound-sterling" class="size-3.5" />
          Sell for {{ rtFormatMoney(view.sellValue) }}
        </button>
      </div>
    </div>
    <p v-else class="rt-veh-muted">This vehicle is gone.</p>
  </RtWindow>
</template>

<style scoped>
.rt-veh {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 320px;
}
.rt-veh-bar-btn {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1px solid rgba(0, 0, 0, 0.45);
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  cursor: pointer;
}
.rt-veh-bar-btn:hover {
  background: rgba(0, 0, 0, 0.45);
}
.rt-veh-bar-on {
  background: #26221b;
  color: #ffd84a;
}
.rt-veh-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid #14120e;
  background: #201d17;
  font-weight: 700;
}
.rt-veh-speed {
  margin-left: auto;
  color: #cfc8b6;
  font-variant-numeric: tabular-nums;
}
.rt-veh-badge {
  padding: 0 5px;
  background: #1f4fbf;
  color: #fff;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.rt-veh-facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.rt-veh-facts dt {
  color: #cfc8b6;
}
.rt-veh-facts dd {
  margin: 0;
  text-align: right;
}
.rt-veh-neg {
  color: #ff7b6a;
}
.rt-veh-orders {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rt-veh-orders-head {
  display: flex;
  justify-content: space-between;
  font-weight: 700;
}
.rt-veh-orders-count {
  color: #a8a08c;
  font-weight: 400;
}
.rt-veh-order-list {
  display: flex;
  flex-direction: column;
  max-height: 180px;
  margin: 0;
  padding: 2px;
  overflow-y: auto;
  list-style: none;
  border: 1px solid #14120e;
  background: #201d17;
}
.rt-veh-order {
  display: flex;
  gap: 6px;
  width: 100%;
  padding: 2px 4px;
  color: #ece6d6;
  text-align: left;
  cursor: pointer;
}
.rt-veh-order:disabled {
  cursor: default;
}
.rt-veh-order:hover:not(:disabled) {
  background: #3a352c;
}
.rt-veh-order-on {
  background: #4a4438;
  box-shadow: inset 2px 0 0 #ffd84a;
}
.rt-veh-order-current .rt-veh-order-num::after {
  content: ' >';
  color: #ffd84a;
}
.rt-veh-order-num {
  min-width: 22px;
  color: #a8a08c;
  font-variant-numeric: tabular-nums;
}
.rt-veh-picking {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: #ffd84a;
}
.rt-veh-order-tools,
.rt-veh-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.rt-veh-actions {
  padding-top: 6px;
  border-top: 1px solid #6b6455;
}
.rt-veh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid #201d17;
  background: #4a4438;
  color: #ece6d6;
  font-weight: 700;
  box-shadow: inset 1px 1px 0 #6b6455;
  cursor: pointer;
}
.rt-veh-btn:hover:not(:disabled) {
  background: #575043;
}
.rt-veh-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.rt-veh-btn-icon {
  padding: 3px 5px;
}
.rt-veh-btn-on {
  background: #26221b;
  color: #ffd84a;
  box-shadow: inset 1px 1px 2px rgba(0, 0, 0, 0.6);
}
.rt-veh-btn-main {
  background: #5b7d3a;
  box-shadow: inset 1px 1px 0 #7da255;
}
.rt-veh-btn-main:hover:not(:disabled) {
  background: #6b9045;
}
.rt-veh-btn-danger {
  color: #ffb3a8;
}
.rt-veh-muted {
  margin: 0;
  color: #a8a08c;
}
</style>
