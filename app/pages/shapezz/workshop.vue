<script setup lang="ts">
import {
    SHAPEZZ_WEAPON_TYPES,
    shapezzPlayerStats,
    shapezzWeapon,
    type ShapezzPermanentLevels,
    type ShapezzPermanentUpgradeId,
    type ShapezzWeaponType
} from '#shared/utils/gamelogic/shapezz'

definePageMeta({ title: 'SHAPEZZ Workshop' })

const toast = useToast()
const { fetchSession } = useAuth()
const { data: state, refresh } = await useFetch('/api/shapezz/state')
const activeWeaponType = ref<ShapezzWeaponType>('blaster')
const buyingUpgrade = ref<ShapezzPermanentUpgradeId | null>(null)
const buyingWeaponId = ref<string | null>(null)

type WorkshopState = NonNullable<typeof state.value>
type WorkshopWeapon = WorkshopState['weapons'][number]
type WorkshopUpgrade = WorkshopState['upgrades'][number]

const balance = computed(() => parseFloat(state.value?.balance ?? '0'))

// A run left behind by closing the game tab mid-run blocks every purchase
// ("Cannot buy a weapon during a run") — settle it as abandoned, same as the
// game page does on mount.
onMounted(async () => {
    if (!state.value?.activeRun) return
    try {
        await $fetch('/api/shapezz/finish-run', {
            method: 'POST',
            body: { reason: 'abandoned', elapsedMs: 0, coins: 0, kills: 0 }
        })
    } catch {
        // A concurrent request may already have cleared it; refreshing is enough.
    }
    await refresh()
})

// Chassis modules: a neon accent per track and the stat each level moves.
const MODULE_ACCENTS: Record<ShapezzPermanentUpgradeId, string> = {
    core: '#fb7185',
    overclock: '#fbbf24',
    armor: '#4ade80',
    thrusters: '#22d3ee',
    magnet: '#c084fc',
    killHeal: '#f43f5e'
}

const MODULE_STATS: Record<ShapezzPermanentUpgradeId, { label: string, value: (stats: ReturnType<typeof shapezzPlayerStats>) => string }> = {
    core: { label: 'Damage', value: stats => formatNumber(stats.damage, false) },
    overclock: { label: 'Fire rate', value: stats => `${stats.fireRate.toFixed(2)}/s` },
    armor: { label: 'Max HP', value: stats => formatNumber(stats.maxHp, false) },
    thrusters: { label: 'Speed', value: stats => formatNumber(stats.moveSpeed, false) },
    magnet: { label: 'Pull range', value: stats => formatNumber(stats.magnetRange, false) },
    killHeal: { label: 'HP / kill', value: stats => formatNumber(stats.healthPerKill, false) }
}

function moduleStat(upgrade: WorkshopUpgrade) {
    const id = upgrade.id as ShapezzPermanentUpgradeId
    const levels = state.value!.levels as ShapezzPermanentLevels
    const meta = MODULE_STATS[id]
    const now = meta.value(shapezzPlayerStats(levels))
    const next = upgrade.cost === null ? null : meta.value(shapezzPlayerStats({ ...levels, [id]: levels[id] + 1 }))
    return { label: meta.label, now, next }
}

// Weapon types are data-driven so new ones show up without touching this page.
const weaponTypes = SHAPEZZ_WEAPON_TYPES.map((type) => {
    const base = shapezzWeapon(type, 'common')
    return { type, icon: base.icon, label: base.name.slice(base.rarityName.length + 1) }
})

const ownedByType = computed(() => {
    const owned: Partial<Record<ShapezzWeaponType, WorkshopWeapon>> = {}
    for (const weapon of state.value?.weapons ?? []) {
        if (weapon.owned) owned[weapon.type] = weapon
    }
    return owned
})

const visibleWeapons = computed(() => state.value?.weapons.filter(weapon => weapon.type === activeWeaponType.value) ?? [])

const typeMaxima = computed(() => ({
    damage: Math.max(...visibleWeapons.value.map(weapon => weapon.damageMultiplier), 0.0001),
    fireRate: Math.max(...visibleWeapons.value.map(weapon => weapon.fireRateMultiplier), 0.0001)
}))

function weaponTraits(weapon: WorkshopWeapon) {
    switch (weapon.type) {
        case 'launcher': return [{ label: 'Blast radius', value: formatNumber(weapon.explosionRadius, false) }]
        case 'shotgun': return [
            { label: 'Seeker missiles', value: formatNumber(weapon.pellets, false) },
            { label: 'Blast radius', value: formatNumber(weapon.explosionRadius, false) }
        ]
        case 'arcCoil': return [
            { label: 'Range', value: formatNumber(weapon.chainRange, false) },
            { label: 'Chain jumps', value: formatNumber(weapon.chainCount, false) }
        ]
        case 'railgun': return [{ label: 'Pierce', value: 'Every target' }]
        default: return []
    }
}

function canAfford(netCost: number) {
    return balance.value >= Math.max(0, netCost)
}

function selectType(type: ShapezzWeaponType) {
    activeWeaponType.value = type
}

function onTabKey(event: KeyboardEvent, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = weaponTypes[(index + step + weaponTypes.length) % weaponTypes.length]!
    selectType(next.type)
    nextTick(() => document.getElementById(`wk-tab-${next.type}`)?.focus())
}

async function buyPermanentUpgrade(upgradeId: ShapezzPermanentUpgradeId) {
    if (buyingUpgrade.value) return
    buyingUpgrade.value = upgradeId
    try {
        await $fetch('/api/shapezz/upgrade', { method: 'POST', body: { upgradeId } })
        await Promise.all([refresh(), fetchSession()])
    } catch (error: unknown) {
        toast.add({ title: apiErrorMessage(error, 'Workshop upgrade failed'), color: 'error' })
    } finally {
        buyingUpgrade.value = null
    }
}

async function buyWeapon(weapon: WorkshopWeapon) {
    if (buyingWeaponId.value || weapon.equipped) return
    buyingWeaponId.value = weapon.id
    try {
        if (weapon.owned) {
            await $fetch('/api/shapezz/equip', { method: 'POST', body: { weaponType: weapon.type } })
            await refresh()
        } else {
            await $fetch('/api/shapezz/weapon', {
                method: 'POST',
                body: { weaponType: weapon.type, weaponRarity: weapon.rarity }
            })
            await Promise.all([refresh(), fetchSession()])
        }
    } catch (error: unknown) {
        toast.add({ title: apiErrorMessage(error, 'Weapon purchase failed'), color: 'error' })
    } finally {
        buyingWeaponId.value = null
    }
}
</script>

<template>
  <UContainer class="pb-12">
    <div class="wk-hangar">
      <div class="wk-backdrop" aria-hidden="true">
        <svg class="wk-poly wk-poly-a" viewBox="0 0 100 100"><polygon points="50,4 96,50 50,96 4,50" /><polygon points="50,20 80,50 50,80 20,50" /></svg>
        <svg class="wk-poly wk-poly-b" viewBox="0 0 100 100"><polygon points="50,3 93,27 93,73 50,97 7,73 7,27" /></svg>
        <svg class="wk-poly wk-poly-c" viewBox="0 0 100 100"><polygon points="50,6 95,88 5,88" /></svg>
        <svg class="wk-poly wk-poly-d" viewBox="0 0 100 100"><polygon points="50,4 97,38 79,94 21,94 3,38" /></svg>
      </div>

      <header class="wk-head">
        <div class="min-w-0">
          <p class="wk-kicker">SHAPEZZ · Hangar bay</p>
          <h1 class="wk-title">The Workshop</h1>
          <p class="wk-sub">Permanent chassis upgrades and increasingly unreasonable weapons.</p>
        </div>
        <div v-if="state" class="wk-readouts">
          <div class="wk-readout" style="--accent: #22d3ee">
            <UIcon name="i-lucide-zap" class="size-4" />
            <span class="wk-readout-label">Power</span>
            <span class="wk-readout-value">{{ formatNumber(state.power) }}</span>
          </div>
          <div class="wk-readout" style="--accent: #fbbf24">
            <UIcon name="i-lucide-coins" class="size-4" />
            <span class="wk-readout-label">Coins</span>
            <span class="wk-readout-value">{{ formatNumber(balance) }}</span>
          </div>
        </div>
      </header>

      <div v-if="!state" class="wk-loading">
        <USkeleton v-for="n in 3" :key="n" class="h-40 w-full rounded-none bg-white/5" />
      </div>

      <template v-else>
        <section class="wk-section" aria-labelledby="wk-chassis">
          <div class="wk-section-head">
            <h2 id="wk-chassis" class="wk-h2"><span class="wk-h2-mark" aria-hidden="true" />Chassis</h2>
            <p class="wk-note">Always active. Specialised tracks have shorter, pricier caps.</p>
          </div>

          <div class="wk-modules">
            <article
              v-for="upgrade in state.upgrades"
              :key="upgrade.id"
              class="wk-frame"
              :class="{ 'is-maxed': upgrade.cost === null }"
              :style="{ '--accent': MODULE_ACCENTS[upgrade.id as ShapezzPermanentUpgradeId] }"
            >
              <div class="wk-edge">
                <div class="wk-module">
                  <div class="flex items-start gap-3">
                    <div class="wk-hex"><UIcon :name="upgrade.icon" class="size-5" /></div>
                    <div class="min-w-0 flex-1">
                      <h3 class="wk-h3">{{ upgrade.name }}</h3>
                      <p class="wk-desc">{{ upgrade.description }}</p>
                    </div>
                  </div>

                  <div class="wk-meter-row">
                    <div
                      class="wk-meter"
                      role="meter"
                      :aria-label="`${upgrade.name} level`"
                      :aria-valuenow="upgrade.level"
                      aria-valuemin="0"
                      :aria-valuemax="upgrade.maxLevel"
                    >
                      <span v-for="pip in upgrade.maxLevel" :key="pip" class="wk-pip" :class="{ on: pip <= upgrade.level }" />
                    </div>
                    <span class="wk-level">{{ upgrade.level }}<span class="opacity-50">/{{ upgrade.maxLevel }}</span></span>
                  </div>

                  <div class="wk-stat">
                    <span class="wk-stat-label">{{ moduleStat(upgrade).label }}</span>
                    <span class="wk-stat-value">
                      {{ moduleStat(upgrade).now }}
                      <template v-if="moduleStat(upgrade).next">
                        <UIcon name="i-lucide-arrow-right" class="size-3 opacity-60" aria-label="next level" />
                        <span class="wk-stat-next">{{ moduleStat(upgrade).next }}</span>
                      </template>
                    </span>
                  </div>

                  <div v-if="upgrade.cost === null" class="wk-maxed">
                    <UIcon name="i-lucide-badge-check" class="size-4" /> Max level
                  </div>
                  <button
                    v-else
                    type="button"
                    class="wk-btn"
                    :disabled="!!buyingUpgrade || balance < upgrade.cost"
                    :aria-busy="buyingUpgrade === upgrade.id"
                    :aria-label="`Upgrade ${upgrade.name} for ${formatNumber(upgrade.cost)} coins`"
                    @click="buyPermanentUpgrade(upgrade.id as ShapezzPermanentUpgradeId)"
                  >
                    <UIcon v-if="buyingUpgrade === upgrade.id" name="i-lucide-loader-circle" class="size-4 animate-spin" />
                    <UIcon v-else name="i-lucide-coins" class="wk-coin size-3.5" />
                    {{ formatNumber(upgrade.cost) }}
                  </button>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section class="wk-section" aria-labelledby="wk-foundry">
          <div class="wk-section-head">
            <div class="min-w-0">
              <h2 id="wk-foundry" class="wk-h2"><span class="wk-h2-mark" aria-hidden="true" />Weapon foundry</h2>
              <p class="wk-note">Own one weapon of each type and switch freely. Upgrading within a type trades in 25% of what you paid for the previous tier.</p>
            </div>
            <div class="wk-equipped" :style="{ '--accent': state.currentWeapon.primaryColor }">
              <UIcon :name="state.currentWeapon.icon" class="size-5 shrink-0" />
              <div class="min-w-0">
                <p class="wk-readout-label">Equipped</p>
                <p class="wk-equipped-name">{{ state.currentWeapon.name }}</p>
              </div>
            </div>
          </div>

          <div class="wk-tabs" role="tablist" aria-label="Weapon type">
            <button
              v-for="(entry, index) in weaponTypes"
              :id="`wk-tab-${entry.type}`"
              :key="entry.type"
              type="button"
              role="tab"
              class="wk-tab"
              :class="{ active: activeWeaponType === entry.type }"
              :aria-selected="activeWeaponType === entry.type"
              aria-controls="wk-weapon-panel"
              :tabindex="activeWeaponType === entry.type ? 0 : -1"
              :style="{ '--accent': ownedByType[entry.type]?.primaryColor ?? '#64748b' }"
              @click="selectType(entry.type)"
              @keydown="onTabKey($event, index)"
            >
              <UIcon :name="entry.icon" class="size-4 shrink-0" />
              <span class="truncate">{{ entry.label }}</span>
              <span
                class="wk-tab-dot"
                :class="{ owned: ownedByType[entry.type] }"
                :title="ownedByType[entry.type]?.rarityName ?? 'Not owned'"
              />
            </button>
          </div>

          <div
            id="wk-weapon-panel"
            class="wk-weapons"
            role="tabpanel"
            :aria-labelledby="`wk-tab-${activeWeaponType}`"
          >
            <article
              v-for="weapon in visibleWeapons"
              :key="weapon.id"
              class="wk-frame wk-weapon-frame"
              :class="{ 'is-owned': weapon.owned, 'is-equipped': weapon.equipped }"
              :style="{
                '--accent': weapon.primaryColor,
                '--accent-2': weapon.accentColor,
                '--intensity': weapon.visualIntensity
              }"
            >
              <div class="wk-edge">
                <div class="wk-weapon">
                  <div class="wk-weapon-head">
                    <div class="wk-hex wk-hex-lg"><UIcon :name="weapon.icon" class="size-6" /></div>
                    <div class="flex flex-col items-end gap-1">
                      <span class="wk-rarity">{{ weapon.rarityName }}</span>
                      <span v-if="weapon.equipped" class="wk-flag wk-flag-equipped">Equipped</span>
                      <span v-else-if="weapon.owned" class="wk-flag">Owned</span>
                    </div>
                  </div>

                  <div class="wk-weapon-body">
                    <h3 class="wk-h3">{{ weapon.name }}</h3>
                    <p class="wk-desc wk-desc-clamp">{{ weapon.description }}</p>

                    <dl class="wk-bars">
                      <div class="wk-bar">
                        <dt>Damage</dt>
                        <dd>{{ weapon.damageMultiplier.toFixed(2) }}×</dd>
                        <span class="wk-bar-track" aria-hidden="true"><span :style="{ width: `${(weapon.damageMultiplier / typeMaxima.damage) * 100}%` }" /></span>
                      </div>
                      <div class="wk-bar">
                        <dt>Fire speed</dt>
                        <dd>{{ weapon.fireRateMultiplier.toFixed(2) }}×</dd>
                        <span class="wk-bar-track" aria-hidden="true"><span :style="{ width: `${(weapon.fireRateMultiplier / typeMaxima.fireRate) * 100}%` }" /></span>
                      </div>
                    </dl>

                    <dl class="wk-traits">
                      <div v-for="trait in weaponTraits(weapon)" :key="trait.label">
                        <dt>{{ trait.label }}</dt>
                        <dd>{{ trait.value }}</dd>
                      </div>
                    </dl>

                    <div class="mt-auto">
                      <p v-if="!weapon.owned && weapon.refund > 0" class="wk-tradein">
                        <UIcon name="i-lucide-repeat" class="size-3" />
                        <span>Trade-in</span>
                        <span class="ml-auto font-bold">−{{ formatNumber(weapon.refund) }}</span>
                      </p>

                      <button
                        type="button"
                        class="wk-btn"
                        :class="{ 'wk-btn-owned': weapon.owned, 'wk-btn-buy': !weapon.owned }"
                        :disabled="weapon.equipped || !!buyingWeaponId || (!weapon.owned && !canAfford(weapon.netCost))"
                        :aria-busy="buyingWeaponId === weapon.id"
                        @click="buyWeapon(weapon)"
                      >
                        <UIcon v-if="buyingWeaponId === weapon.id" name="i-lucide-loader-circle" class="size-4 animate-spin" />
                        <template v-if="weapon.equipped"><UIcon name="i-lucide-check" class="size-4" /> Equipped</template>
                        <template v-else-if="weapon.owned">Equip</template>
                        <template v-else-if="weapon.netCost < 0">Upgrade · receive {{ formatNumber(Math.abs(weapon.netCost)) }}</template>
                        <template v-else>
                          <UIcon v-if="buyingWeaponId !== weapon.id" name="i-lucide-coins" class="wk-coin size-3.5" />
                          {{ formatNumber(weapon.netCost) }}
                        </template>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>
      </template>
    </div>
  </UContainer>
</template>

<style scoped>
/*
 * The hangar is always the arena's night sky, in light and dark mode alike,
 * so text inside uses its own light-on-indigo palette.
 */
.wk-hangar {
    --wk-cut: 14px;
    --wk-text: #eef2ff;
    --wk-muted: rgb(199 210 254 / 68%);
    --wk-faint: rgb(165 180 252 / 22%);
    --wk-panel: rgb(10 8 34 / 88%);
    --wk-cyan: #22d3ee;
    position: relative;
    isolation: isolate;
    container-type: inline-size;
    overflow: hidden;
    padding: clamp(16px, 3vw, 32px);
    color: var(--wk-text);
    background:
        radial-gradient(40% 50% at 12% 10%, rgb(109 40 217 / 34%), transparent 70%),
        radial-gradient(38% 46% at 92% 8%, rgb(14 116 144 / 32%), transparent 70%),
        radial-gradient(50% 50% at 60% 70%, rgb(190 24 93 / 16%), transparent 70%),
        radial-gradient(30% 40% at 6% 90%, rgb(29 78 216 / 20%), transparent 70%),
        linear-gradient(180deg, #04020f 0%, #090d26 50%, #0d0b2a 82%, #05070f 100%);
    clip-path: polygon(0 0, calc(100% - 28px) 0, 100% 28px, 100% 100%, 28px 100%, 0 calc(100% - 28px));
}

.wk-hangar::before,
.wk-hangar::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
}

/* Faint arena grid, fading out towards the bottom. */
.wk-hangar::before {
    background-image:
        linear-gradient(rgb(34 211 238 / 7%) 1px, transparent 1px),
        linear-gradient(90deg, rgb(34 211 238 / 7%) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: linear-gradient(180deg, #000 0%, rgb(0 0 0 / 40%) 70%, transparent 100%);
}

/* Scanlines. */
.wk-hangar::after {
    background: repeating-linear-gradient(0deg, rgb(255 255 255 / 2.5%) 0 1px, transparent 1px 3px);
    mix-blend-mode: overlay;
}

.wk-backdrop {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
}

.wk-poly {
    position: absolute;
    fill: none;
    stroke-width: 1.2;
    opacity: 0.22;
    animation: wk-drift 36s ease-in-out infinite alternate;
}

.wk-poly-a { top: 4%; right: 6%; width: 150px; stroke: #22d3ee; }
.wk-poly-b { top: 38%; left: -40px; width: 210px; stroke: #a78bfa; animation-duration: 44s; }
.wk-poly-c { bottom: 8%; right: 18%; width: 120px; stroke: #f472b6; animation-duration: 30s; }
.wk-poly-d { top: 14%; left: 38%; width: 70px; stroke: #818cf8; opacity: 0.14; animation-duration: 52s; }

@keyframes wk-drift {
    from { transform: translateY(0) rotate(0deg); }
    to { transform: translateY(-18px) rotate(24deg); }
}

/* Header */
.wk-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 28px;
}

.wk-kicker {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--wk-cyan);
}

.wk-title {
    margin-top: 4px;
    font-size: clamp(30px, 6vw, 52px);
    line-height: 0.95;
    font-weight: 900;
    font-style: italic;
    letter-spacing: -0.03em;
    text-transform: uppercase;
    color: #fff;
    text-shadow: 0 0 22px rgb(34 211 238 / 55%), 0 0 60px rgb(167 139 250 / 35%);
}

.wk-sub {
    margin-top: 8px;
    font-size: 14px;
    color: var(--wk-muted);
}

.wk-readouts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.wk-readout,
.wk-equipped {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    color: var(--accent);
    background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, transparent), rgb(10 8 34 / 70%));
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
}

.wk-readout-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--wk-muted);
}

.wk-readout-value {
    font-size: 16px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    color: #fff;
    text-shadow: 0 0 12px color-mix(in srgb, var(--accent) 70%, transparent);
}

.wk-loading {
    display: grid;
    gap: 12px;
}

/* Sections */
.wk-section + .wk-section {
    margin-top: 40px;
}

.wk-section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
}

.wk-h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 20px;
    font-weight: 900;
    font-style: italic;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: #fff;
    text-shadow: 0 0 16px rgb(34 211 238 / 50%);
}

.wk-h2-mark {
    width: 14px;
    height: 14px;
    border: 2px solid var(--wk-cyan);
    transform: rotate(45deg);
    box-shadow: 0 0 10px var(--wk-cyan);
}

.wk-note {
    margin-top: 4px;
    max-width: 62ch;
    font-size: 13px;
    color: var(--wk-muted);
}

.wk-equipped {
    min-width: 0;
    max-width: 100%;
}

.wk-equipped-name {
    font-size: 14px;
    font-weight: 900;
    color: var(--accent);
    text-shadow: 0 0 12px color-mix(in srgb, var(--accent) 60%, transparent);
    overflow-wrap: anywhere;
}

/*
 * Chamfered neon panels: the frame carries the glow (a filter survives the
 * clip on its child), the edge paints a 1px gradient border, and the inner
 * panel is clipped to the same shape.
 */
.wk-frame {
    --chamfer: polygon(var(--wk-cut) 0, 100% 0, 100% calc(100% - var(--wk-cut)), calc(100% - var(--wk-cut)) 100%, 0 100%, 0 var(--wk-cut));
    display: flex;
    min-width: 0;
    transition: filter 0.2s ease, transform 0.2s ease;
    filter: drop-shadow(0 0 0 transparent);
}

.wk-frame:hover {
    filter: drop-shadow(0 0 10px color-mix(in srgb, var(--accent) 35%, transparent));
}

.wk-edge {
    flex: 1;
    display: flex;
    padding: 1px;
    clip-path: var(--chamfer);
    background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 80%, transparent), var(--wk-faint) 38%, var(--wk-faint) 62%, color-mix(in srgb, var(--accent) 55%, transparent));
}

.wk-module,
.wk-weapon {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    clip-path: var(--chamfer);
    background:
        radial-gradient(120% 60% at 0% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%),
        var(--wk-panel);
}

/* Chassis modules */
.wk-modules {
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr;
}

.wk-module {
    gap: 12px;
    padding: 16px;
}

.wk-hex {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 42px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, #05030f);
    clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 60%, transparent));
}

.wk-hex-lg {
    width: 48px;
    height: 54px;
}

.wk-h3 {
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 0.01em;
    text-transform: uppercase;
    color: #fff;
}

.wk-desc {
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--wk-muted);
}

.wk-desc-clamp {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: calc(12px * 1.45 * 3);
}

.wk-meter-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: auto;
}

.wk-meter {
    flex: 1;
    display: flex;
    gap: 2px;
    height: 12px;
}

.wk-pip {
    flex: 1;
    min-width: 0;
    background: rgb(255 255 255 / 8%);
    transform: skewX(-18deg);
}

.wk-pip.on {
    background: var(--accent);
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 80%, transparent);
}

.wk-level {
    font-size: 13px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    color: #fff;
}

.wk-stat {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
}

.wk-stat-label {
    color: var(--wk-muted);
}

.wk-stat-value {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
}

.wk-stat-next {
    color: var(--accent);
}

.wk-maxed {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 36px;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    text-shadow: 0 0 10px color-mix(in srgb, var(--accent) 80%, transparent);
    clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
}

.wk-frame.is-maxed .wk-edge {
    background: linear-gradient(145deg, var(--accent), color-mix(in srgb, var(--accent) 35%, transparent) 50%, var(--accent));
}

/* Buttons */
.wk-btn {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 36px;
    padding: 0 12px;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-variant-numeric: tabular-nums;
    color: #fff;
    cursor: pointer;
    background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 30%, #0b0a24), color-mix(in srgb, var(--accent) 16%, #0b0a24));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent);
    clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
    transition: background 0.15s ease, color 0.15s ease;
}

.wk-btn:hover:not(:disabled) {
    background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 50%, #0b0a24), color-mix(in srgb, var(--accent) 28%, #0b0a24));
}

.wk-btn:focus-visible,
.wk-tab:focus-visible {
    outline: 2px solid #fff;
    outline-offset: -4px;
}

.wk-btn:disabled {
    cursor: not-allowed;
    color: rgb(255 255 255 / 45%);
    background: rgb(255 255 255 / 5%);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 10%);
}

.wk-btn-owned {
    background: transparent;
}

.wk-frame.is-equipped .wk-btn:disabled {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent);
}

.wk-coin {
    color: #fbbf24;
}

.wk-btn:disabled .wk-coin {
    color: rgb(251 191 36 / 50%);
}

/* Weapon-type tabs */
.wk-tabs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
    gap: 6px;
    margin-bottom: 16px;
}

.wk-tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 42px;
    padding: 0 14px;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.15;
    text-align: left;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--wk-muted);
    cursor: pointer;
    background: rgb(255 255 255 / 4%);
    box-shadow: inset 0 0 0 1px var(--wk-faint);
    clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%);
    transition: color 0.15s ease, background 0.15s ease;
}

.wk-tab:hover {
    color: #fff;
    background: rgb(255 255 255 / 8%);
}

.wk-tab.active {
    color: #fff;
    background: linear-gradient(90deg, rgb(34 211 238 / 26%), rgb(167 139 250 / 22%));
    box-shadow: inset 0 0 0 1px rgb(34 211 238 / 70%), inset 0 -2px 0 var(--wk-cyan);
    text-shadow: 0 0 10px rgb(34 211 238 / 80%);
}

.wk-tab-dot {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    margin-left: auto;
    transform: rotate(45deg);
    border: 1px solid rgb(255 255 255 / 25%);
}

.wk-tab-dot.owned {
    border-color: var(--accent);
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
}

/* Rarity cards */
.wk-weapons {
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr;
}

.wk-weapon-frame.is-equipped {
    filter: drop-shadow(0 0 calc(4px + var(--intensity) * 2px) color-mix(in srgb, var(--accent) 55%, transparent));
}

.wk-weapon-frame.is-equipped .wk-edge {
    padding: 2px;
    background: linear-gradient(145deg, var(--accent-2), var(--accent) 40%, var(--accent));
}

.wk-weapon-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 14px 14px 18px;
    background:
        linear-gradient(180deg, color-mix(in srgb, var(--accent) calc(10% + var(--intensity) * 5%), transparent), transparent),
        repeating-linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent) 0 2px, transparent 2px 9px);
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
}

.wk-rarity {
    font-size: 11px;
    font-weight: 900;
    font-style: italic;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    text-shadow: 0 0 calc(4px + var(--intensity) * 3px) color-mix(in srgb, var(--accent) 80%, transparent);
}

.wk-flag {
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #bbf7d0;
    background: rgb(74 222 128 / 14%);
    box-shadow: inset 0 0 0 1px rgb(74 222 128 / 45%);
}

.wk-flag-equipped {
    color: #05030f;
    background: var(--accent);
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 70%, transparent);
}

.wk-weapon-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px 14px;
}

.wk-bars {
    display: grid;
    gap: 8px;
}

.wk-bar {
    display: grid;
    grid-template-columns: 1fr auto;
    row-gap: 4px;
    font-size: 11px;
}

.wk-bar dt,
.wk-traits dt {
    color: var(--wk-muted);
}

.wk-bar dd,
.wk-traits dd {
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    text-align: right;
}

.wk-bar-track {
    grid-column: 1 / -1;
    height: 4px;
    background: rgb(255 255 255 / 8%);
}

.wk-bar-track > span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 50%, transparent), var(--accent));
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 70%, transparent);
}

.wk-traits {
    display: grid;
    gap: 4px;
    font-size: 11px;
}

.wk-traits > div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
}

.wk-tradein {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    padding: 4px 8px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: #86efac;
    background: rgb(74 222 128 / 8%);
    border-left: 2px solid rgb(74 222 128 / 60%);
}

@container (min-width: 520px) {
    .wk-modules { grid-template-columns: repeat(2, 1fr); }
    .wk-weapons { grid-template-columns: repeat(2, 1fr); }
}

@container (min-width: 820px) {
    .wk-modules { grid-template-columns: repeat(3, 1fr); }
    .wk-weapons { grid-template-columns: repeat(3, 1fr); }
}

@container (min-width: 1080px) {
    .wk-weapons { grid-template-columns: repeat(5, 1fr); }
}

@container (min-width: 1180px) {
    .wk-modules { grid-template-columns: repeat(6, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
    .wk-poly {
        animation: none;
    }

    .wk-frame,
    .wk-btn,
    .wk-tab {
        transition: none;
    }
}
</style>
