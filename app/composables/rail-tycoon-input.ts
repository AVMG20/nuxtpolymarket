// Rail Tycoon — the game view's map input: pointer gestures on the canvas (a tool's press, drag and
// release, a right or middle drag to scroll, a plain click to query), wheel zoom, arrow-key scrolling,
// R and Escape for the tools, and edge scrolling over the whole view.
import type { RtCamera } from '~/utils/rail-tycoon/camera'
import { RtScrollKey } from '~/utils/rail-tycoon/camera'
import type { RtMap } from '#shared/utils/rail-tycoon/map'
import { RtToolKind, rtPointerTile, type RtTools } from '~/utils/rail-tycoon/tools'

/** Pointer travel (CSS px) after which a left press with no tool becomes a drag instead of a click. */
const CLICK_SLOP = 4
/** Wheel delta that makes one zoom step; trackpads send many small ones. */
const WHEEL_STEP = 50

const BUILD_TOOLS = new Set<RtToolKind>([RtToolKind.rail, RtToolKind.road, RtToolKind.railStation, RtToolKind.roadStop, RtToolKind.depot, RtToolKind.signal, RtToolKind.demolish, RtToolKind.parking])

const ARROWS: Record<string, number> = {
  ArrowLeft: RtScrollKey.left,
  ArrowUp: RtScrollKey.up,
  ArrowRight: RtScrollKey.right,
  ArrowDown: RtScrollKey.down
}

export interface RtInputOptions {
  camera: RtCamera
  tools: RtTools
  /** The world's map, or null before one loads. */
  map(): RtMap | null
  /** A plain left click on a tile with no tool out. */
  onQuery(tile: number): void
  /** The tool may have changed (a release, Escape). */
  onTool(): void
  /** The pointer moved over the map with a tool out, at these client coordinates. */
  onToolHover(clientX: number, clientY: number): void
  /** The pointer left the canvas with no drag running. */
  onLeave(): void
}

type DragMode = 'scroll' | 'tool' | 'click'

interface Drag {
  id: number
  mode: DragMode
  startX: number
  startY: number
  lastX: number
  lastY: number
  moved: boolean
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

export function useRtInput(options: RtInputOptions) {
  const { camera, tools } = options
  let canvas: HTMLCanvasElement | null = null
  let drag: Drag | null = null
  let wheelDelta = 0
  let scrollKeys = 0
  let fastScroll = false
  let pointerInside = false
  let pointerX = 0
  let pointerY = 0

  function local(e: PointerEvent | WheelEvent): { x: number, y: number } {
    const rect = canvas!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function tileAt(x: number, y: number) {
    const map = options.map()
    return map ? rtPointerTile(camera, map, x, y) : null
  }

  // ─── Pointer ─────────────────────────────────────────────────────────────

  function onPointerDown(e: PointerEvent) {
    if (!canvas || drag) return
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
    canvas.setPointerCapture(e.pointerId)
    drag = { id: e.pointerId, mode, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: false }
  }

  function onPointerMove(e: PointerEvent) {
    if (!canvas) return
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
    options.onToolHover(e.clientX, e.clientY)
  }

  function onPointerUp(e: PointerEvent) {
    if (!canvas || !drag || drag.id !== e.pointerId) return
    const current = drag
    drag = null
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    const p = local(e)
    const hit = tileAt(p.x, p.y)
    if (current.mode === 'tool') {
      if (hit) tools.pointerUp(hit.tile, hit.at, e.ctrlKey)
      else tools.cancel()
      options.onTool()
    } else if (current.mode === 'click' && hit) {
      options.onQuery(hit.tile)
    }
  }

  function onPointerCancel(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return
    drag = null
    tools.cancel()
  }

  function onPointerLeave() {
    if (!drag) options.onLeave()
  }

  function onWheel(e: WheelEvent) {
    if (!canvas) return
    e.preventDefault()
    wheelDelta += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    if (Math.abs(wheelDelta) < WHEEL_STEP) return
    const p = local(e)
    camera.zoomAt(p.x, p.y, wheelDelta < 0 ? 1 : -1)
    wheelDelta = 0
  }

  function noMenu(e: Event) {
    e.preventDefault()
  }

  /** Edge scrolling follows the pointer over the whole view: the toolbar and the status bar cover the map's edge zones. */
  function onViewPointerMove(e: PointerEvent) {
    if (!canvas) return
    const p = local(e)
    pointerX = p.x
    pointerY = p.y
    pointerInside = true
  }

  function onViewPointerLeave() {
    pointerInside = false
  }

  // ─── Keyboard ────────────────────────────────────────────────────────────

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
      options.onTool()
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

  // ─── Wiring ──────────────────────────────────────────────────────────────

  const CANVAS_EVENTS = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerCancel],
    ['pointerleave', onPointerLeave],
    ['contextmenu', noMenu]
  ] as const

  /** Starts listening on the renderer's canvas. */
  function attach(element: HTMLCanvasElement): void {
    canvas = element
    for (const [type, listener] of CANVAS_EVENTS) element.addEventListener(type, listener as EventListener)
    element.addEventListener('wheel', onWheel, { passive: false })
  }

  function detach(): void {
    if (!canvas) return
    for (const [type, listener] of CANVAS_EVENTS) canvas.removeEventListener(type, listener as EventListener)
    canvas.removeEventListener('wheel', onWheel)
    canvas = null
  }

  /** The frame's scrolling: arrow keys first, else the pointer at an edge (never while dragging). */
  function scroll(elapsed: number): void {
    if (scrollKeys) camera.keyScroll(scrollKeys, fastScroll, elapsed)
    else if (pointerInside && !drag && document.hasFocus()) camera.edgeScroll(pointerX, pointerY, elapsed)
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    detach()
  })

  return {
    attach,
    detach,
    scroll,
    /** Whether a press is held: the tools' preview waits for the release. */
    dragging: () => drag !== null,
    onViewPointerMove,
    onViewPointerLeave
  }
}
