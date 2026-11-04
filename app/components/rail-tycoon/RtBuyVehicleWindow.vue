<script setup lang="ts">
// Rail Tycoon — the depot's buy window: opened by a query click on an own depot (id is the
// depot tile). Lists the models that depot sells with cost, speed, capacity and running cost; a train
// also takes one wagon type and a count, which stops at the longest consist maxTrainLength allows.
// Buy sends buyVehicle and opens the new vehicle's window once it shows up in the depot.
// The vehicles standing in the depot are listed below, a click opens one.
import { RT_CATALOG, type RtVehicleModelSpec } from '#shared/utils/rail-tycoon/catalog'
import { RtCommandKind, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import { RtVehicleKind } from '#shared/utils/rail-tycoon/types'
import { rtMaxWagons, rtModelCargo } from '#shared/utils/rail-tycoon/vehicles'
import RtWindow from './RtWindow.vue'
import { rtCommandErrorText, rtCompanyCss, rtFormatMoney, useRtGame, useRtWindows } from '~/utils/rail-tycoon/windows'
import {
  rtBuyableModels,
  rtCapacityText,
  rtConsistSummary,
  rtDepotKindAt,
  rtPlannedConsist,
  rtVehiclesInDepot,
  rtWagonModels
} from '~/utils/rail-tycoon/buy-view'
import { rtVehicleName, rtVehicleStatus } from '~/utils/rail-tycoon/vehicle-view'
import { rtCargoCss, rtCargoName } from '~/utils/rail-tycoon/view-format'

const props = withDefaults(defineProps<{
  windowKey: string
  /** The depot tile. */
  id?: number | null
}>(), {
  id: null
})

const game = useRtGame()
const windows = useRtWindows()

/** How long to wait for a bought vehicle to appear before giving up on opening its window (ms). */
const APPEAR_TIMEOUT_MS = 15000

const wagons = rtWagonModels()
const model = ref<number | null>(null)
const wagon = ref<number>(RT_CATALOG.vehicles.models.passengerCoach.index)
const wagonCount = ref(3)

const depotKind = computed(() => {
  void game.tick.value
  const ls = game.lockstep.value
  return ls && props.id !== null ? rtDepotKindAt(ls.world, props.id) : null
})

const models = computed<RtVehicleModelSpec[]>(() => depotKind.value === null ? [] : rtBuyableModels(depotKind.value))

// the first model is chosen until the player picks one; a depot of the other kind resets it
watch(models, (list) => {
  if (!list.some(spec => spec.index === model.value)) model.value = list[0]?.index ?? null
}, { immediate: true })

const isTrain = computed(() => depotKind.value === RtVehicleKind.rail)
const maxWagons = computed(() => model.value === null ? 0 : rtMaxWagons(model.value))

watch(maxWagons, (max) => {
  if (wagonCount.value > max) wagonCount.value = max
})

const consist = computed(() => model.value === null ? [] : rtPlannedConsist(model.value, isTrain.value ? wagon.value : null, wagonCount.value))

const command = computed<RtCommand | null>(() => {
  if (props.id === null || consist.value.length === 0) return null
  return { kind: RtCommandKind.buyVehicle, depot: props.id, model: consist.value[0]!, wagons: consist.value.slice(1) }
})

const view = computed(() => {
  void game.tick.value
  void game.status.value
  const ls = game.lockstep.value
  const companyId = game.companyId.value
  if (!ls || props.id === null) return null
  const world = ls.world
  const map = world.map
  if (!map.validTile(props.id) || depotKind.value === null) return null
  const owner = world.company(map.owner[props.id]!)
  const cmd = command.value
  const check = cmd ? game.tryCommand(cmd) : null
  return {
    title: `${owner?.name ?? 'Depot'}: ${isTrain.value ? 'train' : 'road vehicle'} depot`,
    accent: owner ? rtCompanyCss(owner.colour) : null,
    mine: companyId !== null && map.owner[props.id] === companyId,
    summary: rtConsistSummary(consist.value),
    canBuy: !!check?.ok && game.canCommand(),
    refusal: check && !check.ok ? rtCommandErrorText(check.error) : null,
    inside: rtVehiclesInDepot(world, props.id).map(vehicle => ({
      id: vehicle.id,
      name: rtVehicleName(vehicle),
      status: rtVehicleStatus(world, vehicle)
    }))
  }
})

// the depot was demolished, or this client lost its company: the window has nothing to show
watch(view, (next) => {
  if (game.lockstep.value && (!next || !next.mine)) windows.close(props.windowKey)
})

// ─── Buying ──────────────────────────────────────────────────────────────

let awaiting: { known: Set<number>, model: number, until: number } | null = null

function buy() {
  const ls = game.lockstep.value
  const cmd = command.value
  if (!ls || !cmd || cmd.kind !== RtCommandKind.buyVehicle) return
  const known = new Set(ls.world.vehicleList().map(vehicle => vehicle.id))
  if (!game.sendCommandOrWarn(cmd)) return
  awaiting = { known, model: cmd.model, until: Date.now() + APPEAR_TIMEOUT_MS }
}

/** Opens the bought vehicle's window once the command has run and it stands in the depot. */
function lookForBought() {
  if (!awaiting) return
  if (Date.now() > awaiting.until) {
    awaiting = null
    return
  }
  const ls = game.lockstep.value
  const companyId = game.companyId.value
  if (!ls || companyId === null || props.id === null) return
  const wait = awaiting
  const bought = ls.world.vehicleList().find(vehicle =>
    !wait.known.has(vehicle.id) && vehicle.owner === companyId && vehicle.model === wait.model && vehicle.tiles[0] === props.id)
  if (!bought) return
  awaiting = null
  windows.open('vehicle', bought.id)
}

watch(() => game.tick.value, lookForBought)

function stepWagons(step: number) {
  wagonCount.value = Math.max(0, Math.min(maxWagons.value, wagonCount.value + step))
}

function openVehicle(id: number) {
  windows.open('vehicle', id)
}
</script>

<template>
  <RtWindow
    :title="view?.title ?? 'Depot'"
    :window-key="windowKey"
    :accent="view?.accent ?? null"
  >
    <div v-if="view" class="rt-buy">
      <ul class="rt-buy-models" role="listbox" aria-label="Models">
        <li v-for="spec in models" :key="spec.index">
          <button
            type="button"
            role="option"
            class="rt-buy-model"
            :class="{ 'rt-buy-model-on': spec.index === model }"
            :aria-selected="spec.index === model"
            @click="model = spec.index"
          >
            <span class="rt-buy-model-name">{{ spec.name }}</span>
            <span class="rt-buy-model-cost">{{ rtFormatMoney(spec.cost) }}</span>
            <span class="rt-buy-model-meta">
              {{ spec.maxSpeed }} km/h
              <template v-if="spec.capacity > 0"> · {{ spec.capacity }} {{ rtCargoName(rtModelCargo(spec)) }}</template>
              <template v-if="spec.power > 0"> · {{ spec.power }} hp</template>
              · {{ rtFormatMoney(spec.runningCost) }}/yr
            </span>
          </button>
        </li>
      </ul>

      <div v-if="isTrain" class="rt-buy-wagons">
        <span class="rt-buy-label">Wagons</span>
        <div class="rt-buy-wagon-types">
          <button
            v-for="spec in wagons"
            :key="spec.index"
            type="button"
            class="rt-buy-wagon"
            :class="{ 'rt-buy-wagon-on': spec.index === wagon }"
            :aria-pressed="spec.index === wagon"
            :title="`${spec.name}: ${spec.capacity} per wagon, ${rtFormatMoney(spec.cost)}`"
            @click="wagon = spec.index"
          >
            <span class="rt-buy-swatch" :style="{ background: rtCargoCss(rtModelCargo(spec)) }" />
            {{ rtCargoName(rtModelCargo(spec)) }}
          </button>
        </div>
        <div class="rt-buy-count">
          <button type="button" class="rt-buy-step" aria-label="Fewer wagons" :disabled="wagonCount <= 0" @click="stepWagons(-1)">
            <UIcon name="i-lucide-minus" class="size-3.5" />
          </button>
          <span class="rt-buy-count-value">{{ wagonCount }}</span>
          <button type="button" class="rt-buy-step" aria-label="More wagons" :disabled="wagonCount >= maxWagons" @click="stepWagons(1)">
            <UIcon name="i-lucide-plus" class="size-3.5" />
          </button>
          <span class="rt-buy-max">max {{ maxWagons }}</span>
        </div>
      </div>

      <dl class="rt-buy-summary">
        <dt>Cost</dt>
        <dd>{{ rtFormatMoney(view.summary.cost) }}</dd>
        <dt>Speed</dt>
        <dd>{{ view.summary.maxSpeed }} km/h</dd>
        <dt>Capacity</dt>
        <dd>{{ rtCapacityText(view.summary.capacity) }}</dd>
        <dt>Running cost</dt>
        <dd>{{ rtFormatMoney(view.summary.runningCost) }}/yr</dd>
        <template v-if="isTrain">
          <dt>Length</dt>
          <dd>{{ view.summary.lengthTiles }} {{ view.summary.lengthTiles === 1 ? 'tile' : 'tiles' }}</dd>
        </template>
      </dl>

      <button type="button" class="rt-buy-btn" :disabled="!view.canBuy" @click="buy">
        Buy for {{ rtFormatMoney(view.summary.cost) }}
      </button>
      <p v-if="view.refusal" class="rt-buy-refusal">{{ view.refusal }}</p>

      <div v-if="view.inside.length > 0" class="rt-buy-inside">
        <span class="rt-buy-label">In this depot</span>
        <button
          v-for="vehicle in view.inside"
          :key="vehicle.id"
          type="button"
          class="rt-buy-inside-row"
          @click="openVehicle(vehicle.id)"
        >
          <span>{{ vehicle.name }}</span>
          <span class="rt-buy-inside-status">{{ vehicle.status }}</span>
        </button>
      </div>
    </div>
    <p v-else class="rt-buy-none">This depot is gone.</p>
  </RtWindow>
</template>

<style scoped>
.rt-buy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 300px;
}
.rt-buy-models {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 2px;
  list-style: none;
  border: 1px solid #14120e;
  background: #201d17;
}
.rt-buy-model {
  display: grid;
  grid-template-columns: 1fr auto;
  width: 100%;
  padding: 3px 6px;
  color: #ece6d6;
  text-align: left;
  cursor: pointer;
}
.rt-buy-model:hover {
  background: #3a352c;
}
.rt-buy-model-on {
  background: #4a4438;
  box-shadow: inset 2px 0 0 #ffd84a;
}
.rt-buy-model-name {
  font-weight: 700;
}
.rt-buy-model-cost {
  font-variant-numeric: tabular-nums;
}
.rt-buy-model-meta {
  grid-column: 1 / -1;
  font-size: 11px;
  color: #a8a08c;
}
.rt-buy-label {
  display: block;
  margin-bottom: 3px;
  color: #cfc8b6;
}
.rt-buy-wagon-types {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.rt-buy-wagon {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 1px solid #201d17;
  background: #4a4438;
  color: inherit;
  cursor: pointer;
}
.rt-buy-wagon-on {
  background: #26221b;
  color: #ffd84a;
}
.rt-buy-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border: 1px solid rgba(0, 0, 0, 0.6);
}
.rt-buy-count {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}
.rt-buy-step {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1px solid #201d17;
  background: #4a4438;
  color: inherit;
  cursor: pointer;
}
.rt-buy-step:disabled {
  opacity: 0.4;
  cursor: default;
}
.rt-buy-count-value {
  min-width: 18px;
  font-weight: 700;
  text-align: center;
}
.rt-buy-max {
  color: #a8a08c;
  font-size: 11px;
}
.rt-buy-summary {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.rt-buy-summary dt {
  color: #cfc8b6;
}
.rt-buy-summary dd {
  margin: 0;
  font-weight: 700;
  text-align: right;
}
.rt-buy-btn {
  padding: 5px 6px;
  border: 1px solid #201d17;
  background: #5b7d3a;
  color: #ece6d6;
  font-weight: 700;
  box-shadow: inset 1px 1px 0 #7da255;
  cursor: pointer;
}
.rt-buy-btn:hover:not(:disabled) {
  background: #6b9045;
}
.rt-buy-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.rt-buy-refusal {
  margin: 0;
  color: #ff8a7a;
}
.rt-buy-inside {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 6px;
  border-top: 1px solid #6b6455;
}
.rt-buy-inside-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.rt-buy-inside-row:hover {
  background: #4a4438;
}
.rt-buy-inside-status {
  color: #a8a08c;
}
.rt-buy-none {
  margin: 0;
  color: #cfc8b6;
}
</style>
