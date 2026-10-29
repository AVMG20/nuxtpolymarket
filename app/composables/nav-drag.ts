import { NAV_ROOT, isNavFolderId, type NavListId } from '#shared/utils/nav-layout'

/*
 * Pointer drag and drop for the sidebar. Sidebar rows and home page cards
 * start a drag; the sidebar marks where things can land:
 *
 *   [data-nav-zone]                the droppable part of the sidebar
 *   [data-nav-list="<id>"]         a list: "root" or a folder id
 *     > [data-nav-row][data-nav-key]  its entries, in order
 *   [data-nav-folder-head="<id>"]  a folder header: dropping a game on it files it there
 *
 * Mouse and pen only: on touch a press scrolls, and a long press opens the
 * context menu, which offers the same moves.
 */

export interface NavDragPayload {
  key: string
  label: string
  icon: string
}

export interface NavDropTarget {
  list: NavListId
  index?: number
}

interface Indicator {
  top: number
  left: number
  width: number
  height: number
  box: boolean
}

const THRESHOLD_PX = 5
const EDGE_PX = 40

const state = reactive({
  payload: null as NavDragPayload | null,
  x: 0,
  y: 0,
  target: null as NavDropTarget | null,
  indicator: null as Indicator | null
})

function rowsOf(list: HTMLElement, skip: string) {
  return [...list.querySelectorAll<HTMLElement>(':scope > [data-nav-row]')].filter(row => row.dataset.navKey !== skip)
}

/** Insertion point in a list for the pointer's y */
function slotIn(list: HTMLElement, y: number, skip: string): { target: NavDropTarget, indicator: Indicator } {
  const rows = rowsOf(list, skip)
  const index = rows.filter((row) => {
    const r = row.getBoundingClientRect()
    return r.top + r.height / 2 < y
  }).length
  const box = list.getBoundingClientRect()
  let top: number
  if (!rows.length) top = box.top + 2
  else if (index < rows.length) top = rows[index]!.getBoundingClientRect().top - 1
  else top = rows[rows.length - 1]!.getBoundingClientRect().bottom + 1
  return {
    target: { list: list.dataset.navList!, index },
    indicator: { top, left: box.left + 4, width: box.width - 8, height: 2, box: false }
  }
}

function findTarget(x: number, y: number, key: string) {
  const el = document.elementFromPoint(x, y)
  const zone = el?.closest<HTMLElement>('[data-nav-zone]')
  if (!el || !zone) return null
  const root = zone.querySelector<HTMLElement>(`[data-nav-list="${NAV_ROOT}"]`)
  if (!root) return null
  const draggingFolder = isNavFolderId(key)

  const head = el.closest<HTMLElement>('[data-nav-folder-head]')
  if (head && !draggingFolder) {
    const id = head.dataset.navFolderHead!
    const r = head.getBoundingClientRect()
    // The top edge of a header still means "above this folder"
    if (y > r.top + r.height * 0.3) {
      const expanded = head.dataset.navExpanded === 'true'
      const list = zone.querySelector<HTMLElement>(`[data-nav-list="${id}"]`)
      if (expanded && list) return { target: { list: id, index: 0 }, indicator: { top: r.bottom, left: r.left + 4, width: r.width - 8, height: 2, box: false } }
      return { target: { list: id }, indicator: { top: r.top, left: r.left, width: r.width, height: r.height, box: true } }
    }
  }

  let list = el.closest<HTMLElement>('[data-nav-list]') ?? root
  if (!zone.contains(list)) list = root
  if (draggingFolder && list !== root) {
    // Folders only live at the top level: aim at the folder row we're over
    const row = list.closest<HTMLElement>(`[data-nav-list="${NAV_ROOT}"] > [data-nav-row]`)
    list = root
    if (row) {
      const r = row.getBoundingClientRect()
      return slotIn(root, y < r.top + r.height / 2 ? r.top : r.bottom, key)
    }
  }
  return slotIn(list, y, key)
}

let scrollFrame = 0
/** Ends whatever press is still being tracked */
let abortPress: (() => void) | null = null

function retarget() {
  if (!state.payload) return
  const hit = findTarget(state.x, state.y, state.payload.key)
  state.target = hit?.target ?? null
  state.indicator = hit?.indicator ?? null
}

function autoScroll() {
  cancelAnimationFrame(scrollFrame)
  if (!state.payload) return
  const zone = document.querySelector<HTMLElement>('[data-nav-zone]')
  const scroller = zone?.closest<HTMLElement>('.nav-scroll')
  if (scroller) {
    const r = scroller.getBoundingClientRect()
    const inside = state.x >= r.left && state.x <= r.right
    const before = scroller.scrollTop
    if (inside && state.y < r.top + EDGE_PX) scroller.scrollTop -= 8
    else if (inside && state.y > r.bottom - EDGE_PX) scroller.scrollTop += 8
    // The rows moved under a still pointer
    if (scroller.scrollTop !== before) retarget()
  }
  scrollFrame = requestAnimationFrame(autoScroll)
}

function swallowNextClick() {
  const stop = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  window.addEventListener('click', stop, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 50)
}

function endDrag() {
  cancelAnimationFrame(scrollFrame)
  document.documentElement.classList.remove('nav-dragging')
  state.payload = null
  state.target = null
  state.indicator = null
}

export function useNavDrag() {
  const nav = useNavLayout()

  /** Call from pointerdown on anything draggable. Clicks still work: the
   *  drag only starts once the pointer moves a few pixels. */
  function press(event: PointerEvent, payload: NavDragPayload) {
    // Ctrl+click is a right-click on macOS: that opens the context menu
    if (event.button !== 0 || event.ctrlKey || event.pointerType === 'touch') return
    abortPress?.()
    const startX = event.clientX
    const startY = event.clientY
    let started = false

    function teardown() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onCancel)
      if (abortPress === cancel) abortPress = null
    }

    function cancel() {
      if (state.payload?.key === payload.key) endDrag()
      teardown()
    }

    function onMove(e: PointerEvent) {
      // The release happened somewhere we never heard about
      if (e.buttons === 0) {
        cancel()
        return
      }
      if (started && !state.payload) return // cancelled with Esc, waiting for the release
      if (!started) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD_PX) return
        started = true
        state.payload = payload
        document.documentElement.classList.add('nav-dragging')
        window.getSelection()?.removeAllRanges()
        autoScroll()
      }
      e.preventDefault()
      state.x = e.clientX
      state.y = e.clientY
      retarget()
    }

    function onUp() {
      // Swallow the click this release makes, even after an Esc cancel
      if (started) swallowNextClick()
      const target = state.payload?.key === payload.key ? state.target : null
      if (state.payload?.key === payload.key) endDrag()
      teardown()
      if (target) nav.move(payload.key, target.list, target.index)
    }

    function onCancel() {
      cancel()
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || !state.payload) return
      e.preventDefault()
      e.stopPropagation()
      endDrag()
    }

    abortPress = cancel
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onCancel)
  }

  return { state: readonly(state), press }
}
