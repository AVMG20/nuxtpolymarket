<script setup lang="ts">
import { onClickOutside, useEventListener, useResizeObserver } from '@vueuse/core'

// The cell grid of spreadsheet mode: virtualised rows, selection, editing and
// the formula bar, behaving like Google Sheets. Cells the tab doesn't define
// are the player's own scratch space and accept numbers, text and formulas.

const props = defineProps<{ tab: SheetTab }>()
const emit = defineEmits<{
  problem: [title: string, message: string]
  status: [text: string]
  navigate: [tabId: string]
}>()

const ROW_HEADER = 46
const COL_HEADER = 20
const ROW = SHEET_ROW_HEIGHT

// --- Scratch cells, per tab and kept across reloads ---
const SCRATCH_KEY = 'sheet-scratch'
const scratch = ref<Record<string, Record<string, string>>>({})
try {
  scratch.value = JSON.parse(localStorage.getItem(SCRATCH_KEY) ?? '{}')
} catch {
  // unreadable storage: start blank
}
watch(scratch, (value) => {
  try {
    localStorage.setItem(SCRATCH_KEY, JSON.stringify(value))
  } catch {
    // blocked storage: scratch cells last for this visit only
  }
}, { deep: true })

const tabScratch = computed(() => scratch.value[props.tab.id] ?? {})

const cells = computed<SheetCells>(() => {
  const merged: SheetCells = { ...props.tab.cells }
  const raw = tabScratch.value
  const evaluating = new Set<string>()
  const lookup = (key: string): number | null => {
    if (key in raw && !(key in props.tab.cells)) {
      if (evaluating.has(key)) return null
      evaluating.add(key)
      const cell = scratchCell(raw[key]!, lookup)
      evaluating.delete(key)
      return cellNumber(cell)
    }
    return cellNumber(props.tab.cells[key])
  }
  for (const [key, text] of Object.entries(raw)) {
    if (key in props.tab.cells) continue
    evaluating.add(key)
    merged[key] = scratchCell(text, lookup)
    evaluating.delete(key)
  }
  return merged
})

// --- Geometry ---
const widths = computed(() => Array.from({ length: SHEET_COLS }, (_, c) => props.tab.widths?.[c] ?? SHEET_COL_WIDTH))
const lefts = computed(() => {
  const out: number[] = []
  let x = 0
  for (const w of widths.value) {
    out.push(x)
    x += w
  }
  return out
})
const totalWidth = computed(() => ROW_HEADER + widths.value.reduce((a, b) => a + b, 0))

const scroller = ref<HTMLElement>()
const scrollTop = ref(0)
const viewHeight = ref(800)
const firstRow = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW) - 4))
const visibleRows = computed(() => {
  const count = Math.ceil(viewHeight.value / ROW) + 8
  const rows: number[] = []
  for (let r = firstRow.value; r < Math.min(SHEET_ROWS, firstRow.value + count); r++) rows.push(r)
  return rows
})

function onScroll() {
  if (scroller.value) scrollTop.value = scroller.value.scrollTop
}
useResizeObserver(scroller, () => {
  if (scroller.value) viewHeight.value = scroller.value.clientHeight
})

// --- Selection ---
interface Pos { r: number, c: number }
const anchor = ref<Pos>({ r: 0, c: 0 })
const head = ref<Pos>({ r: 0, c: 0 })
const remembered = new Map<string, Pos>()
watch(() => props.tab.id, (id, previous) => {
  if (previous) remembered.set(previous, { ...anchor.value })
  const pos = remembered.get(id) ?? { r: 0, c: 0 }
  cancelEdit()
  anchor.value = { ...pos }
  head.value = { ...pos }
  if (scroller.value) {
    scroller.value.scrollTop = 0
    scroller.value.scrollLeft = 0
  }
})

const range = computed(() => ({
  r1: Math.min(anchor.value.r, head.value.r),
  r2: Math.max(anchor.value.r, head.value.r),
  c1: Math.min(anchor.value.c, head.value.c),
  c2: Math.max(anchor.value.c, head.value.c)
}))
const isRange = computed(() => range.value.r1 !== range.value.r2 || range.value.c1 !== range.value.c2)
const activeKey = computed(() => cellKey(anchor.value.r, anchor.value.c))
const activeCell = computed(() => cells.value[activeKey.value])
const nameBox = computed(() => isRange.value
  ? `${cellKey(range.value.r1, range.value.c1)}:${cellKey(range.value.r2, range.value.c2)}`
  : activeKey.value)

function rect(r1: number, c1: number, r2: number, c2: number) {
  return {
    top: `${r1 * ROW}px`,
    left: `${ROW_HEADER + lefts.value[c1]!}px`,
    width: `${lefts.value[c2]! + widths.value[c2]! - lefts.value[c1]!}px`,
    height: `${(r2 - r1 + 1) * ROW}px`
  }
}

const clampPos = (p: Pos): Pos => ({
  r: Math.min(SHEET_ROWS - 1, Math.max(0, p.r)),
  c: Math.min(SHEET_COLS - 1, Math.max(0, p.c))
})

function select(p: Pos, extend = false) {
  const pos = clampPos(p)
  head.value = pos
  if (!extend) anchor.value = pos
  scrollIntoView(pos)
}

function scrollIntoView(p: Pos) {
  const el = scroller.value
  if (!el) return
  const top = p.r * ROW
  const bottom = top + ROW
  const viewH = el.clientHeight - COL_HEADER
  if (top < el.scrollTop) el.scrollTop = top
  else if (bottom > el.scrollTop + viewH) el.scrollTop = bottom - viewH
  const left = lefts.value[p.c]!
  const right = left + widths.value[p.c]!
  const viewW = el.clientWidth - ROW_HEADER
  if (left < el.scrollLeft) el.scrollLeft = left
  else if (right > el.scrollLeft + viewW) el.scrollLeft = right - viewW
}

const status = computed(() => {
  if (!isRange.value) return ''
  let sum = 0
  let numbers = 0
  let filled = 0
  const { r1, r2, c1, c2 } = range.value
  for (const [key, cell] of Object.entries(cells.value)) {
    const p = parseKey(key)
    if (!p || p.r < r1 || p.r > r2 || p.c < c1 || p.c > c2) continue
    const n = cellNumber(cell)
    if (n !== null) {
      sum += n
      numbers++
    }
    if (displayCell(cell) !== '') filled++
  }
  if (numbers) return `Sum: ${formatCellNumber(Math.round(sum * 100) / 100, Number.isInteger(sum) ? 'int' : 'number')}`
  return filled ? `Count: ${filled}` : ''
})
watch(status, text => emit('status', text), { immediate: true })

// --- Editing ---
const editing = ref(false)
// 'enter' started by typing: arrow keys commit and move. 'edit' (F2,
// double-click, formula bar) moves the caret instead.
const editMode = ref<'enter' | 'edit'>('enter')
const editText = ref('')
const editor = ref<HTMLInputElement>()
const formulaInput = ref<HTMLInputElement>()

function isProtected(key: string) {
  const cell = props.tab.cells[key]
  return !!cell && !cell.edit && !(key in tabScratch.value)
}

function protectedProblem() {
  emit('problem', 'Protected cell or object', 'You are trying to edit a protected cell or object. Please contact the spreadsheet owner to remove protection if you need to edit.')
}

function startEdit(initial: string | null, mode: 'enter' | 'edit', focusFormula = false) {
  const key = activeKey.value
  const cell = props.tab.cells[key]
  if (cell?.type === 'dropdown') {
    openDropdown()
    return
  }
  if (isProtected(key) || cell?.type === 'checkbox') {
    protectedProblem()
    return
  }
  editing.value = true
  editMode.value = mode
  editText.value = initial ?? (key in tabScratch.value ? tabScratch.value[key]! : cellSource(cell))
  nextTick(() => {
    const input = focusFormula ? formulaInput.value : editor.value
    input?.focus()
    if (initial === null) input?.setSelectionRange(input.value.length, input.value.length)
  })
}

function cancelEdit() {
  editing.value = false
  scroller.value?.focus({ preventScroll: true })
}

function commitValue(key: string, raw: string) {
  const cell = props.tab.cells[key]
  if (cell?.edit) {
    const problem = cell.edit(raw)
    if (problem) emit('problem', 'There was a problem', problem)
    return
  }
  const tabId = props.tab.id
  const next = { ...tabScratch.value }
  if (raw.trim() === '') delete next[key]
  else next[key] = raw
  scratch.value = { ...scratch.value, [tabId]: next }
}

function commitEdit(move?: Pos) {
  if (!editing.value) return
  editing.value = false
  commitValue(activeKey.value, editText.value)
  if (move) select({ r: anchor.value.r + move.r, c: anchor.value.c + move.c })
  scroller.value?.focus({ preventScroll: true })
}

function onEditorKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitEdit({ r: e.shiftKey ? -1 : 1, c: 0 })
  } else if (e.key === 'Tab') {
    e.preventDefault()
    commitEdit({ r: 0, c: e.shiftKey ? -1 : 1 })
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  } else if (editMode.value === 'enter' && e.target === editor.value) {
    const arrows: Record<string, Pos> = { ArrowUp: { r: -1, c: 0 }, ArrowDown: { r: 1, c: 0 }, ArrowLeft: { r: 0, c: -1 }, ArrowRight: { r: 0, c: 1 } }
    const move = arrows[e.key]
    if (move) {
      e.preventDefault()
      commitEdit(move)
    }
  }
}

function onFormulaFocus() {
  if (!editing.value) startEdit(null, 'edit', true)
}

const editorWidth = computed(() => Math.max(widths.value[anchor.value.c]!, editText.value.length * 7.5 + 12))

// --- Dropdown chips ---
const dropdownOpen = ref(false)
function openDropdown() {
  if (activeCell.value?.type === 'dropdown') dropdownOpen.value = true
}
function pickOption(option: string) {
  dropdownOpen.value = false
  commitValue(activeKey.value, option)
  scroller.value?.focus({ preventScroll: true })
}
onClickOutside(useTemplateRef<HTMLElement>('dropdown'), () => dropdownOpen.value = false)

// --- Mouse ---
let dragging = false
function cellAt(e: MouseEvent): Pos | null {
  const el = scroller.value
  if (!el) return null
  const box = el.getBoundingClientRect()
  const x = e.clientX - box.left + el.scrollLeft - ROW_HEADER
  const y = e.clientY - box.top + el.scrollTop - COL_HEADER
  if (y < 0) return null
  const r = Math.floor(y / ROW)
  let c = lefts.value.findIndex((left, i) => x >= left && x < left + widths.value[i]!)
  if (x < 0) c = 0
  if (c < 0) c = SHEET_COLS - 1
  return clampPos({ r, c })
}

function onCellDown(e: MouseEvent, r: number, c: number) {
  if (e.button !== 0) return
  if (editing.value) commitEdit()
  dropdownOpen.value = false
  select({ r, c }, e.shiftKey)
  dragging = true
  scroller.value?.focus({ preventScroll: true })
}

function onMouseMove(e: MouseEvent) {
  if (!dragging || !(e.buttons & 1)) {
    dragging = false
    return
  }
  const pos = cellAt(e)
  if (pos && (pos.r !== head.value.r || pos.c !== head.value.c)) head.value = pos
}
useEventListener('mouseup', () => dragging = false)

function onCheckbox(e: MouseEvent, cell: SheetCell) {
  e.stopPropagation()
  cell.toggle?.()
}

function selectColumn(c: number, extend: boolean) {
  if (editing.value) commitEdit()
  if (!extend) anchor.value = { r: 0, c }
  head.value = { r: SHEET_ROWS - 1, c }
}

function selectRow(r: number, extend: boolean) {
  if (editing.value) commitEdit()
  if (!extend) anchor.value = { r, c: 0 }
  head.value = { r, c: SHEET_COLS - 1 }
}

// --- Keyboard ---
function onKeydown(e: KeyboardEvent) {
  if (editing.value) return
  const mod = e.metaKey || e.ctrlKey
  const arrows: Record<string, Pos> = { ArrowUp: { r: -1, c: 0 }, ArrowDown: { r: 1, c: 0 }, ArrowLeft: { r: 0, c: -1 }, ArrowRight: { r: 0, c: 1 } }
  const move = arrows[e.key]
  if (dropdownOpen.value) {
    if (e.key === 'Escape') dropdownOpen.value = false
    return
  }
  if (move) {
    e.preventDefault()
    const from = e.shiftKey ? head.value : anchor.value
    const step = mod ? SHEET_ROWS : 1
    select({ r: from.r + move.r * step, c: from.c + move.c * step }, e.shiftKey)
    return
  }
  const cell = activeCell.value
  switch (e.key) {
    case 'Tab':
      e.preventDefault()
      select({ r: anchor.value.r, c: anchor.value.c + (e.shiftKey ? -1 : 1) })
      return
    case 'Enter':
      e.preventDefault()
      if (cell?.type === 'checkbox') cell.toggle?.()
      else if (e.shiftKey) select({ r: anchor.value.r - 1, c: anchor.value.c })
      else startEdit(null, 'edit')
      return
    case 'F2':
      e.preventDefault()
      startEdit(null, 'edit')
      return
    case 'PageDown':
    case 'PageUp': {
      e.preventDefault()
      const page = Math.floor((scroller.value?.clientHeight ?? 400) / ROW) - 1
      select({ r: anchor.value.r + (e.key === 'PageDown' ? page : -page), c: anchor.value.c }, e.shiftKey)
      return
    }
    case 'Home':
      e.preventDefault()
      select({ r: mod ? 0 : anchor.value.r, c: 0 })
      return
    case 'Delete':
    case 'Backspace': {
      e.preventDefault()
      const { r1, r2, c1, c2 } = range.value
      const next = { ...tabScratch.value }
      for (const key of Object.keys(next)) {
        const p = parseKey(key)
        if (p && p.r >= r1 && p.r <= r2 && p.c >= c1 && p.c <= c2) delete next[key]
      }
      scratch.value = { ...scratch.value, [props.tab.id]: next }
      return
    }
  }
  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    anchor.value = { r: 0, c: 0 }
    head.value = { r: SHEET_ROWS - 1, c: SHEET_COLS - 1 }
    return
  }
  if (mod && e.key.toLowerCase() === 'c') {
    e.preventDefault()
    copySelection()
    return
  }
  if (mod && ['z', 'y', 'b', 'i', 'u', 's', 'p', 'f'].includes(e.key.toLowerCase())) {
    // Keep the browser's own save/print/find dialogs from breaking the illusion
    e.preventDefault()
    return
  }
  if (e.key === ' ' && cell?.type === 'checkbox') {
    e.preventDefault()
    cell.toggle?.()
    return
  }
  // The boss key belongs to the page
  if (e.key.length === 1 && e.code !== 'Backquote' && !mod && !e.altKey) {
    e.preventDefault()
    startEdit(e.key, 'enter')
  }
}

function copySelection() {
  const { r1, r2, c1, c2 } = range.value
  const lastRow = Math.min(r2, r1 + 500)
  const lines: string[] = []
  for (let r = r1; r <= lastRow; r++) {
    const row: string[] = []
    for (let c = c1; c <= c2; c++) row.push(displayCell(cells.value[cellKey(r, c)]))
    lines.push(row.join('\t'))
  }
  navigator.clipboard?.writeText(lines.join('\n').replace(/\s+$/, '')).catch(() => {})
}

// --- Rendering ---
interface RenderCell { c: number, key: string, cell?: SheetCell, text: string, width: number, align: string }

function renderRow(r: number): RenderCell[] {
  const out: RenderCell[] = []
  for (let c = 0; c < SHEET_COLS; c++) {
    const key = cellKey(r, c)
    const cell = cells.value[key]
    const text = displayCell(cell)
    const numeric = typeof cell?.v === 'number' && !cell.error && !cell.loading
    const align = cell?.align ?? (cell?.type === 'checkbox' ? 'center' : numeric ? 'right' : 'left')
    let width = widths.value[c]!
    // Left-aligned text spills over empty cells to its right, as in Sheets
    if (text && align === 'left' && !cell?.type) {
      for (let next = c + 1; next < SHEET_COLS && !displayCell(cells.value[cellKey(r, next)]) && !cells.value[cellKey(r, next)]?.type; next++) {
        if (text.length * 7.5 < width) break
        width += widths.value[next]!
      }
    }
    out.push({ c, key, cell, text, width, align })
  }
  return out
}

const hoverKey = ref<string | null>(null)
const hoverCell = computed(() => hoverKey.value ? cells.value[hoverKey.value] : undefined)
const hoverPos = computed(() => hoverKey.value ? parseKey(hoverKey.value) : null)

const activeRect = computed(() => {
  const box = rect(anchor.value.r, anchor.value.c, anchor.value.r, anchor.value.c)
  return { ...box, width: `calc(${box.width} + 1px)`, height: `${ROW + 1}px` }
})

const dropdownPos = computed(() => rect(anchor.value.r, anchor.value.c, anchor.value.r, anchor.value.c))

onMounted(() => scroller.value?.focus({ preventScroll: true }))
defineExpose({ focus: () => scroller.value?.focus({ preventScroll: true }) })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Formula bar -->
    <div class="flex h-[30px] shrink-0 items-center border-b border-[#e1e3e1] bg-white text-[13px]">
      <div class="flex h-full w-[92px] shrink-0 items-center justify-between px-2 text-[#1f1f1f]">
        <span class="truncate">{{ nameBox }}</span>
        <UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-4 shrink-0 text-[#444746]" />
      </div>
      <div class="h-[18px] w-px bg-[#c4c7c5]" />
      <UIcon name="i-material-symbols-function" class="mx-2.5 size-[18px] shrink-0 text-[#444746]" />
      <input
        ref="formulaInput"
        :value="editing ? editText : cellSource(activeCell)"
        class="h-full min-w-0 flex-1 bg-transparent font-[Arial] text-[13px] text-[#1f1f1f] outline-none"
        spellcheck="false"
        @focus="onFormulaFocus"
        @input="editText = ($event.target as HTMLInputElement).value"
        @keydown="onEditorKeydown"
      >
    </div>

    <!-- Grid -->
    <div
      ref="scroller"
      class="sheet-scroll relative min-h-0 flex-1 overflow-auto bg-white outline-none"
      tabindex="0"
      @scroll="onScroll"
      @keydown="onKeydown"
      @mousemove="onMouseMove"
    >
      <div class="relative" :style="{ width: `${totalWidth}px`, height: `${COL_HEADER + SHEET_ROWS * ROW}px` }">
        <!-- Column headers -->
        <div class="sticky top-0 z-30 flex" :style="{ height: `${COL_HEADER}px`, width: `${totalWidth}px` }">
          <div
            class="sticky left-0 z-10 shrink-0 border-b-[3px] border-r-[3px] border-[#c4c7c5] bg-[#f8f9fa]"
            :style="{ width: `${ROW_HEADER}px` }"
            @mousedown.prevent="anchor = { r: 0, c: 0 }; head = { r: SHEET_ROWS - 1, c: SHEET_COLS - 1 }"
          />
          <div
            v-for="(w, c) in widths"
            :key="c"
            class="flex shrink-0 cursor-default select-none items-center justify-center border-b border-r border-[#c4c7c5] text-[11px]"
            :class="c >= range.c1 && c <= range.c2 ? (range.r1 === 0 && range.r2 === SHEET_ROWS - 1 ? 'bg-[#0b57d0] text-white' : 'bg-[#d3e3fd] text-[#041e49] font-medium') : 'bg-[#f8f9fa] text-[#444746]'"
            :style="{ width: `${w}px` }"
            @mousedown.prevent="selectColumn(c, $event.shiftKey)"
          >
            {{ colName(c) }}
          </div>
        </div>

        <!-- Rows -->
        <div class="absolute left-0 right-0" :style="{ top: `${COL_HEADER}px`, height: `${SHEET_ROWS * ROW}px` }">
          <div
            v-for="r in visibleRows"
            :key="r"
            class="absolute left-0 flex"
            :style="{ top: `${r * ROW}px`, height: `${ROW}px`, width: `${totalWidth}px` }"
          >
            <div
              class="sticky left-0 z-20 flex shrink-0 cursor-default select-none items-center justify-center border-b border-r border-[#c4c7c5] text-[11px]"
              :class="r >= range.r1 && r <= range.r2 ? (range.c1 === 0 && range.c2 === SHEET_COLS - 1 ? 'bg-[#0b57d0] text-white' : 'bg-[#d3e3fd] text-[#041e49] font-medium') : 'bg-[#f8f9fa] text-[#444746]'"
              :style="{ width: `${ROW_HEADER}px` }"
              @mousedown.prevent="selectRow(r, $event.shiftKey)"
            >
              {{ r + 1 }}
            </div>
            <div class="relative flex-1">
              <div
                v-for="item in renderRow(r)"
                :key="item.c"
                class="absolute top-0 flex h-full cursor-cell items-end overflow-hidden whitespace-nowrap border-b border-r border-[#e1e1e1] px-[3px] pb-[2px] font-[Arial] leading-[17px]"
                :class="[item.text || item.cell?.bg || item.cell?.type ? 'z-[1]' : '', item.cell?.bg ? '' : (item.text ? 'bg-white' : '')]"
                :style="{
                  left: `${lefts[item.c]}px`,
                  width: `${item.width}px`,
                  justifyContent: item.align === 'right' ? 'flex-end' : item.align === 'center' ? 'center' : 'flex-start',
                  background: item.cell?.bg,
                  color: item.cell?.error ? '#1f1f1f' : (item.cell?.color ?? '#000'),
                  fontWeight: item.cell?.bold ? 700 : 400,
                  fontStyle: item.cell?.italic ? 'italic' : undefined,
                  fontSize: `${item.cell?.size ?? 13}px`
                }"
                @mousedown="onCellDown($event, r, item.c)"
                @dblclick="startEdit(null, 'edit')"
                @mouseenter="hoverKey = item.cell?.note || item.cell?.error ? item.key : null"
                @mouseleave="hoverKey = null"
              >
                <template v-if="item.cell?.type === 'checkbox'">
                  <UIcon
                    :name="item.cell.v ? 'i-material-symbols-check-box-rounded' : 'i-material-symbols-check-box-outline-blank-rounded'"
                    class="mb-px size-[18px] cursor-pointer text-[#444746]"
                    @mousedown.stop="onCellDown($event, r, item.c)"
                    @click="onCheckbox($event, item.cell)"
                  />
                </template>
                <template v-else-if="item.cell?.type === 'dropdown'">
                  <span
                    class="mb-[-1px] flex h-[17px] min-w-0 cursor-pointer items-center gap-0.5 rounded-full bg-[#e8eaed] pl-2 pr-0.5 text-[12px] text-[#1f1f1f]"
                    @click="select({ r, c: item.c }); openDropdown()"
                  >
                    <span class="truncate">{{ item.text }}</span>
                    <UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-4 shrink-0" />
                  </span>
                </template>
                <span v-else class="truncate" :class="[item.align === 'left' ? 'text-clip' : '', item.cell?.link ? 'text-[#1155cc] underline' : '']">{{ item.text }}</span>
                <span
                  v-if="item.cell?.note && !item.cell.error"
                  class="absolute right-0 top-0 size-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-black"
                />
                <span
                  v-if="item.cell?.error"
                  class="absolute right-0 top-0 size-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-[#d93025]"
                />
              </div>
            </div>
          </div>

          <!-- Selection -->
          <div
            v-if="isRange"
            class="pointer-events-none absolute z-[5] border border-[#1a73e8] bg-[#1a73e8]/10"
            :style="rect(range.r1, range.c1, range.r2, range.c2)"
          />
          <div
            class="pointer-events-none absolute z-[6] -translate-x-px -translate-y-px border-2 border-[#1a73e8]"
            :style="activeRect"
          >
            <span
              v-if="!isRange"
              class="absolute -bottom-[4px] -right-[4px] size-[7px] rounded-full border border-white bg-[#1a73e8]"
            />
          </div>
          <span
            v-if="isRange"
            class="pointer-events-none absolute z-[6] size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[#1a73e8]"
            :style="{ top: `${(range.r2 + 1) * ROW}px`, left: `${ROW_HEADER + lefts[range.c2]! + widths[range.c2]!}px` }"
          />

          <!-- Cell editor -->
          <input
            v-if="editing"
            ref="editor"
            v-model="editText"
            class="absolute z-40 -translate-x-px -translate-y-px border-2 border-[#1a73e8] bg-white px-[2px] font-[Arial] text-[13px] text-black shadow-[0_2px_6px_rgba(60,64,67,0.3)] outline-none"
            :style="{ top: `${anchor.r * ROW}px`, left: `${ROW_HEADER + lefts[anchor.c]!}px`, width: `${editorWidth + 1}px`, height: `${ROW + 1}px` }"
            spellcheck="false"
            @keydown="onEditorKeydown"
          >

          <!-- Dropdown chip menu -->
          <div
            v-if="dropdownOpen && activeCell?.options"
            ref="dropdown"
            class="absolute z-50 min-w-[160px] rounded bg-white py-1.5 font-[Arial] text-[13px] text-[#1f1f1f] shadow-[0_2px_6px_2px_rgba(60,64,67,0.15),0_1px_2px_rgba(60,64,67,0.3)]"
            :style="{ top: `calc(${dropdownPos.top} + ${ROW + 2}px)`, left: dropdownPos.left }"
          >
            <button
              v-for="option in activeCell.options"
              :key="option"
              class="flex w-full items-center px-3 py-1 text-left hover:bg-[#f1f3f4]"
              @mousedown.prevent
              @click="pickOption(option)"
            >
              <span class="rounded-full bg-[#e8eaed] px-2 text-[12px] leading-[17px]">{{ option }}</span>
            </button>
          </div>

          <!-- Link popover -->
          <div
            v-if="activeCell?.link && !editing && !isRange"
            class="absolute z-50 flex items-center gap-2 rounded-[8px] bg-white py-2 pl-3 pr-4 font-[Google_Sans,Roboto,Arial,sans-serif] text-[14px] shadow-[0_1px_3px_1px_rgba(60,64,67,0.15),0_1px_2px_rgba(60,64,67,0.3)]"
            :style="{ top: `calc(${dropdownPos.top} + ${ROW + 4}px)`, left: dropdownPos.left }"
            @mousedown.stop
          >
            <UIcon name="i-material-symbols-tab-outline-rounded" class="size-5 shrink-0 text-[#188038]" />
            <button class="whitespace-nowrap text-[#0b57d0] hover:underline" @click="emit('navigate', activeCell.link.tabId)">
              {{ activeCell.link.label }}
            </button>
          </div>

          <!-- Note / error popover -->
          <div
            v-if="hoverCell && hoverPos"
            class="pointer-events-none absolute z-50 w-[220px] bg-white px-3 py-2 font-[Arial] text-[12px] leading-snug text-[#1f1f1f] shadow-[0_1px_3px_1px_rgba(60,64,67,0.15),0_1px_2px_rgba(60,64,67,0.3)]"
            :class="hoverCell.error ? 'rounded border-l-4 border-[#d93025]' : ''"
            :style="{ top: `${hoverPos.r * ROW}px`, left: `${ROW_HEADER + lefts[hoverPos.c]! + widths[hoverPos.c]! + 4}px` }"
          >
            <template v-if="hoverCell.error">
              <p class="mb-0.5 font-bold text-[#d93025]">Error</p>
              <p>{{ hoverCell.error }}</p>
            </template>
            <template v-else>{{ hoverCell.note }}</template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sheet-scroll::-webkit-scrollbar {
  width: 14px;
  height: 14px;
}
.sheet-scroll::-webkit-scrollbar-thumb {
  background: #dadce0;
  border: 3px solid #fff;
  border-radius: 8px;
}
.sheet-scroll::-webkit-scrollbar-thumb:hover {
  background: #bdc1c6;
}
.sheet-scroll::-webkit-scrollbar-track,
.sheet-scroll::-webkit-scrollbar-corner {
  background: #fff;
}
</style>
