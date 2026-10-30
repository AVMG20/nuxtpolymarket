<script setup lang="ts">
import { SECTIONS, type SectionId } from '#shared/utils/nitro-rush/custom'

/** The course's sections in driving order; the selected one is where new sections go in after. Drag a grip to move a section. */
const props = defineProps<{
    sections: SectionId[]
    cursor: number
}>()
const emit = defineEmits<{ select: [i: number], move: [from: number, to: number], remove: [i: number] }>()

/** Within this of the list's top or bottom edge, a drag scrolls it. */
const EDGE_PX = 28
const SCROLL_PX = 10

const list = ref<HTMLElement | null>(null)
/** The section being dragged and the gap it would drop into: before section `slot`, or after the last. */
const drag = ref<{ from: number, slot: number } | null>(null)

// Keeps the cursor in view as sections go in.
watch(() => props.cursor, async (i) => {
    await nextTick()
    list.value?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' })
})

/** Where a section dropped into `slot` ends up, once it's out of its old place. */
const landing = (from: number, slot: number) => slot > from ? slot - 1 : slot

/** The gap under the pointer: before the first row whose middle is below it. */
function slotAt(y: number) {
    const rows = list.value?.querySelectorAll<HTMLElement>('[data-i]') ?? []
    for (const row of rows) {
        const r = row.getBoundingClientRect()
        if (y < r.top + r.height / 2) return Number(row.dataset.i)
    }
    return props.sections.length
}

function onGripDown(e: PointerEvent, i: number) {
    if (!e.isPrimary || e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.value = { from: i, slot: i }
    emit('select', i)
}

function onGripMove(e: PointerEvent) {
    const d = drag.value
    if (!d) return
    d.slot = slotAt(e.clientY)
    // The list scrolls inside its card; near an edge the drag carries it along.
    const scroller = list.value?.parentElement
    if (!scroller) return
    const r = scroller.getBoundingClientRect()
    if (e.clientY < r.top + EDGE_PX) scroller.scrollTop -= SCROLL_PX
    else if (e.clientY > r.bottom - EDGE_PX) scroller.scrollTop += SCROLL_PX
}

function onGripUp() {
    const d = drag.value
    drag.value = null
    if (d) emit('move', d.from, landing(d.from, d.slot))
}

function onGripCancel() {
    drag.value = null
}

/** The drop line shows above the row the section would land before, or below the last. */
const dropBefore = (i: number) => !!drag.value && drag.value.slot === i && landing(drag.value.from, i) !== drag.value.from
const dropAfterLast = (i: number) => !!drag.value && i === props.sections.length - 1 && drag.value.slot === props.sections.length && drag.value.from !== i
</script>

<template>
  <ol ref="list" class="flex flex-col gap-1" :class="{ 'is-dragging': drag }">
    <li>
      <button class="nr-piece" :class="{ 'is-active': cursor === -1 }" @click="$emit('select', -1)">
        <span class="nr-piece-index">·</span>
        <span class="truncate text-white/60">Start of the road</span>
      </button>
    </li>
    <li
      v-for="(id, i) in sections"
      :key="i"
      :data-i="i"
      class="nr-piece-row flex items-center gap-1"
      :class="{ 'is-lifted': drag?.from === i, 'is-drop-before': dropBefore(i), 'is-drop-after': dropAfterLast(i) }"
    >
      <span
        class="nr-piece-grip"
        role="button"
        :aria-label="`Drag ${SECTIONS[id].label} to move it`"
        @pointerdown="onGripDown($event, i)"
        @pointermove="onGripMove"
        @pointerup="onGripUp"
        @pointercancel="onGripCancel"
        @lostpointercapture="onGripCancel"
      >
        <UIcon name="i-lucide-grip-vertical" class="size-3.5" />
      </span>
      <button class="nr-piece min-w-0 flex-1" :class="{ 'is-active': cursor === i }" @click="$emit('select', i)">
        <span class="nr-piece-index tabular-nums">{{ i + 1 }}</span>
        <UIcon :name="SECTIONS[id].icon" class="size-4 shrink-0" />
        <span class="truncate">{{ SECTIONS[id].label }}</span>
      </button>
      <template v-if="cursor === i && !drag">
        <button class="nr-piece-tool" :disabled="i === 0" aria-label="Move earlier" @click="$emit('move', i, i - 1)">
          <UIcon name="i-lucide-arrow-up" class="size-3.5" />
        </button>
        <button class="nr-piece-tool" :disabled="i === sections.length - 1" aria-label="Move later" @click="$emit('move', i, i + 1)">
          <UIcon name="i-lucide-arrow-down" class="size-3.5" />
        </button>
        <button class="nr-piece-tool is-danger" aria-label="Remove section" @click="$emit('remove', i)">
          <UIcon name="i-lucide-trash-2" class="size-3.5" />
        </button>
      </template>
    </li>
  </ol>
</template>
