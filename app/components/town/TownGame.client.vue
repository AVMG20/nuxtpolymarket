<script setup lang="ts">
import TownCoin from '~/components/town/TownCoin.vue'
import { townIsTyping } from '~/utils/town/camera'
import TownAsset from '~/components/town/TownAsset.vue'
import TownScene from '~/components/town/TownScene.client.vue'
import TownMarketPanel from '~/components/town/TownMarketPanel.vue'
import TownMilestonesPanel from '~/components/town/TownMilestonesPanel.vue'
import TownLeaderboardPanel from '~/components/town/TownLeaderboardPanel.vue'
import TownResearchPanel from '~/components/town/TownResearchPanel.vue'
import { formatTownDuration } from '~/utils/town-format'
import { townTerrainCss } from '~/utils/town/terrain'
import { TOWN_TERRAINS, TOWN_TERRAIN_BONUS, TOWN_PLOT_SIZE, houseAdjacency, townLevelCost, townLevelBuildMs, townRushGemCost, getTownBuilding, townPlacementIssue, townAutoFacing, townIndustryNuisance, townHousesWithin, townWorkersFor, type TownSimBuilding } from '#shared/utils/gamelogic/town'

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
type Window = 'market' | 'goals' | 'mayors' | 'land' | 'research' | null
const windowOpen = ref<Window>(null)
const buildOpen = ref(false)
const buildTier = ref(0)
const ghostType = ref<string | null>(null)
const ghostRotation = ref(0)
function rotatePlacement() { ghostRotation.value = (ghostRotation.value + 1) % 4 }
/** Building being relocated; its type becomes the ghost and the original hides. */
const movingId = ref<string | null>(null)
const hoveredTile = ref<{ plotId: string, tileX: number, tileY: number, wx: number, wy: number } | null>(null)
const selectedBuildingId = ref<string | null>(null)
const marketResource = ref<string | null>(null)
const busy = ref(false)
const sceneRef = ref<InstanceType<typeof TownScene> | null>(null)
const hoveredBuildingId = ref<string | null>(null)
const hoveredSlot = ref<{ x: number, y: number, free: boolean, ownerName?: string } | null>(null)
const hoveredNeighbour = ref<{ plotId: string, ownerName: string, type?: string, level?: number } | null>(null)
/**
 * The cursor tooltips follow the pointer through CSS custom properties rather
 * than a ref. A ref here is a render dependency, so every mousemove re-ran the
 * whole game template — four hundred elements — at pointer rate, for the sake
 * of two numbers only three absolutely-positioned boxes ever read.
 */
const rootEl = ref<HTMLElement | null>(null)
function trackPointer(e: MouseEvent) {
    const el = rootEl.value
    if (!el) return
    el.style.setProperty('--cursor-x', `${e.clientX + 16}px`)
    el.style.setProperty('--cursor-y', `${e.clientY + 16}px`)
}

const ghostLevel = computed(() => movingId.value ? town.buildings.value.find(b => b.id === movingId.value)?.level ?? 1 : 1)
const selectedBuilding = computed(() => town.buildings.value.find(b => b.id === selectedBuildingId.value) ?? null)
const selectedEntry = computed(() => selectedBuilding.value ? town.catalogById.value.get(selectedBuilding.value.type) ?? null : null)
const hoveredBuilding = computed(() => town.buildings.value.find(b => b.id === hoveredBuildingId.value) ?? null)
const hoveredEntry = computed(() => hoveredBuilding.value ? town.catalogById.value.get(hoveredBuilding.value.type) ?? null : null)

watch(selectedBuilding, (b) => { if (!b) selectedBuildingId.value = null })
watch(town.resources, (list) => { sceneRef.value?.setResourceEmoji(Object.fromEntries(list.map(r => [r.id, r.emoji]))) }, { immediate: true })

function openWindow(w: Window) {
    sound.unlock()
    if (windowOpen.value === w) { closeAll(); return }
    // The board is its own fetch, so pull it fresh the moment it is opened.
    if (w === 'research') town.refreshResearch()
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
    movingId.value = null
    selectedBuildingId.value = null
}

// ── Build ──
const tiers = computed(() => [...new Set(town.catalog.value.map(c => c.tier))].sort((a, b) => a - b))
const tierEntries = computed(() => town.catalog.value.filter(c => c.tier === buildTier.value))
function tierLocked(t: number) { return !town.unlockedTiers.value.has(t) }
/** The unmet conditions of a locked tier, in plain words. */
function tierLockText(t: number): string {
    const lock = town.tierLocks.value[t]
    if (!lock) return ''
    const parts: string[] = []
    if (lock.needsBuilding) parts.push(`a tier ${t - 1} building`)
    if (lock.pop < lock.popRequired) parts.push(`${formatNumber(lock.popRequired)} residents (${formatNumber(lock.pop)})`)
    if (lock.produced < lock.producedRequired) parts.push(`${formatNumber(lock.producedRequired)} tier-${lock.producedTier} goods (${formatNumber(lock.produced)})`)
    return `needs ${parts.join(' · ')}`
}
function tierName(t: number) { return t === 0 ? 'Town' : `Tier ${t}` }

function canAfford(cost: { coins: number, resources: Record<string, number> }) {
    if (balance.value < cost.coins) return false
    for (const [id, q] of Object.entries(cost.resources)) if ((town.inventory.value[id] ?? 0) < q) return false
    return true
}

function pickBuild(type: string) {
    // Roads go up instantly and need nobody; everything else needs a free crew.
    const def = town.catalogById.value.get(type)
    if (def && def.kind !== 'road' && buildersFree.value === 0) {
        openBlocked({ kind: 'build', type })
        return
    }
    sound.play('click')
    movingId.value = null
    ghostType.value = ghostType.value === type ? null : type
    ghostRotation.value = 0
    selectedBuildingId.value = null
}

function startMove() {
    const b = selectedBuilding.value
    if (!b || b.level === 0 || b.upgradingTo !== null) return
    sound.play('click')
    movingId.value = b.id
    ghostType.value = b.type
    ghostRotation.value = b.rotation
    selectedBuildingId.value = null
    buildOpen.value = false
}

async function onSelectTile(tile: { plotId: string, tileX: number, tileY: number }) {
    sound.unlock()
    if (!ghostType.value) {
        if (!buildOpen.value) toggleBuild()
        return
    }
    if (busy.value) return
    if (ghostIssue.value) {
        sound.play('error')
        toast.add({ title: ghostIssue.value, color: 'warning' })
        return
    }
    busy.value = true
    try {
        if (movingId.value) {
            await town.moveBuilding(movingId.value, tile.plotId, tile.tileX, tile.tileY, ghostRotation.value)
            sound.play('place')
            movingId.value = null
            ghostType.value = null
        } else {
            await town.placeBuilding(tile.plotId, tile.tileX, tile.tileY, ghostType.value, ghostRotation.value)
            sound.play('place')
        }
    } catch {
        sound.play('error')
    } finally {
        busy.value = false
    }
}

function onHoverTile(tile: { plotId: string, tileX: number, tileY: number, wx: number, wy: number } | null) {
    hoveredTile.value = tile
    // Auto-face the nearest road when the current rotation has none in front,
    // so most placements never need the R key.
    if (!tile || !ghostType.value) return
    const def = town.catalogById.value.get(ghostType.value)
    if (!def || def.kind === 'road') return
    const others = movingId.value ? simBuildings.value.filter(b => b.id !== movingId.value) : simBuildings.value
    if (townPlacementIssue(others, getTownBuilding(def.id)!, tile.wx, tile.wy, ghostRotation.value) === null) return
    const auto = townAutoFacing(others, tile.wx, tile.wy)
    if (auto !== null) ghostRotation.value = auto
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
    if (ghostType.value) { ghostType.value = null; movingId.value = null; return }
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
/** A park never needs level 20, so the cap is per building, not global. */
const selMaxLevel = computed(() => selectedEntry.value?.maxLevel ?? town.constants.value.maxLevel)
const selCanUpgrade = computed(() => !!selectedBuilding.value && !selPending.value && selectedBuilding.value.level > 0 && selectedBuilding.value.level < selMaxLevel.value)
const selUpgradeCost = computed(() => selDef.value ? townLevelCost(selDef.value, selNextLevel.value) : { coins: 0, resources: {} })
// The server quotes this: only it knows the town's mood and its research.
const selUpgradeMs = computed(() => selectedBuilding.value?.nextUpgradeMs ?? 0)
/** Residents this building wants. Warehouses want them too, not just workshops. */
const selWorkersWanted = computed(() => selDef.value && selectedBuilding.value
    ? townWorkersFor(selDef.value, selectedBuilding.value.level)
    : 0)
/** The workers meter's tooltip: what this building wants, and what its road network has. */
const selWorkersTitle = computed(() => {
    const b = selectedBuilding.value
    const d = b?.district
    const want = `Wants ${selWorkersWanted.value} residents; houses fill posts oldest building first.`
    if (!d) return want
    return `${want}\nThis road network: ${d.residents} residents for ${d.jobs} jobs.`
})
/** Why this building is short of hands, when the roads are the reason. */
const selDistrictFix = computed(() => {
    const b = selectedBuilding.value
    const e = selectedEntry.value
    const d = b?.district
    if (!b || !e || !d || b.connected === false || b.completesAt > now.value) return null
    if (e.kind === 'housing') {
        return d.jobs === 0 ? '👥 Nobody here can reach a job. Join this road to your workshops.' : null
    }
    if (e.kind === 'road' || selWorkersWanted.value === 0 || (b.staffing ?? 0) >= 0.99) return null
    if (d.residents === 0) return '👥 No homes on this road network. Build houses along it, or join it to your town by road.'
    if (d.residents < d.jobs) return `👥 This road network has ${d.residents} residents for ${d.jobs} jobs. Add houses along it, or join it to more of your town.`
    return null
})
/** The next rung that will start demanding a good from further up the chain. */

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
        wy: plot ? plot.y * TOWN_PLOT_SIZE + b.tileY : undefined,
        rotation: b.rotation
    }
}))
const selAdjacency = computed(() => {
    const b = selectedBuilding.value
    if (!b || b.type !== 'house') return null
    const plot = plotById.value.get(b.plotId)
    if (!plot) return null
    return houseAdjacency(simBuildings.value, plot.x * TOWN_PLOT_SIZE + b.tileX, plot.y * TOWN_PLOT_SIZE + b.tileY)
})

/** Why the ghost cannot go where it hovers, from the same rules the server enforces. */
const ghostIssue = computed<string | null>(() => {
    const tile = hoveredTile.value
    if (!tile || !ghostType.value) return null
    const def = getTownBuilding(ghostType.value)
    if (!def) return null
    const others = movingId.value ? simBuildings.value.filter(b => b.id !== movingId.value) : simBuildings.value
    return townPlacementIssue(others, def, tile.wx, tile.wy, ghostRotation.value)
})

/** What the selected industry building does to the neighbourhood. */
const selNuisance = computed(() => {
    const b = selectedBuilding.value
    const def = selDef.value
    if (!b || !def || def.kind !== 'industry') return null
    const plot = plotById.value.get(b.plotId)
    if (!plot) return null
    const { radius, penalty } = townIndustryNuisance(def)
    const homes = townHousesWithin(simBuildings.value, plot.x * TOWN_PLOT_SIZE + b.tileX, plot.y * TOWN_PLOT_SIZE + b.tileY, radius)
    return { radius, penalty, homes, total: homes * penalty }
})

/** How well the selected workshop's inputs reach it — null unless it consumes goods. */
const selSupply = computed(() => selectedBuilding.value?.supply ?? null)
/** Per-hour rate the building really runs at: recipe × level × throughput. */
function selRate(perLevel: number) {
    const b = selectedBuilding.value
    if (!b) return 0
    return perHour(perLevel * b.level * (b.throughput ?? 1))
}
/** The supply tag's tooltip: the rule once, then a line per input good. */
const selSupplyTitle = computed(() => {
    const s = selSupply.value
    if (!s) return ''
    const lines = []
    for (const i of s.inputs) {
        const name = town.resourceById.value.get(i.resource)?.name ?? i.resource
        const where = i.nearestTiles === null ? 'no supplier' : `${i.nearestTiles} road ${i.nearestTiles === 1 ? 'tile' : 'tiles'} away`
        lines.push(`${name} ${Math.round(i.ratio * 100)}% · ${where}`)
    }
    return lines.join('\n')
})
/** The starved input and the building that would feed it — only when there is something to build. */
const selSupplyFix = computed(() => {
    const s = selSupply.value
    if (!s) return null
    const c = town.constants.value
    const worst = s.inputs.reduce<typeof s.inputs[number] | null>((w, i) => !w || i.ratio < w.ratio ? i : w, null)
    if (!worst || worst.ratio > c.supplyMinEfficiency + 0.05) return null
    const maker = town.catalog.value.find(e => Object.keys(e.outputs).includes(worst.resource))
    if (!maker || !town.unlockedTiers.value.has(maker.tier)) return null
    return { resource: worst.resource, name: town.resourceById.value.get(worst.resource)?.name ?? worst.resource, maker: maker.name, tiles: c.supplyFullTiles }
})

function upgradeSelected() {
    const b = selectedBuilding.value
    if (!b) return
    if (buildersFree.value === 0) { openBlocked({ kind: 'upgrade', buildingId: b.id }); return }
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

const confirmPlot = ref<{ x: number, y: number } | null>(null)
function buyPlot(slot: { x: number, y: number }) {
    if (!plotPurchase.value) return
    if (plotPurchase.value.maxed) { toast.add({ title: 'You own the maximum number of plots', color: 'warning' }); return }
    if (plotRemainingMs.value > 0) { toast.add({ title: 'Land office closed', description: `Opens in ${formatTownDuration(plotRemainingMs.value)}`, color: 'warning' }); return }
    if (!plotAffordable.value) { toast.add({ title: 'Not enough coins', color: 'error' }); sound.play('error'); return }
    sound.play('open')
    confirmPlot.value = slot
}
function confirmBuyPlot() {
    const slot = confirmPlot.value
    confirmPlot.value = null
    if (!slot) return
    run(() => town.buyPlot(slot.x, slot.y), res => toast.add({ title: 'New land!', description: `Paid ${formatNumber(res.price)} coins`, color: 'success' }), 'plot')
}

// ── Land ──
const buildingsOnPlot = computed(() => {
    const counts: Record<string, number> = {}
    for (const b of town.buildings.value) counts[b.plotId] = (counts[b.plotId] ?? 0) + 1
    return counts
})
const listingPrices = ref<Record<string, number | null>>({})
/** Only bare land can change hands, so those are the only rows worth listing. */
const emptyPlots = computed(() => town.plots.value.filter(p => !buildingsOnPlot.value[p.id]))
const confirmListing = ref<{ id: string, ownerName: string, price: number } | null>(null)

function onSelectListing(listing: { id: string, ownerName: string, price: number }) {
    sound.unlock()
    sound.play('open')
    confirmListing.value = listing
}

function buyListing() {
    const listing = confirmListing.value
    confirmListing.value = null
    if (!listing) return
    run(() => town.buyPlotFromPlayer(listing.id, listing.price), res => toast.add({ title: `Bought ${listing.ownerName}'s plot`, description: `Paid ${formatNumber(res.price)} coins`, color: 'success' }), 'plot')
}

function listPlotForSale(plotId: string) {
    const price = listingPrices.value[plotId]
    if (!price || price < 1) { toast.add({ title: 'Set an asking price first', color: 'warning' }); return }
    run(() => town.listPlot(plotId, price), () => toast.add({ title: `Listed for ${formatNumber(price)} coins`, color: 'success' }), 'click')
}

function unlistPlot(plotId: string) {
    run(() => town.listPlot(plotId, null), () => toast.add({ title: 'Taken off the market', color: 'neutral' }), 'close')
}

const confirmSellPlot = ref<string | null>(null)
const sellPlotRefund = computed(() => town.plots.value.find(p => p.id === confirmSellPlot.value)?.refund ?? 0)
function sellPlotBack() {
    const plotId = confirmSellPlot.value
    confirmSellPlot.value = null
    if (!plotId) return
    run(() => town.sellPlot(plotId), res => toast.add({ title: `Land office paid ${formatNumber(res.refund)} coins`, color: 'success' }), 'coin')
}

// ── Market ──
function openMarket(resource?: string) {
    if (resource) marketResource.value = resource
    if (windowOpen.value !== 'market') openWindow('market')
}
function sellFloor(resource: string, quantity: number) {
    run(() => town.sellToFloor(resource, quantity), (res) => {
        const toMayors = res.filledByPlayers > 0 ? ` — ${formatNumber(res.filledByPlayers)} to other mayors` : ''
        toast.add({ title: `Sold ${formatNumber(res.quantity)} for ${formatNumber(res.total)} coins${toMayors}`, color: 'success' })
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
function sellBulk(items: { resource: string, quantity: number }[]) {
    if (!items.length) return
    run(() => town.sellBulk(items), (res) => {
        toast.add({ title: `Sold ${res.lines.length} ${res.lines.length === 1 ? 'good' : 'goods'} for ${formatNumber(res.total)} coins`, color: 'success' })
        sound.play(res.total >= 100_000 ? 'bigcoin' : 'coin')
    })
}
function cancelOrder(orderId: string) {
    run(() => town.cancelOrder(orderId), () => toast.add({ title: 'Offer cancelled', color: 'neutral' }), 'close')
}

// ── Milestones ──
const claimable = computed(() => town.claimableMilestones.value.length)
function claimMilestone(id: string) {
    run(() => town.claimMilestone(id), (res) => {
        const parts = [res.gems ? `+${res.gems} gems` : '', res.reward ? `+${formatNumber(res.reward)} coins` : ''].filter(Boolean)
        toast.add({ title: `${res.title} · ${parts.join(' ')}`, color: 'success', icon: 'i-lucide-trophy' })
    }, 'bigcoin')
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

// ── Happiness / needs popover ──
const moodOpen = ref(false)
const moodPinned = ref(false)
const needs = computed(() => town.needs.value)
/** Needs the score actually counts — the rest are future tiers, shown greyed. */
const scoredNeeds = computed(() => needs.value.filter(n => n.expected || n.satisfied))
const unmetNeeds = computed(() => needs.value.filter(n => n.expected && !n.satisfied))
const starving = computed(() => needs.value.some(n => n.food && n.expected) && !needs.value.some(n => n.food && n.satisfied))
const mood = computed(() => town.state.value?.mood ?? null)
const nextMood = computed(() => town.state.value?.nextMood ?? null)
const happinessPotential = computed(() => town.state.value?.happinessPotential ?? 0)
const breakdown = computed(() => town.state.value?.happinessBreakdown ?? null)
/** The happiness score, line by line, worst first — what to fix shows at a glance. */
const scoreRows = computed(() => {
    const b = breakdown.value
    if (!b) return []
    const rows: { label: string, points: number, hint: string }[] = []
    rows.push({ label: '🏘️ Town', points: b.base, hint: 'Every town starts here' })
    if (b.needs !== 0) {
        rows.push({
            label: '🍞 Needs',
            points: b.needs,
            hint: b.needs > 0 ? 'Goods your townsfolk have' : 'Goods they want and cannot get'
        })
    }
    if (b.parks) rows.push({ label: '🌳 Parks', points: b.parks, hint: `${formatNumber(b.layout.residentsWithPark)} of ${formatNumber(b.layout.residents)} residents live near one` })
    if (b.industry) rows.push({ label: '🏭 Industry', points: b.industry, hint: `${formatNumber(b.layout.residentsWithIndustry)} residents live beside workshops` })
    if (b.crowding) rows.push({ label: '👥 Overcrowded', points: b.crowding, hint: 'More jobs than residents' })
    if (starving.value) rows.push({ label: '😠 Starving', points: -12, hint: 'No food in store at all' })
    return rows
})
/** A mood's perks as short game-style chips: "+15% production", "−10% build time". */
function perkChips(m: { speed: number, buildTime: number, storage: number } | null) {
    if (!m) return []
    const pct = (v: number) => `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`
    const out: { text: string, good: boolean, bad: boolean }[] = []
    out.push(m.speed === 1 ? { text: '⚙️ normal production', good: false, bad: false } : { text: `⚙️ ${pct(m.speed - 1)} production`, good: m.speed > 1, bad: m.speed < 1 })
    if (m.buildTime !== 1) out.push({ text: `🔨 ${pct(m.buildTime - 1)} build time`, good: m.buildTime < 1, bad: m.buildTime > 1 })
    if (m.storage !== 1) out.push({ text: `📦 ${pct(m.storage - 1)} storage`, good: true, bad: false })
    return out
}
/** Which building makes a need the town cannot produce yet. */
function needMaker(resource: string) {
    const maker = town.catalog.value.find(c => Object.keys(c.outputs).includes(resource))
    return maker ? `build a ${maker.name} (tier ${maker.tier})` : 'not unlocked yet'
}
function openMood(pin = false) {
    moodOpen.value = true
    if (pin) moodPinned.value = !moodPinned.value
}
function leaveMood() {
    if (!moodPinned.value) moodOpen.value = false
}

// ── HUD ──
const happiness = computed(() => town.state.value?.happiness ?? 50)
const speed = computed(() => town.state.value?.speedMultiplier ?? 0.75)
const popCap = computed(() => town.state.value?.popCap ?? 0)

// ── Builders ──
// One crew per running build or upgrade. This is the pacing lever: a town can
// only grow on as many fronts as it has crews, and the rest cost gems.
const buildersFree = computed(() => town.buildersFree.value)
const builderTip = computed(() => {
    const b = town.builders.value
    const head = buildersFree.value === 0
        ? `All ${b.owned} builders are on a job. Rush one or wait.`
        : `${buildersFree.value} of ${b.owned} builders free.`
    return b.nextGemCost === null ? head : `${head}\nClick to hire another for ${b.nextGemCost} gems.`
})
const buildersOpen = ref(false)
function openBuilders() {
    sound.unlock()
    if (town.builders.value.nextGemCost === null) return
    sound.play('open')
    buildersOpen.value = true
}

/**
 * Every job running right now, cheapest to rush first. The block modal offers
 * the top one so a player who is one crew short can pay their way out of the
 * wait without hunting for the building on the map.
 */
const runningJobs = computed(() => town.buildings.value
    .filter(b => b.completesAt > now.value && (b.level === 0 || b.upgradingTo !== null))
    .map(b => ({
        id: b.id,
        name: town.catalogById.value.get(b.type)?.name ?? b.type,
        type: b.type,
        level: b.upgradingTo ?? 1,
        first: b.level === 0,
        remainingMs: b.completesAt - now.value,
        gems: townRushGemCost(b.completesAt - now.value)
    }))
    .sort((a, b) => a.gems - b.gems))

/** The build or upgrade a player asked for while every crew was busy. */
const blocked = ref<{ kind: 'build', type: string } | { kind: 'upgrade', buildingId: string } | null>(null)
const blockedCheapest = computed(() => runningJobs.value[0] ?? null)

function openBlocked(next: { kind: 'build', type: string } | { kind: 'upgrade', buildingId: string }) {
    sound.unlock()
    sound.play('error')
    blocked.value = next
}

/** Rush the cheapest job, then start what the player actually wanted. */
async function rushAndContinue() {
    const job = blockedCheapest.value
    const next = blocked.value
    if (!job || !next) return
    blocked.value = null
    await run(() => town.rushBuilding(job.id), res => toast.add({ title: `Rushed for ${res.gems} ${res.gems === 1 ? 'gem' : 'gems'}`, color: 'success' }), 'rush')
    if (next.kind === 'build') pickBuild(next.type)
    else await run(() => town.upgradeBuilding(next.buildingId), res => toast.add({ title: `Upgrading to level ${res.level}`, color: 'success' }), 'upgrade')
}
/** A dot on the dock while something is in the lab. */
const researchRunning = computed(() => !!town.researchBoard.value?.active)
function startResearch(id: string) {
    const name = town.researchBoard.value?.projects.find(p => p.id === id)?.name ?? 'Project'
    run(() => town.startResearch(id), () => {
        toast.add({ title: `${name} started`, color: 'success' })
        town.refreshResearch()
        town.refresh()
    }, 'upgrade')
}

function hireBuilder() {
    buildersOpen.value = false
    run(() => town.hireBuilder(), res => toast.add({ title: `Builder hired — ${res.builders} crews`, description: `Paid ${res.gems} gems`, color: 'success' }), 'coin')
}
const workersDemanded = computed(() => town.state.value?.workersDemanded ?? 0)
const incomePerDay = computed(() => town.state.value?.floorIncomePerDay ?? 0)
const storageCap = computed(() => town.state.value?.storageCap ?? 0)
const ticksPerHour = computed(() => (3_600_000 / town.constants.value.tickMs) * speed.value)
/** Per-tick amounts are an implementation detail; every number the player sees is per hour. */
function perHour(perTick: number) {
    return Math.round(perTick * ticksPerHour.value)
}
const inventoryRows = computed(() => town.resources.value
    .map(r => ({ ...r, amount: town.inventory.value[r.id] ?? 0, perHour: Math.round((town.netPerTick.value[r.id] ?? 0) * ticksPerHour.value) }))
    .filter(r => r.amount > 0 || r.perHour !== 0))
function toggleSound() {
    sound.unlock()
    sound.enabled.value = !sound.enabled.value
    if (sound.enabled.value) sound.play('click')
}

/**
 * The terrain map. Off by default and off after a reload: the town is the
 * thing worth looking at, and the map is what you reach for while deciding
 * where something goes.
 */
const terrainOverlay = ref(false)
function toggleTerrain() {
    terrainOverlay.value = !terrainOverlay.value
    sound.play('click')
}

/** The legend, in the order the ground reads: what pays, then what blocks. */
const terrainLegend = computed(() => TOWN_TERRAINS.map(t => ({
    id: t.id,
    name: t.name,
    emoji: t.emoji,
    css: townTerrainCss(t.color),
    description: t.description,
    /** The building on the cursor gains from this ground. */
    boosting: ghostType.value !== null && t.boosts.includes(ghostType.value as never)
})))

function onKey(e: KeyboardEvent) {
    if (townIsTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
    if (e.code === 'KeyR' && ghostType.value && !welcome.value && !helpOpen.value && !confirmDemolish.value) {
        e.preventDefault()
        rotatePlacement()
        return
    }
    if (e.key === 'Escape') {
        if (blocked.value) blocked.value = null
        else if (buildersOpen.value) buildersOpen.value = false
        else if (confirmPlot.value) confirmPlot.value = null
        else if (confirmListing.value) confirmListing.value = null
        else if (confirmSellPlot.value) confirmSellPlot.value = null
        else if (ghostType.value) { ghostType.value = null; movingId.value = null }
        else if (welcome.value) welcome.value = null
        else if (helpOpen.value) helpOpen.value = false
        else closeAll()
    } else if (e.key === 'b' || e.key === 'B') toggleBuild()
    else if (e.key === 'm' || e.key === 'M') openMarket()
    else if (e.key === 't' || e.key === 'T') openWindow('goals')
    else if (e.key === 'l' || e.key === 'L') openWindow('mayors')
    else if (e.key === 'c' || e.key === 'C') openWindow('research')
    else if (e.key === 'p' || e.key === 'P') openWindow('land')
    else if (e.key === 'g' || e.key === 'G') toggleTerrain()
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
            else if (def?.kind === 'industry') push(b, townIndustryNuisance(getTownBuilding(b.type)!).radius, 'bad')
        }
    }
    const sel = selectedBuilding.value
    const selEntry = selectedEntry.value
    if (sel && selEntry && selEntry.kind === 'civic') push(sel, town.constants.value.parkRadius, 'good')
    else if (sel && selEntry && selEntry.kind === 'industry') push(sel, townIndustryNuisance(getTownBuilding(selEntry.id)!).radius, 'bad')
    return out
})

/** Radius the ghost itself projects, drawn under the cursor while placing. */
const ghostRadius = computed(() => {
    const def = ghostType.value ? town.catalogById.value.get(ghostType.value) : null
    if (!def) return null
    if (def.kind === 'civic') return { radius: town.constants.value.parkRadius, kind: 'good' as const }
    if (def.kind === 'industry') return { radius: townIndustryNuisance(getTownBuilding(def.id)!).radius, kind: 'bad' as const }
    return null
})

/** Colour a meter by how close to full it is. */
function barClass(ratio: number) {
    return ratio >= 0.99 ? 'ok' : ratio >= 0.6 ? 'meh' : 'bad'
}

function hex(color: number) { return `#${color.toString(16).padStart(6, '0')}` }
</script>

<template>
    <div ref="rootEl" class="town-root" @mousemove="trackPointer">
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
            :ghost-level="ghostLevel"
            :keyboard-enabled="!windowOpen && !welcome && !helpOpen && !confirmDemolish && !confirmPlot && !confirmListing && !confirmSellPlot && !buildersOpen && !blocked"
            :server-offset-ms="town.serverOffsetMs.value"
            :pop-cap="popCap"
            :speed-multiplier="speed"
            :tick-ms="town.constants.value.tickMs"
            :expansion-label="expansionLabel"
            :expansion-affordable="canBuyPlot"
            :neighbours="town.world.value.towns"
            :effect-radii="effectRadii"
            :ghost-radius="ghostRadius"
            :ghost-issue="ghostIssue"
            :moving-id="movingId"
            :terrain-overlay="terrainOverlay"
            @hover-tile="onHoverTile"
            @select-tile="onSelectTile"
            @select-building="onSelectBuilding"
            @select-expansion="buyPlot"
            @select-listing="onSelectListing"
            @hover-building="hoveredBuildingId = $event"
            @hover-neighbour="hoveredNeighbour = $event"
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
                <div class="g-chip" :class="workersDemanded > popCap ? 'g-chip-warn' : ''" :data-tip-below="workersDemanded > popCap ? 'Not enough residents — build houses' : 'Jobs / residents'">
                    <span class="g-ico">👥</span><b>{{ workersDemanded }}<span class="opacity-50">/{{ popCap }}</span></b>
                </div>
                <button class="g-chip g-chip-btn" :class="buildersFree === 0 ? 'g-chip-warn' : ''" :data-tip-below="builderTip" @click="openBuilders">
                    <span class="g-ico">🔨</span><b>{{ buildersFree }}<span class="opacity-50">/{{ town.builders.value.owned }}</span></b>
                </button>
                <button
                    class="g-chip g-chip-btn"
                    :class="terrainOverlay ? 'is-pinned' : ''"
                    data-tip-below="Terrain map — see which tiles pay a bonus (G)"
                    @click="toggleTerrain"
                >
                    <span class="g-ico">🏞️</span><b>Terrain<kbd class="chip-key">G</kbd></b>
                </button>
                <div class="relative" @mouseenter="openMood()" @mouseleave="leaveMood">
                    <button class="g-chip g-chip-btn" :class="[unmetNeeds.length || starving ? 'g-chip-warn' : '', moodPinned ? 'is-pinned' : '']" @click="openMood(true)">
                        <span class="g-ico">{{ mood?.emoji ?? '🙂' }}</span>
                        <span class="g-meter g-meter-lg">
                            <i :style="{ width: `${happiness}%` }" :class="happiness >= 50 ? 'ok' : happiness >= 25 ? 'meh' : 'bad'" />
                            <em class="g-meter-mark" :style="{ left: `${happinessPotential}%` }" data-tip-below="Reachable with what you can make right now" />
                        </span>
                        <b class="text-xs">{{ mood?.name ?? '' }}</b>
                        <span v-if="unmetNeeds.length" class="g-dot">{{ unmetNeeds.length }}</span>
                    </button>

                    <Transition name="fade">
                        <div v-if="moodOpen" class="moodpop">
                            <div class="moodpop-head">
                                <span class="text-2xl">{{ mood?.emoji }}</span>
                                <b class="text-base">{{ mood?.name }}</b>
                                <span class="opacity-50">{{ happiness }} / 100</span>
                                <button v-if="moodPinned" class="g-icon g-icon-sm ml-auto" @click="moodPinned = false; moodOpen = false">✕</button>
                            </div>

                            <div class="moodpop-perks">
                                <span v-for="perk in perkChips(mood)" :key="perk.text" class="g-tag" :class="perk.good ? 'g-tag-green' : perk.bad ? 'g-tag-red' : ''">{{ perk.text }}</span>
                            </div>
                            <p v-if="nextMood" class="moodpop-next">
                                {{ nextMood.emoji }} <b>{{ nextMood.name }}</b> at {{ nextMood.min }}:
                                <span v-for="perk in perkChips(nextMood)" :key="perk.text" class="moodpop-next-perk">{{ perk.text }}</span>
                            </p>

                            <div class="moodpop-sec">Where the score comes from</div>
                            <div v-for="row in scoreRows" :key="row.label" class="score-row" :class="row.points > 0 ? 'is-plus' : row.points < 0 ? 'is-minus' : ''">
                                <b class="min-w-0 flex-1 truncate">{{ row.label }}</b>
                                <span class="truncate text-[11px] opacity-60">{{ row.hint }}</span>
                                <span class="score-points">{{ row.points > 0 ? '+' : '' }}{{ row.points }}</span>
                            </div>

                            <div class="moodpop-sec">Needs</div>
                            <div v-for="n in scoredNeeds" :key="n.resource" class="needs-row" :class="n.satisfied ? 'is-ok' : 'is-bad'" :data-tip="n.description">
                                <span class="text-lg"><TownAsset :id="n.resource" /></span>
                                <b class="w-20">{{ n.name }}</b>
                                <span class="min-w-0 flex-1 truncate opacity-70">
                                    <template v-if="n.satisfied">{{ formatNumber(perHour(n.perTick)) }}/h</template>
                                    <template v-else-if="!n.producible">{{ needMaker(n.resource) }}</template>
                                    <template v-else>out of stock · needs {{ formatNumber(perHour(n.perTick)) }}/h</template>
                                </span>
                                <span class="needs-badge">{{ n.satisfied ? '+' : '−' }}{{ n.happiness }}</span>
                            </div>
                            <p v-if="scoredNeeds.length === 0" class="needs-foot">Your townsfolk want for nothing yet. New wants appear as the town grows and unlocks tiers.</p>
                        </div>
                    </Transition>
                </div>
                <div class="g-chip g-chip-green" data-tip-below="What a day of output is worth if you sell it all at the floor price. There is no passive income — you earn by selling.">
                    <span class="g-ico">📈</span><b>{{ formatNumber(incomePerDay) }}<span class="text-xs opacity-60">/day if sold</span></b>
                </div>
            </div>

            <!-- Top-right controls -->
            <div class="corner">
                <button class="g-icon" data-tip-below="How to play" @click="helpOpen = true">?</button>
                <button class="g-icon" :data-tip-below="sound.enabled.value ? 'Mute' : 'Unmute'" @click="toggleSound">{{ sound.enabled.value ? '🔊' : '🔇' }}</button>
                <button class="g-icon" data-tip-below="Recenter" @click="sceneRef?.recenter()">◎</button>
            </div>

            <!-- Placement hint -->
            <Transition name="fade">
                <div v-if="ghostType" class="hint">
                    <b><TownAsset v-if="ghostType !== 'road'" :id="ghostType" kind="building" :level="ghostLevel" /><template v-else>🛣️</template> {{ town.catalogById.value.get(ghostType)?.name }}</b>
                    <template v-if="town.catalogById.value.get(ghostType)?.kind !== 'road'">
                        <button class="placement-rotate" data-tip-below="The white arrow is the front door, and it has to touch a road." @click="rotatePlacement"><kbd>R</kbd> rotate</button>
                    </template>
                    <kbd>Esc</kbd>
                </div>
                <div v-else-if="hoveredSlot && plotPurchase && plotRemainingMs > 0 && !plotPurchase.maxed" class="hint">
                    Land office opens in <b>{{ formatTownDuration(plotRemainingMs) }}</b>
                </div>
            </Transition>

            <!-- Inventory (left) -->
            <div v-if="inventoryRows.length" class="inv">
                <button v-for="r in inventoryRows" :key="r.id" class="inv-row" :class="r.amount >= storageCap ? 'is-full' : ''" @click="openMarket(r.id)">
                    <span class="inv-emoji"><TownAsset :id="r.id" /></span>
                    <span class="inv-num">{{ formatNumber(r.amount) }}</span>
                    <span v-if="r.perHour" class="inv-rate" :class="r.perHour > 0 ? 'up' : 'down'">{{ r.perHour > 0 ? '+' : '' }}{{ formatNumber(r.perHour) }}/h</span>
                </button>
            </div>

            <!-- Land for sale under the cursor -->
            <div v-if="hoveredSlot && !hoveredBuilding && !hoveredNeighbour" class="tip is-cursor">
                <template v-if="!hoveredSlot.free">
                    <b>{{ hoveredSlot.ownerName ?? 'Another mayor' }}</b>
                    <div class="opacity-70">Their land</div>
                </template>
                <template v-else-if="plotPurchase?.maxed">
                    <b>🗺️ Land office</b>
                    <div class="opacity-70">You own the maximum number of plots</div>
                </template>
                <template v-else-if="plotRemainingMs > 0">
                    <b>🗺️ For sale</b>
                    <div class="opacity-70">Land office opens in {{ formatTownDuration(plotRemainingMs) }}</div>
                </template>
                <template v-else>
                    <b>🗺️ For sale · <TownCoin /> {{ formatNumber(plotPurchase?.price ?? 0) }}</b>
                    <div class="opacity-70">{{ plotAffordable ? 'Click to buy' : 'Not enough coins' }}</div>
                </template>
            </div>

            <!-- Another mayor's land -->
            <div v-if="hoveredNeighbour && !hoveredBuilding" class="tip is-cursor">
                <b>{{ hoveredNeighbour.ownerName }}</b>
                <div v-if="hoveredNeighbour.type" class="opacity-70">
                    <TownAsset v-if="hoveredNeighbour.type !== 'road'" :id="hoveredNeighbour.type" kind="building" /><template v-else>🛣️</template>
                    {{ town.catalogById.value.get(hoveredNeighbour.type)?.name ?? 'Building' }}<template v-if="hoveredNeighbour.level && hoveredNeighbour.type !== 'road'"> · Lv {{ hoveredNeighbour.level }}</template>
                </div>
            </div>

            <!-- Hover tooltip -->
            <div v-if="hoveredBuilding && hoveredEntry && !selectedBuilding" class="tip is-cursor">
                <b><TownAsset :id="hoveredEntry.id" kind="building" :level="hoveredBuilding.level" /> {{ hoveredEntry.name }}</b>
                <span v-if="hoveredBuilding.level > 0" class="opacity-60"> · Lv {{ hoveredBuilding.level }}</span>
                <div class="opacity-70">
                    <template v-if="hoveredBuilding.connected === false && hoveredEntry.kind !== 'road'"><span class="text-rose-300 font-bold">⚠ No road at the front door — not working</span></template>
                    <template v-else-if="hoveredBuilding.completesAt > now">{{ hoveredBuilding.level === 0 ? 'Building' : 'Upgrading' }} · {{ formatTownDuration(hoveredBuilding.completesAt - now) }}</template>
                    <template v-else-if="hoveredEntry.kind === 'industry' && hoveredBuilding.district?.residents === 0"><span class="text-rose-300 font-bold">⚠ No homes on this road</span></template>
                    <template v-else-if="hoveredEntry.kind === 'industry'">{{ Math.round((hoveredBuilding.staffing ?? 0) * 100) }}% staffed</template>
                    <template v-else-if="hoveredEntry.kind === 'housing'">{{ hoveredEntry.popCap * hoveredBuilding.level }} residents</template>
                    <template v-else>Click for details</template>
                </div>
            </div>

            <!-- Selected building card -->
            <Transition name="rise">
                <div v-if="selectedBuilding && selectedEntry" class="card">
                    <div class="card-head">
                        <span class="card-emoji" :style="{ background: hex(selectedEntry.color) + '33' }"><TownAsset :id="selectedEntry.id" kind="building" :level="selectedBuilding.level" /></span>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                                <b class="text-base">{{ selectedEntry.name }}</b>
                                <span v-if="selectedBuilding.level > 0 && selectedEntry.kind !== 'road'" class="g-tag" :data-tip="`This one tops out at level ${selMaxLevel}.`">Lv {{ selectedBuilding.level }}<span class="opacity-50">/{{ selMaxLevel }}</span><template v-if="selectedBuilding.upgradingTo"> → {{ selectedBuilding.upgradingTo }}</template></span>
                                <span v-else class="g-tag">Building</span>
                            </div>
                            <div class="text-xs opacity-70">{{ selectedEntry.description }}</div>
                        </div>
                        <button class="g-icon g-icon-sm" @click="closeAll">✕</button>
                    </div>

                    <div class="card-body">
                        <div v-if="selectedBuilding.connected === false && selectedEntry.kind !== 'road'" class="card-alert">
                            <b>!</b> No road at the front door. Nothing works here until you move it or lay a road on the tile the white arrow points at.
                        </div>

                        <div v-if="selPending" class="card-row">
                            <div class="flex-1">
                                <div class="flex justify-between text-xs opacity-80">
                                    <span>🔨 {{ selectedBuilding.level === 0 ? 'Under construction' : 'Upgrading' }}</span>
                                    <b>{{ formatTownDuration(selRemaining) }}</b>
                                </div>
                                <div class="g-progress mt-1"><i :style="{ width: `${Math.round(100 * (1 - selRemaining / Math.max(1, selectedBuilding.jobMs ?? 1)))}%` }" /></div>
                            </div>
                            <button class="g-btn g-btn-gem" :disabled="busy || gems < selRushGems" @click="rushSelected">💎 Rush · {{ selRushGems }}</button>
                        </div>

                        <template v-else>
                            <!-- What it makes, at the rate it really runs -->
                            <div v-if="selectedEntry.kind === 'industry'" class="recipe">
                                <span v-for="[id, q] in Object.entries(selectedEntry.inputs)" :key="id" class="recipe-item is-in">
                                    <TownAsset :id="id" /> −{{ formatNumber(selRate(q)) }}
                                </span>
                                <span v-if="Object.keys(selectedEntry.inputs).length" class="recipe-arrow">→</span>
                                <span v-for="[id, q] in Object.entries(selectedEntry.outputs)" :key="id" class="recipe-item is-out">
                                    <TownAsset :id="id" /> +{{ formatNumber(selRate(q)) }}
                                </span>
                                <span class="recipe-unit" data-tip="What it really moves right now. Level, workers and supply are all counted in.">per hour</span>
                            </div>

                            <!-- The two things that slow a building down -->
                            <div v-if="selWorkersWanted > 0" class="meters">
                                <div class="meter" :data-tip="selWorkersTitle">
                                    <span class="meter-ico">👥</span>
                                    <span class="meter-label">Workers</span>
                                    <span class="meter-bar"><i :class="barClass(selectedBuilding.staffing ?? 0)" :style="{ width: `${Math.round((selectedBuilding.staffing ?? 0) * 100)}%` }" /></span>
                                    <b class="meter-value">{{ Math.round((selectedBuilding.staffing ?? 0) * 100) }}%</b>
                                </div>
                                <div v-if="selSupply" class="meter" :data-tip="selSupplyTitle">
                                    <span class="meter-ico">🚚</span>
                                    <span class="meter-label">Supply</span>
                                    <span class="meter-bar"><i :class="barClass(selSupply.ratio)" :style="{ width: `${Math.round(selSupply.ratio * 100)}%` }" /></span>
                                    <b class="meter-value">{{ Math.round(selSupply.ratio * 100) }}%</b>
                                </div>
                            </div>

                            <!-- Everything else says its one thing -->
                            <div v-if="selectedEntry.kind === 'housing'" class="card-stats">
                                <span class="g-tag g-tag-green">👥 {{ selectedEntry.popCap * selectedBuilding.level }} residents</span>
                                <span v-if="selAdjacency" class="g-tag" :class="selAdjacency.parks ? 'g-tag-green' : ''" :data-tip="`Parks within ${town.constants.value.parkRadius} tiles make this home happier.`">🌳 {{ selAdjacency.parks }} nearby</span>
                                <span v-if="selAdjacency" class="g-tag" :class="selAdjacency.industry ? 'g-tag-red' : ''" data-tip="Workshops beside homes drag the town score down. Select one to see how far it reaches.">🏭 {{ selAdjacency.industry }} nearby</span>
                            </div>
                            <div v-else-if="selectedEntry.kind === 'civic'" class="card-stats">
                                <span class="g-tag g-tag-green">😊 +{{ selectedEntry.happiness * selectedBuilding.level }} happiness</span>
                                <span class="g-tag" :data-tip="`Every home within ${town.constants.value.parkRadius} tiles of this park is happier for it.`">🌳 reaches {{ town.constants.value.parkRadius }} tiles</span>
                            </div>
                            <div v-else-if="selectedEntry.kind === 'storage'" class="card-stats">
                                <span class="g-tag" :class="(selectedBuilding.staffing ?? 0) >= 0.99 ? 'g-tag-green' : ''" data-tip="A warehouse holds only what its crew can manage, so an unstaffed one holds nothing.">📦 +{{ formatNumber(Math.floor(selectedEntry.storage * selectedBuilding.level * (selectedBuilding.staffing ?? 0))) }} storage per good</span>
                            </div>

                            <!-- Notes, only when they have something to say -->
                            <p v-if="selDistrictFix" class="card-note is-bad">
                                {{ selDistrictFix }}
                            </p>
                            <p v-else-if="selSupplyFix" class="card-note is-bad">
                                Starved of <TownAsset :id="selSupplyFix.resource" /> {{ selSupplyFix.name }}. Put a {{ selSupplyFix.maker }} within {{ selSupplyFix.tiles }} road tiles, or buy some at the market.
                            </p>
                            <p v-else-if="selNuisance && selNuisance.homes > 0" class="card-note is-bad">
                                🏭 {{ selNuisance.homes }} {{ selNuisance.homes === 1 ? 'home' : 'homes' }} within {{ selNuisance.radius }} tiles, costing the town {{ selNuisance.total }} happiness.
                            </p>

                            <!-- Upgrade -->
                            <template v-if="selCanUpgrade && selectedEntry.kind !== 'road'">
                                <div class="upgrade">
                                    <div class="upgrade-info">
                                        <div class="upgrade-head">
                                            <b>Level {{ selNextLevel }}</b>
                                            <span class="opacity-55">⏱ {{ formatTownDuration(selUpgradeMs) }}</span>
                                        </div>
                                        <div class="upgrade-cost">
                                            <span :class="balance >= selUpgradeCost.coins ? '' : 'bad'"><TownCoin /> {{ formatNumber(selUpgradeCost.coins) }}</span>
                                            <span v-for="[id, q] in Object.entries(selUpgradeCost.resources)" :key="id" :class="(town.inventory.value[id] ?? 0) >= q ? '' : 'bad'"><TownAsset :id="id" /> {{ formatNumber(q) }}</span>
                                        </div>
                                    </div>
                                    <button class="g-btn g-btn-primary upgrade-go" :disabled="busy || !canAfford(selUpgradeCost)" :data-tip="buildersFree === 0 ? 'Every builder is on a job — click to free one.' : canAfford(selUpgradeCost) ? undefined : 'You are short on what is marked red.'" @click="upgradeSelected">
                                        ⬆ {{ buildersFree === 0 ? 'No builder' : 'Upgrade' }}
                                    </button>
                                </div>
                            </template>
                            <div v-else-if="selectedEntry.kind !== 'road'" class="g-tag g-tag-gold justify-center py-1.5">🏅 Fully upgraded</div>

                            <div class="card-actions">
                                <button class="g-btn g-btn-sm" data-tip="Pick it up and put it on another tile. Free, but the new spot still needs a road at its front door." :disabled="busy" @click="startMove">↔ Move</button>
                                <button class="g-btn g-btn-sm g-btn-quiet-danger" data-tip="Tear it down. Nothing is refunded." @click="confirmDemolish = true">🗑 Demolish</button>
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
                        <button class="g-icon g-icon-sm ml-auto" @click="toggleBuild">✕</button>
                    </div>
                    <div v-if="tierLocked(buildTier) && tierLockText(buildTier)" class="strip-lock">🔒 {{ tierLockText(buildTier) }}</div>
                    <div class="strip-cards">
                        <button
                            v-for="c in tierEntries"
                            :key="c.id"
                            class="bcard"
                            :class="[ghostType === c.id && !movingId ? 'is-active' : '', canAfford(town.nextCost.value[c.id] ?? c.cost) && !tierLocked(c.tier) && (c.kind === 'road' || buildersFree > 0) ? '' : 'is-dim']"
                            :disabled="tierLocked(c.tier)"
                            :style="{ '--accent': hex(c.color) }"
                            :data-tip="(town.countsByType.value[c.id] ?? 0) ? `You own ${town.countsByType.value[c.id]} — each extra one costs more` : ''"
                            @click="pickBuild(c.id)"
                        >
                            <span v-if="town.countsByType.value[c.id]" class="bcard-count">×{{ town.countsByType.value[c.id] }}</span>
                            <span class="bcard-emoji"><TownAsset v-if="c.kind !== 'road'" :id="c.id" kind="building" /><span v-else>🛣️</span></span>
                            <b class="bcard-name">{{ c.name }}</b>
                            <span class="bcard-cost" :class="balance >= (town.nextCost.value[c.id]?.coins ?? c.cost.coins) ? '' : 'bad'"><TownCoin /> {{ formatNumber(town.nextCost.value[c.id]?.coins ?? c.cost.coins) }}</span>
                            <span v-if="Object.keys(town.nextCost.value[c.id]?.resources ?? c.cost.resources).length" class="bcard-res">
                                <span v-for="[id, q] in Object.entries(town.nextCost.value[c.id]?.resources ?? c.cost.resources)" :key="id" :class="(town.inventory.value[id] ?? 0) >= q ? '' : 'bad'"><TownAsset :id="id" />{{ formatNumber(q) }}</span>
                            </span>
                            <span class="bcard-meta">
                                <span v-if="c.kind === 'road'">⚡ instant</span>
                                <span v-else :data-tip="`Upgrades take ${formatTownDuration(Math.round(c.upgradeMs * (mood?.buildTime ?? 1)))} and up`">⏱ {{ formatTownDuration(Math.round(c.buildMs * (mood?.buildTime ?? 1))) }}</span>
                                <span v-if="c.workers">👥 {{ c.workers }}</span>
                                <span v-if="c.popCap">🏠 +{{ c.popCap }}</span>
                                <span v-if="c.happiness">😊 +{{ c.happiness }}</span>
                                <span v-if="c.storage">📦 +{{ formatNumber(c.storage) }}</span>
                            </span>
                            <span v-if="Object.keys(c.outputs).length" class="bcard-io" data-tip="Per hour at level 1">
                                <template v-if="Object.keys(c.inputs).length"><span v-for="[id, q] in Object.entries(c.inputs)" :key="id">{{ formatNumber(perHour(q)) }}<TownAsset :id="id" /></span>→</template>
                                <span v-for="[id, q] in Object.entries(c.outputs)" :key="id" class="text-emerald-300">{{ formatNumber(perHour(q)) }}<TownAsset :id="id" /></span>
                                <span class="opacity-50">/h</span>
                            </span>
                        </button>
                    </div>
                </div>
            </Transition>

            <!-- Terrain legend -->
            <Transition name="fade">
                <div v-if="terrainOverlay" class="legend">
                    <div class="legend-head">
                        <span>🏞️ Terrain <span class="opacity-55">+{{ Math.round(TOWN_TERRAIN_BONUS * 100) }}%</span></span>
                        <button class="g-icon g-icon-sm ml-auto" @click="toggleTerrain">✕</button>
                    </div>
                    <div v-for="t in terrainLegend" :key="t.id" class="legend-row" :class="t.boosting ? 'is-boosting' : ''">
                        <i :style="{ background: t.css }" />
                        <b>{{ t.name }}</b>
                        <span>{{ t.description }}</span>
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
                <button class="dock-btn" :class="windowOpen === 'land' ? 'is-active' : ''" @click="openWindow('land')"><span class="dock-ico">🗺️</span><span>Land</span><kbd>P</kbd></button>
                <button class="dock-btn" :class="windowOpen === 'research' ? 'is-active' : ''" @click="openWindow('research')">
                    <span class="dock-ico">🔬</span><span>Research</span><kbd>C</kbd>
                    <span v-if="researchRunning" class="dock-dot" />
                </button>
                <button class="dock-btn" :class="windowOpen === 'mayors' ? 'is-active' : ''" @click="openWindow('mayors')"><span class="dock-ico">👑</span><span>Mayors</span><kbd>L</kbd></button>
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
                            :net-per-tick="town.netPerTick.value"
                            :speed-multiplier="speed"
                            :tick-ms="town.constants.value.tickMs"
                            :storage-cap="storageCap"
                            @sell-floor="sellFloor"
                            @sell-bulk="sellBulk"
                            @place-order="placeOrder"
                            @cancel-order="cancelOrder"
                        />
                        <TownMilestonesPanel v-else-if="windowOpen === 'goals'" :milestones="town.milestones.value" :busy="busy" @claim="claimMilestone" @close="closeAll" />
                        <TownLeaderboardPanel v-else-if="windowOpen === 'mayors'" @close="closeAll" />
                        <TownResearchPanel
                            v-else-if="windowOpen === 'research'"
                            :board="town.researchBoard.value"
                            :inventory="town.inventory.value"
                            :balance="balance"
                            :now="now"
                            :busy="busy"
                            @start="startResearch"
                            @close="closeAll"
                        />

                        <div v-else-if="windowOpen === 'land'" class="flex h-full min-h-0 flex-col">
                            <div class="g-window-head">
                                <h2>🗺️ Land <span class="text-sm font-semibold opacity-50">{{ town.plots.value.length }}/{{ town.constants.value.maxPlots }}</span></h2>
                                <button class="g-icon g-icon-sm" @click="closeAll">✕</button>
                            </div>
                            <div class="g-window-body space-y-4">
                                <section>
                                    <div class="landsec-head">
                                        Yours, free to sell
                                        <span data-tip="A plot has to be completely empty before you can sell or list it.">{{ emptyPlots.length }} of {{ town.plots.value.length }}</span>
                                    </div>
                                    <p v-if="emptyPlots.length === 0" class="landsec-empty">Every plot has something on it. Demolish a plot clear to sell it.</p>
                                    <div v-for="p in emptyPlots" :key="p.id" class="plotrow">
                                        <span class="plot-ico">🟩</span>
                                        <div class="min-w-0 flex-1">
                                            <b>{{ p.x }}, {{ p.y }}</b>
                                            <div v-if="p.listPrice !== null" class="plotrow-sub" style="color: var(--g-gold)">Listed · {{ formatNumber(p.listPrice) }}</div>
                                            <div v-else class="plotrow-sub">Office pays {{ formatNumber(p.refund) }}</div>
                                        </div>
                                        <template v-if="p.listPrice === null">
                                            <input v-model.number="listingPrices[p.id]" type="number" min="1" placeholder="Ask" class="g-input w-24 py-1.5 text-xs">
                                            <button class="g-btn g-btn-sm" :disabled="busy" data-tip="Offer it to the mayors next to you at your price." @click="listPlotForSale(p.id)">List</button>
                                            <button class="g-btn g-btn-sm" :disabled="busy || p.refund <= 0" :data-tip="p.refund > 0 ? 'Sell back to the land office now.' : 'This plot was free — the office pays nothing.'" @click="confirmSellPlot = p.id">Sell</button>
                                        </template>
                                        <button v-else class="g-btn g-btn-sm" :disabled="busy" @click="unlistPlot(p.id)">Unlist</button>
                                    </div>
                                </section>

                                <section>
                                    <div class="landsec-head">
                                        For sale near you
                                        <span>{{ town.world.value.listings.length }}</span>
                                    </div>
                                    <p v-if="town.world.value.listings.length === 0" class="landsec-empty">Nobody next to you is selling.</p>
                                    <div v-for="l in town.world.value.listings" :key="l.plotId" class="plotrow">
                                        <span class="plot-ico">🗺️</span>
                                        <div class="min-w-0 flex-1">
                                            <b>{{ l.x }}, {{ l.y }}</b>
                                            <div class="plotrow-sub truncate">{{ l.ownerName }}</div>
                                        </div>
                                        <b class="tabular-nums" style="color: var(--g-gold)"><TownCoin /> {{ formatNumber(l.price) }}</b>
                                        <button class="g-btn g-btn-gold g-btn-sm" :disabled="busy || balance < l.price" @click="onSelectListing({ id: l.plotId, ownerName: l.ownerName, price: l.price })">Buy</button>
                                    </div>
                                </section>
                            </div>
                        </div>
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
                            <p v-if="welcomeValue" class="mt-3 text-center text-sm opacity-80">Worth about <b><TownCoin /> {{ formatNumber(welcomeValue) }}</b> at floor price.</p>
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
                            <p>🏠 <b>Houses</b> bring two residents per level. Every industry building needs residents to run — an unstaffed farm grows nothing.</p>
                            <p>😊 <b>Happiness</b> is a score out of 100 that sets how fast the town produces. Every town starts at 50; parks add up to 20, the goods your people want add or subtract, and workshops beside homes take up to 25 away. Open the meter to see every line.</p>
                            <p>🍞 <b>Needs</b>: residents eat grain and bread, and want bricks, tools and luxuries as the town grows. A need only counts once your town could make it — nobody misses bread before you can bake it. After that, going without costs happiness. The goods are really consumed, so keep producing or buy from other mayors.</p>
                            <p>🌳 <b>Radius</b>: a park cheers every house within 4 tiles. Industry sours the homes around it, and the higher the tier the further it reaches — a farm is a nuisance to its own street, a factory to two plots in every direction. Keeping heavy industry away from your people costs land, which is the point. While placing, the square on the ground shows the reach.</p>
                            <p>🪚 <b>Tiers</b>: raw goods → refined goods → bread and tools → iron, steel, machines, luxuries. Finish one building of a tier to unlock the next.</p>
                            <p>🚚 <b>Supply</b>: a workshop wants its materials nearby. Distance is counted in <b>road tiles travelled</b>, not how close the buildings look, so the shape of your streets decides how fast a sawmill runs. Supply is finite too: one lumber camp cannot feed five sawmills, and the closest pairing always wins. A workshop with no supplier at all still runs, just slowly, which is what makes buying from other mayors worth it.</p>
                            <p>🛣️ <b>Roads</b>: every building's front door (the arrow while placing) must touch a road, and people walk to work along the roads. Homes only staff the workshops their road network reaches, so a separate cluster needs its own houses or a road back to town. Press <kbd>R</kbd> to rotate — buildings auto-face a road next to them. Buildings can be moved for free.</p>
                            <p>⬆ <b>Levels</b>: most buildings upgrade to level 20; a park stops at 12 and a warehouse at 16. Every upgrade costs coins <b>and</b> goods, and the goods climb faster than the coins, so your own production is what really pays for growth.</p>
                            <p>🔨 <b>Builders</b>: every build and every upgrade occupies one crew until it finishes, and you start with three. That cap is the pace of the game — you cannot set the whole town upgrading at once. Roads are instant and need nobody. Three more crews can be hired for good with gems, and when everything is busy the game offers to rush the cheapest job.</p>
                            <p>🏞️ <b>Terrain</b>: land is not all the same. Fertile soil, woodland and rock each make the matching building a quarter more productive, water cannot be built on, and a rare plot is flat grassland with no bonuses at all. Press <kbd>G</kbd> to see what is where before you place anything — more land means more chances at a good patch.</p>
                            <p>🔬 <b>Research</b>: a slow track running alongside everything else. Thirty projects in five branches, one at a time, from twelve hours to three days each. More output, faster builds, longer supply reach, more residents, better prices. Finishing the board takes about two months.</p>
                            <p>📦 <b>Storage</b> caps each resource. Full storage halts production — sell, or build warehouses.</p>
                            <p>🏪 <b>Market</b>: there is <b>no passive income</b> — you earn by selling. The town hall always buys at a floor price so you are never stuck, but <b>buying is only ever from other players</b>. Offers fill instantly when they cross.</p>
                            <p>🗺️ <b>Land</b>: every mayor shares one realm. The land office sells you a square next to yours — each one costs more and opens more slowly than the last. Empty plots can go back to the office for a quarter of their price, or be listed for other mayors at any price you choose. Buying from a player skips the office's waiting time.</p>
                            <p>💎 <b>Rush</b> any build for 1 gem per 5 minutes left. 🏆 <b>Goals</b> pay coins for hitting town targets.</p>
                            <p class="opacity-60">WASD to move · Q and E to turn · drag to pan · wheel to zoom · right-drag to orbit · R to rotate a building while placing · <kbd>B</kbd>uild <kbd>M</kbd>arket <kbd>T</kbd> goals <kbd>L</kbd> mayors <kbd>P</kbd> land <kbd>C</kbd> research <kbd>G</kbd> terrain <kbd>Esc</kbd></p>
                        </div>
                    </div>
                </div>
            </Transition>

            <!-- Land purchase confirm -->
            <Transition name="fade">
                <div v-if="confirmPlot && plotPurchase" class="backdrop" @click.self="confirmPlot = null">
                    <div class="g-window is-tiny">
                        <div class="g-window-head"><h2>🗺️ Buy this land?</h2></div>
                        <div class="g-window-body">
                            <p class="text-sm opacity-80">Plot #{{ plotPurchase.nextIndex }} at ({{ confirmPlot.x }}, {{ confirmPlot.y }}). More land means more production — and the next plot costs more again.</p>
                            <div class="mt-3 flex items-center justify-between rounded-xl px-3 py-2" style="background: rgba(255,255,255,0.06)">
                                <span class="text-sm opacity-70">Price</span>
                                <b class="text-lg" style="color: var(--g-gold)"><TownCoin /> {{ formatNumber(plotPurchase.price) }}</b>
                            </div>
                            <div class="mt-4 flex justify-end gap-2">
                                <button class="g-btn" @click="confirmPlot = null">Cancel</button>
                                <button class="g-btn g-btn-gold" :disabled="busy" @click="confirmBuyPlot">Buy land</button>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>

            <!-- Buy a neighbour's plot -->
            <Transition name="fade">
                <div v-if="confirmListing" class="backdrop" @click.self="confirmListing = null">
                    <div class="g-window is-tiny">
                        <div class="g-window-head"><h2>🤝 Buy this land?</h2></div>
                        <div class="g-window-body">
                            <p class="text-sm opacity-80">{{ confirmListing.ownerName }} is selling this plot. It has to touch land you already own.</p>
                            <div class="mt-3 flex items-center justify-between rounded-xl px-3 py-2" style="background: rgba(255,255,255,0.06)">
                                <span class="text-sm opacity-70">Asking price</span>
                                <b class="text-lg" style="color: var(--g-gold)"><TownCoin /> {{ formatNumber(confirmListing.price) }}</b>
                            </div>
                            <div class="mt-4 flex justify-end gap-2">
                                <button class="g-btn" @click="confirmListing = null">Cancel</button>
                                <button class="g-btn g-btn-gold" :disabled="busy || balance < confirmListing.price" @click="buyListing">Buy land</button>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>

            <!-- Sell a plot back to the office -->
            <Transition name="fade">
                <div v-if="confirmSellPlot" class="backdrop" @click.self="confirmSellPlot = null">
                    <div class="g-window is-tiny">
                        <div class="g-window-head"><h2>🗺️ Sell this plot back?</h2></div>
                        <div class="g-window-body">
                            <p class="text-sm opacity-80">The land office pays back {{ Math.round((town.state.value?.plotRefundShare ?? 0.25) * 100) }}% of what you paid for this plot. Another mayor may pay more.</p>
                            <div class="mt-3 flex items-center justify-between rounded-xl px-3 py-2" style="background: rgba(255,255,255,0.06)">
                                <span class="text-sm opacity-70">Refund</span>
                                <b class="text-lg" style="color: var(--g-gold)"><TownCoin /> {{ formatNumber(sellPlotRefund) }}</b>
                            </div>
                            <div class="mt-4 flex justify-end gap-2">
                                <button class="g-btn" @click="confirmSellPlot = null">Cancel</button>
                                <button class="g-btn g-btn-danger" :disabled="busy" @click="sellPlotBack">Sell back</button>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>

            <!-- Every crew is busy -->
            <Transition name="fade">
                <div v-if="blocked" class="backdrop" @click.self="blocked = null">
                    <div class="g-window is-tiny">
                        <div class="g-window-head"><h2>🔨 Every builder is busy</h2><button class="g-icon g-icon-sm" @click="blocked = null">✕</button></div>
                        <div class="g-window-body">
                            <p class="text-sm opacity-80">All {{ town.builders.value.owned }} of your crews are on a job. Free one up, or wait for the first to finish.</p>
                            <div v-if="blockedCheapest" class="mt-3 flex items-center gap-3 rounded-xl px-3 py-2" style="background: rgba(255,255,255,0.06)">
                                <span class="text-xl"><TownAsset :id="blockedCheapest.type" kind="building" :level="blockedCheapest.level" /></span>
                                <div class="min-w-0 flex-1">
                                    <b class="text-sm">{{ blockedCheapest.name }}</b>
                                    <div class="text-[11px] opacity-60">{{ blockedCheapest.first ? 'Building' : `Upgrading to ${blockedCheapest.level}` }} · {{ formatTownDuration(blockedCheapest.remainingMs) }} left</div>
                                </div>
                                <b style="color: var(--g-gem)">💎 {{ blockedCheapest.gems }}</b>
                            </div>
                            <div class="mt-4 flex justify-end gap-2">
                                <button class="g-btn" @click="blocked = null">Wait</button>
                                <button v-if="town.builders.value.nextGemCost !== null" class="g-btn" @click="blocked = null; openBuilders()">Hire a crew</button>
                                <button v-if="blockedCheapest" class="g-btn g-btn-gem" :disabled="busy || gems < blockedCheapest.gems" @click="rushAndContinue">Rush &amp; continue</button>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>

            <!-- Hire a builder -->
            <Transition name="fade">
                <div v-if="buildersOpen" class="backdrop" @click.self="buildersOpen = false">
                    <div class="g-window is-tiny">
                        <div class="g-window-head"><h2>🔨 Hire a builder</h2></div>
                        <div class="g-window-body">
                            <p class="text-sm opacity-80">Each crew works one build or upgrade at a time. More crews means more of the town growing at once, for good.</p>
                            <div class="mt-3 flex items-center justify-between rounded-xl px-3 py-2" style="background: rgba(255,255,255,0.06)">
                                <span class="text-sm opacity-70">{{ town.builders.value.owned }} → {{ town.builders.value.owned + 1 }} crews</span>
                                <b class="text-lg" style="color: var(--g-gem)">💎 {{ town.builders.value.nextGemCost }}</b>
                            </div>
                            <div class="mt-4 flex justify-end gap-2">
                                <button class="g-btn" @click="buildersOpen = false">Cancel</button>
                                <button class="g-btn g-btn-gem" :disabled="busy || gems < (town.builders.value.nextGemCost ?? 0)" @click="hireBuilder">Hire</button>
                            </div>
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
.g-spinner-xs { width: 14px !important; height: 14px !important; border-width: 2px !important; }
.g-spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid rgba(255, 255, 255, 0.2); border-top-color: #fff; animation: g-spin 0.8s linear infinite; }
@keyframes g-spin { to { transform: rotate(360deg); } }
.g-cell { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 6px; border-radius: 12px; background: rgba(255, 255, 255, 0.06); }

.hud { position: absolute; left: 14px; top: 14px; display: flex; flex-wrap: wrap; gap: 8px; z-index: 5; max-width: calc(100% - 160px); }
.corner { position: absolute; right: 14px; top: 14px; display: flex; gap: 8px; z-index: 5; }
.placement-rotate { cursor: pointer; pointer-events: auto; padding: 3px 7px; border-radius: 6px; background: var(--g-bg-2); color: inherit; }
.placement-rotate:hover { filter: brightness(1.2); }
.hint {
    position: absolute; left: 50%; top: 70px; transform: translateX(-50%); z-index: 5;
    display: flex; align-items: center; gap: 10px;
    padding: 7px 14px; border-radius: 999px; background: var(--g-bg); border: 1px solid var(--g-line);
    backdrop-filter: blur(10px); font-size: 13px; white-space: nowrap;
}
.g-chip-btn { cursor: pointer; }
.g-chip-btn.is-pinned { border-color: rgba(255, 255, 255, 0.35); }
.g-meter-lg { width: 110px; position: relative; overflow: visible; }
.g-meter-mark { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: #fff; opacity: 0.85; border-radius: 1px; }
.g-dot { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--g-red); color: #fff; font-size: 11px; font-weight: 900; display: inline-flex; align-items: center; justify-content: center; }
.moodpop { position: absolute; left: 0; top: calc(100% + 8px); z-index: 9; width: 340px; max-height: calc(100vh - 140px); overflow-y: auto; padding: 12px; border-radius: 16px; background: var(--g-bg-2); border: 1px solid var(--g-line); backdrop-filter: blur(12px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4); display: flex; flex-direction: column; gap: 6px; }
.moodpop-head { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.moodpop-next { font-size: 12px; opacity: 0.8; display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; }
.moodpop-next-perk { padding: 1px 6px; border-radius: 6px; background: rgba(255, 255, 255, 0.08); font-weight: 700; }
.moodpop-perks { display: flex; flex-wrap: wrap; gap: 6px; }
.moodpop-ladder { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
.moodpop-step { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 8px; font-size: 11px; opacity: 0.55; }
.moodpop-step.is-done { opacity: 0.85; }
.moodpop-step.is-now { opacity: 1; background: rgba(255, 255, 255, 0.1); outline: 1px solid var(--g-line); }
.moodpop-sec { margin-top: 6px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.7; }
.moodpop-tips { margin: 0; padding-left: 16px; font-size: 12px; display: flex; flex-direction: column; gap: 3px; opacity: 0.9; }
.bcard-count { position: absolute; right: 8px; top: 6px; font-size: 10px; font-weight: 800; opacity: 0.6; }
.bcard { position: relative; }
.g-chip-btn:hover { background: var(--g-bg-2); }
.needs-row { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 9px; font-size: 12px; }
.needs-row.is-ok { background: rgba(79, 211, 106, 0.12); }
.needs-row.is-bad { background: rgba(255, 107, 107, 0.12); }
.needs-row.is-off { opacity: 0.45; }
.needs-badge { min-width: 30px; text-align: right; font-weight: 800; }
.plotrow { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--g-line); font-size: 13px; }
.plotrow + .plotrow { margin-top: 6px; }
.score-row { display: flex; align-items: baseline; gap: 8px; padding: 4px 6px; border-radius: 8px; font-size: 12px; }
.score-row.is-plus { background: rgba(79, 211, 106, 0.1); }
.score-row.is-minus { background: rgba(255, 107, 107, 0.12); }
.score-points { min-width: 34px; text-align: right; font-weight: 900; font-variant-numeric: tabular-nums; }
.score-row.is-plus .score-points { color: var(--g-green); }
.score-row.is-minus .score-points { color: var(--g-red); }
.needs-row.is-ok .needs-badge { color: var(--g-green); }
.needs-row.is-bad .needs-badge { color: var(--g-red); }
.needs-foot { margin-top: 8px; font-size: 11px; opacity: 0.75; }

.inv { position: absolute; left: 14px; top: 76px; display: flex; flex-direction: column; gap: 4px; z-index: 4; max-height: calc(100% - 190px); overflow-x: hidden; overflow-y: auto; scrollbar-width: none; padding-right: 2px; }
.inv::-webkit-scrollbar { display: none; }
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

.tip.is-cursor { left: var(--cursor-x, 0px); top: var(--cursor-y, 0px); }
.tip { position: fixed; z-index: 30; pointer-events: none; padding: 8px 12px; border-radius: 10px; background: var(--g-bg-2); border: 1px solid var(--g-line); font-size: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); }

.card {
    position: absolute; left: 50%; bottom: 112px; transform: translateX(-50%); z-index: 6;
    width: min(560px, calc(100% - 28px)); border-radius: 18px; background: var(--g-bg); border: 1px solid var(--g-line);
    backdrop-filter: blur(14px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}
.card-head { border-radius: 18px 18px 0 0; }
.card-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--g-line); }
.card-emoji { width: 40px; height: 40px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; font-size: 26px; }
.card-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.card-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.card-row { display: flex; align-items: center; gap: 10px; }
.card-note { font-size: 11.5px; line-height: 1.45; opacity: 0.8; }
.card-note.is-bad { color: #ffb3b3; opacity: 1; }
.card-actions { display: flex; gap: 8px; }

.landsec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.55; }
.landsec-head span { letter-spacing: 0; text-transform: none; font-weight: 700; }
.landsec-empty { font-size: 12px; opacity: 0.55; padding: 6px 2px; }
.plot-ico { font-size: 18px; line-height: 1; }
.plotrow-sub { font-size: 11px; opacity: 0.55; }

/* What a workshop turns into what, at the rate it really runs. */
.recipe { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.recipe-item { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 10px; font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
.recipe-item.is-in { background: rgba(255, 255, 255, 0.07); }
.recipe-item.is-out { background: rgba(79, 211, 106, 0.18); color: #9af0a8; }
.recipe-arrow { opacity: 0.4; font-weight: 800; }
.recipe-unit { font-size: 11px; opacity: 0.55; cursor: help; }

/* The two things that throttle a workshop, side by side. */
.meters { display: flex; flex-direction: column; gap: 5px; }
.meter { display: grid; grid-template-columns: 18px 62px 1fr 40px; align-items: center; gap: 8px; font-size: 12px; cursor: help; }
.meter-ico { font-size: 14px; line-height: 1; }
.meter-label { opacity: 0.65; }
.meter-bar { height: 7px; border-radius: 999px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.meter-bar i { display: block; height: 100%; border-radius: 999px; transition: width 0.4s ease; }
.meter-bar i.ok { background: linear-gradient(90deg, #7ee081, #3ecf5a); }
.meter-bar i.meh { background: linear-gradient(90deg, #ffd479, #f5a623); }
.meter-bar i.bad { background: linear-gradient(90deg, #ff8a8a, #ff5252); }
.meter-value { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }

/* The upgrade is its own panel: what, what it costs, then the button. */
.upgrade { display: flex; align-items: center; gap: 10px; padding: 7px 8px 7px 10px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--g-line); }
.upgrade-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.upgrade-head { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
.upgrade-cost { display: flex; flex-wrap: wrap; gap: 2px 8px; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.upgrade-cost span { display: inline-flex; align-items: center; gap: 4px; }
.upgrade-go { flex-shrink: 0; padding: 8px 14px; font-size: 12px; }
.g-btn-sm { padding: 7px 12px; font-size: 12px; }
.g-btn-quiet-danger { color: #ffb3b3; }
.g-btn-quiet-danger:hover:not(:disabled) { background: rgba(229, 50, 45, 0.2); }

/* A styled tooltip, so nothing has to fall back to the browser's own. */
[data-tip] { position: relative; }
[data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    left: 50%;
    bottom: calc(100% + 9px);
    z-index: 40;
    width: max-content;
    max-width: 280px;
    padding: 8px 11px;
    border-radius: 10px;
    background: rgba(10, 13, 18, 0.98);
    border: 1px solid var(--g-line);
    color: var(--g-text);
    font: 600 11.5px/1.5 ui-rounded, system-ui, sans-serif;
    text-align: left;
    white-space: pre-line;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    opacity: 0;
    transform: translate(-50%, 5px);
    pointer-events: none;
    transition: opacity 0.12s ease, transform 0.12s ease;
}
[data-tip]:hover::after { opacity: 1; transform: translate(-50%, 0); transition-delay: 0.15s; }

/* Chrome pinned to the top of the screen points its tooltip the other way. */
[data-tip-below] { position: relative; }
[data-tip-below]::after {
    content: attr(data-tip-below);
    position: absolute;
    left: 50%;
    top: calc(100% + 9px);
    z-index: 40;
    width: max-content;
    max-width: 280px;
    padding: 8px 11px;
    border-radius: 10px;
    background: rgba(10, 13, 18, 0.98);
    border: 1px solid var(--g-line);
    color: var(--g-text);
    font: 600 11.5px/1.5 ui-rounded, system-ui, sans-serif;
    text-align: left;
    white-space: pre-line;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    opacity: 0;
    transform: translate(-50%, -5px);
    pointer-events: none;
    transition: opacity 0.12s ease, transform 0.12s ease;
}
[data-tip-below]:hover::after { opacity: 1; transform: translate(-50%, 0); transition-delay: 0.15s; }
.card-alert { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 12px; background: rgba(229, 50, 45, 0.18); border: 1px solid rgba(229, 50, 45, 0.5); font-size: 12px; }
.card-alert b { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: #e5322d; color: #fff; text-align: center; line-height: 26px; font-size: 16px; }

.strip {
    position: absolute; left: 50%; bottom: 112px; transform: translateX(-50%); z-index: 6;
    width: min(1040px, calc(100% - 28px)); border-radius: 18px; background: var(--g-bg); border: 1px solid var(--g-line);
    backdrop-filter: blur(14px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}
.strip-tabs { display: flex; align-items: center; gap: 4px; padding: 10px 12px 0; overflow-x: auto; scrollbar-width: none; }
.strip-tabs::-webkit-scrollbar { display: none; }
.strip-lock { padding: 6px 12px 0; font-size: 11px; opacity: 0.7; }
.strip-tab { flex-shrink: 0; white-space: nowrap; padding: 6px 12px; border-radius: 10px; font-size: 12px; font-weight: 800; color: var(--g-muted); background: transparent; border: 1px solid transparent; cursor: pointer; display: inline-flex; gap: 4px; }
.strip-tab.is-active { background: rgba(255, 255, 255, 0.1); color: var(--g-text); border-color: var(--g-line); }
.strip-tab.is-locked { opacity: 0.6; }
.strip-cards { display: flex; gap: 10px; padding: 10px 12px 12px; overflow-x: auto; overflow-y: visible; scrollbar-width: thin; }
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

.chip-key { margin-left: 6px; padding: 0 4px; border-radius: 5px; background: rgba(255, 255, 255, 0.12); font-size: 10px; font-weight: 700; opacity: 0.7; }

.legend {
    position: absolute; left: 14px; bottom: 16px; z-index: 6; width: 216px;
    display: flex; flex-direction: column; gap: 2px; padding: 10px;
    border-radius: 16px; background: var(--g-bg); border: 1px solid var(--g-line);
    backdrop-filter: blur(14px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}
.legend-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800; margin-bottom: 2px; }
.legend-row { display: grid; grid-template-columns: 11px 1fr auto; gap: 8px; align-items: baseline; padding: 4px 6px; border-radius: 9px; border: 1px solid transparent; }
.legend-row i { width: 11px; height: 11px; border-radius: 3px; align-self: center; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35); }
.legend-row b { font-size: 12px; }
.legend-row span { font-size: 10.5px; text-align: right; color: var(--g-muted); }
.legend-row.is-boosting { background: rgba(255, 255, 255, 0.09); border-color: rgba(255, 255, 255, 0.35); }

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
.dock-dot { position: absolute; left: 8px; top: 8px; width: 7px; height: 7px; border-radius: 50%; background: var(--g-green); box-shadow: 0 0 8px var(--g-green); }
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

/* The dock sits along the bottom edge, so leave it room: a window that
   reaches under it hides its own footer. */
.backdrop { position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24px 24px 116px; background: rgba(6, 10, 16, 0.45); backdrop-filter: blur(3px); }
.g-window { width: min(680px, 100%); max-height: 100%; display: flex; flex-direction: column; border-radius: 20px; background: rgba(18, 22, 29, 0.96); border: 1px solid var(--g-line); box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5); overflow: hidden; }
.g-window.is-wide { width: min(920px, 100%); height: min(680px, 100%); }
.g-window.is-small { width: min(520px, 100%); }
.g-window.is-tiny { width: min(400px, 100%); }
.g-window-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--g-line); }
.g-window-head h2 { font-size: 17px; font-weight: 900; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
.g-window-body { padding: 16px 18px; overflow-x: hidden; overflow-y: auto; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.rise-enter-active, .rise-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.rise-enter-from, .rise-leave-to { opacity: 0; transform: translate(-50%, 12px); }
</style>
