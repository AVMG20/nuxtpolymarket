<script setup lang="ts">
import { SECTION_CATEGORIES, SECTIONS, type SectionId } from '#shared/utils/nitro-rush/custom'

/** The pre-built sections, by category; picking one lays it after the cursor. */
defineProps<{ disabled: boolean }>()
defineEmits<{ add: [id: SectionId] }>()

const ENTRIES = Object.entries(SECTIONS) as [SectionId, (typeof SECTIONS)[SectionId]][]
const categories = SECTION_CATEGORIES.map(c => ({ ...c, sections: ENTRIES.filter(([, s]) => s.category === c.id) }))
</script>

<template>
  <div class="flex flex-col gap-4">
    <section v-for="c in categories" :key="c.id">
      <h3 class="nr-label mb-1.5">{{ c.name.toUpperCase() }}</h3>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="[id, s] in c.sections"
          :key="id"
          class="nr-section"
          :disabled="disabled"
          @click="$emit('add', id)"
        >
          <UIcon :name="s.icon" class="size-4 shrink-0" />
          <span class="truncate">{{ s.label }}</span>
        </button>
      </div>
    </section>
  </div>
</template>
