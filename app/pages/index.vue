<script setup lang="ts">
const search = ref('')

const slotGames = [
  {
    name: 'Cyber Cascade',
    description: 'Cyber grid with walking wilds and sticky trails',
    icon: 'i-lucide-skull',
    to: '/games/cyber',
    gradient: 'from-violet-950 to-slate-900',
    iconColor: 'text-violet-400',
  },
]

const casinoGames = [
  {
    name: 'Dice',
    description: 'Roll the dice and bet on the outcome',
    icon: 'i-lucide-dice-5',
    to: '/games/dice',
    gradient: 'from-emerald-950 to-slate-900',
    iconColor: 'text-emerald-400',
  },
  {
    name: 'Limbo',
    description: 'Bet on a multiplier and watch the rocket fly',
    icon: 'i-lucide-trending-up',
    to: '/games/limbo',
    gradient: 'from-sky-950 to-slate-900',
    iconColor: 'text-sky-400',
  },
]

const filteredSlots = computed(() =>
  search.value
    ? slotGames.filter(g => g.name.toLowerCase().includes(search.value.toLowerCase()))
    : slotGames
)

const filteredCasino = computed(() =>
  search.value
    ? casinoGames.filter(g => g.name.toLowerCase().includes(search.value.toLowerCase()))
    : casinoGames
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

    <!-- Slot games section -->
    <section v-if="filteredSlots.length" class="mb-10">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-1 h-5 rounded-full bg-primary" />
        <h2 class="text-base font-bold">Slots</h2>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <NuxtLink
          v-for="game in filteredSlots"
          :key="game.name"
          :to="game.to"
          class="group rounded-xl overflow-hidden border border-default bg-elevated hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200"
        >
          <div :class="`relative aspect-video bg-gradient-to-br ${game.gradient} flex items-center justify-center overflow-hidden`">
            <UIcon
              :name="game.icon"
              :class="`size-10 ${game.iconColor} opacity-30 group-hover:opacity-50 group-hover:scale-110 transition-all duration-300`"
            />
          </div>
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

    <!-- Casino games section -->
    <section v-if="filteredCasino.length">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-1 h-5 rounded-full bg-primary" />
        <h2 class="text-base font-bold">Casino</h2>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <NuxtLink
          v-for="game in filteredCasino"
          :key="game.name"
          :to="game.to"
          class="group rounded-xl overflow-hidden border border-default bg-elevated hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200"
        >
          <div :class="`relative aspect-video bg-gradient-to-br ${game.gradient} flex items-center justify-center overflow-hidden`">
            <UIcon
              :name="game.icon"
              :class="`size-10 ${game.iconColor} opacity-30 group-hover:opacity-50 group-hover:scale-110 transition-all duration-300`"
            />
          </div>
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
      v-if="search && !filteredSlots.length && !filteredCasino.length"
      :description="`No games found for '${search}'`"
      icon="i-lucide-search"
    />
  </div>
</template>
