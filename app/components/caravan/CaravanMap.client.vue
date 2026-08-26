<script setup lang="ts">
import { Application, Container, Graphics, Text } from 'pixi.js'
import {
    CATEGORY_COLORS, RESOURCES, ROAD_COLORS, ROAD_LINKED_COLOR, ROAD_UNLINKED_COLOR, TIERS
} from '#shared/utils/caravan/config'
import { nodeRichness } from '#shared/utils/caravan/sim'
import type { CaravanState, NodeId, World, WorldNode } from '#shared/utils/caravan/types'

/**
 * The world map.
 *
 * Everything here is driven off one state snapshot plus the wall clock. A worker
 * in transit carries the timestamp it left and the timestamp it arrives, so its
 * position on any given frame is a plain interpolation -- the map animates at 60
 * fps while the server is only spoken to when something actually completes.
 */

const props = defineProps<{
    world: World
    state: CaravanState | null
    serverNow: () => number
    selectedNode: NodeId | null
    selectedEdge: string | null
    /** Nodes the search is pointing at. They get a pulsing ring and a label. */
    highlight?: NodeId[]
}>()

const emit = defineEmits<{
    selectNode: [id: NodeId]
    selectEdge: [id: string]
    clearSelection: []
    hoverNode: [value: { id: NodeId, x: number, y: number } | null]
}>()

const host = ref<HTMLElement | null>(null)
let app: Application | null = null
let resizeObserver: ResizeObserver | null = null
let camera: Container | null = null
let backdropLayer: Graphics | null = null
let roadLayer: Graphics | null = null
let roadHitLayer: Container | null = null
let nodeLayer: Container | null = null
let workerLayer: Graphics | null = null
let auraLayer: Graphics | null = null

/**
 * Which of its tier's three raw resources a node yields, so the inner mark can
 * differ per resource. A map where every node is the same dot tells you nothing
 * about what you are looking at.
 */
function resourceSlot(node: WorldNode): number {
    if (!node.resource) return -1
    const def = TIERS[node.tier - 1]
    return def ? def.raw.indexOf(node.resource) : -1
}

/**
 * The mark is coloured by trade rather than by tier, so timber reads as timber
 * everywhere on the map. Shape distinguishes the three seams within a trade;
 * colour distinguishes the trades. Between them you can read the whole map
 * without hovering a single node.
 */
function glyphColor(node: WorldNode): number {
    const category = node.resource ? RESOURCES[node.resource]?.category : undefined
    return category ? hex(CATEGORY_COLORS[category]) : hex(tierColor(node.tier))
}

/** Draw the mark for a resource slot: circle, square or diamond. */
function drawGlyph(g: Graphics, slot: number, size: number, color: number, alpha: number) {
    if (slot === 1) {
        g.rect(-size * 0.85, -size * 0.85, size * 1.7, size * 1.7).fill({ color, alpha })
    } else if (slot === 2) {
        g.regularPoly(0, 0, size * 1.15, 4, Math.PI / 4).fill({ color, alpha })
    } else {
        g.circle(0, 0, size).fill({ color, alpha })
    }
}

const tierColor = (tier: number) => TIERS[Math.min(TIERS.length, Math.max(1, tier)) - 1]!.color
const tierGlow = (tier: number) => TIERS[Math.min(TIERS.length, Math.max(1, tier)) - 1]!.glow
const hex = (css: string) => Number.parseInt(css.replace('#', ''), 16)

/**
 * Below this zoom the map is being read as a whole rather than node by node, and
 * 120 name labels turn it into soup. Owned nodes keep their labels longer than
 * the rest, because those are the ones you are actually steering.
 */
const LABEL_ZOOM = 0.28
/** Half-width of a road's clickable strip, in world units. */
const ROAD_HIT_WIDTH = 9
const LABEL_ZOOM_UNOWNED = 0.4

const owned = computed(() => new Set(props.state?.ownedNodes ?? []))
const cleared = computed(() => new Set(props.state?.clearedCamps ?? []))
const passable = computed(() => new Set([...owned.value, ...cleared.value]))
const playerTier = computed(() => props.state?.tier ?? 1)

/** A node is worth showing in full colour once it borders your territory. */
function isFrontier(node: WorldNode): boolean {
    if (passable.value.has(node.id)) return true
    return props.world.edges.some(e =>
        (e.a === node.id && passable.value.has(e.b)) || (e.b === node.id && passable.value.has(e.a))
    )
}

// --- camera -----------------------------------------------------------------

const view = reactive({ x: 0, y: 0, scale: 0.55 })
let dragging = false
let dragMoved = 0
let last = { x: 0, y: 0 }

function applyCamera() {
    if (!camera || !app) return
    camera.scale.set(view.scale)
    camera.position.set(app.renderer.width / 2 + view.x, app.renderer.height / 2 + view.y)
}

function fitToTerritory() {
    if (!props.state) return
    frame(props.world.nodes.filter(n => passable.value.has(n.id)))
}

/** Frame an arbitrary set of nodes -- used by the search to show every match. */
function frameNodes(ids: NodeId[]) {
    const set = new Set(ids)
    frame(props.world.nodes.filter(n => set.has(n.id)))
}

function frame(nodes: WorldNode[]) {
    if (!app || !nodes.length) return
    const xs = nodes.map(n => n.x)
    const ys = nodes.map(n => n.y)
    // Pad generously: with a single capital owned, the interesting part of the
    // map is the ring of nodes around it, not the capital itself.
    const pad = nodes.length > 1 ? 380 : 430
    const minX = Math.min(...xs) - pad
    const maxX = Math.max(...xs) + pad
    const minY = Math.min(...ys) - pad
    const maxY = Math.max(...ys) + pad
    const scale = Math.min(
        app.renderer.width / (maxX - minX),
        app.renderer.height / (maxY - minY)
    )
    view.scale = Math.max(0.12, Math.min(1.6, scale))
    view.x = -((minX + maxX) / 2) * view.scale
    view.y = -((minY + maxY) / 2) * view.scale
    applyCamera()
}

defineExpose({ fitToTerritory, focusNode, frameNodes })

const highlighted = computed(() => new Set(props.highlight ?? []))

function focusNode(id: NodeId) {
    const node = props.world.nodes.find(n => n.id === id)
    if (!node) return
    view.scale = Math.max(view.scale, 0.7)
    view.x = -node.x * view.scale
    view.y = -node.y * view.scale
    applyCamera()
}

// --- static layers ----------------------------------------------------------

/**
 * Tier rings under everything else. They turn an otherwise featureless void into
 * a map you can read at a glance: how far out a node sits tells you its tier.
 */
function drawBackdrop() {
    if (!backdropLayer) return
    backdropLayer.clear()
    for (const def of TIERS) {
        const radius = 250 * Math.pow(def.tier, 1.06)
        const reached = playerTier.value >= def.tier
        backdropLayer
            .circle(0, 0, radius)
            .stroke({ width: 1, color: hex(def.color), alpha: reached ? 0.1 : 0.045 })
    }
}

function drawRoads() {
    if (!roadLayer || !roadHitLayer) return
    roadLayer.clear()
    roadHitLayer.removeChildren()
    for (const edge of props.world.edges) {
        const a = props.world.nodes[edge.a]!
        const b = props.world.nodes[edge.b]!
        const level = props.state?.roads[edge.id] ?? 0
        const linked = passable.value.has(edge.a) && passable.value.has(edge.b)
        const touched = passable.value.has(edge.a) || passable.value.has(edge.b)
        if (!touched) continue

        // A track between two nodes you hold is yours; one dangling off the edge
        // of your territory is scenery. Colouring those the same made the shape
        // of the network you had actually bought impossible to see.
        const color = !linked
            ? hex(ROAD_UNLINKED_COLOR)
            : level === 0
                ? hex(ROAD_LINKED_COLOR)
                : hex(ROAD_COLORS[Math.min(ROAD_COLORS.length - 1, level)]!)

        // Each stage of road gets its own treatment rather than just a thicker
        // line: a dirt track is a hairline, a causeway is a bordered double
        // carriageway. Paving is expensive, so it should visibly change the map.
        if (!linked) {
            roadLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color, alpha: 0.5 })
        } else if (level === 0) {
            roadLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2.2, color, alpha: 0.55 })
        } else if (level === 1) {
            roadLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2.4, color, alpha: 0.42 })
        } else if (level === 2) {
            // A darker verge under a brighter surface reads as a built road.
            roadLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 4.6, color: 0x0b0d11, alpha: 0.55 })
            roadLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 3, color, alpha: 0.6 })
        } else {
            // Levels 3 and 4 split into two carriageways with a marked centre.
            const dx = b.x - a.x
            const dy = b.y - a.y
            const length = Math.max(1, Math.hypot(dx, dy))
            const nx = -dy / length
            const ny = dx / length
            const gap = level === 3 ? 1.9 : 2.8
            const lane = level === 3 ? 2.2 : 2.8

            roadLayer.moveTo(a.x, a.y).lineTo(b.x, b.y)
                .stroke({ width: gap * 2 + lane * 2 + 2.4, color: 0x0b0d11, alpha: 0.6 })
            for (const side of [-1, 1]) {
                roadLayer
                    .moveTo(a.x + nx * gap * side, a.y + ny * gap * side)
                    .lineTo(b.x + nx * gap * side, b.y + ny * gap * side)
                    .stroke({ width: lane, color, alpha: 0.75 })
            }
            if (level === 4) {
                // A causeway gets a bright median and a faint glow along its length.
                roadLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 0.9, color: 0xffffff, alpha: 0.35 })
                roadLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 12, color, alpha: 0.07 })
            }
        }

        if (props.selectedEdge === edge.id) {
            roadLayer.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 10, color: 0xffffff, alpha: 0.12 })
        }

        // A hairline is impossible to hit with a mouse, so every road carries an
        // invisible strip wide enough to click. It sits under the node layer, so
        // a road ending at a node never steals that node's click.
        const dx = b.x - a.x
        const dy = b.y - a.y
        const span = Math.max(1, Math.hypot(dx, dy))
        const nx = (-dy / span) * ROAD_HIT_WIDTH
        const ny = (dx / span) * ROAD_HIT_WIDTH
        const hit = new Graphics()
        hit.poly([
            a.x + nx, a.y + ny,
            b.x + nx, b.y + ny,
            b.x - nx, b.y - ny,
            a.x - nx, a.y - ny
        ]).fill({ color: 0xffffff, alpha: 0.001 })
        hit.eventMode = 'static'
        hit.cursor = 'pointer'
        hit.on('pointertap', () => { if (dragMoved < 6) emit('selectEdge', edge.id) })
        roadHitLayer.addChild(hit)
    }
}

function drawNodes() {
    if (!nodeLayer) return
    nodeLayer.removeChildren()

    for (const node of props.world.nodes) {
        const frontier = isFrontier(node)
        // A search hit is drawn in full even out in the fog: the whole point of
        // searching a resource is to find where it is before you can reach it.
        const isHit = highlighted.value.has(node.id)
        const dimmed = highlighted.value.size > 0 && !isHit
        // Distant tiers stay on the map as faint markers. Seeing the road ahead
        // is most of what makes a map feel like a world rather than a menu.
        const fogged = !frontier && !isHit && node.tier > playerTier.value + 1
        const isOwned = owned.value.has(node.id)
        const isCleared = cleared.value.has(node.id)
        const container = new Container()
        container.position.set(node.x, node.y)
        container.eventMode = 'static'
        container.cursor = 'pointer'
        if (fogged) container.alpha = 0.3
        else if (dimmed) container.alpha = 0.22
        container.on('pointertap', () => { if (dragMoved < 6) emit('selectNode', node.id) })
        // Hovering gives the summary without committing to opening the drawer,
        // which matters once you are scanning twenty nodes for the good one.
        container.on('pointerover', (event) => {
            container.scale.set(1.12)
            emit('hoverNode', { id: node.id, x: event.global.x, y: event.global.y })
        })
        container.on('pointerout', () => {
            container.scale.set(1)
            emit('hoverNode', null)
        })

        const g = new Graphics()
        const color = hex(tierColor(node.tier))
        const glow = hex(tierGlow(node.tier))
        const radius = node.kind === 'capital' ? 26 : node.kind === 'camp' ? 20 : 17

        if (fogged) {
            g.circle(0, 0, 5).fill({ color: glyphColor(node), alpha: 0.55 })
            container.addChild(g)
            nodeLayer.addChild(container)
            continue
        }

        // A single soft halo. Two stacked ones read as bloom, not depth. Owned
        // nodes carry a much stronger one -- which of these hundred and twenty
        // dots are actually yours is the question the map is asked most often.
        g.circle(0, 0, radius + 14).fill({ color: glow, alpha: isOwned ? 0.22 : frontier ? 0.04 : 0.015 })

        if (node.kind === 'camp' && !isCleared) {
            // Camps are drawn as a spiked ring so they read as a wall, not a prize.
            g.regularPoly(0, 0, radius, 3, Math.PI / 2).fill({ color: 0x2a0f14, alpha: 0.95 })
            g.regularPoly(0, 0, radius, 3, Math.PI / 2).stroke({ width: 3, color: 0xe0384f, alpha: 0.9 })
        } else if (node.kind === 'capital') {
            g.circle(0, 0, radius).fill({ color: 0x14171d, alpha: 0.98 })
            if (isOwned) g.circle(0, 0, radius).fill({ color, alpha: 0.3 })
            g.circle(0, 0, radius).stroke({ width: isOwned ? 4 : 2, color: isOwned ? glow : 0x555b66, alpha: isOwned ? 1 : 0.5 })
            g.regularPoly(0, 0, radius * 0.52, 4, Math.PI / 4).fill({ color: isOwned ? glow : 0x555b66, alpha: isOwned ? 1 : 0.7 })
        } else {
            // Yours is filled and brightly ringed; everything else is a hollow
            // outline. A four-pixel stroke against a two-and-a-half pixel one
            // was not a difference anybody could see at map zoom.
            g.circle(0, 0, radius).fill({ color: 0x12151b, alpha: 0.98 })
            if (isOwned) g.circle(0, 0, radius).fill({ color, alpha: 0.3 })
            g.circle(0, 0, radius).stroke({
                width: isOwned ? 4 : 2,
                color: isOwned ? glow : frontier ? 0x767d8a : 0x3d434c,
                alpha: isOwned ? 1 : frontier ? 0.7 : 0.45
            })
            const slot = resourceSlot(node)
            const mark = glyphColor(node)
            if (isOwned) {
                drawGlyph(g, slot, radius * 0.44, mark, 0.95)
            } else if (frontier) {
                // A small mark shows what the seam yields before you buy it.
                drawGlyph(g, slot, radius * 0.26, mark, 0.75)
            } else {
                drawGlyph(g, slot, radius * 0.18, mark, 0.4)
            }

            // Gem seams are the only source of gems in the world, so they get a
            // ring of their own rather than blending into the other nodes.
            if (node.gemYield) {
                g.circle(0, 0, radius + 4).stroke({ width: 1.5, color: hex(CATEGORY_COLORS.gem), alpha: 0.85 })
            }
        }

        // An outer band on everything you hold, capitals included, so ownership
        // survives being read at a glance from across the map.
        if (isOwned) {
            g.circle(0, 0, radius + 4.5).stroke({ width: 1.5, color: glow, alpha: 0.4 })
        }

        if (props.selectedNode === node.id) {
            g.circle(0, 0, radius + 9).stroke({ width: 2, color: 0xffffff, alpha: 0.75 })
        }

        // Search hits get a ring in their own trade colour, so "every iron seam"
        // reads as one shape spread across the map rather than a list of names.
        if (isHit) {
            const mark = glyphColor(node)
            g.circle(0, 0, radius + 12).stroke({ width: 3, color: mark, alpha: 0.9 })
            g.circle(0, 0, radius + 20).fill({ color: mark, alpha: 0.1 })
        }

        container.addChild(g)

        // Depletion ring, drawn only once a seam has actually been worked into.
        // A full node needs no annotation, and leaving it off means the rings
        // you do see are the ones asking for attention.
        if (isOwned && node.kind === 'resource' && props.state) {
            const richness = nodeRichness(props.state, node, props.serverNow())
            if (richness < 0.97) {
                const ring = new Graphics()
                ring.arc(0, 0, radius + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * richness)
                    .stroke({ width: 2, color: richness > 0.5 ? 0x4ade80 : richness > 0.25 ? 0xfbbf24 : 0xef4444, alpha: 0.7 })
                container.addChild(ring)
            }
        }

        // How many workers are posted here. Since nobody is posted anywhere
        // without the player saying so, an owned seam with nobody on it is the
        // thing most worth spotting -- so it gets an amber zero rather than no
        // badge at all, and a crowded seam still reads at a glance.
        const assigned = (props.state?.workers ?? []).filter(w => w.assignment === node.id).length
        const staffable = isOwned && node.kind === 'resource'
        if (assigned > 0 || staffable) {
            const tint = assigned > 0 ? glow : 0xfbbf24
            const badge = new Graphics()
            badge.circle(radius - 2, -radius + 2, 9).fill({ color: 0x0b0d11, alpha: 0.95 })
            badge.circle(radius - 2, -radius + 2, 9).stroke({ width: 1.5, color: tint, alpha: 0.9 })
            container.addChild(badge)

            const count = new Text({
                text: String(assigned),
                style: { fontSize: 11, fontFamily: 'ui-monospace, monospace', fill: tint, fontWeight: 'bold' }
            })
            count.anchor.set(0.5)
            count.position.set(radius - 2, -radius + 2)
            container.addChild(count)
        }

        if (isHit || view.scale >= (isOwned ? LABEL_ZOOM : LABEL_ZOOM_UNOWNED)) {
            const label = new Text({
                text: node.name,
                style: {
                    fontSize: 14,
                    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                    fill: isHit ? glyphColor(node) : isOwned ? 0xe5e7eb : frontier ? 0x9ca3af : 0x555a63,
                    align: 'center'
                }
            })
            label.anchor.set(0.5, 0)
            label.position.set(0, radius + 12)
            container.addChild(label)
        }

        nodeLayer.addChild(container)
    }
}

// --- animated layer ---------------------------------------------------------

/**
 * Ripples fired when a delivery lands. Purely cosmetic, but it is the only thing
 * on screen that marks the moment a trip actually pays -- without it the map is
 * just dots drifting around.
 */
const ripples: { x: number, y: number, start: number, color: number }[] = []

watch(() => props.state?.stats.tripsCompleted, (now, before) => {
    if (before === undefined || now === undefined || now <= before) return
    for (const id of props.state?.capitals ?? []) {
        const node = props.world.nodes[id]
        if (!node) continue
        ripples.push({ x: node.x, y: node.y, start: performance.now(), color: hex(tierGlow(node.tier)) })
    }
})

function drawRipples(frame: number) {
    if (!auraLayer) return
    for (let i = ripples.length - 1; i >= 0; i--) {
        const ripple = ripples[i]!
        const age = (frame - ripple.start) / 900
        if (age >= 1) {
            ripples.splice(i, 1)
            continue
        }
        auraLayer
            .circle(ripple.x, ripple.y, 26 + age * 52)
            .stroke({ width: 1.5 * (1 - age), color: ripple.color, alpha: 0.22 * (1 - age) })
    }
}

function drawWorkers(now: number) {
    if (!workerLayer || !auraLayer || !props.state) return
    workerLayer.clear()
    auraLayer.clear()

    // Spread workers sitting on the same node around a small ring so a stack of
    // six idle haulers still reads as six dots.
    const atNode = new Map<NodeId, number>()

    for (const worker of props.state.workers) {
        const activity = worker.activity
        let x = 0
        let y = 0

        if (activity.type === 'travel') {
            const from = props.world.nodes[activity.from]
            const to = props.world.nodes[activity.to]
            if (!from || !to) continue
            const span = Math.max(1, activity.arrivesAt - activity.startedAt)
            const t = Math.max(0, Math.min(1, (now - activity.startedAt) / span))
            x = from.x + (to.x - from.x) * t
            y = from.y + (to.y - from.y) * t

            // Just enough of a wake to read direction, nothing more.
            const trailColor = hex(tierColor(worker.tier))
            for (let i = 1; i <= 2; i++) {
                const back = Math.max(0, t - i * 0.016)
                auraLayer.circle(
                    from.x + (to.x - from.x) * back,
                    from.y + (to.y - from.y) * back,
                    5 - i * 1.6
                ).fill({ color: trailColor, alpha: 0.13 - i * 0.04 })
            }
        } else {
            // A party on campaign is drawn at the camp it is attacking, not at
            // the node it left, so the map shows where the fight is.
            const anchor = activity.type === 'assault' ? activity.at : worker.at
            const node = props.world.nodes[anchor]
            if (!node) continue
            const index = atNode.get(anchor) ?? 0
            atNode.set(anchor, index + 1)
            const angle = index * 1.1 + (activity.type === 'harvest' ? now / 900 : activity.type === 'assault' ? now / 500 : 0)
            const orbit = activity.type === 'harvest' ? 34 : activity.type === 'assault' ? 40 : 28
            x = node.x + Math.cos(angle) * orbit
            y = node.y + Math.sin(angle) * orbit
        }

        const color = hex(tierColor(worker.tier))
        const carrying = Object.values(worker.cargo).reduce((s, n) => s + n, 0) > 0

        if (activity.type === 'starving') {
            auraLayer.circle(x, y, 13).stroke({ width: 2, color: 0xef4444, alpha: 0.55 + Math.sin(now / 260) * 0.3 })
        } else if (activity.type === 'assault') {
            auraLayer.circle(x, y, 15).stroke({ width: 2, color: 0xf97316, alpha: 0.5 + Math.sin(now / 160) * 0.35 })
        } else if (activity.type === 'harvest') {
            auraLayer.circle(x, y, 11 + (Math.sin(now / 220) + 1) * 3).stroke({ width: 1.5, color, alpha: 0.35 })
        }

        workerLayer.circle(x, y, 7).fill({ color, alpha: 0.95 })
        workerLayer.circle(x, y, 7).stroke({ width: 1.5, color: 0x0b0d11, alpha: 0.9 })
        // A pale core marks a loaded worker, so you can see goods flowing inward.
        if (carrying) workerLayer.circle(x, y, 3).fill({ color: 0xffffff, alpha: 0.9 })
    }

    // The selected node keeps a travelling ring, so it stays findable after you
    // pan away from it with the drawer open.
    if (props.selectedNode !== null) {
        const node = props.world.nodes[props.selectedNode]
        if (node) {
            const phase = (now % 2000) / 2000
            auraLayer.circle(node.x, node.y, 26 + phase * 20).stroke({
                width: 1,
                color: 0xffffff,
                alpha: 0.28 * (1 - phase)
            })
        }
    }

    // Search hits pulse, so a match sitting off the edge of the current view is
    // still obvious the moment you pan onto it.
    for (const id of props.highlight ?? []) {
        const node = props.world.nodes[id]
        if (!node) continue
        const phase = (now % 1600) / 1600
        auraLayer.circle(node.x, node.y, 24 + phase * 26).stroke({
            width: 2 * (1 - phase),
            color: glyphColor(node),
            alpha: 0.5 * (1 - phase)
        })
    }

    // Capitals breathe, so the heart of the network is never a dead circle.
    for (const id of props.state.capitals) {
        const node = props.world.nodes[id]
        if (!node) continue
        const pulse = (Math.sin(now / 1400) + 1) / 2
        auraLayer.circle(node.x, node.y, 33 + pulse * 4).stroke({
            width: 1,
            color: hex(tierGlow(node.tier)),
            alpha: 0.05 + pulse * 0.08
        })
    }

    drawRipples(performance.now())
}

// --- lifecycle --------------------------------------------------------------

// The host element is not guaranteed to exist on the first mount tick -- a
// .client component's first client render can land after onMounted -- so boot
// off the ref itself rather than off the lifecycle hook.
watch(host, (element) => {
    if (!element || app) return
    boot().catch(error => console.error('[caravan] map failed to start', error))
}, { immediate: true, flush: 'post' })

async function boot() {
    if (!host.value) return
    app = new Application()
    await app.init({
        resizeTo: host.value,
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        autoDensity: true
    })
    if (!host.value) return
    host.value.appendChild(app.canvas)

    camera = new Container()
    backdropLayer = new Graphics()
    roadLayer = new Graphics()
    roadHitLayer = new Container()
    auraLayer = new Graphics()
    nodeLayer = new Container()
    workerLayer = new Graphics()
    camera.addChild(backdropLayer, roadLayer, roadHitLayer, auraLayer, nodeLayer, workerLayer)
    app.stage.addChild(camera)

    app.stage.eventMode = 'static'
    app.stage.hitArea = { contains: () => true }
    app.stage.on('pointerdown', (e) => {
        dragging = true
        dragMoved = 0
        last = { x: e.global.x, y: e.global.y }
    })
    app.stage.on('pointerup', () => {
        if (dragMoved < 6) emit('clearSelection')
        dragging = false
    })
    app.stage.on('pointerupoutside', () => { dragging = false })
    app.stage.on('pointermove', (e) => {
        if (!dragging) return
        const dx = e.global.x - last.x
        const dy = e.global.y - last.y
        dragMoved += Math.abs(dx) + Math.abs(dy)
        view.x += dx
        view.y += dy
        last = { x: e.global.x, y: e.global.y }
        applyCamera()
    })

    host.value.addEventListener('wheel', onWheel, { passive: false })

    // Pixi's `resizeTo` only listens for window resizes, and the storehouse
    // panel changes the canvas width without one. Watch the host instead.
    resizeObserver = new ResizeObserver(() => {
        app?.resize()
        applyCamera()
    })
    resizeObserver.observe(host.value)

    drawBackdrop()
    drawRoads()
    drawNodes()
    fitToTerritory()

    app.ticker.add(() => drawWorkers(props.serverNow()))
}

/** Which label tier the current zoom is in, so we redraw only when it changes. */
function labelBand(scale: number): number {
    if (scale >= LABEL_ZOOM_UNOWNED) return 2
    if (scale >= LABEL_ZOOM) return 1
    return 0
}

function onWheel(e: WheelEvent) {
    e.preventDefault()
    const before = labelBand(view.scale)
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    view.scale = Math.max(0.1, Math.min(2.4, view.scale * factor))
    applyCamera()
    // Labels live in the static layer, so crossing a band means rebuilding it.
    if (labelBand(view.scale) !== before) drawNodes()
}

onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    host.value?.removeEventListener('wheel', onWheel)
    app?.destroy(true, { children: true })
    app = null
})

let fitted = false
watch(() => props.state, (state) => {
    if (!state) return
    drawBackdrop()
    drawRoads()
    drawNodes()
    // The first snapshot arrives after the canvas boots, so the opening camera
    // frame has to wait for it.
    if (!fitted) {
        fitted = true
        fitToTerritory()
    }
}, { immediate: true })

watch(() => [props.state?.ownedNodes.length, props.state?.clearedCamps.length, props.state?.tier], () => {
    drawBackdrop()
    drawRoads()
    drawNodes()
})
watch(() => [props.selectedNode, props.selectedEdge], () => {
    drawRoads()
    drawNodes()
})
watch(() => props.highlight, () => drawNodes())
watch(() => props.state?.roads, () => drawRoads(), { deep: true })
</script>

<template>
    <div ref="host" class="caravan-canvas absolute inset-0 overflow-hidden" />
</template>

<style scoped>
.caravan-canvas {
    background:
        radial-gradient(80% 70% at 50% 45%, rgb(from var(--ui-primary) r g b / 0.045), transparent 70%),
        radial-gradient(120% 120% at 50% 50%, transparent 55%, rgb(0 0 0 / 0.5) 100%);
}
</style>
