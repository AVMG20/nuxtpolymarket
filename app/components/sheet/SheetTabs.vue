<script setup lang="ts">
import { onClickOutside, useResizeObserver } from '@vueuse/core'

// The sheet tabs strip along the bottom, with the All Sheets menu, scroll
// arrows when the tabs overflow, and the selection's sum on the right.

const active = defineModel<string>({ required: true })
const props = defineProps<{ tabs: { id: string, name: string }[], status: string }>()

const strip = useTemplateRef<HTMLElement>('strip')
const menu = useTemplateRef<HTMLElement>('menu')
const menuOpen = ref(false)
onClickOutside(menu, () => menuOpen.value = false)

function pick(id: string) {
  active.value = id
  menuOpen.value = false
}

function scrollBy(direction: number) {
  strip.value?.scrollBy({ left: direction * 240, behavior: 'smooth' })
}

watch(active, async (id) => {
  await nextTick()
  strip.value?.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})

const overflowing = ref(false)
useResizeObserver(strip, () => {
  if (strip.value) overflowing.value = strip.value.scrollWidth > strip.value.clientWidth
})
watch(() => props.tabs.length, async () => {
  await nextTick()
  if (strip.value) overflowing.value = strip.value.scrollWidth > strip.value.clientWidth
})
</script>

<template>
  <footer class="flex h-[39px] shrink-0 items-center gap-1 bg-[#f9fbfd] pl-11 pr-3 font-[Google_Sans,Roboto,Arial,sans-serif] text-[14px] text-[#444746]">
    <button class="grid size-8 shrink-0 place-items-center rounded-full hover:bg-[#e1e3e1]" aria-label="Add Sheet">
      <UIcon name="i-material-symbols-add-rounded" class="size-5" />
    </button>
    <div ref="menu" class="relative shrink-0">
      <button
        class="grid size-8 place-items-center rounded-full hover:bg-[#e1e3e1]"
        :class="menuOpen ? 'bg-[#e1e3e1]' : ''"
        aria-label="All Sheets"
        @click="menuOpen = !menuOpen"
      >
        <UIcon name="i-material-symbols-menu-rounded" class="size-5" />
      </button>
      <div
        v-if="menuOpen"
        class="absolute bottom-[38px] left-0 z-[60] max-h-[60vh] min-w-[220px] overflow-y-auto rounded-[4px] bg-white py-1.5 shadow-[0_2px_6px_2px_rgba(60,64,67,0.15),0_1px_2px_rgba(60,64,67,0.3)]"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="flex h-[32px] w-full items-center gap-3 pl-3 pr-6 text-left text-[#1f1f1f] hover:bg-[#f1f3f4]"
          @click="pick(tab.id)"
        >
          <UIcon v-if="active === tab.id" name="i-material-symbols-check-rounded" class="size-5 shrink-0 text-[#444746]" />
          <span v-else class="size-5 shrink-0" />
          <span class="whitespace-nowrap">{{ tab.name }}</span>
        </button>
      </div>
    </div>
    <nav ref="strip" class="tab-strip ml-2 flex min-w-0 items-center gap-0.5 overflow-x-auto">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :data-tab="tab.id"
        class="flex h-[30px] shrink-0 items-center gap-0.5 whitespace-nowrap rounded-[4px] pl-3 pr-1.5"
        :class="active === tab.id ? 'bg-[#e1e9f7] font-medium text-[#0b57d0]' : 'pr-3 hover:bg-[#e1e3e1]'"
        @mousedown.prevent="active = tab.id"
      >
        {{ tab.name }}
        <UIcon v-if="active === tab.id" name="i-material-symbols-arrow-drop-down-rounded" class="size-5" />
      </button>
    </nav>
    <template v-if="overflowing">
      <button class="grid size-7 shrink-0 place-items-center rounded-full hover:bg-[#e1e3e1]" aria-label="Scroll left" @click="scrollBy(-1)">
        <UIcon name="i-material-symbols-chevron-left-rounded" class="size-5" />
      </button>
      <button class="grid size-7 shrink-0 place-items-center rounded-full hover:bg-[#e1e3e1]" aria-label="Scroll right" @click="scrollBy(1)">
        <UIcon name="i-material-symbols-chevron-right-rounded" class="size-5" />
      </button>
    </template>
    <span class="flex-1" />
    <button
      v-if="status"
      class="flex h-[30px] shrink-0 items-center gap-1 rounded-[4px] border border-[#c4c7c5] bg-white pl-3 pr-1 text-[13px] text-[#1f1f1f] shadow-[0_1px_2px_rgba(60,64,67,0.15)]"
    >
      {{ status }}
      <UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-5 text-[#444746]" />
    </button>
    <button class="ml-2 grid size-8 shrink-0 place-items-center rounded-full hover:bg-[#e1e3e1]" aria-label="Explore">
      <UIcon name="i-material-symbols-explore-outline-rounded" class="size-5" />
    </button>
  </footer>
</template>

<style scoped>
.tab-strip {
  scrollbar-width: none;
}
.tab-strip::-webkit-scrollbar {
  display: none;
}
</style>
