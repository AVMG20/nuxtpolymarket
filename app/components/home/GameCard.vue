<script setup lang="ts">
import type { NavCatalogLink } from '~/composables/nav-layout'

const props = defineProps<{
  link: NavCatalogLink
  /** Smaller card for the "jump back in" strip */
  compact?: boolean
}>()

const nav = useNavLayout()
const menus = useNavMenus()
const drag = useNavDrag()

const pinned = computed(() => nav.isPinned(props.link.to))
const menu = computed(() => menus.cardMenu(props.link.to))

function onPress(event: PointerEvent) {
  drag.press(event, { key: props.link.to, label: props.link.label, icon: props.link.icon })
}
</script>

<template>
  <UContextMenu :items="menu" :ui="{ content: 'min-w-52' }">
    <div
      class="group relative flex select-none flex-col overflow-hidden rounded-xl bg-elevated/40 ring ring-default transition-all duration-200 [-webkit-touch-callout:none] hover:-translate-y-0.5 hover:bg-elevated/70 hover:shadow-xl hover:shadow-black/30 hover:ring-primary/40"
      :class="pinned ? 'ring-primary/25' : ''"
    >
      <NuxtLink
        :to="link.to"
        draggable="false"
        class="flex flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset rounded-xl"
        @pointerdown="onPress"
      >
        <HomeGameCover :to="link.to" :icon="link.icon" class="aspect-video">
          <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/0" />
          <span
            class="pointer-events-none absolute bottom-2 left-2 grid size-9 place-items-center rounded-full bg-primary text-inverted opacity-0 shadow-lg shadow-black/40 transition-all duration-200 group-hover:opacity-100"
            :class="compact ? 'size-7' : ''"
          >
            <UIcon name="i-lucide-play" class="size-4 translate-x-px" />
          </span>
        </HomeGameCover>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5" :class="compact ? 'px-2.5 py-2' : 'px-3 py-2.5'">
          <p class="truncate text-sm font-bold text-highlighted">
            {{ link.label }}
          </p>
          <p v-if="!compact && link.description" class="line-clamp-2 text-xs leading-relaxed text-muted">
            {{ link.description }}
          </p>
          <p v-else-if="compact" class="truncate text-[11px] text-dimmed">
            {{ link.section.label }}
          </p>
        </div>
      </NuxtLink>

      <div class="absolute right-1.5 top-1.5 flex items-center gap-1">
        <UDropdownMenu :items="menu" :content="{ align: 'end' }" :ui="{ content: 'min-w-52' }">
          <UButton
            icon="i-lucide-ellipsis"
            size="xs"
            color="neutral"
            variant="solid"
            :aria-label="`${link.label} options`"
            class="size-7 justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/75 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
          />
        </UDropdownMenu>
        <UTooltip :text="pinned ? 'Remove from sidebar' : 'Add to sidebar'">
          <button
            type="button"
            :aria-pressed="pinned"
            :aria-label="pinned ? `Remove ${link.label} from sidebar` : `Add ${link.label} to sidebar`"
            class="grid size-7 place-items-center rounded-full bg-black/55 backdrop-blur transition-all hover:scale-110 hover:bg-black/75 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary active:scale-95"
            :class="pinned ? 'text-amber-300' : 'text-white/85 opacity-0 hover:text-amber-200 group-hover:opacity-100 pointer-coarse:opacity-100'"
            @click="nav.togglePin(link.to)"
          >
            <HomeStarGlyph :filled="pinned" class="size-4" />
          </button>
        </UTooltip>
      </div>
    </div>
  </UContextMenu>
</template>
