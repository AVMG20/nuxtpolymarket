<script setup lang="ts">
import {
    FREE_PULLS_PER_DAY,
    FREE_PULL_COOLDOWN_MINUTES,
    MILESTONE_COLLECTION_EVERY,
    MILESTONE_COLLECTION_SEALS_BASE,
    MILESTONE_PRESTIGE_SEALS_BASE,
    MILESTONE_WORLD_SEALS_BASE,
    SEAL_GRANT_PER_BOSS,
    SEAL_LADDER_BASE_GOLD,
    TEN_PULL_SIZE
} from '#shared/utils/hero-quest/constants'
import { SHOP_TRACKS } from '#shared/utils/hero-quest/content/shop'

/**
 * Currencies and where they go.
 *
 * The currency list comes from `HQ_CURRENCY_DOCS`, which carries a `live` flag — three of the
 * specified currencies belong to systems that ship in a later phase, and listing them as
 * working would send players hunting for something they cannot earn.
 *
 * The prestige shop table is generated from `SHOP_TRACKS`, so adding a track updates this page.
 */
const live = HQ_CURRENCY_DOCS.filter(currency => currency.live)
const planned = HQ_CURRENCY_DOCS.filter(currency => !currency.live)
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <div class="space-y-2">
      <h1 class="text-xl font-semibold text-highlighted">
        Economy
      </h1>
      <p class="text-sm text-muted">
        What each currency is for, and the one thing each of them cannot buy.
      </p>
    </div>

    <HeroQuestWikiSection
      title="Currencies"
      icon="i-lucide-coins"
    >
      <div class="space-y-2">
        <div
          v-for="currency in live"
          :key="currency.name"
          class="rounded-lg border border-default bg-elevated/40 p-3 space-y-1"
        >
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-highlighted">{{ currency.name }}</span>
            <UBadge
              v-if="currency.shared"
              color="neutral"
              variant="subtle"
              size="sm"
            >
              Shared across games
            </UBadge>
          </div>
          <p class="text-xs">
            <span class="text-muted/70">From</span> {{ currency.source }}
          </p>
          <p class="text-xs">
            <span class="text-muted/70">Spent on</span> {{ currency.sink }}
          </p>
        </div>
      </div>
      <p>
        Gold and Gems are <strong class="text-default">platform balances</strong> — the same ones
        every other game here uses. Everything else belongs to Hero Quest alone.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Where Seals come from"
      icon="i-lucide-stamp"
      lead="Three independent supplies, one set for each gacha."
    >
      <div class="grid gap-2 sm:grid-cols-2">
        <HeroQuestWikiFormula
          label="Free pulls"
          :formula="`${FREE_PULLS_PER_DAY} free ${TEN_PULL_SIZE}-pulls per gacha per day`"
          :note="`${FREE_PULL_COOLDOWN_MINUTES} minutes between claims. Spendable only as a ${TEN_PULL_SIZE}-pull — never banked or split.`"
        />
        <HeroQuestWikiFormula
          label="Bosses"
          :formula="`${SEAL_GRANT_PER_BOSS} of every Seal per boss beaten`"
        />
        <HeroQuestWikiFormula
          label="Milestones"
          :formula="`from ${MILESTONE_WORLD_SEALS_BASE} of every Seal per world · ${MILESTONE_PRESTIGE_SEALS_BASE} per prestige · ${MILESTONE_COLLECTION_SEALS_BASE} of a gacha's own per ${MILESTONE_COLLECTION_EVERY} collected`"
          note="Claimed in the Milestones scene. Each kind of milestone pays more at every step, and only collections ever run out."
        />
        <HeroQuestWikiFormula
          label="Bought with Gold"
          :formula="`from ${SEAL_LADDER_BASE_GOLD.toLocaleString('en-US')} Gold, rising with each purchase`"
          note="Each gacha has its own counter and its own price. The ladder resets at midnight UTC."
        />
      </div>
      <p>
        The Gold ladder is the only sink Gold has, and it is deliberately steep: it is there to
        turn a day of idle farming into one or two extra pulls, not into a shortcut past the
        collection loop.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="The prestige shop"
      icon="i-lucide-sparkles"
      lead="What Void Shards buy, and the only place they can be spent."
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
              <th class="text-right font-medium py-1.5 pl-3 whitespace-nowrap">
                First level
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="track in SHOP_TRACKS"
              :key="track.id"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3 text-default font-medium whitespace-nowrap">
                {{ track.name }}
              </td>
              <td class="py-1.5 px-3">
                {{ track.description }}
              </td>
              <td class="py-1.5 px-3 text-right tabular-nums">
                {{ track.maxLevel }}
              </td>
              <td class="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">
                {{ track.baseCost.toLocaleString('en-US') }}
                {{ track.currency === 'gems' ? 'Gems' : track.currency === 'gold' ? 'Gold' : 'Shards' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Each level costs its track's growth factor more than the last. The two offline tracks are
        the ones worth buying first — they raise the rate at which everything else arrives.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      v-if="planned.length"
      title="Not in this build"
      icon="i-lucide-construction"
    >
      <p>
        These are specified but belong to systems that have not shipped. Listed so you know they
        exist and know not to look for them.
      </p>
      <ul class="space-y-1">
        <li
          v-for="currency in planned"
          :key="currency.name"
          class="text-xs"
        >
          <span class="text-default">{{ currency.name }}</span>
          — {{ currency.source }} {{ currency.sink }}
        </li>
      </ul>
    </HeroQuestWikiSection>
  </div>
</template>
