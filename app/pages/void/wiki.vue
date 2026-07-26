<script setup lang="ts">
import {
  VOID_RESOURCES, VOID_SECTORS, VOID_ROCKS, VOID_ENEMIES, VOID_SHIPS,
  VOID_RARITIES, VOID_AFFIXES, VOID_SPECIALS, VOID_UPGRADES, VOID_AFFIX_GROUP_LABEL,
  VOID_STORM_START_MS, VOID_STORM_FULL_MS, VOID_RUN_DURATION_MS, VOID_MIDBOSS_SPAWN_MS,
  VOID_STORM_DPS_FRACTION, VOID_STORM_ENEMY_MULT, VOID_RAMP_PER_MINUTE, VOID_SALVAGE_RATE,
  VOID_MARKET_PRICES, VOID_BOSS_MODULE_DROP_CHANCE,
  type VoidAffixGroup
} from '#shared/utils/gamelogic/void'

definePageMeta({ title: 'Void Wiki' })

const minutes = (ms: number) => `${Math.floor(ms / 60_000)}:${(((ms % 60_000) / 1000) | 0).toString().padStart(2, '0')}`
const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

const affixGroups = computed(() => {
  const groups: VoidAffixGroup[] = ['combat', 'mining', 'haul', 'ship']
  return groups.map(group => ({
    group,
    label: VOID_AFFIX_GROUP_LABEL[group],
    affixes: VOID_AFFIXES.filter(a => a.group === group)
  }))
})
</script>

<template>
  <UContainer class="max-w-4xl space-y-5">
    <div>
      <h1 class="text-2xl font-bold">
        Field manual
      </h1>
      <p class="mt-0.5 text-sm text-muted">
        Everything the sector will not explain to you politely.
      </p>
    </div>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-gamepad-2" class="size-4 text-primary" /> Controls
        </p>
      </template>
      <ul class="space-y-1.5 text-sm">
        <li><UKbd value="W" /> <UKbd value="A" /> <UKbd value="S" /> <UKbd value="D" /> — thrust. You're in space; expect to drift.</li>
        <li><UKbd value="Space" /> — burn. Roughly 1.85× top speed for about 2.6 seconds, then it recharges.</li>
        <li>Mouse — your hull turns toward the cursor at its own turn rate. Heavy hulls lag badly.</li>
        <li>Hold left click — fires the weapon, or runs the mining beam if the cursor is on a rock inside beam range. Same hardware, two jobs.</li>
      </ul>
    </UCard>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-clock" class="size-4 text-warning" /> The clock
        </p>
      </template>
      <div class="space-y-2 text-sm">
        <div class="space-y-1.5">
          <div class="flex items-start gap-2">
            <UBadge color="neutral" variant="subtle" label="every minute" />
            <span>Patrol hp, damage and reward all rise by {{ Math.round(VOID_RAMP_PER_MINUTE * 100) }}%, they spawn faster, and the population cap creeps up. Minute 8 is roughly double-strength.</span>
          </div>
          <div class="flex items-start gap-2">
            <UBadge color="warning" variant="subtle" :label="minutes(VOID_MIDBOSS_SPAWN_MS)" />
            <span>A <strong>Harbinger</strong> strike cruiser jumps in somewhere in the sector. Fast, escorted, and worth killing.</span>
          </div>
          <div class="flex items-start gap-2">
            <UBadge color="warning" variant="subtle" :label="minutes(VOID_STORM_START_MS)" />
            <span>The ion storm starts closing from the sector borders toward the mothership.</span>
          </div>
          <div class="flex items-start gap-2">
            <UBadge color="error" variant="subtle" :label="minutes(VOID_STORM_FULL_MS)" />
            <span>The gas covers everything, dock included.</span>
          </div>
          <div class="flex items-start gap-2">
            <UBadge color="error" variant="subtle" :label="minutes(VOID_RUN_DURATION_MS)" />
            <span>Hard stop. Nobody is still flying at this point anyway.</span>
          </div>
        </div>
        <p class="text-muted">
          Storm damage scales with how deep you are inside it — up to {{ Math.round(VOID_STORM_DPS_FRACTION * 100) }}% of max hull per second.
          Patrols burn too, but only take {{ Math.round(VOID_STORM_ENEMY_MULT * 100) }}% of what you do, so hiding in the gas is not a plan.
        </p>
        <p class="text-muted">
          The only way to keep a hold is to fly back to the mothership and sit inside the docking ring. Die, abort, or run out
          the clock and the cargo is gone. Credits picked up in flight always survive.
        </p>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-radar" class="size-4 text-primary" /> Sectors
        </p>
      </template>
      <div class="space-y-2">
        <div v-for="sector in VOID_SECTORS" :key="sector.tier" class="rounded-lg border border-default bg-elevated p-3">
          <p class="font-bold" :style="{ color: hex(sector.color) }">
            {{ sector.tier }}. {{ sector.name }}
          </p>
          <p class="mt-0.5 text-xs text-muted">
            {{ sector.description }}
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <UBadge size="sm" color="error" variant="subtle" :label="`${sector.threat.toFixed(1)}× threat`" />
            <UBadge size="sm" color="success" variant="subtle" :label="`${sector.reward.toFixed(1)}× reward`" />
            <UBadge size="sm" color="neutral" variant="subtle" :label="`${sector.mineTimeMult.toFixed(2)}× cut time`" />
            <UBadge size="sm" color="neutral" variant="subtle" :label="`Power ${sector.recommendedPower}+`" />
          </div>
        </div>
        <p class="text-xs text-muted">
          A sector unlocks once you extract successfully from the one before it.
        </p>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-boxes" class="size-4 text-primary" /> Resources
        </p>
      </template>
      <div class="grid gap-2 sm:grid-cols-2">
        <div v-for="resource in VOID_RESOURCES" :key="resource.id" class="rounded-lg border border-default bg-elevated p-3">
          <p class="flex items-center gap-1.5 font-bold" :style="{ color: hex(resource.color) }">
            <UIcon :name="resource.icon" class="size-4" /> {{ resource.name }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ resource.description }}
          </p>
          <div class="mt-2 flex flex-wrap gap-1">
            <UBadge size="sm" :color="resource.kind === 'ore' ? 'info' : 'warning'" variant="subtle" :label="resource.kind === 'ore' ? 'Mined from rocks' : 'Dropped by kills'" />
            <UBadge size="sm" color="neutral" variant="subtle" icon="i-lucide-hand-coins" :label="formatNumber(VOID_MARKET_PRICES[resource.id])" />
          </div>
        </div>
      </div>
      <p class="mt-3 text-xs text-muted">
        Ore pays for the boat — hull, shields, cargo, refinery and new chassis. Salvage pays for the offence — thrusters,
        weapon core, targeting and modules.
      </p>
    </UCard>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-hand-coins" class="size-4 text-warning" /> Money
        </p>
      </template>
      <div class="space-y-2 text-sm">
        <p>
          <strong>Nothing in the sector drops coins.</strong> Patrols drop salvage, rocks drop ore, and the only place
          either becomes money is the dock market — which means every coin this game has ever produced had to survive an
          extraction first. Die with a full hold and you earn exactly nothing.
        </p>
        <p class="text-muted">
          Prices are flat but wildly top-heavy: ferrite is close to worthless, while xenite is worth two hundred times
          as much per unit and warp cores more again. Both only exist in the deep sectors, so the fastest money is
          always the tier that can kill you. Refinery levels and <strong>Profiteering</strong> module rolls raise every
          price you're offered.
        </p>
        <p class="text-muted">
          Capitals have a {{ Math.round(VOID_BOSS_MODULE_DROP_CHANCE * 100) }}% chance to drop a whole module on death,
          and the rarity table follows the sector — another reason to push deeper rather than farm the shallow end.
        </p>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-pickaxe" class="size-4 text-primary" /> Rocks
        </p>
      </template>
      <div class="space-y-2">
        <div v-for="rock in VOID_ROCKS" :key="rock.id" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default bg-elevated p-3">
          <div>
            <p class="font-bold" :style="{ color: hex(rock.glow) }">
              {{ rock.name }}
            </p>
            <p class="text-xs text-muted">
              Yields {{ rock.yieldMin }}–{{ rock.yieldMax }} units before refinery bonuses
            </p>
          </div>
          <UBadge size="sm" color="neutral" variant="subtle" :label="`${(rock.mineMs / 1000).toFixed(0)}s base cut`" />
        </div>
        <p class="text-xs text-muted">
          Cut time is base × sector modifier × Weapon Core level × hull modifier × your modules' mining rolls. Rarer ore takes
          longer, which is exactly how it gets you killed.
        </p>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-skull" class="size-4 text-error" /> Hostiles
        </p>
      </template>
      <div class="space-y-2">
        <div v-for="enemy in VOID_ENEMIES" :key="enemy.id" class="rounded-lg border border-default bg-elevated p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="font-bold" :style="{ color: hex(enemy.color) }">
              {{ enemy.name }}
              <UBadge v-if="enemy.boss" class="ml-1" size="sm" color="error" variant="subtle" label="Capital" />
            </p>
            <div class="flex flex-wrap gap-1">
              <UBadge size="sm" color="neutral" variant="subtle" :label="`${enemy.hp} hp`" />
              <UBadge size="sm" color="neutral" variant="subtle" :label="`${enemy.speed} m/s`" />
              <UBadge size="sm" color="neutral" variant="subtle" :label="`${enemy.vision} m vision`" />
            </div>
          </div>
          <p class="mt-1 text-xs text-muted">
            {{ enemy.description }}
          </p>
          <div v-if="enemy.abilities.length" class="mt-2 flex flex-wrap gap-1">
            <UBadge v-for="ability in enemy.abilities" :key="ability" size="sm" color="warning" variant="subtle" class="capitalize" :label="ability" />
          </div>
        </div>
        <ul class="space-y-1 text-xs text-muted">
          <li><strong>Shockwave</strong> — a ring is painted on the field, then it expands. It's a band, not a disc: dive inside it or outrun it.</li>
          <li><strong>Rail beam</strong> — a thin charge line points at where you were. Move perpendicular to it.</li>
          <li><strong>Burst</strong> — a full ring of bolts with wide gaps. There is always a lane; find it before it fires.</li>
          <li><strong>Reinforce</strong> — capitals spit out interceptors. Kill the capital, not the escorts.</li>
        </ul>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-boxes" class="size-4 text-primary" /> Modules
        </p>
      </template>
      <div class="space-y-3">
        <p class="text-sm">
          A module is your gun <em>and</em> your mining laser. You buy a rarity; the stats are rolled server-side when you pay.
          Every mounted module contributes its entire stat sheet to the ship, so a second hardpoint makes the first module
          better too. Scrapping one returns {{ Math.round(VOID_SALVAGE_RATE * 100) }}% of its rarity's cost in raw materials.
        </p>
        <div class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="rarity in VOID_RARITIES"
            :key="rarity.id"
            size="sm"
            variant="subtle"
            color="neutral"
            :style="{ color: rarity.hex }"
            :label="`${rarity.name} · ${rarity.affixCount} stats · ${rarity.power.toFixed(2)}× rolls`"
          />
        </div>

        <div v-for="group in affixGroups" :key="group.group">
          <p class="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
            {{ group.label }} stats
          </p>
          <div class="flex flex-wrap gap-1">
            <UBadge
              v-for="affix in group.affixes"
              :key="affix.id"
              size="sm"
              color="neutral"
              variant="subtle"
              :label="`${affix.name}${affix.minRarity > 0 ? ` (${VOID_RARITIES[affix.minRarity]?.name}+)` : ''}`"
            />
          </div>
        </div>

        <div>
          <p class="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
            Unique specials
          </p>
          <div class="space-y-1.5">
            <div v-for="special in VOID_SPECIALS" :key="special.id" class="rounded-lg border border-error/25 bg-error/5 p-2.5">
              <p class="flex items-center gap-1.5 text-sm font-bold text-error">
                <UIcon :name="special.icon" class="size-4" /> {{ special.name }}
              </p>
              <p class="mt-0.5 text-xs text-muted">
                {{ special.description }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-rocket" class="size-4 text-primary" /> Hulls
        </p>
      </template>
      <div class="space-y-2">
        <div v-for="ship in VOID_SHIPS" :key="ship.id" class="rounded-lg border border-default bg-elevated p-3">
          <p class="font-bold" :style="{ color: hex(ship.color) }">
            {{ ship.name }}
          </p>
          <p class="mt-0.5 text-xs text-muted">
            {{ ship.description }}
          </p>
          <div class="mt-2 flex flex-wrap gap-1">
            <UBadge size="sm" color="neutral" variant="subtle" :label="`${ship.speedMult.toFixed(2)}× speed`" />
            <UBadge size="sm" color="neutral" variant="subtle" :label="`${ship.turnMult.toFixed(2)}× turn`" />
            <UBadge size="sm" color="neutral" variant="subtle" :label="`${ship.cargoMult.toFixed(2)}× cargo`" />
            <UBadge size="sm" color="neutral" variant="subtle" :label="`${ship.hullMult.toFixed(2)}× hull`" />
            <UBadge size="sm" color="primary" variant="subtle" :label="`${ship.turretSlots} hardpoints`" />
            <UBadge size="sm" color="warning" variant="subtle" :label="`${ship.barrels} barrel${ship.barrels === 1 ? '' : 's'}`" />
            <UBadge v-if="ship.cost.gems" size="sm" color="info" variant="subtle" icon="i-lucide-gem" :label="String(ship.cost.gems)" />
          </div>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-arrow-big-up" class="size-4 text-primary" /> Upgrade tracks
        </p>
      </template>
      <div class="space-y-1.5">
        <div v-for="upgrade in VOID_UPGRADES" :key="upgrade.id" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default bg-elevated p-2.5">
          <div class="min-w-0">
            <p class="flex items-center gap-1.5 text-sm font-bold">
              <UIcon :name="upgrade.icon" class="size-4 text-primary" /> {{ upgrade.name }}
            </p>
            <p class="text-xs text-muted">
              {{ upgrade.description }}
            </p>
          </div>
          <div class="flex shrink-0 gap-1">
            <UBadge size="sm" :color="upgrade.funding === 'ore' ? 'info' : 'warning'" variant="subtle" :label="upgrade.funding === 'ore' ? 'Ore' : 'Salvage'" />
            <UBadge size="sm" color="neutral" variant="subtle" :label="`Max ${upgrade.maxLevel}`" />
          </div>
        </div>
      </div>
    </UCard>
  </UContainer>
</template>
