<script setup lang="ts">
import { NAV_ROOT } from '#shared/utils/nav-layout'

const props = defineProps<{
  /** The desktop sidebar is folded down to its icon rail */
  rail: boolean
}>()

const nav = useNavLayout()
const menus = useNavMenus()
const drag = useNavDrag()

const root = useTemplateRef<HTMLElement>('root')
const scroller = ref<HTMLElement | null>(null)
onMounted(() => {
  scroller.value = root.value?.closest<HTMLElement>('.nav-scroll') ?? null
})
useScrollActivity(scroller)

function platformFolded(sectionId: string) {
  return !props.rail && sectionId === 'platform' && nav.layout.value.platformCollapsed
}
</script>

<template>
  <div ref="root" class="flex flex-col">
    <!-- Fixed platform links -->
    <section
      v-for="(section, si) in nav.fixedSections.value"
      :key="section.id"
      class="mb-1.5"
    >
      <USeparator v-if="rail && si > 0" class="my-2" />
      <button
        v-else-if="!rail && section.id === 'platform'"
        type="button"
        class="group flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-dimmed transition-colors hover:text-default"
        :aria-expanded="!nav.layout.value.platformCollapsed"
        @click="nav.togglePlatform()"
      >
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3.5 shrink-0 transition-transform duration-200"
          :class="nav.layout.value.platformCollapsed ? '-rotate-90' : ''"
        />
        <span class="truncate">{{ section.label }}</span>
      </button>
      <p
        v-else-if="!rail"
        class="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-dimmed"
      >
        {{ section.label }}
      </p>
      <div
        class="grid transition-[grid-template-rows] duration-200 ease-out"
        :class="platformFolded(section.id) ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'"
        :inert="platformFolded(section.id) || undefined"
      >
        <div class="flex min-h-0 flex-col gap-px overflow-hidden">
          <NavSidebarLink
            v-for="link in section.items"
            :key="link.to"
            :link="link"
            :rail="rail"
          />
        </div>
      </div>
    </section>

    <USeparator v-if="rail" class="my-2" />
    <div v-else class="group/head flex items-center gap-2 py-1 pl-2">
      <span class="text-[10px] font-semibold uppercase tracking-widest text-dimmed/80">Your games</span>
      <USeparator class="flex-1" />
      <UTooltip text="New folder" :content="{ side: 'right' }">
        <UButton
          icon="i-lucide-folder-plus"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="New folder"
          :disabled="!nav.canAddFolder.value"
          @click="menus.newFolder()"
        />
      </UTooltip>
    </div>

    <!-- The player's games and folders -->
    <div :data-nav-zone="rail ? undefined : ''" class="relative">
      <TransitionGroup
        tag="div"
        :data-nav-list="NAV_ROOT"
        class="relative flex flex-col pb-6"
        :class="rail ? 'gap-px' : 'gap-1'"
        move-class="transition-transform duration-150 ease-out"
      >
        <template v-for="(node, i) in nav.tree.value" :key="node.key">
          <NavSidebarFolder
            v-if="node.kind === 'folder'"
            :id="node.id"
            :name="node.name"
            :collapsed="node.collapsed"
            :links="node.links"
            :rail="rail"
            :first="i === 0"
          />
          <NavSidebarLink
            v-else
            :link="node.link"
            :rail="rail"
            placed
          />
        </template>

        <div
          v-if="!nav.tree.value.length && !rail"
          key="empty"
          class="mx-1 flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-center text-xs transition-colors"
          :class="drag.state.payload ? 'border-primary/50 bg-primary/5 text-default' : 'border-default text-dimmed'"
        >
          <UIcon name="i-lucide-star" class="size-4 text-primary" />
          <p>Star games on the <NuxtLink to="/" class="font-medium text-primary hover:underline">home page</NuxtLink> or drag them here to build your sidebar.</p>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>
