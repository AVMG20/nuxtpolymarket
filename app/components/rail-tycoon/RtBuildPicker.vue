<script setup lang="ts">
// Rail Tycoon — the build picker window, as the original's: choosing a station, depot, stop or signal
// tool opens it, its pictures show each choice as the map will draw it, and closing it puts the tool
// away. The toolbar opens and closes it with the tool.
import { RtSignalType } from '#shared/utils/rail-tycoon/signals'
import { RT_MAX_PLATFORMS, RT_MAX_PLATFORM_LENGTH, RtAxis, RtRoadStopShape, RtStationTile } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_X, RT_ROAD_Y } from '#shared/utils/rail-tycoon/track'
import { RtVehicleKind } from '#shared/utils/rail-tycoon/types'
import type { RtPickerScene } from '~/utils/rail-tycoon/picker'
import { RtRailDirection, RtRoadDirection, RtToolKind, rtRailDirectionPieces } from '~/utils/rail-tycoon/tools'
import { useRtGame } from '~/utils/rail-tycoon/windows'
import RtPickerPicture from './RtPickerPicture.vue'
import RtWindow from './RtWindow.vue'

withDefaults(defineProps<{ windowKey?: string }>(), { windowKey: 'buildPicker' })

const game = useRtGame()
const options = game.tools.options

/** Bumped on every change, since the options object is not reactive; a preview also means one (R on the map). */
const version = ref(0)
let offPreview: (() => void) | null = null
onMounted(() => {
  offPreview = game.tools.on('preview', () => {
    version.value++
  })
})
onBeforeUnmount(() => offPreview?.())

function set(apply: () => void) {
  apply()
  version.value++
  game.refreshTool()
}

const state = computed(() => {
  void version.value
  return {
    tool: game.tool.value,
    railDirection: options.railDirection,
    roadDirection: options.roadDirection,
    axis: options.stationAxis,
    tracks: options.stationTracks,
    length: options.stationLength,
    depotKind: options.depotKind,
    facing: options.depotFacing,
    stop: options.stopType,
    shape: options.stopShape,
    signal: options.signalType
  }
})

const title = computed(() => {
  const s = state.value
  switch (s.tool) {
    case RtToolKind.rail: return 'Railway construction'
    case RtToolKind.road: return 'Road construction'
    case RtToolKind.railStation: return 'Rail station orientation'
    case RtToolKind.depot: return s.depotKind === RtVehicleKind.road ? 'Road vehicle depot orientation' : 'Train depot orientation'
    case RtToolKind.roadStop: return s.stop === RtStationTile.truck ? 'Lorry station' : 'Bus station'
    case RtToolKind.signal: return 'Signal selection'
    default: return 'Build'
  }
})

/** The original's four track buttons, in its order; autorail follows separately. */
const TRACKS = [
  { direction: RtRailDirection.vertical, label: 'Track running north to south' },
  { direction: RtRailDirection.x, label: 'Track running south-west to north-east' },
  { direction: RtRailDirection.horizontal, label: 'Track running west to east' },
  { direction: RtRailDirection.y, label: 'Track running north-west to south-east' }
] as const
const ROADS = [
  { direction: RtRoadDirection.x, label: 'Road running south-west to north-east', bits: RT_ROAD_X },
  { direction: RtRoadDirection.y, label: 'Road running north-west to south-east', bits: RT_ROAD_Y }
] as const
const AXES = [
  { axis: RtAxis.x, label: 'Along the x axis' },
  { axis: RtAxis.y, label: 'Along the y axis' }
] as const
/** RtDir order: the side the depot opens to. */
const FACINGS = [
  { facing: 0, label: 'Opens north-east' },
  { facing: 1, label: 'Opens south-east' },
  { facing: 2, label: 'Opens south-west' },
  { facing: 3, label: 'Opens north-west' }
] as const
const STOPS = [
  { stop: RtStationTile.bus, label: 'Bus' },
  { stop: RtStationTile.truck, label: 'Lorry' }
] as const
/** The original's six stop pictures: four bays by entrance, then the two drive-through axes. */
const BAYS = [
  { shape: RtRoadStopShape.bayNe, label: 'Bay, entrance north-east' },
  { shape: RtRoadStopShape.baySe, label: 'Bay, entrance south-east' },
  { shape: RtRoadStopShape.baySw, label: 'Bay, entrance south-west' },
  { shape: RtRoadStopShape.bayNw, label: 'Bay, entrance north-west' }
] as const
const DRIVE_THROUGHS = [
  { shape: RtRoadStopShape.driveX, label: 'Drive-through, along the x axis' },
  { shape: RtRoadStopShape.driveY, label: 'Drive-through, along the y axis' }
] as const
const SIGNALS = [
  { signal: RtSignalType.block, label: 'Block signal' },
  { signal: RtSignalType.path, label: 'Path signal' }
] as const

const trackCounts = Array.from({ length: RT_MAX_PLATFORMS }, (_, k) => k + 1)
const lengths = Array.from({ length: RT_MAX_PLATFORM_LENGTH }, (_, k) => k + 1)

const railScene = (direction: RtRailDirection): RtPickerScene => ({ kind: 'rail', pieces: rtRailDirectionPieces(direction) })
const roadScene = (bits: number): RtPickerScene => ({ kind: 'road', bits })
const stationScene = (axis: RtAxis): RtPickerScene => ({ kind: 'railStation', axis })
const depotScene = (facing: number): RtPickerScene => ({ kind: 'depot', vehicleKind: state.value.depotKind, facing })
const stopScene = (shape: RtRoadStopShape): RtPickerScene => ({ kind: 'roadStop', stop: state.value.stop, shape })
const signalScene = (signalType: RtSignalType): RtPickerScene => ({ kind: 'signal', signalType })

function close() {
  game.selectTool(RtToolKind.none)
}
</script>

<template>
  <RtWindow :title="title" :window-key="windowKey" @close="close">
    <div class="rt-picker">
      <template v-if="state.tool === RtToolKind.rail">
        <div class="rt-picker-row">
          <button
            v-for="choice in TRACKS"
            :key="choice.direction"
            type="button"
            class="rt-picker-choice"
            :class="{ 'rt-picker-on': state.railDirection === choice.direction }"
            :aria-pressed="state.railDirection === choice.direction"
            :aria-label="choice.label"
            :title="choice.label"
            @click="set(() => (options.railDirection = choice.direction))"
          >
            <RtPickerPicture :scene="railScene(choice.direction)" />
          </button>
        </div>
        <div class="rt-picker-label">Autorail</div>
        <div class="rt-picker-row">
          <button
            type="button"
            class="rt-picker-choice"
            :class="{ 'rt-picker-on': state.railDirection === RtRailDirection.auto }"
            :aria-pressed="state.railDirection === RtRailDirection.auto"
            aria-label="Autorail: track along the drag"
            title="Autorail: track along the drag"
            @click="set(() => (options.railDirection = RtRailDirection.auto))"
          >
            <RtPickerPicture :scene="railScene(RtRailDirection.auto)" />
          </button>
        </div>
        <div class="rt-picker-hint">Drag on the map to lay a line.</div>
      </template>

      <template v-else-if="state.tool === RtToolKind.road">
        <div class="rt-picker-row">
          <button
            v-for="choice in ROADS"
            :key="choice.direction"
            type="button"
            class="rt-picker-choice"
            :class="{ 'rt-picker-on': state.roadDirection === choice.direction }"
            :aria-pressed="state.roadDirection === choice.direction"
            :aria-label="choice.label"
            :title="choice.label"
            @click="set(() => (options.roadDirection = choice.direction))"
          >
            <RtPickerPicture :scene="roadScene(choice.bits)" />
          </button>
        </div>
        <div class="rt-picker-label">Autoroad</div>
        <div class="rt-picker-row">
          <button
            type="button"
            class="rt-picker-choice"
            :class="{ 'rt-picker-on': state.roadDirection === RtRoadDirection.auto }"
            :aria-pressed="state.roadDirection === RtRoadDirection.auto"
            aria-label="Autoroad: road along the drag"
            title="Autoroad: road along the drag"
            @click="set(() => (options.roadDirection = RtRoadDirection.auto))"
          >
            <RtPickerPicture :scene="roadScene(RT_ROAD_X | RT_ROAD_Y)" />
          </button>
        </div>
        <div class="rt-picker-hint">Drag on the map to lay a line.</div>
      </template>

      <template v-else-if="state.tool === RtToolKind.railStation">
        <div class="rt-picker-row">
          <button
            v-for="choice in AXES"
            :key="choice.axis"
            type="button"
            class="rt-picker-choice"
            :class="{ 'rt-picker-on': state.axis === choice.axis }"
            :aria-pressed="state.axis === choice.axis"
            :aria-label="choice.label"
            :title="choice.label"
            @click="set(() => (options.stationAxis = choice.axis))"
          >
            <RtPickerPicture :scene="stationScene(choice.axis)" />
          </button>
        </div>
        <div class="rt-picker-label">Number of tracks</div>
        <div class="rt-picker-row">
          <button
            v-for="n in trackCounts"
            :key="n"
            type="button"
            class="rt-picker-num"
            :class="{ 'rt-picker-on': state.tracks === n }"
            :aria-pressed="state.tracks === n"
            @click="set(() => (options.stationTracks = n))"
          >
            {{ n }}
          </button>
        </div>
        <div class="rt-picker-label">Platform length</div>
        <div class="rt-picker-row">
          <button
            v-for="n in lengths"
            :key="n"
            type="button"
            class="rt-picker-num"
            :class="{ 'rt-picker-on': state.length === n }"
            :aria-pressed="state.length === n"
            @click="set(() => (options.stationLength = n))"
          >
            {{ n }}
          </button>
        </div>
        <div class="rt-picker-hint">R on the map turns the station.</div>
      </template>

      <template v-else-if="state.tool === RtToolKind.depot">
        <div class="rt-picker-grid">
          <button
            v-for="choice in FACINGS"
            :key="choice.facing"
            type="button"
            class="rt-picker-choice"
            :class="{ 'rt-picker-on': state.facing === choice.facing }"
            :aria-pressed="state.facing === choice.facing"
            :aria-label="choice.label"
            :title="choice.label"
            @click="set(() => (options.depotFacing = choice.facing))"
          >
            <RtPickerPicture :scene="depotScene(choice.facing)" />
          </button>
        </div>
        <div class="rt-picker-hint">R on the map turns the depot.</div>
      </template>

      <template v-else-if="state.tool === RtToolKind.roadStop">
        <div class="rt-picker-row">
          <button
            v-for="choice in STOPS"
            :key="choice.stop"
            type="button"
            class="rt-picker-num rt-picker-text"
            :class="{ 'rt-picker-on': state.stop === choice.stop }"
            :aria-pressed="state.stop === choice.stop"
            @click="set(() => (options.stopType = choice.stop))"
          >
            {{ choice.label }}
          </button>
        </div>
        <div class="rt-picker-label">Bays</div>
        <div class="rt-picker-grid">
          <button
            v-for="choice in BAYS"
            :key="choice.shape"
            type="button"
            class="rt-picker-choice"
            :class="{ 'rt-picker-on': state.shape === choice.shape }"
            :aria-pressed="state.shape === choice.shape"
            :aria-label="choice.label"
            :title="choice.label"
            @click="set(() => (options.stopShape = choice.shape))"
          >
            <RtPickerPicture :scene="stopScene(choice.shape)" />
          </button>
        </div>
        <div class="rt-picker-label">Drive-through</div>
        <div class="rt-picker-row">
          <button
            v-for="choice in DRIVE_THROUGHS"
            :key="choice.shape"
            type="button"
            class="rt-picker-choice"
            :class="{ 'rt-picker-on': state.shape === choice.shape }"
            :aria-pressed="state.shape === choice.shape"
            :aria-label="choice.label"
            :title="choice.label"
            @click="set(() => (options.stopShape = choice.shape))"
          >
            <RtPickerPicture :scene="stopScene(choice.shape)" />
          </button>
        </div>
        <div class="rt-picker-hint">A bay is a dead end on clear land; a drive-through stop goes on a straight road or lays its own. R on the map turns the stop.</div>
      </template>

      <template v-else-if="state.tool === RtToolKind.signal">
        <div class="rt-picker-row">
          <button
            v-for="choice in SIGNALS"
            :key="choice.signal"
            type="button"
            class="rt-picker-choice"
            :class="{ 'rt-picker-on': state.signal === choice.signal }"
            :aria-pressed="state.signal === choice.signal"
            :aria-label="choice.label"
            :title="choice.label"
            @click="set(() => (options.signalType = choice.signal))"
          >
            <RtPickerPicture :scene="signalScene(choice.signal)" />
          </button>
        </div>
        <div class="rt-picker-hint">Click a signal on the map to turn it.</div>
      </template>
    </div>
  </RtWindow>
</template>

<style scoped>
.rt-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  color: #ece6d6;
  font-size: 12px;
}
.rt-picker-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.rt-picker-grid {
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 4px;
}
.rt-picker-choice {
  padding: 2px;
  border: 1px solid #201d17;
  background: #6a8a4a;
  box-shadow: inset 1px 1px 0 #8fae6c;
  cursor: pointer;
}
.rt-picker-num {
  min-width: 24px;
  height: 22px;
  border: 1px solid #201d17;
  background: #4a4438;
  color: inherit;
  font-weight: 700;
  cursor: pointer;
}
.rt-picker-text {
  padding: 0 8px;
}
.rt-picker-on {
  background: #26221b;
  color: #ffd84a;
  box-shadow: inset 0 0 0 2px #ffd84a;
}
.rt-picker-label {
  color: #cfc8b6;
}
.rt-picker-hint {
  max-width: 220px;
  color: #a8a08c;
  font-size: 11px;
}
</style>
