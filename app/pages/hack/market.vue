<script setup lang="ts">
import type { AgentPullTier, ItemPullTier } from '#shared/utils/hack-config'
import { AGENT_PULL_CONTACT, ITEM_PULL_SELLER } from '~/utils/hack-content'

const { user, fetchSession } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)
const { data: state, refresh } = await useFetch('/api/hack/state')
const audio = useAudio('hack')

const route = useRoute()
const section = ref<'contacts' | 'drops'>('contacts')

// Handle tab query parameter from Loadout redirect
onMounted(() => {
  if (route.query.tab === 'gear') {
    section.value = 'drops'
  }
})

function canAfford(tier: { currency?: string, cost: number }) {
  return tier.currency === 'gems' ? gems.value >= tier.cost : balance.value >= tier.cost
}

const rosterFull = computed(() => !!state.value && state.value.totalAgents >= state.value.maxAgents)
const inventoryFull = computed(() => !!state.value && state.value.inventoryCount >= state.value.maxInventorySlots)

const activeRecruitTier = ref<AgentPullTier | null>(null)
const recruitOpen = computed({
  get: () => activeRecruitTier.value !== null,
  set: (v: boolean) => { if (!v) activeRecruitTier.value = null }
})
function openRecruit(tier: AgentPullTier) {
  audio.playSfx('click-soft')
  activeRecruitTier.value = tier
}

const activeCrateTier = ref<ItemPullTier | null>(null)
const crateOpen = computed({
  get: () => activeCrateTier.value !== null,
  set: (v: boolean) => { if (!v) activeCrateTier.value = null }
})
function openCrate(tier: ItemPullTier) {
  audio.playSfx('click-soft')
  activeCrateTier.value = tier
}

async function onRecruited() {
  await Promise.all([refresh(), fetchSession()])
}
async function onPulled() {
  await Promise.all([refresh(), fetchSession()])
}
</script>

<template>
  <div class="p-4 sm:p-6 max-w-6xl mx-auto">
    <div class="flex items-start justify-between gap-4 flex-wrap mb-5">
      <div>
        <h2 class="hack-eyebrow">
          // black market
        </h2>
        <h1 class="text-2xl font-bold mt-1.5">
          Contacts &amp; dead drops
        </h1>
        <p class="text-sm text-muted mt-1">
          Every listing here comes through RELAY. Nobody talks to a seller directly.
        </p>
      </div>
      <div class="hack-seg">
        <button
          type="button"
          :class="section === 'contacts' && 'active'"
          @click="section = 'contacts'"
        >
          Contacts (Agents)
        </button>
        <button
          type="button"
          :class="section === 'drops' && 'active'"
          @click="section = 'drops'"
        >
          Dead Drops (Gear)
        </button>
      </div>
    </div>

    <p
      v-if="section === 'contacts' && rosterFull"
      class="text-sm text-warning mb-4"
    >
      Storage full ({{ state?.maxAgents }} agents) — fire an agent before recruiting another.
    </p>
    <p
      v-if="section === 'drops' && inventoryFull"
      class="text-sm text-warning mb-4"
    >
      Inventory full ({{ state?.maxInventorySlots }}) — sell an item before buying another crate.
    </p>

    <!-- Contacts -->
    <div
      v-if="section === 'contacts'"
      class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
    >
      <HackFrame
        v-for="tier in state?.agentPullTiers"
        :key="tier.id"
        class="hack-contact-card"
        :class="tier.id === 'elite' && 'hack-frame-accent'"
        role="button"
        tabindex="0"
        @click="openRecruit(tier)"
        @keydown.enter.space.prevent="openRecruit(tier)"
      >
        <div class="hack-contact-portrait">
          <img
            :src="AGENT_PULL_CONTACT[tier.id]?.portrait"
            :alt="`Contact: ${AGENT_PULL_CONTACT[tier.id]?.handle}`"
          >
        </div>
        <div class="p-4">
          <div class="flex items-center justify-between">
            <b>{{ tier.name }}</b>
            <span class="mono text-yellow-400">${{ formatNumber(tier.cost, true) }}</span>
          </div>
          <p class="hack-eyebrow mt-1 mb-2 normal-case tracking-normal">
            contact: {{ AGENT_PULL_CONTACT[tier.id]?.handle }}
          </p>
          <p class="text-sm text-muted leading-snug">
            {{ tier.description }}
          </p>
          <HackOddsBar
            class="mt-2.5"
            :weights="tier.weights"
          />
        </div>
      </HackFrame>
    </div>

    <!-- Dead Drops -->
    <div
      v-else
      class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
    >
      <HackFrame
        v-for="tier in state?.itemPullTiers"
        :key="tier.id"
        class="hack-contact-card"
        :class="tier.id === 'ghost_cache' && 'hack-frame-accent'"
        role="button"
        tabindex="0"
        @click="openCrate(tier)"
        @keydown.enter.space.prevent="openCrate(tier)"
      >
        <div class="hack-contact-portrait">
          <img
            :src="ITEM_PULL_SELLER[tier.id]?.portrait"
            :alt="`Seller: ${ITEM_PULL_SELLER[tier.id]?.handle}`"
          >
        </div>
        <div class="p-4">
          <div class="flex items-center justify-between">
            <b>{{ tier.name }}</b>
            <span class="mono text-yellow-400">${{ formatNumber(tier.cost, true) }}</span>
          </div>
          <p class="hack-eyebrow mt-1 mb-2 normal-case tracking-normal">
            seller: {{ ITEM_PULL_SELLER[tier.id]?.handle }}
          </p>
          <p class="text-sm text-muted leading-snug">
            {{ tier.description }}
          </p>
          <HackOddsBar
            class="mt-2.5"
            :weights="tier.weights"
          />
        </div>
      </HackFrame>
    </div>

    <HackRecruitOpening
      v-if="activeRecruitTier"
      v-model:open="recruitOpen"
      :tier="activeRecruitTier"
      :disabled="!canAfford(activeRecruitTier) || rosterFull"
      :disabled-reason="rosterFull ? `Storage full (${state?.maxAgents} agents) — fire an agent first.` : !canAfford(activeRecruitTier) ? 'Not enough balance.' : undefined"
      @recruited="onRecruited"
    />
    <HackCrateOpening
      v-if="activeCrateTier"
      v-model:open="crateOpen"
      :tier="activeCrateTier"
      :disabled="!canAfford(activeCrateTier) || inventoryFull"
      :disabled-reason="inventoryFull ? `Inventory full (${state?.maxInventorySlots}) — sell an item first.` : !canAfford(activeCrateTier) ? 'Not enough balance.' : undefined"
      @pulled="onPulled"
    />
  </div>
</template>
