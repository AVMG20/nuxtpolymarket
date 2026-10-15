<script setup lang="ts">
import { BATTLE_SPEED_DURATIONS_MINUTES, BATTLE_SPEED_TIERS } from '#shared/utils/hero-quest/constants'
import { SHOP_TRACKS, shopTrackCost, type ShopCurrency } from '#shared/utils/hero-quest/content/shop'
import { battleSpeedPrice } from '#shared/utils/hero-quest/battle-speed'

/**
 * The Shop screen's two tabs. The Upgrades table is `SHOP_TRACKS` priced by `shopTrackCost`, and
 * the Battle Speed grid is `battleSpeedPrice` over the tiers and durations: the prices the buttons
 * charge.
 */

const CURRENCY: Readonly<Record<ShopCurrency, string>> = { voidShards: 'Void Shards', gems: 'Gems', gold: 'Gold' }

const trackRows = SHOP_TRACKS.map((track) => {
    const first = shopTrackCost(track.id, 0) ?? 0
    const second = shopTrackCost(track.id, 1)
    const rule = track.costStep === undefined
        ? `×${Number(track.costGrowth.toFixed(2))} a level`
        : `+${track.costStep.toLocaleString('en-US')} a level`
    return {
        id: track.id,
        name: track.name,
        description: track.description,
        currency: CURRENCY[track.currency],
        levels: Number.isFinite(track.maxLevel) ? String(track.maxLevel) : 'No limit',
        first: formatNumber(first),
        rule: second === null ? 'One level' : rule
    }
})

const durationLabel = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${minutes / 60} h`)

const speedRows = BATTLE_SPEED_TIERS.map(speed => ({
    speed,
    prices: BATTLE_SPEED_DURATIONS_MINUTES.map(minutes => battleSpeedPrice(speed, minutes))
}))

const cards = [
    { term: 'Bar and level/max', text: 'How far a track has gone. It turns gold, and the card gets a gold frame, once maxed.', tone: 'text-primary' },
    { term: 'NO LIMIT', text: 'A stat track: no cap, with its level shown instead.' },
    { term: 'Now / Next', text: 'What the track gives now, and after one more level (green).' },
    { term: 'Buy n', text: 'Buys one level for the price and currency shown. Greyed out when you cannot afford it; MAX LEVEL once maxed.', tone: 'text-success' },
    { term: '<  n/m  >', text: 'Pages, when there are more tracks than fit.' }
]

const speed = [
    { term: 'Status line', text: 'The boost running and the time it has left, or that battles play at normal speed.' },
    { term: 'Grid cell', text: 'Buys that speed for that long, for the Gems shown. The running speed\'s row is gold.', tone: 'text-success' },
    { term: 'Greyed cell', text: 'You cannot afford it, or another speed is running.', tone: 'text-dimmed' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="shop" />

    <HeroQuestWikiSection
      title="Upgrades"
      icon="i-lucide-arrow-up-circle"
      lead="Permanent upgrades that survive every prestige. Each press buys one level."
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Track
              </th>
              <th class="text-left font-medium py-1.5 px-3 min-w-48">
                What it does
              </th>
              <th class="text-right font-medium py-1.5 px-3">
                Levels
              </th>
              <th class="text-right font-medium py-1.5 pl-3">
                Price
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in trackRows"
              :key="row.id"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3 text-default font-medium whitespace-nowrap">
                {{ row.name }}
              </td>
              <td class="py-1.5 px-3">
                {{ row.description }}
              </td>
              <td class="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">
                {{ row.levels }}
              </td>
              <td class="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">
                {{ row.first }} {{ row.currency }}
                <div class="text-dimmed">
                  {{ row.rule }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Each card shows its icon and name, then:
      </p>
      <HeroQuestWikiKey :items="cards" />
      <p>
        Your Void Shards, Gems and Gold are in the top right. A buy paid in Void Shards or Gems asks
        for a second press (Settings, Void Shard spending and Gem spending); a Gold buy never does.
        Maxed tracks move to the end the next time you open the Shop.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Battle Speed"
      icon="i-lucide-fast-forward"
      :lead="hqFeatureUnlockText('speed') + ' Spend Gems on a stretch of faster battles.'"
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Speed
              </th>
              <th
                v-for="minutes in BATTLE_SPEED_DURATIONS_MINUTES"
                :key="minutes"
                class="text-right font-medium py-1.5 px-3 whitespace-nowrap"
              >
                {{ durationLabel(minutes) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in speedRows"
              :key="row.speed"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3 text-default font-medium">
                {{ row.speed }}×
              </td>
              <td
                v-for="(price, index) in row.prices"
                :key="index"
                class="py-1.5 px-3 text-right tabular-nums"
              >
                {{ price.toLocaleString('en-US') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs">
        Prices in Gems.
      </p>
      <HeroQuestWikiKey :items="speed" />
      <ul class="space-y-1.5 list-disc pl-5">
        <li>Waves are cleared, and pay, faster. A boss fight only plays faster: it is decided the same way.</li>
        <li>Buying the speed that is running adds the time to it. A different speed waits until it ends.</li>
        <li>The clock runs in real time, away or not. Away, a boost pays at your offline efficiency.</li>
        <li>It pauses while you are in a raid, and never applies to the Arena.</li>
        <li>Each buy asks for a second press (Settings, Gem spending).</li>
      </ul>
    </HeroQuestWikiSection>
  </div>
</template>
