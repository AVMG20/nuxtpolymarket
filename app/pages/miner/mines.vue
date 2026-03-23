<script setup lang="ts">
const { fetchSession, user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const { data: state, refresh } = await useFetch('/api/miner/state')
const toast = useToast()

type GameResult = { tiles: number[], revealed: number, reward: number, isBomb: boolean, playsRemaining: number }

const gameResult = ref<GameResult | null>(null)
const playsRemaining = ref(0)

watch(
  () => state.value?.minesPlaysRemaining,
  (v) => { if (v !== undefined) playsRemaining.value = v },
  { immediate: true },
)

const playing = ref(false)
const buying = ref(false)
const buyingExtraPlay = ref(false)

async function playTile(tileIndex: number) {
  if (playing.value || playsRemaining.value <= 0) return
  playing.value = true
  try {
    const res = await $fetch('/api/miner/mines/play', { method: 'POST', body: { tileIndex } })
    gameResult.value = res
    playsRemaining.value = res.playsRemaining
    if (res.isBomb) {
      toast.add({ title: 'You hit the bomb! No reward.', color: 'error', icon: 'i-lucide-bomb' })
    } else {
      toast.add({ title: `+$${formatNumber(res.reward, false)} collected!`, color: 'success', icon: 'i-lucide-coins' })
      await fetchSession()
    }
  } catch (e: any) {
    toast.add({ title: e.data?.message ?? 'Play failed', color: 'error' })
  } finally {
    playing.value = false
  }
}

function playAgain() {
  gameResult.value = null
}

async function buyExtraPlay() {
  buyingExtraPlay.value = true
  try {
    const res = await $fetch('/api/miner/shop/extra-play', { method: 'POST' })
    playsRemaining.value += 1
    toast.add({ title: 'Extra play granted!', color: 'success', icon: 'i-lucide-plus-circle' })
    await fetchSession()
  } catch (e: any) {
    toast.add({ title: e.data?.message ?? 'Purchase failed', color: 'error' })
  } finally {
    buyingExtraPlay.value = false
  }
}

async function buyMine() {
  buying.value = true
  try {
    const res = await $fetch('/api/miner/mines/buy', { method: 'POST' })
    toast.add({ title: `Mine #${res.newCount} unlocked!`, color: 'success', icon: 'i-lucide-mountain' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.message ?? 'Purchase failed', color: 'error' })
  } finally {
    buying.value = false
  }
}

function tileValueColor(value: number) {
  if (value === 0) return 'error'
  if (value === 1000) return 'primary'
  if (value >= 450) return 'secondary'
  return 'neutral'
}
</script>

<template>
  <UContainer class="space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold">Mines</h1>
      <p class="text-sm text-muted mt-0.5">Reveal a tile — hit cash or a bomb.</p>
    </div>

    <div v-if="!state" class="space-y-4">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <USkeleton class="h-28 rounded-xl" />
        <USkeleton class="h-28 rounded-xl" />
      </div>
      <USkeleton class="h-80 rounded-xl" />
    </div>

    <template v-else>
      <!-- Info row -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Buy Mine -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="size-8 rounded-lg bg-primary/15 flex items-center justify-center">
                  <UIcon name="i-lucide-mountain" class="size-4 text-primary" />
                </div>
                <div>
                  <p class="font-semibold text-sm">Mine Slots</p>
                  <p class="text-xs text-muted">More slots = more daily plays</p>
                </div>
              </div>
              <span class="text-2xl font-bold">{{ state.minesCount }}<span class="text-muted text-base font-normal">/{{ state.minesMaxCount }}</span></span>
            </div>
          </template>
          <UButton
            label="Buy Mine"
            icon="i-lucide-plus"
            block
            color="primary"
            :loading="buying"
            :disabled="state.minesCount >= state.minesMaxCount || balance < state.minesNextCost"
            @click="buyMine"
          >
            <template #trailing>
              <span class="text-xs opacity-70">
                {{ state.minesCount >= state.minesMaxCount ? 'Max reached' : `Cost: $${formatNumber(state.minesNextCost, false)}` }}
              </span>
            </template>
          </UButton>
        </UCard>

        <!-- Daily Plays -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="size-8 rounded-lg bg-secondary/15 flex items-center justify-center">
                  <UIcon name="i-lucide-calendar-days" class="size-4 text-secondary" />
                </div>
                <div>
                  <p class="font-semibold text-sm">Daily Plays</p>
                  <p class="text-xs text-muted">Resets every day — one play per mine</p>
                </div>
              </div>
              <span class="text-2xl font-bold" :class="playsRemaining > 0 ? 'text-primary' : 'text-muted'">
                {{ playsRemaining }}<span class="text-muted text-base font-normal">/{{ state.minesCount }}</span>
              </span>
            </div>
          </template>
          <div class="h-2 rounded-full bg-elevated overflow-hidden">
            <div
              class="h-full bg-primary rounded-full transition-all"
              :style="{ width: `${state.minesCount > 0 ? (playsRemaining / state.minesCount) * 100 : 0}%` }"
            />
          </div>
          <p class="text-xs text-muted mt-2">
            {{ playsRemaining > 0 ? `${playsRemaining} play${playsRemaining !== 1 ? 's' : ''} remaining today` : 'All plays used — come back tomorrow' }}
          </p>
        </UCard>


        <!-- Filler -->
        <div></div>

        <!-- Extra Play -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2.5">
              <div class="size-8 rounded-lg bg-secondary/15 flex items-center justify-center">
                <UIcon name="i-lucide-plus-circle" class="size-4 text-secondary" />
              </div>
              <div>
                <p class="font-semibold text-sm">Extra Play</p>
                <p class="text-xs text-muted">Restore 1 used play — costs 1 gem.</p>
              </div>
            </div>
          </template>
          <UButton
              label="Buy Extra Play"
              icon="i-lucide-plus-circle"
              block
              color="secondary"
              :loading="buyingExtraPlay"
              :disabled="(user?.gems ?? 0) < 1 || playsRemaining >= (state?.minesCount ?? 0)"
              @click="buyExtraPlay"
          >
            <template #trailing>
              <span class="text-xs opacity-70">Cost: 1 gem</span>
            </template>
          </UButton>
        </UCard>
      </div>

      <!-- Single game — full width -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-mountain" class="size-4 text-primary" />
              <p class="font-semibold text-sm">Mine</p>
            </div>
            <UBadge
              v-if="gameResult"
              :label="gameResult.isBomb ? 'Bomb!' : `+$${formatNumber(gameResult.reward, false)}`"
              :color="gameResult.isBomb ? 'error' : 'success'"
              variant="subtle"
            />
            <UBadge v-else-if="playsRemaining > 0" label="Ready" color="primary" variant="subtle" />
            <UBadge v-else label="No plays left" color="neutral" variant="subtle" />
          </div>
        </template>

        <!-- 3×3 tile grid -->
        <div class="grid grid-cols-3 gap-3 mb-4">
          <template v-if="!gameResult">
            <UButton
              v-for="tileIndex in 9"
              :key="tileIndex"
              color="neutral"
              variant="soft"
              :loading="playing"
              :disabled="playsRemaining <= 0 || playing"
              class="h-24 flex flex-col items-center justify-center gap-1"
              @click="playTile(tileIndex - 1)"
            >
              <UIcon name="i-lucide-gem" class="size-6" />
            </UButton>
          </template>
          <template v-else>
            <UButton
              v-for="tileIndex in 9"
              :key="tileIndex"
              :color="tileValueColor(gameResult.tiles[tileIndex - 1]!)"
              :variant="tileIndex - 1 === gameResult.revealed ? 'solid' : 'soft'"
              disabled
              class="h-24 flex flex-col items-center justify-center gap-1 pointer-events-none"
            >
              <template v-if="gameResult.tiles[tileIndex - 1] === 0">
                <UIcon name="i-lucide-bomb" class="size-6" />
              </template>
              <template v-else>
                <UIcon name="i-lucide-coins" class="size-5" />
                <span class="text-xs font-semibold leading-none">${{ formatNumber(gameResult.tiles[tileIndex - 1]!, false) }}</span>
              </template>
            </UButton>
          </template>
        </div>

        <UButton
            :label="!gameResult ? 'Game active — click any tile' : playsRemaining <= 0 ? 'No plays remaining today' : 'Play Again'"
            :icon="gameResult && playsRemaining > 0 ? 'i-lucide-refresh-cw' : undefined"
            :color="gameResult && playsRemaining > 0 ? 'primary' : 'neutral'"
            :variant="gameResult && playsRemaining > 0 ? 'solid' : 'soft'"
            block
            :disabled="!gameResult || playsRemaining <= 0"
            @click="gameResult && playsRemaining > 0 && playAgain()"
        />
      </UCard>

    </template>
  </UContainer>
</template>
