<script setup lang="ts">
import { PRESTIGE_TIERS, nextPrestigeTier, prestigeTier } from '#shared/utils/prestige'

const { user, fetchSession } = useAuth()
const toast = useToast()

// Lazy so the profile page paints immediately — every field this drives has a
// null-safe fallback below, and the numbers that gate the button (balance,
// gems, level) come from the session, not from here.
const { data: state, refresh } = useLazyFetch('/api/prestige')

const level = computed(() => user.value?.prestige ?? 0)
const tokens = computed(() => user.value?.prestigeTokens ?? 0)
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

const current = computed(() => prestigeTier(level.value))
const next = computed(() => nextPrestigeTier(level.value))
const blockers = computed(() => state.value?.blockers ?? [])

const affordable = computed(() =>
  !!next.value && balance.value >= next.value.coinCost && gems.value >= next.value.gemCost
)

/**
 * One bar per currency. A single worst-case bar hid which of the two was
 * actually short — at 18M coins against 11 gems both read as "0%", and a
 * player sitting on the full gem price still saw an empty bar.
 */
const progressBars = computed(() => {
  if (!next.value) return []
  return [
    {
      key: 'coins',
      label: 'coins',
      icon: 'i-lucide-coins',
      have: balance.value,
      need: next.value.coinCost,
      color: 'warning' as const
    },
    {
      key: 'gems',
      label: 'gems',
      icon: 'i-lucide-gem',
      have: gems.value,
      need: next.value.gemCost,
      color: 'info' as const
    }
  ].map(bar => ({
    ...bar,
    met: bar.have >= bar.need,
    // Clamped so an overshoot renders as a full bar, not an overflowing one.
    pct: Math.min(100, (bar.have / bar.need) * 100)
  }))
})

function tierState(tierLevel: number) {
  if (tierLevel <= level.value) return 'owned'
  if (tierLevel === level.value + 1) return 'next'
  return 'locked'
}

const confirmOpen = ref(false)
const confirmText = ref('')
const ascending = ref(false)

watch(confirmOpen, (open) => {
  if (open) confirmText.value = ''
})

async function ascend() {
  if (!next.value) return
  ascending.value = true
  try {
    const result = await $fetch('/api/prestige', { method: 'POST' })
    await Promise.all([fetchSession(), refresh()])
    confirmOpen.value = false
    toast.add({
      title: `Prestige ${prestigeTier(result.level)?.roman} — ${prestigeTier(result.level)?.name}`,
      description: `Everything is gone. Your prestige tokens are restored to ${result.tokens}.`,
      color: 'success',
      icon: 'i-lucide-crown',
      duration: 10_000
    })
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Prestige failed'), color: 'error' })
  } finally {
    ascending.value = false
  }
}
</script>

<template>
  <UCard
    :ui="{ body: 'space-y-5' }"
    class="relative overflow-hidden"
  >
    <!-- Ambient wash in the current tier's colour so the card itself levels up -->
    <div
      v-if="current"
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 opacity-[0.07]"
      :style="{ backgroundImage: current.badge }"
    />

    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <ProfileEmblem
            :emblem="user?.emblem"
            :name="user?.name"
            :prestige="level"
            class="size-11 text-base"
          />
          <div>
            <div class="flex items-center gap-2">
              <h2 class="font-semibold">Prestige</h2>
              <PrestigeBadge :level="level" size="md" />
            </div>
            <p class="text-xs text-muted mt-0.5">
              {{ current ? current.name : 'Unranked' }} — burn it all down for a permanent mark
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1.5 rounded-lg border border-default bg-elevated/60 px-3 py-1.5">
            <UIcon name="i-lucide-coins" class="size-4 text-amber-400" />
            <span class="text-sm font-semibold">{{ tokens }}</span>
            <span class="text-xs text-muted">token{{ tokens === 1 ? '' : 's' }}</span>
          </div>
          <UButton
            to="/prestige-shop"
            color="neutral"
            variant="outline"
            icon="i-lucide-store"
            label="Shop"
          />
        </div>
      </div>
    </template>

    <!-- Tier track -->
    <div class="relative grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div
        v-for="tier in PRESTIGE_TIERS"
        :key="tier.level"
        class="relative flex flex-col gap-3 overflow-hidden rounded-xl border p-4 transition-all"
        :class="[
          tierState(tier.level) === 'owned' ? 'border-transparent' : 'border-default',
          tierState(tier.level) === 'locked' ? 'opacity-45' : '',
          tierState(tier.level) === 'next' ? 'ring-1 ring-primary/40' : ''
        ]"
        :style="tierState(tier.level) === 'owned'
          ? { boxShadow: `inset 0 0 0 1px ${tier.accent}66, 0 0 20px -8px ${tier.accent}` }
          : undefined"
      >
        <div
          v-if="tierState(tier.level) === 'owned'"
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 opacity-10"
          :style="{ backgroundImage: tier.badge }"
        />

        <div class="relative flex items-center justify-between gap-2">
          <!-- Live preview of the ring this tier grants -->
          <span class="relative inline-flex size-12 shrink-0 items-center justify-center">
            <span
              aria-hidden="true"
              class="absolute -inset-[9%] rounded-full"
              :class="tierState(tier.level) === 'owned' ? 'animate-spin motion-reduce:animate-none' : ''"
              :style="{ background: tier.ring, animationDuration: `${tier.spinSeconds}s` }"
            />
            <span class="relative flex size-full items-center justify-center rounded-full bg-default font-bold">
              {{ tier.roman }}
            </span>
          </span>

          <UIcon
            v-if="tierState(tier.level) === 'owned'"
            name="i-lucide-badge-check"
            class="size-5"
            :style="{ color: tier.accent }"
          />
          <UIcon
            v-else-if="tierState(tier.level) === 'locked'"
            name="i-lucide-lock"
            class="size-4 text-muted"
          />
        </div>

        <div class="relative min-w-0">
          <p class="font-semibold" :style="{ color: tier.accent }">{{ tier.name }}</p>
          <p class="mt-1 text-xs leading-relaxed text-muted">{{ tier.tagline }}</p>
        </div>

        <div class="relative mt-auto space-y-1.5 border-t border-default pt-3 text-sm">
          <CoinBalance :value="tier.coinCost" class="font-semibold" />
          <GemBalance :value="tier.gemCost" class="font-semibold" />
          <div class="flex items-center gap-1.5 text-xs text-muted">
            <UIcon name="i-lucide-crown" class="size-3.5" :style="{ color: tier.accent }" />
            {{ tier.tokens }} tokens to spend
          </div>
        </div>
      </div>
    </div>

    <!-- Call to action -->
    <div v-if="next" class="relative space-y-3 rounded-xl border border-default bg-elevated/40 p-4">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-semibold">
            Next: {{ next.name }}
            <span class="text-muted">— Prestige {{ next.roman }}</span>
          </p>
          <p class="mt-1 text-xs text-muted">
            Wipes your wallet, bank, gems and every game's progress across
            {{ state?.systemsCleared ?? 0 }} systems. Your emblem, chat history and
            prestige level are kept.
          </p>
        </div>
        <UButton
          size="lg"
          icon="i-lucide-flame"
          label="Ascend"
          :disabled="!affordable || blockers.length > 0"
          @click="confirmOpen = true"
        />
      </div>

      <!-- One bar per currency: both have to be full to ascend, and a shared
           bar could not show which of the two was the one holding you back. -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div
          v-for="bar in progressBars"
          :key="bar.key"
          class="space-y-1.5"
        >
          <div class="flex items-center justify-between gap-2 text-xs">
            <span class="flex items-center gap-1.5 text-muted">
              <UIcon :name="bar.icon" class="size-3.5" />
              {{ bar.label }}
            </span>
            <span
              class="font-mono tabular-nums"
              :class="bar.met ? 'text-success' : 'text-muted'"
            >
              {{ formatNumber(bar.have) }} / {{ formatNumber(bar.need) }}
              <UIcon
                v-if="bar.met"
                name="i-lucide-check"
                class="ml-0.5 size-3.5 align-[-2px]"
              />
            </span>
          </div>
          <UProgress
            :model-value="bar.pct"
            size="sm"
            :color="bar.met ? 'success' : bar.color"
          />
        </div>
      </div>

      <UAlert
        v-for="blocker in blockers"
        :key="blocker.code"
        color="warning"
        variant="soft"
        icon="i-lucide-triangle-alert"
        :description="blocker.message"
      />
    </div>

    <div
      v-else
      class="relative rounded-xl border p-5 text-center"
      :style="{ borderColor: `${current?.accent}66` }"
    >
      <UIcon name="i-lucide-infinity" class="size-7" :style="{ color: current?.accent }" />
      <p class="mt-2 font-semibold" :style="{ color: current?.accent }">Eternal</p>
      <p class="mt-1 text-sm text-muted">
        You have reached the highest prestige. There is nothing above this.
      </p>
    </div>

    <!-- Confirmation -->
    <UModal v-model:open="confirmOpen" :title="`Ascend to Prestige ${next?.roman ?? ''}`">
      <template #body>
        <div class="space-y-4 text-sm">
          <UAlert
            color="error"
            variant="soft"
            icon="i-lucide-flame"
            title="This cannot be undone"
            description="Every coin, gem, level, item, upgrade, bug, plant, agent, ship and open market offer on this account is deleted permanently."
          />

          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-lg border border-default p-3">
              <p class="text-xs font-semibold uppercase tracking-wide text-error">Destroyed</p>
              <ul class="mt-2 space-y-1 text-xs text-muted">
                <li>Wallet &amp; bank balance</li>
                <li>All gems and market offers</li>
                <li>Every game's progress</li>
                <li>Rakeback balance</li>
              </ul>
            </div>
            <div class="rounded-lg border border-default p-3">
              <p class="text-xs font-semibold uppercase tracking-wide text-success">Kept</p>
              <ul class="mt-2 space-y-1 text-xs text-muted">
                <li>Your emblem &amp; name</li>
                <li>Chat &amp; AI history</li>
                <li>Prestige level and ring</li>
                <li>Tokens reset to {{ next?.tokens }} (shop perks refunded)</li>
              </ul>
            </div>
          </div>

          <UFormField label="Type ASCEND to confirm">
            <UInput v-model="confirmText" placeholder="ASCEND" class="w-full" autocomplete="off" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="outline" @click="confirmOpen = false" />
          <UButton
            label="Burn it all"
            icon="i-lucide-flame"
            color="error"
            :loading="ascending"
            :disabled="confirmText.trim().toUpperCase() !== 'ASCEND'"
            @click="ascend"
          />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
