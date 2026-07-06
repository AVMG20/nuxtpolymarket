<script lang="ts" setup>
import type {NavigationMenuItem} from '@nuxt/ui'

const {user, signOut: authSignOut, fetchSession} = useAuth()
await fetchSession()
const appConfig = useAppConfig()
const collapsed = ref(false)
const mobileOpen = ref(false)
const menuOpen = ref(false)

// Only collapse nav on desktop — on mobile always show full content
const isDesktop = ref(true)
onMounted(() => {
  const mq = window.matchMedia('(min-width: 1024px)')
  isDesktop.value = mq.matches
  mq.addEventListener('change', (e) => {
    isDesktop.value = e.matches
  })
})
const isCollapsed = computed(() => isDesktop.value && collapsed.value)

async function signOut() {
  await authSignOut({redirectTo: '/login'})
}

const platformItems: NavigationMenuItem[] = [
  {label: 'Games', class: 'mb-1', icon: 'i-lucide-house', to: '/'},
  {label: 'Miner', class: 'mb-1', icon: 'i-lucide-pickaxe', to: '/miner'},
  {label: 'Xeno', class: 'mb-1', icon: 'i-lucide-sprout', to: '/xeno'},
  {label: 'Hack Ops', class: 'mb-1', icon: 'i-lucide-terminal', to: '/hack'},
  {label: 'Gem Market', class: 'mb-1', icon: 'i-lucide-gem', to: '/gem-market'},
  {label: 'Leaderboard', class: 'mb-1', icon: 'i-lucide-trophy', to: '/leaderboard'},
  {label: 'Changelog', class: 'mb-1', icon: 'i-lucide-scroll-text', to: '/changelog'},
]

const slotItems: NavigationMenuItem[] = [
  {label: 'Xeno Slot', class: 'mb-1', icon: 'i-lucide-cherry', to: '/games/xenoslot'},
  {label: 'Candy Madness', class: 'mb-1', icon: 'i-lucide-lollipop', to: '/games/candymadness'},
  {label: 'Aether Gates', class: 'mb-1', icon: 'i-lucide-zap', to: '/games/aethergates'},
  {label: 'Fire in the Hole', class: 'mb-1', icon: 'i-lucide-flame', to: '/games/fireinthehole'},
  {label: 'Book of Shadows', class: 'mb-1', icon: 'i-lucide-book-open', to: '/games/bookofshadows'},
]

const casinoItems: NavigationMenuItem[] = [
  {label: 'Dice', class: 'mb-1', icon: 'i-lucide-dices', to: '/games/dice'},
  {label: 'Limbo', class: 'mb-1', icon: 'i-lucide-trending-up', to: '/games/limbo'},
  {label: 'Wheel', class: 'mb-1', icon: 'i-lucide-loader-pinwheel', to: '/games/wheel'},
  {label: 'Magic Hands', class: 'mb-1', icon: 'i-lucide-hand', to: '/games/magichands'},
  {label: 'Blackjack', class: 'mb-1', icon: 'i-lucide-spade', to: '/games/blackjack'},
]

const primaryColors = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green',
  'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo',
  'violet', 'purple', 'fuchsia', 'pink', 'rose',
]
const neutralColors = ['slate', 'gray', 'zinc', 'neutral', 'stone']

const colorHex: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  lime: '#84cc16', green: '#22c55e', emerald: '#10b981', teal: '#14b8a6',
  cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6', indigo: '#6366f1',
  violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef', pink: '#ec4899',
  rose: '#f43f5e', slate: '#64748b', gray: '#6b7280', zinc: '#71717a',
  neutral: '#737373', stone: '#78716c',
}

const themePrimary = useCookie('theme-primary', {default: () => appConfig.ui.colors.primary ?? 'green'})
const themeSecondary = useCookie('theme-secondary', {default: () => appConfig.ui.colors.secondary ?? 'green'})
const themeNeutral = useCookie('theme-neutral', {default: () => appConfig.ui.colors.neutral ?? 'zinc'})

// Apply on mount (and SSR will already have the cookie value)
watchEffect(() => {
  if (themePrimary.value) appConfig.ui.colors.primary = themePrimary.value
  if (themeSecondary.value) appConfig.ui.colors.secondary = themeSecondary.value
  if (themeNeutral.value) appConfig.ui.colors.neutral = themeNeutral.value
})

function setPrimary(color: string) {
  themePrimary.value = color
  appConfig.ui.colors.primary = color
}

function setSecondary(color: string) {
  themeSecondary.value = color
  appConfig.ui.colors.secondary = color
}

function setNeutral(color: string) {
  themeNeutral.value = color
  appConfig.ui.colors.neutral = color
}
</script>

<template>
  <div class="flex min-h-svh">
    <!-- Mobile overlay -->
    <Transition
        enter-active-class="transition-opacity duration-300"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-opacity duration-300"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
    >
      <div
          v-if="mobileOpen"
          class="fixed inset-0 z-40 bg-black/80 lg:hidden"
          @click="mobileOpen = false"
      />
    </Transition>

    <!-- Sidebar -->
    <aside
        :class="[
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        isCollapsed ? 'lg:w-16' : 'lg:w-60',
      ]"
        class="fixed lg:sticky lg:top-0 inset-y-0 left-0 z-50 flex flex-col h-screen border-r border-default transition-all duration-300 ease-in-out w-64"
    >
      <!-- Header -->
      <div class="flex h-14 shrink-0 items-center gap-2 px-3 border-b border-default">
        <UIcon class="size-5 text-primary shrink-0" name="i-lucide-gamepad-2"/>
        <span
            :class="isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'"
            class="font-bold text-lg text-primary flex-1 truncate transition-opacity duration-200"
        >
          Polynux
        </span>
        <!-- Mobile close -->
        <UButton
            class="lg:hidden shrink-0"
            color="neutral"
            icon="i-lucide-x"
            size="sm"
            variant="ghost"
            @click="mobileOpen = false"
        />
      </div>

      <!-- Nav content -->
      <div class="flex-1 overflow-y-auto py-3 px-3 flex flex-col">
        <p
            :class="isCollapsed ? 'opacity-0 h-0 overflow-hidden mb-0' : 'opacity-100'"
            class="text-xs font-semibold text-muted uppercase tracking-wider px-2 mb-1 transition-opacity duration-200"
        >
          Platform
        </p>
        <UNavigationMenu
            :collapsed="isCollapsed"
            :items="platformItems"
            orientation="vertical"
        />

        <USeparator class="my-3"/>

        <p
            :class="isCollapsed ? 'opacity-0 h-0 overflow-hidden mb-0' : 'opacity-100'"
            class="text-xs font-semibold text-muted uppercase tracking-wider px-2 mb-1 transition-opacity duration-200"
        >
          Casino
        </p>
        <UNavigationMenu
            :collapsed="isCollapsed"
            :items="casinoItems"
            orientation="vertical"
        />

        <USeparator class="my-3"/>

        <p
            :class="isCollapsed ? 'opacity-0 h-0 overflow-hidden mb-0' : 'opacity-100'"
            class="text-xs font-semibold text-muted uppercase tracking-wider px-2 mb-1 transition-opacity duration-200"
        >
          Slots
        </p>
        <UNavigationMenu
            :collapsed="isCollapsed"
            :items="slotItems"
            orientation="vertical"
        />

      </div>

      <!-- Footer -->
      <div class="shrink-0 border-t border-default px-3 py-3 space-y-2">
        <!-- Balance: full row when expanded -->
        <div
            :class="isCollapsed ? 'opacity-0 h-0 overflow-hidden' : 'opacity-100'"
            class="flex items-center justify-between px-1 transition-opacity duration-200"
        >
          <span class="font-semibold text-sm">
            <CoinBalance :value="user?.balance"/>
          </span>
          <span class="font-semibold text-sm">
            <GemBalance :value="user?.gems"/>
          </span>
        </div>
        <!-- Balance: icons only when collapsed -->
        <div
            :class="isCollapsed ? 'flex opacity-100' : 'hidden opacity-0'"
            class="flex-col items-center gap-2 transition-opacity duration-200"
        >
          <UIcon class="size-4 text-yellow-400" name="i-lucide-coins"/>
          <UIcon class="size-4 text-cyan-400" name="i-lucide-gem"/>
        </div>

        <!-- User popover -->
        <UPopover
            v-model:open="menuOpen"
            :content="{ side: 'top', align: 'start', sideOffset: 8 }"
            class="w-full"
        >
          <UButton
              :label="isCollapsed ? undefined : (user?.name ?? 'Account')"
              :square="isCollapsed"
              :trailing-icon="isCollapsed ? undefined : 'i-lucide-chevrons-up-down'"
              class="w-full"
              color="neutral"
              icon="i-lucide-user"
              variant="ghost"
          />

          <template #content>
            <div class="w-56 py-1.5">
              <div class="flex items-center gap-3 px-3 py-2">
                <div class="size-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <span class="text-sm font-semibold text-primary">
                    {{ (user?.name ?? 'A').charAt(0).toUpperCase() }}
                  </span>
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-semibold truncate">{{ user?.name ?? 'Account' }}</p>
                  <p class="text-xs text-muted truncate">{{ user?.email }}</p>
                </div>
              </div>

              <USeparator class="my-1"/>

              <div class="px-3 py-2 space-y-2.5">
                <div>
                  <p class="text-xs font-medium text-muted mb-1.5">Primary</p>
                  <div class="flex flex-wrap gap-1">
                    <button
                        v-for="color in primaryColors"
                        :key="color"
                        :class="appConfig.ui.colors.primary === color ? 'ring-2 ring-offset-1 ring-offset-background ring-white/80' : ''"
                        :style="{ backgroundColor: colorHex[color] }"
                        :title="color"
                        class="size-4 rounded-full transition-transform hover:scale-110"
                        @click="setPrimary(color)"
                    />
                  </div>
                </div>
                <div>
                  <p class="text-xs font-medium text-muted mb-1.5">Secondary</p>
                  <div class="flex flex-wrap gap-1">
                    <button
                        v-for="color in primaryColors"
                        :key="color"
                        :class="appConfig.ui.colors.secondary === color ? 'ring-2 ring-offset-1 ring-offset-background ring-white/80' : ''"
                        :style="{ backgroundColor: colorHex[color] }"
                        :title="color"
                        class="size-4 rounded-full transition-transform hover:scale-110"
                        @click="setSecondary(color)"
                    />
                  </div>
                </div>
                <div>
                  <p class="text-xs font-medium text-muted mb-1.5">Neutral</p>
                  <div class="flex flex-wrap gap-1">
                    <button
                        v-for="color in neutralColors"
                        :key="color"
                        :class="appConfig.ui.colors.neutral === color ? 'ring-2 ring-offset-1 ring-offset-background ring-white/80' : ''"
                        :style="{ backgroundColor: colorHex[color] }"
                        :title="color"
                        class="size-4 rounded-full transition-transform hover:scale-110"
                        @click="setNeutral(color)"
                    />
                  </div>
                </div>
              </div>

              <USeparator class="my-1"/>

              <div class="px-1 py-0.5">
                <UButton
                    block
                    class="justify-start"
                    color="neutral"
                    icon="i-lucide-bar-chart-3"
                    label="Analytics"
                    to="/analytics"
                    variant="ghost"
                    @click="menuOpen = false"
                />
                <UButton
                    block
                    class="justify-start"
                    color="neutral"
                    icon="i-lucide-user-round"
                    label="Profile"
                    to="/profile"
                    variant="ghost"
                    @click="menuOpen = false"
                />
                <UButton
                    block
                    class="justify-start"
                    color="neutral"
                    icon="i-lucide-log-out"
                    label="Sign out"
                    variant="ghost"
                    @click="signOut"
                />
              </div>
            </div>
          </template>
        </UPopover>
      </div>
    </aside>

    <!-- Main content -->
    <div class="flex flex-1 flex-col overflow-hidden min-w-0">
      <!-- Mobile header -->
      <header class="flex h-14 shrink-0 items-center gap-2 border-b border-default px-4 lg:hidden">
        <UButton
            aria-label="Open sidebar"
            color="neutral"
            icon="i-lucide-panel-left"
            variant="ghost"
            @click="mobileOpen = true"
        />
        <span class="font-semibold text-primary">Polynux</span>
      </header>

      <main class="flex-1 overflow-auto">
        <slot/>
      </main>
    </div>
  </div>
</template>
