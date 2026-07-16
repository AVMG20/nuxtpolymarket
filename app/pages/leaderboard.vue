<script setup lang="ts">
interface LeaderboardUser {
  id: string
  name: string
  balance: string
  bankBalance: number
  gems: number
  gemValue: number
  rigLevel: number
  vaultLevel: number
  factoryLevel: number
  overclockPct: number
  catalystPct: number
  hackPower: number
  colonyHabitatLevel: number
  colonyResearchLevels: number
  xenoSpeciesUnlocked: number
  xenoGridSlotsUnlocked: number
  xenoBreederSlotsUnlocked: number
  aiPromptsUsed: number
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
</script>

<template>
  <div class="mx-auto max-w-7xl p-4 sm:p-6 lg:px-8 xl:px-10">
    <div class="mb-6 sm:mb-8">
      <h1 class="flex items-center gap-2 text-2xl font-bold">
        <UIcon name="i-lucide-trophy" class="size-6 text-yellow-400" />
        Leaderboard
      </h1>
      <p class="mt-0.5 text-sm text-muted">Top players ranked by total wealth</p>
    </div>

    <div v-if="pending" class="space-y-3">
      <USkeleton v-for="i in 8" :key="i" class="h-20 rounded-xl" />
    </div>

    <div v-else-if="users?.length" class="space-y-2">
      <div
        v-for="(u, i) in users"
        :key="u.id"
        class="group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:gap-4 sm:px-4"
        :class="i < 3 ? [rankBg[i]!, 'sm:py-4'] : 'border-default bg-elevated/40 hover:bg-elevated'"
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

        <div class="flex size-9 shrink-0 items-center justify-center rounded-full border border-default bg-background text-sm font-bold sm:size-10 sm:text-base">
          {{ u.name[0]?.toUpperCase() }}
        </div>

        <div class="min-w-0 flex-1">
          <p class="truncate font-semibold" :class="i < 3 ? 'sm:text-base' : 'text-sm'">{{ u.name }}</p>
        </div>

        <div class="hidden w-28 shrink-0 flex-col items-end gap-0.5 text-xs font-semibold md:ml-auto md:flex">
          <GemBalance :value="u.gems" :compact="false" />
          <CoinBalance :value="u.gemValue" />
        </div>

        <div class="hidden w-28 shrink-0 flex-col items-end lg:flex">
          <BankBalance :value="u.bankBalance" class="text-sm font-semibold" />
          <p class="text-[10px] text-muted">Bank</p>
        </div>
        <div class="hidden w-28 shrink-0 flex-col items-end lg:flex">
          <span class="text-sm font-semibold"><CoinBalance :value="u.balance" /></span>
          <p class="text-[10px] text-muted">Wallet</p>
        </div>

        <div class="flex shrink-0 flex-col items-end gap-0.5 text-xs font-semibold md:hidden">
          <GemBalance :value="u.gems" />
          <CoinBalance :value="u.gemValue" />
        </div>
        <div class="flex shrink-0 flex-col items-end gap-0.5 lg:hidden">
          <span class="text-sm font-semibold" :class="totalBalance(u) < 0 ? 'text-error' : 'text-primary'"><CoinBalance :value="totalBalance(u)" /></span>
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
          <div class="grid grid-cols-3 gap-2">
            <div class="rounded-lg border border-default bg-elevated/40 p-3">
              <BankBalance :value="selectedUser.bankBalance" class="text-base font-bold" />
              <p class="mt-0.5 text-[10px] text-muted">Bank</p>
            </div>
            <div class="rounded-lg border border-default bg-elevated/40 p-3">
              <div class="space-y-1 text-sm font-bold">
                <GemBalance :value="selectedUser.gems" :compact="false" />
                <CoinBalance :value="selectedUser.gemValue" />
              </div>
            </div>
            <div class="rounded-lg border border-default bg-elevated/40 p-3">
              <CoinBalance :value="selectedUser.balance" class="mt-1 block text-base font-bold" />
              <p class="mt-0.5 text-[10px] text-muted">Wallet</p>
            </div>
          </div>

          <div>
            <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Miner progression</p>
            <div class="grid grid-cols-3 gap-2">
              <div class="rounded-lg bg-elevated/60 p-3 text-center">
                <UIcon name="i-lucide-cpu" class="size-4" :class="upgradeColors.miner" />
                <p class="mt-1 text-lg font-bold tabular-nums" :class="upgradeColors.miner">{{ selectedUser.rigLevel }}</p>
                <p class="text-[10px] text-muted">Miner</p>
              </div>
              <div class="rounded-lg bg-elevated/60 p-3 text-center">
                <UIcon name="i-lucide-vault" class="size-4" :class="upgradeColors.vault" />
                <p class="mt-1 text-lg font-bold tabular-nums" :class="upgradeColors.vault">{{ selectedUser.vaultLevel }}</p>
                <p class="text-[10px] text-muted">Vault</p>
              </div>
              <div class="rounded-lg bg-elevated/60 p-3 text-center">
                <UIcon name="i-lucide-factory" class="size-4" :class="upgradeColors.factory" />
                <p class="mt-1 text-lg font-bold tabular-nums" :class="upgradeColors.factory">{{ selectedUser.factoryLevel }}</p>
                <p class="text-[10px] text-muted">Factory</p>
              </div>
              <div v-if="selectedUser.overclockPct > 0" class="rounded-lg bg-elevated/60 p-3 text-center">
                <UIcon name="i-lucide-gauge" class="size-4" :class="upgradeColors.overclock" />
                <p class="mt-1 text-lg font-bold tabular-nums" :class="upgradeColors.overclock">+{{ selectedUser.overclockPct }}%</p>
                <p class="text-[10px] text-muted">Overclock</p>
              </div>
              <div v-if="selectedUser.catalystPct > 0" class="rounded-lg bg-elevated/60 p-3 text-center">
                <UIcon name="i-lucide-flask-conical" class="size-4" :class="upgradeColors.catalyst" />
                <p class="mt-1 text-lg font-bold tabular-nums" :class="upgradeColors.catalyst">+{{ selectedUser.catalystPct }}%</p>
                <p class="text-[10px] text-muted">Catalyst</p>
              </div>
            </div>
          </div>

          <div>
            <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Other details</p>
            <div class="divide-y divide-default overflow-hidden rounded-lg border border-default">
              <div class="flex items-center gap-3 bg-elevated/40 px-3 py-2.5">
                <UIcon name="i-lucide-shield" class="size-4 text-primary" />
                <span class="flex-1 text-sm">HackOps power</span>
                <span class="font-semibold tabular-nums text-primary">{{ formatNumber(selectedUser.hackPower, false) }}</span>
              </div>
              <div class="flex items-center gap-3 bg-elevated/40 px-3 py-2.5">
                <UIcon name="i-lucide-house" class="size-4 text-warning" />
                <span class="flex-1 text-sm">Colony habitat</span>
                <span class="font-semibold tabular-nums text-warning">{{ selectedUser.colonyHabitatLevel }}</span>
              </div>
              <div class="flex items-center gap-3 bg-elevated/40 px-3 py-2.5">
                <UIcon name="i-lucide-bug" class="size-4 text-warning" />
                <span class="flex-1 text-sm">Colony research</span>
                <span class="font-semibold tabular-nums text-warning">{{ selectedUser.colonyResearchLevels }}</span>
              </div>
              <div class="flex items-center gap-3 bg-elevated/40 px-3 py-2.5">
                <UIcon name="i-lucide-sprout" class="size-4 text-success" />
                <span class="flex-1 text-sm">Xeno species unlocked</span>
                <span class="font-semibold tabular-nums text-success">{{ selectedUser.xenoSpeciesUnlocked }}</span>
              </div>
              <div class="flex items-center gap-3 bg-elevated/40 px-3 py-2.5">
                <UIcon name="i-lucide-grid-2x2" class="size-4 text-success" />
                <span class="flex-1 text-sm">Xeno grid tiles unlocked</span>
                <span class="font-semibold tabular-nums text-success">{{ selectedUser.xenoGridSlotsUnlocked }}</span>
              </div>
              <div class="flex items-center gap-3 bg-elevated/40 px-3 py-2.5">
                <UIcon name="i-lucide-git-branch" class="size-4 text-success" />
                <span class="flex-1 text-sm">Xeno breeder slots unlocked</span>
                <span class="font-semibold tabular-nums text-success">{{ selectedUser.xenoBreederSlotsUnlocked }}</span>
              </div>
              <div class="flex items-center gap-3 bg-elevated/40 px-3 py-2.5">
                <UIcon name="i-lucide-bot" class="size-4 text-info" />
                <span class="flex-1 text-sm">AI prompts used</span>
                <span class="font-semibold tabular-nums text-info">{{ formatNumber(selectedUser.aiPromptsUsed, false) }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
