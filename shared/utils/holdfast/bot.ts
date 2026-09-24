// Holdfast — a scripted player for the balance script and the tests. It plays
// a sensible, not brilliant, game: economy first, walls across every open
// lane, packs parked behind them, then stone, crystals and upgrades.

import { BUILDINGS, type BuildingKind, type UnitKind, type UpgradeId } from './config'
import { PLAYER, type HoldfastSim } from './sim'

export interface BotOptions {
    /** 0 = only units, 1 = balanced, 2 = greedy economy. */
    greed?: number
    walls?: boolean
}

export class HoldfastBot {
    private nextThink = 0
    private walled = new Set<number>()
    private readonly greed: number
    private readonly walls: boolean

    constructor(private sim: HoldfastSim, options: BotOptions = {}) {
        this.greed = options.greed ?? 1
        this.walls = options.walls ?? true
    }

    tick(): void {
        const s = this.sim
        if (s.over || s.time < this.nextThink) return
        this.nextThink = s.time + 0.75
        for (let k = 0; k < 3; k++) if (!this.act()) break
    }

    private laneDir(lane: number): { dx: number, dz: number } {
        const l = this.sim.difficulty.lanes[lane]!
        const k = this.sim.keepCenter
        const dx = l.x - k.x
        const dz = l.z - k.z
        const len = Math.hypot(dx, dz) || 1
        return { dx: dx / len, dz: dz / len }
    }

    private place(kind: BuildingKind, x: number, z: number): boolean {
        const s = this.sim
        if (!s.canAfford(s.buildCost(kind)) || s.keepLevel < BUILDINGS[kind].keepLevel) return false
        const spot = s.findFreeSpot(BUILDINGS[kind].size, x, z, 6)
        if (!spot) return false
        return s.placeBuilding(kind, spot.cx, spot.cz).ok
    }

    /** Somewhere behind the keep, away from the first lane. */
    private econSpot(): { x: number, z: number } {
        const s = this.sim
        const k = s.keepCenter
        // The direction furthest (in angle) from every lane, tucked close to the keep.
        const lanes = s.difficulty.lanes.map((l, i) => ({ l, d: this.laneDir(i) })).filter(o => o.l.opensAt <= s.minutes + 4).map(o => o.d)
        let best = 0
        let bestGap = -1
        for (let a = 0; a < 16; a++) {
            const ang = a / 16 * Math.PI * 2
            const dx = Math.sin(ang)
            const dz = Math.cos(ang)
            const gap = Math.min(...lanes.map(l => Math.acos(Math.max(-1, Math.min(1, l.dx * dx + l.dz * dz)))))
            if (gap > bestGap) {
                bestGap = gap
                best = ang
            }
        }
        const r = 5 + s.rng() * 3
        const ang = best + (s.rng() - 0.5) * 0.8
        return { x: k.x + Math.sin(ang) * r, z: k.z + Math.cos(ang) * r }
    }

    private upgrade(kind: BuildingKind): boolean {
        const s = this.sim
        const list = s.buildings.filter(b => b.kind === kind).sort((a, b) => a.level - b.level)
        for (const b of list) {
            if (s.canUpgrade(b).ok) return s.upgradeBuilding(b.id).ok
        }
        return false
    }

    private tech(id: UpgradeId): boolean {
        return this.sim.canBuyUpgrade(id).ok && this.sim.buyUpgrade(id).ok
    }

    private wallLane(lane: number): boolean {
        const s = this.sim
        const d = this.laneDir(lane)
        const k = s.keepCenter
        const r = s.territory - 2.5
        const cx = k.x + d.dx * r
        const cz = k.z + d.dz * r
        const half = 5
        const ax = Math.round(cx - d.dz * half)
        const az = Math.round(cz + d.dx * half)
        const bx = Math.round(cx + d.dz * half)
        const bz = Math.round(cz - d.dx * half)
        const cells = s.lineCells(ax, az, bx, bz)
        const { affordable, valid } = s.previewSegments('wall', cells)
        const count = valid.filter(Boolean).length
        if (count === 0 || affordable < count) return false
        s.placeSegments('wall', cells)
        this.walled.add(lane)
        return true
    }

    private deploy(kind: UnitKind): boolean {
        const s = this.sim
        const lanes = [...s.openLanes]
        if (lanes.length === 0) return false
        // Put the new pack on the lane with the fewest defenders.
        let best = lanes[0]!
        let bestN = Infinity
        for (const lane of lanes) {
            const d = this.laneDir(lane)
            const k = s.keepCenter
            const px = k.x + d.dx * (s.territory - 5)
            const pz = k.z + d.dz * (s.territory - 5)
            let n = 0
            for (const p of s.packs.values()) {
                if (p.side === PLAYER && Math.hypot(p.anchorX - px, p.anchorZ - pz) < 6) n++
            }
            if (n < bestN) {
                bestN = n
                best = lane
            }
        }
        const d = this.laneDir(best)
        const k = s.keepCenter
        const dist = kind === 'archer' && this.walled.has(best) ? s.territory - 2.5 : s.territory - 4.5
        const jitter = (s.rng() - 0.5) * 4
        const x = k.x + d.dx * dist - d.dz * jitter
        const z = k.z + d.dz * dist + d.dx * jitter
        return s.deployPack(kind, x, z).ok
    }

    private act(): boolean {
        const s = this.sim
        const packs = s.playerPacks
        const soon = s.nextWaveIn < 20
        const minPacks = Math.min(s.packCap, 1 + Math.floor(s.minutes / 2.5) + (this.greed < 1 ? 2 : 0))

        if (s.count('lumbercamp') === 0) {
            const p = this.econSpot()
            return this.place('lumbercamp', p.x, p.z)
        }
        // Heal the keep and top up damaged packs before anything else.
        if (s.keep.hp < s.keep.maxHp * 0.6 && s.repairBuilding(s.keep.id).ok) return true
        for (const p of s.packs.values()) {
            if (p.side !== PLAYER) continue
            const low = p.unitIds.length < s.packSize(p.kind) * (soon ? 0.7 : 0.4)
            if (low && s.reinforcePack(p.id).ok) return true
        }
        const urgent = packs === 0 || (soon && packs < minPacks) || this.greed === 0
        if (urgent && packs < minPacks) return this.deploy(packs % 3 === 1 ? 'archer' : 'warrior')
        if (this.walls) {
            for (const lane of s.openLanes) {
                if (!this.walled.has(lane) && s.minutes > 0.8) return this.wallLane(lane)
            }
        }

        const e = this.econSpot()
        const steps: (() => boolean)[] = [
            () => s.rates.wood < s.rates.gold * 0.7 && s.count('lumbercamp') < 3 && this.place('lumbercamp', e.x, e.z),
            () => s.count('goldmine') < 2 && this.place('goldmine', e.x, e.z),
            () => this.upgrade('goldmine'),
            () => this.upgrade('lumbercamp'),
            () => s.keepLevel < 2 && s.minutes > 3 && s.upgradeBuilding(s.keep.id).ok,
            () => s.count('stonemason') < 1 && this.place('stonemason', e.x, e.z),
            () => s.count('crystalmine') < 1 && this.place('crystalmine', e.x, e.z),
            () => s.count('barracks') < 1 && s.minutes > 4 && this.place('barracks', e.x, e.z),
            () => s.count('range') < 1 && s.minutes > 5 && this.place('range', e.x, e.z),
            () => this.tech('warriorDrill'),
            () => this.tech('archerDrill'),
            () => this.tech('prosperity'),
            () => this.tech('warriorSteel'),
            () => this.tech('archerBows'),
            () => this.upgradeWalls(),
            () => s.count('tower') < s.openLanes.size && this.towerOnLane(),
            () => s.keepLevel < 3 && s.minutes > 9 && s.upgradeBuilding(s.keep.id).ok,
            () => s.count('goldmine') < 3 && s.minutes > 6 && this.greed >= 1 && this.place('goldmine', e.x, e.z),
            () => this.upgrade('stonemason'),
            () => this.upgrade('crystalmine'),
            () => this.tech('masonry'),
            () => this.tech('fletching'),
            () => this.upgrade('tower')
        ]
        const budget = this.greed === 0 ? 3 : steps.length
        for (let k = 0; k < budget; k++) {
            if (steps[k]!()) return true
        }
        // Save for the keep upgrade instead of frittering gold on extra packs.
        const saving = s.keepLevel < 2 && s.minutes > 3 && this.greed > 0
        if (packs < minPacks || (!saving && packs < s.packCap && this.greed < 2)) return this.deploy(packs % 2 === 0 ? 'warrior' : 'archer')
        return false
    }

    private upgradeWalls(): boolean {
        const s = this.sim
        const wall = s.buildings.find(b => b.kind === 'wall' && s.canUpgrade(b).ok)
        if (!wall) return false
        return s.upgradeConnected(wall.id).upgraded > 0
    }

    private towerOnLane(): boolean {
        const lanes = [...this.sim.openLanes]
        const lane = lanes[this.sim.count('tower') % lanes.length]!
        const d = this.laneDir(lane)
        const k = this.sim.keepCenter
        const r = this.sim.territory - 5
        return this.place('tower', k.x + d.dx * r, k.z + d.dz * r)
    }
}

/** Run a whole game headless; returns seconds survived. */
export function simulateRun(sim: HoldfastSim, bot: HoldfastBot | null, maxSeconds = 26 * 60): number {
    const steps = Math.ceil(maxSeconds / 0.05)
    for (let i = 0; i < steps && !sim.over; i++) {
        bot?.tick()
        sim.step()
        sim.events.length = 0
    }
    return sim.time
}
