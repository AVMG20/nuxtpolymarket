<script setup lang="ts">
// Rail Tycoon — the top icon toolbar: zoom, the windows, the rail and road build tools with
// their options, demolish, query, and the world menu. Spectators see only zoom, the windows they can
// use and leave. There is no station list in version 1; stations open by a query click.
import { RtStationTile } from '#shared/utils/rail-tycoon/stations-build'
import { RtVehicleKind } from '#shared/utils/rail-tycoon/types'
import { RtToolKind } from '~/utils/rail-tycoon/tools'
import { useRtGame, useRtWindows, type RtWindowKind } from '~/utils/rail-tycoon/windows'

const game = useRtGame()
const windows = useRtWindows()
const toast = useToast()

interface ToolButton {
  id: string
  label: string
  icon: string
  tool: RtToolKind
  /** Applies the tool's fixed options (depot kind, stop type) before it is selected. */
  setup?: () => void
}

const options = game.tools.options

const railTools: ToolButton[] = [
  { id: 'rail', label: 'Build railway track', icon: 'i-lucide-train-track', tool: RtToolKind.rail },
  { id: 'railStation', label: 'Build railway station', icon: 'i-lucide-train-front', tool: RtToolKind.railStation },
  {
    id: 'railDepot',
    label: 'Build train depot (R turns it)',
    icon: 'i-lucide-warehouse',
    tool: RtToolKind.depot,
    setup: () => {
      options.depotKind = RtVehicleKind.rail
    }
  },
  { id: 'signal', label: 'Build signals (click a signal to turn it)', icon: 'i-lucide-signpost', tool: RtToolKind.signal },
  { id: 'parking', label: 'Build parking spot on a dead end (Ctrl+click removes it)', icon: 'i-lucide-square-parking', tool: RtToolKind.parking }
]

const roadTools: ToolButton[] = [
  { id: 'road', label: 'Build road', icon: 'i-lucide-route', tool: RtToolKind.road },
  {
    id: 'busStop',
    label: 'Build bus stop',
    icon: 'i-lucide-bus',
    tool: RtToolKind.roadStop,
    setup: () => {
      options.stopType = RtStationTile.bus
    }
  },
  {
    id: 'truckStop',
    label: 'Build lorry stop',
    icon: 'i-lucide-truck',
    tool: RtToolKind.roadStop,
    setup: () => {
      options.stopType = RtStationTile.truck
    }
  },
  {
    id: 'roadDepot',
    label: 'Build road vehicle depot (R turns it)',
    icon: 'i-lucide-store',
    tool: RtToolKind.depot,
    setup: () => {
      options.depotKind = RtVehicleKind.road
    }
  }
]

const otherTools: ToolButton[] = [
  { id: 'demolish', label: 'Demolish (drag for an area)', icon: 'i-lucide-shovel', tool: RtToolKind.demolish },
  { id: 'query', label: 'Land area information', icon: 'i-lucide-circle-help', tool: RtToolKind.query }
]

/** Which button is lit: the tool, told apart by the options for the tools two buttons share. */
const activeId = computed(() => {
  void game.toolOptions.value
  const tool = game.tool.value
  switch (tool) {
    case RtToolKind.rail: return 'rail'
    case RtToolKind.railStation: return 'railStation'
    case RtToolKind.signal: return 'signal'
    case RtToolKind.parking: return 'parking'
    case RtToolKind.road: return 'road'
    case RtToolKind.demolish: return 'demolish'
    case RtToolKind.query: return 'query'
    case RtToolKind.depot: return options.depotKind === RtVehicleKind.road ? 'roadDepot' : 'railDepot'
    case RtToolKind.roadStop: return options.stopType === RtStationTile.truck ? 'truckStop' : 'busStop'
    default: return null
  }
})

const canBuild = computed(() => game.role.value === 'player' && game.companyId.value !== null && !game.closed.value)

function pickTool(button: ToolButton) {
  // a second click on the lit button puts the tool away, as the original
  if (activeId.value === button.id) {
    game.selectTool(RtToolKind.none)
    return
  }
  button.setup?.()
  game.selectTool(button.tool)
}

// ─── The build picker ────────────────────────────────────────────────────
// The tools with choices open the picker window, as the original; another tool or none closes it,
// and closing the window puts the tool away.

const PICKER_TOOLS: readonly string[] = ['rail', 'road', 'railStation', 'railDepot', 'signal', 'busStop', 'truckStop', 'roadDepot']

watch(activeId, (id) => {
  if (id !== null && PICKER_TOOLS.includes(id) && canBuild.value) windows.open('buildPicker')
  else windows.close('buildPicker')
})

watch(() => windows.isOpen('buildPicker'), (open) => {
  if (!open && activeId.value !== null && PICKER_TOOLS.includes(activeId.value)) game.selectTool(RtToolKind.none)
})

function openWindow(kind: RtWindowKind) {
  windows.open(kind)
}

// ─── World menu ──────────────────────────────────────────────────────────

const menuOpen = ref(false)
const confirmStop = ref(false)
const copied = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const inviteLink = computed(() => {
  const code = game.inviteCode.value
  return code ? `${window.location.origin}/rail-tycoon/invite/${code}` : null
})

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  confirmStop.value = false
}

async function copyInvite() {
  const link = inviteLink.value
  if (!link) return
  try {
    await navigator.clipboard.writeText(link)
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    toast.add({ title: 'Couldn\'t copy the invite link', description: link, color: 'error' })
  }
}

function stopWorld() {
  if (!confirmStop.value) {
    confirmStop.value = true
    return
  }
  confirmStop.value = false
  menuOpen.value = false
  if (!game.send({ type: 'stop', worldId: game.worldId })) {
    toast.add({ title: 'Not connected, try again in a moment', color: 'warning' })
  }
}

function leave() {
  menuOpen.value = false
  game.leave()
}

function onDocumentPointer(e: PointerEvent) {
  if (!menuOpen.value) return
  if (menuRoot.value && e.target instanceof Node && menuRoot.value.contains(e.target)) return
  menuOpen.value = false
  confirmStop.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointer, true)
  clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="rt-toolbar" role="toolbar" aria-label="Rail Tycoon">
    <div class="rt-tb-group">
      <UTooltip text="Zoom in">
        <button type="button" class="rt-tb-btn" aria-label="Zoom in" @click="game.zoom(1)">
          <UIcon name="i-lucide-zoom-in" class="size-4" />
        </button>
      </UTooltip>
      <UTooltip text="Zoom out">
        <button type="button" class="rt-tb-btn" aria-label="Zoom out" @click="game.zoom(-1)">
          <UIcon name="i-lucide-zoom-out" class="size-4" />
        </button>
      </UTooltip>
    </div>

    <div class="rt-tb-group">
      <UTooltip text="Map of the world">
        <button type="button" class="rt-tb-btn" aria-label="Map of the world" @click="openWindow('minimap')">
          <UIcon name="i-lucide-map" class="size-4" />
        </button>
      </UTooltip>
      <UTooltip v-if="game.companyId.value !== null" text="Company finances">
        <button type="button" class="rt-tb-btn" aria-label="Company finances" @click="openWindow('finances')">
          <UIcon name="i-lucide-pound-sterling" class="size-4" />
        </button>
      </UTooltip>
      <UTooltip text="Vehicle list">
        <button type="button" class="rt-tb-btn" aria-label="Vehicle list" @click="openWindow('vehicleList')">
          <UIcon name="i-lucide-list" class="size-4" />
        </button>
      </UTooltip>
    </div>

    <template v-if="canBuild">
      <div class="rt-tb-group">
        <UTooltip v-for="button in railTools" :key="button.id" :text="button.label">
          <button
            type="button"
            class="rt-tb-btn"
            :class="{ 'rt-tb-btn-on': activeId === button.id }"
            :aria-label="button.label"
            :aria-pressed="activeId === button.id"
            @click="pickTool(button)"
          >
            <UIcon :name="button.icon" class="size-4" />
          </button>
        </UTooltip>
      </div>
      <div class="rt-tb-group">
        <UTooltip v-for="button in roadTools" :key="button.id" :text="button.label">
          <button
            type="button"
            class="rt-tb-btn"
            :class="{ 'rt-tb-btn-on': activeId === button.id }"
            :aria-label="button.label"
            :aria-pressed="activeId === button.id"
            @click="pickTool(button)"
          >
            <UIcon :name="button.icon" class="size-4" />
          </button>
        </UTooltip>
      </div>
      <div class="rt-tb-group">
        <UTooltip v-for="button in otherTools" :key="button.id" :text="button.label">
          <button
            type="button"
            class="rt-tb-btn"
            :class="{ 'rt-tb-btn-on': activeId === button.id }"
            :aria-label="button.label"
            :aria-pressed="activeId === button.id"
            @click="pickTool(button)"
          >
            <UIcon :name="button.icon" class="size-4" />
          </button>
        </UTooltip>
      </div>
    </template>

    <div class="rt-tb-spacer" />

    <div ref="menuRoot" class="rt-tb-menu">
      <UTooltip text="World menu">
        <button
          type="button"
          class="rt-tb-btn"
          :class="{ 'rt-tb-btn-on': menuOpen }"
          aria-label="World menu"
          :aria-expanded="menuOpen"
          @click="toggleMenu"
        >
          <UIcon name="i-lucide-menu" class="size-4" />
        </button>
      </UTooltip>
      <div v-if="menuOpen" class="rt-tb-dropdown" role="menu">
        <button v-if="inviteLink" type="button" role="menuitem" class="rt-tb-item" @click="copyInvite">
          <UIcon :name="copied ? 'i-lucide-check' : 'i-lucide-link'" class="size-4" />
          {{ copied ? 'Invite link copied' : 'Copy invite link' }}
        </button>
        <button
          v-if="game.owner.value && !game.closed.value"
          type="button"
          role="menuitem"
          class="rt-tb-item rt-tb-item-danger"
          @click="stopWorld"
        >
          <UIcon name="i-lucide-octagon-x" class="size-4" />
          {{ confirmStop ? 'Click again to stop the world for everyone' : 'Stop world' }}
        </button>
        <button type="button" role="menuitem" class="rt-tb-item" @click="leave">
          <UIcon name="i-lucide-log-out" class="size-4" />
          Leave to worlds
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rt-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--rt-toolbar-h, 40px);
  padding: 0 6px;
  overflow-x: auto;
  overflow-y: hidden;
  background: #3a352c;
  border-bottom: 1px solid #14120e;
  box-shadow: inset 0 1px 0 #6b6455, 0 2px 6px rgba(0, 0, 0, 0.4);
  scrollbar-width: none;
}
.rt-tb-group {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  padding-right: 6px;
  border-right: 1px solid #201d17;
  box-shadow: 1px 0 0 #5a5244;
}
.rt-tb-spacer {
  flex: 1;
}
.rt-tb-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid #201d17;
  background: #4a4438;
  color: #ece6d6;
  box-shadow: inset 1px 1px 0 #6b6455;
  cursor: pointer;
}
.rt-tb-btn:hover {
  background: #575043;
}
.rt-tb-btn-on {
  background: #26221b;
  color: #ffd84a;
  box-shadow: inset 1px 1px 2px rgba(0, 0, 0, 0.6);
}
.rt-tb-menu {
  position: relative;
  flex-shrink: 0;
}
.rt-tb-dropdown {
  position: fixed;
  top: calc(var(--rt-toolbar-h, 40px) - 2px);
  right: 6px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  border: 1px solid #14120e;
  background: #3a352c;
  box-shadow: inset 1px 1px 0 #6b6455, 0 6px 18px rgba(0, 0, 0, 0.5);
}
.rt-tb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  color: #ece6d6;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.rt-tb-item:hover {
  background: #4a4438;
}
.rt-tb-item-danger {
  color: #ff9a8a;
}
</style>
