<script setup lang="ts">
import {
    PIRATE_ENEMY_TIERS,
    PIRATE_POWER_UPS,
    PIRATE_RARITIES,
    PIRATE_UPGRADE_EFFECTS as FX,
    PIRATE_ABILITIES,
    PIRATE_ABILITY_MAX_LEVEL,
    PIRATE_MAX_STAT_LEVEL,
    PIRATE_REGEN_MAX_LEVEL,
    PIRATE_REGEN_DELAY_MS,
    PIRATE_REGEN_CYCLE_MS,
    PIRATE_RUN_DURATION_MS,
    PIRATE_POWER_UP_INTERVAL_MS,
    PIRATE_REPAIR_MAX_MS,
    pirateMaxHp, pirateShipSpeed, pirateDefenseRating, pirateAmmoCapacity, pirateRegenRate,
    pirateAverageRunPayoutEstimate, pirateCompletionBonus, pirateSurvivalCoinRate, pirateSurvivalCoins,
    type PirateEnemyAbility, type PiratePowerUpId
} from '#shared/utils/gamelogic/pirates'

definePageMeta({
    title: 'Pirate Raid Almanac'
})

const pct = (value: number) => `${Math.round(value * 100)}%`

// ─── The voyage ─────────────────────────────────────────────────────────────

const PAY_DIFFICULTY = 200
const payCurve = [1, 2, 3, 4, 5, 6].map(minute => ({
    minute,
    banked: pirateSurvivalCoins(minute * 60_000, PAY_DIFFICULTY),
    rate: pirateSurvivalCoinRate(minute * 60_000, PAY_DIFFICULTY)
}))
const payFull = pirateAverageRunPayoutEstimate(PAY_DIFFICULTY)
const payBonus = pirateCompletionBonus(PAY_DIFFICULTY)

// ─── Ship systems ───────────────────────────────────────────────────────────

const shipSystems = [
    {
        id: 'hull',
        name: 'Hull',
        icon: 'i-lucide-heart',
        color: '#f0524f',
        range: `${pirateMaxHp(1)} → ${pirateMaxHp(PIRATE_MAX_STAT_LEVEL)} HP`,
        description: 'Your health. Every cannonball, bomb, ram and mine takes a bite, and the voyage ends when it hits zero. Mines hurt by a share of it, so a bigger hull doesn\'t shrink them.'
    },
    {
        id: 'speed',
        name: 'Speed',
        icon: 'i-lucide-wind',
        color: '#2dd4bf',
        range: `${pirateShipSpeed(1)} → ${pirateShipSpeed(PIRATE_MAX_STAT_LEVEL)} spd`,
        description: 'Almost every special attack is marked on the water before it lands. Speed is what gets you out of the circle, and what lets you kite a swarm instead of being cornered.'
    },
    {
        id: 'defense',
        name: 'Armour',
        icon: 'i-lucide-shield',
        color: '#6cb8ff',
        range: `${pirateDefenseRating(1)} → ${pirateDefenseRating(PIRATE_MAX_STAT_LEVEL)} def`,
        description: 'Each enemy cannonball rolls its attack against your armour. More armour means more shots miss outright. It does nothing against marked blasts, rams or mines.'
    },
    {
        id: 'ammoCapacity',
        name: 'Ammo hold',
        icon: 'i-lucide-package',
        color: '#f3c35a',
        range: `${pirateAmmoCapacity(1)} → ${pirateAmmoCapacity(PIRATE_MAX_STAT_LEVEL)} rounds`,
        description: 'How much premium shot you carry. Premium shot hits harder and flies farther; once it runs out your guns keep firing basic shot for free.'
    },
    {
        id: 'regen',
        name: 'Regen',
        icon: 'i-lucide-heart-pulse',
        color: '#fb7185',
        range: `+${pirateRegenRate(1)} → +${pirateRegenRate(PIRATE_REGEN_MAX_LEVEL)} HP / ${PIRATE_REGEN_CYCLE_MS / 1000}s`,
        description: `Slow hull repair that starts after ${PIRATE_REGEN_DELAY_MS / 1000}s without being hit. Firing your own guns doesn't interrupt it.`
    }
]

// ─── Abilities ──────────────────────────────────────────────────────────────

// What each ability's damage keys off, so players can see why levels matter.
const ABILITY_SCALING: Record<string, string> = {
    bomb: 'One wide blast. Free, shortest cooldown.',
    seekers: '8 homing warheads, one every 2s. Heaviest single-target hits.',
    consort: 'An escort firing your best cannon. Cooldown starts when it sinks.',
    maelstrom: '7 pulses that drag ships inward. Most total damage on a packed fleet.',
    firestorm: '7 shells scattered at random over a huge zone. High risk, high ceiling.',
    tidal: 'A wall of water: one heavy hit and a shove to every ship, and it erases enemy shot and mines.'
}

const playerAbilities = PIRATE_ABILITIES.map(ability => ({
    ...ability,
    scaling: ABILITY_SCALING[ability.id] ?? '',
    accent: pirateAbilityHex(ability.id)
}))

// ─── Salvage ────────────────────────────────────────────────────────────────

const UPGRADE_DETAIL: Record<PiratePowerUpId, string[]> = {
    'oak-planking': [`+${pct(FX.oakHullPerStack)} max hull per stack, and the new planking comes repaired.`],
    'quick-hands': [`Every gun reloads ${pct(FX.quickHandsReloadPerStack)} faster per stack.`],
    'following-wind': [`+${pct(FX.followingWindSpeedPerStack)} sailing speed per stack and a sharper helm. Under full sail, ${pct(FX.followingWindEvasionPerStack)} of cannon fire per stack misses you.`],
    'crows-nest': [`+${pct(FX.crowsNestRangePerStack)} cannon range and +${pct(FX.crowsNestAccuracyPerStack)} accuracy per stack.`],
    'tide-ward': [`A shield worth ${pct(FX.tideWardShieldPerStack)} of max hull per stack. It absorbs hits first and refills after ${FX.tideWardRechargeDelayMs / 1000}s without being hit.`],
    'blast-powder': [`Hits deal +${pct(FX.blastDirect[0])} damage and splash ${pct(FX.blastSplash[0])} of it within ${FX.blastRadius[0]} of the target.`, `Second stack: +${pct(FX.blastDirect[1])}, splashing ${pct(FX.blastSplash[1])} within ${FX.blastRadius[1]}.`],
    'stormglass': [`${pct(FX.stormChance[0])} of hits arc lightning through up to ${FX.stormJumps} more ships within ${FX.stormRange}, each taking ${pct(FX.stormDamage)} damage.`, `Second stack: ${pct(FX.stormChance[1])} of hits.`],
    'ghost-crew': [`A spectral sloop sails with you, its ${FX.ghostCrewGuns} guns firing copies of your best cannon at ${pct(FX.ghostCrewDamage)} damage. A second stack adds a second sloop.`],
    'titan-shot': [`Every ${FX.titanEvery}th shot is a titan ball: ${FX.titanDamage}x damage and a shockwave that hits everything within ${FX.titanRadius}.`],
    'krakens-heart': [`+${pct(FX.heartDamage)} damage on everything, every enemy hull's worth of damage you deal mends ${(FX.heartLifesteal * 100).toFixed(1)}% of your own max hull, and your ability recharges ${pct(FX.heartCooldown)} faster.`]
}

const rarityGroups = PIRATE_RARITIES.map(rarity => ({
    ...rarity,
    hex: pirateHex(rarity.color),
    chance: rarity.weight / PIRATE_RARITIES.reduce((sum, r) => sum + r.weight, 0),
    upgrades: PIRATE_POWER_UPS.filter(upgrade => upgrade.rarity === rarity.id)
}))

// ─── Enemies ────────────────────────────────────────────────────────────────

const ENEMY_ABILITY_INFO: Record<PirateEnemyAbility, { name: string, icon: string, description: string }> = {
    skiffs: { name: 'Kamikaze Skiffs', icon: 'i-lucide-sailboat', description: 'Three small boats race for marked spots around you and explode on arrival, or on contact if you cross their path.' },
    bomb: { name: 'Frenzy Bomb', icon: 'i-lucide-bomb', description: 'A lobbed bomb aimed where you were. The warning circle is the blast. Leave it.' },
    mine: { name: 'Drift Mine', icon: 'i-lucide-circle-dot-dashed', description: 'A slow spinning mine that homes on your position and blows up on contact or at its mark.' },
    sniper: { name: 'Longshot', icon: 'i-lucide-crosshair', description: 'A reticle tightens on a spot, then a heavy round flies down the marked lane. It hits anything in its path.' },
    ram: { name: 'Fire Ram', icon: 'i-lucide-flame', description: 'The fire ship lights its fuse when it gets close and charges. It explodes on contact, or when sunk nearby.' },
    harpoon: { name: 'Harpoon', icon: 'i-lucide-link', description: 'A marked line, then a harpoon. If it hits, you are tethered and slowed for a few seconds.' },
    mortar: { name: 'Mortar Volley', icon: 'i-lucide-target', description: 'Three shells lobbed from far away at marked spots around you. Keep moving.' },
    ward: { name: 'Tide Ward', icon: 'i-lucide-shield', description: 'Shields every ship around the Tidecaller for part of its hull. Sink the Tidecaller first.' },
    tentacles: { name: 'Tentacle Slam', icon: 'i-lucide-waves', description: 'Tentacles rise from marked water and slam down.' },
    ink: { name: 'Ink Cloud', icon: 'i-lucide-cloud', description: 'Black ink spreads over the sea, slowing everything that sails through it.' },
    whirlpool: { name: 'Whirlpool', icon: 'i-lucide-tornado', description: 'A vortex that drags your ship toward the Kraken.' },
    blink: { name: 'Blink', icon: 'i-lucide-sparkles', description: 'The Phantom fades out and reappears somewhere else on the sea.' },
    summon: { name: 'Raise the Dead', icon: 'i-lucide-ghost', description: 'Ghost escorts rise around the admiral. They fade when it sinks.' },
    spiral: { name: 'Spiral Volley', icon: 'i-lucide-loader', description: 'A ring of spectral shot spirals outward. Find the gap.' }
}

const enemyAbilities = (Object.keys(ENEMY_ABILITY_INFO) as PirateEnemyAbility[]).map(id => ({
    id,
    ...ENEMY_ABILITY_INFO[id],
    usedBy: PIRATE_ENEMY_TIERS.filter(tier => tier.abilities.includes(id)).map(tier => tier.name).join(', ')
}))

const regularEnemies = PIRATE_ENEMY_TIERS.filter(tier => !tier.boss)
const bosses = PIRATE_ENEMY_TIERS.filter(tier => tier.boss).map(tier => ({ ...tier, accent: PIRATE_BOSS_ACCENTS[tier.boss!] ?? '#ef4444' }))

function unlockLabel(unlockAtMs: number) {
    if (unlockAtMs === 0) return 'From launch'
    return `From ${pirateClock(unlockAtMs)}`
}

const sections = [
    { id: 'voyage', label: 'The voyage', icon: 'i-lucide-hourglass' },
    { id: 'ship', label: 'Ship', icon: 'i-lucide-ship' },
    { id: 'abilities', label: 'Abilities', icon: 'i-lucide-wand-sparkles' },
    { id: 'salvage', label: 'Salvage', icon: 'i-lucide-package-open' },
    { id: 'tricks', label: 'Enemy tricks', icon: 'i-lucide-bomb' },
    { id: 'bestiary', label: 'Bestiary', icon: 'i-lucide-skull' },
    { id: 'bosses', label: 'Bosses', icon: 'i-lucide-crown' }
]
</script>

<template>
  <div class="mx-auto w-full max-w-7xl space-y-12 px-3 sm:px-6">
    <header class="space-y-4">
      <div>
        <p class="pr-heading text-xs">
          The Captain's
        </p>
        <h1 class="pr-display text-5xl leading-none sm:text-6xl">
          Almanac
        </h1>
        <p class="pr-muted mt-2 max-w-2xl text-sm">
          Everything that can make you rich or send you to the bottom in six minutes at sea.
        </p>
      </div>
      <nav class="flex flex-wrap gap-2">
        <a v-for="section in sections" :key="section.id" :href="`#${section.id}`" class="pr-btn pr-btn--wood pr-btn--sm">
          <UIcon :name="section.icon" class="size-4" />{{ section.label }}
        </a>
      </nav>
    </header>

    <!-- The voyage -->
    <section id="voyage" class="scroll-mt-6 space-y-4">
      <div>
        <p class="pr-heading text-xs">
          Pay & peril
        </p>
        <h2 class="pr-display text-3xl">
          The voyage
        </h2>
      </div>
      <div class="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div class="pr-parchment p-5 text-sm leading-relaxed">
          <p class="font-bold" style="font-family: Cinzel, serif">
            You're paid for staying afloat.
          </p>
          <p class="mt-2">
            A voyage lasts {{ PIRATE_RUN_DURATION_MS / 60_000 }} minutes. Coins land every second you survive and the rate climbs as the
            voyage goes on, so the last minutes are worth the most. Sinking ships doesn't pay; it keeps you alive.
          </p>
          <p class="mt-2">
            Survive the full voyage and you also earn the <b>completion bonus</b>. Sink early and you keep what you earned up to that point. <b>Letters of Marque</b> in the Armory multiply all of it: +20% per level, up to ×3.
          </p>
          <p class="mt-2">
            Higher difficulty pays more per second and brings tougher, busier fleets. Whatever hull you lose puts the ship in dry dock
            afterward, up to {{ PIRATE_REPAIR_MAX_MS / 3_600_000 }} hours for a sinking. Gems rush the repairs.
          </p>
          <p class="mt-2">
            A salvage crate drifts in about every {{ PIRATE_POWER_UP_INTERVAL_MS / 1000 }} seconds. Bosses always drop an epic or better.
          </p>
        </div>
        <div class="pr-panel p-5">
          <p class="pr-heading text-[11px]">
            Pay at difficulty {{ PAY_DIFFICULTY }}
          </p>
          <div class="mt-3 space-y-2">
            <div v-for="row in payCurve" :key="row.minute" class="flex items-center gap-3 text-sm">
              <span class="w-12 font-bold pr-muted">{{ row.minute }}:00</span>
              <div class="pr-bar h-2.5 flex-1">
                <i :style="{ width: `${row.banked / payFull * 100}%` }" />
              </div>
              <span class="w-16 text-right font-bold">{{ formatNumber(row.banked) }}</span>
              <span class="w-16 text-right text-xs text-[var(--pr-emerald)]">+{{ formatNumber(row.rate) }}/s</span>
            </div>
          </div>
          <div class="pr-divider my-4" />
          <div class="flex justify-between text-sm">
            <span class="pr-muted">Completion bonus</span>
            <b class="pr-gold">+{{ formatNumber(payBonus) }}</b>
          </div>
        </div>
      </div>
    </section>

    <!-- Ship systems -->
    <section id="ship" class="scroll-mt-6 space-y-4">
      <div>
        <p class="pr-heading text-xs">
          Shipwright
        </p>
        <h2 class="pr-display text-3xl">
          Ship systems
        </h2>
        <p class="pr-muted mt-1 text-sm">
          Upgraded with coins in the Armory between voyages. Ranges span level 1 to max.
        </p>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div v-for="system in shipSystems" :key="system.id" class="pr-panel p-4">
          <div class="flex items-center gap-3">
            <div class="grid size-10 shrink-0 place-items-center rounded-full pr-glow" :style="{ '--glow': system.color, 'color': system.color }">
              <UIcon :name="system.icon" class="size-5" />
            </div>
            <div class="min-w-0">
              <h3 class="font-bold">
                {{ system.name }}
              </h3>
              <p class="text-[11px] font-bold" :style="{ color: system.color }">
                {{ system.range }}
              </p>
            </div>
          </div>
          <p class="pr-muted mt-3 text-xs leading-relaxed">
            {{ system.description }}
          </p>
        </div>
      </div>
    </section>

    <!-- Abilities -->
    <section id="abilities" class="scroll-mt-6 space-y-4">
      <div>
        <p class="pr-heading text-xs">
          Captain's arsenal
        </p>
        <h2 class="pr-display text-3xl">
          Abilities
        </h2>
        <p class="pr-muted mt-1 max-w-3xl text-sm">
          Equip one per voyage and cast it with right-click or Space at the cursor. Each has {{ PIRATE_ABILITY_MAX_LEVEL }} levels; every level
          adds damage and shortens the cooldown.
        </p>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div v-for="ability in playerAbilities" :key="ability.id" class="pr-panel flex gap-4 p-4">
          <PiratesAbilityArt :id="ability.id" class="size-20 shrink-0" />
          <div class="min-w-0">
            <h3 class="pr-display text-2xl leading-tight" :style="{ color: ability.accent }">
              {{ ability.name }}
            </h3>
            <p class="text-[11px] font-bold pr-gold">
              {{ ability.scaling }}
            </p>
            <p class="pr-muted mt-1.5 text-xs leading-relaxed">
              {{ ability.description }}
            </p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span class="pr-tag" :style="{ '--tag': ability.accent }">
                <UIcon name="i-lucide-timer" class="size-3" />{{ ability.cooldownMs / 1000 }}s → {{ ability.minCooldownMs / 1000 }}s
              </span>
              <span class="pr-tag" style="--tag: #93a8b6">{{ ability.cost ? `${formatNumber(ability.cost)} coins` : 'Free' }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Salvage -->
    <section id="salvage" class="scroll-mt-6 space-y-4">
      <div>
        <p class="pr-heading text-xs">
          Flotsam & fortune
        </p>
        <h2 class="pr-display text-3xl">
          Salvage upgrades
        </h2>
        <p class="pr-muted mt-1 max-w-3xl text-sm">
          Sail over a crate to open it. Each holds one upgrade that lasts for the rest of the voyage, and some stack. The glow tells you the rarity
          before you get there.
        </p>
      </div>
      <div class="space-y-5">
        <div v-for="group in rarityGroups" :key="group.id">
          <div class="mb-2 flex items-center gap-3">
            <span class="pr-tag" :style="{ '--tag': group.hex }">{{ group.name }}</span>
            <span class="pr-dim text-[11px]">{{ Math.round(group.chance * 100) }}% of crates</span>
            <div class="h-px flex-1" :style="{ background: `linear-gradient(90deg, ${group.hex}66, transparent)` }" />
          </div>
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div
              v-for="upgrade in group.upgrades"
              :key="upgrade.id"
              class="pr-sea-panel pr-glow flex gap-4 p-4"
              :style="{ '--glow': `${group.hex}88` }"
            >
              <PiratesUpgradeArt :id="upgrade.id" class="size-20 shrink-0" :style="{ filter: `drop-shadow(0 0 10px ${group.hex}66)` }" />
              <div class="min-w-0">
                <h3 class="text-lg font-black" :style="{ color: group.hex }">
                  {{ upgrade.name }}
                </h3>
                <p class="pr-dim text-[11px] font-bold uppercase tracking-wider">
                  {{ upgrade.maxStacks > 1 ? `Stacks ${upgrade.maxStacks}×` : 'Unique' }}
                </p>
                <p v-for="(line, index) in UPGRADE_DETAIL[upgrade.id]" :key="index" class="mt-1 text-xs leading-relaxed" :class="index ? 'pr-muted' : ''">
                  {{ line }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Enemy tricks -->
    <section id="tricks" class="scroll-mt-6 space-y-4">
      <div>
        <p class="pr-heading text-xs">
          Know your enemy
        </p>
        <h2 class="pr-display text-3xl">
          Enemy tricks
        </h2>
        <p class="pr-muted mt-1 text-sm">
          Almost every special attack is marked on the water first. Red rings mean move.
        </p>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div v-for="trick in enemyAbilities" :key="trick.id" class="pr-panel flex gap-3 p-4">
          <div class="grid size-10 shrink-0 place-items-center rounded-full pr-glow text-[var(--pr-blood)]" style="--glow: #f0524f88">
            <UIcon :name="trick.icon" class="size-5" />
          </div>
          <div class="min-w-0">
            <h3 class="font-bold">
              {{ trick.name }}
            </h3>
            <p class="pr-muted mt-0.5 text-xs leading-relaxed">
              {{ trick.description }}
            </p>
            <p class="pr-dim mt-1.5 text-[11px]">
              {{ trick.usedBy }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Bestiary -->
    <section id="bestiary" class="scroll-mt-6 space-y-4">
      <div>
        <p class="pr-heading text-xs">
          Hostile sails
        </p>
        <h2 class="pr-display text-3xl">
          Bestiary
        </h2>
        <p class="pr-muted mt-1 text-sm">
          Base stats before difficulty and voyage time scale them up.
        </p>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div v-for="enemy in regularEnemies" :key="enemy.id" class="pr-panel overflow-hidden">
          <div class="relative h-28" :style="{ background: `radial-gradient(ellipse at center, ${pirateHex(enemy.color)}33, transparent 70%), linear-gradient(180deg, #0f2b3d, #0a1a27)` }">
            <PiratesShipPreview :tier-id="enemy.id" class="size-full" />
            <span class="pr-tag absolute left-3 top-3" style="--tag: #93a8b6">{{ unlockLabel(enemy.unlockAtMs) }}</span>
          </div>
          <div class="p-4">
            <h3 class="text-lg font-black" :style="{ color: pirateHex(enemy.color) }">
              {{ enemy.name }}
            </h3>
            <p class="pr-muted text-xs">
              {{ enemy.role }}
            </p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span v-for="trick in enemy.abilities" :key="trick" class="pr-tag" style="--tag: #f0524f">
                <UIcon :name="ENEMY_ABILITY_INFO[trick].icon" class="size-3" />{{ ENEMY_ABILITY_INFO[trick].name }}
              </span>
            </div>
            <div class="mt-3 grid grid-cols-6 gap-1 text-center">
              <div class="pr-inset px-1 py-1">
                <p class="pr-dim text-[9px] font-bold uppercase">Hull</p><p class="text-sm font-black">{{ enemy.hp }}</p>
              </div>
              <div class="pr-inset px-1 py-1">
                <p class="pr-dim text-[9px] font-bold uppercase">Def</p><p class="text-sm font-black">{{ enemy.defense }}</p>
              </div>
              <div class="pr-inset px-1 py-1">
                <p class="pr-dim text-[9px] font-bold uppercase">Hit</p><p class="text-sm font-black">{{ enemy.maxDamage || '—' }}</p>
              </div>
              <div class="pr-inset px-1 py-1">
                <p class="pr-dim text-[9px] font-bold uppercase">Range</p><p class="text-sm font-black">{{ enemy.range || '—' }}</p>
              </div>
              <div class="pr-inset px-1 py-1">
                <p class="pr-dim text-[9px] font-bold uppercase">Speed</p><p class="text-sm font-black">{{ enemy.speed }}</p>
              </div>
              <div class="pr-inset px-1 py-1">
                <p class="pr-dim text-[9px] font-bold uppercase">Reload</p><p class="text-sm font-black">{{ enemy.maxDamage ? `${(enemy.reloadMs / 1000).toFixed(1)}s` : '—' }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Bosses -->
    <section id="bosses" class="scroll-mt-6 space-y-4">
      <div>
        <p class="pr-heading text-xs">
          Here be monsters
        </p>
        <h2 class="pr-display text-3xl">
          Bosses
        </h2>
        <p class="pr-muted mt-1 text-sm">
          Bosses surface on their own clock and never the same one twice in a row. At high difficulty two can be at sea in the final minutes.
        </p>
      </div>
      <div class="grid gap-4 lg:grid-cols-3">
        <div v-for="boss in bosses" :key="boss.id" class="pr-panel pr-glow overflow-hidden" :style="{ '--glow': `${boss.accent}99` }">
          <div class="h-44" :style="{ background: `radial-gradient(ellipse at center, ${boss.accent}40, transparent 70%), linear-gradient(180deg, #0f2b3d, #050e17)` }">
            <PiratesShipPreview :tier-id="boss.id" animate class="size-full" />
          </div>
          <div class="p-5">
            <h3 class="pr-display text-3xl leading-tight" :style="{ color: boss.accent }">
              {{ boss.name }}
            </h3>
            <p class="pr-muted mt-1 text-xs leading-relaxed">
              {{ boss.role }}
            </p>
            <div class="mt-3 flex flex-wrap gap-1.5">
              <span v-for="trick in boss.abilities" :key="trick" class="pr-tag" :style="{ '--tag': boss.accent }">
                <UIcon :name="ENEMY_ABILITY_INFO[trick].icon" class="size-3" />{{ ENEMY_ABILITY_INFO[trick].name }}
              </span>
            </div>
            <div class="mt-3 flex flex-wrap gap-3 text-xs">
              <span><span class="pr-dim">Hull</span> <b>{{ boss.hp }}</b></span>
              <span><span class="pr-dim">Armour</span> <b>{{ boss.defense }}</b></span>
              <span><span class="pr-dim">Earliest</span> <b>{{ boss.unlockAtMs ? pirateClock(boss.unlockAtMs) : 'Any time' }}</b></span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
