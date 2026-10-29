<script setup lang="ts">
import type { NavCatalogLink } from '~/composables/nav-layout'

const props = defineProps<{
  id: string
  name: string
  collapsed: boolean
  links: NavCatalogLink[]
  rail: boolean
  first: boolean
}>()

const route = useRoute()
const nav = useNavLayout()
const menus = useNavMenus()
const drag = useNavDrag()

const open = computed(() => props.rail || !props.collapsed)
const menu = computed(() => menus.folderMenu(props.id))
const head = useTemplateRef<HTMLButtonElement>('head')
const lifted = computed(() => drag.state.payload?.key === props.id)
const hasActive = computed(() => props.links.some(link => route.path === link.to || route.path.startsWith(`${link.to}/`)))

function onPress(event: PointerEvent) {
  if (props.rail) return
  drag.press(event, { key: props.id, label: props.name, icon: 'i-lucide-folder' })
}

async function onKey(event: KeyboardEvent) {
  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
  event.preventDefault()
  nav.shift(props.id, event.key === 'ArrowUp' ? -1 : 1)
  await nextTick()
  head.value?.focus()
}

// A double-click renames; its clicks must not fold and unfold the folder
function onClick(event: MouseEvent) {
  if (event.detail > 1) return
  nav.toggleFolder(props.id)
}

function onDoubleClick() {
  // The first click of the pair already folded it: put that back
  nav.setFolderCollapsed(props.id, !props.collapsed)
  menus.renameFolder(props.id, props.name)
}
</script>

<template>
  <section
    data-nav-row
    :data-nav-key="id"
    class="group/folder relative rounded-lg transition-opacity"
    :class="lifted ? 'opacity-35' : ''"
  >
    <USeparator v-if="rail && !first" class="my-2" />

    <div v-else-if="!rail" class="relative">
      <UContextMenu :items="menu" :ui="{ content: 'min-w-48' }">
        <button
          ref="head"
          type="button"
          :data-nav-folder-head="id"
          :data-nav-expanded="open"
          class="flex w-full min-w-0 select-none items-center gap-1.5 rounded-md py-1.5 pl-2 pr-8 text-[11px] font-semibold uppercase tracking-wider text-dimmed transition-colors hover:text-default [-webkit-touch-callout:none]"
          :aria-expanded="open"
          :title="`${name}: double-click to rename, right-click for options`"
          @click="onClick"
          @dblclick="onDoubleClick"
          @pointerdown="onPress"
          @keydown="onKey"
        >
          <UIcon
            name="i-lucide-chevron-down"
            class="size-3.5 shrink-0 transition-transform duration-200"
            :class="open ? '' : '-rotate-90'"
          />
          <span class="truncate">{{ name }}</span>
          <span
            v-if="!open && hasActive"
            class="size-1.5 shrink-0 rounded-full bg-primary"
          />
          <span
            v-if="!open"
            class="ms-auto rounded bg-elevated px-1.5 text-[10px] font-medium normal-case tracking-normal text-muted tabular-nums"
          >{{ links.length }}</span>
        </button>
      </UContextMenu>

      <UDropdownMenu :items="menu" :content="{ side: 'right', align: 'start' }" :ui="{ content: 'min-w-48' }">
        <UButton
          icon="i-lucide-ellipsis"
          size="xs"
          color="neutral"
          variant="ghost"
          :aria-label="`${name} folder options`"
          class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/folder:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
        />
      </UDropdownMenu>
    </div>

    <div
      class="grid transition-[grid-template-rows] duration-200 ease-out"
      :class="open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
      :inert="!open || undefined"
    >
      <div class="min-h-0 overflow-hidden">
        <TransitionGroup
          tag="div"
          :data-nav-list="id"
          class="relative flex flex-col gap-px pb-0.5"
          move-class="transition-transform duration-150 ease-out"
        >
          <NavSidebarLink
            v-for="link in links"
            :key="link.to"
            :link="link"
            :rail="rail"
            placed
          />
          <div
            v-if="!links.length && !rail"
            key="empty"
            class="mx-2 my-0.5 rounded-md border border-dashed border-default px-2 py-1.5 text-xs text-dimmed"
          >
            Empty: drag games here
          </div>
        </TransitionGroup>
      </div>
    </div>
  </section>
</template>
