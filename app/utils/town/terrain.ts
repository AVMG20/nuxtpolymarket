import * as THREE from 'three'
import { TOWN_PLOT_SIZE, getTownTerrain, townPlotTerrain, type TownBuildingId } from '#shared/utils/gamelogic/town'

// The terrain overlay: a flat tinted sheet laid over each plot's grass while
// the player has it switched on. It is a map, not scenery — the scene has to
// look exactly as it does today the moment the toggle goes off — so everything
// here is painted into a canvas and thrown away again when the overlay closes.

/** Texture pixels per tile. Enough for a crisp edge without a large canvas. */
const CELL = 24
/** Just above the plot slab (top at y = 0.3) and below the placement pad. */
const OVERLAY_Y = 0.305

export function townTerrainCss(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`
}

/**
 * How strongly a tile is tinted. While a building is on the cursor the tiles
 * that would pay it a bonus come forward and everything else falls back, so
 * the overlay answers the question the player is actually asking — where does
 * THIS go — instead of showing five colours at equal weight.
 */
function tileAlpha(terrain: string, boosted: boolean, highlighting: boolean): number {
    // Water has its own mesh in the world now, so the map only has to outline
    // it rather than paint it in.
    if (terrain === 'water') return 0.3
    if (!highlighting) return terrain === 'plain' ? 0.1 : 0.5
    return boosted ? 0.74 : 0.12
}

function paintPlot(px: number, py: number, highlight: TownBuildingId | null): HTMLCanvasElement {
    const size = TOWN_PLOT_SIZE * CELL
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    const tiles = townPlotTerrain(px, py)

    for (let ty = 0; ty < TOWN_PLOT_SIZE; ty++) {
        for (let tx = 0; tx < TOWN_PLOT_SIZE; tx++) {
            const def = getTownTerrain(tiles[ty * TOWN_PLOT_SIZE + tx]!)
            const boosted = highlight !== null && def.boosts.includes(highlight)
            ctx.globalAlpha = tileAlpha(def.id, boosted, highlight !== null)
            ctx.fillStyle = townTerrainCss(def.color)
            ctx.fillRect(tx * CELL, ty * CELL, CELL, CELL)

            // A ring on the tiles that would pay the ghost a bonus: colour
            // alone is hard to read against a lit, textured meadow.
            if (boosted) {
                ctx.globalAlpha = 0.9
                ctx.strokeStyle = '#ffffff'
                ctx.lineWidth = 2
                ctx.strokeRect(tx * CELL + 3, ty * CELL + 3, CELL - 6, CELL - 6)
            }
        }
    }

    ctx.globalAlpha = 0.22
    ctx.strokeStyle = '#0d1a0d'
    ctx.lineWidth = 1
    for (let i = 0; i <= TOWN_PLOT_SIZE; i++) {
        ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, size); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(size, i * CELL); ctx.stroke()
    }
    return canvas
}

/** One tinted sheet per plot, ready to drop into the scene. */
export function createTerrainOverlay(
    plots: readonly { x: number, y: number }[],
    highlight: TownBuildingId | null
): THREE.Group {
    const group = new THREE.Group()
    const geometry = new THREE.PlaneGeometry(TOWN_PLOT_SIZE, TOWN_PLOT_SIZE)
    geometry.rotateX(-Math.PI / 2)
    for (const plot of plots) {
        const texture = new THREE.CanvasTexture(paintPlot(plot.x, plot.y, highlight))
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 4
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false
        }))
        mesh.position.set(
            plot.x * TOWN_PLOT_SIZE + TOWN_PLOT_SIZE / 2,
            OVERLAY_Y,
            plot.y * TOWN_PLOT_SIZE + TOWN_PLOT_SIZE / 2
        )
        mesh.renderOrder = 1
        group.add(mesh)
    }
    return group
}

/** Every sheet owns a canvas texture, so the overlay has to be let go properly. */
export function disposeTerrainOverlay(group: THREE.Group) {
    let geometry: THREE.BufferGeometry | null = null
    for (const child of group.children) {
        if (!(child instanceof THREE.Mesh)) continue
        geometry = child.geometry
        const material = child.material as THREE.MeshBasicMaterial
        material.map?.dispose()
        material.dispose()
    }
    geometry?.dispose()
    group.clear()
}

// ─── Water ───────────────────────────────────────────────────────────────────
// Water is the one terrain that changes what you CAN do rather than how well
// you do it, so unlike the rest of the map it is always on screen. An invisible
// tile that refuses a building is the worst thing this feature could do.
//
// It is painted the same way the overlay is — a canvas sheet per plot — rather
// than modelled as geometry, so it lands in the scene through a path the rest
// of the ground already uses.

/** Just above the plot slab (top at y = 0.3), under the terrain map at 0.305. */
const WATER_Y = 0.303

function paintWater(px: number, py: number): HTMLCanvasElement | null {
    const tiles = townPlotTerrain(px, py)
    if (!tiles.includes('water')) return null

    const size = TOWN_PLOT_SIZE * CELL
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    for (let ty = 0; ty < TOWN_PLOT_SIZE; ty++) {
        for (let tx = 0; tx < TOWN_PLOT_SIZE; tx++) {
            if (tiles[ty * TOWN_PLOT_SIZE + tx] !== 'water') continue
            const x = tx * CELL
            const y = ty * CELL
            ctx.fillStyle = '#2f8fd6'
            ctx.fillRect(x, y, CELL, CELL)
            // A darker bank, so a pond reads as a hole in the ground rather
            // than a blue sticker.
            ctx.strokeStyle = 'rgba(12, 48, 74, 0.75)'
            ctx.lineWidth = 3
            ctx.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.16)'
            ctx.fillRect(x + 4, y + 4, CELL - 8, (CELL - 8) / 2)
        }
    }
    return canvas
}

/** One sheet per plot that has any water on it. */
export function createWaterLayer(plots: readonly { x: number, y: number }[]): THREE.Group {
    const group = new THREE.Group()
    const geometry = new THREE.PlaneGeometry(TOWN_PLOT_SIZE, TOWN_PLOT_SIZE)
    geometry.rotateX(-Math.PI / 2)
    for (const plot of plots) {
        const canvas = paintWater(plot.x, plot.y)
        if (!canvas) continue
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 4
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false
        }))
        mesh.position.set(
            plot.x * TOWN_PLOT_SIZE + TOWN_PLOT_SIZE / 2,
            WATER_Y,
            plot.y * TOWN_PLOT_SIZE + TOWN_PLOT_SIZE / 2
        )
        group.add(mesh)
    }
    return group
}

/** Every sheet owns a canvas texture, so the layer has to be let go properly. */
export function disposeWaterLayer(group: THREE.Group) {
    let geometry: THREE.BufferGeometry | null = null
    for (const child of group.children) {
        if (!(child instanceof THREE.Mesh)) continue
        geometry = child.geometry
        const material = child.material as THREE.MeshBasicMaterial
        material.map?.dispose()
        material.dispose()
    }
    geometry?.dispose()
    group.clear()
}
