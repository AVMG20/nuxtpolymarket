<script setup lang="ts">
import { townIsTyping } from '~/utils/town/camera'
import TownAsset from '~/components/town/TownAsset.vue'
import TownScene from '~/components/town/TownScene.client.vue'
import TownMarketPanel from '~/components/town/TownMarketPanel.vue'
import TownMilestonesPanel from '~/components/town/TownMilestonesPanel.vue'
import TownLeaderboardPanel from '~/components/town/TownLeaderboardPanel.vue'
import { formatTownDuration } from '~/utils/town-format'
import { TOWN_PLOT_SIZE, houseAdjacency, townLevelCost, townLevelBuildMs, townRushGemCost, getTownBuilding, type TownSimBuilding } from '#shared/utils/gamelogic/town'

const town = useTown()
const sound = useTownSound()
const toast = useToast()
const { user } = useAuth()

const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

// ── Clock (server-aligned) ──
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => { clock = setInterval(() => { now.value = Date.now() + town.serverOffsetMs.value }, 500) })
onBeforeUnmount(() => { if (clock) clearInterval(clock) })

// ── UI state ──
type Window = 'market' | 'goals' | 'mayors' | null
const windowOpen = ref<Window>(null)
const buildOpen = ref(false)
const buildTier = ref(0)
const ghostType = ref<string | null>(null)
const ghostRotation = ref(0)
function rotatePlacement() { ghostRotation.value = (ghostRotation.value + 1) % 4 }
const selectedBuildingId = ref<string | null>(null)
const marketResource = ref<string | null>(null)
const busy = ref(false)
const sceneRef = ref<InstanceType<typeof TownScene> | null>(null)
const hoveredBuildingId = ref<string | null>(null)
const hoveredSlot = ref<{ x: number, y: number } | null>(null)
const mouse = ref({ x: 0, y: 0 })

const selectedBuilding = computed(() => town.buildings.value.find(b => b.id === selectedBuildingId.value) ?? null)
const selectedEntry = computed(() => selectedBuilding.value ? town.catalogById.value.get(selectedBuilding.value.type) ?? null : null)
const hoveredBuilding = computed(() => town.buildings.value.find(b => b.id === hoveredBuildingId.value) ?? null)
const hoveredEntry = computed(() => hoveredBuilding.value ? town.catalogById.value.get(hoveredBuilding.value.type) ?? null : null)

watch(selectedBuilding, (b) => { if (!b) selectedBuildingId.value = null })
watch(town.resources, (list) => { sceneRef.value?.setResourceEmoji(Object.fromEntries(list.map(r => [r.id, r.emoji]))) }, { immediate: true })

function openWindow(w: Window) {
    sound.unlock()
    if (windowOpen.value === w) { closeAll(); return }
    windowOpen.value = w
    buildOpen.value = false
    ghostType.value = null
    sound.play('open')
}

function toggleBuild() {
    sound.unlock()
    if (buildOpen.value) { buildOpen.value = false; ghostType.value = null; sound.play('close'); return }
    windowOpen.value = null
    selectedBuildingId.value = null
    buildOpen.value = true
    sound.play('open')
}

function closeAll() {
    if (windowOpen.value || buildOpen.value || selectedBuildingId.value) sound.play('close')
    windowOpen.value = null
    buildOpen.value = false
    ghostType.value = null
    selectedBuildingId.value = null
}

// ── Build ──
const tiers = computed(() => [...new Set(town.catalog.value.map(c => c.tier))].sort((a, b) => a - b))
const tierEntries = computed(() => town.catalog.value.filter(c => c.tier === buildTier.value))
function tierLocked(t: number) { return !town.unlockedTiers.value.has(t) }
function tierName(t: number) { return t === 0 ? 'Town' : `Tier ${t}` }

function canAfford(cost: { coins: number, resources: Record<string, number> }) {
    if (balance.value < cost.coins) return false
    for (const [id, q] of Object.entries(cost.resources)) if ((town.inventory.value[id] ?? 0) < q) return false
    return true
}

function pickBuild(type: string) {
    sound.play('click')
    ghostType.value = ghostType.value === type ? null : type
    ghostRotation.value = 0
    selectedBuildingId.value = null
}

async function onSelectTile(tile: { plotId: string, tileX: number, tileY: number }) {
    sound.unlock()
    if (!ghostType.value) {
        if (!buildOpen.value) toggleBuild()
        return
    }
    if (busy.value) return
    busy.value = true
    try {
        await town.placeBuilding(tile.plotId, tile.tileX, tile.tileY, ghostType.value, ghostRotation.value)
        sound.play('place')
    } catch {
        sound.play('error')
    } finally {
        busy.value = false
    }
}

function onSelectBuilding(id: string) {
    sound.unlock()
    sound.play('click')
    ghostType.value = null
    buildOpen.value = false
    windowOpen.value = null
    selectedBuildingId.value = id
}

function onDeselect() {
    if (ghostType.value) { ghostType.value = null; return }
    if (selectedBuildingId.value) { selectedBuildingId.value = null; sound.play('close') }
}

// ── Actions ──
async function run<T>(fn: () => Promise<T>, onOk?: (res: T) => void, sfx?: Parameters<typeof sound.play>[0]) {
    if (busy.value) return
    busy.value = true
    sound.unlock()
    try {
        const res = await fn()
        if (sfx) sound.play(sfx)
        onOk?.(res)
    } catch {
        sound.play('error')
    } finally {
        busy.value = false
    }
}

// Selected building details.
const selDef = computed(() => selectedEntry.value ? getTownBuilding(selectedEntry.value.id) ?? null : null)
const selPending = computed(() => !!selectedBuilding.value && selectedBuilding.value.completesAt > now.value && (selectedBuilding.value.level === 0 || selectedBuilding.value.upgradingTo !== null))
const selRemaining = computed(() => selectedBuilding.value ? Math.max(0, selectedBuilding.value.completesAt - now.value) : 0)
const selRushGems = computed(() => townRushGemCost(selRemaining.value))
const selNextLevel = computed(() => (selectedBuilding.value?.level ?? 0) + 1)
const selCanUpgrade = computed(() => !!selectedBuilding.value && !selPending.value && selectedBuilding.value.level > 0 && selectedBuilding.value.level < town.constants.value.maxLevel)
const selUpgradeCost = computed(() => selDef.value ? townLevelCost(selDef.value, selNextLevel.value) : { coins: 0, resources: {} })
const selUpgradeMs = computed(() => selDef.value ? townLevelBuildMs(selDef.value, selNextLevel.value) : 0)

const plotById = computed(() => new Map(town.plots.value.map(p => [p.id, p])))
const simBuildings = computed<TownSimBuilding[]>(() => town.buildings.value.map((b) => {
    const plot = plotById.value.get(b.plotId)
    return {
        id: b.id,
        type: b.type as TownSimBuilding['type'],
        level: b.level,
        completesAt: b.completesAt,
        upgradingTo: b.upgradingTo,
        createdAt: b.createdAt,
        wx: plot ? plot.x * TOWN_PLOT_SIZE + b.tileX : undefined,
        wy: plot ? plot.y * TOWN_PLOT_SIZE + b.tileY : undefined
    }
}))
const selAdjacency = computed(() => {
    const b = selectedBuilding.value
    if (!b || b.type !== 'house') return null
    const plot = plotById.value.get(b.plotId)
    if (!plot) return null
    return houseAdjacency(simBuildings.value, plot.x * TOWN_PLOT_SIZE + b.tileX, plot.y * TOWN_PLOT_SIZE + b.tileY)
})

function upgradeSelected() {
    const b = selectedBuilding.value
    if (!b) return
    run(() => town.upgradeBuilding(b.id), res => toast.add({ title: `Upgrading to level ${res.level}`, color: 'success' }), 'upgrade')
}
function rushSelected() {
    const b = selectedBuilding.value
    if (!b) return
    run(() => town.rushBuilding(b.id), res => toast.add({ title: `Rushed for ${res.gems} ${res.gems === 1 ? 'gem' : 'gems'}`, color: 'success' }), 'rush')
}
const confirmDemolish = ref(false)
function demolishSelected() {
    const b = selectedBuilding.value
    if (!b) return
    confirmDemolish.value = false
    run(() => town.demolishBuilding(b.id), () => { selectedBuildingId.value = null }, 'demolish')
}

function found() {
    run(() => town.foundTown(), () => {
        toast.add({ title: 'Welcome, Mayor!', description: 'Build a couple of houses and a farm to get started.', color: 'success' })
        nextTick(() => sceneRef.value?.recenter())
    }, 'plot')
}

// ── Land ──
const plotPurchase = computed(() => town.state.value?.plotPurchase ?? null)
const plotRemainingMs = computed(() => plotPurchase.value ? Math.max(0, plotPurchase.value.availableAt - now.value) : 0)
const plotAffordable = computed(() => !!plotPurchase.value && balance.value >= plotPurchase.value.price)
const canBuyPlot = computed(() => !!plotPurchase.value && !plotPurchase.value.maxed && plotRemainingMs.value <= 0 && plotAffordable.value)
const expansionLabel = computed(() => {
    const p = plotPurchase.value
    if (!p) return ''
    if (p.maxed) return 'Maximum plots owned'
    if (plotRemainingMs.value > 0) return `FOR SALE\nOpens in ${formatTownDuration(plotRemainingMs.value)}`
    return `FOR SALE\n${formatNumber(p.price)} coins${plotAffordable.value ? '' : ' · not enough'}`
})

function buyPlot(slot: { x: number, y: number }) {
    if (!plotPurchase.value) return
    if (plotPurchase.value.maxed) { toast.add({ title: 'You own the maximum number of plots', color: 'warning' }); return }
    if (plotRemainingMs.value > 0) { toast.add({ title: 'Land office closed', description: `Opens in ${formatTownDuration(plotRemainingMs.value)}`, color: 'warning' }); return }
    if (!plotAffordable.value) { toast.add({ title: 'Not enough coins', color: 'error' }); sound.play('error'); return }
    run(() => town.buyPlot(slot.x, slot.y), res => toast.add({ title: 'New land!', description: `Paid ${formatNumber(res.price)} coins`, color: 'success' }), 'plot')
}

// ── Market ──
function openMarket(resource?: string) {
    if (resource) marketResource.value = resource
    if (windowOpen.value !== 'market') openWindow('market')
}
function sellFloor(resource: string, quantity: number) {
    run(() => town.sellToFloor(resource, quantity), (res) => {
        toast.add({ title: `Sold ${formatNumber(res.quantity)} for ${formatNumber(res.total)} coins`, color: 'success' })
        sound.play(res.total >= 100_000 ? 'bigcoin' : 'coin')
    })
}
function placeOrder(resource: string, side: 'buy' | 'sell', price: number, quantity: number) {
    run(() => town.placeOrder(resource, side, price, quantity), (res) => {
        if (res.status === 'filled') {
            toast.add({ title: side === 'sell' ? `Sold ${formatNumber(res.filled)} for ${formatNumber(res.coinsMoved)} coins` : `Bought ${formatNumber(res.filled)} for ${formatNumber(res.coinsMoved)} coins`, color: 'success' })
            sound.play(side === 'sell' ? 'coin' : 'buy')
        } else {
            toast.add({ title: res.filled > 0 ? `Partially filled, rest listed` : 'Offer listed', color: 'success' })
            sound.play('click')
        }
    })
}
function cancelOrder(orderId: string) {
    run(() => town.cancelOrder(orderId), () => toast.add({ title: 'Offer cancelled', color: 'neutral' }), 'close')
}

// ── Milestones ──
const claimable = computed(() => town.claimableMilestones.value.length)
function claimMilestone(id: string) {
    run(() => town.claimMilestone(id), res => toast.add({ title: `${res.title} · +${formatNumber(res.reward)} coins`, color: 'success', icon: 'i-lucide-trophy' }), 'bigcoin')
}
watch(claimable, (n, prev) => {
    if (prev !== undefined && n > prev) {
        sound.play('complete')
        toast.add({ title: 'Goal reached!', description: 'Claim your reward in Goals.', color: 'primary', icon: 'i-lucide-trophy' })
    }
})

// ── Build completion sound ──
const knownPending = new Set<string>()
watch(town.buildings, (list) => {
    const serverNow = town.serverNow()
    for (const b of list) {
        const pending = b.completesAt > serverNow
        if (pending) knownPending.add(b.id)
        else if (knownPending.has(b.id)) { knownPending.delete(b.id); sound.play('complete') }
    }
}, { deep: true })

// ── Welcome back ──
const welcome = ref<{ elapsedMs: number, delta: Record<string, number> } | null>(null)
let welcomeShown = false
watch(() => town.state.value?.welcomeBack, (wb) => {
    if (wb && !welcomeShown) { welcomeShown = true; welcome.value = wb }
}, { immediate: true })
const welcomeRows = computed(() => Object.entries(welcome.value?.delta ?? {})
    .map(([id, qty]) => ({ id, qty, def: town.resourceById.value.get(id) }))
    .sort((a, b) => b.qty - a.qty))
const welcomeValue = computed(() => welcomeRows.value.reduce((s, r) => s + Math.max(0, r.qty) * (r.def?.floorPrice ?? 0), 0))

// ── Help ──
const helpOpen = ref(false)
onMounted(() => {
    try {
        if (!localStorage.getItem('polytown-help-seen')) {
            const stop = watch(town.initialized, (v) => {
                if (v) { helpOpen.value = true; localStorage.setItem('polytown-help-seen', '1'); stop() }
            }, { immediate: true })
        }
    } catch { /* storage unavailable */ }
})

// ── Needs ──
const needsOpen = ref(false)
const needs = computed(() => town.needs.value)
const activeNeeds = computed(() => needs.value.filter(n => n.active))
const unmetNeeds = computed(() => activeNeeds.value.filter(n => !n.satisfied))
const needsHappiness = computed(() => activeNeeds.value.reduce((sum, n) => sum + (n.satisfied ? n.happiness : 0), 0))
const needsMax = computed(() => activeNeeds.value.reduce((sum, n) => sum + n.happiness, 0))
const starving = computed(() => activeNeeds.value.some(n => n.food) && !activeNeeds.value.some(n => n.food && n.satisfied))

// ── HUD ──
const happiness = computed(() => town.state.value?.happiness ?? 50)
const speed = computed(() => town.state.value?.speedMultiplier ?? 0.75)
const popCap = computed(() => town.state.value?.popCap ?? 0)
const workersDemanded = computed(() => town.state.value?.workersDemanded ?? 0)
const incomePerDay = computed(() => town.state.value?.floorIncomePerDay ?? 0)
const storageCap = computed(() => town.state.value?.storageCap ?? 0)
const mood = computed(() => happiness.value >= 75 ? '😄' : happiness.value >= 50 ? '🙂' : happiness.value >= 25 ? '😐' : '😠')
const ticksPerHour = computed(() => (3_600_000 / town.constants.value.tickMs) * speed.value)
const inventoryRows = computed(() => town.resources.value
    .map(r => ({ ...r, amount: town.inventory.value[r.id] ?? 0, perHour: Math.round((town.netPerTick.value[r.id] ?? 0) * ticksPerHour.value) }))
    .filter(r => r.amount > 0 || r.perHour !== 0))
const inventoryValue = computed(() => inventoryRows.value.reduce((s, r) => s + r.amount * r.floorPrice, 0))
function sellEverything() {
    const rows = inventoryRows.value.filter(r => r.amount > 0)
    if (!rows.length) return
    run(async () => {
        let total = 0
        for (const r of rows) total += (await town.sellToFloor(r.id, r.amount)).total
        return total
    }, (total) => {
        toast.add({ title: `Sold everything for ${formatNumber(total)} coins`, color: 'success' })
        sound.play(total >= 100_000 ? 'bigcoin' : 'coin')
    })
}

function toggleSound() {
    sound.unlock()
    sound.enabled.value = !sound.enabled.value
    if (sound.enabled.value) sound.play('click')
}

function onKey(e: KeyboardEvent) {
    if (townIsTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
    if (e.code === 'KeyR' && ghostType.value && !welcome.value && !helpOpen.value && !confirmDemolish.value) {
        e.preventDefault()
        rotatePlacement()
        return
    }
    if (e.key === 'Escape') {
        if (ghostType.value) ghostType.value = null
        else if (welcome.value) welcome.value = null
        else if (helpOpen.value) helpOpen.value = false
        else closeAll()
    } else if (e.key === 'b' || e.key === 'B') toggleBuild()
    else if (e.key === 'm' || e.key === 'M') openMarket()
    else if (e.key === 't' || e.key === 'T') openWindow('goals')
    else if (e.key === 'l' || e.key === 'L') openWindow('mayors')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/**
 * Effect circles the scene should draw: the ghost's own radius while placing,
 * the selected building's radius, and every park's radius while a house is the
 * ghost (so you can see where a home would be happy).
 */
const effectRadii = computed(() => {
    const out: { x: number, y: number, radius: number, kind: 'good' | 'bad' }[] = []
    const push = (b: { plotId: string, tileX: number, tileY: number }, radius: number, kind: 'good' | 'bad') => {
        const plot = plotById.value.get(b.plotId)
        if (plot) out.push({ x: plot.x * TOWN_PLOT_SIZE + b.tileX + 0.5, y: plot.y * TOWN_PLOT_SIZE + b.tileY + 0.5, radius, kind })
    }
    const ghostDef = ghostType.value ? town.catalogById.value.get(ghostType.value) : null
    if (ghostDef && ghostDef.kind === 'housing') {
        // Placing a house: show every park and industry that would affect it.
        for (const b of town.buildings.value) {
            if (b.level === 0) continue
            const def = town.catalogById.value.get(b.type)
            if (def?.kind === 'civic') push(b, town.constants.value.parkRadius, 'good')
            else if (def?.kind === 'industry') push(b, town.constants.value.industryRadius, 'bad')
        }
    }
    const sel = selectedBuilding.value
    const selEntry = selectedEntry.value
    if (sel && selEntry && selEntry.kind === 'civic') push(sel, town.constants.value.parkRadius, 'good')
    else if (sel && selEntry && selEntry.kind === 'industry') push(sel, town.constants.value.industryRadius, 'bad')
    return out
})

/** Radius the ghost itself projects, drawn under the cursor while placing. */
const ghostRadius = computed(() => {
    const def = ghostType.value ? town.catalogById.value.get(ghostType.value) : null
    if (!def) return null
    if (def.kind === 'civic') return { radius: town.constants.value.parkRadius, kind: 'good' as const }
    if (def.kind === 'industry') return { radius: town.constants.value.industryRadius, kind: 'bad' as const }
    return null
})

function hex(color: number) { return `#${color.toString(16).padStart(6, '0')}` }
</script>

<template>
    <div class="town-root" @mousemove="mouse = { x: $event.clientX, y: $event.clientY }">
        <TownScene
            v-if="town.initialized.value"
            ref="sceneRef"
            class="absolute inset-0"
            :plots="town.plots.value"
            :buildings="town.buildings.value"
            :expansions="town.state.value?.expansions ?? []"
            :selected-building-id="selectedBuildingId"
            :ghost-type="ghostType"
            :ghost-rotation="ghostRotation"
            :keyboard-enabled="!windowOpen && !welcome && !helpOpen && !confirmDemolish"
            :server-offset-ms="town.serverOffsetMs.value"
            :pop-cap="popCap"
            :speed-multiplier="speed"
            :tick-ms="town.constants.value.tickMs"
            :expansion-label="expansionLabel"
            :expansion-affordable="canBuyPlot"
            :effect-radii="effectRadii"
            :ghost-radius="ghostRadius"
            @select-tile="onSelectTile"
            @select-building="onSelectBuilding"
            @select-expansion="buyPlot"
            @hover-building="hoveredBuildingId = $event"
            @hover-expansion="hoveredSlot = $event"
            @deselect="onDeselect"
        />

        <!-- Founding -->
        <div v-if="town.state.value && !town.initialized.value" class="found-screen">
            <div class="found-card">
                <div class="text-6xl drop-shadow">🏘️</div>
                <h1 class="mt-3 text-3xl font-black tracking-tight">Polytown</h1>
                <p class="mt-3 text-sm opacity-80">
                    Claim a plot on the endless grid, house your townsfolk, and turn wheat, wood and stone into goods worth a fortune.
                    Sell to the town hall any time, or trade with other mayors.
                </p>
                <button class="g-btn g-btn-primary mt-6 text-lg" :disabled="busy" @click="found">🚩 Found your town</button>
                <p class="mt-3 text-xs opacity-60">Your first plot is free.</p>
            </div>
        </div>
        <div v-else-if="!town.state.value" class="absolute inset-0 flex items-center justify-center text-white/70">
            <span class="g-spinner" />
        </div>

        <template v-if="town.initialized.value">
            <!-- Top-left HUD -->
            <div class="hud">
                <div class="g-chip g-chip-gold" title="Coins">
                    <span class="g-ico">🪙</span><b>{{ formatNumber(balance) }}</b>
                </div>
                <div class="g-chip" :class="workersDemanded > popCap ? 'g-chip-warn' : ''" :title="workersDemanded > popCap ? 'Not enough residents — build houses' : 'Jobs / residents'">
                    <span class="g-ico">👥</span><b>{{ workersDemanded }}<span class="opacity-50">/{{ popCap }}</span></b>
                </div>
                <div class="g-chip" :title="`Happiness ${happiness}/100 · town speed ×${speed.toFixed(2)}`">
                    <span class="g-ico">{{ mood }}</span>
                    <span class="g-meter"><i :style="{ width: `${happiness}%` }" :class="happiness >= 50 ? 'ok' : happiness >= 25 ? 'meh' : 'bad'" /></span>
                    <b class="text-xs opacity-80">×{{ speed.toFixed(2) }}</b>
                </div>
                <div class="g-chip g-chip-green" title="What a day of output is worth if you sell it all at the floor price. There is no passive income — you earn by selling.">
                    <span class="g-ico">📈</span><b>{{ formatNumber(incomePerDay) }}<span class="text-xs opacity-60">/day if sold</span></b>
                </div>
                <button v-if="popCap > 0" class="g-chip g-chip-btn" :class="unmetNeeds.length ? 'g-chip-warn' : ''" title="What your townsfolk consume each tick" @click="needsOpen = !needsOpen">
                    <span class="g-ico">🍞</span>
                    <b v-if="unmetNeeds.length">{{ unmetNeeds.length }} unmet</b>
                    <b v-else>Needs met</b>
                </button>
            </div>

            <!-- Top-right controls -->
            <div class="corner">
                <button class="g-icon" title="How to play" @click="helpOpen = true">?</button>
                <button class="g-icon" :title="sound.enabled.value ? 'Mute' : 'Unmute'" @click="toggleSound">{{ sound.enabled.value ? '🔊' : '🔇' }}</button>
                <button class="g-icon" title="Recenter" @click="sceneRef?.recenter()">◎</button>
            </div>

            <!-- Placement hint -->
            <Transition name="fade">
                <div v-if="ghostType" class="hint">
                    Click a tile to place <b><TownAsset :id="ghostType" kind="building" /> {{ town.catalogById.value.get(ghostType)?.name }}</b> · <button class="placement-rotate" title="Rotate building clockwise (R)" @click="rotatePlacement"><kbd>R</kbd> Rotate ↻ {{ ghostRotation * 90 }}°</button> · <kbd>Esc</kbd> cancel
                </div>
                <div v-else-if="hoveredSlot && plotPurchase && plotRemainingMs > 0 && !plotPurchase.maxed" class="hint">
                    Land office opens in <b>{{ formatTownDuration(plotRemainingMs) }}</b>
                </div>
            </Transition>

            <!-- Needs popover -->
            <Transition name="fade">
                <div v-if="needsOpen && popCap > 0" class="needs">
                    <div class="needs-head">
                        <b>Townsfolk needs</b>
                        <button class="g-icon g-icon-sm" @click="needsOpen = false">✕</button>
                    </div>
                    <div v-for="n in needs" :key="n.resource" class="needs-row" :class="!n.active ? 'is-off' : n.satisfied ? 'is-ok' : 'is-bad'" :title="n.description">
                        <span class="text-lg"><TownAsset :id="n.resource" /></span>
                        <span class="min-w-0 flex-1">
                            <b>{{ n.name }}</b>
                            <span v-if="n.active" class="opacity-60"> · {{ formatNumber(n.perTick) }}/tick</span>
                            <span v-else class="opacity-60"> · from {{ n.minPop }} residents</span>
                        </span>
                        <span v-if="n.active" class="tabular-nums opacity-70">{{ formatNumber(n.stock) }} left</span>
                        <span class="needs-badge">{{ n.active && n.satisfied ? `+${n.happiness}` : '—' }}</span>
                    </div>
                    <p class="needs-foot">
                        <template v-if="starving">😠 Nobody is eating — <b>−12 happiness</b>. Keep grain or bread in store.</template>
                        <template v-else>Needs met: <b>+{{ needsHappiness }}</b> of <b>+{{ needsMax }}</b> happiness. Goods are consumed every tick, so keep producing or buy from other mayors.</template>
                    </p>
                </div>
            </Transition>

            <!-- Inventory (left) -->
            <div v-if="inventoryRows.length" class="inv">
                <button v-for="r in inventoryRows" :key="r.id" class="inv-row" :class="r.amount >= storageCap ? 'is-full' : ''" :title="`${r.name} · floor ${r.floorPrice} · click to trade`" @click="openMarket(r.id)">
                    <span class="inv-emoji"><TownAsset :id="r.id" /></span>
                    <span class="inv-num">{{ formatNumber(r.amount) }}</span>
                    <span v-if="r.perHour" class="inv-rate" :class="r.perHour > 0 ? 'up' : 'down'">{{ r.perHour > 0 ? '+' : '' }}{{ formatNumber(r.perHour) }}/h</span>
                </button>
                <button v-if="inventoryValue > 0" class="inv-sell" :disabled="busy" @click="sellEverything">Sell all · 🪙 {{ formatNumber(inventoryValue) }}</button>
            </div>

            <!-- Hover tooltip -->
            <div v-if="hoveredBuilding && hoveredEntry && !selectedBuilding" class="tip" :style="{ left: `${mouse.x + 16}px`, top: `${mouse.y + 16}px` }">
                <b><TownAsset :id="hoveredEntry.id" kind="building" /> {{ hoveredEntry.name }}</b>
                <span v-if="hoveredBuilding.level > 0" class="opacity-60"> · Lv {{ hoveredBuilding.level }}</span>
                <div class="opacity-70">
                    <template v-if="hoveredBuilding.completesAt > now">{{ hoveredBuilding.level === 0 ? 'Building' : 'Upgrading' }} · {{ formatTownDuration(hoveredBuilding.completesAt - now) }}</template>
                    <template v-else-if="hoveredEntry.kind === 'industry'">{{ Math.round((hoveredBuilding.staffing ?? 0) * 100) }}% staffed</template>
                    <template v-else-if="hoveredEntry.kind === 'housing'">{{ hoveredEntry.popCap * hoveredBuilding.level }} residents</template>
                    <template v-else>Click for details</template>
                </div>
            </div>

            <!-- Selected building card -->
            <Transition name="rise">
                <div v-if="selectedBuilding && selectedEntry" class="card">
                    <div class="card-head">
                        <span class="card-emoji" :style="{ background: hex(selectedEntry.color) + '33' }"><TownAsset :id="selectedEntry.id" kind="building" /></span>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                                <b class="text-base">{{ selectedEntry.name }}</b>
                                <span v-if="selectedBuilding.level > 0" class="g-tag">Lv {{ selectedBuilding.level }}<template v-if="selectedBuilding.upgradingTo"> → {{ selectedBuilding.upgradingTo }}</template></span>
                                <span v-else class="g-tag">Building</span>
                            </div>
                            <div class="text-xs opacity-70">{{ selectedEntry.description }}</div>
                        </div>
                        <button class="g-icon g-icon-sm" @click="closeAll">✕</button>
                    </div>

                    <div class="card-body">
                        <div v-if="selPending" class="card-row">
                            <div class="flex-1">
                                <div class="flex justify-between text-xs opacity-80"><span>🔨 {{ selectedBuilding.level === 0 ? 'Under construction' : 'Upgrading' }}</span><b>{{ formatTownDuration(selRemaining) }}</b></div>
                                <div class="g-progress mt-1"><i :style="{ width: `${Math.round(100 * (1 - selRemaining / townLevelBuildMs(selDef!, selectedBuilding.upgradingTo ?? 1)))}%` }" /></div>
                            </div>
                            <button class="g-btn g-btn-gem" :disabled="busy || gems < selRushGems" @click="rushSelected">💎 Rush · {{ selRushGems }}</button>
                        </div>

                        <template v-else>
                            <div class="card-stats">
                                <template v-if="selectedEntry.kind === 'industry'">
                                    <span v-for="[id, q] in Object.entries(selectedEntry.inputs)" :key="id" class="g-tag">−{{ q * selectedBuilding.level }} <TownAsset :id="id" /></span>
                                    <span v-if="Object.keys(selectedEntry.inputs).length" class="opacity-50">→</span>
                                    <span v-for="[id, q] in Object.entries(selectedEntry.outputs)" :key="id" class="g-tag g-tag-green">+{{ q * selectedBuilding.level }} <TownAsset :id="id" /></span>
                                    <span class="opacity-60 text-xs">/ tick</span>
                                    <span class="g-tag" :class="(selectedBuilding.staffing ?? 0) >= 1 ? 'g-tag-green' : (selectedBuilding.staffing ?? 0) > 0 ? 'g-tag-warn' : 'g-tag-red'">👥 {{ Math.round((selectedBuilding.staffing ?? 0) * 100) }}% · needs {{ selectedEntry.workers * selectedBuilding.level }}</span>
                                </template>
                                <template v-else-if="selectedEntry.kind === 'housing'">
                                    <span class="g-tag g-tag-green">👥 {{ selectedEntry.popCap * selectedBuilding.level }} residents</span>
                                    <span v-if="selAdjacency" class="g-tag" :class="selAdjacency.parks ? 'g-tag-green' : ''">🌳 {{ selAdjacency.parks }} · +{{ selAdjacency.parks * town.constants.value.parkAdjacent }}</span>
                                    <span v-if="selAdjacency" class="g-tag" :class="selAdjacency.industry ? 'g-tag-red' : ''">🏭 {{ selAdjacency.industry }} · −{{ selAdjacency.industry * town.constants.value.industryAdjacent }}</span>
                                    <span class="opacity-60 text-xs">happiness from neighbours</span>
                                </template>
                                <span v-else-if="selectedEntry.kind === 'civic'" class="g-tag g-tag-green">😊 +{{ selectedEntry.happiness * selectedBuilding.level }} happiness</span>
                                <span v-else class="g-tag g-tag-green">📦 +{{ formatNumber(selectedEntry.storage * selectedBuilding.level) }} storage</span>
                            </div>

                            <div class="card-row">
                                <button v-if="selCanUpgrade" class="g-btn g-btn-primary flex-1" :disabled="busy || !canAfford(selUpgradeCost)" @click="upgradeSelected">
                                    <span>⬆ Upgrade to Lv {{ selNextLevel }}</span>
                                    <span class="g-cost">
                                        <span :class="balance >= selUpgradeCost.coins ? '' : 'bad'">🪙 {{ formatNumber(selUpgradeCost.coins) }}</span>
                                        <span v-for="[id, q] in Object.entries(selUpgradeCost.resources)" :key="id" :class="(town.inventory.value[id] ?? 0) >= q ? '' : 'bad'"><TownAsset :id="id" /> {{ formatNumber(q) }}</span>
                                        <span class="opacity-60">⏱ {{ formatTownDuration(selUpgradeMs) }}</span>
                                    </span>
                                </button>
                                <div v-else class="g-tag g-tag-gold flex-1 justify-center py-2">🏅 Max level</div>
                                <button class="g-icon g-icon-danger" title="Demolish" @click="confirmDemolish = true">🗑</button>
                            </div>
                        </template>
                    </div>
                </div>
            </Transition>

            <!-- Build strip -->
            <Transition name="rise">
                <div v-if="buildOpen" class="strip">
                    <div class="strip-tabs">
                        <button v-for="t in tiers" :key="t" class="strip-tab" :class="[buildTier === t ? 'is-active' : '', tierLocked(t) ? 'is-locked' : '']" @click="buildTier = t; sound.play('click')">
                            <span v-if="tierLocked(t)">🔒</span>{{ tierName(t) }}
                        </button>
                        <span v-if="tierLocked(buildTier)" class="ml-2 text-xs opacity-70">Finish a tier {{ buildTier - 1 }} building to unlock</span>
                        <button class="g-icon g-icon-sm ml-auto" @click="toggleBuild">✕</button>
                    </div>
                    <div class="strip-cards">
                        <button
                            v-for="c in tierEntries"
                            :key="c.id"
                            class="bcard"
                            :class="[ghostType === c.id ? 'is-active' : '', canAfford(c.cost) && !tierLocked(c.tier) ? '' : 'is-dim']"
                            :disabled="tierLocked(c.tier)"
                            :style="{ '--accent': hex(c.color) }"
                            @click="pickBuild(c.id)"
                        >
                            <span class="bcard-emoji"><TownAsset :id="c.id" kind="building" /></span>
                            <b class="bcard-name">{{ c.name }}</b>
                            <span class="bcard-cost" :class="balance >= c.cost.coins ? '' : 'bad'">🪙 {{ formatNumber(c.cost.coins) }}</span>
                            <span v-if="Object.keys(c.cost.resources).length" class="bcard-res">
                                <span v-for="[id, q] in Object.entries(c.cost.resources)" :key="id" :class="(town.inventory.value[id] ?? 0) >= q ? '' : 'bad'"><TownAsset :id="id" />{{ formatNumber(q) }}</span>
                            </span>
                            <span class="bcard-meta">
                                <span>⏱ {{ formatTownDuration(c.buildMs) }}</span>
                                <span v-if="c.workers">👥 {{ c.workers }}</span>
                                <span v-if="c.popCap">🏠 +{{ c.popCap }}</span>
                                <span v-if="c.happiness">😊 +{{ c.happiness }}</span>
                                <span v-if="c.storage">📦 +{{ formatNumber(c.storage) }}</span>
                            </span>
                            <span v-if="Object.keys(c.outputs).length" class="bcard-io">
                                <template v-if="Object.keys(c.inputs).length"><span v-for="[id, q] in Object.entries(c.inputs)" :key="id">{{ q }}<TownAsset :id="id" /></span>→</template>
                                <span v-for="[id, q] in Object.entries(c.outputs)" :key="id" class="text-emerald-300">{{ q }}<TownAsset :id="id" /></span>
                            </span>
                        </button>
                    </div>
                </div>
            </Transition>

            <!-- Dock -->
            <div class="dock">
                <button class="dock-btn" :class="buildOpen ? 'is-active' : ''" @click="toggleBuild"><span class="dock-ico">🔨</span><span>Build</span><kbd>B</kbd></button>
                <button class="dock-btn" :class="windowOpen === 'market' ? 'is-active' : ''" @click="openMarket()"><span class="dock-ico">🏪</span><span>Market</span><kbd>M</kbd></button>
                <button class="dock-btn" :class="windowOpen === 'goals' ? 'is-active' : ''" @click="openWindow('goals')">
                    <span class="dock-ico">🏆</span><span>Goals</span><kbd>T</kbd>
                    <span v-if="claimable" class="dock-badge">{{ claimable }}</span>
                </button>
                <button class="dock-btn" :class="windowOpen === 'mayors' ? 'is-active' : ''" @click="openWindow('mayors')"><span class="dock-ico">👑</span><span>Mayors</span><kbd>L</kbd></button>
                <div class="dock-sep" />
                <div class="dock-land" :class="canBuyPlot ? 'is-ready' : ''" :title="plotPurchase?.maxed ? 'Maximum plots' : 'Click a FOR SALE sign on the map to buy land'">
                    <span class="dock-ico">🗺️</span>
                    <span v-if="plotPurchase?.maxed">All land owned</span>
                    <span v-else-if="plotRemainingMs > 0" class="tabular-nums">Land in {{ formatTownDuration(plotRemainingMs) }}</span>
                    <span v-else>Land for sale · 🪙 {{ formatNumber(plotPurchase?.price ?? 0) }}</span>
                </div>
            </div>

            <!-- Windows -->
            <Transition name="fade">
                <div v-if="windowOpen" class="backdrop" @click.self="closeAll">
                    <div class="g-window" :class="windowOpen === 'market' ? 'is-wide' : ''">
                        <TownMarketPanel
                            v-if="windowOpen === 'market'"
                            :resources="town.resources.value"
                            :inventory="town.inventory.value"
                            :last-prices="town.lastPrices.value"
                            :my-orders="town.myOrders.value"
                            :balance="balance"
                            :initial-resource="marketResource"
                            :busy="busy"
                            @close="closeAll"
                            @sell-floor="sellFloor"
                            @place-order="placeOrder"
                            @cancel-order="cancelOrder"
                        />
                        <TownMilestonesPanel v-else-if="windowOpen === 'goals'" :milestones="town.milestones.value" :busy="busy" @claim="claimMilestone" @close="closeAll" />
                        <TownLeaderboardPanel v-else-if="windowOpen === 'mayors'" @close="closeAll" />
                    </div>
                </div>
            </Transition>

            <!-- Welcome back -->
            <Transition name="fade">
                <div v-if="welcome" class="backdrop" @click.self="welcome = null">
                    <div class="g-window is-small">
                        <div class="g-window-head"><h2>👋 Welcome back, Mayor</h2><button class="g-icon g-icon-sm" @click="welcome = null">✕</button></div>
                        <div class="g-window-body">
                            <p class="text-sm opacity-80">Your town kept working for <b>{{ formatTownDuration(welcome.elapsedMs) }}</b>.</p>
                            <div class="mt-3 grid grid-cols-3 gap-2">
                                <div v-for="r in welcomeRows" :key="r.id" class="g-cell">
                                    <span class="text-2xl"><TownAsset :id="r.def?.id" /></span>
                                    <b :class="r.qty > 0 ? 'text-emerald-300' : 'text-rose-300'">{{ r.qty > 0 ? '+' : '' }}{{ formatNumber(r.qty) }}</b>
                                    <span class="text-[11px] opacity-60">{{ r.def?.name }}</span>
                                </div>
                            </div>
                            <p v-if="welcomeValue" class="mt-3 text-center text-sm opacity-80">Worth about <b>🪙 {{ formatNumber(welcomeValue) }}</b> at floor price.</p>
                            <div class="mt-4 flex justify-end gap-2">
                                <button class="g-btn" @click="welcome = null">Close</button>
                                <button class="g-btn g-btn-primary" @click="welcome = null; openMarket()">🏪 Go to market</button>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>

            <!-- Help -->
            <Transition name="fade">
                <div v-if="helpOpen" class="backdrop" @click.self="helpOpen = false">
                    <div class="g-window is-small">
                        <div class="g-window-head"><h2>How to play</h2><button class="g-icon g-icon-sm" @click="helpOpen = false">✕</button></div>
                        <div class="g-window-body space-y-2 text-sm opacity-90">
                            <p>🏠 <b>Houses</b> bring residents. Every industry building needs residents to run — an unstaffed farm grows nothing.</p>
                            <p>😊 <b>Happiness</b> sets how fast the whole town ticks (×0.5 at 0, ×1.0 at 100). It comes from parks, from meeting your townsfolk's needs, and from a tidy layout. Industry, overcrowding and starvation drag it down.</p>
                            <p>🍞 <b>Needs</b>: residents eat grain and bread every tick, and later want tools and luxuries. Meeting a need pays happiness; running out of all food starves the town. Those goods are consumed for real, so keep producing or buy from other mayors.</p>
                            <p>🌳 <b>Radius</b>: a park cheers every house within 2 tiles, industry sours the houses right beside it. While placing, the circle on the ground shows the reach.</p>
                            <p>🪚 <b>Tiers</b>: raw goods → refined goods → bread and tools → iron, steel, machines, luxuries. Finish one building of a tier to unlock the next.</p>
                            <p>⬆ <b>Levels</b>: upgrade buildings up to level 20. Every upgrade costs coins <b>and</b> goods, so your own production feeds your growth. Costs climb fast — a level 20 factory runs into the trillions.</p>
                            <p>📦 <b>Storage</b> caps each resource. Full storage halts production — sell, or build warehouses.</p>
                            <p>🏪 <b>Market</b>: there is <b>no passive income</b> — you earn by selling. The town hall always buys at a floor price so you are never stuck, but <b>buying is only ever from other players</b>. Offers fill instantly when they cross.</p>
                            <p>🗺️ <b>Land</b>: click a FOR SALE sign next to your plot. Each plot costs more and opens more slowly than the last.</p>
                            <p>💎 <b>Rush</b> any build for 1 gem per 5 minutes left. 🏆 <b>Goals</b> pay coins for hitting town targets.</p>
                            <p class="opacity-60">WASD to move · drag to pan · wheel to zoom · right-drag to orbit · R to rotate a building while placing · <kbd>B</kbd> <kbd>M</kbd> <kbd>T</kbd> <kbd>L</kbd> <kbd>Esc</kbd></p>
                        </div>
                    </div>
                </div>
            </Transition>

            <!-- Demolish confirm -->
            <Transition name="fade">
                <div v-if="confirmDemolish" class="backdrop" @click.self="confirmDemolish = false">
                    <div class="g-window is-tiny">
                        <div class="g-window-head"><h2>Demolish {{ selectedEntry?.name }}?</h2></div>
                        <div class="g-window-body">
                            <p class="text-sm opacity-80">No refund. The tile becomes free again.</p>
                            <div class="mt-4 flex justify-end gap-2">
                                <button class="g-btn" @click="confirmDemolish = false">Cancel</button>
                                <button class="g-btn g-btn-danger" @click="demolishSelected">🗑 Demolish</button>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>
        </template>
    </div>
</template>

<style>
/* ── Polytown game UI (shared by the town/* components) ─────────────────── */
.town-root {
    --g-bg: rgba(16, 20, 27, 0.78);
    --g-bg-2: rgba(28, 34, 44, 0.9);
    --g-line: rgba(255, 255, 255, 0.09);
    --g-text: #f4f1ea;
    --g-muted: rgba(244, 241, 234, 0.62);
    --g-gold: #f5c451;
    --g-green: #4fd36a;
    --g-red: #ff6b6b;
    --g-gem: #6fd3ff;
    position: relative;
    height: 100%;
    width: 100%;
    overflow: hidden;
    color: var(--g-text);
    font-family: ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, sans-serif;
    background: #8ecbe8;
}
.town-root kbd {
    font: 600 10px/1 ui-monospace, monospace;
    padding: 2px 5px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.15);
}
.town-root .bad { color: var(--g-red); }

.g-chip {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 14px; border-radius: 14px;
    background: var(--g-bg); border: 1px solid var(--g-line);
    backdrop-filter: blur(10px); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    font-size: 15px; white-space: nowrap;
}
.g-chip b { font-weight: 800; letter-spacing: -0.01em; }
.g-chip-gold b { color: var(--g-gold); }
.g-chip-gem b { color: var(--g-gem); }
.g-chip-green b { color: var(--g-green); }
.g-chip-warn { border-color: rgba(245, 196, 81, 0.6); }
.g-chip-warn b { color: var(--g-gold); }
.g-ico { font-size: 17px; line-height: 1; }
.g-meter { display: inline-block; width: 74px; height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.g-meter i { display: block; height: 100%; border-radius: 999px; transition: width 0.6s ease; }
.g-meter i.ok { background: linear-gradient(90deg, #7ee081, #3ecf5a); }
.g-meter i.meh { background: linear-gradient(90deg, #ffd479, #f5a623); }
.g-meter i.bad { background: linear-gradient(90deg, #ff8a8a, #ff5252); }

.g-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 10px 16px; border-radius: 12px; font-weight: 700; font-size: 14px;
    background: rgba(255, 255, 255, 0.1); border: 1px solid var(--g-line); color: var(--g-text);
    cursor: pointer; transition: transform 0.08s ease, filter 0.15s ease, background 0.15s ease;
    box-shadow: 0 2px 0 rgba(0, 0, 0, 0.25);
}
.g-btn:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
.g-btn:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }
.g-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.g-btn-primary { background: linear-gradient(180deg, #5fe07a, #2fb14b); color: #0b2a12; border-color: rgba(0, 0, 0, 0.15); }
.g-btn-gem { background: linear-gradient(180deg, #7fdcff, #3aa8e0); color: #05283a; border-color: rgba(0, 0, 0, 0.15); }
.g-btn-danger { background: linear-gradient(180deg, #ff7b7b, #d94141); color: #2a0707; }
.g-btn-gold { background: linear-gradient(180deg, #ffd97a, #e9a825); color: #3b2500; }
.g-cost { display: inline-flex; gap: 8px; font-size: 11px; font-weight: 600; opacity: 0.9; padding: 3px 8px; border-radius: 8px; background: rgba(0, 0, 0, 0.18); }

.g-icon {
    width: 38px; height: 38px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;
    background: var(--g-bg); border: 1px solid var(--g-line); color: var(--g-text); font-weight: 800; font-size: 15px;
    backdrop-filter: blur(10px); cursor: pointer; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}
.g-icon:hover { background: var(--g-bg-2); }
.g-icon-sm { width: 30px; height: 30px; border-radius: 9px; font-size: 12px; box-shadow: none; }
.g-icon-danger { color: var(--g-red); }

.g-tag { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 8px; background: rgba(255, 255, 255, 0.1); font-size: 12px; font-weight: 700; white-space: nowrap; }
.g-tag-green { background: rgba(79, 211, 106, 0.18); color: #9af0a8; }
.g-tag-red { background: rgba(255, 107, 107, 0.18); color: #ffb3b3; }
.g-tag-warn { background: rgba(245, 196, 81, 0.18); color: #ffe19a; }
.g-tag-gold { background: rgba(245, 196, 81, 0.2); color: var(--g-gold); }

.g-progress { height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.g-progress i { display: block; height: 100%; background: linear-gradient(90deg, #7ee081, #3ecf5a); transition: width 0.4s linear; }
.g-spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid rgba(255, 255, 255, 0.2); border-top-color: #fff; animation: g-spin 0.8s linear infinite; }
@keyframes g-spin { to { transform: rotate(360deg); } }
.g-cell { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 6px; border-radius: 12px; background: rgba(255, 255, 255, 0.06); }

.hud { position: absolute; left: 14px; top: 14px; display: flex; flex-wrap: wrap; gap: 8px; z-index: 5; max-width: calc(100% - 160px); }
.corner { position: absolute; right: 14px; top: 14px; display: flex; gap: 8px; z-index: 5; }
.placement-rotate { cursor: pointer; pointer-events: auto; padding: 3px 7px; border-radius: 6px; background: var(--g-bg-2); color: inherit; }
.placement-rotate:hover { filter: brightness(1.2); }
.hint {
    position: absolute; left: 50%; top: 70px; transform: translateX(-50%); z-index: 5;
    padding: 8px 14px; border-radius: 999px; background: var(--g-bg); border: 1px solid var(--g-line);
    backdrop-filter: blur(10px); font-size: 13px; white-space: nowrap;
}
.g-chip-btn { cursor: pointer; }
.g-chip-btn:hover { background: var(--g-bg-2); }
.needs { position: absolute; left: 200px; top: 76px; z-index: 8; width: 340px; padding: 10px 12px; border-radius: 16px; background: var(--g-bg); border: 1px solid var(--g-line); backdrop-filter: blur(12px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35); }
.needs-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 13px; }
.needs-row { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 9px; font-size: 12px; }
.needs-row.is-ok { background: rgba(79, 211, 106, 0.12); }
.needs-row.is-bad { background: rgba(255, 107, 107, 0.12); }
.needs-row.is-off { opacity: 0.45; }
.needs-badge { min-width: 30px; text-align: right; font-weight: 800; }
.needs-row.is-ok .needs-badge { color: var(--g-green); }
.needs-row.is-bad .needs-badge { color: var(--g-red); }
.needs-foot { margin-top: 8px; font-size: 11px; opacity: 0.75; }

.inv { position: absolute; left: 14px; top: 76px; display: flex; flex-direction: column; gap: 4px; z-index: 4; max-height: calc(100% - 190px); overflow-y: auto; padding-right: 2px; }
.inv-row {
    display: grid; grid-template-columns: 22px auto auto; align-items: center; gap: 8px;
    padding: 5px 10px 5px 8px; border-radius: 10px; background: var(--g-bg); border: 1px solid var(--g-line);
    backdrop-filter: blur(8px); font-size: 13px; cursor: pointer; text-align: left; color: var(--g-text);
}
.inv-row:hover { background: var(--g-bg-2); }
.inv-row.is-full .inv-num { color: var(--g-gold); }
.inv-emoji { font-size: 16px; }
.inv-num { font-weight: 800; font-variant-numeric: tabular-nums; }
.inv-rate { font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
.inv-rate.up { color: var(--g-green); }
.inv-rate.down { color: var(--g-red); }
.inv-sell { margin-top: 4px; padding: 6px 10px; border-radius: 10px; background: rgba(245, 196, 81, 0.18); border: 1px solid rgba(245, 196, 81, 0.35); color: var(--g-gold); font-size: 12px; font-weight: 800; cursor: pointer; }
.inv-sell:hover { background: rgba(245, 196, 81, 0.28); }

.tip { position: fixed; z-index: 30; pointer-events: none; padding: 8px 12px; border-radius: 10px; background: var(--g-bg-2); border: 1px solid var(--g-line); font-size: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); }

.card {
    position: absolute; left: 50%; bottom: 112px; transform: translateX(-50%); z-index: 6;
    width: min(560px, calc(100% - 28px)); border-radius: 18px; background: var(--g-bg); border: 1px solid var(--g-line);
    backdrop-filter: blur(14px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35); overflow: hidden;
}
.card-head { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--g-line); }
.card-emoji { width: 46px; height: 46px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; font-size: 26px; }
.card-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.card-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.card-row { display: flex; align-items: center; gap: 10px; }

.strip {
    position: absolute; left: 50%; bottom: 112px; transform: translateX(-50%); z-index: 6;
    width: min(1040px, calc(100% - 28px)); border-radius: 18px; background: var(--g-bg); border: 1px solid var(--g-line);
    backdrop-filter: blur(14px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}
.strip-tabs { display: flex; align-items: center; gap: 4px; padding: 10px 12px 0; }
.strip-tab { padding: 6px 12px; border-radius: 10px; font-size: 12px; font-weight: 800; color: var(--g-muted); background: transparent; border: 1px solid transparent; cursor: pointer; display: inline-flex; gap: 4px; }
.strip-tab.is-active { background: rgba(255, 255, 255, 0.1); color: var(--g-text); border-color: var(--g-line); }
.strip-tab.is-locked { opacity: 0.6; }
.strip-cards { display: flex; gap: 10px; padding: 10px 12px 12px; overflow-x: auto; scrollbar-width: thin; }
.bcard {
    flex: 0 0 150px; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 12px 10px 10px;
    border-radius: 14px; background: rgba(255, 255, 255, 0.06); border: 1px solid var(--g-line); color: var(--g-text); cursor: pointer;
    transition: transform 0.1s ease, background 0.15s ease, border-color 0.15s ease; text-align: center;
    background-image: radial-gradient(120px 60px at 50% 0%, color-mix(in srgb, var(--accent) 35%, transparent), transparent);
}
.bcard:hover:not(:disabled) { transform: translateY(-3px); background-color: rgba(255, 255, 255, 0.1); }
.bcard.is-active { border-color: var(--g-green); box-shadow: 0 0 0 2px rgba(79, 211, 106, 0.45); }
.bcard.is-dim { opacity: 0.6; }
.bcard:disabled { cursor: not-allowed; filter: grayscale(1); }
.bcard-emoji { font-size: 34px; line-height: 1; filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.35)); }
.bcard-name { font-size: 13px; margin-top: 4px; }
.bcard-cost { font-size: 12px; font-weight: 800; color: var(--g-gold); }
.bcard-res { display: flex; gap: 6px; font-size: 11px; font-weight: 700; opacity: 0.9; }
.bcard-meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; font-size: 10px; opacity: 0.7; margin-top: 2px; }
.bcard-io { display: flex; gap: 4px; font-size: 11px; font-weight: 700; margin-top: 2px; }

.dock {
    position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 25;
    display: flex; align-items: center; gap: 6px; padding: 8px; border-radius: 20px;
    background: var(--g-bg); border: 1px solid var(--g-line); backdrop-filter: blur(14px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}
.dock-btn {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; width: 84px; padding: 8px 6px 6px;
    border-radius: 14px; background: transparent; border: 1px solid transparent; color: var(--g-text); font-size: 12px; font-weight: 800; cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
}
.dock-btn kbd { position: absolute; right: 6px; top: 6px; opacity: 0.5; }
.dock-btn:hover { background: rgba(255, 255, 255, 0.08); transform: translateY(-2px); }
.dock-btn.is-active { background: rgba(255, 255, 255, 0.14); border-color: var(--g-line); }
.dock-ico { font-size: 26px; line-height: 1; filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.35)); }
.dock-badge { position: absolute; left: 50%; top: 2px; transform: translateX(6px); min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--g-green); color: #0b2a12; font-size: 11px; font-weight: 900; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4); }
.dock-sep { width: 1px; height: 44px; background: var(--g-line); margin: 0 4px; }
.dock-land { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 14px; font-size: 12px; font-weight: 700; color: var(--g-muted); }
.dock-land .dock-ico { font-size: 22px; }
.dock-land.is-ready { color: var(--g-gold); background: rgba(245, 196, 81, 0.12); }

.found-screen { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: radial-gradient(ellipse at 50% 30%, #bfe6f7, #6fb8d9 70%); }
.found-card { max-width: 440px; text-align: center; padding: 36px 32px; border-radius: 24px; background: var(--g-bg); border: 1px solid var(--g-line); backdrop-filter: blur(14px); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35); }

.backdrop { position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(6, 10, 16, 0.45); backdrop-filter: blur(3px); }
.g-window { width: min(680px, 100%); max-height: calc(100% - 24px); display: flex; flex-direction: column; border-radius: 20px; background: rgba(18, 22, 29, 0.96); border: 1px solid var(--g-line); box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5); overflow: hidden; }
.g-window.is-wide { width: min(920px, 100%); height: min(680px, 100%); }
.g-window.is-small { width: min(520px, 100%); }
.g-window.is-tiny { width: min(400px, 100%); }
.g-window-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--g-line); }
.g-window-head h2 { font-size: 17px; font-weight: 900; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
.g-window-body { padding: 16px 18px; overflow-y: auto; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.rise-enter-active, .rise-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.rise-enter-from, .rise-leave-to { opacity: 0; transform: translate(-50%, 12px); }
</style>
