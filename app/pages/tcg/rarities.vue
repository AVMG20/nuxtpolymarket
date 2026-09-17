<script setup lang="ts">
/**
 * The rarity reference (§5.2): the ladder as era-scoped data — symbol,
 * ordering, what it costs in the battler — and each committed set's real
 * pull rates, straight from the sheet-fitted import data.
 */
import { RARITY_REGISTRY, rarityInfo, rarityOrder } from '#shared/utils/tcg/rarity'
import type { RarityTone } from '#shared/utils/tcg/rarity'
import { unitCostFor, damagePerChargeFor } from '#shared/utils/battler/shop'

interface RaritySetTier { tier: string | null, pool: number, perPack: number | null, oneIn: number | null }
interface RaritySet { id: string, name: string, code: string, tiers: RaritySetTier[] }

const { data: sets } = useAsyncData('tcg-rarities', () => apiFetch<RaritySet[]>('/api/tcg/rarities'))

const TONE_CLASS: Record<RarityTone, string> = {
    ink: 'text-highlighted',
    silver: 'text-slate-400',
    gold: 'text-warning',
    pink: 'text-pink-400',
    pastel: 'text-teal-300',
    rainbow: 'bg-gradient-to-r from-pink-400 via-yellow-400 to-sky-400 bg-clip-text text-transparent'
}

const ladder = computed(() => RARITY_REGISTRY.filter(info => info.label !== 'Basic Energy'))

function tiersOf(set: RaritySet) {
    return [...set.tiers].sort((a, b) => rarityOrder(a.tier) - rarityOrder(b.tier))
}

function tierLabel(tier: string | null): string {
    return rarityInfo(tier)?.label ?? tier ?? '—'
}

function tierSymbol(tier: string | null): { symbol: string, cls: string } {
    const info = rarityInfo(tier)
    return info ? { symbol: info.symbol, cls: TONE_CLASS[info.tone] } : { symbol: '?', cls: 'text-dimmed' }
}

function oneInText(tier: RaritySetTier): string {
    if (tier.oneIn == null) return '—'
    return `1 in ${formatNumber(Math.round(tier.oneIn), false)} packs`
}

function perPackText(tier: RaritySetTier): string {
    if (tier.perPack == null) return '—'
    if (tier.perPack >= 1) return `${formatNumber(tier.perPack, false)} per pack`
    const packs = 1 / tier.perPack
    return `1 in ${packs < 10 ? packs.toFixed(1) : formatNumber(Math.round(packs), false)} packs`
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-6 p-4">
    <section>
      <h2 class="mb-1 text-sm font-semibold uppercase tracking-wider text-muted">The ladder</h2>
      <p class="mb-3 text-xs text-muted">
        Rarity is era-scoped reference data — the vocabulary grows with every era.
        Battler columns show what a card of that tier costs to field and its damage per ⚡ of charge.
      </p>
      <div class="overflow-x-auto rounded-lg bg-elevated/50">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-default text-left text-xs uppercase tracking-wider text-muted">
              <th class="px-3 py-2">Symbol</th>
              <th class="px-3 py-2">Rarity</th>
              <th class="px-3 py-2">Era</th>
              <th class="px-3 py-2 text-right">Battler ₱</th>
              <th class="px-3 py-2 text-right">Dmg / ⚡</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="info in ladder"
              :key="info.label"
              class="border-b border-default/50 last:border-b-0"
            >
              <td
                class="px-3 py-2 text-base"
                :class="TONE_CLASS[info.tone]"
              >{{ info.symbol }}</td>
              <td class="px-3 py-2 font-medium text-highlighted">{{ info.label }}</td>
              <td class="px-3 py-2 text-muted">{{ info.era }}</td>
              <td class="px-3 py-2 text-right tabular-nums">₱{{ unitCostFor(info.label) }}</td>
              <td class="px-3 py-2 text-right tabular-nums text-muted">{{ damagePerChargeFor(info.label) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section
      v-for="set in sets ?? []"
      :key="set.id"
    >
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
        {{ set.name }} <span class="ml-1 font-mono text-dimmed">{{ set.code }}</span>
      </h2>
      <div class="overflow-x-auto rounded-lg bg-elevated/50">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-default text-left text-xs uppercase tracking-wider text-muted">
              <th class="px-3 py-2">Rarity</th>
              <th class="px-3 py-2 text-right">Cards</th>
              <th class="px-3 py-2 text-right">Tier rate</th>
              <th class="px-3 py-2 text-right">Specific card</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="tier in tiersOf(set)"
              :key="tier.tier ?? 'none'"
              class="border-b border-default/50 last:border-b-0"
            >
              <td class="px-3 py-2">
                <span
                  class="mr-1.5"
                  :class="tierSymbol(tier.tier).cls"
                >{{ tierSymbol(tier.tier).symbol }}</span>
                <span class="font-medium text-highlighted">{{ tierLabel(tier.tier) }}</span>
              </td>
              <td class="px-3 py-2 text-right tabular-nums">{{ tier.pool }}</td>
              <td class="px-3 py-2 text-right tabular-nums text-muted">{{ perPackText(tier) }}</td>
              <td class="px-3 py-2 text-right tabular-nums text-muted">{{ oneInText(tier) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
