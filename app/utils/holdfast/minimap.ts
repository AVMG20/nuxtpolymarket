// Holdfast — 2D minimap. Terrain is baked once into an offscreen canvas; each
// redraw only stamps buildings, units, lane warnings and the camera view.

import { BUILDINGS, MAP_SIZE } from '#shared/utils/holdfast/config'
import { Terrain } from '#shared/utils/holdfast/grid'
import { PLAYER, type HoldfastSim } from '#shared/utils/holdfast/sim'

export class HoldfastMinimap {
    private base: HTMLCanvasElement

    constructor(private canvas: HTMLCanvasElement, private sim: HoldfastSim) {
        this.base = document.createElement('canvas')
        this.base.width = MAP_SIZE
        this.base.height = MAP_SIZE
        const ctx = this.base.getContext('2d')!
        const grid = sim.grid
        for (let z = 0; z < MAP_SIZE; z++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const t = grid.terrain[grid.idx(x, z)]
                ctx.fillStyle = t === Terrain.Tree ? '#3f7a34' : t === Terrain.Rock ? '#8b8f97' : t === Terrain.Road ? '#d9bd84' : ((x + z) % 2 ? '#86c35a' : '#80bd55')
                ctx.fillRect(x, z, 1, 1)
            }
        }
    }

    draw(view: { x: number, z: number }[], time: number): void {
        const c = this.canvas
        const ctx = c.getContext('2d')
        if (!ctx) return
        const s = c.width / MAP_SIZE
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(this.base, 0, 0, c.width, c.height)

        const k = this.sim.keepCenter
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.arc(k.x * s, k.z * s, this.sim.territory * s, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])

        for (const b of this.sim.buildings) {
            const seg = BUILDINGS[b.kind].segment
            ctx.fillStyle = b.kind === 'keep' ? '#fde68a' : seg ? (b.level === 1 ? '#a16207' : '#e5e7eb') : '#60a5fa'
            ctx.fillRect(b.cx * s, b.cz * s, b.size * s, b.size * s)
        }
        for (const u of this.sim.units) {
            ctx.fillStyle = u.side === PLAYER ? '#1d4ed8' : '#ef4444'
            ctx.fillRect(u.x * s - 1.5, u.z * s - 1.5, 3, 3)
        }

        // Incoming waves pulse at their lanes.
        const pulse = 0.5 + Math.sin(time * 8) * 0.5
        if (this.sim.pending) {
            for (const lane of this.sim.pending.lanes) {
                const l = this.sim.difficulty.lanes[lane]
                if (!l) continue
                ctx.fillStyle = `rgba(239,68,68,${0.35 + pulse * 0.5})`
                ctx.beginPath()
                ctx.arc((l.x + 0.5) * s, (l.z + 0.5) * s, 5 + pulse * 3, 0, Math.PI * 2)
                ctx.fill()
            }
        }

        if (view.length === 4) {
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            view.forEach((p, i) => {
                const x = p.x * s
                const y = p.z * s
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
            })
            ctx.closePath()
            ctx.stroke()
        }
    }
}
