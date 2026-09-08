import * as THREE from 'three'
import { TOWN_PLOT_SIZE, getTownTerrain, townPlotTerrain, townTerrainAt, type TownBuildingId } from '#shared/utils/gamelogic/town'

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
// Connected shorelines are baked per plot from world terrain, including
// neighbouring plots, so shared water edges never acquire an internal bank.

/** Just above the plot slab (top at y = 0.3), under the terrain map at 0.305. */
const WATER_Y = 0.303

function paintWater(px: number, py: number): HTMLCanvasElement | null {
    const tiles = townPlotTerrain(px, py)
    if (!tiles.includes('water')) return null
    const cell = 96
    const size = TOWN_PLOT_SIZE * cell
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    const pixels = ctx.createImageData(size, size)
    for (let ty = 0; ty < TOWN_PLOT_SIZE; ty++) {
        for (let tx = 0; tx < TOWN_PLOT_SIZE; tx++) {
            if (tiles[ty * TOWN_PLOT_SIZE + tx] !== 'water') continue
            const wx = px * TOWN_PLOT_SIZE + tx
            const wz = py * TOWN_PLOT_SIZE + ty
            const land: [number, number][] = []
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
                if (townTerrainAt(wx + dx, wz + dz) !== 'water') land.push([dx, dz])
            }
            const corners: [number, number][] = []
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
                if (land.some(([dx, dz]) => dx === sx && dz === 0) && land.some(([dx, dz]) => dx === 0 && dz === sz)) corners.push([sx, sz])
            }
            for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
                const u = (x + 0.5) / cell
                const v = (y + 0.5) / cell
                let shore = 1
                for (const [dx, dz] of land) {
                    const sx = Math.max(dx - u, 0, u - dx - 1)
                    const sz = Math.max(dz - v, 0, v - dz - 1)
                    shore = Math.min(shore, Math.hypot(sx, sz))
                }
                // Round exposed outer corners, but leave shared water edges open.
                for (const [sx, sz] of corners) {
                    const cornerX = sx < 0 ? u : 1 - u
                    const cornerZ = sz < 0 ? v : 1 - v
                    if (cornerX < 0.2 && cornerZ < 0.2) shore = Math.min(shore, 0.2 - Math.hypot(cornerX - 0.2, cornerZ - 0.2))
                }
                const xx = wx + u
                const zz = wz + v
                const grain = Math.sin(xx * 83.7 + zz * 131.2) * Math.sin(xx * 219.1 - zz * 43.6)
                const edge = shore - 0.018 - (Math.sin(xx * 19 + zz * 13) + Math.sin(xx * 31 - zz * 23)) * 0.009
                if (edge < 0) continue
                const i = ((ty * cell + y) * size + tx * cell + x) * 4
                let color: number[]
                if (edge < 0.055) color = [164 + grain * 12, 155 + grain * 11, 119 + grain * 9]
                else {
                    const depth = Math.min(1, (edge - 0.055) / 0.24)
                    const wave = Math.sin(xx * 29 + Math.sin(zz * 13)) * Math.sin(zz * 39 + xx * 7) * 2
                    color = [105 - depth * 45 + wave, 158 - depth * 41 + wave, 145 - depth * 24 + wave]
                }
                pixels.data[i] = color[0]!
                pixels.data[i + 1] = color[1]!
                pixels.data[i + 2] = color[2]!
                pixels.data[i + 3] = 255
            }
        }
    }
    ctx.putImageData(pixels, 0, 0)
    for (let ty = 0; ty < TOWN_PLOT_SIZE; ty++) for (let tx = 0; tx < TOWN_PLOT_SIZE; tx++) {
        if (tiles[ty * TOWN_PLOT_SIZE + tx] !== 'water' || (tx + ty) % 3) continue
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = i % 2 ? '#91aa72' : '#78965d'
            ctx.beginPath()
            ctx.ellipse((tx + 0.34 + i * 0.09) * cell, (ty + 0.42 + i % 2 * 0.12) * cell, 3.2, 2.6, i, 0.2, Math.PI * 1.92)
            ctx.fill()
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
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
            roughness: 0.48,
            map: texture,
            transparent: true,
            depthWrite: false
        }))
        mesh.position.set(
            plot.x * TOWN_PLOT_SIZE + TOWN_PLOT_SIZE / 2,
            WATER_Y,
            plot.y * TOWN_PLOT_SIZE + TOWN_PLOT_SIZE / 2
        )
        mesh.receiveShadow = true
        group.add(mesh)
    }
    if (group.children.length === 0) geometry.dispose()
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
