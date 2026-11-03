<script setup lang="ts">
// Rail Tycoon — the vehicle list: the player's own vehicles with name, kind, what each is
// doing, profit this year and last year (losses in red) and age, sortable by number, profit and age.
// A click on a row opens the vehicle's window and centres the view on it.
import { RtVehicleKind } from '#shared/utils/rail-tycoon/types'
import RtWindow from './RtWindow.vue'
import { rtCompanyCss, rtFormatMoney, useRtGame, useRtWindows } from '~/utils/rail-tycoon/windows'
import { rtSortVehicleRows, rtVehicleRows, type RtVehicleSortKey } from '~/utils/rail-tycoon/vehicle-view'
import { rtAgeText } from '~/utils/rail-tycoon/view-format'

withDefaults(defineProps<{
  windowKey?: string
}>(), {
  windowKey: 'vehicleList'
})

const game = useRtGame()
const windows = useRtWindows()

const sortKey = ref<RtVehicleSortKey>('number')
const descending = ref(false)

const SORTS: readonly { key: RtVehicleSortKey, label: string }[] = [
  { key: 'number', label: 'Number' },
  { key: 'profit', label: 'Profit' },
  { key: 'age', label: 'Age' }
]

const view = computed(() => {
  void game.tick.value
  void game.status.value
  const ls = game.lockstep.value
  const company = game.company()
  if (!ls || !company) return null
  return {
    title: `${company.name}: vehicles`,
    accent: rtCompanyCss(company.colour),
    rows: rtSortVehicleRows(rtVehicleRows(ls.world, company.id), sortKey.value, descending.value)
  }
})

function sortBy(key: RtVehicleSortKey) {
  if (sortKey.value === key) {
    descending.value = !descending.value
    return
  }
  sortKey.value = key
  // profit and age read best biggest first, numbers smallest first
  descending.value = key !== 'number'
}

function openVehicle(id: number) {
  const vehicle = game.lockstep.value?.world.vehicle(id)
  windows.open('vehicle', id)
  const head = vehicle?.tiles[0]
  if (head !== undefined) game.centreOnTile(head)
}
</script>

<template>
  <RtWindow
    :title="view?.title ?? 'Vehicles'"
    :window-key="windowKey"
    :accent="view?.accent ?? null"
  >
    <div v-if="view" class="rt-vl">
      <div class="rt-vl-sort" role="group" aria-label="Sort by">
        <span class="rt-vl-sort-label">Sort by</span>
        <button
          v-for="sort in SORTS"
          :key="sort.key"
          type="button"
          class="rt-vl-sort-btn"
          :class="{ 'rt-vl-sort-on': sortKey === sort.key }"
          :aria-pressed="sortKey === sort.key"
          @click="sortBy(sort.key)"
        >
          {{ sort.label }}
          <UIcon
            v-if="sortKey === sort.key"
            :name="descending ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up'"
            class="size-3"
          />
        </button>
      </div>

      <div v-if="view.rows.length > 0" class="rt-vl-list">
        <button
          v-for="row in view.rows"
          :key="row.id"
          type="button"
          class="rt-vl-row"
          @click="openVehicle(row.id)"
        >
          <UIcon
            :name="row.kind === RtVehicleKind.rail ? 'i-lucide-train-front' : 'i-lucide-bus'"
            class="rt-vl-kind size-4"
            :aria-label="row.kind === RtVehicleKind.rail ? 'Train' : 'Road vehicle'"
          />
          <span class="rt-vl-name">{{ row.name }}</span>
          <span class="rt-vl-age">{{ rtAgeText(row.age) }}</span>
          <span class="rt-vl-status">{{ row.status }}</span>
          <span class="rt-vl-profit">
            This year <b :class="{ 'rt-vl-neg': row.profitThisYear < 0 }">{{ rtFormatMoney(row.profitThisYear) }}</b>,
            last year <b :class="{ 'rt-vl-neg': row.profitLastYear < 0 }">{{ rtFormatMoney(row.profitLastYear) }}</b>
          </span>
        </button>
      </div>
      <p v-else class="rt-vl-empty">No vehicles yet. Build a depot and query it to buy one.</p>
    </div>
    <p v-else class="rt-vl-empty">You have no company in this world.</p>
  </RtWindow>
</template>

<style scoped>
.rt-vl {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 340px;
}
.rt-vl-sort {
  display: flex;
  align-items: center;
  gap: 3px;
}
.rt-vl-sort-label {
  margin-right: 4px;
  color: #cfc8b6;
}
.rt-vl-sort-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border: 1px solid #201d17;
  background: #4a4438;
  color: inherit;
  cursor: pointer;
}
.rt-vl-sort-on {
  background: #26221b;
  color: #ffd84a;
}
.rt-vl-list {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid #14120e;
  background: #201d17;
}
.rt-vl-row {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  gap: 0 6px;
  align-items: center;
  padding: 4px 6px;
  border-bottom: 1px solid #2b2720;
  color: #ece6d6;
  text-align: left;
  cursor: pointer;
}
.rt-vl-row:hover {
  background: #3a352c;
}
.rt-vl-kind {
  color: #cfc8b6;
}
.rt-vl-name {
  font-weight: 700;
}
.rt-vl-age {
  color: #a8a08c;
  font-size: 11px;
}
.rt-vl-status,
.rt-vl-profit {
  grid-column: 2 / -1;
  font-size: 11px;
}
.rt-vl-status {
  color: #cfc8b6;
}
.rt-vl-profit {
  color: #a8a08c;
  font-variant-numeric: tabular-nums;
}
.rt-vl-profit b {
  color: #ece6d6;
}
.rt-vl-profit b.rt-vl-neg {
  color: #ff7b6a;
}
.rt-vl-empty {
  margin: 0;
  color: #cfc8b6;
}
</style>
