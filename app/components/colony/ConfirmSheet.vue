<script setup lang="ts">
/**
 * A Burrow-styled confirm step: a bottom sheet on phones, a centred card from
 * `sm` up. Rendered in place (not portalled) so it keeps the Colony theme, so
 * it does its own modal plumbing: focus is trapped inside while open and
 * returned to whatever opened it, and the page behind stops scrolling.
 *
 * The `actions` slot gets `ready`: false for a moment after opening, so a
 * sloppy double tap on the button that opened the sheet can't confirm it too.
 */
const props = defineProps<{
  open: boolean
  title: string
  description?: string
}>()

const emit = defineEmits<{ close: [] }>()

const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const ready = ref(false)

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let returnFocus: HTMLElement | null = null
let readyTimer: ReturnType<typeof setTimeout> | null = null
let locked: { el: HTMLElement, overflow: string }[] = []

/** Every element that could scroll the page behind the sheet: the document and the layout's scroll container. */
function scrollers(): HTMLElement[] {
  const found: HTMLElement[] = [document.documentElement, document.body]
  let el = root.value?.parentElement ?? null
  while (el && el !== document.body) {
    const overflowY = getComputedStyle(el).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') found.push(el)
    el = el.parentElement
  }
  return found
}

function lockScroll() {
  locked = scrollers().map(el => ({ el, overflow: el.style.overflow }))
  for (const { el } of locked) el.style.overflow = 'hidden'
}

function unlockScroll() {
  for (const { el, overflow } of locked) el.style.overflow = overflow
  locked = []
}

function focusables(): HTMLElement[] {
  return panel.value ? Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)) : []
}

/** Pull focus back in if it escapes (a click on the page behind, a screen reader jump). */
function onFocusIn(e: FocusEvent) {
  if (panel.value && e.target instanceof Node && !panel.value.contains(e.target)) panel.value.focus()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key !== 'Tab') return
  const items = focusables()
  if (!items.length) {
    e.preventDefault()
    return
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  if (e.shiftKey && (active === first || active === panel.value)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

async function onOpen() {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  ready.value = false
  if (readyTimer) clearTimeout(readyTimer)
  readyTimer = setTimeout(() => { ready.value = true }, 300)
  await nextTick()
  lockScroll()
  document.addEventListener('focusin', onFocusIn)
  panel.value?.focus()
}

function onClose() {
  if (readyTimer) clearTimeout(readyTimer)
  readyTimer = null
  ready.value = false
  document.removeEventListener('focusin', onFocusIn)
  unlockScroll()
  const target = returnFocus
  returnFocus = null
  // The opener may have been re-rendered away; only hand focus back if it's still on the page.
  if (target?.isConnected) target.focus()
}

watch(() => props.open, open => open ? onOpen() : onClose())
onMounted(() => {
  if (props.open) void onOpen()
})
onBeforeUnmount(() => {
  if (props.open) onClose()
})
</script>

<template>
  <div
    v-if="open"
    ref="root"
    class="cl-scrim flex items-end sm:items-center justify-center sm:p-4"
    @click.self="emit('close')"
    @keydown="onKeydown"
  >
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
      class="cl-dialog w-full sm:max-w-[440px] max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-3xl px-4 pt-3 sm:p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] outline-none"
    >
      <span
        class="sm:hidden block mx-auto mb-3 w-10 h-1 rounded-full bg-[#5a4431]"
        aria-hidden="true"
      />
      <h2 class="cl-display text-2xl font-bold">
        {{ title }}
      </h2>
      <p
        v-if="description"
        class="text-[13px] text-muted mt-0.5"
      >
        {{ description }}
      </p>
      <div class="mt-3.5">
        <slot />
      </div>
      <div class="flex gap-2.5 mt-4 justify-end flex-wrap">
        <slot
          name="actions"
          :ready="ready"
        />
      </div>
    </div>
  </div>
</template>
