<script setup lang="ts">
import {
    PIRATE_ENEMY_TIERS,
    PIRATE_POWER_UPS,
    PIRATE_MAX_STAT_LEVEL,
    PIRATE_REGEN_MAX_LEVEL,
    PIRATE_REGEN_DELAY_MS,
    pirateMaxHp, pirateShipSpeed, pirateDefenseRating, pirateAmmoCapacity, pirateRegenRate,
    type PiratePowerUpId
} from '#shared/utils/gamelogic/pirates'

const shipSystems = [
    {
        id: 'hull',
        name: 'Hull',
        icon: 'i-lucide-heart',
        accent: 'text-red-400 bg-red-400/10',
        range: `${pirateMaxHp(1)} → ${pirateMaxHp(PIRATE_MAX_STAT_LEVEL)} HP`,
        levels: `${PIRATE_MAX_STAT_LEVEL} levels`,
        description: 'Your total health pool. Every enemy cannonball, bomb, ramming skiff, and sea mine chips away at it, and the voyage ends the instant it hits zero. A bigger hull is the single most reliable way to survive deeper into the run, and it also makes percentage-based hazards like sea mines hurt proportionally less of your bar.'
    },
    {
        id: 'speed',
        name: 'Speed',
        icon: 'i-lucide-wind',
        accent: 'text-cyan-400 bg-cyan-400/10',
        range: `${pirateShipSpeed(1)} → ${pirateShipSpeed(PIRATE_MAX_STAT_LEVEL)} spd`,
        levels: `${PIRATE_MAX_STAT_LEVEL} levels`,
        description: 'How fast your ship sails to wherever you tap. Nearly every enemy attack is dodgeable — bombs, missiles, mines, and skiffs all telegraph a marked area before they land — so raw movement speed is what lets you slip out of those circles and kite the final-minute swarm instead of being cornered by it.'
    },
    {
        id: 'defense',
        name: 'Defense',
        icon: 'i-lucide-shield',
        accent: 'text-blue-400 bg-blue-400/10',
        range: `${pirateDefenseRating(1)} → ${pirateDefenseRating(PIRATE_MAX_STAT_LEVEL)} def`,
        levels: `${PIRATE_MAX_STAT_LEVEL} levels`,
        description: 'Your defense rating in the hit-chance formula. Combat is RuneScape-style: every incoming cannonball rolls its attack rating against your defense roll, and a higher defense makes more of those shots miss outright rather than reducing the size of each hit. It does nothing against unavoidable hazards (mines and telegraphed area attacks) — it only shrugs off direct cannon fire.'
    },
    {
        id: 'ammoCapacity',
        name: 'Ammo Hold',
        icon: 'i-lucide-package',
        accent: 'text-amber-400 bg-amber-400/10',
        range: `${pirateAmmoCapacity(1)} → ${pirateAmmoCapacity(PIRATE_MAX_STAT_LEVEL)} rounds`,
        levels: `${PIRATE_MAX_STAT_LEVEL} levels`,
        description: 'How many premium cannonballs the magazine can carry into a voyage. Premium ammo hits harder and reaches farther than the unlimited basic shots your cannons fall back on once it runs dry, so a larger hold keeps your broadside at full strength for longer before you drop back to basic fire.'
    },
    {
        id: 'regen',
        name: 'Life Regen',
        icon: 'i-lucide-heart-pulse',
        accent: 'text-rose-400 bg-rose-400/10',
        range: `+${pirateRegenRate(1)} → +${pirateRegenRate(PIRATE_REGEN_MAX_LEVEL)} HP/s`,
        levels: `${PIRATE_REGEN_MAX_LEVEL} levels`,
        description: `Passive hull repair. Every captain owns level 1 (+${pirateRegenRate(1)} HP/sec) for free, upgrading up to +${pirateRegenRate(PIRATE_REGEN_MAX_LEVEL)} HP/sec. Regen only kicks in once your ship has been out of combat for ${PIRATE_REGEN_DELAY_MS / 1000} seconds — taking any hit or firing a single cannon shot resets the timer — so it tops you back up between fights while you disengage and reposition, never during a firefight.`
    }
]

definePageMeta({
    title: 'Pirate Raid Wiki'
})

const wildPowerUps = new Set<PiratePowerUpId>([
    'razor-orbit',
    'starburst-battery',
    'chain-tempest',
    'ghost-armada',
    'blood-tide'
])

const powerUpDetails: Record<PiratePowerUpId, string> = {
    'broadside-fury': 'Multiplies the damage ceiling of every equipped cannon. Multiple stacks combine, making this one of the cleanest ways to keep pace with late-run enemy health.',
    'quick-fuse': 'Cuts time between cannon shots. It affects every gun port independently and combines with Rapid Loader, up to the global reload-speed limit.',
    'eagle-eye': 'Extends cannon targeting range. Your ship can begin firing sooner and can hold a safer distance from short-range enemies.',
    'iron-plating': 'Raises the defense rating used when enemy cannon attacks roll to hit. It reduces how often ordinary cannonballs connect rather than reducing direct hazard damage.',
    'tide-shield': 'Immediately adds 20 shield points. The shield absorbs incoming damage before the hull and remains until depleted; repeated pickups refill and enlarge it up to 100.',
    'titan-shot': 'Makes periodic cannonballs enormous, dealing triple damage with a heavy impact. More stacks reduce the number of normal shots required before each Titan Shot.',
    'blast-powder': 'Makes periodic cannonballs explosive. The primary hit gains bonus damage and nearby enemies take splash damage; stacks make explosions trigger more often.',
    'deadeye': 'Improves the attack rating of every cannon, increasing its chance to overcome enemy defense. Especially useful against Ironclads, bosses, and late-run scaling.',
    'rapid-loader': 'A long-duration reload upgrade. Each stack gives another 10% reload speed and combines with Quick Fuse for extremely dense broadsides.',
    'keen-sights': 'A long-duration range upgrade. It is smaller per stack than Eagle’s Eye but lasts much longer and can build into a dependable ranged setup.',
    'reinforced-keel': 'Raises sailing speed by 10% per stack. Faster movement makes targeted circles, missiles, mines, and the final swarm easier to escape.',
    'lucky-shot': 'Adds 8% cannon damage per stack for a long duration. It is less explosive than Broadside Fury, but its long uptime makes it a reliable build foundation.',
    'razor-orbit': 'Summons spinning blades around your ship. Nearby enemies are repeatedly damaged; stacks add blades, increase damage, and make the orbit strike faster.',
    'starburst-battery': 'Automatically fires ten shots in a full circle. Each ray can acquire an enemy along its path; stacks increase damage and shorten the time between bursts.',
    'chain-tempest': 'Periodically releases automatic lightning from your ship and chains it through nearby enemies. Stacks add targets, increase damage, and reduce its cooldown.',
    'ghost-armada': 'Summons spectral escort boats that orbit the player and automatically fire at nearby targets. Stacks add escorts and accelerate their volleys.',
    'blood-tide': 'For a short window, every enemy you hit restores one point of your hull. Healing cannot exceed maximum hull.'
}

const enemyAbilities = [
    {
        id: 'skiffs',
        name: 'Kamikaze Skiffs',
        icon: 'i-lucide-sailboat',
        usedBy: 'Sloop, Razor Skiff, and the Dreadnought',
        description: 'Deploys three small boats toward positions around your location. A skiff explodes if it reaches its marked circle or rams your ship while travelling, so crossing its route is dangerous.'
    },
    {
        id: 'mine',
        name: 'Drift Mine',
        icon: 'i-lucide-circle-dot-dashed',
        usedBy: 'Brigantine, Cobalt Ironclad, and the Dreadnought',
        description: 'Launches a slow spinning mine toward your position. It damages its final marked area and also detonates immediately if your ship touches its moving path.'
    },
    {
        id: 'bomb',
        name: 'Frenzy Bomb',
        icon: 'i-lucide-bomb',
        usedBy: 'Crimson Corsair, Frigate, Man-o’-War, Ghost Ship, and the Dreadnought',
        description: 'Lobs a large bomb at your captured position. Its wide warning circle is the blast radius; leave the circle before the bomb lands.'
    },
    {
        id: 'sniper',
        name: 'Longshot Missile',
        icon: 'i-lucide-crosshair',
        usedBy: 'Longshot Schooner and the Dreadnought',
        description: 'Draws an aiming line and locks a circular target before firing. The projectile damages on contact anywhere along its route as well as at the locked destination.'
    }
]

const enemyInfo: Record<string, { role: string, ability: string, sprite: string, behavior: string }> = {
    sloop: {
        role: 'Starter raider',
        ability: 'Kamikaze Skiffs',
        sprite: '/pirates/sprites/raider-ship.png',
        behavior: 'A light, common ship with modest cannons. It becomes dangerous in groups because every Sloop can deploy three ramming skiffs.'
    },
    razorskiff: {
        role: 'High-speed chaser',
        ability: 'Kamikaze Skiffs',
        sprite: '/pirates/sprites/raider-ship.png',
        behavior: 'The fastest regular enemy. It rapidly closes distance, fires at short range, and adds more small attack boats to an already crowded sea.'
    },
    corsair: {
        role: 'Frenzy attacker',
        ability: 'Frenzy Bomb',
        sprite: '/pirates/sprites/dps-raider.png',
        behavior: 'A fragile damage dealer that fires three-shot volleys and throws large area bombs. Sink it quickly when several warning circles overlap.'
    },
    brigantine: {
        role: 'Balanced mine layer',
        ability: 'Drift Mine',
        sprite: '/pirates/sprites/raider-ship.png',
        behavior: 'A balanced midweight vessel with solid hull and frequent cannon fire. Its slow mines punish sailing carelessly across the battlefield.'
    },
    sniper: {
        role: 'Long-range specialist',
        ability: 'Longshot Missile',
        sprite: '/pirates/sprites/sniper-ship.png',
        behavior: 'Low hull, very long range, and extremely high single-hit damage. Watch its aiming line and avoid both the missile itself and its locked circle.'
    },
    ironclad: {
        role: 'Armored tank',
        ability: 'Drift Mine',
        sprite: '/pirates/sprites/tank-raider.png',
        behavior: 'Slow but exceptionally tough, with high defense and 300 base hull. It occupies your cannons while its mines restrict safe movement.'
    },
    frigate: {
        role: 'Heavy frenzy ship',
        ability: 'Frenzy Bomb',
        sprite: '/pirates/sprites/dps-raider.png',
        behavior: 'A durable three-shot attacker with strong range and fast reloads. Its bombs force movement while its broadside punishes predictable routes.'
    },
    manowar: {
        role: 'Late-run artillery',
        ability: 'Frenzy Bomb',
        sprite: '/pirates/sprites/dps-raider.png',
        behavior: 'A powerful late-run warship with heavy damage, long range, and rapid three-shot volleys. Prioritize it before the final overrun becomes crowded.'
    },
    ghostship: {
        role: 'Elite glass cannon',
        ability: 'Frenzy Bomb',
        sprite: '/pirates/sprites/raider-ship.png',
        behavior: 'A rare, fast elite with excellent accuracy, high damage, and very quick reloads. It pays well but can tear through an unattended hull.'
    },
    dreadnought: {
        role: 'Boss flagship',
        ability: 'Random: all four abilities',
        sprite: '/pirates/sprites/tank-raider.png',
        behavior: 'A massive boss with 700 base hull and three-shot broadsides. It randomly chooses any enemy ability, and two Dreadnoughts may be active after minute seven.'
    }
}

const enemies = PIRATE_ENEMY_TIERS.map(enemy => ({ ...enemy, ...enemyInfo[enemy.id]! }))

function durationLabel(durationMs: number | null) {
    if (durationMs === null) return 'Until depleted'
    return `${durationMs / 1000}s`
}

function unlockLabel(unlockAtMs: number, boss?: boolean) {
    if (boss) return 'Boss clock'
    if (unlockAtMs === 0) return 'From launch'
    const minutes = Math.floor(unlockAtMs / 60_000)
    const seconds = Math.floor((unlockAtMs % 60_000) / 1000)
    return minutes ? `${minutes}m ${seconds ? `${seconds}s` : ''}`.trim() : `${seconds}s`
}
</script>

<template>
  <UContainer class="space-y-10">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="flex items-center gap-2 text-2xl font-bold">
          <UIcon name="i-lucide-book-open" class="size-6 text-primary" />
          Pirate Wiki
        </h1>
        <p class="mt-1 max-w-2xl text-sm text-muted">
          Everything that can empower or sink you during an eight-minute voyage.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton size="sm" color="neutral" variant="subtle" to="#ship-systems" icon="i-lucide-ship" label="Ship systems" />
        <UButton size="sm" color="neutral" variant="subtle" to="#power-ups" icon="i-lucide-sparkles" label="Power-ups" />
        <UButton size="sm" color="neutral" variant="subtle" to="#enemy-abilities" icon="i-lucide-bomb" label="Enemy abilities" />
        <UButton size="sm" color="neutral" variant="subtle" to="#bestiary" icon="i-lucide-skull" label="Bestiary" />
      </div>
    </header>

    <section id="ship-systems" class="scroll-mt-6 space-y-4">
      <div>
        <p class="text-xs font-bold uppercase tracking-wider text-primary">
          Shipwright
        </p>
        <h2 class="mt-1 text-xl font-bold">
          Ship systems
        </h2>
        <p class="mt-1 text-sm text-muted">
          The four core stats and life regen are upgraded with coins in the Armory between voyages. Ranges below span level 1 to max.
        </p>
      </div>

      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <UCard v-for="system in shipSystems" :key="system.id" :ui="{ body: 'p-4' }">
          <div class="flex items-start gap-3">
            <div class="flex size-11 shrink-0 items-center justify-center rounded-xl" :class="system.accent">
              <UIcon :name="system.icon" class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="font-bold">
                {{ system.name }}
              </h3>
              <p class="mt-0.5 text-xs font-semibold text-primary">
                {{ system.range }}
              </p>
            </div>
          </div>
          <p class="mt-3 text-xs leading-relaxed text-muted">
            {{ system.description }}
          </p>
          <div class="mt-3 flex gap-2 border-t border-default pt-3">
            <UBadge color="neutral" variant="subtle" size="sm" icon="i-lucide-trending-up" :label="system.levels" />
          </div>
        </UCard>
      </div>
    </section>

    <section id="power-ups" class="scroll-mt-6 space-y-4">
      <div>
        <p class="text-xs font-bold uppercase tracking-wider text-primary">
          Supply drops
        </p>
        <h2 class="mt-1 text-xl font-bold">
          Power-ups
        </h2>
        <p class="mt-1 text-sm text-muted">
          A drop appears every 25 seconds. Duplicate drops stack up to their cap and refresh timed effects.
        </p>
      </div>

      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <UCard v-for="power in PIRATE_POWER_UPS" :key="power.id" :ui="{ body: 'p-4' }">
          <div class="flex items-start gap-3">
            <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-elevated text-xl">
              {{ power.icon }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <h3 class="font-bold">
                  {{ power.name }}
                </h3>
                <UBadge :color="wildPowerUps.has(power.id) ? 'primary' : 'neutral'" variant="subtle" size="sm" :label="wildPowerUps.has(power.id) ? 'Wild' : 'Core'" />
              </div>
              <p class="mt-0.5 text-xs font-semibold text-primary">
                {{ power.description }}
              </p>
            </div>
          </div>
          <p class="mt-3 text-xs leading-relaxed text-muted">
            {{ powerUpDetails[power.id] }}
          </p>
          <div class="mt-3 flex gap-2 border-t border-default pt-3">
            <UBadge color="neutral" variant="subtle" size="sm" icon="i-lucide-timer" :label="durationLabel(power.durationMs)" />
            <UBadge color="neutral" variant="subtle" size="sm" icon="i-lucide-layers" :label="`Max x${power.maxStacks}`" />
          </div>
        </UCard>
      </div>
    </section>

    <section id="enemy-abilities" class="scroll-mt-6 space-y-4">
      <div>
        <p class="text-xs font-bold uppercase tracking-wider text-error">
          Dodge mechanics
        </p>
        <h2 class="mt-1 text-xl font-bold">
          Enemy abilities
        </h2>
        <p class="mt-1 text-sm text-muted">
          Bosses may randomly use any ability. Moving projectiles can damage on contact before reaching their marked destination.
        </p>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <UCard v-for="ability in enemyAbilities" :key="ability.id" :ui="{ body: 'p-4' }">
          <div class="flex gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-error/10 text-error">
              <UIcon :name="ability.icon" class="size-5" />
            </div>
            <div>
              <h3 class="font-bold">
                {{ ability.name }}
              </h3>
              <p class="text-[11px] font-semibold text-error">
                {{ ability.usedBy }}
              </p>
            </div>
          </div>
          <p class="mt-3 text-sm leading-relaxed text-muted">
            {{ ability.description }}
          </p>
        </UCard>
      </div>
    </section>

    <section id="bestiary" class="scroll-mt-6 space-y-4">
      <div>
        <p class="text-xs font-bold uppercase tracking-wider text-warning">
          Enemy fleet
        </p>
        <h2 class="mt-1 text-xl font-bold">
          Bestiary
        </h2>
        <p class="mt-1 text-sm text-muted">
          Values below are base stats. Enemy hull, damage, accuracy, and defense scale with voyage time and your ship power.
        </p>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <UCard v-for="enemy in enemies" :key="enemy.id" :class="enemy.boss ? 'ring-2 ring-error/50' : ''" :ui="{ body: 'p-0' }">
          <div class="grid sm:grid-cols-[180px_1fr]">
            <div class="relative flex min-h-40 items-center justify-center overflow-hidden border-b border-default bg-gradient-to-br from-info/10 via-elevated to-error/10 p-6 sm:border-b-0 sm:border-r">
              <img :src="enemy.sprite" :alt="`${enemy.name} enemy ship`" class="w-full max-w-40 object-contain drop-shadow-xl" :class="enemy.boss ? 'scale-125' : ''">
              <UBadge class="absolute left-2 top-2" :color="enemy.boss ? 'error' : 'neutral'" variant="solid" size="sm" :label="unlockLabel(enemy.unlockAtMs, enemy.boss)" />
            </div>

            <div class="p-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 class="font-bold">
                    {{ enemy.name }}
                  </h3>
                  <p class="text-xs font-semibold text-primary">
                    {{ enemy.role }}
                  </p>
                </div>
                <UBadge color="error" variant="subtle" size="sm" icon="i-lucide-zap" :label="enemy.ability" />
              </div>

              <p class="mt-3 text-xs leading-relaxed text-muted">
                {{ enemy.behavior }}
              </p>

              <div class="mt-4 grid grid-cols-3 gap-2 border-t border-default pt-3 text-center">
                <div>
                  <p class="text-[9px] font-bold uppercase tracking-wide text-muted">Hull</p>
                  <p class="text-sm font-black tabular-nums">{{ enemy.hp }}</p>
                </div>
                <div>
                  <p class="text-[9px] font-bold uppercase tracking-wide text-muted">Defense</p>
                  <p class="text-sm font-black tabular-nums">{{ enemy.defense }}</p>
                </div>
                <div>
                  <p class="text-[9px] font-bold uppercase tracking-wide text-muted">Max hit</p>
                  <p class="text-sm font-black tabular-nums">{{ enemy.maxDamage }}</p>
                </div>
                <div>
                  <p class="text-[9px] font-bold uppercase tracking-wide text-muted">Range</p>
                  <p class="text-sm font-black tabular-nums">{{ enemy.range }}</p>
                </div>
                <div>
                  <p class="text-[9px] font-bold uppercase tracking-wide text-muted">Speed</p>
                  <p class="text-sm font-black tabular-nums">{{ enemy.speed }}</p>
                </div>
                <div>
                  <p class="text-[9px] font-bold uppercase tracking-wide text-muted">Reload</p>
                  <p class="text-sm font-black tabular-nums">{{ (enemy.reloadMs / 1000).toFixed(1) }}s</p>
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </section>
  </UContainer>
</template>
