<script setup lang="ts">
import {
  VOID_RESOURCES, VOID_SECTORS, VOID_ROCKS, VOID_ENEMIES, VOID_SHIPS,
  VOID_RARITIES, VOID_AFFIXES, VOID_SPECIALS, VOID_UPGRADES,
  VOID_STORM_START_MS, VOID_STORM_FULL_MS, VOID_RUN_DURATION_MS,
  VOID_STORM_DPS_FRACTION, VOID_STORM_ENEMY_MULT
} from '#shared/utils/gamelogic/void'

definePageMeta({ title: 'Void Wiki' })

const minutes = (ms: number) => `${Math.round(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(0).padStart(2, '0')}`
const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`
</script>

<template>
  <UContainer class="max-w-4xl space-y-6">
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
        <li><UKbd value="Space" /> — burn. Roughly 1.85x top speed for about 2.6 seconds, then it recharges.</li>
        <li>Mouse — your hull turns toward the cursor at its own turn rate. Heavy hulls lag badly.</li>
        <li>Hold left click — fires the primary cannon, or runs the mining laser if the cursor is on a rock inside beam range.</li>
      </ul>
    </UCard>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-wind" class="size-4 text-warning" /> The ion storm
        </p>
      </template>
      <div class="space-y-2 text-sm">
        <p>
          At <strong>{{ minutes(VOID_STORM_START_MS) }}</strong> the sector borders start closing toward the mothership.
          By <strong>{{ minutes(VOID_STORM_FULL_MS) }}</strong> the gas covers everything, dock included, and the run
          hard-stops at <strong>{{ minutes(VOID_RUN_DURATION_MS) }}</strong>.
        </p>
        <p>
          Damage scales with how deep you are inside it — up to {{ Math.round(VOID_STORM_DPS_FRACTION * 100) }}% of your
          max hull per second at full depth. Patrols burn in it too, but only take
          {{ Math.round(VOID_STORM_ENEMY_MULT * 100) }}% of what you do, so hiding in the gas is not a strategy.
        </p>
        <p class="text-muted">
          The only way to keep a hold is to fly back to the mothership and hold position inside the docking ring.
          Die, abort, or run out the clock and the cargo is gone. Credits picked up in flight always survive.
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
          <p class="font-bold">
            {{ sector.tier }}. {{ sector.name }}
          </p>
          <p class="mt-0.5 text-xs text-muted">
            {{ sector.description }}
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <UBadge color="error" variant="subtle" :label="`${sector.threat.toFixed(1)}x threat`" />
            <UBadge color="success" variant="subtle" :label="`${sector.reward.toFixed(1)}x reward`" />
            <UBadge color="neutral" variant="subtle" :label="`${sector.mineTimeMult.toFixed(2)}x cut time`" />
            <UBadge color="neutral" variant="subtle" :label="`Power ${sector.recommendedPower}+`" />
          </div>
        </div>
        <p class="text-xs text-muted">
          A sector unlocks once you extract successfully from the one before it — dying in sector 1 forever is a
          valid, if slow, strategy.
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
          <UBadge class="mt-2" :color="resource.kind === 'ore' ? 'info' : 'warning'" variant="subtle" :label="resource.kind === 'ore' ? 'Mined from rocks' : 'Dropped by kills'" />
        </div>
      </div>
      <p class="mt-3 text-xs text-muted">
        Ore pays for the boat — hull, shields, cargo, mining gear and new chassis. Salvage pays for the offence —
        engines, gun calibration, reload and turrets.
      </p>
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
          <UBadge color="neutral" variant="subtle" :label="`${(rock.mineMs / 1000).toFixed(0)}s base cut`" />
        </div>
        <p class="text-xs text-muted">
          Cut time is base × sector modifier × your Laser Focus level × your hull's mining modifier. Rarer ore takes
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
              <UBadge v-if="enemy.boss" class="ml-1" color="error" variant="subtle" label="Capital" />
            </p>
            <div class="flex flex-wrap gap-1">
              <UBadge color="neutral" variant="subtle" :label="`${enemy.hp} hp`" />
              <UBadge color="neutral" variant="subtle" :label="`${enemy.speed} m/s`" />
              <UBadge color="neutral" variant="subtle" :label="`${enemy.vision} m vision`" />
            </div>
          </div>
          <p class="mt-1 text-xs text-muted">
            {{ enemy.description }}
          </p>
          <div v-if="enemy.abilities.length" class="mt-2 flex flex-wrap gap-1">
            <UBadge v-for="ability in enemy.abilities" :key="ability" color="warning" variant="subtle" class="capitalize" :label="ability" />
          </div>
        </div>
        <ul class="space-y-1 text-xs text-muted">
          <li><strong>Shockwave</strong> — a ring is painted on the field, then it expands. It's a band, not a disc: dive inside it or outrun it.</li>
          <li><strong>Rail beam</strong> — a thin charge line points at where you were. Move perpendicular to it.</li>
          <li><strong>Reinforce</strong> — the Dreadnought spits out interceptors. Kill the capital, not the escorts.</li>
        </ul>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <p class="flex items-center gap-2 font-bold">
          <UIcon name="i-lucide-crosshair" class="size-4 text-primary" /> Turrets
        </p>
      </template>
      <div class="space-y-3">
        <p class="text-sm">
          You buy a rarity; the gun is rolled when you pay. Higher rarities roll more affixes and scale every roll
          harder. Your primary cannon is the bulk of your damage, but turrets fire independently and never stop.
        </p>
        <div class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="rarity in VOID_RARITIES"
            :key="rarity.id"
            variant="subtle"
            color="neutral"
            :style="{ color: rarity.hex }"
            :label="`${rarity.name} · ${rarity.affixCount} affixes · ${rarity.power.toFixed(2)}x rolls`"
          />
        </div>
        <div>
          <p class="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
            Affix pool
          </p>
          <div class="flex flex-wrap gap-1">
            <UBadge
              v-for="affix in VOID_AFFIXES"
              :key="affix.id"
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
            <UBadge color="neutral" variant="subtle" :label="`${ship.speedMult.toFixed(2)}x speed`" />
            <UBadge color="neutral" variant="subtle" :label="`${ship.turnMult.toFixed(2)}x turn`" />
            <UBadge color="neutral" variant="subtle" :label="`${ship.cargoMult.toFixed(2)}x cargo`" />
            <UBadge color="neutral" variant="subtle" :label="`${ship.hullMult.toFixed(2)}x hull`" />
            <UBadge color="neutral" variant="subtle" :label="`${ship.turretSlots} turrets`" />
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
          <div>
            <p class="flex items-center gap-1.5 text-sm font-bold">
              <UIcon :name="upgrade.icon" class="size-4 text-primary" /> {{ upgrade.name }}
            </p>
            <p class="text-xs text-muted">
              {{ upgrade.description }}
            </p>
          </div>
          <div class="flex gap-1">
            <UBadge :color="upgrade.funding === 'ore' ? 'info' : 'warning'" variant="subtle" :label="upgrade.funding === 'ore' ? 'Ore' : 'Salvage'" />
            <UBadge color="neutral" variant="subtle" :label="`Max ${upgrade.maxLevel}`" />
          </div>
        </div>
      </div>
    </UCard>
  </UContainer>
</template>
