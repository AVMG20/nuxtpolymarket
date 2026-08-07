<script setup lang="ts">
import { wrapUrl } from '~/utils/tcg/wrap'

const { user } = useAuth()
const { sets, prices, allowance, bundle, call } = useTcg()

const apiBase = (useRuntimeConfig().public as { pokemonApiBase?: string }).pokemonApiBase
  ?? 'http://127.0.0.1:8080'

function packArt(plaatjesSetCode: string | null): string | null {
  return wrapUrl(apiBase, plaatjesSetCode)
}

// A set whose wrap the sidecar does not have just shows text, like before.
function hideBrokenArt(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none'
}

const gems = computed(() => user.value?.gems ?? 0)

// Live countdown ticker (hack/index.vue pattern)
const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  onUnmounted(() => clearInterval(t))
})

function msLeft(at: string | Date) {
  return Math.max(0, new Date(at).getTime() - now.value)
}
function formatMs(ms: number) {
  if (ms <= 0) return 'Done'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

// ── Buying pairs ────────────────────────────────────────────────────────────
const buying = ref<string | null>(null)

function buyDisabledReason(set: { id: string, remaining: number }, pairs: number): string | null {
  const p = prices.value
  if (!p) return 'Loading…'
  const packs = pairs * p.packsPerPair
  const cost = pairs * p.gemsPerPair
  if ((allowance.value?.remaining ?? 0) < packs) return 'Daily allowance exhausted'
  if (gems.value < cost) return `Not enough gems (needs ${cost})`
  if (set.remaining < packs) return 'Not enough packs left in this set'
  return null
}

async function buy(set: { id: string, name: string }, pairs: number) {
  const packs = pairs * (prices.value?.packsPerPair ?? 2)
  buying.value = `${set.id}:${pairs}`
  try {
    await call('/api/tcg/buy-packs', { setId: set.id, pairs }, `Bought ${packs} ${set.name} packs`)
  } catch {
    // toasted by call()
  } finally {
    buying.value = null
  }
}

// ── Friday bundle ───────────────────────────────────────────────────────────
const bundleSetId = ref<string | undefined>(undefined)
const claiming = ref(false)

const bundleSetOptions = computed(() =>
  sets.value.map(s => ({ label: `${s.name} (${s.code})`, value: s.id })))

const claimDisabledReason = computed(() => {
  const p = prices.value
  if (!p) return 'Loading…'
  if (!bundleSetId.value) return 'Pick a set first'
  if (gems.value < p.bundleGems) return `Not enough gems (needs ${p.bundleGems})`
  const set = sets.value.find(s => s.id === bundleSetId.value)
  if (set && set.remaining < p.bundlePacks) return 'Not enough packs left in this set'
  return null
})

async function claim() {
  if (!bundleSetId.value) return
  claiming.value = true
  try {
    await call('/api/tcg/claim-bundle', { setId: bundleSetId.value }, `Bundle claimed — ${prices.value?.bundlePacks ?? 36} packs`)
  } catch {
    // toasted by call()
  } finally {
    claiming.value = false
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-4 p-4">
    <!-- Daily allowance -->
    <UCard v-if="allowance && prices">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-3">
          <UIcon
            name="i-lucide-calendar-clock"
            class="size-5 text-primary"
          />
          <div>
            <p class="font-medium text-highlighted">
              {{ allowance.boughtToday }}/{{ prices.dailyPacks }} packs today
            </p>
            <p class="text-xs text-muted">
              Resets in {{ formatMs(msLeft(allowance.resetsAt)) }}
            </p>
          </div>
        </div>
        <UProgress
          :model-value="allowance.boughtToday"
          :max="prices.dailyPacks"
          color="primary"
          size="md"
          class="w-40"
        />
      </div>
    </UCard>

    <!-- Friday bundle -->
    <UCard v-if="bundle && prices">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <UIcon
            name="i-lucide-gift"
            class="size-5 text-primary"
          />
          <div>
            <p class="font-medium text-highlighted">
              Weekend bundle
            </p>
            <p
              v-if="!bundle.windowOpen"
              class="text-xs text-muted"
            >
              Next window in {{ formatMs(msLeft(bundle.nextWindowAt)) }}
            </p>
            <p
              v-else-if="bundle.windowEndsAt"
              class="text-xs text-muted"
            >
              Closes in {{ formatMs(msLeft(bundle.windowEndsAt)) }}
            </p>
          </div>
        </div>

        <UBadge
          v-if="bundle.windowOpen && bundle.claimedThisWeek"
          color="success"
          variant="subtle"
          icon="i-lucide-check"
        >
          Claimed this week
        </UBadge>

        <div
          v-else-if="bundle.windowOpen"
          class="flex flex-wrap items-center gap-2"
        >
          <USelect
            v-model="bundleSetId"
            :items="bundleSetOptions"
            placeholder="Choose a set"
            size="sm"
            class="min-w-48"
          />
          <UTooltip
            :text="claimDisabledReason ?? undefined"
            :disabled="!claimDisabledReason"
          >
            <UButton
              size="sm"
              icon="i-lucide-gift"
              :disabled="!!claimDisabledReason"
              :loading="claiming"
              @click="claim"
            >
              Claim bundle · {{ prices.bundlePacks }} packs · {{ prices.bundleGems }} gems
            </UButton>
          </UTooltip>
        </div>
      </div>
    </UCard>

    <!-- Live sets -->
    <div
      v-if="sets.length"
      class="grid gap-4 sm:grid-cols-2"
    >
      <UCard
        v-for="set in sets"
        :key="set.id"
      >
        <div class="flex gap-4">
          <img
            v-if="packArt(set.plaatjesSetCode)"
            :src="packArt(set.plaatjesSetCode)!"
            :alt="`${set.name} booster pack`"
            class="h-28 w-auto shrink-0 self-center drop-shadow-md"
            @error="hideBrokenArt"
          >
          <div class="min-w-0 flex-1 space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="font-medium text-highlighted">
                  {{ set.name }}
                </p>
                <p class="text-xs text-muted">
                  {{ set.cardCount }} cards · {{ set.printingCount }} printings
                </p>
              </div>
              <UBadge
                color="neutral"
                variant="subtle"
                class="font-mono"
              >
                {{ set.code }}
              </UBadge>
            </div>

            <div
              v-if="set.targetPackCount"
              class="flex items-center gap-2"
            >
              <UProgress
                :model-value="set.remaining"
                :max="set.targetPackCount"
                color="primary"
                size="sm"
                class="flex-1"
              />
              <span class="whitespace-nowrap text-xs tabular-nums text-muted">
                {{ formatNumber(set.remaining, false) }} packs left
              </span>
            </div>

            <div
              v-if="prices"
              class="flex gap-2"
            >
              <UTooltip
                v-for="pairs in [1, 2]"
                :key="pairs"
                :text="buyDisabledReason(set, pairs) ?? undefined"
                :disabled="!buyDisabledReason(set, pairs)"
              >
                <UButton
                  size="sm"
                  :variant="pairs === 1 ? 'solid' : 'soft'"
                  icon="i-lucide-package-plus"
                  :disabled="!!buyDisabledReason(set, pairs)"
                  :loading="buying === `${set.id}:${pairs}`"
                  @click="buy(set, pairs)"
                >
                  Buy {{ pairs * prices.packsPerPair }} packs · {{ pairs * prices.gemsPerPair }} gem{{ pairs * prices.gemsPerPair > 1 ? 's' : '' }}
                </UButton>
              </UTooltip>
            </div>
          </div>
        </div>
      </UCard>
    </div>
    <UCard v-else>
      <p class="text-sm text-muted">
        No sets on sale yet — check back soon.
      </p>
    </UCard>
  </div>
</template>
