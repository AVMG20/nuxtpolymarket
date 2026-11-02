<script setup lang="ts">
// Rail Tycoon — a station's window, opened by a query click on a station tile (id is the
// station id): the owner company's name and colour, the amount waiting and the rating of each cargo,
// the cargos the catchment accepts (computeCatchment, as the acceptance rule sums it), and a toggle
// that outlines the station and its catchment on the map. Every company's station shows the same,
// read only.
import { computeCatchment } from '#shared/utils/rail-tycoon/stations'
import { RtFacility } from '#shared/utils/rail-tycoon/types'
import RtWindow from './RtWindow.vue'
import type { RtToolPreview } from '~/utils/rail-tycoon/tools'
import { rtCompanyCss, useRtGame, useRtWindows } from '~/utils/rail-tycoon/windows'
import { rtCargoCss, rtCargoName, rtStationAccepts, rtStationCargoRows } from '~/utils/rail-tycoon/world-windows'

const props = withDefaults(defineProps<{
  windowKey: string
  /** The station id. */
  id?: number | null
}>(), {
  id: null
})

const game = useRtGame()
const windows = useRtWindows()

const highlight = ref(false)

const view = computed(() => {
  void game.tick.value
  const ls = game.lockstep.value
  if (!ls || props.id === null) return null
  const world = ls.world
  const station = world.station(props.id)
  if (!station || station.tiles.length === 0) return null
  const owner = world.company(station.owner)
  const facilities: string[] = []
  if (station.facilities & RtFacility.rail) facilities.push('Railway station')
  if (station.facilities & RtFacility.busStop) facilities.push('Bus stop')
  if (station.facilities & RtFacility.truckStop) facilities.push('Lorry stop')
  return {
    name: station.name,
    ownerName: owner?.name ?? 'No company',
    ownerCss: owner ? rtCompanyCss(owner.colour) : null,
    mine: game.companyId.value !== null && station.owner === game.companyId.value,
    facilities: facilities.join(', '),
    rows: rtStationCargoRows(station),
    accepts: rtStationAccepts(world, station).map(rtCargoName),
    tilesRevision: station.tilesRevision
  }
})

watch(view, (next) => {
  if (game.lockstep.value && !next) windows.close(props.windowKey)
})

function ratingColour(rating: number): string {
  if (rating >= 70) return '#7fc456'
  if (rating >= 45) return '#e0b03a'
  return '#e0604f'
}

// ─── Catchment outline ───────────────────────────────────────────────────
//
// The station tiles outlined and the catchment shaded, through the tools' highlight. Any other
// preview (a tool chosen, a hover) replaces it, and the toggle follows that.

let shown: RtToolPreview | null = null
let offPreview: (() => void) | null = null

function drawHighlight() {
  const ls = game.lockstep.value
  const station = ls && props.id !== null ? ls.world.station(props.id) : undefined
  if (!ls || !station) return
  // cleared during the emit, so the preview listener below ignores this window's own redraw
  shown = null
  shown = game.tools.highlight(station.tiles, computeCatchment(ls.world.map, station))
}

function clearHighlight() {
  if (!shown) return
  shown = null
  // the tool's own preview comes back (none without a tool)
  game.tools.refresh()
}

watch(highlight, (on) => {
  if (on) drawHighlight()
  else clearHighlight()
})

// the station grew or shrank while outlined
watch(() => view.value?.tilesRevision, () => {
  if (highlight.value) drawHighlight()
})

onMounted(() => {
  offPreview = game.tools.on('preview', (preview) => {
    if (shown && preview !== shown) {
      shown = null
      highlight.value = false
    }
  })
})

onBeforeUnmount(() => {
  offPreview?.()
  offPreview = null
  clearHighlight()
})
</script>

<template>
  <RtWindow
    :title="view?.name ?? 'Station'"
    :window-key="windowKey"
    :accent="view?.ownerCss ?? null"
  >
    <div v-if="view" class="rt-st">
      <div class="rt-st-owner">
        <span class="rt-st-swatch" :style="view.ownerCss ? { background: view.ownerCss } : undefined" />
        <span class="rt-st-owner-name">{{ view.ownerName }}</span>
        <span v-if="!view.mine" class="rt-st-muted">(another company)</span>
      </div>
      <div class="rt-st-muted">{{ view.facilities }}</div>

      <section aria-label="Waiting cargo">
        <div class="rt-st-head">Waiting and rating</div>
        <ul v-if="view.rows.length > 0" class="rt-st-rows">
          <li v-for="row in view.rows" :key="row.cargo" class="rt-st-row">
            <span class="rt-st-cargo">
              <span class="rt-st-cargo-swatch" :style="{ background: rtCargoCss(row.cargo) }" />
              {{ row.name }}
            </span>
            <span class="rt-st-waiting">{{ row.waiting }}</span>
            <span v-if="row.rating !== null" class="rt-st-bar" role="meter" :aria-valuenow="row.rating" aria-valuemin="0" aria-valuemax="100" :aria-label="`${row.name} rating`">
              <span class="rt-st-bar-fill" :style="{ width: `${row.rating}%`, background: ratingColour(row.rating) }" />
              <span class="rt-st-bar-text">{{ row.rating }}%</span>
            </span>
            <span v-else class="rt-st-muted rt-st-norating">no rating yet</span>
          </li>
        </ul>
        <p v-else class="rt-st-muted rt-st-p">Nothing waiting. Cargo appears once a vehicle has tried to load here.</p>
      </section>

      <section aria-label="Accepted cargo">
        <div class="rt-st-head">Accepts</div>
        <p class="rt-st-p">{{ view.accepts.length > 0 ? view.accepts.join(', ') : 'Nothing' }}</p>
      </section>

      <label class="rt-st-toggle">
        <input v-model="highlight" type="checkbox">
        Show catchment on the map
      </label>
    </div>
    <p v-else class="rt-st-muted rt-st-p">This station is gone.</p>
  </RtWindow>
</template>

<style scoped>
.rt-st {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 280px;
}
.rt-st-owner {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rt-st-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1px solid rgba(0, 0, 0, 0.6);
  background: #6b6b6b;
}
.rt-st-owner-name {
  font-weight: 700;
}
.rt-st-muted {
  color: #a8a08c;
}
.rt-st-p {
  margin: 0;
}
.rt-st-head {
  margin-bottom: 3px;
  font-weight: 700;
}
.rt-st-rows {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rt-st-row {
  display: grid;
  grid-template-columns: 1fr 44px 100px;
  align-items: center;
  gap: 6px;
}
.rt-st-cargo {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.rt-st-cargo-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border: 1px solid rgba(0, 0, 0, 0.6);
}
.rt-st-waiting {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.rt-st-bar {
  position: relative;
  height: 14px;
  border: 1px solid #14120e;
  background: #201d17;
}
.rt-st-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
}
.rt-st-bar-text {
  position: relative;
  display: block;
  font-size: 10px;
  font-weight: 700;
  line-height: 12px;
  text-align: center;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.8);
}
.rt-st-norating {
  font-size: 11px;
}
.rt-st-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
</style>
