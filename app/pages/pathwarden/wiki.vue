<script setup lang="ts">
import {
  PATHWARDEN_BOOSTS,
  PATHWARDEN_CHECKPOINT_WAVES,
  pathwardenBoostCost,
  pathwardenCheckpointBaseCoins,
  pathwardenCheckpointRate
} from '#shared/utils/gamelogic/pathwarden'
import { PATHWARDEN_RELICS } from '~/utils/pathwarden-engine'

definePageMeta({ title: 'Pathwarden Field Guide' })

const sections = [
  { id: 'first-march', label: 'First march', icon: 'i-lucide-footprints' },
  { id: 'building', label: 'Defenses', icon: 'i-lucide-castle' },
  { id: 'roads', label: 'Roads', icon: 'i-lucide-route' },
  { id: 'checkpoints', label: 'Checkpoints', icon: 'i-lucide-landmark' },
  { id: 'relics', label: 'Relics', icon: 'i-lucide-sparkles' },
  { id: 'workbench', label: 'Arcanist workbench', icon: 'i-lucide-scale' },
  { id: 'permanent', label: 'Permanent power', icon: 'i-lucide-gem' },
  { id: 'realms', label: 'Realms & rank', icon: 'i-lucide-trophy' }
]

const defenses = [
  { name: 'Star Ballista', cost: 55, role: 'Fast single-target fire', counters: 'Runners and wounded enemies', icon: 'i-lucide-crosshair' },
  { name: 'Sun Mortar', cost: 90, role: 'Arcing area damage', counters: 'Dense groups and shamans', icon: 'i-lucide-bomb' },
  { name: 'Winter Spire', cost: 75, role: 'Area slow and control', counters: 'Brutes, bosses and crowded bends', icon: 'i-lucide-snowflake' },
  { name: 'Ember Bastion', cost: 115, role: 'Burning siege shells', counters: 'Durable targets and regenerating shamans', icon: 'i-lucide-flame' },
  { name: 'Tempest Obelisk', cost: 135, role: 'Jumping lightning', counters: 'Separated clusters and fast formations', icon: 'i-lucide-zap' },
  { name: 'Dawn Chapel', cost: 155, role: 'Radiant formation bursts', counters: 'Large late-wave groups', icon: 'i-lucide-sun' }
]

const relicFamilies = PATHWARDEN_RELICS.filter(relic => relic.rarity === 'common')

const coinBoosts = Object.entries(PATHWARDEN_BOOSTS).filter(([, boost]) => boost.currency === 'coins')
const gemBoosts = Object.entries(PATHWARDEN_BOOSTS).filter(([, boost]) => boost.currency === 'gems')
</script>

<template>
  <UContainer class="space-y-8 py-8">
    <header class="max-w-4xl">
      <UBadge color="primary" variant="subtle" icon="i-lucide-book-open">Warden’s handbook</UBadge>
      <h1 class="mt-3 text-3xl font-black sm:text-4xl">Pathwarden Field Guide</h1>
      <p class="mt-3 text-muted">
        Pathwarden is a twelve-wave tower-defense run about managing two pressures at once: build enough to survive,
        but preserve enough Aether to make the next checkpoint valuable. Every visible threat has a counter and every
        voluntary exit happens at a checkpoint.
      </p>
      <div class="mt-5 flex flex-wrap gap-2">
        <UButton v-for="section in sections" :key="section.id" :to="`#${section.id}`" color="neutral" variant="soft" size="sm" :icon="section.icon">
          {{ section.label }}
        </UButton>
      </div>
    </header>

    <section id="first-march" class="scroll-mt-24 space-y-4">
      <h2 class="text-2xl font-black">Your first march</h2>
      <div class="grid gap-3 md:grid-cols-4">
        <UCard v-for="(step, index) in [
          ['Build', 'Place at least two complementary defenses beside the road.'],
          ['Defend', 'Call a wave and watch every active mist exit.'],
          ['Expand', 'Choose a glowing road end; revealed road stays permanently.'],
          ['Decide', 'At waves 4, 8 and 12, bank the run or risk it for a richer rate.']
        ]" :key="step[0]">
          <UBadge color="primary" variant="subtle">{{ index + 1 }}</UBadge>
          <h3 class="mt-3 font-black">{{ step[0] }}</h3>
          <p class="mt-1 text-sm text-muted">{{ step[1] }}</p>
        </UCard>
      </div>
      <UAlert color="warning" variant="subtle" icon="i-lucide-scale" title="The central tension">
        Aether buys defenses during a run. Whatever remains at a checkpoint converts to account Coins. Greed improves
        the payout only while the keep survives; a defeat pays nothing.
      </UAlert>
    </section>

    <section id="building" class="scroll-mt-24 space-y-4">
      <h2 class="text-2xl font-black">Building and battlefield control</h2>
      <div class="grid gap-3 md:grid-cols-3">
        <UCard v-for="defense in defenses" :key="defense.name">
          <UIcon :name="defense.icon" class="size-8 text-primary" />
          <div class="mt-3 flex items-center justify-between gap-2">
            <h3 class="font-black">{{ defense.name }}</h3>
            <UBadge color="primary" variant="subtle">{{ defense.cost }} Aether</UBadge>
          </div>
          <p class="mt-2 text-sm">{{ defense.role }}</p>
          <p class="mt-1 text-xs text-muted">Best against: {{ defense.counters }}</p>
        </UCard>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <UCard>
          <h3 class="font-black">Move, fuse, and salvage</h3>
          <p class="mt-2 text-sm text-muted">
            During planning, drag a defense to an open fixed tile to reposition it. Drop it onto an equal type and rank
            to fuse both into one stronger defense. Dismantling refunds 50% of its invested Aether. Costs rise as you
            buy more of the same type, so moving and fusing are often better than replacing.
          </p>
        </UCard>
        <UCard>
          <h3 class="font-black">Target priorities</h3>
          <p class="mt-2 text-sm text-muted">
            First attacks the invader closest to the keep, Strong focuses the highest-health target, and Fast catches
            runners. A mixed formation should use different priorities instead of wasting every projectile on one foe.
            Elevated ground improves a defense’s reach and impact.
          </p>
        </UCard>
      </div>
    </section>

    <section id="roads" class="scroll-mt-24 space-y-4">
      <h2 class="text-2xl font-black">Roads, mist, and enemy routes</h2>
      <p class="max-w-4xl text-muted">
        Each expansion pushes the mist back from one new stretch of land. You may uncover long roads, U-bends,
        switchbacks, T-junctions, crossroads, defensible road islands, or bridges. Rivers, lakes, canyons, forests, and
        mountains limit where defenses fit, so use bends, narrow approaches, and high ground to build strong positions.
        Roads and natural obstacles cannot be built on.
      </p>
      <p class="max-w-4xl text-muted">
        Every terminal mist exit sends enemies toward the keep. Additional exits increase each wave’s enemy volume,
        while later Realms add still more enemies, health, and speed. Expansion gives you more defensive positions, but
        it also opens more attack directions.
      </p>
      <UAlert color="info" variant="subtle" icon="i-lucide-eye" title="Read the next-wave card">
        The sidebar previews enemy count, active exits, checkpoint status, and special threats. Prepare for what is
        announced; Pathwarden does not hide a required counter behind an untelegraphed wave.
      </UAlert>
    </section>

    <section id="checkpoints" class="scroll-mt-24 space-y-4">
      <h2 class="text-2xl font-black">Checkpoints and Coin settlement</h2>
      <p class="text-muted">
        Your march is saved automatically, so you can leave and return where you stopped. During a building phase you
        may abandon the march for 3 Gems, or for the Coin price shown in the retreat window. You cannot abandon a march
        while a battle is in progress.
      </p>
      <div class="grid gap-3 md:grid-cols-3">
        <UCard v-for="wave in PATHWARDEN_CHECKPOINT_WAVES" :key="wave">
          <p class="text-xs font-bold uppercase tracking-wider text-warning">Wave {{ wave }}</p>
          <h3 class="mt-1 text-xl font-black">Checkpoint {{ wave / 4 }}</h3>
          <p class="mt-3 text-sm text-muted">Realm 1 base: <strong class="text-default">{{ formatNumber(pathwardenCheckpointBaseCoins(wave, 1), false) }} Coins</strong></p>
          <p class="text-sm text-muted">Each saved Aether: <strong class="text-warning">{{ pathwardenCheckpointRate(wave, 1) }} Coins</strong></p>
        </UCard>
      </div>
      <p class="text-sm text-muted">
        Higher Realms raise both the checkpoint base and Aether conversion. Wave 8 pays four times wave 4’s Aether rate;
        wave 12 pays more than three times wave 8’s rate. This back-loading makes continuing attractive without making
        an early successful cash-out worthless.
      </p>
    </section>

    <section id="relics" class="scroll-mt-24 space-y-4">
      <h2 class="text-2xl font-black">Relics inside a run</h2>
      <p class="text-muted">
        The 75-relic pool contains fifteen families at five rarities: Common, Uncommon, Rare, Epic, and Mythic.
        Realm-wide relics apply immediately. Weapon relics enter the relic belt and must be dragged onto a defense.
        A matching weapon relic stacks; every Common-equivalent stack adds 50% base damage, so three Common fire
        relics produce 250% of normal damage. Applying another weapon family replaces the old family, and only
        defenses with matching weapon families may fuse.
      </p>
      <div class="overflow-hidden rounded-xl border border-default">
        <table class="w-full text-left text-sm">
          <thead class="bg-elevated text-xs uppercase text-muted"><tr><th class="p-3">Family</th><th class="p-3">Common effect</th><th class="p-3">Use</th></tr></thead>
          <tbody>
            <tr v-for="relic in relicFamilies" :key="relic.family" class="border-t border-default">
              <td class="p-3 font-bold">{{ relic.name.replace('Worn ', '') }}</td>
              <td class="p-3 text-muted">{{ relic.description }}</td>
              <td class="p-3">{{ relic.towerSpecific ? 'Drag to one defense' : 'Applies immediately' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <UAlert color="warning" variant="subtle" icon="i-lucide-scale" title="Checkpoint salvage">
        After choosing Continue at a checkpoint, hover a stored weapon relic and dissolve it for Aether. Selling is
        unavailable before the commitment, so the checkpoint choice cannot be used as a free price check.
      </UAlert>
    </section>

    <section id="workbench" class="scroll-mt-24 space-y-4">
      <h2 class="text-2xl font-black">The Arcanist workbench</h2>
      <p class="max-w-4xl text-muted">
        A rebinding ritual puts every participating relic into the maelstrom. The incoming relic and the relics already
        bound to the defense are all exposed to the same danger: each individual relic gets its own chance to survive,
        return weakened, or be burned completely to dust. A stack is not one roll; every relic in that stack is tested.
      </p>
      <div class="grid gap-3 md:grid-cols-3">
        <UCard>
          <h3 class="font-black text-warning">Arcane pressure</h3>
          <p class="mt-2 text-sm text-muted">
            The binding and preservation percentages show the ritual’s two competing outcomes. A successful ritual can
            still consume relics that lose their individual survival rolls.
          </p>
        </UCard>
        <UCard>
          <h3 class="font-black text-primary">Affinity matters</h3>
          <p class="mt-2 text-sm text-muted">
            Using relics with the same affinity lessens the arcane pressure, improving the ritual’s chance to hold its
            shape while the new binding forms.
          </p>
        </UCard>
        <UCard>
          <h3 class="font-black text-success">Stabilizing crystals</h3>
          <p class="mt-2 text-sm text-muted">
            Spend Aether to place stabilizing crystals on the binding side, the preservation side, or split them between
            both. More crystals improve the chosen odds, but the ritual remains risky and irreversible.
          </p>
        </UCard>
      </div>
      <UAlert color="error" variant="subtle" icon="i-lucide-flame" title="Dust is a real outcome">
        A relic that fails its individual survival roll is not returned to the belt. It is scorched into an ash pile, and
        a weakened relic visibly retains the damage in its final stats and presentation.
      </UAlert>
    </section>

    <section id="permanent" class="scroll-mt-24 space-y-4">
      <h2 class="text-2xl font-black">Permanent progression</h2>
      <p class="max-w-4xl text-muted">
        Coin tracks have 20 ranks and double in cost through rank 10; the late mastery curve then begins at 10,000 times
        base cost and grows another 80% per rank. This makes first upgrades reachable to new players while giving
        established accounts meaningful hundred-million and billion-Coin goals. Gem tracks have 10 ranks and grow by
        roughly 72% each rank.
      </p>
      <div class="grid gap-4 lg:grid-cols-2">
        <UCard>
          <h3 class="font-black text-warning">Coin disciplines</h3>
          <div v-for="[id, boost] in coinBoosts" :key="id" class="mt-3 border-t border-default pt-3 first:border-0 first:pt-0">
            <div class="flex justify-between gap-2"><strong>{{ boost.name }}</strong><span class="text-xs text-muted">20 ranks</span></div>
            <p class="mt-1 text-xs text-muted">{{ boost.description }}</p>
            <p class="mt-1 text-xs text-warning">Rank 1 {{ formatNumber(pathwardenBoostCost(id as never, 0) ?? 0) }} · Rank 11 {{ formatNumber(pathwardenBoostCost(id as never, 10) ?? 0) }}</p>
          </div>
        </UCard>
        <UCard>
          <h3 class="font-black text-primary">Gem disciplines</h3>
          <div v-for="[id, boost] in gemBoosts" :key="id" class="mt-3 border-t border-default pt-3 first:border-0 first:pt-0">
            <div class="flex justify-between gap-2"><strong>{{ boost.name }}</strong><span class="text-xs text-muted">10 ranks</span></div>
            <p class="mt-1 text-xs text-muted">{{ boost.description }}</p>
            <p class="mt-1 text-xs text-primary">Rank 1 {{ pathwardenBoostCost(id as never, 0) }} Gems · Rank 10 {{ pathwardenBoostCost(id as never, 9) }} Gems</p>
          </div>
        </UCard>
      </div>
      <UCard class="border-primary/30">
        <h3 class="font-black">Mist Surge · 5 Gems per charge</h3>
        <p class="mt-2 text-sm text-muted">
          A consumable run supercharge that grants +25% starting Aether, +10% damage, and +5% attack speed. It is
          selected before building and consumed only when wave 1 begins. It improves consistency and ambitious Realm
          pushes, but it does not bypass the server’s payout ceiling or replace permanent progression.
        </p>
      </UCard>
      <div class="grid gap-3 md:grid-cols-2">
        <UCard>
          <h3 class="font-black text-warning">Coin blueprints</h3>
          <p class="mt-2 text-sm text-muted">
            Ember Bastion, Tempest Obelisk, and Dawn Chapel are permanent Coin unlocks. They add new tactical roles
            but still consume Aether inside a run and follow the same escalating purchase-cost rule. Unlocking one
            expands choice; it does not raise payout odds by itself.
          </p>
        </UCard>
        <UCard>
          <h3 class="font-black text-primary">Gem liveries</h3>
          <p class="mt-2 text-sm text-muted">
            Citadel liveries recolor the keep and add matching accents to defenses. They are cosmetic-only bragging
            rights: no damage, range, health, Aether, score, odds, or Coin settlement changes. A purchased livery is
            permanently owned and can be equipped between runs.
          </p>
        </UCard>
      </div>
    </section>

    <section id="realms" class="scroll-mt-24 space-y-4 pb-8">
      <h2 class="text-2xl font-black">Realms, rankings, and long-term goals</h2>
      <p class="max-w-4xl text-muted">
        Complete wave 12 to unlock the next of five Realms. Higher Realms strengthen and accelerate enemies while
        increasing score and settlement rates. Rankings prioritize completed Realm, attempted Realm, wave, then score;
        abandoned runs never qualify. Flawless waves award bonus score and provide a tie-breaking badge of precision.
      </p>
      <div class="flex gap-2">
        <UButton to="/pathwarden" icon="i-lucide-castle">Begin a march</UButton>
        <UButton to="/pathwarden/leaderboard" color="neutral" variant="soft" icon="i-lucide-trophy">View rankings</UButton>
      </div>
    </section>
  </UContainer>
</template>
