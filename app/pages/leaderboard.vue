<script setup lang="ts">
interface LeaderboardUser {
  isCurrentUser: boolean
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

    <LeaderboardSkeleton v-if="pending" />

    <UCard v-else-if="users?.length" :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="min-w-[1200px] w-full border-collapse text-sm">
          <thead class="border-b border-default bg-elevated/50 text-xs font-bold uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" class="w-14 px-3 py-3 text-center"><UTooltip text="Rank"><UIcon name="i-lucide-trophy" class="mx-auto size-4" /></UTooltip></th>
              <th scope="col" class="min-w-44 px-3 py-3 text-left">Player</th>
              <th scope="col" class="px-3 py-3 text-left"><UTooltip text="Balances"><UIcon name="i-lucide-wallet-cards" class="size-4" /></UTooltip></th>
              <th scope="col" class="px-3 py-3 text-left"><UTooltip text="Miner progression"><UIcon name="i-lucide-pickaxe" class="size-4" /></UTooltip></th>
              <th scope="col" class="px-3 py-3 text-left"><UTooltip text="Game progress"><UIcon name="i-lucide-chart-no-axes-combined" class="size-4" /></UTooltip></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(u, i) in users"
              :key="u.name"
              class="cursor-pointer border-b border-default/70 transition-colors last:border-b-0 hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
              :class="i < 3 ? rankBg[i] : ''"
              tabindex="0"
              @click="openDetails(u)"
              @keydown.enter="openDetails(u)"
              @keydown.space.prevent="openDetails(u)"
            >
              <td class="px-3 py-3 text-center">
                <LeaderboardMedal v-if="i < 3" :rank="i" size="mx-auto size-5" />
                <span v-else class="font-mono text-sm text-muted">{{ i + 1 }}</span>
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-2.5">
                  <div class="flex size-9 shrink-0 items-center justify-center rounded-full border border-default bg-background font-bold">{{ u.name[0]?.toUpperCase() }}</div>
                  <p class="max-w-40 truncate font-semibold">{{ u.name }}</p>
                </div>
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-3 whitespace-nowrap text-xs font-semibold">
                  <UTooltip text="Wallet"><CoinBalance :value="u.balance" /></UTooltip>
                  <UTooltip text="Bank"><BankBalance :value="u.bankBalance" /></UTooltip>
                  <UTooltip text="Gems and gem value"><span class="inline-flex items-center gap-1"><GemBalance :value="u.gems" /><CoinBalance :value="u.gemValue" /></span></UTooltip>
                </div>
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-2.5 whitespace-nowrap font-semibold tabular-nums">
                  <UTooltip text="Rig level"><span class="inline-flex items-center gap-1"><UIcon name="i-lucide-cpu" class="size-3.5 text-warning" />{{ u.rigLevel }}</span></UTooltip>
                  <UTooltip text="Vault level"><span class="inline-flex items-center gap-1"><UIcon name="i-lucide-vault" class="size-3.5 text-success" />{{ u.vaultLevel }}</span></UTooltip>
                  <UTooltip text="Factory level"><span class="inline-flex items-center gap-1"><UIcon name="i-lucide-factory" class="size-3.5 text-info" />{{ u.factoryLevel }}</span></UTooltip>
                  <UTooltip text="Rig Overclock"><span class="inline-flex items-center gap-1 text-warning"><UIcon name="i-lucide-gauge" class="size-3.5" />+{{ u.overclockPct }}%</span></UTooltip>
                  <UTooltip text="Factory Catalyst"><span class="inline-flex items-center gap-1 text-secondary"><UIcon name="i-lucide-flask-conical" class="size-3.5" />+{{ u.catalystPct }}%</span></UTooltip>
                </div>
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-2.5 whitespace-nowrap font-semibold tabular-nums">
                  <UTooltip text="HackOps power"><span class="inline-flex items-center gap-1 text-primary"><UIcon name="i-lucide-shield" class="size-3.5" />{{ formatNumber(u.hackPower, false) }}</span></UTooltip>
                  <UTooltip text="Colony habitat"><span class="inline-flex items-center gap-1 text-warning"><UIcon name="i-lucide-house" class="size-3.5" />{{ u.colonyHabitatLevel }}</span></UTooltip>
                  <UTooltip text="Colony research"><span class="inline-flex items-center gap-1 text-warning"><UIcon name="i-lucide-bug" class="size-3.5" />{{ u.colonyResearchLevels }}</span></UTooltip>
                  <UTooltip text="Xeno species"><span class="inline-flex items-center gap-1 text-success"><UIcon name="i-lucide-sprout" class="size-3.5" />{{ u.xenoSpeciesUnlocked }}</span></UTooltip>
                  <UTooltip text="Xeno grid tiles"><span class="inline-flex items-center gap-1 text-success"><UIcon name="i-lucide-grid-2x2" class="size-3.5" />{{ u.xenoGridSlotsUnlocked }}</span></UTooltip>
                  <UTooltip text="Xeno breeder slots"><span class="inline-flex items-center gap-1 text-success"><UIcon name="i-lucide-dna" class="size-3.5" />{{ u.xenoBreederSlotsUnlocked }}</span></UTooltip>
                  <UTooltip text="AI prompts used"><span class="inline-flex items-center gap-1 text-info"><UIcon name="i-lucide-bot" class="size-3.5" />{{ formatNumber(u.aiPromptsUsed, false) }}</span></UTooltip>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

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
              <div class="rounded-lg bg-elevated/60 p-3 text-center">
                <UIcon name="i-lucide-gauge" class="size-4" :class="upgradeColors.overclock" />
                <p class="mt-1 text-lg font-bold tabular-nums" :class="upgradeColors.overclock">+{{ selectedUser.overclockPct }}%</p>
                <p class="text-[10px] text-muted">Rig Overclock</p>
              </div>
              <div class="rounded-lg bg-elevated/60 p-3 text-center">
                <UIcon name="i-lucide-flask-conical" class="size-4" :class="upgradeColors.catalyst" />
                <p class="mt-1 text-lg font-bold tabular-nums" :class="upgradeColors.catalyst">+{{ selectedUser.catalystPct }}%</p>
                <p class="text-[10px] text-muted">Factory Catalyst</p>
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
                <UIcon name="i-lucide-dna" class="size-4 text-success" />
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
