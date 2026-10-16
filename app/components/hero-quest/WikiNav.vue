<script setup lang="ts">
/**
 * The wiki's vertical menu. Screens and Content are groups that fold open on their own while you
 * are on one of their pages, and otherwise stay as the reader left them.
 */
interface NavLink {
    label: string
    to: string
    icon?: string
    count?: number
    active: boolean
}

interface NavEntry extends NavLink {
    children?: NavLink[]
}

const route = useRoute()

const onContent = computed(() => route.path === '/hero-quest/wiki/content')
const onScreens = computed(() => route.path.startsWith('/hero-quest/wiki/screens'))

function page(label: string, to: string, icon: string): NavEntry {
    return { label, to, icon, active: route.path === to }
}

const entries = computed<NavEntry[]>(() => [
    page('Basics', '/hero-quest/wiki', 'i-lucide-compass'),
    page('Combat', '/hero-quest/wiki/combat', 'i-lucide-swords'),
    page('Economy', '/hero-quest/wiki/economy', 'i-lucide-coins'),
    page('Gacha', '/hero-quest/wiki/gacha', 'i-lucide-dices'),
    page('Traits', '/hero-quest/wiki/traits', 'i-lucide-sparkles'),
    {
        label: 'Screens',
        to: '/hero-quest/wiki/screens',
        icon: 'i-lucide-layout-grid',
        active: onScreens.value,
        children: [
            { label: 'Overview', to: '/hero-quest/wiki/screens', icon: 'i-lucide-layout-grid', active: route.path === '/hero-quest/wiki/screens' },
            ...HQ_SCREEN_DOCS.map(screen => {
                const to = hqScreenWikiPath(screen.id)
                return { label: screen.label, to, icon: screen.icon, active: route.path === to }
            })
        ]
    },
    {
        label: 'Content',
        to: hqWikiRosterPath('classes'),
        icon: 'i-lucide-list',
        active: onContent.value,
        children: HQ_WIKI_ROSTERS.map(roster => ({
            label: roster.label,
            to: hqWikiRosterPath(roster.key),
            count: roster.count,
            active: onContent.value && hqWikiRoster(route.query.roster) === roster.key
        }))
    }
])

const open = reactive<Record<string, boolean>>({ Screens: false, Content: false })

// Arriving in a group opens it; leaving does not close it, so a group the reader opened stays put.
watch(() => entries.value.filter(entry => entry.children && entry.active).map(entry => entry.label), (labels) => {
    for (const label of labels) open[label] = true
}, { immediate: true })
</script>

<template>
  <nav class="space-y-0.5 text-sm">
    <template
      v-for="entry in entries"
      :key="entry.label"
    >
      <UCollapsible
        v-if="entry.children"
        v-model:open="open[entry.label]"
      >
        <button
          type="button"
          class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md font-medium transition-colors"
          :class="entry.active ? 'text-primary' : 'text-muted hover:text-default hover:bg-elevated/50'"
        >
          <UIcon
            :name="entry.icon!"
            class="size-4 shrink-0"
          />
          <span class="flex-1 text-left">{{ entry.label }}</span>
          <UIcon
            name="i-lucide-chevron-down"
            class="size-4 shrink-0 transition-transform duration-200"
            :class="open[entry.label] ? 'rotate-180' : ''"
          />
        </button>

        <template #content>
          <div class="ms-4 ps-2 border-s border-default space-y-0.5 py-0.5">
            <NuxtLink
              v-for="child in entry.children"
              :key="child.to"
              :to="child.to"
              class="flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors"
              :class="child.active
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted hover:text-default hover:bg-elevated/50'"
            >
              <UIcon
                v-if="child.icon"
                :name="child.icon"
                class="size-3.5 shrink-0"
              />
              <span class="flex-1 truncate">{{ child.label }}</span>
              <span
                v-if="child.count !== undefined"
                class="text-dimmed tabular-nums"
              >{{ child.count }}</span>
            </NuxtLink>
          </div>
        </template>
      </UCollapsible>

      <NuxtLink
        v-else
        :to="entry.to"
        class="flex items-center gap-2 px-2.5 py-1.5 rounded-md font-medium transition-colors"
        :class="entry.active
          ? 'bg-primary/10 text-primary'
          : 'text-muted hover:text-default hover:bg-elevated/50'"
      >
        <UIcon
          :name="entry.icon!"
          class="size-4 shrink-0"
        />
        {{ entry.label }}
      </NuxtLink>
    </template>
  </nav>
</template>
