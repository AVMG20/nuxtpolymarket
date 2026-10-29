<script setup lang="ts">
import { SECTIONS, type SectionId } from '#shared/utils/nitro-rush/custom'

/** The course's sections in driving order; the selected one is where new sections go in after. */
const props = defineProps<{
    sections: SectionId[]
    cursor: number
}>()
defineEmits<{ select: [i: number], move: [i: number, by: -1 | 1], remove: [i: number] }>()

const list = ref<HTMLElement | null>(null)

// Keeps the cursor in view as sections go in.
watch(() => props.cursor, async (i) => {
    await nextTick()
    list.value?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
  <ol ref="list" class="flex flex-col gap-1">
    <li>
      <button class="nr-piece" :class="{ 'is-active': cursor === -1 }" @click="$emit('select', -1)">
        <span class="nr-piece-index">·</span>
        <span class="truncate text-white/60">Start of the road</span>
      </button>
    </li>
    <li v-for="(id, i) in sections" :key="i" :data-i="i" class="flex items-center gap-1">
      <button class="nr-piece min-w-0 flex-1" :class="{ 'is-active': cursor === i }" @click="$emit('select', i)">
        <span class="nr-piece-index tabular-nums">{{ i + 1 }}</span>
        <UIcon :name="SECTIONS[id].icon" class="size-4 shrink-0" />
        <span class="truncate">{{ SECTIONS[id].label }}</span>
      </button>
      <template v-if="cursor === i">
        <button class="nr-piece-tool" :disabled="i === 0" aria-label="Move earlier" @click="$emit('move', i, -1)">
          <UIcon name="i-lucide-arrow-up" class="size-3.5" />
        </button>
        <button class="nr-piece-tool" :disabled="i === sections.length - 1" aria-label="Move later" @click="$emit('move', i, 1)">
          <UIcon name="i-lucide-arrow-down" class="size-3.5" />
        </button>
        <button class="nr-piece-tool is-danger" aria-label="Remove section" @click="$emit('remove', i)">
          <UIcon name="i-lucide-trash-2" class="size-3.5" />
        </button>
      </template>
    </li>
  </ol>
</template>
