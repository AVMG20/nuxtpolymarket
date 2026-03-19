<script setup lang="ts">
const search = ref('')

const games = [
  {
    name: 'Blackjack',
    description: 'Beat the dealer and get 21',
    icon: 'i-lucide-diamond',
    to: '/games/blackjack',
    gradient: 'from-blue-950 to-slate-900',
    iconColor: 'text-blue-400',
  },
  {
    name: 'Cyber',
    description: 'Cyber grid with walking wilds and sticky trails',
    icon: 'i-lucide-skull',
    to: '/games/cyber',
    gradient: 'from-violet-950 to-slate-900',
    iconColor: 'text-violet-400',
  },
  {
    name: 'Lightning',
    description: 'Electrifying wins with cascading symbols',
    icon: 'i-lucide-zap',
    to: '/games/lightning',
    gradient: 'from-yellow-950 to-slate-900',
    iconColor: 'text-yellow-400',
  },
  {
    name: 'Titans',
    description: 'Forge legendary wins with cascading heat',
    icon: 'i-lucide-cpu',
    to: '/games/titans',
    gradient: 'from-orange-950 to-slate-900',
    iconColor: 'text-orange-400',
  },
  {
    name: 'Jars',
    description: "Match the jars and create jammin' combos",
    icon: 'i-lucide-archive',
    to: '/games/jars',
    gradient: 'from-emerald-950 to-slate-900',
    iconColor: 'text-emerald-400',
  },
  {
    name: 'Neon',
    description: 'Light up the neon grid for big wins',
    icon: 'i-lucide-heart',
    to: '/games/neon',
    gradient: 'from-pink-950 to-slate-900',
    iconColor: 'text-pink-400',
  },
  {
    name: 'Harvest',
    description: 'Harvest your crops for abundant rewards',
    icon: 'i-lucide-shopping-basket',
    to: '/games/harvest',
    gradient: 'from-lime-950 to-slate-900',
    iconColor: 'text-lime-400',
  },
]

const retroGames = [
  {
    name: 'Tower',
    description: 'Climb the tower and multiply your winnings',
    icon: 'i-lucide-layout-grid',
    to: '/games/tower',
    gradient: 'from-sky-950 to-slate-900',
    iconColor: 'text-sky-400',
  },
  {
    name: 'Slots',
    description: 'Spin the reels and watch the cascading wins',
    icon: 'i-lucide-coins',
    to: '/games/slots',
    gradient: 'from-amber-950 to-slate-900',
    iconColor: 'text-amber-400',
  },
  {
    name: 'Blast',
    description: 'Blast your way through explosive gameplay',
    icon: 'i-lucide-circle-dot',
    to: '/games/blast',
    gradient: 'from-red-950 to-slate-900',
    iconColor: 'text-red-400',
  },
  {
    name: 'Snako',
    description: 'Drop the ball and watch it bounce to victory',
    icon: 'i-lucide-gamepad-2',
    to: '/games/snako',
    gradient: 'from-teal-950 to-slate-900',
    iconColor: 'text-teal-400',
  },
]

const filteredGames = computed(() =>
  search.value
    ? games.filter(g => g.name.toLowerCase().includes(search.value.toLowerCase()))
    : games
)

const filteredRetro = computed(() =>
  search.value
    ? retroGames.filter(g => g.name.toLowerCase().includes(search.value.toLowerCase()))
    : retroGames
)
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- Page header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl font-bold">Games</h1>
        <p class="text-sm text-muted mt-0.5">Choose from our collection of exciting games</p>
      </div>
      <UInput
        v-model="search"
        placeholder="Search games..."
        icon="i-lucide-search"
        class="w-full sm:w-64"
        variant="outline"
      />
    </div>

    <!-- Games section -->
    <section v-if="filteredGames.length" class="mb-10">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-1 h-5 rounded-full bg-primary" />
        <h2 class="text-base font-bold">Games</h2>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <NuxtLink
          v-for="game in filteredGames"
          :key="game.name"
          :to="game.to"
          class="group rounded-xl overflow-hidden border border-default bg-elevated hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200"
        >
          <!-- Thumbnail -->
          <div :class="`relative aspect-video bg-gradient-to-br ${game.gradient} flex items-center justify-center overflow-hidden`">
            <UIcon
              :name="game.icon"
              :class="`size-10 ${game.iconColor} opacity-30 group-hover:opacity-50 group-hover:scale-110 transition-all duration-300`"
            />
          </div>
          <!-- Info -->
          <div class="p-3 flex items-start gap-2.5">
            <div class="size-7 rounded-md bg-background flex items-center justify-center shrink-0 mt-0.5">
              <UIcon :name="game.icon" class="size-3.5 text-muted" />
            </div>
            <div class="min-w-0">
              <p class="text-sm font-bold leading-tight">{{ game.name }}</p>
              <p class="text-xs text-muted mt-0.5 line-clamp-2 leading-relaxed">{{ game.description }}</p>
            </div>
          </div>
        </NuxtLink>
      </div>
    </section>

    <!-- Retro games section -->
    <section v-if="filteredRetro.length">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-1 h-5 rounded-full bg-primary" />
        <h2 class="text-base font-bold">Retro games</h2>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <NuxtLink
          v-for="game in filteredRetro"
          :key="game.name"
          :to="game.to"
          class="group rounded-xl overflow-hidden border border-default bg-elevated hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200"
        >
          <!-- Thumbnail -->
          <div :class="`relative aspect-video bg-gradient-to-br ${game.gradient} flex items-center justify-center overflow-hidden`">
            <UIcon
              :name="game.icon"
              :class="`size-10 ${game.iconColor} opacity-30 group-hover:opacity-50 group-hover:scale-110 transition-all duration-300`"
            />
          </div>
          <!-- Info -->
          <div class="p-3 flex items-start gap-2.5">
            <div class="size-7 rounded-md bg-background flex items-center justify-center shrink-0 mt-0.5">
              <UIcon :name="game.icon" class="size-3.5 text-muted" />
            </div>
            <div class="min-w-0">
              <p class="text-sm font-bold leading-tight">{{ game.name }}</p>
              <p class="text-xs text-muted mt-0.5 line-clamp-2 leading-relaxed">{{ game.description }}</p>
            </div>
          </div>
        </NuxtLink>
      </div>
    </section>

    <!-- Empty state -->
    <UEmpty
      v-if="search && !filteredGames.length && !filteredRetro.length"
      :description="`No games found for '${search}'`"
      icon="i-lucide-search"
    />
  </div>
</template>
