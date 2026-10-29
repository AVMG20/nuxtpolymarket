<script setup lang="ts">
import { useEventListener } from '@vueuse/core'

// Spreadsheet mode: Polynux dressed up as a Google Sheet. The boss key (`) or
// the logo goes back to wherever the player came from.

definePageMeta({ layout: false })

const { user } = useAuth()
const { exit } = useSheetMode()
const { tabs } = useSheetWorkbook()

const TITLE_KEY = 'sheet-title'
const title = ref('Q4 Operating Budget')
try {
  title.value = localStorage.getItem(TITLE_KEY) || title.value
} catch {
  // blocked storage: keep the default title
}
watch(title, (value) => {
  try {
    localStorage.setItem(TITLE_KEY, value)
  } catch {
    // blocked storage: the title lasts for this visit
  }
})

useHead({
  title: () => `${title.value.trim() || 'Untitled spreadsheet'} - Google Sheets`,
  link: [{ key: 'favicon', rel: 'icon', href: SHEET_LOGO_URL }],
  htmlAttrs: { style: 'color-scheme: light' }
})

const activeId = ref('overview')
const activeTab = computed(() => tabs.value.find(tab => tab.id === activeId.value) ?? tabs.value[0]!)
// Tabs that show server state load it when opened
watch(activeId, () => activeTab.value.activate?.(), { immediate: true })

const status = ref('')
const grid = useTemplateRef<{ focus: () => void }>('grid')

const problem = ref<{ title: string, message: string } | null>(null)
function showProblem(title: string, message: string) {
  problem.value = { title, message }
}
function closeProblem() {
  problem.value = null
  grid.value?.focus()
}

const AVATAR_COLORS = ['#5e35b1', '#00897b', '#e8710a', '#1e8e3e', '#d93025', '#1a73e8', '#c2185b', '#7cb342']
const initial = computed(() => (user.value?.name ?? '?').trim().charAt(0).toUpperCase())
const avatarColor = computed(() => {
  const name = user.value?.name ?? ''
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!
})

useEventListener('keydown', (e: KeyboardEvent) => {
  if (problem.value && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault()
    closeProblem()
    return
  }
  if (!isSheetModeKey(e)) return
  e.preventDefault()
  exit()
})
</script>

<template>
  <div class="fixed inset-0 flex flex-col overflow-hidden bg-[#f9fbfd] text-[#1f1f1f] [color-scheme:light]">
    <SheetChrome
      v-model:title="title"
      :initial="initial"
      :avatar-color="avatarColor"
      @home="exit"
    />
    <SheetGrid ref="grid" :tab="activeTab" @problem="showProblem" @status="status = $event" @navigate="activeId = $event" />
    <SheetTabs v-model="activeId" :tabs="tabs" :status="status" />

    <div
      v-if="problem"
      class="fixed inset-0 z-[100] grid place-items-center bg-black/40 font-[Google_Sans,Roboto,Arial,sans-serif]"
      @mousedown.self="closeProblem"
    >
      <div class="w-[440px] max-w-[calc(100vw-32px)] rounded-[8px] bg-white p-6 shadow-[0_4px_8px_3px_rgba(60,64,67,0.15),0_1px_3px_rgba(60,64,67,0.3)]">
        <h2 class="mb-4 text-[22px] leading-7 text-[#1f1f1f]">{{ problem.title }}</h2>
        <p class="text-[14px] leading-5 text-[#444746]">{{ problem.message }}</p>
        <div class="mt-6 flex justify-end">
          <button
            class="h-9 rounded-full bg-[#0b57d0] px-6 text-[14px] font-medium text-white hover:shadow-[0_1px_2px_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)]"
            @click="closeProblem"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
