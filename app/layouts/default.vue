<script lang="ts" setup>
import packageJson from '../../package.json'

const { user, signOut: authSignOut, fetchSession } = useAuth()
const navLayout = useNavLayout()
await fetchSession()

// The bank's cut follows the player around the app, so the wallet in the footer
// turns red wherever they are — the tooltip is the only place it's explained.
const { inDebt: bankGarnishing, refresh: refreshBankStatus } = useBankStatus()
if (user.value) await Promise.all([refreshBankStatus(), navLayout.load()])
const appConfig = useAppConfig()
const softStudio = useSoftStudio()
const open = ref(true)
const menuOpen = ref(false)
const siteVersion = `v${packageJson.version.split('.').slice(0, 2).join('.')}`

// Close the mobile sidebar sheet on navigation, but leave the desktop
// expanded/collapsed state untouched
const route = useRoute()
watch(() => route.fullPath, () => {
  if (import.meta.client && window.matchMedia('(max-width: 1023px)').matches) {
    open.value = false
  }
})

function customizeSidebar() {
  menuOpen.value = false
  open.value = true
  navLayout.editing.value = true
}

async function signOut() {
  await authSignOut({ redirectTo: '/login' })
}

const primaryColors = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green',
  'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo',
  'violet', 'purple', 'fuchsia', 'pink', 'rose'
]
const neutralColors = ['slate', 'gray', 'zinc', 'neutral', 'stone']

const colorHex: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  lime: '#84cc16', green: '#22c55e', emerald: '#10b981', teal: '#14b8a6',
  cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6', indigo: '#6366f1',
  violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef', pink: '#ec4899',
  rose: '#f43f5e', slate: '#64748b', gray: '#6b7280', zinc: '#71717a',
  neutral: '#737373', stone: '#78716c'
}

const themePrimary = useCookie('theme-primary', { default: () => appConfig.ui.colors.primary ?? 'green' })
const themeSecondary = useCookie('theme-secondary', { default: () => appConfig.ui.colors.secondary ?? 'green' })
const themeNeutral = useCookie('theme-neutral', { default: () => appConfig.ui.colors.neutral ?? 'zinc' })

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

const globalSearch = useGlobalSearch()
</script>

<template>
  <div class="flex min-h-svh">
    <!-- Sidebar -->
    <USidebar
      v-model:open="open"
      collapsible="icon"
      rail
      :ui="{
        header: 'px-3 pt-3 pb-3 flex-col items-stretch gap-2.5 min-h-14',
        body: 'p-3 gap-0 [scrollbar-width:thin]',
        footer: 'flex-col items-stretch gap-2 p-3'
      }"
    >
      <!-- Header -->
      <template #header="{ state, close }">
        <div class="flex items-center justify-between gap-2 w-full">
          <NuxtLink to="/" class="flex items-center gap-2.5 min-w-0" :class="state === 'collapsed' ? 'mx-auto' : ''">
            <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 ring ring-inset ring-primary/25">
              <UIcon
                class="size-4.5 text-primary"
                name="i-lucide-gamepad-2"
              />
            </span>
            <span
              v-if="state !== 'collapsed'"
              class="flex min-w-0 items-baseline gap-1.5"
            >
              <span class="truncate text-base font-bold tracking-tight text-highlighted">Polynux</span>
              <span class="text-[10px] font-medium text-dimmed tabular-nums">{{ siteVersion }}</span>
            </span>
          </NuxtLink>
          <!-- Mobile close -->
          <UButton
            class="lg:hidden shrink-0"
            color="neutral"
            icon="i-lucide-x"
            size="sm"
            variant="ghost"
            @click="close()"
          />
        </div>

        <!-- Search button inside header div -->
        <div class="w-full">
          <UButton
            v-if="state !== 'collapsed'"
            block
            color="neutral"
            variant="outline"
            class="justify-between text-muted hover:text-default bg-elevated/40 border-default/80 cursor-pointer"
            icon="i-lucide-search"
            @click="globalSearch.open()"
          >
            <span class="truncate text-xs font-medium">Search pages...</span>
            <span class="flex items-center gap-0.5 text-[10px] opacity-80">
              <UKbd size="sm">⌘</UKbd>
              <UKbd size="sm">K</UKbd>
            </span>
          </UButton>
          <UTooltip v-else text="Search pages (⌘K)" :content="{ side: 'right' }">
            <UButton
              square
              block
              color="neutral"
              variant="outline"
              icon="i-lucide-search"
              class="bg-elevated/40 border-default/80 cursor-pointer mx-auto"
              @click="globalSearch.open()"
            />
          </UTooltip>
        </div>
      </template>

      <!-- Nav content -->
      <template #default="{ state }">
        <AppSidebarNav :rail="state === 'collapsed'" />
      </template>

      <!-- Footer -->
      <template #footer="{ state }">
        <!-- Balance: full row when expanded -->
        <div
          v-if="state !== 'collapsed'"
          class="flex items-center justify-between rounded-lg bg-elevated/50 px-3 py-2 ring ring-inset ring-default"
        >
          <span class="font-semibold text-sm">
            <CoinBalance :value="user?.balance" :danger="bankGarnishing" :tooltip="BANK_DEBT_WARNING" />
          </span>
          <span class="font-semibold text-sm">
            <GemBalance :value="user?.gems" />
          </span>
        </div>
        <!-- Balance: icons only when collapsed -->
        <div
          v-else
          class="flex flex-col items-center gap-2"
        >
          <UTooltip
            v-if="bankGarnishing"
            :text="BANK_DEBT_WARNING"
            :ui="{ content: 'h-auto max-w-64 whitespace-normal' }"
          >
            <UIcon
              class="size-4 text-error"
              name="i-lucide-coins"
            />
          </UTooltip>
          <UIcon
            v-else
            class="size-4 text-yellow-400"
            name="i-lucide-coins"
          />
          <UIcon
            class="size-4 text-cyan-400"
            name="i-lucide-gem"
          />
        </div>

        <!-- User popover -->
        <UPopover
          v-model:open="menuOpen"
          :content="{ side: 'top', align: 'start', sideOffset: 8 }"
          class="w-full"
        >
          <UButton
            :label="state === 'collapsed' ? undefined : (user?.name ?? 'Account')"
            :square="state === 'collapsed'"
            :trailing-icon="state === 'collapsed' ? undefined : 'i-lucide-chevrons-up-down'"
            class="w-full"
            color="neutral"
            variant="ghost"
          >
            <template #leading>
              <ProfileEmblem :emblem="user?.emblem" :name="user?.name" :prestige="user?.prestige" class="size-6" />
            </template>
            <template v-if="state !== 'collapsed'" #trailing>
              <UIcon name="i-lucide-chevrons-up-down" class="ml-auto size-4 shrink-0" />
            </template>
          </UButton>

          <template #content>
            <div class="w-56 py-1.5">
              <div class="flex items-center gap-3 px-3 py-2">
                <ProfileEmblem :emblem="user?.emblem" :name="user?.name" :prestige="user?.prestige" class="size-8 text-sm" />
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold">{{ user?.name ?? 'Account' }}</p>
                  <p class="text-xs text-muted truncate">
                    {{ user?.email }}
                  </p>
                </div>
              </div>

              <USeparator class="my-1" />

              <div class="px-3 py-2 space-y-2.5">
                <USwitch
                  v-model="softStudio"
                  label="Soft Studio"
                  size="sm"
                />
                <USeparator />
                <div>
                  <p class="text-xs font-medium text-muted mb-1.5">
                    Primary
                  </p>
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
                  <p class="text-xs font-medium text-muted mb-1.5">
                    Secondary
                  </p>
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
                  <p class="text-xs font-medium text-muted mb-1.5">
                    Neutral
                  </p>
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

              <USeparator class="my-1" />

              <div class="px-1 py-0.5">
                <UButton
                  block
                  class="justify-start"
                  color="neutral"
                  icon="i-lucide-sliders-horizontal"
                  label="Customize sidebar"
                  variant="ghost"
                  @click="customizeSidebar"
                />
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

      </template>
    </USidebar>

    <!-- Main content -->
    <div class="flex flex-1 flex-col overflow-hidden min-w-0">
      <!-- Mobile header -->
      <header class="flex h-14 shrink-0 items-center justify-between border-b border-default px-4 lg:hidden">
        <div class="flex items-center gap-2">
          <UButton
            aria-label="Open sidebar"
            color="neutral"
            icon="i-lucide-panel-left"
            variant="ghost"
            @click="open = true"
          />
          <span class="font-semibold text-primary">Polynux</span>
        </div>
        <UButton
          aria-label="Search pages"
          color="neutral"
          icon="i-lucide-search"
          variant="ghost"
          @click="globalSearch.open()"
        />
      </header>

      <main class="flex-1 overflow-auto">
        <slot />
        <ChatWidget v-if="user" />
      </main>
    </div>

    <GlobalSearchModal />
  </div>
</template>
