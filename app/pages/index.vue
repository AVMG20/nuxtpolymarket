<script setup lang="ts">
import type { NavSection } from '#shared/utils/nav-catalog'
import { sectionFolderId } from '#shared/utils/nav-layout'

useSeoMeta({ title: 'Games · Polynux' })

const nav = useNavLayout()
const { recent, read: readRecent } = useRecentGames()
onMounted(readRecent)

const ALL_GAMES = [...NAV_LINKS.values()]
const search = ref('')
const filter = ref<string>('all')
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement }>('searchInput')

defineShortcuts({
  '/': () => searchInput.value?.inputRef?.focus()
})

const starredCount = computed(() => ALL_GAMES.filter(game => nav.isPinned(game.to)).length)

const filters = computed(() => [
  { id: 'all', label: 'All games', icon: 'i-lucide-layout-grid', count: ALL_GAMES.length },
  { id: 'starred', label: 'Starred', icon: 'i-lucide-star', count: starredCount.value },
  ...NAV_GAME_SECTIONS.map(section => ({ id: section.id, label: section.label, icon: section.icon ?? 'i-lucide-gamepad-2', count: section.items.length }))
])

const query = computed(() => search.value.trim().toLowerCase())

const shown = computed(() => NAV_GAME_SECTIONS
  .filter(section => filter.value === 'all' || filter.value === 'starred' || filter.value === section.id)
  .map(section => ({
    section,
    games: section.items
      .map(item => NAV_LINKS.get(item.to)!)
      .filter(game => filter.value !== 'starred' || nav.isPinned(game.to))
      .filter(game => !query.value
        || game.label.toLowerCase().includes(query.value)
        || game.description?.toLowerCase().includes(query.value)
        || section.label.toLowerCase().includes(query.value))
  }))
  .filter(group => group.games.length))

const recentGames = computed(() => recent.value.map(to => NAV_LINKS.get(to)).filter(game => !!game).slice(0, 6))
const showRecent = computed(() => filter.value === 'all' && !query.value && recentGames.value.length > 0)

type FolderState = 'none' | 'partial' | 'full'

function folderState(section: NavSection): FolderState {
  const folder = nav.layout.value.folders[sectionFolderId(section.id)]
  if (!folder) return 'none'
  return section.items.every(item => folder.items.includes(item.to)) ? 'full' : 'partial'
}

function toggleSectionFolder(section: NavSection) {
  if (folderState(section) === 'full') nav.unpinSection(section)
  else nav.pinSection(section)
}

function clearFilters() {
  search.value = ''
  filter.value = 'all'
}
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pt-5">
      <h1 class="text-xl font-bold text-highlighted">
        Games
      </h1>
      <p class="text-xs text-muted">
        <span class="inline-flex items-center gap-1"><HomeStarGlyph filled class="size-3 text-amber-300" />Star a game to pin it to your sidebar.</span>
        <span class="hidden sm:inline"> Right-click for folders, or drag a card onto the sidebar.</span>
        <span class="sm:hidden"> Long-press or tap ••• for folders.</span>
      </p>
    </div>

    <!-- Search and categories -->
    <div class="sticky top-0 z-20 -mx-4 mt-2 flex flex-col gap-3 bg-default/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:flex-row lg:items-center">
      <UInput
        ref="searchInput"
        v-model="search"
        placeholder="Search games…"
        icon="i-lucide-search"
        class="w-full lg:w-72"
        :ui="{ trailing: 'pe-1.5' }"
      >
        <template #trailing>
          <UButton
            v-if="search"
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="link"
            aria-label="Clear search"
            @click="search = ''"
          />
          <UKbd v-else value="/" />
        </template>
      </UInput>
      <div class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
        <button
          v-for="f in filters"
          :key="f.id"
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring ring-inset transition-colors"
          :class="filter === f.id
            ? 'bg-primary/15 text-highlighted ring-primary/40'
            : 'bg-elevated/40 text-muted ring-default hover:bg-elevated hover:text-default'"
          :aria-pressed="filter === f.id"
          @click="filter = f.id"
        >
          <HomeStarGlyph v-if="f.id === 'starred'" :filled="filter === f.id" class="size-3.5 text-amber-300" />
          <UIcon v-else :name="f.icon" class="size-3.5" :class="filter === f.id ? 'text-primary' : ''" />
          {{ f.label }}
          <span class="tabular-nums text-dimmed">{{ f.count }}</span>
        </button>
      </div>
    </div>

    <!-- Jump back in -->
    <ClientOnly>
      <section v-if="showRecent" class="mt-4">
        <div class="mb-3 flex items-center gap-2">
          <UIcon name="i-lucide-history" class="size-4 text-primary" />
          <h2 class="text-sm font-bold uppercase tracking-wider text-highlighted">
            Jump back in
          </h2>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <HomeGameCard
            v-for="game in recentGames"
            :key="game.to"
            :link="game"
            compact
          />
        </div>
      </section>
    </ClientOnly>

    <!-- Catalog -->
    <section
      v-for="{ section, games } in shown"
      :key="section.id"
      class="mt-6 first-of-type:mt-4"
    >
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 ring ring-inset ring-primary/20">
          <UIcon :name="section.icon ?? 'i-lucide-gamepad-2'" class="size-4.5 text-primary" />
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="flex items-center gap-2 text-base font-bold text-highlighted">
            {{ section.label }}
            <span class="rounded-md bg-elevated px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted">{{ games.length }}</span>
          </h2>
          <p v-if="section.blurb" class="truncate text-xs text-muted">
            {{ section.blurb }}
          </p>
        </div>
        <UTooltip
          :text="folderState(section) === 'full'
            ? `Remove the ${section.label} games from your sidebar`
            : folderState(section) === 'partial'
              ? `Put every ${section.label} game back in its folder`
              : `Add all ${section.label} as a folder in your sidebar`"
        >
          <UButton
            size="sm"
            :color="folderState(section) === 'full' ? 'primary' : 'neutral'"
            :variant="folderState(section) === 'full' ? 'soft' : 'outline'"
            :icon="folderState(section) === 'full' ? 'i-lucide-folder-check' : 'i-lucide-folder-plus'"
            :label="folderState(section) === 'full' ? 'In your sidebar' : folderState(section) === 'partial' ? 'Fill folder' : 'Add as folder'"
            @click="toggleSectionFolder(section)"
          />
        </UTooltip>
      </div>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        <HomeGameCard
          v-for="game in games"
          :key="game.to"
          :link="game"
        />
      </div>
    </section>

    <UEmpty
      v-if="!shown.length"
      class="mt-12"
      :icon="filter === 'starred' && !query ? 'i-lucide-star' : 'i-lucide-search'"
      :title="filter === 'starred' && !query ? 'No starred games yet' : 'No games found'"
      :description="filter === 'starred' && !query
        ? 'Tap the star on any game to add it to your sidebar.'
        : `Nothing matches “${search}”.`"
      :actions="[{ label: 'Show all games', icon: 'i-lucide-layout-grid', color: 'neutral', variant: 'subtle', onClick: clearFilters }]"
    />
  </div>
</template>
