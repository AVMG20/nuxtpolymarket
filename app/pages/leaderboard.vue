<script setup lang="ts">
interface LeaderboardUser {
  id: string
  name: string
  prestigeLevel: number
  balance: string
  bankBalance: number
  gems: number
  gemValue: number
  rigLevel: number
  vaultLevel: number
  factoryLevel: number
  overclockPct: number
  catalystPct: number
  totalLevels: number
  totalWealth: number
}

const { data: users, pending } = await useFetch<LeaderboardUser[]>('/api/leaderboard')

const selectedUser = ref<LeaderboardUser | null>(null)
const detailsOpen = computed({
  get: () => selectedUser.value !== null,
  set: (open: boolean) => {
    if (!open) selectedUser.value = null
  }
})

const medals = ['i-lucide-medal', 'i-lucide-award', 'i-lucide-star']
const medalColors = ['text-yellow-400', 'text-slate-400', 'text-amber-600']
const rankBg = [
  'bg-gradient-to-r from-yellow-500/10 to-amber-500/5 border-yellow-500/30',
  'bg-gradient-to-r from-slate-500/10 to-slate-400/5 border-slate-500/30',
  'bg-gradient-to-r from-amber-700/10 to-amber-600/5 border-amber-700/30'
]

const upgradeColors = {
  miner: 'text-yellow-400',
  vault: 'text-green-400',
  factory: 'text-cyan-400',
  overclock: 'text-orange-400',
  catalyst: 'text-violet-400'
}

function totalBalance(user: LeaderboardUser) {
  return Number(user.balance) + user.bankBalance
}

function openDetails(user: LeaderboardUser) {
  selectedUser.value = user
}

function prestigeRowClass(level: number) {
  if (level === 1) return 'ring-1 ring-amber-400/50 shadow-[0_0_22px_rgba(251,191,36,0.12)]'
  if (level === 2) return 'ring-1 ring-violet-400/60 shadow-[0_0_26px_rgba(167,139,250,0.16)]'
  if (level >= 3) return 'ring-2 ring-cyan-300/70 bg-gradient-to-r from-cyan-400/10 via-violet-400/10 to-fuchsia-400/10 shadow-[0_0_32px_rgba(34,211,238,0.22)]'
  return ''
}
</script>

<template>
  <div class="mx-auto max-w-7xl p-4 sm:p-6 lg:px-8 xl:px-10">
    <div class="mb-6 sm:mb-8">
      <h1 class="flex items-center gap-2 text-2xl font-bold">
        <UIcon name="i-lucide-trophy" class="size-6 text-yellow-400" />
        Leaderboard
      </h1>
      <p class="mt-0.5 text-sm text-muted">Prestige ranks first, followed by total level progression</p>
    </div>

    <div v-if="pending" class="space-y-3">
      <USkeleton v-for="i in 8" :key="i" class="h-20 rounded-xl" />
    </div>

    <div v-else-if="users?.length" class="space-y-2">
      <div
        v-for="(u, i) in users"
        :key="u.id"
        class="group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:gap-4 sm:px-4"
        :class="[i < 3 ? [rankBg[i]!, 'sm:py-4'] : 'border-default bg-elevated/40 hover:bg-elevated', prestigeRowClass(u.prestigeLevel)]"
        role="button"
        tabindex="0"
        @click="openDetails(u)"
        @keydown.enter="openDetails(u)"
        @keydown.space.prevent="openDetails(u)"
      >
        <div class="flex w-7 shrink-0 items-center justify-center sm:w-8">
          <UIcon
            v-if="i < 3"
            :name="medals[i]!"
            class="size-6 sm:size-7"
            :class="medalColors[i]"
          />
          <span v-else class="font-mono text-sm text-muted">{{ i + 1 }}</span>
        </div>

        <div
          class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-background text-sm font-bold sm:size-10 sm:text-base"
          :class="u.prestigeLevel > 0 ? 'border-primary ring-2 ring-primary/30' : 'border-default'"
        >
          {{ u.name[0]?.toUpperCase() }}
        </div>

        <div class="min-w-0 flex-1 sm:max-w-44 xl:max-w-56">
          <div class="flex items-center gap-1.5">
            <p class="truncate font-semibold" :class="i < 3 ? 'sm:text-base' : 'text-sm'">{{ u.name }}</p>
            <PrestigeBadge v-if="u.prestigeLevel > 0" :level="u.prestigeLevel" compact />
          </div>
          <p class="text-[10px] text-muted sm:text-xs">#{{ i + 1 }} · P{{ u.prestigeLevel }} · Lv {{ u.totalLevels }}</p>
        </div>

        <div class="hidden flex-1 items-center justify-center gap-5 lg:flex xl:gap-7">
          <div class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-cpu" class="size-3.5" :class="upgradeColors.miner" />
              <span class="text-xs font-semibold" :class="upgradeColors.miner">{{ u.rigLevel }}</span>
            </div>
            <span class="text-[10px] text-muted">Miner</span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-vault" class="size-3.5" :class="upgradeColors.vault" />
              <span class="text-xs font-semibold" :class="upgradeColors.vault">{{ u.vaultLevel }}</span>
            </div>
            <span class="text-[10px] text-muted">Vault</span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-factory" class="size-3.5" :class="upgradeColors.factory" />
              <span class="text-xs font-semibold" :class="upgradeColors.factory">{{ u.factoryLevel }}</span>
            </div>
            <span class="text-[10px] text-muted">Factory</span>
          </div>
          <div v-if="u.overclockPct > 0" class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-gauge" class="size-3.5" :class="upgradeColors.overclock" />
              <span class="text-xs font-semibold" :class="upgradeColors.overclock">+{{ u.overclockPct }}%</span>
            </div>
            <span class="text-[10px] text-muted">Overclock</span>
          </div>
          <div v-if="u.catalystPct > 0" class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-flask-conical" class="size-3.5" :class="upgradeColors.catalyst" />
              <span class="text-xs font-semibold" :class="upgradeColors.catalyst">+{{ u.catalystPct }}%</span>
            </div>
            <span class="text-[10px] text-muted">Catalyst</span>
          </div>
        </div>

        <div class="hidden shrink-0 flex-col items-end gap-0.5 md:flex">
          <span class="text-xs font-semibold"><GemBalance :value="u.gems" :compact="false" /></span>
          <span class="flex items-center gap-0.5 text-[10px] text-muted">
            ≈ <CoinBalance :value="u.gemValue" :show-icon="false" />
          </span>
        </div>

        <div class="hidden shrink-0 flex-col items-end lg:flex">
          <span class="text-sm font-semibold" :class="u.bankBalance < 0 ? 'text-error' : 'text-primary'"><CoinBalance :value="u.bankBalance" /></span>
          <span class="text-[10px] text-muted">Bank</span>
        </div>
        <div class="hidden shrink-0 flex-col items-end lg:flex">
          <span class="text-sm font-semibold"><CoinBalance :value="u.balance" /></span>
          <span class="text-[10px] text-muted">Wallet</span>
        </div>

        <div class="flex shrink-0 flex-col items-end gap-0.5 md:hidden">
          <span class="text-xs font-semibold"><GemBalance :value="u.gems" /></span>
          <span class="text-[10px] text-muted">Gems</span>
        </div>
        <div class="flex shrink-0 flex-col items-end gap-0.5 lg:hidden">
          <span class="text-sm font-semibold" :class="totalBalance(u) < 0 ? 'text-error' : 'text-primary'"><CoinBalance :value="totalBalance(u)" /></span>
          <span class="text-[10px] text-muted">Total balance</span>
        </div>

        <UIcon name="i-lucide-chevron-right" class="hidden size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 sm:block lg:hidden" />
      </div>
    </div>

    <UEmpty
      v-else
      description="No players found"
      icon="i-lucide-users"
    />

    <UModal v-model:open="detailsOpen" :title="selectedUser?.name ?? 'Player details'" description="Player progression and balances">
      <template v-if="selectedUser" #body>
        <div class="space-y-5">
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-lg border border-default bg-elevated/40 p-3">
              <p class="text-xs text-muted">Total balance</p>
              <CoinBalance :value="totalBalance(selectedUser)" :compact="false" class="mt-1 text-lg font-bold" :class="totalBalance(selectedUser) < 0 ? 'text-error' : 'text-primary'" />
            </div>
            <div class="rounded-lg border border-default bg-elevated/40 p-3">
              <p class="text-xs text-muted">Gems</p>
              <GemBalance :value="selectedUser.gems" :compact="false" class="mt-1 text-lg font-bold" />
              <p class="mt-0.5 text-[10px] text-muted">≈ <CoinBalance :value="selectedUser.gemValue" :show-icon="false" /></p>
            </div>
          </div>

          <div
            v-if="selectedUser.prestigeLevel > 0"
            class="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/10 p-3"
          >
            <div>
              <p class="text-xs text-muted">Permanent status</p>
              <PrestigeBadge :level="selectedUser.prestigeLevel" class="mt-1" />
            </div>
            <p class="text-sm font-black text-primary">+{{ selectedUser.prestigeLevel * 5 }}% credits</p>
          </div>

          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-lg border border-default p-3">
              <p class="text-xs text-muted">Bank</p>
              <CoinBalance :value="selectedUser.bankBalance" :compact="false" class="mt-1 font-semibold" :class="selectedUser.bankBalance < 0 ? 'text-error' : 'text-primary'" />
            </div>
            <div class="rounded-lg border border-default p-3">
              <p class="text-xs text-muted">Wallet</p>
              <CoinBalance :value="selectedUser.balance" :compact="false" class="mt-1 font-semibold" />
            </div>
          </div>

          <div>
            <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Progression · level {{ selectedUser.totalLevels }}</p>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div class="rounded-lg bg-elevated/60 p-3 text-sm">
                <UIcon name="i-lucide-cpu" class="mr-1.5 inline size-4" :class="upgradeColors.miner" />
                Miner <span class="font-semibold" :class="upgradeColors.miner">{{ selectedUser.rigLevel }}</span>
              </div>
              <div class="rounded-lg bg-elevated/60 p-3 text-sm">
                <UIcon name="i-lucide-vault" class="mr-1.5 inline size-4" :class="upgradeColors.vault" />
                Vault <span class="font-semibold" :class="upgradeColors.vault">{{ selectedUser.vaultLevel }}</span>
              </div>
              <div class="rounded-lg bg-elevated/60 p-3 text-sm">
                <UIcon name="i-lucide-factory" class="mr-1.5 inline size-4" :class="upgradeColors.factory" />
                Factory <span class="font-semibold" :class="upgradeColors.factory">{{ selectedUser.factoryLevel }}</span>
              </div>
              <div v-if="selectedUser.overclockPct > 0" class="rounded-lg bg-elevated/60 p-3 text-sm">
                <UIcon name="i-lucide-gauge" class="mr-1.5 inline size-4" :class="upgradeColors.overclock" />
                Overclock <span class="font-semibold" :class="upgradeColors.overclock">+{{ selectedUser.overclockPct }}%</span>
              </div>
              <div v-if="selectedUser.catalystPct > 0" class="rounded-lg bg-elevated/60 p-3 text-sm">
                <UIcon name="i-lucide-flask-conical" class="mr-1.5 inline size-4" :class="upgradeColors.catalyst" />
                Catalyst <span class="font-semibold" :class="upgradeColors.catalyst">+{{ selectedUser.catalystPct }}%</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
