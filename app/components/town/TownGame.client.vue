<script setup lang="ts">
import TownCoin from '~/components/town/TownCoin.vue'
import { townIsTyping } from '~/utils/town/camera'
import TownAsset from '~/components/town/TownAsset.vue'
import TownScene from '~/components/town/TownScene.client.vue'
import TownMarketPanel from '~/components/town/TownMarketPanel.vue'
import TownMilestonesPanel from '~/components/town/TownMilestonesPanel.vue'
import TownLeaderboardPanel from '~/components/town/TownLeaderboardPanel.vue'
import TownEventsPanel from '~/components/town/TownEventsPanel.vue'
import TownResearchPanel from '~/components/town/TownResearchPanel.vue'
import { formatTownDuration } from '~/utils/town-format'
import { townTerrainCss } from '~/utils/town/terrain'
import { TOWN_TERRAINS, TOWN_TERRAIN_BONUS, TOWN_PLOT_SIZE, houseAdjacency, townLevelCost, townRushGemCost, getTownBuilding, townPlacementIssue, townAutoFacing, townIndustryNuisance, townHousesWithin, townWorkersFor, townPlaceCost, townGroupMoveIssue, townBuildingCountIssue, TOWN_MAX_DRAG_TILES, type TownSimBuilding } from '#shared/utils/gamelogic/town'
import type { SceneTile, SceneMoveGhost } from '~/components/town/TownScene.client.vue'

const town = useTown()
const sound = useTownSound()
const motion = useTownMotion()
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
type Window = 'market' | 'goals' | 'mayors' | 'land' | 'research' | 'events' | null
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
/** Everything a marquee has gathered up, or a shift-click has toggled in. */
const selectedIds = ref<string[]>([])
/** Tiles the current placement drag covers, sent up by the scene. */
const dragTiles = ref<SceneTile[]>([])
/** A whole selection riding on the cursor: offsets from the tile under it. */
const moveSelection = ref<{ items: SceneMoveGhost[] } | null>(null)
const marketResource = ref<string | null>(null)
/** Counts state refreshes, so an open notification list learns a build finished under it. */
const stateTick = ref(0)
watch(town.state, () => { stateTick.value++ })
/** The happiness popover. Hover only. */
const moodOpen = ref(false)
/** The income popover. Hover only — there is nothing in it to click. */
const incomeOpen = ref(false)
/** The builders popover: what a free crew should be put on. */
const buildersPop = ref(false)
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

// A site being relocated is drawn as the building it will become — level 0 has
// no artwork of its own.
const ghostLevel = computed(() => movingId.value ? Math.max(1, town.buildings.value.find(b => b.id === movingId.value)?.level ?? 1) : 1)
const selectedBuilding = computed(() => town.buildings.value.find(b => b.id === selectedBuildingId.value) ?? null)
const selectedEntry = computed(() => selectedBuilding.value ? town.catalogById.value.get(selectedBuilding.value.type) ?? null : null)
const hoveredBuilding = computed(() => town.buildings.value.find(b => b.id === hoveredBuildingId.value) ?? null)
const hoveredEntry = computed(() => hoveredBuilding.value ? town.catalogById.value.get(hoveredBuilding.value.type) ?? null : null)

watch(selectedBuilding, (b) => { if (!b) selectedBuildingId.value = null })
// A selection outlives a poll, but not a demolition: drop whatever is gone.
watch(town.buildings, (list) => {
    if (selectedIds.value.length === 0 && !moveSelection.value) return
    const alive = new Set(list.map(b => b.id))
    if (selectedIds.value.some(id => !alive.has(id))) selectedIds.value = selectedIds.value.filter(id => alive.has(id))
    if (moveSelection.value?.items.some(i => !alive.has(i.id))) moveSelection.value = null
})
watch(town.resources, (list) => { sceneRef.value?.setResourceEmoji(Object.fromEntries(list.map(r => [r.id, r.emoji]))) }, { immediate: true })

function openWindow(w: Window) {
    sound.unlock()
    closeHudPopovers()
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
    closeHudPopovers()
    if (buildOpen.value) { buildOpen.value = false; ghostType.value = null; sound.play('close'); return }
    windowOpen.value = null
    selectedBuildingId.value = null
    buildOpen.value = true
    sound.play('open')
}

function closeAll() {
    closeHudPopovers()
    if (windowOpen.value || buildOpen.value || selectedBuildingId.value || selectedIds.value.length) sound.play('close')
    windowOpen.value = null
    buildOpen.value = false
    ghostType.value = null
    movingId.value = null
    selectedBuildingId.value = null
    selectedIds.value = []
    moveSelection.value = null
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

/** Why the town may not put up another of `type`, or null. Mirrors the server's count cap. */
function countIssue(type: string): string | null {
    const def = getTownBuilding(type)
    return def ? townBuildingCountIssue(def, town.countsByType.value[type] ?? 0) : null
}

function pickBuild(type: string) {
    const capped = countIssue(type)
    if (capped) {
        toast.add({ title: capped, color: 'neutral' })
        return
    }
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
    if (!b) return
    sound.play('click')
    movingId.value = b.id
    ghostType.value = b.type
    // A site travels as the building it will become, so it reads as itself.
    ghostRotation.value = b.rotation
    selectedBuildingId.value = null
    selectedIds.value = []
    buildOpen.value = false
}

async function onSelectTile(tile: { plotId: string, tileX: number, tileY: number }) {
    sound.unlock()
    if (moveSelection.value) {
        if (busy.value) return
        await commitGroupMove(tile)
        return
    }
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
    closeHudPopovers()
    sound.play('click')
    ghostType.value = null
    buildOpen.value = false
    windowOpen.value = null
    selectedBuildingId.value = id
    // One card at a time: a click is a fresh selection, the way it reads in
    // every builder. Drag a band to keep a block.
    selectedIds.value = []
}

function onDeselect() {
    if (moveSelection.value) { moveSelection.value = null; return }
    if (ghostType.value) { ghostType.value = null; movingId.value = null; return }
    if (selectedIds.value.length) { clearSelection(); sound.play('close'); return }
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
    const want = `Wants ${selWorkersWanted.value} ${selWorkersWanted.value === 1 ? 'resident' : 'residents'}`
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
        return d.jobs === 0 ? 'Nobody here can reach a job. Join this road to your workshops.' : null
    }
    if (e.kind === 'road' || selWorkersWanted.value === 0 || (b.staffing ?? 0) >= 0.99) return null
    if (d.residents === 0) return 'No homes on this road network. Build houses along it, or join it to your town by road.'
    if (d.residents < d.jobs) return `This road network has ${d.residents} residents for ${d.jobs} jobs. Add houses along it, or join it to more of your town.`
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
    // A relocation only asks about the ground; a fresh build also wants a door.
    if (movingId.value) return townGroupMoveIssue(simBuildings.value, [{ id: movingId.value, wx: tile.wx, wy: tile.wy, rotation: ghostRotation.value }])
    return townPlacementIssue(simBuildings.value, def, tile.wx, tile.wy, ghostRotation.value)
})

// ── Drag placement ──────────────────────────────────────────────────────────
// A drag paints a run of tiles. Each one is judged against the layout the tiles
// before it in the same drag would create, so a street connects to itself and
// the pads on the ground read exactly as the server will decide.

function planTiles(tiles: SceneTile[]) {
    const type = ghostType.value
    const def = type ? getTownBuilding(type) : null
    if (!def || tiles.length === 0) return []
    const layout = movingId.value ? simBuildings.value.filter(b => b.id !== movingId.value) : [...simBuildings.value]
    const counts = new Map<string, number>()
    for (const b of layout) counts.set(b.type, (counts.get(b.type) ?? 0) + 1)
    // What the drag has left to spend, so the pads stop where the server will.
    let coinsLeft = balance.value
    const goodsLeft: Record<string, number> = { ...town.inventory.value }
    const out: { tile: SceneTile, rotation: number, ok: boolean, coins: number }[] = []
    for (const tile of tiles) {
        let rotation = ghostRotation.value
        if (def.kind !== 'road' && townPlacementIssue(layout, def, tile.wx, tile.wy, rotation) !== null) {
            const auto = townAutoFacing(layout, tile.wx, tile.wy)
            if (auto !== null) rotation = auto
        }
        let ok = townPlacementIssue(layout, def, tile.wx, tile.wy, rotation) === null
        const cost = townPlaceCost(def, counts.get(def.id) ?? 0)
        if (ok && (cost.coins > coinsLeft || Object.entries(cost.resources).some(([id, q]) => (goodsLeft[id] ?? 0) < q))) ok = false
        const coins = ok ? cost.coins : 0
        out.push({ tile, rotation, ok, coins })
        if (ok) {
            coinsLeft -= cost.coins
            for (const [id, q] of Object.entries(cost.resources)) goodsLeft[id] = (goodsLeft[id] ?? 0) - q
            counts.set(def.id, (counts.get(def.id) ?? 0) + 1)
            layout.push({
                id: `drag:${tile.wx},${tile.wy}`,
                type: def.id as TownSimBuilding['type'],
                level: def.kind === 'road' ? 1 : 0,
                completesAt: 0,
                upgradingTo: null,
                createdAt: 0,
                wx: tile.wx,
                wy: tile.wy,
                rotation
            })
        }
    }
    return out
}

const dragPlan = computed(() => planTiles(dragTiles.value))
const dragValid = computed(() => dragPlan.value.map(p => p.ok))
/** What the drag under the cursor would cost, for the strip along the top. */
const dragQuote = computed(() => {
    const usable = dragPlan.value.filter(p => p.ok)
    if (usable.length < 2) return null
    return { count: usable.length, coins: usable.reduce((sum, p) => sum + p.coins, 0) }
})

function onDragTiles(tiles: SceneTile[]) {
    dragTiles.value = tiles
}

/**
 * A drag let go. The tiles come with the event rather than from `dragTiles`:
 * the scene clears that as it releases, so reading the ref here would plan an
 * empty run and build nothing.
 */
function onPlaceLine(tiles: SceneTile[]) {
    if (!ghostType.value || busy.value) return
    // A relocation is one building by definition — the drag only ever adds.
    if (movingId.value) { dragTiles.value = []; return }
    const plan = planTiles(tiles).filter(p => p.ok)
    dragTiles.value = []
    if (plan.length === 0) {
        sound.play('error')
        toast.add({ title: 'Nothing could go there', color: 'warning' })
        return
    }
    const items = plan.map(p => ({ plotId: p.tile.plotId, tileX: p.tile.tileX, tileY: p.tile.tileY, type: ghostType.value!, rotation: p.rotation }))
    run(() => town.placeBuildings(items.slice(0, TOWN_MAX_DRAG_TILES)), (res) => {
        const name = town.catalogById.value.get(ghostType.value ?? '')?.name ?? 'building'
        toast.add({ title: `Built ${res.placed.length} × ${name}`, description: res.skipped ? `${res.skipped} skipped — ${res.reason}` : undefined, color: 'success' })
    }, 'place')
}

// ── Selection ───────────────────────────────────────────────────────────────

const selectedBuildings = computed(() => town.buildings.value.filter(b => selectedIds.value.includes(b.id)))
/** The selection's upgradeable members, and what starting them all would cost. */
const selectionUpgradable = computed(() => selectedBuildings.value.filter((b) => {
    const entry = town.catalogById.value.get(b.type)
    const def = getTownBuilding(b.type)
    if (!entry || !def || entry.kind === 'road') return false
    if (b.level === 0 || b.upgradingTo !== null) return false
    return b.level < (entry.maxLevel ?? town.constants.value.maxLevel)
}))

function onSelectMany(ids: string[], mode: 'replace' | 'add' | 'toggle') {
    sound.unlock()
    // A plain click leaves its building in selectedBuildingId only; a shift-click
    // on top of it should grow from there, not start over.
    const base = selectedIds.value.length ? selectedIds.value : selectedBuildingId.value ? [selectedBuildingId.value] : []
    let all: string[]
    if (mode === 'replace') all = ids
    else if (mode === 'add') all = [...new Set([...base, ...ids])]
    else {
        const have = new Set(base)
        const allIn = ids.every(id => have.has(id))
        all = allIn ? base.filter(id => !ids.includes(id)) : [...new Set([...base, ...ids])]
    }
    // A selection change while a block is on the cursor puts the block down.
    moveSelection.value = null
    // One bulk call is capped server-side, so the selection is capped here — a
    // band over three plots must not gather a block that can never be acted on.
    const next = all.slice(0, TOWN_MAX_DRAG_TILES)
    if (all.length > next.length) toast.add({ title: `Selection capped at ${TOWN_MAX_DRAG_TILES}`, color: 'warning' })
    selectedIds.value = next
    // A band that caught nothing only clears the selection; a ghost being
    // carried survives it, so a road drag that starts off the plot is not lost.
    if (next.length) {
        ghostType.value = null
        movingId.value = null
    }
    if (next.length === 1) {
        selectedBuildingId.value = next[0]!
        buildOpen.value = false
    } else {
        selectedBuildingId.value = null
        if (next.length) { buildOpen.value = false; windowOpen.value = null }
    }
    if (next.length) sound.play('click')
}

function clearSelection() {
    selectedIds.value = []
    moveSelection.value = null
}

/** The Delete key or the toolbar's Demolish on a selection. */
const confirmBulk = ref<{ ids: string[] } | null>(null)
function demolishMany(ids: string[]) {
    if (ids.length === 0) return
    sound.unlock()
    confirmBulk.value = { ids }
}
function demolishBulk() {
    const ids = confirmBulk.value?.ids ?? []
    confirmBulk.value = null
    if (ids.length === 0) return
    run(() => town.demolishBuildings(ids), (res) => {
        selectedIds.value = selectedIds.value.filter(id => !res.demolished.includes(id))
        if (selectedBuildingId.value && res.demolished.includes(selectedBuildingId.value)) selectedBuildingId.value = null
        toast.add({ title: `Demolished ${res.demolished.length}`, color: 'neutral' })
    }, 'demolish')
}

function upgradeSelection() {
    const ids = selectionUpgradable.value.map(b => b.id)
    if (ids.length === 0) return
    run(() => town.upgradeBuildings(ids), (res) => {
        toast.add({
            title: `${res.started.length} ${res.started.length === 1 ? 'upgrade' : 'upgrades'} started`,
            description: res.skipped ? `${res.skipped} skipped — ${res.reason}` : undefined,
            color: 'success'
        })
    }, 'upgrade')
}

// ── Group move ──────────────────────────────────────────────────────────────

function plotAt(wx: number, wy: number) {
    const px = Math.floor(wx / TOWN_PLOT_SIZE)
    const py = Math.floor(wy / TOWN_PLOT_SIZE)
    return town.plots.value.find(p => p.x === px && p.y === py) ?? null
}

/** Pick the whole selection up, laid out around the top-left member. */
function startGroupMove() {
    const list = selectedBuildings.value
    if (list.length === 0) return
    const tiles = list.map((b) => {
        const plot = plotById.value.get(b.plotId)
        return { b, wx: (plot?.x ?? 0) * TOWN_PLOT_SIZE + b.tileX, wy: (plot?.y ?? 0) * TOWN_PLOT_SIZE + b.tileY }
    })
    const ax = Math.min(...tiles.map(t => t.wx))
    const ay = Math.min(...tiles.map(t => t.wy))
    moveSelection.value = {
        items: tiles.map(t => ({ id: t.b.id, type: t.b.type, level: Math.max(1, t.b.level), rotation: t.b.rotation, dx: t.wx - ax, dy: t.wy - ay }))
    }
    ghostType.value = null
    movingId.value = null
    selectedBuildingId.value = null
    buildOpen.value = false
    sound.play('click')
}

const moveGhosts = computed(() => moveSelection.value?.items ?? null)
/** Where every member of the carried selection would land if its anchor sat on (wx, wy). */
function groupTargetsAt(wx: number, wy: number) {
    const sel = moveSelection.value
    if (!sel) return null
    return sel.items.map(i => ({ id: i.id, wx: wx + i.dx, wy: wy + i.dy, rotation: i.rotation }))
}
function groupIssueFor(targets: ReturnType<typeof groupTargetsAt>) {
    if (!targets) return null
    for (const t of targets) if (!plotAt(t.wx, t.wy)) return 'Keep the whole block on your own land'
    return townGroupMoveIssue(simBuildings.value, targets)
}
/** The verdict on the tile under the cursor, for the ghosts' tint. */
const moveIssue = computed(() => {
    const tile = hoveredTile.value
    return tile ? groupIssueFor(groupTargetsAt(tile.wx, tile.wy)) : null
})

function rotateGroup() {
    const sel = moveSelection.value
    if (!sel) return
    // The whole block turns a quarter clockwise about the tile under the cursor,
    // every building turning with it, so a street with houses along it comes
    // down as the same street facing the other way. The offset map is the same
    // one TOWN_FACING follows, which is what keeps every door on its road.
    sel.items = sel.items.map(i => ({ ...i, dx: i.dy, dy: -i.dx, rotation: (i.rotation + 1) % 4 }))
    sound.play('click')
}

/**
 * Drop the block with its anchor on the tile that was clicked. The tile comes
 * from the click itself rather than the hover state: a tap has no hover, so a
 * touch player could otherwise never put a selection down.
 */
async function commitGroupMove(tile: { plotId: string, tileX: number, tileY: number }) {
    const plot = plotById.value.get(tile.plotId)
    if (!plot) return
    const targets = groupTargetsAt(plot.x * TOWN_PLOT_SIZE + tile.tileX, plot.y * TOWN_PLOT_SIZE + tile.tileY)
    if (!targets) return
    const issue = groupIssueFor(targets)
    if (issue) {
        sound.play('error')
        toast.add({ title: issue, color: 'warning' })
        return
    }
    const moves = targets.map((t) => {
        const plot = plotAt(t.wx, t.wy)!
        return { buildingId: t.id, plotId: plot.id, tileX: t.wx - plot.x * TOWN_PLOT_SIZE, tileY: t.wy - plot.y * TOWN_PLOT_SIZE, rotation: t.rotation }
    })
    await run(() => town.moveBuildings(moves), () => {
        toast.add({ title: `Moved ${moves.length} ${moves.length === 1 ? 'building' : 'buildings'}`, color: 'success' })
        moveSelection.value = null
    }, 'place')
}

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
const selUnit = computed(() => selectedEntry.value ? ioUnit(selectedEntry.value) : 'h')
function selRate(perLevel: number) {
    const b = selectedBuilding.value
    if (!b) return '0'
    return ioRate(perLevel * b.level * (b.throughput ?? 1), selUnit.value)
}
/** Hovering Upgrade swaps the cost for what the next level changes. */
const previewUpgrade = ref(false)
/** Before → after for the next level, at today's staffing and supply. */
const selUpgradePreview = computed(() => {
    const b = selectedBuilding.value
    const e = selectedEntry.value
    if (!b || !e || e.kind === 'road') return []
    const next = b.level + 1
    const rows: { id?: string, ico?: string, label: string, from: string, to: string, up: boolean, tip?: string }[] = []
    if (e.kind === 'industry') {
        const rate = (q: number, level: number) => ioRate(q * level * (b.throughput ?? 1), selUnit.value)
        for (const [id, q] of Object.entries(e.outputs)) {
            rows.push({ id, label: '', from: `+${rate(q, b.level)}`, to: `+${rate(q, next)}`, up: true, tip: town.resourceById.value.get(id)?.name })
        }
        for (const [id, q] of Object.entries(e.inputs)) {
            rows.push({ id, label: '', from: `−${rate(q, b.level)}`, to: `−${rate(q, next)}`, up: false, tip: town.resourceById.value.get(id)?.name })
        }
    } else if (e.kind === 'housing') {
        rows.push({ ico: 'i-lucide-users', label: 'residents', from: String(e.popCap * b.level), to: String(e.popCap * next), up: true })
    } else if (e.kind === 'civic') {
        rows.push({ ico: 'i-lucide-smile', label: 'happiness', from: `+${e.happiness * b.level}`, to: `+${e.happiness * next}`, up: true })
    } else if (e.kind === 'storage') {
        rows.push({ ico: 'i-lucide-package', label: 'storage', from: formatNumber(e.storage * b.level), to: formatNumber(e.storage * next), up: true })
    }
    if (selDef.value) {
        const want = townWorkersFor(selDef.value, b.level)
        const wantNext = townWorkersFor(selDef.value, next)
        if (wantNext !== want) rows.push({ ico: 'i-lucide-users', label: 'wanted', from: String(want), to: String(wantNext), up: false, tip: 'Residents it will want. Short-handed buildings run slower.' })
    }
    return rows
})
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
function convertJewels(gems: number) {
    run(() => town.convertJewels(gems), (res) => {
        toast.add({ title: `Converted ${formatNumber(res.jewels)} jewels into ${res.gems} ${res.gems === 1 ? 'gem' : 'gems'}`, color: 'success' })
        sound.play('bigcoin')
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
const needs = computed(() => town.needs.value)
/** Needs the score actually counts — the rest are future tiers, shown greyed. */
/** Every want the townsfolk have: scored ones, plus goods they eat but the town cannot make yet. */
const scoredNeeds = computed(() => needs.value.filter(n => n.satisfied || n.expected))
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
    const rows: { label: string, icon: string, points: number, hint: string }[] = []
    rows.push({ label: 'Town', icon: 'i-lucide-house', points: b.base, hint: 'Every town starts here' })
    if (b.needs !== 0) {
        rows.push({
            label: 'Needs',
            icon: 'i-lucide-utensils',
            points: b.needs,
            hint: b.needs > 0 ? 'Goods your townsfolk have' : 'Goods they want and cannot get'
        })
    }
    if (b.parks) rows.push({ label: 'Parks', icon: 'i-lucide-trees', points: b.parks, hint: `${formatNumber(b.layout.residentsWithPark)} of ${formatNumber(b.layout.residents)} residents live near one` })
    if (b.industry) rows.push({ label: 'Industry', icon: 'i-lucide-factory', points: b.industry, hint: `${formatNumber(b.layout.residentsWithIndustry)} residents live beside workshops` })
    if (b.crowding) rows.push({ label: 'Overcrowded', icon: 'i-lucide-users', points: b.crowding, hint: 'More jobs than residents' })
    if (starving.value) rows.push({ label: 'Starving', icon: 'i-lucide-frown', points: -12, hint: 'No food in store at all' })
    return rows
})
/** A mood's perks as short game-style chips: "+15% production", "−10% build time". */
function perkChips(m: { speed: number, buildTime: number, storage: number } | null) {
    if (!m) return []
    const pct = (v: number) => `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`
    const out: { text: string, icon: string, good: boolean, bad: boolean }[] = []
    out.push(m.speed === 1
        ? { text: 'normal production', icon: 'i-lucide-gauge', good: false, bad: false }
        : { text: `${pct(m.speed - 1)} production`, icon: 'i-lucide-gauge', good: m.speed > 1, bad: m.speed < 1 })
    if (m.buildTime !== 1) out.push({ text: `${pct(m.buildTime - 1)} build time`, icon: 'i-lucide-hammer', good: m.buildTime < 1, bad: m.buildTime > 1 })
    if (m.storage !== 1) out.push({ text: `${pct(m.storage - 1)} storage`, icon: 'i-lucide-package', good: true, bad: false })
    return out
}
/** Which building makes a need the town cannot produce yet. */
function needMaker(resource: string) {
    const maker = town.catalog.value.find(c => Object.keys(c.outputs).includes(resource))
    return maker ? `build a ${maker.name} (tier ${maker.tier})` : 'not unlocked yet'
}
/** The line a needs row shows — also its tooltip, so a truncated one can be read. */
function needLine(n: { satisfied: boolean, producible: boolean, perTick: number, resource: string }) {
    const rate = `${formatNumber(perHour(n.perTick))}/h`
    if (n.satisfied) return rate
    if (!n.producible) return `Wants ${rate} · ${needMaker(n.resource)}`
    return `Out of stock · needs ${rate}`
}
/** Shut the HUD popovers when a window or a card takes the screen. */
function closeHudPopovers() {
    moodOpen.value = false
    incomeOpen.value = false
    buildersPop.value = false
}

// ── HUD ──
const happiness = computed(() => town.state.value?.happiness ?? 50)
const speed = computed(() => town.state.value?.speedMultiplier ?? 0.75)
const popCap = computed(() => town.state.value?.popCap ?? 0)

// ── Builders ──
// One crew per running build or upgrade. This is the pacing lever: a town can
// only grow on as many fronts as it has crews, and the rest cost gems.
const buildersFree = computed(() => town.buildersFree.value)
const buildersOpen = ref(false)
function openBuilders() {
    sound.unlock()
    buildersPop.value = false
    if (town.builders.value.nextGemCost === null) return
    sound.play('open')
    buildersOpen.value = true
}

/** Goods the town is running down rather than stocking, worst shortfall first. */
const starvedGoods = computed(() => Object.entries(town.netPerTick.value)
    .filter(([, net]) => net < 0)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id))

/**
 * What a free crew should be put on. Whatever makes a good the town is running
 * down comes first, then homes while there are more jobs than residents, then
 * simply the cheapest rung left — lowest tier, lowest level.
 */
const recommendedUpgrades = computed(() => {
    const cap = town.constants.value.maxLevel
    const starved = starvedGoods.value
    const rows: {
        id: string
        type: string
        name: string
        level: number
        rank: number
        order: number
        resource?: string
        residents: boolean
        cost: { coins: number, resources: Record<string, number> }
    }[] = []
    for (const b of town.buildings.value) {
        const entry = town.catalogById.value.get(b.type)
        const def = getTownBuilding(b.type)
        if (!entry || !def || entry.kind === 'road') continue
        if (b.level <= 0 || b.upgradingTo !== null || b.completesAt > now.value) continue
        if (b.level >= (entry.maxLevel ?? cap)) continue
        const short = entry.kind === 'industry'
            ? starved.find(id => id in entry.outputs)
            : undefined
        const residents = short === undefined && entry.kind === 'housing' && workersDemanded.value > popCap.value
        rows.push({
            id: b.id,
            type: b.type,
            name: entry.name,
            level: b.level,
            rank: short !== undefined ? 0 : residents ? 1 : 2,
            order: short !== undefined ? starved.indexOf(short) : residents ? 0 : entry.tier,
            resource: short,
            residents,
            cost: townLevelCost(def, b.level + 1)
        })
    }
    rows.sort((a, b) => a.rank - b.rank || a.order - b.order || a.level - b.level)
    // One row per building type: six houses in a row is not six recommendations.
    const seen = new Set<string>()
    return rows.filter(r => !seen.has(r.type) && seen.add(r.type)).slice(0, 5)
})

/** Start one of the recommended upgrades without hunting for the building. */
function upgradeRecommended(id: string) {
    buildersPop.value = false
    if (buildersFree.value === 0) { openBlocked({ kind: 'upgrade', buildingId: id }); return }
    run(() => town.upgradeBuilding(id), res => toast.add({ title: `Upgrading to level ${res.level}`, color: 'success' }), 'upgrade')
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
        /** How far along, 0..1 — the server quotes the job's full length. */
        progress: Math.min(1, Math.max(0, 1 - (b.completesAt - now.value) / Math.max(1, b.jobMs ?? 1))),
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
/** Anything too slow to show a whole unit an hour is quoted per day instead. */
function ioUnit(c: { outputs: Record<string, number> }): 'h' | 'day' {
    return Object.values(c.outputs).some(q => q * ticksPerHour.value < 1) ? 'day' : 'h'
}
function ioRate(q: number, unit: 'h' | 'day') {
    const value = q * ticksPerHour.value * (unit === 'day' ? 24 : 1)
    return value < 10 ? String(Math.round(value * 10) / 10) : formatNumber(Math.round(value))
}
/** A day of output priced at the floor, good by good — which good actually pays. */
const incomeRows = computed(() => town.resources.value
    .map((r) => {
        const perDay = Math.round((town.netPerTick.value[r.id] ?? 0) * ticksPerHour.value * 24)
        return { id: r.id, name: r.name, perDay, value: Math.round(perDay * r.floorPrice) }
    })
    .filter(r => r.perDay > 0)
    .sort((a, b) => b.value - a.value))

/** Goods the town can actually make: everything a standing building outputs. */
const producedIds = computed(() => {
    const out = new Set<string>()
    for (const b of town.buildings.value) {
        if (b.level <= 0) continue
        const entry = town.catalogById.value.get(b.type)
        if (entry) for (const id of Object.keys(entry.outputs)) out.add(id)
    }
    return out
})
const inventoryRows = computed(() => town.resources.value
    .map(r => ({
        ...r,
        amount: town.inventory.value[r.id] ?? 0,
        perHour: Math.round((town.netPerTick.value[r.id] ?? 0) * ticksPerHour.value)
    }))
    .filter(r => r.amount > 0 || producedIds.value.has(r.id)))
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
    const modal = welcome.value || helpOpen.value || confirmDemolish.value || confirmBulk.value
    if (e.code === 'KeyR' && !modal && (ghostType.value || moveSelection.value)) {
        e.preventDefault()
        if (moveSelection.value) rotateGroup()
        else rotatePlacement()
        return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !modal && (selectedIds.value.length || selectedBuilding.value)) {
        e.preventDefault()
        if (selectedIds.value.length) demolishMany(selectedIds.value)
        else confirmDemolish.value = true
        return
    }
    if (e.key === 'Escape') {
        if (blocked.value) blocked.value = null
        else if (buildersOpen.value) buildersOpen.value = false
        else if (confirmBulk.value) confirmBulk.value = null
        else if (confirmPlot.value) confirmPlot.value = null
        else if (confirmListing.value) confirmListing.value = null
        else if (confirmSellPlot.value) confirmSellPlot.value = null
        else if (moveSelection.value) moveSelection.value = null
        else if (ghostType.value) { ghostType.value = null; movingId.value = null }
        else if (selectedIds.value.length) clearSelection()
        else if (welcome.value) welcome.value = null
        else if (helpOpen.value) helpOpen.value = false
        else closeAll()
    } else if ((e.key === 'm' || e.key === 'M') && selectedIds.value.length > 1) startGroupMove()
    else if ((e.key === 'm' || e.key === 'M') && selectedBuilding.value) startMove()
    else if (e.key === 'b' || e.key === 'B') toggleBuild()
    else if (e.key === 'h' || e.key === 'H') openMarket()
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
            :keyboard-enabled="!windowOpen && !welcome && !helpOpen && !confirmDemolish && !confirmBulk && !confirmPlot && !confirmListing && !confirmSellPlot && !buildersOpen && !blocked"
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
            :selected-ids="selectedIds"
            :move-ghosts="moveGhosts"
            :move-issue="moveIssue"
            :drag-valid="dragValid"
            :reduced-motion="motion.reduced.value"
            @hover-tile="onHoverTile"
            @select-tile="onSelectTile"
            @select-building="onSelectBuilding"
            @select-expansion="buyPlot"
            @select-listing="onSelectListing"
            @hover-building="hoveredBuildingId = $event"
            @hover-neighbour="hoveredNeighbour = $event"
            @hover-expansion="hoveredSlot = $event"
            @deselect="onDeselect"
            @drag-tiles="onDragTiles"
            @place-line="onPlaceLine"
            @select-many="onSelectMany"
        />

        <!-- Founding -->
        <div v-if="town.state.value && !town.initialized.value" class="found-screen">
            <div class="found-card">
                <span class="found-mark"><UIcon name="i-lucide-house" /></span>
                <h1 class="found-title">Polytown</h1>
                <p class="found-copy">
                    Claim a plot on the endless grid, house your townsfolk, and turn wheat, wood and stone into goods
                    worth a fortune. Sell to the town hall any time, or trade with other mayors.
                </p>
                <button class="g-btn g-btn-primary found-go" :disabled="busy" @click="found">
                    <UIcon name="i-lucide-flag" />Found your town
                </button>
                <p class="found-note">Your first plot is free.</p>
            </div>
        </div>
        <div v-else-if="!town.state.value" class="absolute inset-0 flex items-center justify-center">
            <span class="g-spinner" />
        </div>

        <template v-if="town.initialized.value">
            <!-- Top-left HUD -->
            <div class="hud">
                <div class="g-chip" :class="workersDemanded > popCap ? 'g-chip-warn' : ''" :data-tip-below="workersDemanded > popCap ? 'Not enough residents — build houses' : 'Jobs / residents'">
                    <UIcon name="i-lucide-users" class="g-ico" />
                    <b>{{ workersDemanded }}<span class="g-sub">/{{ popCap }}</span></b>
                </div>
                <div class="hud-hover" @mouseenter="buildersPop = true" @mouseleave="buildersPop = false">
                    <button class="g-chip g-chip-btn" :class="buildersFree === 0 ? 'g-chip-warn' : ''" @click="openBuilders">
                        <UIcon name="i-lucide-hammer" class="g-ico" />
                        <b>{{ buildersFree }}<span class="g-sub">/{{ town.builders.value.owned }}</span></b>
                    </button>

                    <Transition name="fade">
                        <div v-if="buildersPop" class="moodpop is-builders">
                            <div>
                                <span class="g-label">In progress</span>
                                <p class="moodpop-sub">{{ buildersFree }} of {{ town.builders.value.owned }} builders free</p>
                            </div>
                            <div class="moodpop-group">
                                <div v-for="j in runningJobs" :key="j.id" class="job-row">
                                    <span class="rec-art"><TownAsset :id="j.type" kind="building" :level="j.level" /></span>
                                    <span class="rec-main">
                                        <span class="job-head">
                                            <b :data-tip="j.name">{{ j.name }}</b>
                                            <span class="rec-level">{{ j.first ? 'Building' : `Lv ${j.level - 1} → ${j.level}` }}</span>
                                            <span class="job-time">{{ formatTownDuration(j.remainingMs) }}</span>
                                        </span>
                                        <span class="g-progress job-bar"><i :style="{ width: `${Math.round(j.progress * 100)}%` }" /></span>
                                    </span>
                                </div>
                                <p v-if="runningJobs.length === 0" class="g-empty">Every builder is idle.</p>
                            </div>

                            <span class="g-label">Recommended upgrades</span>
                            <div class="moodpop-group">
                                <button
                                    v-for="r in recommendedUpgrades"
                                    :key="r.id"
                                    class="rec-row"
                                    :class="canAfford(r.cost) ? '' : 'is-dim'"
                                    :disabled="busy || !canAfford(r.cost)"
                                    @click="upgradeRecommended(r.id)"
                                >
                                    <span class="rec-art"><TownAsset :id="r.type" kind="building" :level="r.level" /></span>
                                    <span class="rec-main">
                                        <b :data-tip="r.name">{{ r.name }}</b>
                                        <span class="rec-meta">
                                            <span class="rec-level">Lv {{ r.level }} → {{ r.level + 1 }}</span>
                                            <span v-if="r.resource" class="g-tag g-tag-red"><TownAsset :id="r.resource" />short</span>
                                            <span v-else-if="r.residents" class="g-tag g-tag-warn">Residents</span>
                                        </span>
                                    </span>
                                    <span class="rec-cost" :class="canAfford(r.cost) ? '' : 'bad'">
                                        <span><TownCoin />{{ formatNumber(r.cost.coins) }}</span>
                                        <span v-for="[id, q] in Object.entries(r.cost.resources)" :key="id">
                                            <TownAsset :id="id" />{{ formatNumber(q) }}
                                        </span>
                                    </span>
                                </button>
                                <p v-if="recommendedUpgrades.length === 0" class="g-empty">Nothing to upgrade right now.</p>
                            </div>
                            <p v-if="town.builders.value.nextGemCost !== null" class="moodpop-foot">
                                Click the chip to hire another crew for {{ town.builders.value.nextGemCost }} gems.
                            </p>
                        </div>
                    </Transition>
                </div>
                <button
                    class="g-chip g-chip-btn"
                    :class="terrainOverlay ? 'is-pinned' : ''"
                    data-tip-below="Terrain map — which tiles pay a bonus"
                    @click="toggleTerrain"
                >
                    <UIcon name="i-lucide-mountain" class="g-ico" />
                    <b>Terrain</b><kbd>G</kbd>
                </button>
                <div class="hud-hover" @mouseenter="moodOpen = true" @mouseleave="moodOpen = false">
                    <div class="g-chip" :class="unmetNeeds.length || starving ? 'g-chip-warn' : ''">
                        <span class="mood-face">{{ mood?.emoji ?? '🙂' }}</span>
                        <span class="g-meter g-meter-lg">
                            <i :style="{ width: `${happiness}%` }" :class="happiness >= 50 ? 'ok' : happiness >= 25 ? 'meh' : 'bad'" />
                            <em class="g-meter-mark" :style="{ left: `${happinessPotential}%` }" data-tip-below="Reachable with what you can make right now" />
                        </span>
                        <b>{{ mood?.name ?? '' }}</b>
                        <span v-if="unmetNeeds.length" class="g-dot">{{ unmetNeeds.length }}</span>
                    </div>

                    <Transition name="fade">
                        <div v-if="moodOpen" class="moodpop">
                            <div class="moodpop-head">
                                <span class="mood-face is-lg">{{ mood?.emoji }}</span>
                                <b>{{ mood?.name }}</b>
                                <span class="moodpop-score">{{ happiness }}<span class="g-sub">/100</span></span>
                            </div>

                            <div class="moodpop-perks">
                                <span v-for="perk in perkChips(mood)" :key="perk.text" class="g-tag" :class="perk.good ? 'g-tag-green' : perk.bad ? 'g-tag-red' : ''">
                                    <UIcon :name="perk.icon" />{{ perk.text }}
                                </span>
                            </div>
                            <p v-if="nextMood" class="moodpop-next">
                                <span class="mood-face">{{ nextMood.emoji }}</span>
                                <b>{{ nextMood.name }}</b> at {{ nextMood.min }}
                                <span v-for="perk in perkChips(nextMood)" :key="perk.text" class="moodpop-next-perk">{{ perk.text }}</span>
                            </p>

                            <div class="moodpop-group">
                                <span class="g-label">Score</span>
                                <!-- Tips point down: the rows below are inside the popover, so they show. -->
                                <div
                                    v-for="row in scoreRows"
                                    :key="row.label"
                                    class="score-row"
                                    :class="row.points > 0 ? 'is-plus' : row.points < 0 ? 'is-minus' : ''"
                                    :data-tip-below="row.hint"
                                >
                                    <UIcon :name="row.icon" class="score-ico" />
                                    <b>{{ row.label }}</b>
                                    <span class="score-hint">{{ row.hint }}</span>
                                    <span class="score-points">{{ row.points > 0 ? '+' : '' }}{{ row.points }}</span>
                                </div>
                            </div>

                            <div class="moodpop-group">
                                <span class="g-label">Needs</span>
                                <div
                                    v-for="n in scoredNeeds"
                                    :key="n.resource"
                                    class="needs-row"
                                    :class="n.satisfied ? 'is-ok' : 'is-bad'"
                                    :data-tip="`${needLine(n)}\n${n.description}`"
                                >
                                    <span class="needs-ico"><TownAsset :id="n.resource" /></span>
                                    <b>{{ n.name }}</b>
                                    <span class="needs-note">{{ needLine(n) }}</span>
                                    <span class="needs-badge">{{ n.satisfied ? '+' : '−' }}{{ n.happiness }}</span>
                                </div>
                                <p v-if="scoredNeeds.length === 0" class="g-empty">Nothing wanted yet.</p>
                            </div>
                        </div>
                    </Transition>
                </div>
                <div class="hud-hover" @mouseenter="incomeOpen = true" @mouseleave="incomeOpen = false">
                    <div class="g-chip">
                        <UIcon name="i-lucide-trending-up" class="g-ico is-green" />
                        <b>{{ formatNumber(incomePerDay) }}</b><span class="g-sub">/day if sold</span>
                    </div>

                    <Transition name="fade">
                        <div v-if="incomeOpen" class="moodpop is-income">
                            <span class="g-label">Per day, sold at floor</span>
                            <div class="moodpop-group">
                                <div v-for="r in incomeRows" :key="r.id" class="income-row">
                                    <span class="income-ico"><TownAsset :id="r.id" /></span>
                                    <b :data-tip="r.name">{{ r.name }}</b>
                                    <span class="income-rate">+{{ formatNumber(r.perDay) }}/day</span>
                                    <span class="income-value"><TownCoin />{{ formatNumber(r.value) }}</span>
                                </div>
                                <p v-if="incomeRows.length === 0" class="g-empty">Nothing is being produced yet.</p>
                                <div v-if="incomeRows.length" class="income-row is-total">
                                    <span class="g-label">Total</span>
                                    <span class="income-value"><TownCoin />{{ formatNumber(incomePerDay) }}</span>
                                </div>
                            </div>
                        </div>
                    </Transition>
                </div>
            </div>

            <!-- Top-right controls -->
            <div class="corner">
                <button class="g-icon" :class="windowOpen === 'events' ? 'is-on' : ''" data-tip-below="What happened — finished builds, research, filled offers" @click="openWindow('events')">
                    <UIcon name="i-lucide-bell" />
                </button>
                <button class="g-icon" data-tip-below="How to play" @click="helpOpen = true">
                    <UIcon name="i-lucide-circle-question-mark" />
                </button>
                <button class="g-icon" :data-tip-below="sound.enabled.value ? 'Mute' : 'Unmute'" @click="toggleSound">
                    <UIcon :name="sound.enabled.value ? 'i-lucide-volume-2' : 'i-lucide-volume-off'" />
                </button>
                <button class="g-icon" :class="motion.reduced.value ? 'is-on' : ''" :data-tip-below="motion.reduced.value ? 'Reduced motion on — flat view, no camera glide, snap turns' : 'Reduce motion'" @click="motion.toggle()">
                    <UIcon :name="motion.reduced.value ? 'i-lucide-accessibility' : 'i-lucide-wind'" />
                </button>
                <button class="g-icon" data-tip-below="Recenter" @click="sceneRef?.recenter()">
                    <UIcon name="i-lucide-locate-fixed" />
                </button>
            </div>

            <!-- Reduced motion: a still frame at the edges gives the eye something that never moves. -->
            <div v-if="motion.reduced.value" class="motion-frame" aria-hidden="true" />

            <!-- Placement hint -->
            <Transition name="fade">
                <div v-if="moveSelection" class="hint">
                    <UIcon name="i-lucide-move" />
                    <b>{{ moveSelection.items.length }} moving</b>
                    <button class="hint-btn" data-tip-below="Turn the whole block a quarter turn" @click="rotateGroup"><kbd>R</kbd>rotate</button>
                    <kbd>Esc</kbd>
                </div>
                <div v-else-if="ghostType" class="hint">
                    <TownAsset v-if="ghostType !== 'road'" :id="ghostType" kind="building" :level="ghostLevel" />
                    <UIcon v-else name="i-lucide-route" />
                    <b>{{ town.catalogById.value.get(ghostType)?.name }}</b>
                    <span v-if="dragQuote" class="hint-quote">×{{ dragQuote.count }}<TownCoin />{{ formatNumber(dragQuote.coins) }}</span>
                    <span v-else-if="!movingId" class="hint-note">drag to lay a run</span>
                    <button
                        v-if="town.catalogById.value.get(ghostType)?.kind !== 'road'"
                        class="hint-btn"
                        data-tip-below="The white arrow is the front door, and it has to touch a road"
                        @click="rotatePlacement"
                    >
                        <kbd>R</kbd>rotate
                    </button>
                    <kbd>Esc</kbd>
                </div>
                <div v-else-if="hoveredSlot && plotPurchase && plotRemainingMs > 0 && !plotPurchase.maxed" class="hint">
                    <UIcon name="i-lucide-map" />Land office opens in <b>{{ formatTownDuration(plotRemainingMs) }}</b>
                </div>
            </Transition>

            <!-- Inventory (left) -->
            <div v-if="inventoryRows.length" class="inv">
                <button v-for="r in inventoryRows" :key="r.id" class="inv-row" :class="r.amount >= storageCap ? 'is-full' : ''" :data-tip="r.amount >= storageCap ? `${r.name} — storage full` : r.name" @click="openMarket(r.id)">
                    <span class="inv-ico"><TownAsset :id="r.id" /></span>
                    <span class="inv-num">{{ formatNumber(r.amount) }}</span>
                    <span class="inv-tail">
                        <UIcon v-if="r.amount >= storageCap" name="i-lucide-package" class="inv-full" />
                        <span v-if="r.perHour" class="inv-rate" :class="r.perHour > 0 ? 'up' : 'down'">{{ r.perHour > 0 ? '+' : '' }}{{ formatNumber(r.perHour) }}/h</span>
                    </span>
                </button>
            </div>

            <!-- Land for sale under the cursor -->
            <div v-if="hoveredSlot && !hoveredBuilding && !hoveredNeighbour" class="tip is-cursor">
                <template v-if="!hoveredSlot.free">
                    <b>{{ hoveredSlot.ownerName ?? 'Another mayor' }}</b>
                    <div class="tip-sub">Their land</div>
                </template>
                <template v-else-if="plotPurchase?.maxed">
                    <b><UIcon name="i-lucide-map" />Land office</b>
                    <div class="tip-sub">You own the maximum number of plots</div>
                </template>
                <template v-else-if="plotRemainingMs > 0">
                    <b><UIcon name="i-lucide-map" />For sale</b>
                    <div class="tip-sub">Opens in {{ formatTownDuration(plotRemainingMs) }}</div>
                </template>
                <template v-else>
                    <b><UIcon name="i-lucide-map" />For sale · <TownCoin />{{ formatNumber(plotPurchase?.price ?? 0) }}</b>
                    <div class="tip-sub">{{ plotAffordable ? 'Click to buy' : 'Not enough coins' }}</div>
                </template>
            </div>

            <!-- Another mayor's land -->
            <div v-if="hoveredNeighbour && !hoveredBuilding" class="tip is-cursor">
                <b>{{ hoveredNeighbour.ownerName }}</b>
                <div v-if="hoveredNeighbour.type" class="tip-sub">
                    <TownAsset v-if="hoveredNeighbour.type !== 'road'" :id="hoveredNeighbour.type" kind="building" />
                    <UIcon v-else name="i-lucide-route" />
                    {{ town.catalogById.value.get(hoveredNeighbour.type)?.name ?? 'Building' }}<template v-if="hoveredNeighbour.level && hoveredNeighbour.type !== 'road'"> · Lv {{ hoveredNeighbour.level }}</template>
                </div>
            </div>

            <!-- Hover tooltip -->
            <div v-if="hoveredBuilding && hoveredEntry && !selectedBuilding" class="tip is-cursor">
                <b>
                    <TownAsset :id="hoveredEntry.id" kind="building" :level="hoveredBuilding.level" />
                    {{ hoveredEntry.name }}
                    <span v-if="hoveredBuilding.level > 0" class="g-sub">Lv {{ hoveredBuilding.level }}</span>
                </b>
                <div class="tip-sub">
                    <template v-if="hoveredBuilding.connected === false && hoveredEntry.kind !== 'road'">
                        <span class="tip-bad"><UIcon name="i-lucide-triangle-alert" />No road at the front door</span>
                    </template>
                    <template v-else-if="hoveredBuilding.completesAt > now">{{ hoveredBuilding.level === 0 ? 'Building' : 'Upgrading' }} · {{ formatTownDuration(hoveredBuilding.completesAt - now) }}</template>
                    <template v-else-if="hoveredEntry.kind === 'industry' && hoveredBuilding.district?.residents === 0">
                        <span class="tip-bad"><UIcon name="i-lucide-triangle-alert" />No homes on this road</span>
                    </template>
                    <template v-else-if="hoveredEntry.kind === 'industry'">{{ Math.round((hoveredBuilding.staffing ?? 0) * 100) }}% staffed</template>
                    <template v-else-if="hoveredEntry.kind === 'housing'">{{ hoveredEntry.popCap * hoveredBuilding.level }} residents</template>
                    <template v-else>Click for details</template>
                </div>
            </div>

            <!-- Selection toolbar: what a marquee gathered, and what can be done to it -->
            <Transition name="rise">
                <div v-if="selectedIds.length > 1 && !moveSelection" class="seltoolbar">
                    <b class="seltoolbar-count">{{ selectedIds.length }} selected</b>
                    <button class="g-btn g-btn-sm" data-tip="Move the whole block. Sites travel too." :disabled="busy" @click="startGroupMove">
                        <UIcon name="i-lucide-move" />Move<kbd>M</kbd>
                    </button>
                    <button class="g-btn g-btn-sm" :disabled="busy || selectionUpgradable.length === 0" :data-tip="selectionUpgradable.length ? 'As many as your crews and coins allow.' : 'None can upgrade now.'" @click="upgradeSelection">
                        <UIcon name="i-lucide-arrow-up" />Upgrade {{ selectionUpgradable.length }}
                    </button>
                    <button class="g-btn g-btn-sm g-btn-danger" data-tip="No refund." :disabled="busy" @click="demolishMany(selectedIds)">
                        <UIcon name="i-lucide-trash-2" />Demolish<kbd>Del</kbd>
                    </button>
                    <button class="g-icon g-icon-sm" data-tip="Clear" aria-label="Clear selection" @click="clearSelection">
                        <UIcon name="i-lucide-x" />
                    </button>
                </div>
            </Transition>

            <!-- Selected building card -->
            <Transition name="rise">
                <div v-if="selectedBuilding && selectedEntry" class="card g-panel">
                    <div class="card-head">
                        <span class="card-art" :style="{ background: hex(selectedEntry.color) + '22' }">
                            <TownAsset :id="selectedEntry.id" kind="building" :level="selectedBuilding.level" />
                        </span>
                        <div class="min-w-0 flex-1">
                            <div class="card-title">
                                <b>{{ selectedEntry.name }}</b>
                                <span v-if="selectedBuilding.level > 0 && selectedEntry.kind !== 'road'" class="g-tag" :data-tip="`This one tops out at level ${selMaxLevel}.`">
                                    Lv {{ selectedBuilding.level }}<span class="g-sub">/{{ selMaxLevel }}</span>
                                    <template v-if="selectedBuilding.upgradingTo"><UIcon name="i-lucide-arrow-right" />{{ selectedBuilding.upgradingTo }}</template>
                                </span>
                                <span v-else class="g-tag">Site</span>
                            </div>
                            <div class="card-desc">{{ selectedEntry.description }}</div>
                        </div>
                        <button class="g-icon g-icon-sm" aria-label="Close" @click="closeAll"><UIcon name="i-lucide-x" /></button>
                    </div>

                    <div class="card-body">
                        <div v-if="selectedBuilding.connected === false && selectedEntry.kind !== 'road'" class="card-alert">
                            <UIcon name="i-lucide-triangle-alert" />
                            <span>No road at the front door. Nothing works here until a road reaches the tile the white arrow points at.</span>
                        </div>

                        <div v-if="selPending" class="card-row">
                            <div class="flex-1">
                                <div class="card-progress-head">
                                    <span class="g-label"><UIcon name="i-lucide-hammer" />{{ selectedBuilding.level === 0 ? 'Under construction' : 'Upgrading' }}</span>
                                    <b>{{ formatTownDuration(selRemaining) }}</b>
                                </div>
                                <div class="g-progress"><i :style="{ width: `${Math.round(100 * (1 - selRemaining / Math.max(1, selectedBuilding.jobMs ?? 1)))}%` }" /></div>
                            </div>
                            <button class="g-btn g-btn-gem g-btn-sm" :disabled="busy || gems < selRushGems" @click="rushSelected">
                                <UIcon name="i-lucide-gem" />Rush {{ selRushGems }}
                            </button>
                        </div>

                        <!-- A site can be moved like anything else: the clock keeps running. -->
                        <div v-if="selPending" class="card-actions">
                            <button class="g-btn g-btn-sm" data-tip="The build carries on wherever you put it." :disabled="busy" @click="startMove">
                                <UIcon name="i-lucide-move" />Move<kbd>M</kbd>
                            </button>
                            <button class="g-btn g-btn-sm g-btn-danger" data-tip="No refund." @click="confirmDemolish = true">
                                <UIcon name="i-lucide-trash-2" />Demolish
                            </button>
                        </div>

                        <template v-else>
                            <!-- What it makes, at the rate it really runs -->
                            <div v-if="selectedEntry.kind === 'industry'" class="recipe">
                                <span v-for="[id, q] in Object.entries(selectedEntry.inputs)" :key="id" class="recipe-item is-in" :data-tip="town.resourceById.value.get(id)?.name">
                                    <TownAsset :id="id" />−{{ selRate(q) }}
                                </span>
                                <UIcon v-if="Object.keys(selectedEntry.inputs).length" name="i-lucide-arrow-right" class="recipe-arrow" />
                                <span v-for="[id, q] in Object.entries(selectedEntry.outputs)" :key="id" class="recipe-item is-out" :data-tip="town.resourceById.value.get(id)?.name">
                                    <TownAsset :id="id" />+{{ selRate(q) }}
                                </span>
                                <span class="recipe-unit" data-tip="What it really moves right now. Level, workers and supply are all counted in.">per {{ selUnit === 'day' ? 'day' : 'hour' }}</span>
                            </div>

                            <!-- The two things that slow a building down -->
                            <div v-if="selWorkersWanted > 0" class="meters">
                                <div class="meter" :data-tip="selWorkersTitle">
                                    <UIcon name="i-lucide-users" class="meter-ico" />
                                    <span class="meter-label">Workers <em>{{ selWorkersWanted }}</em></span>
                                    <span class="g-meter"><i :class="barClass(selectedBuilding.staffing ?? 0)" :style="{ width: `${Math.round((selectedBuilding.staffing ?? 0) * 100)}%` }" /></span>
                                    <b class="meter-value">{{ Math.round((selectedBuilding.staffing ?? 0) * 100) }}%</b>
                                </div>
                                <div v-if="selSupply && selectedEntry.kind === 'industry' && Object.keys(selectedEntry.inputs).length" class="meter" :data-tip="selSupplyTitle">
                                    <UIcon name="i-lucide-truck" class="meter-ico" />
                                    <span class="meter-label">Supply</span>
                                    <span class="g-meter"><i :class="barClass(selSupply.ratio)" :style="{ width: `${Math.round(selSupply.ratio * 100)}%` }" /></span>
                                    <b class="meter-value">{{ Math.round(selSupply.ratio * 100) }}%</b>
                                </div>
                            </div>

                            <!-- Everything else says its one thing -->
                            <div v-if="selectedEntry.kind === 'housing'" class="card-stats">
                                <span class="g-tag g-tag-green"><UIcon name="i-lucide-users" />{{ selectedEntry.popCap * selectedBuilding.level }} residents</span>
                                <span v-if="selAdjacency" class="g-tag" :class="selAdjacency.parks ? 'g-tag-green' : ''" :data-tip="`Parks within ${town.constants.value.parkRadius} tiles make this home happier.`">
                                    <UIcon name="i-lucide-trees" />{{ selAdjacency.parks }} nearby
                                </span>
                                <span v-if="selAdjacency" class="g-tag" :class="selAdjacency.industry ? 'g-tag-red' : ''" data-tip="Workshops beside homes drag the town score down.">
                                    <UIcon name="i-lucide-factory" />{{ selAdjacency.industry }} nearby
                                </span>
                            </div>
                            <div v-else-if="selectedEntry.kind === 'civic'" class="card-stats">
                                <span class="g-tag g-tag-green"><UIcon name="i-lucide-smile" />+{{ selectedEntry.happiness * selectedBuilding.level }} happiness</span>
                                <span class="g-tag" :data-tip="`Every home within ${town.constants.value.parkRadius} tiles is happier for it.`">
                                    <UIcon name="i-lucide-ruler" />{{ town.constants.value.parkRadius }} tiles
                                </span>
                            </div>
                            <div v-else-if="selectedEntry.kind === 'storage'" class="card-stats">
                                <span class="g-tag" :class="(selectedBuilding.staffing ?? 0) >= 0.99 ? 'g-tag-green' : ''" data-tip="A warehouse holds only what its crew can manage, so an unstaffed one holds nothing.">
                                    <UIcon name="i-lucide-package" />+{{ formatNumber(Math.floor(selectedEntry.storage * selectedBuilding.level * (selectedBuilding.staffing ?? 0))) }} per good
                                </span>
                            </div>

                            <!-- Notes, only when they have something to say -->
                            <p v-if="selDistrictFix" class="card-note">
                                <UIcon name="i-lucide-users" />{{ selDistrictFix }}
                            </p>
                            <p v-else-if="selSupplyFix" class="card-note">
                                <TownAsset :id="selSupplyFix.resource" />
                                Starved of {{ selSupplyFix.name }} — put a {{ selSupplyFix.maker }} within {{ selSupplyFix.tiles }} road tiles, or buy some at the market.
                            </p>
                            <p v-else-if="selNuisance && selNuisance.homes > 0" class="card-note">
                                <UIcon name="i-lucide-factory" />{{ selNuisance.homes }} {{ selNuisance.homes === 1 ? 'home' : 'homes' }} within {{ selNuisance.radius }} tiles, costing the town {{ selNuisance.total }} happiness.
                            </p>

                            <!-- Upgrade -->
                            <div v-if="selCanUpgrade && selectedEntry.kind !== 'road'" class="upgrade">
                                <!-- Both faces are always laid out, one over the other, so the card never
                                     changes height when the hover swaps the cost for the preview. -->
                                <div class="upgrade-faces">
                                    <div v-if="selUpgradePreview.length" class="upgrade-info" :class="previewUpgrade ? '' : 'is-hidden'" :aria-hidden="!previewUpgrade">
                                        <div class="upgrade-head">
                                            <span class="g-label">Level {{ selectedBuilding.level }} → {{ selNextLevel }}</span>
                                            <span v-if="selectedEntry.kind === 'industry'" class="g-sub">per {{ selUnit === 'day' ? 'day' : 'hour' }}</span>
                                        </div>
                                        <div class="upgrade-cost">
                                            <span v-for="(r, i) in selUpgradePreview" :key="i" :data-tip="r.tip">
                                                <TownAsset v-if="r.id" :id="r.id" />
                                                <UIcon v-else-if="r.ico" :name="r.ico" />
                                                <s class="preview-from">{{ r.from }}</s>
                                                <b :class="r.up ? 'preview-up' : 'preview-more'">{{ r.to }}</b>
                                                <em v-if="!r.id" class="preview-label">{{ r.label }}</em>
                                            </span>
                                        </div>
                                    </div>
                                    <div class="upgrade-info" :class="previewUpgrade && selUpgradePreview.length ? 'is-hidden' : ''" :aria-hidden="previewUpgrade && selUpgradePreview.length > 0">
                                        <div class="upgrade-head">
                                            <span class="g-label">Level {{ selNextLevel }}</span>
                                            <span class="g-sub"><UIcon name="i-lucide-clock" />{{ formatTownDuration(selUpgradeMs) }}</span>
                                        </div>
                                        <div class="upgrade-cost">
                                            <span :class="balance >= selUpgradeCost.coins ? '' : 'bad'"><TownCoin />{{ formatNumber(selUpgradeCost.coins) }}</span>
                                            <span v-for="[id, q] in Object.entries(selUpgradeCost.resources)" :key="id" :class="(town.inventory.value[id] ?? 0) >= q ? '' : 'bad'">
                                                <TownAsset :id="id" />{{ formatNumber(q) }}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    class="g-btn g-btn-primary g-btn-sm"
                                    :disabled="busy || !canAfford(selUpgradeCost)"
                                    :data-tip="buildersFree === 0 ? 'Every builder is on a job — click to free one.' : canAfford(selUpgradeCost) ? undefined : 'You are short on what is marked red.'"
                                    @mouseenter="previewUpgrade = true"
                                    @mouseleave="previewUpgrade = false"
                                    @focus="previewUpgrade = true"
                                    @blur="previewUpgrade = false"
                                    @click="upgradeSelected"
                                >
                                    <UIcon name="i-lucide-arrow-up" />{{ buildersFree === 0 ? 'No builder' : 'Upgrade' }}
                                </button>
                            </div>
                            <div v-else-if="selectedEntry.kind !== 'road'" class="g-tag g-tag-gold card-maxed">
                                <UIcon name="i-lucide-medal" />Fully upgraded
                            </div>

                            <div class="card-actions">
                                <button class="g-btn g-btn-sm" data-tip="Free. Away from a road it stops working until one reaches it." :disabled="busy" @click="startMove">
                                    <UIcon name="i-lucide-move" />Move<kbd>M</kbd>
                                </button>
                                <button class="g-btn g-btn-sm g-btn-danger" data-tip="Nothing is refunded." @click="confirmDemolish = true">
                                    <UIcon name="i-lucide-trash-2" />Demolish
                                </button>
                            </div>
                        </template>
                    </div>
                </div>
            </Transition>

            <!-- Build strip -->
            <Transition name="rise">
                <div v-if="buildOpen" class="strip g-panel">
                    <div class="strip-tabs">
                        <button v-for="t in tiers" :key="t" class="strip-tab" :class="[buildTier === t ? 'is-active' : '', tierLocked(t) ? 'is-locked' : '']" @click="buildTier = t; sound.play('click')">
                            <UIcon v-if="tierLocked(t)" name="i-lucide-lock" />{{ tierName(t) }}
                        </button>
                        <button class="g-icon g-icon-sm ml-auto" aria-label="Close" @click="toggleBuild"><UIcon name="i-lucide-x" /></button>
                    </div>
                    <div v-if="tierLocked(buildTier) && tierLockText(buildTier)" class="strip-lock">
                        <UIcon name="i-lucide-lock" />{{ tierLockText(buildTier) }}
                    </div>
                    <div class="strip-cards">
                        <button
                            v-for="c in tierEntries"
                            :key="c.id"
                            class="bcard"
                            :class="[ghostType === c.id && !movingId ? 'is-active' : '', canAfford(town.nextCost.value[c.id] ?? c.cost) && !tierLocked(c.tier) && !countIssue(c.id) && (c.kind === 'road' || buildersFree > 0) ? '' : 'is-dim']"
                            :disabled="tierLocked(c.tier)"
                            :style="{ '--accent': hex(c.color) }"
                            @click="pickBuild(c.id)"
                        >
                            <span v-if="town.countsByType.value[c.id] || c.maxCount" class="bcard-count">×{{ town.countsByType.value[c.id] ?? 0 }}<template v-if="c.maxCount">/{{ c.maxCount }}</template></span>
                            <span class="bcard-art">
                                <TownAsset v-if="c.kind !== 'road'" :id="c.id" kind="building" />
                                <UIcon v-else name="i-lucide-route" />
                            </span>
                            <b
                                class="bcard-name"
                                :data-tip="countIssue(c.id) ?? ((town.countsByType.value[c.id] ?? 0) ? `You own ${town.countsByType.value[c.id]}${c.maxCount ? ` of ${c.maxCount}` : ''} — each extra one costs more` : (c.maxCount ? `A town may run ${c.maxCount}` : ''))"
                            >{{ c.name }}</b>
                            <span class="bcard-cost" :class="balance >= (town.nextCost.value[c.id]?.coins ?? c.cost.coins) ? '' : 'bad'">
                                <TownCoin />{{ formatNumber(town.nextCost.value[c.id]?.coins ?? c.cost.coins) }}
                            </span>
                            <span v-if="Object.keys(town.nextCost.value[c.id]?.resources ?? c.cost.resources).length" class="bcard-res">
                                <span v-for="[id, q] in Object.entries(town.nextCost.value[c.id]?.resources ?? c.cost.resources)" :key="id" :class="(town.inventory.value[id] ?? 0) >= q ? '' : 'bad'">
                                    <TownAsset :id="id" />{{ formatNumber(q) }}
                                </span>
                            </span>
                            <span class="bcard-meta">
                                <span v-if="c.kind === 'road'"><UIcon name="i-lucide-zap" />instant</span>
                                <span v-else :data-tip="`Upgrades take ${formatTownDuration(Math.round(c.upgradeMs * (mood?.buildTime ?? 1)))} and up`">
                                    <UIcon name="i-lucide-clock" />{{ formatTownDuration(Math.round(c.buildMs * (mood?.buildTime ?? 1))) }}
                                </span>
                                <span v-if="c.workers"><UIcon name="i-lucide-users" />{{ c.workers }}</span>
                                <span v-if="c.popCap"><UIcon name="i-lucide-house" />+{{ c.popCap }}</span>
                                <span v-if="c.happiness"><UIcon name="i-lucide-smile" />+{{ c.happiness }}</span>
                                <span v-if="c.storage"><UIcon name="i-lucide-package" />+{{ formatNumber(c.storage) }}</span>
                            </span>
                            <span v-if="Object.keys(c.outputs).length" class="bcard-io" :data-tip="`Per ${ioUnit(c) === 'day' ? 'day' : 'hour'} at level 1`">
                                <template v-if="Object.keys(c.inputs).length">
                                    <span v-for="[id, q] in Object.entries(c.inputs)" :key="id">{{ ioRate(q, ioUnit(c)) }}<TownAsset :id="id" /></span>
                                    <UIcon name="i-lucide-arrow-right" />
                                </template>
                                <span v-for="[id, q] in Object.entries(c.outputs)" :key="id" class="is-out">{{ ioRate(q, ioUnit(c)) }}<TownAsset :id="id" /></span>
                            </span>
                        </button>
                    </div>
                </div>
            </Transition>

            <!-- Terrain legend -->
            <Transition name="fade">
                <div v-if="terrainOverlay" class="legend g-panel">
                    <div class="legend-head">
                        <span class="g-label"><UIcon name="i-lucide-mountain" />Terrain</span>
                        <span class="g-tag g-tag-green">+{{ Math.round(TOWN_TERRAIN_BONUS * 100) }}%</span>
                        <button class="g-icon g-icon-sm ml-auto" aria-label="Close" @click="toggleTerrain"><UIcon name="i-lucide-x" /></button>
                    </div>
                    <div v-for="t in terrainLegend" :key="t.id" class="legend-row" :class="t.boosting ? 'is-boosting' : ''">
                        <i :style="{ background: t.css }" />
                        <b>{{ t.name }}</b>
                        <span>{{ t.description }}</span>
                    </div>
                </div>
            </Transition>

            <!-- Dock -->
            <div class="dock g-panel">
                <button class="dock-btn" :class="buildOpen ? 'is-active' : ''" @click="toggleBuild">
                    <UIcon name="i-lucide-hammer" class="dock-ico" /><span>Build</span><kbd>B</kbd>
                </button>
                <button class="dock-btn" :class="windowOpen === 'market' ? 'is-active' : ''" @click="openMarket()">
                    <UIcon name="i-lucide-store" class="dock-ico" /><span>Market</span><kbd>H</kbd>
                </button>
                <button class="dock-btn" :class="windowOpen === 'goals' ? 'is-active' : ''" @click="openWindow('goals')">
                    <UIcon name="i-lucide-trophy" class="dock-ico" /><span>Goals</span><kbd>T</kbd>
                    <span v-if="claimable" class="dock-badge">{{ claimable }}</span>
                </button>
                <button class="dock-btn" :class="windowOpen === 'land' ? 'is-active' : ''" @click="openWindow('land')">
                    <UIcon name="i-lucide-map" class="dock-ico" /><span>Land</span><kbd>P</kbd>
                </button>
                <button class="dock-btn" :class="windowOpen === 'research' ? 'is-active' : ''" @click="openWindow('research')">
                    <UIcon name="i-lucide-microscope" class="dock-ico" /><span>Research</span><kbd>C</kbd>
                    <span v-if="researchRunning" class="dock-dot" />
                </button>
                <button class="dock-btn" :class="windowOpen === 'mayors' ? 'is-active' : ''" @click="openWindow('mayors')">
                    <UIcon name="i-lucide-crown" class="dock-ico" /><span>Mayors</span><kbd>L</kbd>
                </button>
            </div>

            <!-- Windows -->
            <Transition name="fade">
                <div v-if="windowOpen" class="backdrop" @click.self="closeAll">
                    <div class="g-window" :class="windowOpen === 'market' ? 'is-wide' : windowOpen === 'events' ? 'is-small' : ''">
                        <TownMarketPanel
                            v-if="windowOpen === 'market'"
                            :resources="town.resources.value"
                            :inventory="town.inventory.value"
                            :last-prices="town.lastPrices.value"
                            :my-orders="town.myOrders.value"
                            :balance="balance"
                            :initial-resource="marketResource"
                            :busy="busy"
                            :net-per-tick="town.netPerTick.value"
                            :speed-multiplier="speed"
                            :tick-ms="town.constants.value.tickMs"
                            :storage-cap="storageCap"
                            :jewels-per-gem="town.constants.value.jewelsPerGem"
                            @close="closeAll"
                            @convert="convertJewels"
                            @sell-floor="sellFloor"
                            @sell-bulk="sellBulk"
                            @place-order="placeOrder"
                            @cancel-order="cancelOrder"
                        />
                        <TownMilestonesPanel v-else-if="windowOpen === 'goals'" :milestones="town.milestones.value" :busy="busy" @claim="claimMilestone" @close="closeAll" />
                        <TownLeaderboardPanel v-else-if="windowOpen === 'mayors'" @close="closeAll" />
                        <TownEventsPanel v-else-if="windowOpen === 'events'" :catalog-by-id="town.catalogById.value" :resource-by-id="town.resourceById.value" :tick="stateTick" @close="closeAll" />
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
                                <h2><UIcon name="i-lucide-map" />Land <span class="g-tag">{{ town.plots.value.length }}/{{ town.constants.value.maxPlots }}</span></h2>
                                <button class="g-icon g-icon-sm ml-auto" aria-label="Close" @click="closeAll"><UIcon name="i-lucide-x" /></button>
                            </div>
                            <div class="g-window-body space-y-3">
                                <div class="g-sec">
                                    <header>
                                        <span>Yours, free to sell</span>
                                        <span data-tip-below="A plot has to be completely empty before you can sell or list it.">{{ emptyPlots.length }} of {{ town.plots.value.length }}</span>
                                    </header>
                                    <p v-if="emptyPlots.length === 0" class="g-empty">Every plot has something on it.</p>
                                    <div v-for="p in emptyPlots" :key="p.id" class="g-row plotrow">
                                        <UIcon name="i-lucide-land-plot" class="plot-ico" />
                                        <div class="min-w-0 flex-1">
                                            <b>{{ p.x }}, {{ p.y }}</b>
                                            <div v-if="p.listPrice !== null" class="plotrow-sub is-gold">Listed · {{ formatNumber(p.listPrice) }}</div>
                                            <div v-else class="plotrow-sub">Office pays {{ formatNumber(p.refund) }}</div>
                                        </div>
                                        <template v-if="p.listPrice === null">
                                            <input v-model.number="listingPrices[p.id]" type="number" min="1" placeholder="Ask" class="g-input w-24">
                                            <button class="g-btn g-btn-sm" :disabled="busy" data-tip="Offer it to the mayors next to you at your price." @click="listPlotForSale(p.id)">List</button>
                                            <button class="g-btn g-btn-sm" :disabled="busy || p.refund <= 0" :data-tip="p.refund > 0 ? 'Sell back to the land office now.' : 'This plot was free — the office pays nothing.'" @click="confirmSellPlot = p.id">Sell</button>
                                        </template>
                                        <button v-else class="g-btn g-btn-sm" :disabled="busy" @click="unlistPlot(p.id)">Unlist</button>
                                    </div>
                                </div>

                                <div class="g-sec">
                                    <header>
                                        <span>For sale near you</span>
                                        <span>{{ town.world.value.listings.length }}</span>
                                    </header>
                                    <p v-if="town.world.value.listings.length === 0" class="g-empty">Nobody next to you is selling.</p>
                                    <div v-for="l in town.world.value.listings" :key="l.plotId" class="g-row plotrow">
                                        <UIcon name="i-lucide-map-pinned" class="plot-ico" />
                                        <div class="min-w-0 flex-1">
                                            <b>{{ l.x }}, {{ l.y }}</b>
                                            <div class="plotrow-sub truncate">{{ l.ownerName }}</div>
                                        </div>
                                        <b class="plotrow-price"><TownCoin />{{ formatNumber(l.price) }}</b>
                                        <button class="g-btn g-btn-gold g-btn-sm" :disabled="busy || balance < l.price" @click="onSelectListing({ id: l.plotId, ownerName: l.ownerName, price: l.price })">Buy</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>

            <!-- Welcome back -->
            <Transition name="fade">
                <div v-if="welcome" class="backdrop" @click.self="welcome = null">
                    <div class="g-window is-small">
                        <div class="g-window-head">
                            <h2><UIcon name="i-lucide-hand" />Welcome back <span class="g-tag">{{ formatTownDuration(welcome.elapsedMs) }}</span></h2>
                            <button class="g-icon g-icon-sm ml-auto" aria-label="Close" @click="welcome = null"><UIcon name="i-lucide-x" /></button>
                        </div>
                        <div class="g-window-body space-y-3">
                            <p class="g-label">While you were away</p>
                            <div class="welcome-grid">
                                <div v-for="r in welcomeRows" :key="r.id" class="g-cell">
                                    <span class="welcome-art"><TownAsset :id="r.def?.id" /></span>
                                    <b :class="r.qty > 0 ? 'is-up' : 'is-down'">{{ r.qty > 0 ? '+' : '' }}{{ formatNumber(r.qty) }}</b>
                                    <span class="g-sub">{{ r.def?.name }}</span>
                                </div>
                            </div>
                            <p v-if="welcomeValue" class="welcome-worth">
                                Worth about <b><TownCoin />{{ formatNumber(welcomeValue) }}</b> at floor price.
                            </p>
                            <div class="g-actions">
                                <button class="g-btn g-btn-ghost" @click="welcome = null">Close</button>
                                <button class="g-btn g-btn-primary" @click="welcome = null; openMarket()">
                                    <UIcon name="i-lucide-store" />Market
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>

            <!-- Help -->
            <Transition name="fade">
                <div v-if="helpOpen" class="backdrop" @click.self="helpOpen = false">
                    <div class="g-window">
                        <div class="g-window-head">
                            <h2>How to play</h2>
                            <button class="g-icon g-icon-sm ml-auto" aria-label="Close" @click="helpOpen = false"><UIcon name="i-lucide-x" /></button>
                        </div>
                        <div class="g-window-body help space-y-3">
                            <div class="g-sec">
                                <header>The town</header>
                                <dl>
                                    <dt><UIcon name="i-lucide-house" />Houses</dt>
                                    <dd>Two residents per level. Every workshop needs residents — an unstaffed farm grows nothing.</dd>
                                    <dt><UIcon name="i-lucide-route" />Roads</dt>
                                    <dd>Every front door must touch a road, and people walk to work along them, so a road network only staffs the workshops it reaches. <kbd>R</kbd> rotates; buildings auto-face a road. Moving is free.</dd>
                                    <dt><UIcon name="i-lucide-smile" />Happiness</dt>
                                    <dd>A score out of 100 that sets production speed. Starts at 50; parks add up to 20, needs add or subtract, workshops beside homes take up to 25. The mood chip shows every line.</dd>
                                    <dt><UIcon name="i-lucide-utensils" />Needs</dt>
                                    <dd>Residents eat grain and bread, then want bricks, tools and luxuries. A need only counts once you could make it; after that, going without costs happiness. The goods are really consumed.</dd>
                                    <dt><UIcon name="i-lucide-ruler" />Radius</dt>
                                    <dd>A park cheers homes within 4 tiles. Industry sours the homes around it, further at every tier. The square on the ground shows the reach while placing.</dd>
                                </dl>
                            </div>

                            <div class="g-sec">
                                <header>Growing</header>
                                <dl>
                                    <dt><UIcon name="i-lucide-layers" />Tiers</dt>
                                    <dd>Raw goods → refined goods → bread and tools → steel, machines and luxuries. Finish one building of a tier to unlock the next.</dd>
                                    <dt><UIcon name="i-lucide-arrow-up" />Levels</dt>
                                    <dd>Most cap at 20, a park at 12, a warehouse at 16. Upgrades cost coins and goods, and the goods climb faster.</dd>
                                    <dt><UIcon name="i-lucide-hammer" />Builders</dt>
                                    <dd>One crew per build or upgrade, three to start; roads are instant. Three more can be hired for gems, and <UIcon name="i-lucide-gem" class="is-gem" /> rush costs 1 gem per 5 minutes left.</dd>
                                    <dt><UIcon name="i-lucide-truck" />Supply</dt>
                                    <dd>A workshop wants its inputs a short walk away, counted in <b>road tiles</b>, so the shape of your streets sets its speed. Supply is finite — one lumber camp cannot feed five sawmills, and the closest pairing wins.</dd>
                                    <dt><UIcon name="i-lucide-package" />Storage</dt>
                                    <dd>Caps each good. Full storage halts production — sell, or build warehouses.</dd>
                                    <dt><UIcon name="i-lucide-mountain" />Terrain</dt>
                                    <dd>Soil, woodland and rock make the matching building a quarter faster; water cannot be built on. <kbd>G</kbd> shows the map.</dd>
                                    <dt><UIcon name="i-lucide-microscope" />Research</dt>
                                    <dd>Thirty projects in five branches, one at a time, 12 hours to 3 days each: output, build speed, supply reach, residents, prices.</dd>
                                </dl>
                            </div>

                            <div class="g-sec">
                                <header>Coins</header>
                                <dl>
                                    <dt><UIcon name="i-lucide-store" />Market</dt>
                                    <dd>There is no passive income — you earn by selling. The town hall always buys at a floor price, but buying is only ever from other mayors.</dd>
                                    <dt><UIcon name="i-lucide-map" />Land</dt>
                                    <dd>One shared realm. The office sells a square next to yours, each dearer and slower than the last. Empty plots go back for a quarter, or list at your own price.</dd>
                                    <dt><UIcon name="i-lucide-trophy" />Goals</dt>
                                    <dd>Pay coins and gems for hitting town targets.</dd>
                                </dl>
                            </div>

                            <div class="g-sec">
                                <header>Controls</header>
                                <p class="help-keys">
                                    Drag to select · shift-drag adds · shift-click toggles one · with a building picked, drag to lay a run
                                    · middle-drag pans · wheel zooms · right-drag orbits
                                </p>
                                <p class="help-keys">
                                    <kbd>WASD</kbd> move <kbd>Q</kbd><kbd>E</kbd> turn <kbd>R</kbd> rotate <kbd>M</kbd> move <kbd>Del</kbd> demolish
                                    <kbd>B</kbd> build <kbd>H</kbd> market <kbd>T</kbd> goals <kbd>L</kbd> mayors
                                    <kbd>P</kbd> land <kbd>C</kbd> research <kbd>G</kbd> terrain <kbd>Esc</kbd> back
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>

            <!-- Land purchase confirm -->
            <Transition name="fade">
                <div v-if="confirmPlot && plotPurchase" class="backdrop" @click.self="confirmPlot = null">
                    <div class="g-window is-tiny">
                        <div class="g-window-head"><h2><UIcon name="i-lucide-map" />Buy this land?</h2></div>
                        <div class="g-window-body space-y-3">
                            <p class="g-copy">Plot #{{ plotPurchase.nextIndex }} at ({{ confirmPlot.x }}, {{ confirmPlot.y }}). The next plot will cost more again.</p>
                            <div class="g-stat">
                                <span class="g-label">Price</span>
                                <b class="is-gold"><TownCoin />{{ formatNumber(plotPurchase.price) }}</b>
                            </div>
                            <div class="g-actions">
                                <button class="g-btn g-btn-ghost" @click="confirmPlot = null">Cancel</button>
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
                        <div class="g-window-head"><h2><UIcon name="i-lucide-handshake" />Buy this land?</h2></div>
                        <div class="g-window-body space-y-3">
                            <p class="g-copy">{{ confirmListing.ownerName }} is selling this plot. It has to touch land you already own.</p>
                            <div class="g-stat">
                                <span class="g-label">Asking price</span>
                                <b class="is-gold"><TownCoin />{{ formatNumber(confirmListing.price) }}</b>
                            </div>
                            <div class="g-actions">
                                <button class="g-btn g-btn-ghost" @click="confirmListing = null">Cancel</button>
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
                        <div class="g-window-head"><h2><UIcon name="i-lucide-map" />Sell this plot back?</h2></div>
                        <div class="g-window-body space-y-3">
                            <p class="g-copy">The office pays {{ Math.round((town.state.value?.plotRefundShare ?? 0.25) * 100) }}% of what you paid. Another mayor may pay more.</p>
                            <div class="g-stat">
                                <span class="g-label">Refund</span>
                                <b class="is-gold"><TownCoin />{{ formatNumber(sellPlotRefund) }}</b>
                            </div>
                            <div class="g-actions">
                                <button class="g-btn g-btn-ghost" @click="confirmSellPlot = null">Cancel</button>
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
                        <div class="g-window-head">
                            <h2><UIcon name="i-lucide-hammer" />Every builder is busy</h2>
                            <button class="g-icon g-icon-sm ml-auto" aria-label="Close" @click="blocked = null"><UIcon name="i-lucide-x" /></button>
                        </div>
                        <div class="g-window-body space-y-3">
                            <p class="g-copy">All {{ town.builders.value.owned }} crews are on a job. Free one up, or wait.</p>
                            <div v-if="blockedCheapest" class="g-stat">
                                <span class="blocked-art"><TownAsset :id="blockedCheapest.type" kind="building" :level="blockedCheapest.level" /></span>
                                <div class="min-w-0 flex-1">
                                    <b>{{ blockedCheapest.name }}</b>
                                    <div class="g-sub">{{ blockedCheapest.first ? 'Building' : `Upgrading to ${blockedCheapest.level}` }} · {{ formatTownDuration(blockedCheapest.remainingMs) }} left</div>
                                </div>
                                <b class="is-gem"><UIcon name="i-lucide-gem" />{{ blockedCheapest.gems }}</b>
                            </div>
                            <div class="g-actions">
                                <button class="g-btn g-btn-ghost" @click="blocked = null">Wait</button>
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
                        <div class="g-window-head"><h2><UIcon name="i-lucide-hammer" />Hire a builder</h2></div>
                        <div class="g-window-body space-y-3">
                            <p class="g-copy">Each crew works one build or upgrade at a time. Hired for good.</p>
                            <div class="g-stat">
                                <span class="g-label">{{ town.builders.value.owned }} → {{ town.builders.value.owned + 1 }} crews</span>
                                <b class="is-gem"><UIcon name="i-lucide-gem" />{{ town.builders.value.nextGemCost }}</b>
                            </div>
                            <div class="g-actions">
                                <button class="g-btn g-btn-ghost" @click="buildersOpen = false">Cancel</button>
                                <button class="g-btn g-btn-gem" :disabled="busy || gems < (town.builders.value.nextGemCost ?? 0)" @click="hireBuilder">Hire</button>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>

            <!-- Bulk demolish confirm -->
            <Transition name="fade">
                <div v-if="confirmBulk" class="backdrop" @click.self="confirmBulk = null">
                    <div class="g-window is-tiny">
                        <div class="g-window-head"><h2>Demolish {{ confirmBulk.ids.length }} {{ confirmBulk.ids.length === 1 ? 'building' : 'buildings' }}?</h2></div>
                        <div class="g-window-body space-y-3">
                            <p class="g-copy">No refund. Every tile becomes free again.</p>
                            <div class="g-actions">
                                <button class="g-btn g-btn-ghost" @click="confirmBulk = null">Cancel</button>
                                <button class="g-btn g-btn-danger" :disabled="busy" @click="demolishBulk">
                                    <UIcon name="i-lucide-trash-2" />Demolish
                                </button>
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
                        <div class="g-window-body space-y-3">
                            <p class="g-copy">No refund. The tile becomes free again.</p>
                            <div class="g-actions">
                                <button class="g-btn g-btn-ghost" @click="confirmDemolish = false">Cancel</button>
                                <button class="g-btn g-btn-danger" @click="demolishSelected">
                                    <UIcon name="i-lucide-trash-2" />Demolish
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>
        </template>
    </div>
</template>

<style>
/* ── Polytown game UI ─────────────────────────────────────────────────────────
   Tokens and shared .g-* primitives live here and here only; every other
   town/* component consumes them and adds scoped rules of its own.
   Light is the base theme, dark overrides the tokens — no white-glass fills. */

.town-root {
    /* surfaces */
    --g-bg: rgba(251, 249, 244, 0.94);
    --g-bg-2: rgba(255, 255, 255, 0.98);
    --g-fill: rgba(34, 28, 16, 0.045);
    --g-fill-2: rgba(34, 28, 16, 0.085);
    --g-line: rgba(34, 28, 16, 0.10);
    --g-line-2: rgba(34, 28, 16, 0.20);
    /* text */
    --g-text: #1f1c16;
    --g-text-2: rgba(31, 28, 22, 0.70);
    --g-muted: rgba(31, 28, 22, 0.50);
    /* semantic */
    --g-accent: var(--ui-primary);
    --g-accent-fg: #fff;
    --g-gold: #a8730c;
    --g-gold-bg: rgba(212, 160, 23, 0.14);
    --g-green: #1e8e4b;
    --g-green-bg: rgba(30, 142, 75, 0.12);
    --g-red: #c8443c;
    --g-red-bg: rgba(200, 68, 60, 0.12);
    --g-gem: #1d7fc2;
    --g-gem-bg: rgba(29, 127, 194, 0.12);
    --g-warn: #b7791f;
    --g-warn-bg: rgba(183, 121, 31, 0.14);
    /* shape */
    --g-radius: 14px;
    --g-radius-sm: 9px;
    --g-radius-xs: 6px;
    --g-shadow: 0 8px 24px rgba(40, 30, 10, 0.12), 0 1px 2px rgba(40, 30, 10, 0.08);
    --g-shadow-lg: 0 24px 60px rgba(40, 30, 10, 0.18), 0 2px 6px rgba(40, 30, 10, 0.08);
    --g-blur: blur(14px);
    --g-font-display: ui-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;

    position: relative;
    height: min(100%, 100svh);
    width: 100%;
    overflow: hidden;
    color: var(--g-text);
    font-family: inherit;
    background: #8ecbe8;
}

.dark .town-root {
    --g-bg: rgba(22, 24, 29, 0.94);
    --g-bg-2: rgba(28, 31, 37, 0.97);
    --g-fill: rgba(255, 255, 255, 0.055);
    --g-fill-2: rgba(255, 255, 255, 0.10);
    --g-line: rgba(255, 255, 255, 0.09);
    --g-line-2: rgba(255, 255, 255, 0.20);
    --g-text: #f1eee7;
    --g-text-2: rgba(241, 238, 231, 0.70);
    --g-muted: rgba(241, 238, 231, 0.50);
    --g-accent-fg: #0b1a10;
    --g-gold: #f0c257;
    --g-gold-bg: rgba(240, 194, 87, 0.16);
    --g-green: #5ad77a;
    --g-green-bg: rgba(90, 215, 122, 0.14);
    --g-red: #ff7b72;
    --g-red-bg: rgba(255, 123, 114, 0.14);
    --g-gem: #6cc8ff;
    --g-gem-bg: rgba(108, 200, 255, 0.14);
    --g-warn: #f0b34d;
    --g-warn-bg: rgba(240, 179, 77, 0.16);
    --g-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.3);
    --g-shadow-lg: 0 24px 60px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3);
    background: #1b2430;
}

.town-root :is(b, strong) { font-weight: 650; }
.town-root .bad { color: var(--g-red); }
.town-root .is-gold { color: var(--g-gold); }
.town-root .is-green { color: var(--g-green); }
.town-root .is-gem { color: var(--g-gem); }
.town-root .is-up { color: var(--g-green); }
.town-root .is-down { color: var(--g-red); }

/* Small trailing detail next to a value: "/100", "/day if sold", unit names. */
.g-sub { color: var(--g-muted); font-weight: 500; font-size: 0.85em; }

/* ── Surfaces ───────────────────────────────────────────────────────────── */
.g-panel {
    background: var(--g-bg);
    border: 1px solid var(--g-line);
    backdrop-filter: var(--g-blur);
    box-shadow: var(--g-shadow);
    border-radius: var(--g-radius);
}

.g-window {
    width: min(680px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: 18px;
    background: var(--g-bg-2);
    border: 1px solid var(--g-line);
    box-shadow: var(--g-shadow-lg);
    overflow: hidden;
}
.g-window.is-wide { width: min(920px, 100%); height: min(680px, 100%); }
.g-window.is-small { width: min(520px, 100%); }
.g-window.is-tiny { width: min(400px, 100%); }

.g-window-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--g-line);
}
.g-window-head h2 {
    margin-right: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--g-font-display);
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.01em;
}
.g-window-head h2 > .iconify { color: var(--g-muted); }
.g-window-body { padding: 16px; overflow-x: hidden; overflow-y: auto; }

.g-sec {
    background: var(--g-fill);
    border: 1px solid var(--g-line);
    border-radius: var(--g-radius);
    padding: 12px 14px;
}
.g-sec > header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--g-muted);
}
/* A second child is the header's right slot: a count, not another label. */
.g-sec > header > span + span {
    letter-spacing: 0;
    text-transform: none;
    font-weight: 600;
    font-size: 11.5px;
    color: var(--g-text-2);
}

.g-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--g-muted);
}

.g-copy { font-size: 13px; line-height: 1.55; color: var(--g-text-2); }
.g-actions { display: flex; justify-content: flex-end; gap: 8px; }

/* Label left, one number right — the figure every confirm modal shows. */
.g-stat {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--g-radius-sm);
    background: var(--g-fill);
    border: 1px solid var(--g-line);
}
.g-stat > b {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 17px;
    font-variant-numeric: tabular-nums;
}

.g-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--g-radius-sm);
    font-size: 13px;
}
.g-row:hover { background: var(--g-fill); }

.g-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 10px 6px;
    border-radius: var(--g-radius-sm);
    background: var(--g-fill);
    border: 1px solid var(--g-line);
    font-variant-numeric: tabular-nums;
}

.g-empty {
    padding: 12px;
    border: 1px dashed var(--g-line-2);
    border-radius: var(--g-radius-sm);
    font-size: 12px;
    color: var(--g-muted);
    text-align: center;
}

/* ── Buttons ────────────────────────────────────────────────────────────── */
.g-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 14px;
    border-radius: var(--g-radius-sm);
    font-weight: 600;
    font-size: 13px;
    background: var(--g-fill-2);
    border: 1px solid var(--g-line);
    color: var(--g-text);
    cursor: pointer;
    white-space: nowrap;
    transition: transform 0.1s ease, filter 0.15s ease, background 0.15s ease;
}
.g-btn:hover:not(:disabled) { filter: brightness(1.05); transform: translateY(-1px); }
.g-btn:active:not(:disabled) { transform: none; }
.g-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.g-btn-primary { background: var(--g-accent); border-color: transparent; color: var(--g-accent-fg); }
.g-btn-gold { background: var(--g-gold-bg); color: var(--g-gold); border-color: color-mix(in srgb, var(--g-gold) 40%, transparent); }
.g-btn-gem { background: var(--g-gem-bg); color: var(--g-gem); border-color: color-mix(in srgb, var(--g-gem) 40%, transparent); }
.g-btn-danger { background: var(--g-red-bg); color: var(--g-red); border-color: color-mix(in srgb, var(--g-red) 40%, transparent); }
.g-btn-ghost { background: transparent; border-color: transparent; color: var(--g-text-2); }
.g-btn-ghost:hover:not(:disabled) { background: var(--g-fill); }
.g-btn-sm { padding: 6px 10px; font-size: 12px; border-radius: var(--g-radius-xs); }
.g-btn-xs { padding: 4px 8px; font-size: 11px; border-radius: var(--g-radius-xs); }
/* Kept for the panels: a text-only danger action inside a list row. */
.g-btn-quiet-danger { background: transparent; border-color: transparent; color: var(--g-red); }
.g-btn-quiet-danger:hover:not(:disabled) { background: var(--g-red-bg); }

.g-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: var(--g-radius-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--g-fill);
    border: 1px solid var(--g-line);
    color: var(--g-text-2);
    font-size: 16px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}
.g-icon:hover { background: var(--g-fill-2); color: var(--g-text); }
.g-icon-sm { width: 28px; height: 28px; font-size: 14px; }
.g-icon.is-on { border-color: color-mix(in srgb, var(--g-accent) 55%, transparent); color: var(--g-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--g-accent) 20%, transparent); }
.g-icon.is-armed { border-color: color-mix(in srgb, var(--g-red) 60%, transparent); color: var(--g-red); box-shadow: 0 0 0 2px color-mix(in srgb, var(--g-red) 22%, transparent); }
.g-icon-danger { color: var(--g-red); }
/* The corner buttons float over the scene, so they carry the panel surface. */
.corner .g-icon { background: var(--g-bg); backdrop-filter: var(--g-blur); box-shadow: var(--g-shadow); }

/* ── Chips, tags, meters ────────────────────────────────────────────────── */
.g-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 12px;
    border-radius: var(--g-radius);
    background: var(--g-bg);
    border: 1px solid var(--g-line);
    backdrop-filter: var(--g-blur);
    box-shadow: var(--g-shadow);
    color: var(--g-text);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
}
.g-chip b { font-variant-numeric: tabular-nums; }
.g-chip-btn { cursor: pointer; }
.g-chip-btn:hover { background: var(--g-bg-2); }
.g-chip-btn.is-pinned { border-color: var(--g-line-2); background: var(--g-bg-2); }
.g-chip-warn { border-color: color-mix(in srgb, var(--g-warn) 55%, transparent); }
.g-chip-warn b { color: var(--g-warn); }
.g-chip-gold b { color: var(--g-gold); }
.g-chip-gem b { color: var(--g-gem); }
.g-chip-green b { color: var(--g-green); }
.g-ico { width: 15px; height: 15px; flex-shrink: 0; color: var(--g-muted); }
.g-chip .g-ico.is-green { color: var(--g-green); }

.g-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: var(--g-radius-xs);
    background: var(--g-fill-2);
    color: var(--g-text-2);
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
.g-tag-green { background: var(--g-green-bg); color: var(--g-green); }
.g-tag-red { background: var(--g-red-bg); color: var(--g-red); }
.g-tag-gold { background: var(--g-gold-bg); color: var(--g-gold); }
.g-tag-gem { background: var(--g-gem-bg); color: var(--g-gem); }
.g-tag-warn { background: var(--g-warn-bg); color: var(--g-warn); }

.g-meter {
    display: inline-block;
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: var(--g-fill-2);
    overflow: hidden;
}
.g-meter i { display: block; height: 100%; border-radius: 999px; background: var(--g-muted); transition: width 0.6s ease; }
.g-meter i.ok { background: var(--g-green); }
.g-meter i.meh { background: var(--g-warn); }
.g-meter i.bad { background: var(--g-red); }
.g-meter-lg { width: 90px; flex-shrink: 0; position: relative; overflow: visible; }
/* Specific enough to beat `[data-tip-below] { position: relative }`, which the
   mark carries and which would otherwise drop it back into the flow. */
.g-meter .g-meter-mark { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--g-line-2); }

.g-progress { height: 6px; border-radius: 999px; background: var(--g-fill-2); overflow: hidden; }
.g-progress i { display: block; height: 100%; border-radius: 999px; background: var(--g-accent); transition: width 0.4s linear; }
.g-progress i.ok { background: var(--g-green); }
.g-progress i.meh { background: var(--g-warn); }
.g-progress i.bad { background: var(--g-red); }

.g-input {
    height: 34px;
    padding: 0 10px;
    border-radius: var(--g-radius-sm);
    background: var(--g-fill);
    border: 1px solid var(--g-line);
    color: var(--g-text);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
}
.g-input::placeholder { color: var(--g-muted); }
.g-input:focus {
    outline: none;
    border-color: var(--g-line-2);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-accent) 25%, transparent);
}

.g-dot {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--g-red);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.town-root kbd,
.g-kbd {
    font: 600 10px/1 ui-monospace, SFMono-Regular, monospace;
    padding: 2px 4px;
    border-radius: 4px;
    background: var(--g-fill-2);
    border: 1px solid var(--g-line);
    color: var(--g-muted);
}

.g-spinner {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--g-line-2);
    border-top-color: var(--g-text);
    animation: g-spin 0.8s linear infinite;
}
.g-spinner-xs { width: 13px !important; height: 13px !important; }
@keyframes g-spin { to { transform: rotate(360deg); } }

/* Kept for the panels: a compact inline cost readout. */
.g-cost {
    display: inline-flex;
    gap: 8px;
    padding: 3px 8px;
    border-radius: var(--g-radius-xs);
    background: var(--g-fill);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

/* ── Tooltips ───────────────────────────────────────────────────────────── */
[data-tip],
[data-tip-below] { position: relative; }
[data-tip]::after,
[data-tip-below]::after {
    position: absolute;
    left: 50%;
    z-index: 40;
    width: max-content;
    max-width: 260px;
    padding: 7px 10px;
    border-radius: var(--g-radius-sm);
    background: var(--g-bg-2);
    border: 1px solid var(--g-line);
    color: var(--g-text);
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1.45;
    text-align: left;
    white-space: pre-line;
    box-shadow: var(--g-shadow);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease, transform 0.12s ease;
}
[data-tip]::after { content: attr(data-tip); bottom: calc(100% + 8px); transform: translate(-50%, 4px); }
[data-tip-below]::after { content: attr(data-tip-below); top: calc(100% + 8px); transform: translate(-50%, -4px); }
[data-tip]:hover::after,
[data-tip-below]:hover::after { opacity: 1; transform: translate(-50%, 0); transition-delay: 0.2s; }

/* ── Transitions ────────────────────────────────────────────────────────── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.rise-enter-active, .rise-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.rise-enter-from, .rise-leave-to { opacity: 0; transform: translate(-50%, 10px); }

/* ── Founding ───────────────────────────────────────────────────────────── */
.found-screen {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #a9d6ea;
}
.dark .found-screen { background: #16181d; }
.found-card {
    max-width: 420px;
    text-align: center;
    padding: 36px 32px;
    border-radius: 20px;
    background: var(--g-bg-2);
    border: 1px solid var(--g-line);
    box-shadow: var(--g-shadow-lg);
}
.found-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: var(--g-radius);
    background: var(--g-fill);
    border: 1px solid var(--g-line);
    color: var(--g-accent);
    font-size: 28px;
}
.found-title { margin-top: 14px; font-family: var(--g-font-display); font-size: 30px; font-weight: 600; letter-spacing: -0.02em; }
.found-copy { margin-top: 10px; font-size: 13.5px; line-height: 1.6; color: var(--g-text-2); }
.found-go { margin-top: 22px; padding: 11px 20px; font-size: 14px; }
.found-note { margin-top: 10px; font-size: 11.5px; color: var(--g-muted); }

/* ── HUD ────────────────────────────────────────────────────────────────── */
.hud { position: absolute; left: 14px; top: 14px; display: flex; flex-wrap: wrap; gap: 8px; z-index: 5; max-width: calc(100% - 250px); }
.corner { position: absolute; right: 14px; top: 14px; display: flex; gap: 8px; z-index: 5; }
.motion-frame { position: absolute; inset: 0; pointer-events: none; z-index: 2; box-shadow: inset 0 0 120px 30px rgba(10, 14, 20, 0.2); }
.mood-face { font-size: 16px; line-height: 1; }
.mood-face.is-lg { font-size: 24px; }

.moodpop {
    position: absolute;
    left: 0;
    top: calc(100% + 8px);
    z-index: 9;
    width: 360px;
    max-height: calc(100vh - 140px);
    overflow-y: auto;
    padding: 12px;
    border-radius: var(--g-radius);
    background: var(--g-bg-2);
    border: 1px solid var(--g-line);
    box-shadow: var(--g-shadow-lg);
    display: flex;
    flex-direction: column;
    gap: 10px;
}
/* A chip with a hover popover. The bridge under the chip keeps the popover
   open while the pointer crosses the gap; the popover itself clips, so it
   cannot carry the bridge. */
.hud-hover { position: relative; }
.hud-hover::after { content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 12px; }
.moodpop.is-income { width: 300px; }
.moodpop.is-builders { width: 320px; }
.moodpop-sub { margin-top: 2px; font-size: 11.5px; color: var(--g-muted); }
.moodpop-foot { font-size: 11px; color: var(--g-muted); }
.moodpop-group { display: flex; flex-direction: column; gap: 4px; }
.moodpop-head { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.moodpop-score { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--g-text-2); }
.moodpop-perks { display: flex; flex-wrap: wrap; gap: 6px; }
.moodpop-next { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; font-size: 11.5px; color: var(--g-text-2); }
.moodpop-next-perk { padding: 1px 6px; border-radius: var(--g-radius-xs); background: var(--g-fill); font-weight: 600; }

.rec-row {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border-radius: var(--g-radius-xs);
    background: var(--g-fill);
    border: 1px solid var(--g-line);
    color: var(--g-text);
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
}
.rec-row:hover:not(:disabled) { background: var(--g-fill-2); border-color: var(--g-line-2); }
/* A job under way: the same row, but nothing to click and a bar instead of a cost. */
.job-row {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border-radius: var(--g-radius-xs);
    background: var(--g-fill);
    border: 1px solid var(--g-line);
}
.job-head { display: flex; align-items: center; gap: 6px; }
.job-head b { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 600; }
.job-time { font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--g-text-2); }
.job-bar { height: 4px; margin-top: 3px; }
.rec-row:disabled { cursor: not-allowed; }
.rec-row.is-dim { opacity: 0.55; }
.rec-art { font-size: 12px; line-height: 1; }
.rec-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.rec-main b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 600; }
.rec-meta { display: flex; align-items: center; gap: 5px; }
.rec-level { font-size: 10.5px; color: var(--g-muted); font-variant-numeric: tabular-nums; }
.rec-meta .g-tag { padding: 1px 5px; font-size: 10px; }
.rec-cost { display: flex; flex-wrap: wrap; justify-content: flex-end; max-width: 130px; gap: 2px 7px; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.rec-cost > span { display: inline-flex; align-items: center; gap: 3px; }

.income-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; padding: 3px 6px; border-radius: var(--g-radius-xs); font-size: 12px; }
.income-row:hover { background: var(--g-fill); }
.income-row b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.income-ico { font-size: 12px; line-height: 1; }
.income-rate { font-size: 11px; color: var(--g-muted); font-variant-numeric: tabular-nums; }
.income-value { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; min-width: 78px; font-size: 13px; font-weight: 650; color: var(--g-gold); font-variant-numeric: tabular-nums; }
.income-row.is-total { grid-template-columns: 1fr auto; margin-top: 2px; padding-top: 7px; border-top: 1px solid var(--g-line); }
.income-row.is-total:hover { background: none; }

.score-row { display: grid; grid-template-columns: 14px 86px 1fr auto; align-items: center; gap: 8px; padding: 4px 6px; border-radius: var(--g-radius-xs); font-size: 12px; }
.score-row.is-plus { background: var(--g-green-bg); }
.score-row.is-minus { background: var(--g-red-bg); }
.score-row b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.score-ico { width: 14px; height: 14px; color: var(--g-muted); }
.score-hint { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--g-muted); }
.score-points { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.score-row.is-plus .score-points { color: var(--g-green); }
.score-row.is-minus .score-points { color: var(--g-red); }

.needs-row { display: grid; grid-template-columns: 18px 76px 1fr 34px; align-items: center; gap: 8px; padding: 4px 6px; border-radius: var(--g-radius-xs); font-size: 12px; }
.needs-row.is-ok { background: var(--g-green-bg); }
.needs-row.is-bad { background: var(--g-red-bg); }
.needs-ico { font-size: 12px; line-height: 1; }
.needs-note { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--g-muted); }
.needs-badge { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.needs-row.is-ok .needs-badge { color: var(--g-green); }
.needs-row.is-bad .needs-badge { color: var(--g-red); }

/* ── Placement hint ─────────────────────────────────────────────────────── */
.hint {
    position: absolute;
    left: 50%;
    top: 70px;
    transform: translateX(-50%);
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--g-bg);
    border: 1px solid var(--g-line);
    backdrop-filter: var(--g-blur);
    box-shadow: var(--g-shadow);
    font-size: 12.5px;
    white-space: nowrap;
}
.hint.is-danger { border-color: color-mix(in srgb, var(--g-red) 55%, transparent); color: var(--g-red); }
.hint-note { color: var(--g-muted); }
.hint-quote { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: var(--g-gold-bg); color: var(--g-gold); font-weight: 600; font-variant-numeric: tabular-nums; }
.hint-btn { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: var(--g-radius-xs); background: var(--g-fill); color: var(--g-text-2); font-size: 11px; cursor: pointer; }
.hint-btn:hover { background: var(--g-fill-2); color: var(--g-text); }

/* ── Inventory ──────────────────────────────────────────────────────────── */
.inv {
    position: absolute;
    left: 14px;
    top: 62px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    z-index: 4;
    max-height: calc(100% - 180px);
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: none;
    padding-right: 2px;
}
.inv::-webkit-scrollbar { display: none; }
.inv-row {
    display: grid;
    grid-template-columns: 18px 46px 1fr;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 9px;
    border-radius: var(--g-radius-sm);
    /* Opaque on purpose: blurred grass behind a translucent row reads as a green stain. */
    background: var(--g-bg-2);
    border: 1px solid var(--g-line);
    box-shadow: var(--g-shadow);
    font-size: 12.5px;
    text-align: left;
    color: var(--g-text);
    cursor: pointer;
}
.inv-row:hover { background: var(--g-bg-2); }
.inv-ico { font-size: 12px; line-height: 1; }
.inv-num { font-weight: 650; font-variant-numeric: tabular-nums; }
.inv-row.is-full .inv-num { color: var(--g-gold); }
.inv-tail { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; }
.inv-full { width: 11px; height: 11px; flex-shrink: 0; color: var(--g-gold); }
.inv-rate { font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; }
.inv-rate.up { color: var(--g-green); }
.inv-rate.down { color: var(--g-red); }

/* ── Cursor tooltips ────────────────────────────────────────────────────── */
/* Driven by --cursor-x/--cursor-y so a mousemove never re-renders the game. */
.tip {
    position: fixed;
    z-index: 30;
    pointer-events: none;
    padding: 7px 10px;
    border-radius: var(--g-radius-sm);
    background: var(--g-bg-2);
    border: 1px solid var(--g-line);
    box-shadow: var(--g-shadow);
    font-size: 12px;
    max-width: 260px;
}
.tip.is-cursor { left: var(--cursor-x, 0px); top: var(--cursor-y, 0px); }
.tip b { display: inline-flex; align-items: center; gap: 5px; }
.tip-sub { display: flex; align-items: center; gap: 5px; margin-top: 2px; font-size: 11.5px; color: var(--g-text-2); }
.tip-bad { display: inline-flex; align-items: center; gap: 5px; color: var(--g-red); font-weight: 600; }

/* ── Selection toolbar ──────────────────────────────────────────────────── */
.seltoolbar {
    position: absolute;
    left: 50%;
    bottom: 112px;
    transform: translateX(-50%);
    z-index: 6;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px;
    max-width: calc(100% - 28px);
    background: var(--g-bg);
    border: 1px solid var(--g-line);
    backdrop-filter: var(--g-blur);
    box-shadow: var(--g-shadow);
    border-radius: var(--g-radius);
}
.seltoolbar-count { padding: 0 4px; font-size: 12.5px; font-variant-numeric: tabular-nums; }

/* ── Selected building card ─────────────────────────────────────────────── */
.card {
    position: absolute;
    left: 50%;
    bottom: 112px;
    transform: translateX(-50%);
    z-index: 6;
    width: min(560px, calc(100% - 28px));
}
.card-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--g-line); }
.card-art {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: var(--g-radius-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
}
.card-title { display: flex; align-items: center; gap: 8px; }
.card-title b { font-family: var(--g-font-display); font-size: 16px; }
.card-desc { margin-top: 1px; font-size: 11.5px; line-height: 1.4; color: var(--g-muted); }
.card-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 9px; }
.card-row { display: flex; align-items: center; gap: 10px; }
.card-progress-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 5px; font-size: 12px; font-variant-numeric: tabular-nums; }
.card-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.card-actions { display: flex; gap: 8px; }
.card-maxed { justify-content: center; padding: 6px; }
.card-note { display: flex; align-items: flex-start; gap: 6px; font-size: 11.5px; line-height: 1.45; color: var(--g-red); }
.card-note > .iconify { flex-shrink: 0; margin-top: 2px; }
.card-alert {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 9px 11px;
    border-radius: var(--g-radius-sm);
    background: var(--g-red-bg);
    border: 1px solid color-mix(in srgb, var(--g-red) 40%, transparent);
    color: var(--g-red);
    font-size: 12px;
    line-height: 1.45;
}
.card-alert > .iconify { flex-shrink: 0; margin-top: 1px; font-size: 15px; }

.recipe { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.recipe-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border-radius: var(--g-radius-xs);
    font-size: 12.5px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
}
.recipe-item.is-in { background: var(--g-fill-2); color: var(--g-text-2); }
.recipe-item.is-out { background: var(--g-green-bg); color: var(--g-green); }
.recipe-arrow { color: var(--g-muted); }
.recipe-unit { font-size: 11px; color: var(--g-muted); cursor: help; }

.meters { display: flex; flex-direction: column; gap: 6px; }
.meter { display: grid; grid-template-columns: 14px 92px 1fr 38px; align-items: center; gap: 8px; font-size: 12px; cursor: help; }
.meter-ico { width: 14px; height: 14px; color: var(--g-muted); }
.meter-label { color: var(--g-muted); white-space: nowrap; }
.meter-label em { font-style: normal; font-weight: 650; color: var(--g-text-2); }
.meter-value { text-align: right; font-weight: 650; font-variant-numeric: tabular-nums; }

.upgrade {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 8px 8px 11px;
    border-radius: var(--g-radius-sm);
    background: var(--g-fill);
    border: 1px solid var(--g-line);
}
.upgrade-faces { flex: 1; min-width: 0; display: grid; }
.upgrade-info { grid-area: 1 / 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.upgrade-info.is-hidden { visibility: hidden; pointer-events: none; }
.upgrade-head { display: flex; align-items: center; gap: 8px; min-height: 18px; }
.upgrade-head .g-sub { display: inline-flex; align-items: center; gap: 4px; }
.upgrade-cost { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; }
.upgrade-cost span { display: inline-flex; align-items: center; gap: 4px; }
.preview-from { color: var(--g-muted); }
.preview-up { color: var(--g-green); }
.preview-more { color: var(--g-warn); }
.preview-label { font-style: normal; font-weight: 500; color: var(--g-muted); }

/* ── Build strip ────────────────────────────────────────────────────────── */
.strip {
    position: absolute;
    left: 50%;
    bottom: 112px;
    transform: translateX(-50%);
    z-index: 6;
    width: min(1040px, calc(100% - 28px));
}
.strip-tabs { display: flex; align-items: center; gap: 4px; padding: 9px 10px 0; overflow-x: auto; scrollbar-width: none; }
.strip-tabs::-webkit-scrollbar { display: none; }
.strip-tab {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
    padding: 5px 11px;
    border-radius: var(--g-radius-xs);
    font-size: 12px;
    font-weight: 600;
    color: var(--g-muted);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
}
.strip-tab:hover { color: var(--g-text); }
.strip-tab.is-active { background: var(--g-fill-2); border-color: var(--g-line); color: var(--g-text); }
.strip-tab.is-locked { opacity: 0.6; }
.strip-lock { display: flex; align-items: center; gap: 6px; padding: 7px 12px 0; font-size: 11.5px; color: var(--g-warn); }
.strip-cards { display: flex; align-items: stretch; gap: 9px; padding: 10px; overflow-x: auto; overflow-y: visible; scrollbar-width: thin; }

.bcard {
    position: relative;
    flex: 0 0 148px;
    min-height: 176px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 12px 10px 10px;
    border-radius: var(--g-radius-sm);
    background: var(--g-fill);
    border: 1px solid var(--g-line);
    color: var(--g-text);
    cursor: pointer;
    overflow: hidden;
    text-align: center;
    transition: transform 0.1s ease, background 0.15s ease, border-color 0.15s ease;
}
/* One 3px bar in the building's own colour instead of a glow. */
.bcard::before { content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: var(--accent); }
.bcard:hover:not(:disabled) { transform: translateY(-2px); background: var(--g-fill-2); }
.bcard.is-active { border-color: var(--g-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--g-accent) 30%, transparent); }
.bcard.is-dim { opacity: 0.55; }
.bcard:disabled { cursor: not-allowed; filter: grayscale(1); }
.bcard-count { position: absolute; right: 8px; top: 8px; font-size: 10px; font-weight: 600; color: var(--g-muted); font-variant-numeric: tabular-nums; }
.bcard-art { display: inline-flex; align-items: center; justify-content: center; height: 52px; font-size: 28px; line-height: 1; color: var(--g-text-2); }
.bcard-name { font-size: 13px; font-weight: 600; }
.bcard-cost { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 650; color: var(--g-gold); font-variant-numeric: tabular-nums; }
.bcard-res { display: flex; gap: 7px; font-size: 11px; font-weight: 600; color: var(--g-text-2); font-variant-numeric: tabular-nums; }
.bcard-res span, .bcard-io span { display: inline-flex; align-items: center; gap: 3px; }
.bcard-meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 3px 7px; font-size: 10px; color: var(--g-muted); font-variant-numeric: tabular-nums; }
.bcard-meta span { display: inline-flex; align-items: center; gap: 3px; }
.bcard-io { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: var(--g-text-2); font-variant-numeric: tabular-nums; }
.bcard-io .is-out { color: var(--g-green); }

/* ── Terrain legend ─────────────────────────────────────────────────────── */
.legend { position: absolute; left: 14px; bottom: 16px; z-index: 6; width: 220px; display: flex; flex-direction: column; gap: 2px; padding: 10px; }
.legend-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.legend-row { display: grid; grid-template-columns: 10px 1fr auto; gap: 8px; align-items: center; padding: 4px 6px; border-radius: var(--g-radius-xs); border: 1px solid transparent; }
.legend-row i { width: 10px; height: 10px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25); }
.legend-row b { font-size: 12px; font-weight: 600; }
.legend-row span { font-size: 10.5px; text-align: right; color: var(--g-muted); }
.legend-row.is-boosting { background: var(--g-fill-2); border-color: var(--g-line-2); }

/* ── Dock ───────────────────────────────────────────────────────────────── */
.dock {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    z-index: 25;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px;
    border-radius: 18px;
}
.dock-btn {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    width: 72px;
    padding: 8px 4px 6px;
    border-radius: var(--g-radius-sm);
    background: transparent;
    border: 1px solid transparent;
    color: var(--g-text-2);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}
.dock-btn > span { font-size: 11px; }
.dock-btn:hover { background: var(--g-fill); color: var(--g-text); }
.dock-btn.is-active { background: var(--g-fill-2); border-color: var(--g-line); color: var(--g-text); }
.dock-btn.is-active .dock-ico { color: var(--g-accent); }
.dock-ico { width: 20px; height: 20px; margin-top: 4px; color: var(--g-muted); }
.dock-btn:hover .dock-ico { color: var(--g-text); }
.dock-btn kbd { position: absolute; right: 4px; top: 4px; padding: 1px; font-size: 9px; border: 0; background: transparent; }
.dock-dot { position: absolute; left: 8px; top: 8px; width: 6px; height: 6px; border-radius: 50%; background: var(--g-green); }
.dock-badge {
    position: absolute;
    left: 50%;
    top: 2px;
    transform: translateX(4px);
    min-width: 17px;
    height: 17px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--g-accent);
    color: var(--g-accent-fg);
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* ── Land window ────────────────────────────────────────────────────────── */
.plotrow { border: 1px solid var(--g-line); background: var(--g-bg-2); }
.plotrow:hover { background: var(--g-bg-2); border-color: var(--g-line-2); }
.plotrow + .plotrow { margin-top: 5px; }
.plot-ico { width: 16px; height: 16px; flex-shrink: 0; color: var(--g-muted); }
.plotrow-sub { font-size: 11px; color: var(--g-muted); }
.plotrow-sub.is-gold { color: var(--g-gold); }
.plotrow-price { display: inline-flex; align-items: center; gap: 4px; color: var(--g-gold); font-variant-numeric: tabular-nums; }

/* ── Modals ─────────────────────────────────────────────────────────────── */
/* The dock sits along the bottom edge, so leave it room: a window that
   reaches under it hides its own footer. */
.backdrop {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 24px 116px;
    background: rgba(40, 32, 16, 0.32);
    backdrop-filter: blur(3px);
}
.dark .backdrop { background: rgba(4, 6, 10, 0.5); }

.welcome-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.welcome-art { font-size: 22px; line-height: 1; }
.welcome-worth { text-align: center; font-size: 12.5px; color: var(--g-text-2); }
.welcome-worth b { display: inline-flex; align-items: center; gap: 4px; color: var(--g-gold); }
.blocked-art { font-size: 16px; line-height: 1; }

/* ── Help ───────────────────────────────────────────────────────────────── */
.help dl { display: grid; grid-template-columns: 112px 1fr; gap: 6px 12px; align-items: baseline; }
.help dt { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 650; color: var(--g-text); }
.help dt > .iconify { color: var(--g-muted); flex-shrink: 0; }
.help dd { font-size: 12.5px; line-height: 1.5; color: var(--g-text-2); }
.help-keys { font-size: 12px; line-height: 1.9; color: var(--g-text-2); }
.help-keys kbd { margin-right: 2px; }
@media (max-width: 520px) {
    .help dl { grid-template-columns: 1fr; gap: 2px; }
    .help dd { margin-bottom: 8px; }
}
</style>
