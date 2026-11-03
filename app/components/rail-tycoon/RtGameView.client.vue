<script setup lang="ts">
// Rail Tycoon — the playable view.
//
// useRtSession opens the world and keeps an RtLockstep in step with the room; this view draws it
// with RtRenderer on a full-viewport canvas, steps it from the render loop and turns the map input
// (useRtInput) into commands through RtTools. While the session opens, reconnects or resyncs, an
// overlay stays up over the last world drawn. The toolbar, status bar and windows come in through
// slots and reach the game through useRtGame() (RT_GAME_KEY); window.__railTycoon (useRtDebugHook)
// gives the browser harness read-only views of local state.
import { applyCommand } from '#shared/utils/rail-tycoon/commands'
import type { RtRole } from '#shared/utils/rail-tycoon/protocol'
import { RT_NONE } from '#shared/utils/rail-tycoon/types'
import { RtCamera, rtCornerHeightsAt } from '~/utils/rail-tycoon/camera'
import type { RtLockstep } from '~/utils/rail-tycoon/lockstep'
import { RtRenderer } from '~/utils/rail-tycoon/renderer'
import { RtToolKind, RtTools, type RtToolPreview } from '~/utils/rail-tycoon/tools'
import {
  RT_GAME_KEY,
  RT_GAME_TICK_MS,
  rtCommandErrorText,
  rtFormatMoney,
  useRtWindows,
  type RtGameContext,
  type RtLeaveReason
} from '~/utils/rail-tycoon/windows'

const props = withDefaults(defineProps<{
  worldId: string
  /** The role the chooser opened the world as; the opened message has the last word. */
  role?: RtRole
  /** An invite code lets a stranger spectate. */
  inviteCode?: string | null
}>(), {
  role: 'player',
  inviteCode: null
})

const emit = defineEmits<{
  leave: [reason: RtLeaveReason]
  /** A query click on a tile; the page opens the depot, station or vehicle window for it. */
  query: [tile: number]
}>()

const toast = useToast()
const windows = useRtWindows()

// ─── State ───────────────────────────────────────────────────────────────

const host = ref<HTMLElement | null>(null)
const tool = ref<RtToolKind>(RtToolKind.none)
const orderPickOwner = shallowRef<string | null>(null)
const rendererFailed = ref(false)
const cursorNote = ref<{ x: number, y: number, text: string, bad: boolean } | null>(null)

const camera = markRaw(new RtCamera())
const tools = markRaw(new RtTools({
  world: () => session.lockstep.value?.world ?? null,
  company: () => session.lockstep.value?.company ?? RT_NONE
}))
const toolOptions = shallowRef(tools.options)
tools.on('options', (options) => {
  toolOptions.value = options
})

let renderer: RtRenderer | null = null
let unmounted = false
const abort = new AbortController()
const offs: (() => void)[] = []
let centred = false
let lastFrame = 0
let lastTickBump = 0
let dirtySinceRefresh = false

const session = useRtSession({
  worldId: props.worldId,
  role: props.role,
  inviteCode: props.inviteCode ?? null,
  onInstalled,
  onSpectator: dropTools,
  onDirty: () => {
    dirtySinceRefresh = true
  },
  onLeave: leave
})
const { lockstep, tick, status, stopped, closed } = session

const input = useRtInput({
  camera,
  tools,
  map: () => lockstep.value?.world.map ?? null,
  onQuery: tile => emit('query', tile),
  onTool: syncTool,
  onToolHover: placeCursorNote,
  onLeave: () => {
    cursorNote.value = null
  }
})

useRtDebugHook({
  worldId: props.worldId,
  lockstep,
  camera,
  canvas: () => renderer?.canvas ?? null,
  ready: () => !!lockstep.value && !session.opening.value && !session.resyncing.value
})

const isPlayer = computed(() => session.role.value === 'player' && session.companyId.value !== null && !closed.value)
const overlay = computed(() => {
  if (stopped.value || rendererFailed.value) return null
  if (status.value === 'reconnecting') return 'Connection lost, reconnecting…'
  if (status.value === 'connecting') return session.everOpened.value ? 'Reopening the world…' : 'Opening the world…'
  if (status.value === 'resyncing') return 'Catching up with the server…'
  return null
})
const pauseText = computed(() => {
  switch (session.paused.value) {
    case 'noPlayers': return 'Paused: waiting for a player'
    case 'joining': return 'Paused: a player is joining'
    case 'closed': return 'Paused: the world is closed'
    default: return null
  }
})
const stopNotice = computed(() => {
  switch (stopped.value) {
    case 'outdated': return { title: 'Rail Tycoon was updated', text: 'Reload the page to keep playing on the new version.' }
    case 'replaced': return { title: 'Opened in another tab', text: 'Rail Tycoon is running in another tab or window. Reload to play here instead.' }
    case 'unauthorized': return { title: 'You are signed out', text: 'Sign in again to keep playing.' }
    default: return null
  }
})

// ─── Tools ───────────────────────────────────────────────────────────────

/** Passes `sent` through, warning first when it is false: the one not-connected toast. */
function warnUnless(sent: boolean): boolean {
  if (!sent) toast.add({ title: 'Not connected to the world, try again in a moment', color: 'warning' })
  return sent
}

function selectTool(next: RtToolKind) {
  if (!isPlayer.value && next !== RtToolKind.none) return
  tools.select(next)
  syncTool()
}

function syncTool() {
  tool.value = tools.tool
  if (tools.tool === RtToolKind.none) cursorNote.value = null
}

/** Puts the build tools away: the player became a spectator. */
function dropTools() {
  tools.select(RtToolKind.none)
  syncTool()
  renderer?.drawPreview(null)
}

function onPreview(preview: RtToolPreview | null) {
  renderer?.drawPreview(preview)
  if (!preview || tools.tool === RtToolKind.none) {
    cursorNote.value = null
    return
  }
  const text = preview.hint ?? (preview.ok ? (preview.cost !== 0 ? `Cost: ${rtFormatMoney(preview.cost)}` : '') : preview.error !== null ? rtCommandErrorText(preview.error) : '')
  if (!text) {
    cursorNote.value = null
    return
  }
  cursorNote.value = { x: cursorNote.value?.x ?? 0, y: cursorNote.value?.y ?? 0, text, bad: !preview.ok }
}

function placeCursorNote(clientX: number, clientY: number) {
  const note = cursorNote.value
  const rect = host.value?.getBoundingClientRect()
  if (!note || !rect) return
  note.x = clientX - rect.left + 16
  note.y = clientY - rect.top + 18
}

// ─── The world on screen ─────────────────────────────────────────────────

function onInstalled(ls: RtLockstep) {
  renderer?.setLockstep(ls)
  if (!centred) {
    centred = true
    const side = ls.world.map.side
    camera.centreOnTile(side / 2, side / 2)
  }
  tools.refresh()
}

function centreOnTile(tile: number) {
  const ls = lockstep.value
  if (!ls || !ls.world.map.validTile(tile)) return
  const map = ls.world.map
  const x = map.tileX(tile)
  const y = map.tileY(tile)
  const [n, w, e, s] = rtCornerHeightsAt(map, x, y)
  camera.centreOnTile(x + 0.5, y + 0.5, (n + w + e + s) / 4)
}

function beforeRender(now: number) {
  const elapsed = lastFrame ? Math.min(100, now - lastFrame) : 0
  lastFrame = now
  session.pollSocket()
  input.scroll(elapsed)
  const ls = lockstep.value
  if (!ls) return
  if (!session.opening.value) ls.frame()
  if (ls.world.tick !== tick.value && now - lastTickBump >= RT_GAME_TICK_MS) {
    lastTickBump = now
    tick.value = ls.world.tick
    if (dirtySinceRefresh && tools.tool !== RtToolKind.none && !input.dragging()) tools.refresh()
    dirtySinceRefresh = false
  }
}

function leave(reason: RtLeaveReason = 'user') {
  emit('leave', reason)
}

function reload() {
  window.location.reload()
}

// ─── Game context ────────────────────────────────────────────────────────

const game: RtGameContext = {
  worldId: props.worldId,
  lockstep,
  tools,
  camera,
  tick,
  status,
  role: session.role,
  companyId: session.companyId,
  owner: session.owner,
  inviteCode: session.invite,
  paused: session.paused,
  closed,
  tool,
  orderPickOwner,
  toolOptions,
  canCommand: session.canCommand,
  company: () => {
    const ls = lockstep.value
    return ls && ls.company !== null ? ls.world.company(ls.company) ?? null : null
  },
  sendCommand: session.sendCommand,
  sendCommandOrWarn: command => warnUnless(session.sendCommand(command)),
  tryCommand: (command) => {
    const ls = lockstep.value
    const company = session.companyId.value
    return ls && company !== null ? applyCommand(ls.world, company, command, false) : null
  },
  send: session.send,
  sendOrWarn: msg => warnUnless(session.send(msg)),
  selectTool,
  zoom: step => camera.zoomAt(camera.width / 2, camera.height / 2, step),
  centreOnTile,
  leave: () => leave('user')
}
provide(RT_GAME_KEY, game)
defineExpose({ game })

// ─── Lifecycle ───────────────────────────────────────────────────────────

onMounted(async () => {
  offs.push(
    tools.on('command', command => warnUnless(session.sendCommand(command))),
    tools.on('preview', onPreview),
    tools.on('query', tile => emit('query', tile)),
    tools.on('tool', () => syncTool())
  )
  const element = host.value
  if (!element) return
  try {
    const created = await RtRenderer.create(element, { camera, signal: abort.signal })
    if (!created || unmounted) {
      created?.destroy()
      return
    }
    renderer = markRaw(created)
  } catch (error) {
    console.error('[rail-tycoon] renderer failed to start', error)
    rendererFailed.value = true
    return
  }
  input.attach(renderer.canvas)
  if (lockstep.value) renderer.setLockstep(lockstep.value)
  renderer.start(beforeRender)
})

onBeforeUnmount(() => {
  unmounted = true
  abort.abort()
  for (const off of offs) off()
  offs.length = 0
  input.detach()
  renderer?.destroy()
  renderer = null
  windows.closeAll()
})
</script>

<template>
  <div class="rt-view" @contextmenu.prevent @pointermove="input.onViewPointerMove" @pointerleave="input.onViewPointerLeave">
    <div ref="host" class="rt-canvas" />

    <div class="rt-top">
      <slot name="toolbar" :game="game" />
    </div>

    <div class="rt-windows">
      <slot name="windows" :game="game" />
      <slot :game="game" />
    </div>

    <div class="rt-bottom">
      <slot name="status" :game="game" />
    </div>

    <div v-if="pauseText && !overlay" class="rt-paused" role="status">
      <UIcon name="i-lucide-pause" class="size-4" /> {{ pauseText }}
    </div>

    <div v-if="closed && !overlay" class="rt-closed-badge" role="status">
      <UIcon name="i-lucide-lock" class="size-3.5" /> World closed: spectating
    </div>

    <div
      v-if="cursorNote && cursorNote.text"
      class="rt-cursor-note"
      :class="{ 'rt-cursor-note-bad': cursorNote.bad }"
      :style="{ left: `${cursorNote.x}px`, top: `${cursorNote.y}px` }"
    >
      {{ cursorNote.text }}
    </div>

    <div v-if="overlay" class="rt-overlay" role="status">
      <div class="rt-overlay-box">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
        <span>{{ overlay }}</span>
      </div>
    </div>

    <div v-if="stopNotice" class="rt-overlay rt-overlay-solid" role="alertdialog">
      <div class="rt-notice">
        <h2>{{ stopNotice.title }}</h2>
        <p>{{ stopNotice.text }}</p>
        <div class="rt-notice-actions">
          <button type="button" class="rt-notice-btn rt-notice-btn-main" @click="reload">
            <UIcon name="i-lucide-refresh-cw" class="size-4" /> Reload
          </button>
          <button type="button" class="rt-notice-btn" @click="leave('user')">
            Back to worlds
          </button>
        </div>
      </div>
    </div>

    <div v-if="rendererFailed" class="rt-overlay rt-overlay-solid" role="alertdialog">
      <div class="rt-notice">
        <h2>The map could not start</h2>
        <p>Your browser could not start the WebGL renderer Rail Tycoon draws with.</p>
        <div class="rt-notice-actions">
          <button type="button" class="rt-notice-btn rt-notice-btn-main" @click="reload">
            <UIcon name="i-lucide-refresh-cw" class="size-4" /> Reload
          </button>
          <button type="button" class="rt-notice-btn" @click="leave('user')">
            Back to worlds
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rt-view {
  --rt-toolbar-h: 40px;
  --rt-status-h: 26px;
  position: relative;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
  background: #000;
  color: #e8e4d8;
  user-select: none;
  touch-action: none;
}
.rt-canvas {
  position: absolute;
  inset: 0;
}
.rt-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
}
.rt-bottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
}
.rt-windows {
  position: absolute;
  top: var(--rt-toolbar-h);
  bottom: var(--rt-status-h);
  left: 0;
  right: 0;
  z-index: 10;
  pointer-events: none;
}
.rt-paused,
.rt-closed-badge {
  position: absolute;
  left: 50%;
  top: calc(var(--rt-toolbar-h) + 10px);
  transform: translateX(-50%);
  z-index: 15;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid #6b6455;
  background: rgba(30, 27, 22, 0.88);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  pointer-events: none;
}
.rt-closed-badge {
  top: calc(var(--rt-toolbar-h) + 40px);
  color: #f0b46a;
}
.rt-cursor-note {
  position: absolute;
  z-index: 16;
  padding: 2px 6px;
  border: 1px solid #6b6455;
  background: rgba(30, 27, 22, 0.9);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
}
.rt-cursor-note-bad {
  color: #ff8a7a;
}
.rt-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.45);
}
.rt-overlay-solid {
  z-index: 50;
  background: rgba(0, 0, 0, 0.75);
}
.rt-overlay-box {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border: 1px solid #6b6455;
  background: #2b2720;
  font-size: 13px;
  font-weight: 600;
}
.rt-notice {
  width: min(420px, calc(100vw - 32px));
  padding: 18px 20px;
  border: 1px solid #6b6455;
  background: #2b2720;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.rt-notice h2 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 700;
}
.rt-notice p {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.45;
  color: #cfc8b6;
}
.rt-notice-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rt-notice-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid #6b6455;
  background: #3a352c;
  font-size: 13px;
  font-weight: 600;
  color: inherit;
  cursor: pointer;
}
.rt-notice-btn:hover {
  background: #4a4438;
}
.rt-notice-btn-main {
  background: #5b7d3a;
  border-color: #7da255;
}
.rt-notice-btn-main:hover {
  background: #6b9045;
}
</style>
