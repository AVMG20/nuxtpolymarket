<script setup lang="ts">
import type { NavLink } from '#shared/utils/nav-catalog'

const props = defineProps<{
  link: NavLink
  /** The desktop sidebar is folded down to its icon rail */
  rail: boolean
  /** A player-placed game rather than a fixed platform link */
  placed?: boolean
}>()

const route = useRoute()
const nav = useNavLayout()
const menus = useNavMenus()
const drag = useNavDrag()

const active = computed(() => {
  const to = props.link.to
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
})

const menu = computed(() => props.placed ? menus.linkMenu(props.link.to) : [])
const row = useTemplateRef<HTMLElement>('row')
const lifted = computed(() => drag.state.payload?.key === props.link.to)

function onPress(event: PointerEvent) {
  if (!props.placed || props.rail) return
  drag.press(event, { key: props.link.to, label: props.link.label, icon: props.link.icon })
}

async function onKey(event: KeyboardEvent) {
  if (!props.placed || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
  event.preventDefault()
  nav.shift(props.link.to, event.key === 'ArrowUp' ? -1 : 1)
  // The row moved in the DOM, which drops focus
  await nextTick()
  row.value?.querySelector<HTMLElement>('a')?.focus()
}
</script>

<template>
  <div
    ref="row"
    data-nav-row
    :data-nav-key="link.to"
    class="group/row relative transition-opacity"
    :class="lifted ? 'opacity-35' : ''"
  >
    <UContextMenu :items="menu" :disabled="!placed" :ui="{ content: 'min-w-48' }">
      <UTooltip :text="link.label" :disabled="!rail" :content="{ side: 'right' }">
        <NuxtLink
          :to="link.to"
          draggable="false"
          class="group relative flex select-none items-center gap-2.5 rounded-lg py-1.5 text-sm font-medium transition-colors [-webkit-touch-callout:none]"
          :class="[
            rail ? 'justify-center px-0 size-9 mx-auto' : 'px-2',
            placed && !rail ? 'pr-8' : '',
            active ? 'bg-primary/10 text-highlighted' : 'text-muted hover:bg-elevated/60 hover:text-highlighted'
          ]"
          @pointerdown="onPress"
          @keydown="onKey"
        >
          <span
            v-if="active && !rail"
            class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
          />
          <UIcon
            :name="link.icon"
            class="size-4 shrink-0 transition-colors"
            :class="active ? 'text-primary' : 'text-dimmed group-hover:text-default'"
          />
          <span v-if="!rail" class="truncate">{{ link.label }}</span>
        </NuxtLink>
      </UTooltip>
    </UContextMenu>

    <UDropdownMenu
      v-if="placed && !rail"
      :items="menu"
      :content="{ side: 'right', align: 'start' }"
      :ui="{ content: 'min-w-48' }"
    >
      <UButton
        icon="i-lucide-ellipsis"
        size="xs"
        color="neutral"
        variant="ghost"
        :aria-label="`${link.label} options`"
        class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
      />
    </UDropdownMenu>
  </div>
</template>
