<script setup lang="ts">
const props = defineProps<{
  /** The desktop sidebar is folded down to its icon rail */
  rail: boolean
}>()

const route = useRoute()
const nav = useNavLayout()

const editing = nav.editing
// Working copy while editing, so a drag can reorder live without a save per frame
const draft = ref<NavSection[]>([])
const list = computed(() => editing.value ? draft.value : nav.sections.value)

function cloneSections() {
  return nav.sections.value.map(section => ({ ...section, items: [...section.items] }))
}

watch(editing, (on) => {
  if (on) draft.value = cloneSections()
}, { immediate: true })

async function resetLayout() {
  await nav.reset()
  draft.value = cloneSections()
}

watch(() => props.rail, (rail) => {
  if (rail) editing.value = false
})

function isActive(to: string) {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
}

function isOpen(id: string) {
  return props.rail || !nav.collapsed.value.has(id)
}

function hasActive(section: NavSection) {
  return section.items.some(item => isActive(item.to))
}

// ── Pointer drag ────────────────────────────────────────────────────────────
// Rows reorder live under the pointer. Positions come from offsetTop, which
// ignores the transforms of the move transition, so a row mid-slide never
// makes the target flip back and forth.

const dragKey = ref<string | null>(null)
let dragList: { id?: string, to?: string }[] = []
let dragContainer: HTMLElement | null = null
let dragScroller: HTMLElement | null = null

function keyOf(entry: { id?: string, to?: string }) {
  return entry.id ?? entry.to ?? ''
}

function startDrag(event: PointerEvent, entries: { id?: string, to?: string }[], key: string) {
  if (event.button !== 0) return
  const handle = event.currentTarget as HTMLElement
  dragContainer = handle.closest<HTMLElement>('[data-sort-list]')
  if (!dragContainer) return
  dragScroller = dragContainer.closest<HTMLElement>('.overflow-y-auto')
  dragList = entries
  dragKey.value = key
  event.preventDefault()
  handle.setPointerCapture(event.pointerId)
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
}

function onDragMove(event: PointerEvent) {
  if (!dragContainer || !dragKey.value) return

  if (dragScroller) {
    const bounds = dragScroller.getBoundingClientRect()
    if (event.clientY < bounds.top + 40) dragScroller.scrollTop -= 8
    else if (event.clientY > bounds.bottom - 40) dragScroller.scrollTop += 8
  }

  const y = event.clientY - dragContainer.getBoundingClientRect().top
  const rows = [...dragContainer.querySelectorAll<HTMLElement>(':scope > [data-sort-item]')]
    .filter(row => row.dataset.sortKey !== dragKey.value)
  const target = rows.filter(row => row.offsetTop + row.offsetHeight / 2 < y).length
  const from = dragList.findIndex(entry => keyOf(entry) === dragKey.value)
  if (from < 0 || from === target) return
  const [moved] = dragList.splice(from, 1)
  dragList.splice(target, 0, moved!)
}

function endDrag() {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  if (!dragKey.value) return
  dragKey.value = null
  dragContainer = null
  dragScroller = null
  nav.commit(draft.value)
}

onBeforeUnmount(endDrag)
</script>

<template>
  <div class="flex flex-col">
    <div
      v-if="editing"
      class="mb-2 flex items-center gap-1 rounded-lg border border-dashed border-primary/40 bg-primary/5 py-1 pl-2.5 pr-1"
    >
      <UIcon name="i-lucide-grip-vertical" class="size-3.5 shrink-0 text-primary" />
      <span class="flex-1 truncate text-xs text-muted">Drag to reorder</span>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        label="Reset"
        @click="resetLayout"
      />
      <UButton
        size="xs"
        label="Done"
        @click="editing = false"
      />
    </div>

    <TransitionGroup
      tag="div"
      data-sort-list
      class="relative flex flex-col"
      :class="rail ? 'gap-0' : 'gap-1.5'"
      move-class="transition-transform duration-150 ease-out"
    >
      <section
        v-for="(section, si) in list"
        :key="section.id"
        data-sort-item
        :data-sort-key="section.id"
        class="relative rounded-lg transition-[background-color,box-shadow]"
        :class="dragKey === section.id ? 'z-10 bg-elevated shadow-lg ring ring-primary/40' : ''"
      >
        <USeparator v-if="rail && si > 0" class="my-2" />

        <div v-else-if="!rail" class="flex items-center">
          <button
            v-if="editing"
            type="button"
            aria-label="Drag section"
            class="-ml-1 grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded text-dimmed hover:text-default active:cursor-grabbing"
            @pointerdown="startDrag($event, draft, section.id)"
          >
            <UIcon name="i-lucide-grip-vertical" class="size-3.5" />
          </button>
          <button
            type="button"
            class="group flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-dimmed transition-colors hover:text-default"
            :aria-expanded="isOpen(section.id)"
            @click="nav.toggleSection(section.id)"
          >
            <span class="truncate">{{ section.label }}</span>
            <span
              v-if="!isOpen(section.id) && hasActive(section)"
              class="size-1.5 shrink-0 rounded-full bg-primary"
            />
            <span
              v-if="!isOpen(section.id)"
              class="ms-auto rounded bg-elevated px-1.5 text-[10px] font-medium normal-case tracking-normal text-muted tabular-nums"
            >{{ section.items.length }}</span>
            <UIcon
              name="i-lucide-chevron-down"
              class="size-3.5 shrink-0 transition-transform duration-200"
              :class="[isOpen(section.id) ? '' : '-rotate-90', isOpen(section.id) ? 'ms-auto opacity-0 group-hover:opacity-100' : '']"
            />
          </button>
        </div>

        <div
          class="grid transition-[grid-template-rows] duration-200 ease-out"
          :class="isOpen(section.id) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
        >
          <div class="min-h-0 overflow-hidden">
            <TransitionGroup
              tag="div"
              data-sort-list
              class="relative flex flex-col gap-px pb-0.5"
              move-class="transition-transform duration-150 ease-out"
            >
              <div
                v-for="item in section.items"
                :key="item.to"
                data-sort-item
                :data-sort-key="item.to"
                class="relative"
              >
                <div
                  v-if="editing"
                  class="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted transition-[background-color,box-shadow]"
                  :class="dragKey === item.to ? 'z-10 bg-elevated text-highlighted shadow-lg ring ring-primary/40' : 'hover:bg-elevated/50'"
                >
                  <UIcon :name="item.icon" class="size-4 shrink-0" />
                  <span class="flex-1 truncate">{{ item.label }}</span>
                  <button
                    type="button"
                    :aria-label="`Drag ${item.label}`"
                    class="-mr-1 grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded text-dimmed hover:text-default active:cursor-grabbing"
                    @pointerdown="startDrag($event, section.items, item.to)"
                  >
                    <UIcon name="i-lucide-grip-vertical" class="size-3.5" />
                  </button>
                </div>

                <UTooltip
                  v-else
                  :text="item.label"
                  :disabled="!rail"
                  :content="{ side: 'right' }"
                >
                  <NuxtLink
                    :to="item.to"
                    class="group relative flex items-center gap-2.5 rounded-lg py-1.5 text-sm font-medium transition-colors"
                    :class="[
                      rail ? 'justify-center px-0 size-9 mx-auto' : 'px-2',
                      isActive(item.to)
                        ? 'bg-primary/10 text-highlighted'
                        : 'text-muted hover:bg-elevated/60 hover:text-highlighted'
                    ]"
                  >
                    <span
                      v-if="isActive(item.to) && !rail"
                      class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
                    />
                    <UIcon
                      :name="item.icon"
                      class="size-4 shrink-0 transition-colors"
                      :class="isActive(item.to) ? 'text-primary' : 'text-dimmed group-hover:text-default'"
                    />
                    <span v-if="!rail" class="truncate">{{ item.label }}</span>
                  </NuxtLink>
                </UTooltip>
              </div>
            </TransitionGroup>
          </div>
        </div>
      </section>
    </TransitionGroup>
  </div>
</template>
