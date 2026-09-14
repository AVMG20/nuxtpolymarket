<script setup lang="ts">
import { parseAmount } from '#shared/utils/parse-amount'

interface LeaderboardUser {
  isCurrentUser: boolean
  id: string
  name: string
  emblem: string | null
  prestige: number
  balance: string
  bankBalance: number
  inDebt: boolean
  bailoutActive: boolean
  bailoutRemaining: number
  gems: number
  gemValue: number
  hackPower: number
  colonyHabitatLevel: number
  colonyResearchLevels: number
  xenoSpeciesUnlocked: number
  xenoGridSlotsUnlocked: number
  xenoBreederSlotsUnlocked: number
  aiPromptsUsed: number
  battlerRunsWon: number
  battlerRating: number | null
  battlerBattlesWon: number
  battlerBattlesLost: number
  totalUpgrades: number
  totalWealth: number
}

const { data: users, pending, refresh } = await useAsyncData('leaderboard', () => apiFetch<LeaderboardUser[]>('/api/leaderboard'))
const { user: me, balanceNum, fetchSession } = useAuth()
const toast = useToast()

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

function openDetails(user: LeaderboardUser) {
  selectedUser.value = user
  giftCoinsInput.value = ''
  giftGemsInput.value = ''
}

// -- gifting ------------------------------------------------------------------

const giftCoinsInput = ref('')
const giftGemsInput = ref('')
const gifting = ref(false)

const giftCoins = computed(() => {
  if (!giftCoinsInput.value.trim()) return 0
  const parsed = parseAmount(giftCoinsInput.value)
  return parsed === null || parsed < 0.01 ? null : parsed
})
const giftGems = computed(() => {
  if (!giftGemsInput.value.trim()) return 0
  const parsed = parseAmount(giftGemsInput.value)
  return parsed === null || !Number.isInteger(parsed) ? null : parsed
})
const myGems = computed(() => me.value?.gems ?? 0)

const coinsTooMany = computed(() => (giftCoins.value ?? 0) > balanceNum.value)
const gemsTooMany = computed(() => (giftGems.value ?? 0) > myGems.value)
const canGift = computed(() =>
  !!me.value
  && !gifting.value
  && giftCoins.value !== null
  && giftGems.value !== null
  && ((giftCoins.value ?? 0) > 0 || (giftGems.value ?? 0) > 0)
  && !coinsTooMany.value
  && !gemsTooMany.value
)

const coinPresets = ['10k', '100k', '1m', '10m', '100m', '1b']
const gemPresets = ['10', '100', '1k', '10k']

function setCoins(preset: string) {
  giftCoinsInput.value = preset
}

function setGems(preset: string) {
  giftGemsInput.value = preset
}

function allCoins() {
  giftCoinsInput.value = Math.floor(balanceNum.value * 100) / 100 > 0 ? String(Math.floor(balanceNum.value * 100) / 100) : ''
}

function allGems() {
  giftGemsInput.value = myGems.value > 0 ? String(myGems.value) : ''
}

async function sendGift() {
  const target = selectedUser.value
  if (!target || !canGift.value) return
  gifting.value = true
  try {
    await apiFetch('/api/gift', {
      method: 'POST',
      body: { toUserId: target.id, coins: giftCoins.value ?? 0, gems: giftGems.value ?? 0 }
    })
    giftCoinsInput.value = ''
    giftGemsInput.value = ''
    await Promise.all([fetchSession(), refresh()])
    const updated = users.value?.find(u => u.id === target.id)
    if (updated) selectedUser.value = updated
  } catch (error) {
    toast.add({ title: apiErrorMessage(error, 'Gift failed'), color: 'error' })
  } finally {
    gifting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-7xl p-4 sm:p-6 lg:px-8 xl:px-10">
    <div class="mb-6 sm:mb-8">
      <h1 class="flex items-center gap-2 text-2xl font-bold">
        <UIcon name="i-lucide-trophy" class="size-6 text-yellow-400" />
        Leaderboard
      </h1>
      <p class="mt-0.5 text-sm text-muted">Top players ranked by prestige, then total upgrades, then total wealth</p>
    </div>

    <LeaderboardSkeleton v-if="pending" />

    <UCard v-else-if="users?.length" :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="min-w-[960px] w-full border-collapse text-sm">
          <thead class="border-b border-default bg-elevated/50 text-xs font-bold uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" class="w-14 px-3 py-3 text-center"><UTooltip text="Rank"><UIcon name="i-lucide-trophy" class="mx-auto size-4" /></UTooltip></th>
              <th scope="col" class="min-w-44 px-3 py-3 text-left">Player</th>
              <th scope="col" class="px-3 py-3 text-left"><UTooltip text="Total upgrades"><UIcon name="i-lucide-arrow-big-up-dash" class="size-4" /></UTooltip></th>
              <th scope="col" class="px-3 py-3 text-left"><UTooltip text="Balances"><UIcon name="i-lucide-wallet-cards" class="size-4" /></UTooltip></th>
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
                  <ProfileEmblem :emblem="u.emblem" :name="u.name" :prestige="u.prestige" class="size-9 text-sm" />
                  <p class="max-w-40 truncate font-semibold">{{ u.name }}</p>
                  <LeaderboardYouBadge :show="u.isCurrentUser" />
                  <UTooltip text="Open profile">
                    <UButton
                      :to="`/players/${u.id}`"
                      icon="i-lucide-external-link"
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      class="text-muted"
                      :aria-label="`Open ${u.name}'s profile`"
                      @click.stop
                    />
                  </UTooltip>
                </div>
              </td>
              <td class="px-3 py-3">
                <UTooltip text="Total upgrades">
                  <span class="inline-flex items-center gap-1 font-bold tabular-nums text-primary">
                    <UIcon name="i-lucide-arrow-big-up-dash" class="size-3.5" />{{ formatNumber(u.totalUpgrades, false) }}
                  </span>
                </UTooltip>
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-3 whitespace-nowrap text-xs font-semibold">
                  <UTooltip :text="u.inDebt ? 'Wallet — this player owes the bank' : 'Wallet'"><CoinBalance :value="u.balance" :danger="u.inDebt" /></UTooltip>
                  <UTooltip text="Bank"><BankBalance :value="u.bankBalance" /></UTooltip>
                  <UTooltip v-if="u.bailoutActive" :text="`Took a bank bail-out — ${formatNumber(u.bailoutRemaining, false, 2)} still being levied back`">
                    <UIcon name="i-lucide-life-buoy" class="size-4 shrink-0 text-warning" />
                  </UTooltip>
                  <UTooltip text="Gems and gem value"><span class="inline-flex items-center gap-1"><GemBalance :value="u.gems" /><CoinBalance :value="u.gemValue" /></span></UTooltip>
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
                  <UTooltip :text="`Battler — ${u.battlerRating == null ? 'unrated' : `${u.battlerRating} Elo`}, ${u.battlerRunsWon} runs won, ${u.battlerBattlesWon}–${u.battlerBattlesLost} in battles`">
                    <span class="inline-flex items-center gap-1 text-secondary">
                      <UIcon name="i-lucide-swords" class="size-3.5" />{{ u.battlerRating ?? '—' }}
                    </span>
                  </UTooltip>
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
          <div class="flex items-center gap-3">
            <ProfileEmblem :emblem="selectedUser.emblem" :name="selectedUser.name" :prestige="selectedUser.prestige" class="size-12 text-lg" />
            <PrestigeBadge :level="selectedUser.prestige" size="md" />
            <p class="min-w-0 flex-1 truncate font-semibold">{{ selectedUser.name }}</p>
            <UButton :to="`/players/${selectedUser.id}`" icon="i-lucide-external-link" size="xs" variant="soft" color="neutral" label="Profile" />
          </div>

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
              <CoinBalance :value="selectedUser.balance" :danger="selectedUser.inDebt" class="mt-1 block text-base font-bold" />
              <p class="mt-0.5 text-[10px] text-muted">Wallet</p>
            </div>
          </div>

          <div v-if="selectedUser.bailoutActive" class="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
            <UIcon name="i-lucide-life-buoy" class="size-4 shrink-0 text-warning" />
            <span class="text-muted">Bail-out running —</span>
            <CoinBalance :value="selectedUser.bailoutRemaining" :compact="false" :minimum-fraction-digits="2" class="font-semibold" />
            <span class="text-muted">left to levy back</span>
          </div>

          <div v-if="me && !selectedUser.isCurrentUser" class="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div class="mb-3 flex items-center gap-2">
              <UIcon name="i-lucide-gift" class="size-4 text-primary" />
              <p class="text-xs font-medium uppercase tracking-wide text-muted">Gift {{ selectedUser.name }}</p>
            </div>

            <form class="space-y-3" @submit.prevent="sendGift">
              <div class="space-y-1.5">
                <UInput
                  v-model="giftCoinsInput"
                  placeholder="Coins — e.g. 200k, 2.5m, 2b"
                  icon="i-lucide-coins"
                  autocomplete="off"
                  class="w-full"
                  :color="giftCoins === null || coinsTooMany ? 'error' : undefined"
                >
                  <template v-if="giftCoins" #trailing>
                    <span class="text-xs tabular-nums text-muted">{{ formatNumber(giftCoins, false) }}</span>
                  </template>
                </UInput>
                <div class="flex flex-wrap gap-1">
                  <UButton v-for="p in coinPresets" :key="p" size="xs" variant="soft" color="neutral" @click="setCoins(p)">{{ p }}</UButton>
                  <UButton size="xs" variant="soft" color="neutral" :disabled="balanceNum <= 0" @click="allCoins">All</UButton>
                </div>
                <p v-if="coinsTooMany" class="text-xs text-error">You only have <CoinBalance :value="me.balance" :compact="false" /></p>
              </div>

              <div class="space-y-1.5">
                <UInput
                  v-model="giftGemsInput"
                  placeholder="Gems — e.g. 50, 1k"
                  icon="i-lucide-gem"
                  autocomplete="off"
                  class="w-full"
                  :color="giftGems === null || gemsTooMany ? 'error' : undefined"
                >
                  <template v-if="giftGems" #trailing>
                    <span class="text-xs tabular-nums text-muted">{{ formatNumber(giftGems, false) }}</span>
                  </template>
                </UInput>
                <div class="flex flex-wrap gap-1">
                  <UButton v-for="p in gemPresets" :key="p" size="xs" variant="soft" color="neutral" @click="setGems(p)">{{ p }}</UButton>
                  <UButton size="xs" variant="soft" color="neutral" :disabled="myGems <= 0" @click="allGems">All</UButton>
                </div>
                <p v-if="gemsTooMany" class="text-xs text-error">You only have <GemBalance :value="myGems" :compact="false" /></p>
              </div>

              <UButton type="submit" icon="i-lucide-gift" block :disabled="!canGift" :loading="gifting">
                Send gift
              </UButton>
            </form>
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
