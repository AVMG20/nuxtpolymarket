<template>
    <div class="vh">
        <!-- Top bar -->
        <header class="vh-top">
            <NuxtLink to="/" class="vh-leave" @click="$emit('sound', 'ui')">
                <UIcon name="i-lucide-chevron-left" class="size-4" />
                <span class="vh-leave-label">Leave</span>
            </NuxtLink>
            <div class="vh-brand">VOID<span>RUNNER</span></div>
            <nav class="vh-tabs">
                <button
                    v-for="t in tabs"
                    :key="t.id"
                    class="vh-tab"
                    :class="{ 'vh-tab-on': tab === t.id }"
                    :title="t.label"
                    @click="setTab(t.id)"
                >
                    <UIcon :name="t.icon" class="size-4" />
                    <span class="vh-tab-label">{{ t.label }}</span>
                </button>
            </nav>
            <button class="vh-mute" :title="muted ? 'Unmute' : 'Mute'" @click="$emit('toggle-mute')">
                <UIcon :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-4" />
            </button>
            <div class="vh-rank" :title="`Pilot level ${state.pilot.level}`">
                <div class="vh-rank-badge">{{ state.pilot.level }}</div>
                <div>
                    <div class="vh-rank-name">{{ rank.name }}</div>
                    <div class="vh-rank-bar"><div :style="{ width: `${rank.progress * 100}%` }" /></div>
                </div>
            </div>
            <div class="vh-wallet">
                <div class="vh-coins" title="Coins">
                    <UIcon name="i-lucide-coins" class="size-4" />
                    <span>{{ formatNumber(state.balance) }}</span>
                </div>
                <div class="vh-coins vh-gems" title="Gems">
                    <UIcon name="i-lucide-gem" class="size-4" />
                    <span>{{ formatNumber(state.gems) }}</span>
                </div>
                <div class="vh-res">
                    <div v-for="r in state.resourceCatalog" :key="r.id" class="vh-res-chip" :title="`${r.name}: ${r.description}`" :class="{ 'vh-dim': !held(r.id) }">
                        <i class="vr-gem" :style="{ '--c': hex(r.color) }" />
                        <span>{{ formatNumber(held(r.id)) }}</span>
                    </div>
                </div>
            </div>
        </header>

        <!-- Ship title over the showroom -->
        <section class="vh-title">
            <div class="vh-title-role">{{ shown.role }} <span v-if="!shown.owned">· preview</span></div>
            <div class="vh-title-name">{{ shown.name }}</div>
            <p class="vh-title-desc">{{ shown.description }}</p>
            <div class="vh-title-stats">
                <div><span>Power</span><b>{{ formatNumber(shown.power, false) }}</b></div>
                <div><span>Turrets</span><b>{{ shown.turrets }}</b></div>
                <div><span>Drones</span><b>{{ shown.stats.drones }}</b></div>
                <div v-if="shown.ability"><span>Ability</span><b>{{ abilityName(shown.ability) }}</b></div>
            </div>
            <div v-if="nextGoal && !previewShipId" class="vh-goal">
                <div class="vh-goal-kicker">Next goal</div>
                <div class="vh-goal-title">{{ nextGoal.title }}</div>
                <div class="vh-goal-need">
                    <template v-if="nextGoal.missing.length">
                        <span v-for="m in nextGoal.missing" :key="m.id"><i class="vr-gem" :style="{ '--c': m.hex }" />{{ formatNumber(m.amount) }} more {{ m.name }}</span>
                    </template>
                    <span v-else class="vh-goal-ready">Ready to build</span>
                </div>
            </div>
            <div v-if="!shown.owned" class="vh-title-cta">
                <button v-if="previewShipId" class="vr-btn vr-btn-sm" @click="$emit('preview', null)">Back to your ship</button>
            </div>
        </section>

        <!-- Launch bar -->
        <section class="vh-launch">
            <button class="vh-arrow" :disabled="sectorIndex <= 0" @click="stepSector(-1)">
                <UIcon name="i-lucide-chevron-left" class="size-5" />
            </button>
            <div class="vh-sector" :style="{ '--s1': hex(currentSector.palette[1]), '--s2': hex(currentSector.palette[2]) }">
                <div class="vh-sector-tier">Sector {{ currentSector.tier }} <span v-if="currentSector.cleared">· cleared</span></div>
                <div class="vh-sector-name">{{ currentSector.name }}</div>
                <div class="vh-sector-ores">
                    <i v-for="(w, id) in currentSector.ores" :key="id" class="vr-gem" :style="{ '--c': resHex(String(id)) }" :title="resName(String(id))" />
                    <span v-if="gearTier > 0 && gearTier < currentSector.tier - 0.5" class="vh-undergeared" :title="`Your gear averages T${gearTier.toFixed(1)}`">Needs T{{ currentSector.tier }} gear</span>
                    <span class="vh-threat">Threat ×{{ currentSector.threat }}</span>
                </div>
            </div>
            <button class="vh-arrow" :disabled="sectorIndex >= state.sectors.length - 1 || !state.sectors[sectorIndex + 1]?.unlocked" @click="stepSector(1)">
                <UIcon name="i-lucide-chevron-right" class="size-5" />
            </button>
            <button class="vh-go" :disabled="busy || !currentSector.unlocked" @click="$emit('launch', currentSector.tier)">
                <span>Launch</span>
                <small>{{ equipped.name }}</small>
            </button>
        </section>

        <!-- Side panel -->
        <aside class="vh-panel">
            <!-- Fitting -->
            <template v-if="tab === 'fitting'">
                <VoidFitting :state="state" :busy="busy" @set-fit="(shipId: string, fit: unknown) => $emit('set-fit', shipId, fit)" @buy-supply="(id: string, n: number) => $emit('buy-supply', id, n)" />
            </template>

            <!-- Workshop -->
            <template v-else-if="tab === 'workshop'">
                <VoidWorkshop
                    :state="state"
                    :busy="busy"
                    @craft="(k: string, t: string, tier: number) => $emit('craft', k, t, tier)"
                    @upgrade="(id: string) => $emit('upgrade-item', id)"
                    @salvage="(id: string) => $emit('salvage', id)"
                    @socket="(id: string, mod: string) => $emit('socket', id, mod)"
                />
            </template>

            <!-- Shipyard -->
            <template v-else-if="tab === 'shipyard'">
                <h2 class="vh-h">Shipyard <small>{{ ownedCount }} / {{ state.ships.length }} owned</small></h2>
                <div class="vh-list">
                    <div
                        v-for="ship in state.ships"
                        :key="ship.id"
                        class="vh-card vh-ship"
                        :class="{ 'vh-sel': shown.id === ship.id, 'vh-locked': !ship.unlocked && !ship.owned }"
                        @mouseenter="hoverShip(ship.id)"
                        @click="$emit('preview', ship.id === state.equippedShipId ? null : ship.id)"
                    >
                        <div class="vh-card-head">
                            <b>{{ ship.name }}</b>
                            <span class="vh-role">{{ ship.role }}</span>
                            <span v-if="ship.equipped" class="vh-tag vh-tag-good">Flying</span>
                            <span v-else-if="ship.owned" class="vh-tag">Owned</span>
                            <span v-else-if="!ship.unlocked" class="vh-tag vh-tag-bad">Clear sector {{ ship.requiresSector }}</span>
                        </div>
                        <div class="vh-kv">
                            <span>Turrets <b>{{ ship.turrets }}</b></span>
                            <span>Drones <b>{{ ship.stats.drones }}</b></span>
                            <span>Hull <b>{{ formatNumber(ship.stats.hull) }}</b></span>
                            <span>Speed <b>{{ Math.round(ship.stats.speed) }}</b></span>
                            <span>Cargo <b>{{ ship.stats.cargo }}</b></span>
                        </div>
                        <div v-if="!ship.equipped" class="vh-card-foot">
                            <template v-if="ship.owned">
                                <span />
                                <button class="vr-btn vr-btn-sm vr-btn-primary" :disabled="busy" @click.stop="$emit('equip', ship.id)">Fly this</button>
                            </template>
                            <template v-else>
                                <VoidCost :cost="ship.cost" :held="state.resources" :coins="ship.coins" :gems="ship.gems" :balance="state.balance" :gems-held="state.gems" />
                                <button class="vr-btn vr-btn-sm" :disabled="busy || !ship.unlocked || !ship.affordable" @click.stop="$emit('buy-ship', ship.id)">Build</button>
                            </template>
                        </div>
                    </div>
                </div>
            </template>

            <!-- Station -->
            <template v-else-if="tab === 'station'">
                <h2 class="vh-h">Station contracts <small>Resets in {{ resetIn }}</small></h2>
                <div class="vh-list">
                    <div v-for="c in state.contracts" :key="c.index" class="vh-card vh-contract" :class="{ 'vh-dim': c.done }">
                        <div class="vh-card-head">
                            <i class="vr-gem" :style="{ '--c': resHex(c.resource) }" />
                            <b>Deliver {{ formatNumber(c.amount, false) }} {{ resName(c.resource) }}</b>
                            <span v-if="c.done" class="vh-tag vh-tag-good">Delivered</span>
                        </div>
                        <div class="vh-card-foot">
                            <span class="vh-kv"><span>Pays <b>{{ formatNumber(c.coins) }}</b></span><span>XP <b>+{{ c.xp }}</b></span><span>Held <b>{{ formatNumber(held(c.resource)) }}</b></span></span>
                            <button v-if="!c.done" class="vr-btn vr-btn-sm" :disabled="busy || !c.affordable" @click="$emit('claim-contract', c.index)">Deliver</button>
                        </div>
                    </div>
                </div>
                <h2 class="vh-h">Ship systems <small>Fitted to every hull you own</small></h2>
                <div class="vh-list">
                    <div v-for="u in state.upgrades" :key="u.id" class="vh-card">
                        <div class="vh-card-head">
                            <b>{{ u.name }}</b>
                            <span class="vh-lvl">{{ voidMark(u.level) }}<template v-if="u.level < u.maxLevel"> → {{ voidMark(u.level + 1) }}</template></span>
                        </div>
                        <p>{{ u.description }}</p>
                        <div class="vh-pips">
                            <i v-for="n in u.maxLevel" :key="n" :class="{ 'vh-pip-on': n <= u.level }" />
                        </div>
                        <div class="vh-upg-effect">
                            <span>{{ u.current }}</span>
                            <template v-if="u.next">
                                <UIcon name="i-lucide-arrow-right" class="size-3" />
                                <b>{{ u.next }}</b>
                            </template>
                        </div>
                        <div v-if="u.cost" class="vh-card-foot">
                            <VoidCost :cost="u.cost.resources" :held="state.resources" :coins="u.cost.coins" :gems="u.cost.gems" :balance="state.balance" :gems-held="state.gems" />
                            <button class="vr-btn vr-btn-sm" :disabled="busy || !u.affordable" @click="$emit('upgrade', u.id)">Install</button>
                        </div>
                        <div v-else class="vh-maxed">Maxed</div>
                    </div>
                </div>
            </template>

            <!-- Skills -->
            <template v-else-if="tab === 'skills'">
                <VoidSkills
                    :skills="state.skills"
                    :equipped="state.equippedSkill"
                    :pilot="state.pilot"
                    :resources="state.resources"
                    :balance="state.balance"
                    :gems="state.gems"
                    :busy="busy"
                    @unlock="(id: string) => $emit('unlock-skill', id)"
                    @equip="(id: string) => $emit('equip-skill', id)"
                    @nodes="(id: string, nodes: string[]) => $emit('skill-nodes', id, nodes)"
                />
            </template>

            <!-- Market -->
            <template v-else-if="tab === 'market'">
                <h2 class="vh-h">Market <small>Sell surplus for coins</small></h2>
                <div class="vh-card vh-trade">
                    <div class="vh-card-head">
                        <UIcon name="i-lucide-handshake" class="size-4" />
                        <b>Trade Contracts</b>
                        <span class="vh-lvl">{{ state.trade.level }} / {{ state.trade.maxLevel }}</span>
                    </div>
                    <div class="vh-pips">
                        <i v-for="n in state.trade.maxLevel" :key="n" :class="{ 'vh-pip-on': n <= state.trade.level }" />
                    </div>
                    <div class="vh-upg-effect">
                        <span>×{{ state.trade.mult.toFixed(1) }} sell price</span>
                        <template v-if="state.trade.nextMult">
                            <UIcon name="i-lucide-arrow-right" class="size-3" />
                            <b>×{{ state.trade.nextMult.toFixed(1) }}</b>
                        </template>
                    </div>
                    <div v-if="state.trade.cost" class="vh-card-foot">
                        <VoidCost :cost="{}" :held="state.resources" :coins="state.trade.cost" :balance="state.balance" />
                        <button class="vr-btn vr-btn-sm" :disabled="busy || !state.trade.affordable" @click="$emit('buy-trade')">Sign</button>
                    </div>
                    <div v-else class="vh-maxed">Maxed</div>
                </div>
                <div class="vh-list">
                    <div v-for="r in state.resourceCatalog" :key="r.id" class="vh-card vh-market" :class="{ 'vh-dim': !held(r.id) }">
                        <div class="vh-card-head">
                            <i class="vr-gem" :style="{ '--c': hex(r.color) }" />
                            <b>{{ r.name }}</b>
                            <span class="vh-price">{{ formatNumber(state.prices[r.id]) }} / unit</span>
                        </div>
                        <div class="vh-card-foot">
                            <span class="vh-held">{{ formatNumber(held(r.id), false) }} held · {{ formatNumber(held(r.id) * state.prices[r.id]) }}</span>
                            <div class="vh-sell">
                                <button class="vr-btn vr-btn-sm" :disabled="busy || held(r.id) < 1" @click="$emit('sell', r.id, Math.min(500, held(r.id)))">Sell 500</button>
                                <button class="vr-btn vr-btn-sm" :disabled="busy || held(r.id) < 1" @click="$emit('sell', r.id, 'all')">All</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="vh-total">Stores worth <b>{{ formatNumber(storesValue) }}</b> coins</div>
            </template>

            <!-- Codex -->
            <template v-else-if="tab === 'codex'">
                <h2 class="vh-h">Flight manual</h2>
                <div class="vh-manual">
                    <p><b>The loop.</b> Launch into a sector, crack glowing asteroids for ore, loot wrecks and kills, then dock at the station or a beacon to bank the hold. Die and the hold is gone.</p>
                    <p><b>Gear.</b> Guns, turrets, armour and shields are crafted in the Workshop from the materials of their tier. Every craft rolls a rarity with bonus stats, and every item levels to +10. Each sector you clear opens the next gear tier, and deeper sectors need it.</p>
                    <p><b>Relics.</b> Elites, wardens and vaults sometimes drop a golden relic cache. Bank it at a dock to reveal a mod, then socket it into gear for a unique effect.</p>
                    <p><b>Progress.</b> Hulls add slots, skills add a second weapon, station systems improve hauling, and contracts pay a premium for deliveries every day.</p>
                    <p><b>Combat.</b> Turrets pick targets on their own; your crosshair tells them what matters most. Elites carry a gold halo and drop far more loot.</p>
                </div>
                <h2 class="vh-h">Hostiles</h2>
                <div class="vh-list">
                    <div v-for="enemy in codex" :key="enemy.kind" class="vh-card" :style="{ '--c': hex(enemy.glow) }">
                        <div class="vh-card-head">
                            <i class="vh-dotc" />
                            <b>{{ enemy.name }}</b>
                            <span v-if="enemy.elite" class="vh-tag">Elite</span>
                        </div>
                        <p>{{ enemy.tell }}</p>
                        <div class="vh-kv">
                            <span>Hull <b>{{ enemy.hp }}</b></span>
                            <span>First seen <b>Sector {{ enemy.firstSector }}</b></span>
                        </div>
                    </div>
                </div>
                <h2 class="vh-h">Wardens</h2>
                <div class="vh-list">
                    <div v-for="s in state.sectors" :key="s.tier" class="vh-card" :class="{ 'vh-locked': !s.unlocked }">
                        <div class="vh-card-head">
                            <span class="vh-tier">{{ s.tier }}</span>
                            <b>{{ s.warden }}</b>
                            <span v-if="s.cleared" class="vh-tag vh-tag-good">Destroyed</span>
                        </div>
                        <p>Guards {{ s.name }}. Radial barrages, homing missiles, sweeping beams below two thirds hull, and swarms of Mites when cornered.</p>
                    </div>
                </div>
            </template>

            <!-- Records -->
            <template v-else-if="tab === 'records'">
                <h2 class="vh-h">Service record</h2>
                <div class="vh-record">
                    <div><span>Runs</span><b>{{ state.runsPlayed }}</b></div>
                    <div><span>Extractions</span><b>{{ state.extractions }}</b></div>
                    <div><span>Kills</span><b>{{ formatNumber(state.kills) }}</b></div>
                    <div><span>Wardens</span><b>{{ state.wardensKilled }}</b></div>
                    <div><span>Best haul</span><b>{{ formatNumber(state.bestHaulValue) }}</b></div>
                    <div><span>Sold</span><b>{{ formatNumber(state.totalSold) }}</b></div>
                </div>
                <h2 class="vh-h">Leaderboard</h2>
                <div class="vh-table">
                    <div v-for="row in leaderboard" :key="row.rank" class="vh-row" :class="{ 'vh-me': row.isCurrentUser }">
                        <span class="vh-rank">{{ row.rank }}</span>
                        <span class="vh-who">{{ row.name }}<small>{{ row.shipName }}</small></span>
                        <span>S{{ row.cleared }}</span>
                        <b>{{ formatNumber(row.bestHaulValue) }}</b>
                    </div>
                    <div v-if="!leaderboard.length" class="vh-hint">No runners yet.</div>
                </div>
                <h2 class="vh-h">Recent runs</h2>
                <div class="vh-table">
                    <div v-for="r in history" :key="r.id" class="vh-row">
                        <span class="vh-rank" :class="r.extracted ? 'vh-ok' : 'vh-ko'">{{ r.extracted ? '✓' : '✕' }}</span>
                        <span class="vh-who">S{{ r.sector }} · {{ shipName(r.shipId) }}<small>{{ clock(r.durationMs) }} · {{ r.kills }} kills<template v-if="r.wardenKilled"> · warden</template></small></span>
                        <span />
                        <b>{{ formatNumber(r.haulValue) }}</b>
                    </div>
                    <div v-if="!history.length" class="vh-hint">No runs logged.</div>
                </div>
            </template>
        </aside>
    </div>
</template>

<script setup lang="ts">
import type { InternalApi } from 'nitropack/types'
import {
    VOID_ABILITIES, voidHex, voidMark, voidResource, voidShip,
    type VoidAbilityId, type VoidResourceId, type VoidUpgradeId
} from '#shared/utils/gamelogic/void'
import type { VoidSfx } from '~/utils/void/audio'
import { ENEMIES } from '~/utils/void/data'
import VoidCost from './VoidCost.vue'
import VoidSkills from './VoidSkills.vue'
import VoidFitting from './VoidFitting.vue'
import VoidWorkshop from './VoidWorkshop.vue'

type State = InternalApi['/api/void/state']['get']

const props = defineProps<{
    state: State
    busy: boolean
    previewShipId: string | null
    history: InternalApi['/api/void/history']['get']
    leaderboard: InternalApi['/api/void/leaderboard']['get']
    muted?: boolean
}>()

const emit = defineEmits<{
    'preview': [shipId: string | null]
    'launch': [tier: number]
    'equip': [shipId: string]
    'buy-ship': [shipId: string]
    'set-fit': [shipId: string, fit: unknown]
    'craft': [kind: string, type: string, tier: number]
    'upgrade-item': [itemId: string]
    'salvage': [itemId: string]
    'socket': [itemId: string, modId: string]
    'buy-supply': [supplyId: string, count: number]
    'claim-contract': [index: number]
    'upgrade': [id: VoidUpgradeId]
    'sell': [resource: string, amount: number | 'all']
    'tab': [tab: string]
    'sound': [sfx: VoidSfx]
    'toggle-mute': []
    'unlock-skill': [skillId: string]
    'equip-skill': [skillId: string]
    'skill-nodes': [skillId: string, nodes: string[]]
    'buy-trade': []
}>()

const tabs = [
    { id: 'fitting', label: 'Fitting', icon: 'i-lucide-crosshair' },
    { id: 'workshop', label: 'Workshop', icon: 'i-lucide-hammer' },
    { id: 'shipyard', label: 'Shipyard', icon: 'i-lucide-rocket' },
    { id: 'skills', label: 'Skills', icon: 'i-lucide-sparkles' },
    { id: 'station', label: 'Station', icon: 'i-lucide-satellite' },
    { id: 'market', label: 'Market', icon: 'i-lucide-coins' },
    { id: 'codex', label: 'Codex', icon: 'i-lucide-book-open' },
    { id: 'records', label: 'Records', icon: 'i-lucide-trophy' }
]
const tab = ref('fitting')
const codex = Object.values(ENEMIES).map(e => ({
    ...e,
    firstSector: e.kind === 'sentinel' ? 2 : e.weights.findIndex(w => w > 0) + 1
}))
const sectorIndex = ref(0)

watch(() => props.state.sectors, (sectors) => {
    // Default to the deepest open sector the first time we see the map.
    if (sectorIndex.value === 0) {
        const deepest = sectors.filter(s => s.unlocked).length - 1
        sectorIndex.value = Math.max(0, deepest)
    }
}, { immediate: true })

const RANKS = [
    ['Cadet', 1], ['Ensign', 3], ['Lieutenant', 6], ['Commander', 9], ['Captain', 13], ['Commodore', 17], ['Vice Admiral', 21], ['Admiral', 25]
] as const

/** Service rank follows the pilot level. */
const rank = computed(() => {
    const level = props.state.pilot.level
    let index = 0
    for (let i = 0; i < RANKS.length; i++) if (level >= RANKS[i]![1]) index = i
    return { name: RANKS[index]![0], progress: props.state.pilot.progress }
})

/** The cheapest next hull the pilot can work toward, and what they are short of. */
/** Average tier of the gear fitted to the equipped hull (0 with nothing fitted). */
const gearTier = computed(() => {
    const f = equipped.value.fit
    const ids = [f.gun, ...f.turrets, ...f.armor, ...f.shields].filter((id): id is string => !!id)
    const tiers = ids.map(id => props.state.items.find(i => i.id === id)?.tier ?? 0)
    return tiers.length ? tiers.reduce((a, b) => a + b, 0) / tiers.length : 0
})

const nextGoal = computed(() => {
    const s = props.state
    // New tier open and the ship still flies older gear: that is the next step.
    if (gearTier.value > 0 && gearTier.value < s.crafting.maxTier - 0.5) {
        return { title: `Craft T${s.crafting.maxTier} gear in the Workshop`, missing: [] as { id: string, name: string, hex: string, amount: number }[] }
    }
    const target = s.ships.find(ship => !ship.owned && ship.unlocked)
    if (!target) {
        const locked = s.ships.find(ship => !ship.owned)
        if (!locked) return null
        return { title: `Clear sector ${locked.requiresSector} to unlock the ${locked.name}`, missing: [] as { id: string, name: string, hex: string, amount: number }[] }
    }
    const held = s.resources as Record<string, number>
    const missing = Object.entries(target.cost as Record<string, number>)
        .map(([id, amount]) => ({ id, name: resName(id), hex: resHex(id), amount: amount - (held[id] ?? 0) }))
        .filter(m => m.amount > 0)
    return { title: `Build the ${target.name}`, missing }
})

const currentSector = computed(() => props.state.sectors[sectorIndex.value] ?? props.state.sectors[0]!)
const equipped = computed(() => props.state.ships.find(s => s.equipped) ?? props.state.ships[0]!)
const shown = computed(() => props.state.ships.find(s => s.id === (props.previewShipId ?? props.state.equippedShipId)) ?? equipped.value)
const ownedCount = computed(() => props.state.ships.filter(s => s.owned).length)
const storesValue = computed(() => props.state.resourceCatalog.reduce((sum, r) => sum + held(r.id) * props.state.prices[r.id], 0))

function setTab(id: string) {
    tab.value = id
    emit('tab', id)
    emit('sound', 'ui')
}

const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
    clockTimer = setInterval(() => {
        now.value = Date.now()
    }, 30_000)
})
onBeforeUnmount(() => clearInterval(clockTimer))

const resetIn = computed(() => {
    const ms = Math.max(0, new Date(props.state.contractsReset).getTime() - now.value)
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor(ms / 60_000) % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
})

function held(id: string) {
    return (props.state.resources as Record<string, number>)[id] ?? 0
}

function hex(color: number | undefined) {
    return voidHex(color ?? 0)
}

function resHex(id: string) {
    return voidHex(voidResource(id).color)
}

function resName(id: string) {
    return voidResource(id as VoidResourceId).name
}

function abilityName(id: string | null) {
    if (!id) return ''
    return VOID_ABILITIES[id as VoidAbilityId]?.name ?? id
}

function shipName(id: string) {
    return voidShip(id).name
}

function clock(ms: number) {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

let hoverTimer: ReturnType<typeof setTimeout> | undefined
function hoverShip(id: string) {
    clearTimeout(hoverTimer)
    hoverTimer = setTimeout(() => {
        if (id !== (props.previewShipId ?? props.state.equippedShipId)) emit('preview', id === props.state.equippedShipId ? null : id)
    }, 220)
}

function stepSector(delta: number) {
    const next = sectorIndex.value + delta
    if (next < 0 || next >= props.state.sectors.length || !props.state.sectors[next]!.unlocked) return
    sectorIndex.value = next
    emit('sound', 'ui')
}
</script>

<style>
.vh { position: absolute; inset: 0; pointer-events: none; }
.vh > * { pointer-events: auto; }

.vh-top { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 22px; padding: 14px 22px; background: linear-gradient(180deg, rgba(2, 5, 12, 0.85), rgba(2, 5, 12, 0)); }
.vh-leave { display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; letter-spacing: 0.15em; text-transform: uppercase; color: var(--vr-muted); transition: color 0.15s; }
.vh-leave:hover { color: var(--vr-text); }
.vh-brand { font-size: 20px; font-weight: 700; letter-spacing: 0.4em; white-space: nowrap; }
.vh-brand span { color: var(--vr-accent); margin-left: 0.25em; }
.vh-tabs { display: flex; gap: 2px; }
.vh-tab { display: flex; align-items: center; gap: 7px; padding: 8px 10px; white-space: nowrap; font-size: 13px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vr-muted); border-bottom: 2px solid transparent; transition: all 0.15s; cursor: pointer; }
.vh-tab:hover { color: var(--vr-text); }
.vh-tab-on { color: #fff; border-color: var(--vr-accent); text-shadow: 0 0 12px rgba(94, 200, 255, 0.6); }
.vh-mute { margin-left: auto; display: grid; place-items: center; width: 30px; height: 30px; color: var(--vr-muted); border: 1px solid var(--vr-line); cursor: pointer; }
.vh-mute:hover { color: var(--vr-text); border-color: var(--vr-line-strong); }
.vh-rank { margin-left: 12px; display: flex; align-items: center; gap: 9px; }
.vh-rank-badge { display: grid; place-items: center; width: 30px; height: 30px; font: 700 14px 'Rajdhani', sans-serif; color: var(--vr-gold); border: 1px solid rgba(255, 210, 122, 0.5); clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); background: rgba(255, 210, 122, 0.1); }
.vh-rank-name { font-size: 12px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; white-space: nowrap; }
.vh-rank-bar { width: 90px; height: 2px; margin-top: 3px; background: rgba(255, 255, 255, 0.1); }
.vh-rank-bar div { height: 100%; background: var(--vr-gold); }
.vh-wallet { margin-left: 14px; display: flex; align-items: center; gap: 14px; }
.vh-coins { display: flex; align-items: center; gap: 6px; padding: 5px 12px; border: 1px solid rgba(255, 210, 122, 0.35); color: var(--vr-gold); font: 600 14px 'JetBrains Mono', monospace; }
.vh-gems { border-color: rgba(196, 155, 255, 0.4); color: #d7b8ff; }
.vh-res { display: flex; gap: 10px; }
.vh-res-chip { display: flex; align-items: center; gap: 6px; font: 600 13px 'JetBrains Mono', monospace; }
.vh-dim { opacity: 0.4; }

.vh-title { position: absolute; left: 30px; top: 96px; width: min(420px, 34vw); pointer-events: none; }
.vh-title-role { font-size: 13px; font-weight: 700; letter-spacing: 0.4em; text-transform: uppercase; color: var(--vr-accent); }
.vh-title-name { font-size: clamp(44px, 6vw, 76px); line-height: 0.95; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; text-shadow: 0 0 40px rgba(94, 200, 255, 0.25); }
.vh-title-desc { margin-top: 10px; font-size: 16px; line-height: 1.35; color: rgba(230, 241, 255, 0.75); }
.vh-title-stats { display: flex; gap: 22px; margin-top: 16px; }
.vh-title-stats span { display: block; font-size: 10px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--vr-muted); }
.vh-title-stats b { font-size: 20px; font-weight: 700; }
.vh-title-cta { margin-top: 16px; pointer-events: auto; }
.vh-goal { margin-top: 18px; padding: 10px 14px; max-width: 360px; background: linear-gradient(90deg, rgba(255, 210, 122, 0.1), transparent); border-left: 2px solid var(--vr-gold); }
.vh-goal-kicker { font-size: 10px; font-weight: 700; letter-spacing: 0.35em; text-transform: uppercase; color: var(--vr-gold); }
.vh-goal-title { font-size: 17px; font-weight: 700; letter-spacing: 0.06em; }
.vh-goal-need { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 4px; font-size: 13px; color: rgba(230, 241, 255, 0.75); }
.vh-goal-need span { display: inline-flex; align-items: center; gap: 6px; }
.vh-goal-ready { color: var(--vr-good); font-weight: 700; }

.vh-launch { position: absolute; left: 30px; bottom: 30px; display: flex; align-items: stretch; gap: 8px; }
.vh-arrow { display: grid; place-items: center; width: 34px; border: 1px solid var(--vr-line); background: var(--vr-bg); color: var(--vr-text); cursor: pointer; }
.vh-arrow:disabled { opacity: 0.25; cursor: default; }
.vh-sector { position: relative; width: 300px; padding: 10px 16px; overflow: hidden; background: linear-gradient(120deg, color-mix(in srgb, var(--s1) 40%, transparent), rgba(6, 12, 24, 0.85) 70%); border: 1px solid color-mix(in srgb, var(--s2) 45%, transparent); }
.vh-sector-tier { font-size: 11px; font-weight: 700; letter-spacing: 0.35em; text-transform: uppercase; color: var(--s2); }
.vh-sector-name { font-size: 24px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
.vh-sector-ores { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.vh-undergeared { margin-left: auto; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--vr-warn); animation: vr-pulse 1.4s infinite; }
.vh-undergeared + .vh-threat { margin-left: 8px; }
.vh-threat { margin-left: auto; font: 600 11px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vh-go { display: flex; flex-direction: column; justify-content: center; padding: 0 34px; background: linear-gradient(100deg, #1b8fd6, #19c98c); color: #fff; clip-path: polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%); cursor: pointer; transition: filter 0.15s, transform 0.1s; box-shadow: 0 0 30px rgba(61, 200, 255, 0.35); }
.vh-go span { font-size: 26px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; }
.vh-go small { font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; opacity: 0.8; }
.vh-go:hover:not(:disabled) { filter: brightness(1.15); }
.vh-go:active:not(:disabled) { transform: translateY(1px); }
.vh-go:disabled { filter: grayscale(0.8) brightness(0.6); cursor: not-allowed; }

.vh-panel { position: absolute; right: 18px; top: 74px; bottom: 18px; width: min(410px, 36vw); padding: 6px 18px 18px; overflow-y: auto; background: linear-gradient(180deg, rgba(6, 12, 24, 0.82), rgba(6, 12, 24, 0.7)); border: 1px solid var(--vr-line); backdrop-filter: blur(10px); scrollbar-width: thin; scrollbar-color: rgba(120, 190, 255, 0.25) transparent; }
.vh-h { display: flex; align-items: baseline; gap: 10px; margin: 16px 0 10px; font-size: 14px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; }
.vh-h small { font-size: 11px; letter-spacing: 0.12em; color: var(--vr-muted); text-transform: none; }
.vh-list { display: grid; gap: 8px; }
.vh-card { position: relative; display: block; width: 100%; text-align: left; padding: 10px 12px; background: rgba(255, 255, 255, 0.025); border: 1px solid var(--vr-line); transition: border-color 0.15s, background 0.15s; }
.vh-card:hover { border-color: var(--vr-line-strong); background: rgba(255, 255, 255, 0.045); }
.vh-card p { margin: 4px 0 6px; font-size: 13px; line-height: 1.3; color: rgba(230, 241, 255, 0.65); }
.vh-card-head { display: flex; align-items: center; gap: 8px; font-size: 16px; }
.vh-card-head b { font-weight: 700; letter-spacing: 0.06em; }
.vh-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
.vh-kv { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--vr-muted); }
.vh-kv b { color: var(--vr-text); font-family: 'JetBrains Mono', monospace; font-weight: 600; }
.vh-tag { margin-left: auto; padding: 1px 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; border: 1px solid var(--vr-line-strong); color: var(--vr-muted); white-space: nowrap; }
.vh-tag-good { border-color: rgba(61, 255, 176, 0.5); color: var(--vr-good); }
.vh-tag-bad { border-color: rgba(255, 79, 109, 0.4); color: #ff9aac; }
.vh-role { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--vr-muted); }
.vh-sel { border-color: var(--vr-accent) !important; box-shadow: inset 2px 0 0 var(--vr-accent); }
.vh-locked { opacity: 0.55; }
.vh-ship { cursor: pointer; }
.vh-dotc { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--c); box-shadow: 0 0 8px var(--c); }

.vh-slots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.vh-slot { position: relative; }
.vh-slot-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--vr-line); border-left: 3px solid var(--c); cursor: pointer; transition: background 0.15s; }
.vh-slot-btn:hover, .vh-slot-open .vh-slot-btn { background: rgba(255, 255, 255, 0.07); }
.vh-slot-n { font: 600 11px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vh-slot-name { font-size: 14px; font-weight: 600; }
.vh-slot-menu { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 2px); display: grid; background: #081120; border: 1px solid var(--vr-line-strong); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); }
.vh-slot-menu button { display: flex; align-items: center; gap: 8px; padding: 7px 10px; text-align: left; font-size: 13px; font-weight: 600; cursor: pointer; }
.vh-slot-menu button:hover { background: rgba(255, 255, 255, 0.06); }
.vh-slot-menu .vh-on { color: var(--c); }
.vh-slot-menu .vh-dotc { width: 6px; height: 6px; }
.vh-fill { margin-top: 8px; }

.vh-stats { display: grid; gap: 6px; }
.vh-stat { display: grid; grid-template-columns: 76px 1fr 64px; align-items: center; gap: 10px; font-size: 13px; }
.vh-stat span { color: var(--vr-muted); }
.vh-stat b { text-align: right; font: 600 12px 'JetBrains Mono', monospace; }
.vh-stat-bar { height: 4px; background: rgba(255, 255, 255, 0.06); }
.vh-stat-bar div { height: 100%; background: linear-gradient(90deg, var(--vr-accent), var(--vr-good)); }

.vh-lvl { margin-left: auto; font: 600 12px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vh-pips { display: flex; gap: 3px; margin: 6px 0; }
.vh-pips i { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.08); }
.vh-pips .vh-pip-on { background: var(--vr-accent); box-shadow: 0 0 6px rgba(94, 200, 255, 0.6); }
.vh-upg-effect { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--vr-muted); }
.vh-upg-effect b { color: var(--vr-good); font-weight: 600; }
.vh-maxed { margin-top: 6px; font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; color: var(--vr-gold); }

.vh-price { margin-left: auto; font: 600 12px 'JetBrains Mono', monospace; color: var(--vr-gold); }
.vh-held { font-size: 12px; color: var(--vr-muted); font-family: 'JetBrains Mono', monospace; }
.vh-sell { display: flex; gap: 6px; }
.vh-total { margin-top: 14px; text-align: right; font-size: 14px; color: var(--vr-muted); }
.vh-total b { color: var(--vr-gold); font-family: 'JetBrains Mono', monospace; }

.vh-sector-card { cursor: pointer; background: linear-gradient(110deg, color-mix(in srgb, var(--s1) 35%, transparent), rgba(255, 255, 255, 0.02) 65%); }
.vh-sector-card:disabled { cursor: not-allowed; }
.vh-tier { display: grid; place-items: center; width: 22px; height: 22px; font: 700 12px 'JetBrains Mono', monospace; color: var(--s2); border: 1px solid var(--s2); }
.vh-ores { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; font-size: 12px; }
.vh-ores span { display: flex; align-items: center; gap: 6px; }
.vh-hint { margin-top: 10px; font-size: 13px; color: var(--vr-muted); }
.vh-manual { display: grid; gap: 8px; font-size: 14px; line-height: 1.4; color: rgba(230, 241, 255, 0.78); }
.vh-manual b { color: #fff; }

.vh-record { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.vh-record div { padding: 8px 10px; border: 1px solid var(--vr-line); background: rgba(255, 255, 255, 0.02); }
.vh-record span { display: block; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--vr-muted); }
.vh-record b { font: 600 16px 'JetBrains Mono', monospace; }
.vh-table { display: grid; gap: 2px; }
.vh-row { display: grid; grid-template-columns: 26px 1fr 34px 70px; align-items: center; gap: 8px; padding: 6px 8px; font-size: 13px; background: rgba(255, 255, 255, 0.02); }
.vh-row b { text-align: right; font: 600 12px 'JetBrains Mono', monospace; color: var(--vr-gold); }
.vh-me { box-shadow: inset 2px 0 0 var(--vr-accent); background: rgba(94, 200, 255, 0.08); }
.vh-rank { font: 600 12px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vh-who small { display: block; font-size: 11px; color: var(--vr-muted); }
.vh-ok { color: var(--vr-good); }
.vh-ko { color: var(--vr-bad); }

.vh-guns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
.vh-gun { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 7px 9px; text-align: left; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--vr-line); border-top: 2px solid var(--c); cursor: pointer; transition: background 0.15s; }
.vh-gun:hover { background: rgba(255, 255, 255, 0.07); }
.vh-gun span { font-size: 13px; font-weight: 700; line-height: 1.1; }
.vh-gun small { font: 600 10px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vh-gun .vh-dotc { width: 6px; height: 6px; }
.vh-gun-on { background: color-mix(in srgb, var(--c) 14%, transparent); box-shadow: inset 0 0 0 1px var(--c); }
.vh-gun-card { margin-top: 8px; }

/* Laptop widths: the top bar compacts in steps so nothing runs off screen. */
@media (max-width: 1850px) {
    .vh-res { display: none; }
    .vh-top { gap: 14px; }
}
@media (max-width: 1650px) {
    .vh-rank-name, .vh-rank-bar { display: none; }
    .vh-rank { margin-left: 4px; }
    .vh-brand { font-size: 17px; letter-spacing: 0.28em; }
    .vh-tab { padding: 8px 7px; gap: 5px; font-size: 12px; letter-spacing: 0.08em; }
    .vh-wallet { margin-left: 4px; gap: 8px; }
    .vh-coins { padding: 4px 9px; font-size: 13px; }
}
@media (max-width: 1400px) {
    .vh-tab-label, .vh-leave-label { display: none; }
    .vh-tab { padding: 8px 9px; }
}
@media (max-width: 1100px) {
    .vh-res { display: none; }
    .vh-tab-label { display: none; }
    .vh-title { display: none; }
}
</style>
