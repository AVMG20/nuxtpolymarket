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
  townScore: number
  townMilestones: number
  townResearch: number
  voidScore: number
  voidSectorsCleared: number
  voidPilotLevel: number
  voidHulls: number
  voidSystemLevels: number
  voidTradeLevel: number
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

const podiumBg = [
  'bg-gradient-to-b from-yellow-500/15 to-transparent border-yellow-500/40',
  'bg-gradient-to-b from-slate-500/15 to-transparent border-slate-500/40',
  'bg-gradient-to-b from-amber-700/15 to-transparent border-amber-700/40'
]

/** The games whose upgrades add up to `totalUpgrades`, in the order the bar stacks them. */
const upgradeGames = [
  { key: 'colony', label: 'Colony', icon: 'i-lucide-bug', bar: 'bg-warning', text: 'text-warning', value: (u: LeaderboardUser) => u.colonyHabitatLevel + u.colonyResearchLevels },
  { key: 'xeno', label: 'Xeno', icon: 'i-lucide-sprout', bar: 'bg-success', text: 'text-success', value: (u: LeaderboardUser) => u.xenoSpeciesUnlocked + u.xenoGridSlotsUnlocked + u.xenoBreederSlotsUnlocked },
  { key: 'town', label: 'Polytown', icon: 'i-lucide-building-2', bar: 'bg-secondary', text: 'text-secondary', value: (u: LeaderboardUser) => u.townScore },
  { key: 'void', label: 'Void Runner', icon: 'i-lucide-rocket', bar: 'bg-inverted', text: 'text-highlighted', value: (u: LeaderboardUser) => u.voidScore }
]

const podium = computed(() => (users.value ?? []).slice(0, 3))
const mostUpgrades = computed(() => Math.max(1, ...(users.value ?? []).map(u => u.totalUpgrades)))

function upgradeSegments(u: LeaderboardUser) {
  return upgradeGames
    .map(game => ({ ...game, amount: game.value(u) }))
    .filter(game => game.amount > 0)
}

const myIndex = computed(() => users.value?.findIndex(u => u.isCurrentUser) ?? -1)
const myEntry = computed(() => (myIndex.value >= 0 ? users.value?.[myIndex.value] : undefined))

/** What stands between the viewer and the player one spot above, in ranking order. */
const nextRankGap = computed(() => {
  const mine = myEntry.value
  const ahead = myIndex.value > 0 ? users.value?.[myIndex.value - 1] : undefined
  if (!mine || !ahead) return null
  if ((ahead.prestige ?? 0) > (mine.prestige ?? 0)) return `Reach prestige ${ahead.prestige} to pass #${myIndex.value}`
  const upgrades = ahead.totalUpgrades - mine.totalUpgrades
  if (upgrades > 0) return `${formatNumber(upgrades, false)} upgrade${upgrades === 1 ? '' : 's'} behind #${myIndex.value}`
  return `${formatNumber(ahead.totalWealth - mine.totalWealth)} net worth behind #${myIndex.value}`
})

function scrollToMe() {
  if (!myEntry.value) return
  document.getElementById(`lb-row-${myEntry.value.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** Every stat the ranking counts, grouped by game, for the details modal. */
const detailGroups = computed(() => {
  const u = selectedUser.value
  if (!u) return []
  return [
    {
      ...upgradeGames[0]!,
      total: upgradeGames[0]!.value(u),
      rows: [
        { icon: 'i-lucide-house', label: 'Habitat level', value: u.colonyHabitatLevel },
        { icon: 'i-lucide-bug', label: 'Research levels', value: u.colonyResearchLevels }
      ]
    },
    {
      ...upgradeGames[1]!,
      total: upgradeGames[1]!.value(u),
      rows: [
        { icon: 'i-lucide-sprout', label: 'Species unlocked', value: u.xenoSpeciesUnlocked },
        { icon: 'i-lucide-grid-2x2', label: 'Grid tiles', value: u.xenoGridSlotsUnlocked },
        { icon: 'i-lucide-dna', label: 'Breeder slots', value: u.xenoBreederSlotsUnlocked }
      ]
    },
    {
      ...upgradeGames[2]!,
      total: upgradeGames[2]!.value(u),
      rows: [
        { icon: 'i-lucide-flag', label: 'Milestones', value: u.townMilestones },
        { icon: 'i-lucide-flask-conical', label: 'Research', value: u.townResearch }
      ]
    },
    {
      ...upgradeGames[3]!,
      total: upgradeGames[3]!.value(u),
      rows: [
        { icon: 'i-lucide-orbit', label: 'Sectors cleared', value: u.voidSectorsCleared },
        { icon: 'i-lucide-user-round', label: 'Pilot level', value: u.voidPilotLevel },
        { icon: 'i-lucide-rocket', label: 'Hulls owned', value: u.voidHulls },
        { icon: 'i-lucide-wrench', label: 'Station system levels', value: u.voidSystemLevels },
        { icon: 'i-lucide-handshake', label: 'Trade contracts', value: u.voidTradeLevel }
      ]
    }
  ]
})

const selectedRank = computed(() => {
  const u = selectedUser.value
  return u ? (users.value?.findIndex(x => x.id === u.id) ?? -1) + 1 : 0
})

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
    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="flex items-center gap-2 text-2xl font-bold">
          <UIcon name="i-lucide-trophy" class="size-6 text-yellow-400" />
          Leaderboard
        </h1>
        <p class="mt-0.5 text-sm text-muted">Every player, ranked. Tap a player to see their full progress or send a gift.</p>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 text-xs">
        <span class="text-muted">Ranked by</span>
        <UTooltip text="Prestige outranks everything: ascending resets progress, so it counts first">
          <span class="inline-flex items-center gap-1 rounded-full border border-default bg-elevated/50 px-2 py-1 font-medium">
            <span class="font-mono text-muted">1</span><UIcon name="i-lucide-crown" class="size-3.5 text-warning" />Prestige
          </span>
        </UTooltip>
        <UIcon name="i-lucide-chevron-right" class="size-3.5 text-dimmed" />
        <UTooltip text="Upgrades bought in Colony, Xeno, Polytown and Void Runner">
          <span class="inline-flex items-center gap-1 rounded-full border border-default bg-elevated/50 px-2 py-1 font-medium">
            <span class="font-mono text-muted">2</span><UIcon name="i-lucide-arrow-big-up-dash" class="size-3.5 text-primary" />Upgrades
          </span>
        </UTooltip>
        <UIcon name="i-lucide-chevron-right" class="size-3.5 text-dimmed" />
        <UTooltip text="Wallet + bank + the coin value of your gems">
          <span class="inline-flex items-center gap-1 rounded-full border border-default bg-elevated/50 px-2 py-1 font-medium">
            <span class="font-mono text-muted">3</span><UIcon name="i-lucide-wallet" class="size-3.5 text-success" />Net worth
          </span>
        </UTooltip>
      </div>
    </div>

    <LeaderboardSkeleton v-if="pending" />

    <div v-else-if="users?.length" class="space-y-6">
      <!-- The viewer's own standing -->
      <div
        v-if="myEntry"
        class="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
      >
        <div class="flex items-center gap-3">
          <div class="text-center">
            <p class="text-[10px] font-medium uppercase tracking-wide text-muted">Your rank</p>
            <p class="text-2xl font-black tabular-nums text-primary">#{{ myIndex + 1 }}</p>
          </div>
          <p class="text-xs text-muted">of {{ users.length }}</p>
        </div>
        <div class="flex items-center gap-4 text-sm">
          <div>
            <p class="text-[10px] font-medium uppercase tracking-wide text-muted">Upgrades</p>
            <p class="font-bold tabular-nums">{{ formatNumber(myEntry.totalUpgrades, false) }}</p>
          </div>
          <div>
            <p class="text-[10px] font-medium uppercase tracking-wide text-muted">Net worth</p>
            <CoinBalance :value="myEntry.totalWealth" class="font-bold" />
          </div>
        </div>
        <p class="basis-full text-sm text-muted sm:flex-1 sm:basis-auto">
          <template v-if="nextRankGap">
            <UIcon name="i-lucide-trending-up" class="mr-1 inline size-4 align-text-bottom text-primary" />{{ nextRankGap }}
          </template>
          <template v-else>
            <UIcon name="i-lucide-crown" class="mr-1 inline size-4 align-text-bottom text-warning" />You're on top. Keep it that way.
          </template>
        </p>
        <UButton size="sm" variant="soft" icon="i-lucide-locate-fixed" label="Find me" @click="scrollToMe" />
      </div>

      <!-- Podium; on phones the medal rows in the table carry the top three instead -->
      <div class="hidden gap-3 sm:grid sm:grid-cols-3">
        <button
          v-for="(u, i) in podium"
          :key="u.id"
          type="button"
          class="relative flex flex-col items-center gap-2 rounded-xl border px-4 pb-4 pt-5 text-center transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-primary"
          :class="[podiumBg[i], u.isCurrentUser ? 'ring-2 ring-primary/50' : '', i === 0 ? 'sm:order-2' : i === 1 ? 'sm:order-1 sm:mt-6' : 'sm:order-3 sm:mt-10']"
          @click="openDetails(u)"
        >
          <span class="absolute left-3 top-3 font-mono text-sm font-bold text-muted">#{{ i + 1 }}</span>
          <LeaderboardMedal :rank="i" size="absolute right-3 top-3 size-6" />
          <ProfileEmblem :emblem="u.emblem" :name="u.name" :prestige="u.prestige" :class="i === 0 ? 'size-16 text-xl' : 'size-14 text-lg'" />
          <div class="flex max-w-full items-center gap-1.5">
            <PrestigeBadge :level="u.prestige" size="xs" />
            <p class="truncate font-bold">{{ u.name }}</p>
            <LeaderboardYouBadge :show="u.isCurrentUser" />
          </div>
          <div class="grid w-full grid-cols-2 gap-2 text-sm">
            <div class="rounded-lg bg-default/60 px-2 py-1.5">
              <p class="text-[10px] uppercase tracking-wide text-muted">Upgrades</p>
              <p class="font-bold tabular-nums text-primary">{{ formatNumber(u.totalUpgrades, false) }}</p>
            </div>
            <div class="rounded-lg bg-default/60 px-2 py-1.5">
              <p class="text-[10px] uppercase tracking-wide text-muted">Net worth</p>
              <CoinBalance :value="u.totalWealth" :danger="u.totalWealth < 0" class="justify-center font-bold" />
            </div>
          </div>
        </button>
      </div>

      <!-- Full ranking -->
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-default px-4 py-2.5 text-xs text-muted">
          <span class="font-medium">Upgrades by game:</span>
          <span v-for="game in upgradeGames" :key="game.key" class="inline-flex items-center gap-1.5">
            <span class="size-2.5 rounded-sm" :class="game.bar" />{{ game.label }}
          </span>
        </div>

        <table class="w-full border-collapse text-sm">
          <thead class="border-b border-default bg-elevated/50 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" class="w-12 px-3 py-2.5 text-center">#</th>
              <th scope="col" class="px-3 py-2.5 text-left">Player</th>
              <th scope="col" class="w-[32%] px-3 py-2.5 text-left">Upgrades</th>
              <th scope="col" class="hidden px-3 py-2.5 text-right sm:table-cell">Net worth</th>
              <th scope="col" class="hidden px-3 py-2.5 text-left lg:table-cell">Wallet · Bank · Gems</th>
              <th scope="col" class="hidden px-3 py-2.5 text-left xl:table-cell">Other games</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(u, i) in users"
              :id="`lb-row-${u.id}`"
              :key="u.id"
              class="cursor-pointer border-b border-default/70 transition-colors last:border-b-0 hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
              :class="u.isCurrentUser ? 'bg-primary/10 shadow-[inset_3px_0_0_var(--ui-primary)]' : i < 3 ? rankBg[i] : ''"
              tabindex="0"
              @click="openDetails(u)"
              @keydown.enter="openDetails(u)"
              @keydown.space.prevent="openDetails(u)"
            >
              <td class="px-3 py-3 text-center">
                <LeaderboardMedal v-if="i < 3" :rank="i" size="mx-auto size-5" />
                <span v-else class="font-mono text-sm font-semibold text-muted">{{ i + 1 }}</span>
              </td>

              <td class="px-3 py-3">
                <div class="flex min-w-0 items-center gap-2.5">
                  <ProfileEmblem :emblem="u.emblem" :name="u.name" :prestige="u.prestige" class="size-9 text-sm" />
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      <p class="max-w-36 truncate font-semibold">{{ u.name }}</p>
                      <LeaderboardYouBadge :show="u.isCurrentUser" />
                    </div>
                    <div class="mt-0.5 flex items-center gap-1.5">
                      <PrestigeBadge :level="u.prestige" size="xs" />
                      <!-- Net worth moves under the name once its column is hidden -->
                      <CoinBalance :value="u.totalWealth" :danger="u.totalWealth < 0" class="text-xs text-muted sm:hidden" />
                    </div>
                  </div>
                </div>
              </td>

              <td class="px-3 py-3">
                <div class="flex items-center gap-2.5">
                  <span class="w-12 shrink-0 text-right font-bold tabular-nums text-primary">{{ formatNumber(u.totalUpgrades, false) }}</span>
                  <div class="flex h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-elevated">
                    <UTooltip
                      v-for="seg in upgradeSegments(u)"
                      :key="seg.key"
                      :text="`${seg.label}: ${formatNumber(seg.amount, false)} upgrades`"
                    >
                      <span class="h-full" :class="seg.bar" :style="{ width: `${(seg.amount / mostUpgrades) * 100}%` }" />
                    </UTooltip>
                  </div>
                </div>
              </td>

              <td class="hidden px-3 py-3 text-right sm:table-cell">
                <CoinBalance :value="u.totalWealth" :danger="u.totalWealth < 0" class="justify-end font-semibold" />
              </td>

              <td class="hidden px-3 py-3 lg:table-cell">
                <div class="flex items-center gap-3 whitespace-nowrap text-xs text-muted">
                  <UTooltip :text="u.inDebt ? 'Wallet — this player owes the bank' : 'Wallet'"><CoinBalance :value="u.balance" :danger="u.inDebt" /></UTooltip>
                  <UTooltip text="Bank"><BankBalance :value="u.bankBalance" /></UTooltip>
                  <UTooltip :text="`Gems, worth ${formatNumber(u.gemValue, false)} coins`"><GemBalance :value="u.gems" /></UTooltip>
                  <UTooltip v-if="u.bailoutActive" :text="`Took a bank bail-out — ${formatNumber(u.bailoutRemaining, false, 2)} still being levied back`">
                    <UIcon name="i-lucide-life-buoy" class="size-4 shrink-0 text-warning" />
                  </UTooltip>
                </div>
              </td>

              <td class="hidden px-3 py-3 xl:table-cell">
                <div class="flex items-center gap-3 whitespace-nowrap text-xs tabular-nums text-muted">
                  <UTooltip text="HackOps power">
                    <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-shield" class="size-3.5 text-primary" />{{ formatNumber(u.hackPower) }}</span>
                  </UTooltip>
                  <UTooltip :text="`Battler — ${u.battlerRating == null ? 'unrated' : `${u.battlerRating} Elo`}, ${u.battlerRunsWon} runs won, ${u.battlerBattlesWon}–${u.battlerBattlesLost} in battles`">
                    <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-swords" class="size-3.5 text-secondary" />{{ u.battlerRating ?? '—' }}</span>
                  </UTooltip>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </UCard>
    </div>

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
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <p class="truncate font-semibold">{{ selectedUser.name }}</p>
                <PrestigeBadge :level="selectedUser.prestige" size="sm" />
              </div>
              <p class="text-xs text-muted">Rank #{{ selectedRank }} of {{ users?.length ?? 0 }}</p>
            </div>
            <UButton :to="`/players/${selectedUser.id}`" icon="i-lucide-external-link" size="xs" variant="soft" color="neutral" label="Profile" />
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="rounded-lg border border-default bg-elevated/40 p-3">
              <p class="text-[10px] font-medium uppercase tracking-wide text-muted">Upgrades</p>
              <p class="text-lg font-bold tabular-nums text-primary">{{ formatNumber(selectedUser.totalUpgrades, false) }}</p>
            </div>
            <div class="rounded-lg border border-default bg-elevated/40 p-3">
              <p class="text-[10px] font-medium uppercase tracking-wide text-muted">Net worth</p>
              <CoinBalance :value="selectedUser.totalWealth" :danger="selectedUser.totalWealth < 0" class="text-lg font-bold" />
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2 text-sm font-semibold">
            <div class="rounded-lg border border-default p-2.5">
              <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">Wallet</p>
              <CoinBalance :value="selectedUser.balance" :danger="selectedUser.inDebt" />
            </div>
            <div class="rounded-lg border border-default p-2.5">
              <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">Bank</p>
              <BankBalance :value="selectedUser.bankBalance" />
            </div>
            <div class="rounded-lg border border-default p-2.5">
              <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">Gems</p>
              <GemBalance :value="selectedUser.gems" />
              <p class="mt-0.5 text-[10px] font-normal text-muted">≈ {{ formatNumber(selectedUser.gemValue) }} coins</p>
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
            <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Upgrades by game</p>
            <div class="grid gap-2 sm:grid-cols-2">
              <div v-for="group in detailGroups" :key="group.key" class="rounded-lg border border-default bg-elevated/40 p-3">
                <div class="mb-2 flex items-center gap-2">
                  <UIcon :name="group.icon" class="size-4" :class="group.text" />
                  <span class="flex-1 text-sm font-semibold">{{ group.label }}</span>
                  <span class="font-bold tabular-nums" :class="group.text">{{ formatNumber(group.total, false) }}</span>
                </div>
                <div class="space-y-1 text-xs">
                  <div v-for="row in group.rows" :key="row.label" class="flex items-center gap-2 text-muted">
                    <UIcon :name="row.icon" class="size-3.5" />
                    <span class="flex-1">{{ row.label }}</span>
                    <span class="font-semibold tabular-nums text-default">{{ formatNumber(row.value, false) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Other games <span class="normal-case tracking-normal">(not ranked)</span></p>
            <div class="divide-y divide-default overflow-hidden rounded-lg border border-default">
              <div class="flex items-center gap-3 bg-elevated/40 px-3 py-2.5">
                <UIcon name="i-lucide-shield" class="size-4 text-primary" />
                <span class="flex-1 text-sm">HackOps power</span>
                <span class="font-semibold tabular-nums">{{ formatNumber(selectedUser.hackPower, false) }}</span>
              </div>
              <div class="flex items-center gap-3 bg-elevated/40 px-3 py-2.5">
                <UIcon name="i-lucide-swords" class="size-4 text-secondary" />
                <span class="flex-1 text-sm">Battler rating</span>
                <span class="text-xs text-muted">{{ selectedUser.battlerBattlesWon }}–{{ selectedUser.battlerBattlesLost }} · {{ selectedUser.battlerRunsWon }} runs won</span>
                <span class="font-semibold tabular-nums">{{ selectedUser.battlerRating ?? '—' }}</span>
              </div>
              <div class="flex items-center gap-3 bg-elevated/40 px-3 py-2.5">
                <UIcon name="i-lucide-bot" class="size-4 text-info" />
                <span class="flex-1 text-sm">AI prompts used</span>
                <span class="font-semibold tabular-nums">{{ formatNumber(selectedUser.aiPromptsUsed, false) }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
