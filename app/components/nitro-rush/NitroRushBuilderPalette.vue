<script setup lang="ts">
import { PALETTE_SECTIONS, SECTION_CATEGORIES, sectionFault, type SectionCategory, type SectionId } from '#shared/utils/nitro-rush/custom'
import type { RoadState } from '#shared/utils/nitro-rush/layout'

/** The pre-built sections as pictures, by category; picking one lays it after the cursor, or says what the road there lacks for it. */
const props = defineProps<{
    disabled: boolean
    /** The road's state where a new section would go in. */
    state: RoadState
}>()
const emit = defineEmits<{ add: [id: SectionId] }>()

const category = ref<SectionCategory>(SECTION_CATEGORIES[0]!.id)
const shown = computed(() => PALETTE_SECTIONS.filter(([, s]) => s.category === category.value))
const thumbs = useNitroRushSectionThumbs(() => shown.value.map(([id]) => id))
const strip = ref<HTMLElement | null>(null)

const faultOf = (id: SectionId) => sectionFault(id, props.state)
/** The section last refused; its note goes by itself once the road suits it. */
const refused = ref<SectionId | null>(null)
const notice = computed(() => refused.value && faultOf(refused.value))

// Not disabled when the road doesn't suit it: tapping is how a player finds out why.
function place(id: SectionId) {
    refused.value = faultOf(id) ? id : null
    if (!refused.value) emit('add', id)
}

watch(category, () => {
    refused.value = null
    if (strip.value) strip.value.scrollLeft = 0
})

/** A mouse wheel only scrolls up and down, which would strand the cards past the bar's edge; at the edge it passes on to the page. */
function onWheel(e: WheelEvent) {
    const el = strip.value
    if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    const before = el.scrollLeft
    el.scrollLeft += e.deltaY
    if (el.scrollLeft !== before) e.preventDefault()
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div class="nr-tabs is-compact" role="tablist" aria-label="Section category">
        <button
          v-for="c in SECTION_CATEGORIES"
          :key="c.id"
          class="nr-tab"
          :class="{ 'is-active': category === c.id }"
          role="tab"
          :aria-selected="category === c.id"
          @click="category = c.id"
        >
          {{ c.name.toUpperCase() }}
        </button>
      </div>
      <p v-if="disabled" class="text-[11px] font-semibold text-white/60 [font-family:system-ui,sans-serif]">That's the most sections a track can have.</p>
      <p v-else-if="notice" class="nr-section-notice first-letter:uppercase" role="status">{{ notice }}</p>
    </div>
    <div ref="strip" class="nr-section-strip" role="tabpanel" @wheel="onWheel">
      <button
        v-for="[id, s] in shown"
        :key="id"
        class="nr-section"
        :class="{ 'is-locked': faultOf(id) }"
        :disabled="disabled"
        :aria-disabled="!!faultOf(id)"
        :title="s.label"
        @click="place(id)"
      >
        <span class="nr-section-thumb">
          <img v-if="thumbs[id]" :src="thumbs[id]" alt="" draggable="false">
          <UIcon v-else :name="s.icon" class="size-5" />
        </span>
        <span class="nr-section-name">{{ s.label }}</span>
      </button>
    </div>
  </div>
</template>
