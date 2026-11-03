<script setup lang="ts">
// Rail Tycoon — the playable view.
//
// Opens the world over RtNet, offering the parts cached from the last visit (part-cache.ts) or, on a
// reopen, the current world's, builds an RtLockstep from the snapshot, draws it with RtRenderer
// on a full-viewport canvas and turns pointer gestures into commands through RtTools. A reconnect, a
// room that unloaded or a resync replaces the lockstep from the new snapshot while an overlay stays up.
// The toolbar, status bar and windows come in through slots and reach the game
// through useRtGame() (RT_GAME_KEY); window.__railTycoon gives the browser harness read-only views
// of local state.
import type { RtCommand } from '#shared/utils/rail-tycoon/commands'
import type { RtErrorCode, RtPauseReason, RtRole, RtServerMsg } from '#shared/utils/rail-tycoon/protocol'
import { RT_NONE } from '#shared/utils/rail-tycoon/types'
import { RtCamera, RtScrollKey, rtTileCorners } from '~/utils/rail-tycoon/camera'
import { RtLockstep, type RtLocalParts, type RtSnapshot } from '~/utils/rail-tycoon/lockstep'
import { RT_NET_BACKOFF_MAX_MS, RT_NET_BACKOFF_MIN_MS, RtNet, type RtNetStopReason } from '~/utils/rail-tycoon/net'
import { rtCacheParts, rtCachedParts, rtForgetParts } from '~/utils/rail-tycoon/part-cache'
import { RtRenderer } from '~/utils/rail-tycoon/renderer'
import { RtToolKind, RtTools, rtPointerTile, type RtToolPreview } from '~/utils/rail-tycoon/tools'
import {
  RT_GAME_KEY,
  RT_GAME_TICK_MS,
  rtCommandErrorText,
  rtFormatMoney,
  rtServerErrorText,
  useRtWindows,
  type RtConnectionStatus,
  type RtDebugHook,
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

/** Pointer travel (CSS px) after which a left press with no tool becomes a drag instead of a click. */
const CLICK_SLOP = 4
/** Wheel delta that makes one zoom step; trackpads send many small ones. */
const WHEEL_STEP = 50

// ─── State ───────────────────────────────────────────────────────────────

const host = ref<HTMLElement | null>(null)
const lockstep = shallowRef<RtLockstep | null>(null)
const tick = ref(0)
const socketUp = ref(false)
const everOpened = ref(false)
/** Waiting for an opened message (first open, reconnect, unloaded room). */
const opening = ref(true)
const resyncing = ref(false)
const stopped = ref<RtNetStopReason | null>(null)
const role = ref<RtRole>(props.role)
const companyId = ref<number | null>(null)
const owner = ref(false)
const invite = ref<string | null>(props.inviteCode)
const paused = ref<RtPauseReason | null>(null)
const closed = ref(false)
const tool = ref<RtToolKind>(RtToolKind.none)
const toolOptions = ref(0)
const rendererFailed = ref(false)
const cursorNote = ref<{ x: number, y: number, text: string, bad: boolean } | null>(null)

const camera = markRaw(new RtCamera())
const tools = markRaw(new RtTools({
  world: () => lockstep.value?.world ?? null,
  company: () => lockstep.value?.company ?? RT_NONE
}))

let net: RtNet | null = null
let renderer: RtRenderer | null = null
let unmounted = false
const abort = new AbortController()
const offs: (() => void)[] = []
let lockstepOffs: (() => void)[] = []
/** The role, company, owner and invite of the last opened message, for a resync that has no lockstep to inherit from. */
let openedMeta: Pick<Extract<RtServerMsg, { type: 'opened' }>, 'role' | 'company' | 'owner' | 'inviteCode'> | null = null
/** Bumped by every snapshot message, so a slower earlier build never replaces a newer one. */
let buildToken = 0
/** The cached parts the last open offered, until a build has used them. */
let cachedParts: RtLocalParts = new Map()
/** The world was deleted: leaving must not cache it again. */
let forgotten = false
let reopenTimer: ReturnType<typeof setTimeout> | null = null
let reopenAttempt = 0
let seq = 0
let centred = false

const status = computed<RtConnectionStatus>(() => {
  if (stopped.value) return 'stopped'
  if (!socketUp.value) return everOpened.value ? 'reconnecting' : 'connecting'
  if (opening.value || !lockstep.value) return 'connecting'
  if (resyncing.value) return 'resyncing'
  if (closed.value) return 'closed'
  if (role.value === 'spectator') return 'spectating'
  return 'connected'
})

const isPlayer = computed(() => role.value === 'player' && companyId.value !== null && !closed.value)
const overlay = computed(() => {
  if (stopped.value || rendererFailed.value) return null
  if (status.value === 'reconnecting') return 'Connection lost, reconnecting…'
  if (status.value === 'connecting') return everOpened.value ? 'Reopening the world…' : 'Opening the world…'
  if (status.value === 'resyncing') return 'Catching up with the server…'
  return null
})
const pauseText = computed(() => {
  switch (paused.value) {
    case 'noPlayers': return 'Paused: waiting for a player'
    case 'joining': return 'Paused: a player is joining'
    case 'closed': return 'Paused: the world is closed'
    default: return null
  }
})

// ─── Commands ────────────────────────────────────────────────────────────

function canCommand(): boolean {
  const ls = lockstep.value
  return !!ls && ls.canCommand && !opening.value && socketUp.value && !closed.value
}

function sendCommand(command: RtCommand): boolean {
  const ls = lockstep.value
  if (!ls || !net || !canCommand()) return false
  seq = (seq + 1) & 0xff
  const msg = ls.commandMessage(command, seq)
  if (!msg) return false
  return net.send(msg)
}

function selectTool(next: RtToolKind) {
  if (!isPlayer.value && next !== RtToolKind.none) return
  tools.select(next)
  toolOptions.value++
  syncTool()
}

function refreshTool() {
  toolOptions.value++
  tools.refresh()
}

function syncTool() {
  tool.value = tools.tool
  if (tools.tool === RtToolKind.none) cursorNote.value = null
}

function centreOnTile(tile: number) {
  const ls = lockstep.value
  if (!ls || !ls.world.map.validTile(tile)) return
  const map = ls.world.map
  const x = map.tileX(tile)
  const y = map.tileY(tile)
  const [n, w, e, s] = rtTileCorners(map, x, y)
  camera.centreOnTile(x + 0.5, y + 0.5, (n + w + e + s) / 4)
}

function leave(reason: RtLeaveReason = 'user') {
  emit('leave', reason)
}

const game: RtGameContext = {
  worldId: props.worldId,
  lockstep,
  tools,
  camera,
  tick,
  status,
  role,
  companyId,
  owner,
  inviteCode: invite,
  paused,
  closed,
  tool,
  toolOptions,
  canCommand,
  company: () => {
    const ls = lockstep.value
    return ls && ls.company !== null ? ls.world.company(ls.company) ?? null : null
  },
  sendCommand,
  send: msg => net?.send(msg) ?? false,
  selectTool,
  refreshTool,
  zoom: step => camera.zoomAt(camera.width / 2, camera.height / 2, step),
  centreOnTile,
  leave: () => leave('user')
}
provide(RT_GAME_KEY, game)

// ─── Opening and replacing the lockstep ──────────────────────────────────

/** Opens the world, offering the current world's parts on a reopen or the cached ones on a first open. */
async function sendOpen() {
  if (!net || unmounted || stopped.value) return
  opening.value = true
  const ls = lockstep.value
  let have: string[]
  if (ls) {
    have = ls.offerParts()
  } else {
    const cached = await rtCachedParts(props.worldId)
    if (!net || unmounted || stopped.value) return
    cachedParts = cached.local
    have = cached.have
  }
  net.send({ type: 'open', worldId: props.worldId, inviteCode: props.inviteCode ?? null, have })
}

/** Re-sends open after the capped backoff RtNet uses for its reconnects. */
function reopenLater() {
  if (reopenTimer !== null || unmounted) return
  opening.value = true
  const delay = Math.min(RT_NET_BACKOFF_MAX_MS, RT_NET_BACKOFF_MIN_MS * 2 ** reopenAttempt)
  reopenAttempt++
  reopenTimer = setTimeout(() => {
    reopenTimer = null
    void sendOpen()
  }, delay)
}

function cancelReopen() {
  if (reopenTimer !== null) clearTimeout(reopenTimer)
  reopenTimer = null
}

async function buildLockstep(snapshot: RtSnapshot) {
  const token = ++buildToken
  const previous = lockstep.value
  const msg = snapshot.head
  let source: RtSnapshot = snapshot
  if (msg.type === 'resync' && !previous) {
    // the first build failed and asked for this resync: it carries no role, so reuse the opened one's
    if (!openedMeta) {
      net?.discardHeld()
      return
    }
    source = { ...snapshot, head: { ...msg, type: 'opened', ...openedMeta } }
  }
  const sendRaw = (m: Parameters<RtNet['send']>[0]) => {
    net?.send(m)
  }
  const built = await RtLockstep.create(source, sendRaw, {
    previous: msg.type === 'resync' ? previous ?? undefined : undefined,
    local: new Map([...cachedParts, ...(previous?.heldParts ?? [])]),
    keep: (parts) => {
      if (!forgotten) void rtCacheParts(props.worldId, parts)
    }
  })
  if (unmounted || token !== buildToken) return
  if (!built) {
    // it asked for a resync already; the answer builds the next one
    resyncing.value = true
    return
  }
  cachedParts = new Map()
  installLockstep(markRaw(built), msg.type === 'opened')
  net?.release(m => built.receive(m))
}

/** Puts a freshly built lockstep in place; `fresh` is a new open, after which the room re-sends its pause state. */
function installLockstep(ls: RtLockstep, fresh: boolean) {
  for (const off of lockstepOffs) off()
  lockstepOffs = [
    ls.on('paused', (reason) => {
      paused.value = reason
      // a closed world's room pauses for good; a spectator opening it learns it was closed here
      if (reason === 'closed' && !closed.value) becomeSpectator()
    }),
    ls.on('resumed', () => {
      paused.value = null
    }),
    ls.on('role', (next) => {
      role.value = next
      if (next === 'spectator') becomeSpectator()
    }),
    ls.on('resync', () => {
      resyncing.value = true
    }),
    ls.on('dirty', () => {
      dirtySinceRefresh = true
    })
  ]
  lockstep.value = ls
  role.value = ls.role
  companyId.value = ls.company
  owner.value = ls.owner
  invite.value = ls.inviteCode
  // the room sends its pause state after every opened; a resync keeps the one already shown
  if (fresh) paused.value = null
  resyncing.value = false
  // a room that unloaded while this was being built is opened again shortly: stay in opening until then
  opening.value = reopenTimer !== null
  everOpened.value = true
  reopenAttempt = 0
  tick.value = ls.world.tick
  renderer?.setLockstep(ls)
  if (!centred) {
    centred = true
    const side = ls.world.map.side
    camera.centreOnTile(side / 2, side / 2)
  }
  if (ls.role !== 'player') becomeSpectator(false)
  tools.refresh()
}

/** Drops the build tools and stops sending commands; `closing` marks the owner's stop. */
function becomeSpectator(closing = true) {
  if (closing) closed.value = true
  tools.select(RtToolKind.none)
  syncTool()
  renderer?.drawPreview(null)
}

function onSnapshot(snapshot: RtSnapshot) {
  const msg = snapshot.head
  if (msg.worldId !== props.worldId) {
    net?.discardHeld()
    return
  }
  if (msg.type === 'opened') {
    openedMeta = { role: msg.role, company: msg.company, owner: msg.owner, inviteCode: msg.inviteCode }
    closed.value = false
    cancelReopen()
  } else {
    resyncing.value = true
  }
  void buildLockstep(snapshot)
}

function onMessage(msg: RtServerMsg) {
  switch (msg.type) {
    case 'command':
    case 'allowance':
    case 'hash':
    case 'paused':
    case 'resumed':
    case 'worldClosed':
      // only reaches here once the lockstep is built (RtNet holds them until release)
      lockstep.value?.receive(msg)
      return
    case 'result':
      toast.add({ title: rtCommandErrorText(msg.error), color: 'error' })
      return
    case 'roomUnloaded':
      // the room went away under us: keep the old world on screen behind the overlay and open again
      reopenLater()
      return
    case 'worldDeleted':
      void rtForgetParts(msg.worldId)
      if (msg.worldId === props.worldId) {
        forgotten = true
        leave('deleted')
      }
      return
    case 'error':
      onError(msg.code)
      return
    default:
      return
  }
}

function onError(code: RtErrorCode) {
  if (code === 'worldBroken') {
    cancelReopen()
    leave('broken')
    return
  }
  if (code === 'noAccess') {
    leave('noAccess')
    return
  }
  // an open or a resync refused for a cooldown or a full server: open again after the backoff, which
  // also brings a fresh snapshot for the resync
  if ((opening.value || resyncing.value) && (code === 'tooSoon' || code === 'busy')) {
    reopenLater()
    return
  }
  toast.add({ title: rtServerErrorText(code), color: 'error' })
}

// ─── Frame loop ──────────────────────────────────────────────────────────

let scrollKeys = 0
let fastScroll = false
let lastFrame = 0
let lastTickBump = 0
let dirtySinceRefresh = false
let pointerInside = false
let pointerX = 0
let pointerY = 0

function beforeRender(now: number) {
  const elapsed = lastFrame ? Math.min(100, now - lastFrame) : 0
  lastFrame = now
  if (net && socketUp.value && !net.connected) socketUp.value = false
  if (scrollKeys) camera.keyScroll(scrollKeys, fastScroll, elapsed)
  else if (pointerInside && !drag && document.hasFocus()) camera.edgeScroll(pointerX, pointerY, elapsed)
  const ls = lockstep.value
  if (!ls) return
  if (!opening.value) ls.frame()
  if (ls.world.tick !== tick.value && now - lastTickBump >= RT_GAME_TICK_MS) {
    lastTickBump = now
    tick.value = ls.world.tick
    if (dirtySinceRefresh && tools.tool !== RtToolKind.none && !drag) tools.refresh()
    dirtySinceRefresh = false
  }
}

// ─── Pointer input ───────────────────────────────────────────────────────

type DragMode = 'scroll' | 'tool' | 'click'
let drag: { id: number, mode: DragMode, startX: number, startY: number, lastX: number, lastY: number, moved: boolean } | null = null
let wheelDelta = 0

const BUILD_TOOLS = new Set<RtToolKind>([RtToolKind.rail, RtToolKind.road, RtToolKind.railStation, RtToolKind.roadStop, RtToolKind.depot, RtToolKind.signal, RtToolKind.demolish, RtToolKind.parking])

function local(e: PointerEvent | WheelEvent): { x: number, y: number } {
  const rect = renderer!.canvas.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function tileAt(x: number, y: number) {
  const ls = lockstep.value
  if (!ls) return null
  return rtPointerTile(camera, ls.world.map, x, y)
}

function onPointerDown(e: PointerEvent) {
  if (!renderer || drag) return
  const p = local(e)
  let mode: DragMode
  if (e.button === 1 || e.button === 2) {
    mode = 'scroll'
  } else if (e.button === 0) {
    const t = tools.tool
    mode = t === RtToolKind.none ? 'click' : 'tool'
    if (BUILD_TOOLS.has(t)) {
      const hit = tileAt(p.x, p.y)
      if (hit) tools.pointerDown(hit.tile, hit.at)
    }
  } else {
    return
  }
  e.preventDefault()
  renderer.canvas.setPointerCapture(e.pointerId)
  drag = { id: e.pointerId, mode, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: false }
}

function onPointerMove(e: PointerEvent) {
  if (!renderer) return
  const p = local(e)
  if (drag && drag.id === e.pointerId) {
    if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) > CLICK_SLOP) drag.moved = true
    if (drag.mode === 'click' && drag.moved) drag.mode = 'scroll'
    if (drag.mode === 'scroll') {
      camera.dragScroll(p.x - drag.lastX, p.y - drag.lastY, 'map')
      drag.lastX = p.x
      drag.lastY = p.y
      return
    }
    drag.lastX = p.x
    drag.lastY = p.y
  }
  if (tools.tool === RtToolKind.none) return
  const hit = tileAt(p.x, p.y)
  if (hit) tools.pointerMove(hit.tile, hit.at)
  placeCursorNote(e.clientX, e.clientY)
}

function onPointerUp(e: PointerEvent) {
  if (!renderer || !drag || drag.id !== e.pointerId) return
  const current = drag
  drag = null
  if (renderer.canvas.hasPointerCapture(e.pointerId)) renderer.canvas.releasePointerCapture(e.pointerId)
  const p = local(e)
  const hit = tileAt(p.x, p.y)
  if (current.mode === 'tool') {
    if (hit) tools.pointerUp(hit.tile, hit.at, e.ctrlKey)
    else tools.cancel()
    syncTool()
  } else if (current.mode === 'click' && hit) {
    emit('query', hit.tile)
  }
}

function onPointerCancel(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  drag = null
  tools.cancel()
}

function onPointerLeave() {
  if (!drag) cursorNote.value = null
}

// Edge scrolling follows the pointer over the whole view: the toolbar and the status bar cover the
// map's top and bottom edge zones, so the canvas alone never sees the pointer there.
function onViewPointerMove(e: PointerEvent) {
  if (!renderer) return
  const p = local(e)
  pointerX = p.x
  pointerY = p.y
  pointerInside = true
}

function onViewPointerLeave() {
  pointerInside = false
}

function onWheel(e: WheelEvent) {
  if (!renderer) return
  e.preventDefault()
  wheelDelta += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
  if (Math.abs(wheelDelta) < WHEEL_STEP) return
  const p = local(e)
  camera.zoomAt(p.x, p.y, wheelDelta < 0 ? 1 : -1)
  wheelDelta = 0
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

// ─── Keyboard ────────────────────────────────────────────────────────────

const ARROWS: Record<string, number> = {
  ArrowLeft: RtScrollKey.left,
  ArrowUp: RtScrollKey.up,
  ArrowRight: RtScrollKey.right,
  ArrowDown: RtScrollKey.down
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e.target) || e.metaKey || e.altKey) return
  const bit = ARROWS[e.key]
  if (bit) {
    e.preventDefault()
    scrollKeys |= bit
    fastScroll = e.shiftKey
    return
  }
  if (e.key === 'Escape' || e.key === 'r' || e.key === 'R') {
    if (e.ctrlKey) return
    tools.key(e.key)
    // R turns the depot, station or stop in the tool's options: the picker and toolbar follow
    toolOptions.value++
    syncTool()
  }
}

function onKeyUp(e: KeyboardEvent) {
  const bit = ARROWS[e.key]
  if (bit) scrollKeys &= ~bit
  fastScroll = e.shiftKey
}

function onBlur() {
  scrollKeys = 0
  pointerInside = false
}

// ─── Test hook ───────────────────────────────────────────────────

function installDebugHook() {
  const hook: RtDebugHook = {
    get ready() {
      return !!lockstep.value && !opening.value && !resyncing.value
    },
    worldId: props.worldId,
    get tick() {
      return lockstep.value?.world.tick ?? null
    },
    get hash() {
      return lockstep.value?.world.hash() ?? null
    },
    get company() {
      return lockstep.value?.company ?? null
    },
    get role() {
      return lockstep.value?.role ?? null
    },
    tileToScreen(x, y) {
      const ls = lockstep.value
      if (!ls || !renderer || x < 0 || y < 0 || x >= ls.world.map.side || y >= ls.world.map.side) return null
      const [n, w, e, s] = rtTileCorners(ls.world.map, x, y)
      const point = camera.tileToScreen(x + 0.5, y + 0.5, (n + w + e + s) / 4)
      const rect = renderer.canvas.getBoundingClientRect()
      return { x: rect.left + point.x, y: rect.top + point.y }
    },
    screenToTile(clientX, clientY) {
      const ls = lockstep.value
      if (!ls || !renderer) return null
      const rect = renderer.canvas.getBoundingClientRect()
      return camera.screenToTile(clientX - rect.left, clientY - rect.top, ls.world.map)
    }
  }
  ;(window as unknown as { __railTycoon?: RtDebugHook }).__railTycoon = hook
}

// ─── Lifecycle ───────────────────────────────────────────────────────────

onMounted(async () => {
  installDebugHook()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  offs.push(
    tools.on('command', (command) => {
      if (!sendCommand(command)) toast.add({ title: 'Not connected to the world, try again in a moment', color: 'warning' })
    }),
    tools.on('preview', onPreview),
    tools.on('query', tile => emit('query', tile)),
    tools.on('tool', () => syncTool())
  )

  net = new RtNet()
  offs.push(
    net.on('message', onMessage),
    net.on('snapshot', onSnapshot),
    net.on('open', () => {
      socketUp.value = true
      // every open, the first and each reconnect, opens the world again
      cancelReopen()
      void sendOpen()
    }),
    net.on('stopped', (reason) => {
      stopped.value = reason
      socketUp.value = false
      cancelReopen()
    })
  )
  net.connect()

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
  const canvas = renderer.canvas
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('contextmenu', e => e.preventDefault())
  if (lockstep.value) renderer.setLockstep(lockstep.value)
  renderer.start(beforeRender)
})

onBeforeUnmount(() => {
  unmounted = true
  abort.abort()
  cancelReopen()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onBlur)
  for (const off of offs) off()
  for (const off of lockstepOffs) off()
  offs.length = 0
  lockstepOffs = []
  if (renderer) {
    const canvas = renderer.canvas
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerCancel)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('wheel', onWheel)
    renderer.destroy()
    renderer = null
  }
  net?.discardHeld()
  net?.close()
  net = null
  // the world as left, so the next visit downloads only what changed meanwhile
  const last = lockstep.value
  const have = last && !forgotten ? last.offerParts() : []
  if (last && have.length > 0) void rtCacheParts(props.worldId, have.map(hash => last.heldParts.get(hash)!))
  lockstep.value = null
  windows.closeAll()
  const w = window as unknown as { __railTycoon?: RtDebugHook }
  if (w.__railTycoon?.worldId === props.worldId) delete w.__railTycoon
})

defineExpose({ game })

function reload() {
  window.location.reload()
}

const stopNotice = computed(() => {
  switch (stopped.value) {
    case 'outdated': return { title: 'Rail Tycoon was updated', text: 'Reload the page to keep playing on the new version.' }
    case 'replaced': return { title: 'Opened in another tab', text: 'Rail Tycoon is running in another tab or window. Reload to play here instead.' }
    case 'unauthorized': return { title: 'You are signed out', text: 'Sign in again to keep playing.' }
    default: return null
  }
})
</script>

<template>
  <div class="rt-view" @contextmenu.prevent @pointermove="onViewPointerMove" @pointerleave="onViewPointerLeave">
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
