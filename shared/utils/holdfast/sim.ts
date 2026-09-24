// Holdfast — the headless simulation. Fixed 20 Hz step, seeded, no three.js:
// the renderer reads this state and interpolates, the balance script and the
// tests drive it directly. Every player action is a method that validates and
// returns a result instead of throwing, so the UI can grey things out with
// the exact same rules.

import {
    ABILITIES,
    ARROW_SPEED,
    BARRAGE,
    BASE_MISS,
    BLOODMOON_AT,
    BLOODMOON_GROWTH,
    BLOODMOON_INTERVAL,
    BOLT_SPEED,
    BOULDER_SPEED,
    BUILDINGS,
    DIFFICULTIES,
    EDGE_MARGIN,
    FIRST_WAVE_AT,
    KEEP_PACK_CAP,
    KILL_BOUNTY,
    LOOT,
    MAP_SIZE,
    MAX_ENEMIES,
    MOVING_MISS,
    RALLY_DAMAGE,
    RALLY_DURATION,
    RALLY_HASTE,
    RALLY_SPEED,
    REPAIR_SHARE,
    RESOURCES,
    ROUT_SHARE,
    SELL_REFUND,
    SIEGE_TOWER,
    START_RESOURCES,
    STREAK,
    STRUCTURE_REGEN,
    STRUCTURE_REGEN_DELAY,
    STRUCTURE_REGEN_MASONRY,
    TERRITORY,
    TICK,
    TOWER_AURA,
    TRAITS,
    UNIT_REGEN,
    UNIT_REGEN_DELAY,
    UNITS,
    UPGRADES,
    WALL_RANGE_BONUS,
    WARBAND_THEMES,
    WAVE_REWARD,
    WAVE_WARNING,
    waveInterval,
    type AbilityId,
    type BuildingKind,
    type Cost,
    type DifficultyDef,
    type PackTrait,
    type Resource,
    type Resources,
    type UnitKind,
    type UpgradeId,
    type WaveTheme
} from './config'
import { Grid, Terrain, computeFlowFromCosts, findPath, flowNext, generateTerrain } from './grid'
import { HOLDFAST_WIN_MS, type HoldfastDifficulty, type HoldfastRunStats } from './meta'
import { createRng, rngRange, type Rng } from './rng'

export const PLAYER = 0
export const ENEMY = 1
export type Side = typeof PLAYER | typeof ENEMY

/** What a shot looks like: bow arrows, heavy tower bolts, catapult boulders. */
export type Projectile = 'arrow' | 'bolt' | 'boulder'

/** Visual heights the sim needs for arrow arcs. */
export const WALL_HEIGHT = 1.35
const UNIT_CHEST = 0.55
/** Soldiers are poor at knocking down stone: gives the player time to react. */
const SIEGE_MULT = 0.5
/** How long a raider pack keeps hammering a breach nobody is hitting. */
const FOCUS_STALE = 8

export interface Unit {
    id: number
    side: Side
    kind: UnitKind
    packId: number
    x: number
    z: number
    /** Position at the previous tick, for render interpolation. */
    px: number
    pz: number
    angle: number
    hp: number
    maxHp: number
    damage: number
    range: number
    speed: number
    radius: number
    cooldown: number
    targetUnit: number
    targetBuilding: number
    /** Friendly post (where the unit returns to). */
    slotX: number
    slotZ: number
    elevated: boolean
    moving: boolean
    scan: number
    alive: boolean
    spawnedAt: number
    lastAttackAt: number
    lastHitAt: number
    /** Share of arrow damage shrugged off (knights, shieldwalls). */
    armor: number
    /** Damage per hit against structures. */
    siege: number
    /** Blast radius of its shots (catapults). */
    splash: number
    /** How far its melee hits shove. */
    knock: number
    /** Arrow damage already in flight toward it: archers skip doomed targets. */
    incoming: number
    /** Damage multiplier from auras (watchtowers), refreshed on scan. */
    bonus: number
    /** Rally Horn buff runs until this time. */
    rallyUntil: number
    /** Raider: index into its pack's flanking route, -1 when following the flow field. */
    wp: number
    /** Melee defender: gate cell it is heading through to reach its target, -1 when none. */
    via: number
    /** Siege tower: parked against a wall (its wall is targetBuilding). */
    docked: boolean
    /** Siege tower: drawbridge progress, 0..1; at 1 raiders climb onto the wall. */
    deploy: number
}

export interface Pack {
    id: number
    side: Side
    kind: UnitKind
    unitIds: number[]
    anchorX: number
    anchorZ: number
    facing: number
    moving: boolean
    path: { x: number, z: number }[]
    pathIndex: number
    leaderX: number
    leaderZ: number
    /** Slot offsets from the leader while marching. */
    marchOffsets: { x: number, z: number }[]
    wallBound: boolean
    /** Melee pack posted in a gate: it holds the gap instead of roaming. */
    gateBound: boolean
    /** Raider trait ('none' for the player's packs). */
    trait: PackTrait
    /** Lane a raider pack came from (-1 for the player's). */
    lane: number
    /** Wave a raider pack belongs to (0 for the player's). */
    wave: number
    /** Soldiers the pack started with. */
    size0: number
    /** Structure the whole raider pack is breaching (-1 = none). */
    siegeTarget: number
    siegeAt: number
    /** Cells of a flanking route round the walls, or null. */
    flank: number[] | null
    /** Broken and running for the map edge. */
    routed: boolean
    routedAt: number
    spawnedAt: number
}

export interface Building {
    id: number
    kind: BuildingKind
    level: number
    cx: number
    cz: number
    size: number
    hp: number
    maxHp: number
    cooldown: number
    alive: boolean
    spent: Resources
    builtAt: number
    lastHitAt: number
    lastAttackAt: number
}

export interface Arrow {
    id: number
    side: Side
    fromX: number
    fromY: number
    fromZ: number
    toX: number
    toY: number
    toZ: number
    targetUnit: number
    targetBuilding: number
    damage: number
    t: number
    duration: number
    fire: boolean
    projectile: Projectile
    /** Blast radius on landing (0 = single target). */
    splash: number
    /** Damage to structures on landing (boulders). */
    structureDamage: number
}

export interface Loot {
    id: number
    x: number
    z: number
    expiresAt: number
    reward: Cost
}

export type SimEvent
    = | { type: 'shoot', x: number, z: number, side: Side, projectile: Projectile }
      | { type: 'hit', x: number, z: number, side: Side, melee: boolean }
      | { type: 'death', x: number, z: number, side: Side, kind: UnitKind, elevated: boolean }
      | { type: 'building-hit', id: number }
      | { type: 'building-destroyed', id: number, kind: BuildingKind, cx: number, cz: number, size: number }
      | { type: 'building-placed', id: number, kind: BuildingKind }
      | { type: 'building-upgraded', id: number }
      | { type: 'deploy', packId: number, kind: UnitKind, x: number, z: number }
      | { type: 'wave-incoming', wave: number, lanes: number[], at: number, warband: boolean, theme: WaveTheme }
      | { type: 'wave-spawned', wave: number, lanes: number[] }
      | { type: 'lane-opened', lane: number }
      | { type: 'bloodmoon' }
      | { type: 'upgrade', id: UpgradeId }
      | { type: 'victory' }
      | { type: 'defeat' }
      /** A boulder (or bursting bolt) landed. */
      | { type: 'impact', x: number, z: number, radius: number, side: Side }
      /** Gold for a kill. */
      | { type: 'bounty', x: number, z: number, amount: number }
      /** Every raider of a wave is dead or fled. */
      | { type: 'wave-cleared', wave: number, reward: Cost, perfect: boolean }
      /** Kills chained quickly; `bonus` gold was paid. */
      | { type: 'streak', count: number, bonus: number }
      | { type: 'loot-spawned', id: number, x: number, z: number }
      | { type: 'loot-collected', id: number, x: number, z: number, reward: Cost }
      | { type: 'loot-expired', id: number, x: number, z: number }
      | { type: 'rally', x: number, z: number }
      | { type: 'barrage', x: number, z: number }
      /** A beaten raider pack broke and ran. */
      | { type: 'rout', packId: number, x: number, z: number }
      /** Raiders smashed a wall or gate segment. */
      | { type: 'breach', id: number, kind: BuildingKind, cx: number, cz: number }
      /** A battering ram struck a structure. */
      | { type: 'ram-hit', id: number, x: number, z: number }
      /** A siege tower parked against a wall and starts lowering its bridge. */
      | { type: 'tower-docked', unitId: number, x: number, z: number, wallId: number }

export type ActionResult = { ok: true } | { ok: false, reason: string }

export interface DeployPreview {
    ok: boolean
    reason?: string
    /** Where the pack actually lands (archers snap onto a nearby wall). */
    x: number
    z: number
    slots: { x: number, z: number }[]
    cost: Cost
    wallBound: boolean
    /** Melee pack that would hold a gate. */
    gateBound?: boolean
}

export interface PlacePreview {
    ok: boolean
    reason?: string
    cx: number
    cz: number
    cost: Cost
}

export interface UnitStats {
    hp: number
    damage: number
    range: number
    armor: number
    siege: number
    splash: number
}

export interface PlannedPack {
    lane: number
    kind: UnitKind
    size: number
    trait: PackTrait
    flank: boolean
}

export interface PlannedWave {
    at: number
    wave: number
    lanes: number[]
    packs: PlannedPack[]
    warband: boolean
    theme: WaveTheme
}

interface Formation {
    slots: { x: number, z: number }[]
    wallBound: boolean
    facing: number
    gateBound: boolean
}

const OK: ActionResult = { ok: true }
const fail = (reason: string): ActionResult => ({ ok: false, reason })
const article = (name: string): string => (/^[AEIOU]/.test(name) ? 'an' : 'a')

const BUCKET = 1
const DX = [1, -1, 0, 0, 1, 1, -1, -1]
const DZ = [0, 0, 1, -1, 1, -1, 1, -1]

export class HoldfastSim {
    readonly difficulty: DifficultyDef
    readonly seed: number
    readonly grid: Grid
    readonly rng: Rng

    time = 0
    tickCount = 0
    over: 'victory' | 'defeat' | null = null

    resources: Resources = { ...START_RESOURCES }
    /** Net income per second, refreshed every tick (for the HUD). */
    rates: Resources = { gold: 0, wood: 0, stone: 0, crystal: 0 }
    upgrades: Record<UpgradeId, number> = {
        warriorDrill: 0,
        warriorSteel: 0,
        archerDrill: 0,
        archerBows: 0,
        knightArmor: 0,
        catapultPayload: 0,
        masonry: 0,
        prosperity: 0,
        fletching: 0
    }

    units: Unit[] = []
    packs = new Map<number, Pack>()
    buildings: Building[] = []
    arrows: Arrow[] = []
    events: SimEvent[] = []
    /** Supply carts waiting to be grabbed. */
    loot: Loot[] = []

    stats: HoldfastRunStats = { kills: 0, packsDeployed: 0, buildingsBuilt: 0, wave: 0 }
    /** Gold earned from kills, streaks, cleared waves and loot. */
    bountyEarned = 0
    /** Waves wiped out, and how many of those without losing a building. */
    wavesCleared = 0
    perfectWaves = 0
    /** Current kill streak, and the best one this run. */
    streak = 0
    bestStreak = 0

    wave = 0
    nextWaveAt = FIRST_WAVE_AT
    pending: PlannedWave | null = null
    openLanes = new Set<number>()
    bloodmoon = false

    keep!: Building
    private nextId = 1
    private unitById = new Map<number, Unit>()
    private buildingById = new Map<number, Building>()
    private flowDirty = true
    private flowStale = false
    private flowRefreshAt = 0
    private readonly flowCost: Float64Array
    private bucketHead: Int32Array
    private bucketNext: Int32Array = new Int32Array(0)
    private readonly buckets = Math.ceil(MAP_SIZE / BUCKET)
    /** Scratch buffer of unit indices for spatial queries. */
    private readonly qBuf = new Int32Array(4096)
    private gateList: Building[] = []
    private towerList: Building[] = []
    private listsDirty = true
    private enemyCount = 0
    private deferred: (PlannedPack & { wave: number })[] = []
    private deadPacks = new Set<Pack>()
    private waveLive = new Map<number, { packs: number, perfect: boolean }>()
    private lastKillAt = -99
    private nextLootAt: number = LOOT.first
    private abilityAt: Record<AbilityId, number> = { rally: ABILITIES.rally.readyAt, barrage: ABILITIES.barrage.readyAt }
    private storm: { x: number, z: number, left: number } | null = null
    /** Wall cells raiders may walk on, opened by docked siege towers. */
    private readonly enemyWall: Uint8Array
    private rampsActive = false
    private rampsDirty = false
    /** Something may be standing inside a structure: check and push units out. */
    private popCheck = true

    constructor(difficulty: HoldfastDifficulty, seed: number) {
        this.difficulty = DIFFICULTIES[difficulty]
        this.seed = seed
        this.rng = createRng(seed)
        this.grid = new Grid()
        this.flowCost = new Float64Array(this.grid.size * this.grid.size)
        this.enemyWall = new Uint8Array(this.grid.size * this.grid.size)
        this.bucketHead = new Int32Array(this.buckets * this.buckets * 2)
        generateTerrain(this.grid, this.rng, this.difficulty)

        const k = this.difficulty.keep
        this.keep = this.addBuilding('keep', k.x, k.z)
        // Starting gold mine right beside the keep, inside the wall ring.
        const mineSpot = this.findFreeSpot(2, k.x + 4.5, k.z + 1, 3) ?? this.findFreeSpot(2, k.x - 2.5, k.z + 1, 4)
        if (mineSpot) this.addBuilding('goldmine', mineSpot.cx, mineSpot.cz)
        this.buildStartingWalls()
        this.stats.buildingsBuilt = 0
        this.recomputeFlow()
    }

    /**
     * An octagonal ring round the keep, in walking order, and the cells where
     * it crosses a road: the middle one or two cells of each crossing, which
     * make good gates.
     */
    ringPlan(radius: number): { cells: number[], gates: number[] } {
        const k = this.keepCenter
        const verts: { x: number, z: number }[] = []
        for (let i = 0; i < 8; i++) {
            const a = (i + 0.5) / 8 * Math.PI * 2
            verts.push({ x: Math.round(k.x - 0.5 + Math.cos(a) * radius), z: Math.round(k.z - 0.5 + Math.sin(a) * radius) })
        }
        const cells: number[] = []
        const seen = new Set<number>()
        for (let i = 0; i < 8; i++) {
            const a = verts[i]!
            const b = verts[(i + 1) % 8]!
            for (const c of this.lineCells(a.x, a.z, b.x, b.z)) {
                if (seen.has(c)) continue
                seen.add(c)
                cells.push(c)
            }
        }
        const road = (c: number): boolean => this.grid.terrain[c] === Terrain.Road
        const gates: number[] = []
        const len = cells.length
        let start = cells.findIndex(c => !road(c))
        if (start < 0) start = 0
        let run: number[] = []
        const flush = (): void => {
            if (run.length > 0) {
                const s = Math.max(0, Math.floor((run.length - 2) / 2))
                gates.push(...run.slice(s, s + Math.min(2, run.length)))
            }
            run = []
        }
        for (let j = 1; j <= len; j++) {
            const c = cells[(start + j) % len]!
            if (road(c)) run.push(c)
            else flush()
        }
        flush()
        return { cells, gates }
    }

    /** A small wooden ring round the keep, with a narrow gate where each road runs through it. */
    private buildStartingWalls(): void {
        const plan = this.ringPlan(7)
        const gates = new Set(plan.gates)
        const n = this.grid.size
        for (const c of plan.cells) {
            const x = c % n
            const z = (c - x) / n
            if (this.footprintClear(1, x, z) !== null) continue
            this.addBuilding(gates.has(c) ? 'gate' : 'wall', x, z)
        }
    }

    // ─── Derived values ──────────────────────────────────────────────────

    get minutes(): number {
        return this.time / 60
    }

    get survivedMs(): number {
        return Math.min(HOLDFAST_WIN_MS, Math.round(this.time * 1000))
    }

    get keepLevel(): number {
        return this.keep.level
    }

    get keepCenter(): { x: number, z: number } {
        return { x: this.keep.cx + 2, z: this.keep.cz + 2 }
    }

    get territory(): number {
        return TERRITORY[this.keep.level - 1] ?? TERRITORY[TERRITORY.length - 1]!
    }

    get packCap(): number {
        let cap: number = KEEP_PACK_CAP[this.keep.level - 1] ?? KEEP_PACK_CAP[KEEP_PACK_CAP.length - 1]!
        for (const b of this.buildings) cap += BUILDINGS[b.kind].packCap ?? 0
        return cap
    }

    get playerPacks(): number {
        let n = 0
        for (const p of this.packs.values()) if (p.side === PLAYER) n++
        return n
    }

    /** Raiders alive on the field. */
    get enemiesAlive(): number {
        return this.enemyCount
    }

    /** Raiders of spawned waves still waiting at the map edge (the field is full). */
    get enemiesQueued(): number {
        let n = 0
        for (const p of this.deferred) n += p.size
        return n
    }

    unit(id: number): Unit | undefined {
        return this.unitById.get(id)
    }

    building(id: number): Building | undefined {
        return this.buildingById.get(id)
    }

    buildingAtCell(i: number): Building | undefined {
        const id = this.grid.occupant[i]!
        return id >= 0 ? this.buildingById.get(id) : undefined
    }

    count(kind: BuildingKind): number {
        let n = 0
        for (const b of this.buildings) if (b.kind === kind) n++
        return n
    }

    packSize(kind: UnitKind): number {
        const drill = kind === 'warrior' ? this.upgrades.warriorDrill : kind === 'archer' ? this.upgrades.archerDrill : 0
        return UNITS[kind].packSize + 2 * drill
    }

    buildCost(kind: BuildingKind): Cost {
        const def = BUILDINGS[kind]
        return scaleCost(def.cost, Math.pow(def.scale, this.count(kind)))
    }

    upgradeCost(b: Building): Cost | null {
        return BUILDINGS[b.kind].upgrade[b.level - 1] ?? null
    }

    techCost(id: UpgradeId): Cost | null {
        return UPGRADES[id].cost[this.upgrades[id]] ?? null
    }

    canAfford(cost: Cost): boolean {
        for (const r of RESOURCES) if ((cost[r] ?? 0) > this.resources[r] + 1e-9) return false
        return true
    }

    private pay(cost: Cost, into?: Resources): void {
        for (const r of RESOURCES) {
            const v = cost[r] ?? 0
            this.resources[r] -= v
            if (into) into[r] += v
        }
    }

    private gain(cost: Cost): void {
        for (const r of RESOURCES) this.resources[r] += cost[r] ?? 0
        this.bountyEarned += cost.gold ?? 0
    }

    private productionMult(): number {
        return 1 + 0.15 * this.upgrades.prosperity
    }

    private structureHpMult(kind: BuildingKind): number {
        return kind === 'wall' || kind === 'gate' || kind === 'tower' ? 1 + 0.3 * this.upgrades.masonry : 1
    }

    private maxHpFor(kind: BuildingKind, level: number): number {
        const def = BUILDINGS[kind]
        return Math.round(def.hp[level - 1]! * this.structureHpMult(kind))
    }

    /** Enemy stat multiplier at the current time. */
    enemyMult(): number {
        const m = this.minutes
        let mult = 1 + this.difficulty.growth * m
        if (m > BLOODMOON_AT) mult *= Math.pow(BLOODMOON_GROWTH, m - BLOODMOON_AT)
        return mult
    }

    unitStats(kind: UnitKind, side: Side, trait: PackTrait = 'none'): UnitStats {
        const def = UNITS[kind]
        if (side === ENEMY) {
            const m = this.enemyMult()
            const tr = TRAITS[trait]
            const dmgMult = Math.sqrt(m) * (m > 1.6 ? 1.1 : 1)
            const damage = def.damage * dmgMult * tr.damage
            return {
                hp: def.hp * m * tr.hp,
                damage,
                range: def.range + tr.range,
                armor: Math.min(0.75, def.armor + tr.armor),
                siege: def.siege !== undefined ? def.siege * dmgMult * tr.siege : damage * SIEGE_MULT * (def.ranged ? 0.6 : 1) * tr.siege,
                splash: def.splash ?? 0
            }
        }
        if (kind === 'warrior') {
            const s = 1 + 0.2 * this.upgrades.warriorSteel
            return { hp: def.hp * s, damage: def.damage * s, range: def.range, armor: def.armor, siege: 0, splash: 0 }
        }
        if (kind === 'archer') {
            const b = this.upgrades.archerBows
            return { hp: def.hp, damage: def.damage * (1 + 0.2 * b), range: def.range + 0.75 * b, armor: def.armor, siege: 0, splash: 0 }
        }
        if (kind === 'knight') {
            const a = this.upgrades.knightArmor
            return { hp: def.hp * (1 + 0.25 * a), damage: def.damage * (1 + 0.1 * a), range: def.range, armor: Math.min(0.6, def.armor + 0.1 * a), siege: 0, splash: 0 }
        }
        const p = this.upgrades.catapultPayload
        return { hp: def.hp, damage: def.damage * (1 + 0.3 * p), range: def.range, armor: def.armor, siege: (def.siege ?? 0) * (1 + 0.3 * p), splash: (def.splash ?? 0) + 0.25 * p }
    }

    /** Whether the player may field this unit yet. */
    unitUnlocked(kind: UnitKind): ActionResult {
        if (UNITS[kind].enemyOnly) return fail(`Only raiders field ${UNITS[kind].name.toLowerCase()}s`)
        const req = UNITS[kind].requires
        if (req && this.count(req) === 0) return fail(`Needs ${article(BUILDINGS[req].name)} ${BUILDINGS[req].name}`)
        return OK
    }

    // ─── Buildings ───────────────────────────────────────────────────────

    private addBuilding(kind: BuildingKind, cx: number, cz: number, level = 1): Building {
        const def = BUILDINGS[kind]
        const maxHp = this.maxHpFor(kind, level)
        const b: Building = {
            id: this.nextId++,
            kind,
            level,
            cx,
            cz,
            size: def.size,
            hp: maxHp,
            maxHp,
            cooldown: 0,
            alive: true,
            spent: { gold: 0, wood: 0, stone: 0, crystal: 0 },
            builtAt: this.time,
            lastHitAt: -99,
            lastAttackAt: -99
        }
        this.buildings.push(b)
        this.buildingById.set(b.id, b)
        for (let z = cz; z < cz + def.size; z++) {
            for (let x = cx; x < cx + def.size; x++) this.grid.occupant[this.grid.idx(x, z)] = b.id
        }
        this.flowDirty = true
        this.listsDirty = true
        this.popCheck = true
        if (this.rampsActive) this.rampsDirty = true
        this.stats.buildingsBuilt++
        this.events.push({ type: 'building-placed', id: b.id, kind })
        return b
    }

    private removeBuilding(b: Building): void {
        b.alive = false
        for (let z = b.cz; z < b.cz + b.size; z++) {
            for (let x = b.cx; x < b.cx + b.size; x++) {
                const i = this.grid.idx(x, z)
                if (this.grid.occupant[i] === b.id) this.grid.occupant[i] = -1
            }
        }
        this.buildings = this.buildings.filter(o => o !== b)
        this.buildingById.delete(b.id)
        this.flowDirty = true
        this.listsDirty = true
        if (this.rampsActive) this.rampsDirty = true
    }

    private refreshLists(): void {
        this.gateList = this.buildings.filter(b => b.kind === 'gate')
        this.towerList = this.buildings.filter(b => b.kind === 'tower')
        this.listsDirty = false
    }

    inTerritory(x: number, z: number): boolean {
        const k = this.keepCenter
        const dx = x - k.x
        const dz = z - k.z
        return dx * dx + dz * dz <= this.territory * this.territory
    }

    /** Top-left cell for a building of `size` centred on a world point. */
    anchorFor(size: number, x: number, z: number): { cx: number, cz: number } {
        return { cx: Math.round(x - size / 2), cz: Math.round(z - size / 2) }
    }

    private footprintClear(size: number, cx: number, cz: number): string | null {
        const n = this.grid.size
        for (let z = cz; z < cz + size; z++) {
            for (let x = cx; x < cx + size; x++) {
                if (x < EDGE_MARGIN || z < EDGE_MARGIN || x >= n - EDGE_MARGIN || z >= n - EDGE_MARGIN) return 'Too close to the edge'
                const i = this.grid.idx(x, z)
                if (this.grid.solid(i)) return 'Blocked by trees or rocks'
                if (this.grid.occupant[i]! >= 0) return 'Something is already there'
                if (!this.inTerritory(x + 0.5, z + 0.5)) return 'Outside your territory'
            }
        }
        for (const u of this.units) {
            if (u.side !== ENEMY || !u.alive) continue
            if (u.x >= cx - 0.3 && u.x <= cx + size + 0.3 && u.z >= cz - 0.3 && u.z <= cz + size + 0.3) return 'Enemies in the way'
        }
        return null
    }

    previewBuilding(kind: BuildingKind, cx: number, cz: number): PlacePreview {
        const def = BUILDINGS[kind]
        const cost = this.buildCost(kind)
        const base = { cx, cz, cost }
        if (this.over) return { ...base, ok: false, reason: 'The run is over' }
        if (this.keepLevel < def.keepLevel) return { ...base, ok: false, reason: `Needs keep level ${def.keepLevel}` }
        if (def.max !== undefined && this.count(kind) >= def.max) return { ...base, ok: false, reason: 'Limit reached' }
        const blocked = this.footprintClear(def.size, cx, cz)
        if (blocked) return { ...base, ok: false, reason: blocked }
        if (!this.canAfford(cost)) return { ...base, ok: false, reason: 'Not enough resources' }
        return { ...base, ok: true }
    }

    placeBuilding(kind: BuildingKind, cx: number, cz: number): ActionResult & { id?: number } {
        if (BUILDINGS[kind].segment) return this.placeSegments(kind, [this.grid.idx(cx, cz)]).placed > 0 ? OK : fail('Cannot place here')
        const p = this.previewBuilding(kind, cx, cz)
        if (!p.ok) return fail(p.reason ?? 'Cannot place here')
        const b = this.addBuilding(kind, cx, cz)
        this.pay(p.cost, b.spent)
        return { ok: true, id: b.id }
    }

    /** Cells of a straight (Bresenham) line between two cells. */
    lineCells(ax: number, az: number, bx: number, bz: number): number[] {
        const cells: number[] = []
        let x = ax
        let z = az
        const dx = Math.abs(bx - ax)
        const dz = -Math.abs(bz - az)
        const sx = ax < bx ? 1 : -1
        const sz = az < bz ? 1 : -1
        let err = dx + dz
        for (let guard = 0; guard < 256; guard++) {
            if (this.grid.inBounds(x, z)) cells.push(this.grid.idx(x, z))
            if (x === bx && z === bz) break
            const e2 = 2 * err
            if (e2 >= dz) {
                err += dz
                x += sx
            }
            if (e2 <= dx) {
                err += dx
                z += sz
            }
        }
        return cells
    }

    /** Which cells of a wall/gate line are placeable and what they'd cost in total. */
    previewSegments(kind: BuildingKind, cells: readonly number[]): { valid: boolean[], cost: Cost, affordable: number, reason?: string } {
        const def = BUILDINGS[kind]
        const n = this.grid.size
        const valid: boolean[] = []
        let count = 0
        let reason: string | undefined
        for (const i of cells) {
            const cx = i % n
            const cz = (i - cx) / n
            const existing = this.buildingAtCell(i)
            let ok: boolean
            if (kind === 'gate' && existing?.kind === 'wall') {
                ok = true
            } else {
                const r = this.footprintClear(1, cx, cz)
                ok = r === null
                if (r) reason = r
            }
            valid.push(ok)
            if (ok) count++
        }
        const unit = def.cost
        let affordable = count
        for (const r of RESOURCES) {
            const per = unit[r] ?? 0
            if (per > 0) affordable = Math.min(affordable, Math.floor(this.resources[r] / per + 1e-9))
        }
        if (this.over) reason = 'The run is over'
        return { valid, cost: scaleCost(unit, count), affordable, reason: count === 0 ? reason ?? 'Cannot place here' : undefined }
    }

    placeSegments(kind: BuildingKind, cells: readonly number[]): { placed: number, reason?: string } {
        if (this.over) return { placed: 0, reason: 'The run is over' }
        const def = BUILDINGS[kind]
        if (!def.segment) return { placed: 0, reason: 'Not a wall' }
        const { valid } = this.previewSegments(kind, cells)
        const n = this.grid.size
        let placed = 0
        let reason: string | undefined
        cells.forEach((i, k) => {
            if (!valid[k]) return
            if (!this.canAfford(def.cost)) {
                reason = 'Not enough resources'
                return
            }
            const existing = this.buildingAtCell(i)
            let level = 1
            if (existing) {
                level = existing.level
                this.removeBuilding(existing)
            }
            const cx = i % n
            const b = this.addBuilding(kind, cx, (i - cx) / n, level)
            this.pay(def.cost, b.spent)
            placed++
        })
        return { placed, reason }
    }

    canUpgrade(b: Building): ActionResult {
        const def = BUILDINGS[b.kind]
        const cost = this.upgradeCost(b)
        if (!cost) return fail('Fully upgraded')
        const need = def.upgradeKeepLevel?.[b.level - 1] ?? 1
        if (b.kind !== 'keep' && this.keepLevel < need) return fail(`Needs keep level ${need}`)
        if (!this.canAfford(cost)) return fail('Not enough resources')
        return OK
    }

    upgradeBuilding(id: number): ActionResult {
        const b = this.buildingById.get(id)
        if (!b || this.over) return fail('Gone')
        const check = this.canUpgrade(b)
        if (!check.ok) return check
        const cost = this.upgradeCost(b)!
        this.pay(cost, b.spent)
        b.level++
        const maxHp = this.maxHpFor(b.kind, b.level)
        b.hp += maxHp - b.maxHp
        b.maxHp = maxHp
        this.flowDirty = true
        this.events.push({ type: 'building-upgraded', id: b.id })
        return OK
    }

    /** Every wall and gate connected to this one at the same tier. */
    connectedSegments(id: number): Building[] {
        const start = this.buildingById.get(id)
        if (!start || !BUILDINGS[start.kind].segment) return []
        const n = this.grid.size
        const seen = new Set<number>([start.id])
        const out: Building[] = [start]
        for (let q = 0; q < out.length; q++) {
            const b = out[q]!
            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const x = b.cx + dx
                    const z = b.cz + dz
                    if (x < 0 || z < 0 || x >= n || z >= n) continue
                    const o = this.buildingAtCell(this.grid.idx(x, z))
                    if (!o || seen.has(o.id) || !BUILDINGS[o.kind].segment || o.level !== start.level) continue
                    seen.add(o.id)
                    out.push(o)
                }
            }
        }
        return out
    }

    /** Upgrade as many connected same-tier segments as the player can afford. */
    upgradeConnected(id: number): { upgraded: number, total: number } {
        const list = this.connectedSegments(id)
        let upgraded = 0
        for (const b of list) {
            if (!this.canUpgrade(b).ok) continue
            this.upgradeBuilding(b.id)
            upgraded++
        }
        return { upgraded, total: list.length }
    }

    sellValue(b: Building): Cost {
        return scaleCost(b.spent, SELL_REFUND * (b.hp / b.maxHp), true)
    }

    sellBuilding(id: number): ActionResult {
        const b = this.buildingById.get(id)
        if (!b || this.over) return fail('Gone')
        if (b.kind === 'keep') return fail('You cannot sell the keep')
        const refund = this.sellValue(b)
        for (const r of RESOURCES) this.resources[r] += refund[r] ?? 0
        this.removeBuilding(b)
        this.events.push({ type: 'building-destroyed', id: b.id, kind: b.kind, cx: b.cx, cz: b.cz, size: b.size })
        return OK
    }

    repairCost(b: Building): Cost {
        const missing = 1 - b.hp / b.maxHp
        const base: Cost = b.kind === 'keep' ? { gold: 400, wood: 150 } : b.spent
        return scaleCost(base, REPAIR_SHARE * missing, false, true)
    }

    repairBuilding(id: number): ActionResult {
        const b = this.buildingById.get(id)
        if (!b || this.over) return fail('Gone')
        if (b.hp >= b.maxHp) return fail('Not damaged')
        if (this.time - b.lastHitAt < 3) return fail('Under attack')
        const cost = this.repairCost(b)
        if (!this.canAfford(cost)) return fail('Not enough resources')
        this.pay(cost)
        b.hp = b.maxHp
        this.events.push({ type: 'building-upgraded', id: b.id })
        return OK
    }

    // ─── Tech ────────────────────────────────────────────────────────────

    canBuyUpgrade(id: UpgradeId): ActionResult {
        const def = UPGRADES[id]
        const cost = this.techCost(id)
        if (!cost) return fail('Maxed')
        if (def.building !== 'keep' && this.count(def.building) === 0) return fail(`Needs ${article(BUILDINGS[def.building].name)} ${BUILDINGS[def.building].name}`)
        if (!this.canAfford(cost)) return fail('Not enough resources')
        return OK
    }

    buyUpgrade(id: UpgradeId): ActionResult {
        if (this.over) return fail('The run is over')
        const check = this.canBuyUpgrade(id)
        if (!check.ok) return check
        this.pay(this.techCost(id)!)
        this.upgrades[id]++
        const kind: UnitKind | null = id === 'warriorSteel' ? 'warrior' : id === 'archerBows' ? 'archer' : id === 'knightArmor' ? 'knight' : id === 'catapultPayload' ? 'catapult' : null
        if (kind) {
            const s = this.unitStats(kind, PLAYER)
            for (const u of this.units) {
                if (u.side !== PLAYER || u.kind !== kind) continue
                u.hp *= s.hp / u.maxHp
                u.maxHp = s.hp
                u.damage = s.damage
                u.range = s.range
                u.armor = s.armor
                u.siege = s.siege
                u.splash = s.splash
            }
        }
        if (id === 'masonry') {
            for (const b of this.buildings) {
                const maxHp = this.maxHpFor(b.kind, b.level)
                if (maxHp === b.maxHp) continue
                b.hp *= maxHp / b.maxHp
                b.maxHp = maxHp
            }
            this.flowDirty = true
        }
        this.events.push({ type: 'upgrade', id })
        return OK
    }

    // ─── Abilities ───────────────────────────────────────────────────────

    /** Seconds until an ability can be used again (0 = ready). */
    abilityReadyIn(id: AbilityId): number {
        return Math.max(0, this.abilityAt[id] - this.time)
    }

    get rallyReadyIn(): number {
        return this.abilityReadyIn('rally')
    }

    get barrageReadyIn(): number {
        return this.abilityReadyIn('barrage')
    }

    canUseAbility(id: AbilityId, x: number, z: number): ActionResult {
        if (this.over) return fail('The run is over')
        const wait = this.abilityReadyIn(id)
        if (wait > 0) return fail(`Ready in ${Math.ceil(wait)}s`)
        const k = this.keepCenter
        const reach = id === 'barrage' ? this.territory + BARRAGE.reach : this.territory + 4
        if (Math.hypot(x - k.x, z - k.z) > reach) return fail('Too far from the keep')
        return OK
    }

    /** Rally Horn: soldiers near (x, z) fight harder and faster for a while. */
    rally(x: number, z: number): ActionResult {
        const check = this.canUseAbility('rally', x, z)
        if (!check.ok) return check
        this.abilityAt.rally = this.time + ABILITIES.rally.cooldown
        const r2 = ABILITIES.rally.radius ** 2
        for (const u of this.units) {
            if (u.side !== PLAYER || !u.alive) continue
            if ((u.x - x) ** 2 + (u.z - z) ** 2 > r2) continue
            u.rallyUntil = this.time + RALLY_DURATION
            u.cooldown = Math.min(u.cooldown, 0.1)
        }
        this.events.push({ type: 'rally', x, z })
        return OK
    }

    /** Arrow Storm: the keep rains arrows on an area over the next second. */
    barrage(x: number, z: number): ActionResult {
        const check = this.canUseAbility('barrage', x, z)
        if (!check.ok) return check
        this.abilityAt.barrage = this.time + ABILITIES.barrage.cooldown
        this.storm = { x, z, left: BARRAGE.arrows }
        this.events.push({ type: 'barrage', x, z })
        return OK
    }

    private stormTick(): void {
        const s = this.storm
        if (!s) return
        const k = this.keepCenter
        const r = ABILITIES.barrage.radius
        const dmg = BARRAGE.damage * (1 + 0.3 * this.upgrades.fletching)
        const count = this.gather(s.x, s.z, r, ENEMY)
        for (let i = 0; i < 3 && s.left > 0; i++, s.left--) {
            const fx = k.x + rngRange(this.rng, -1.2, 1.2)
            const fz = k.z + rngRange(this.rng, -1.2, 1.2)
            // Half the storm seeks raiders under it, the rest blankets the area.
            if (count > 0 && this.rng() < 0.6) {
                const e = this.units[this.qBuf[Math.floor(this.rng() * count)]!]
                if (e?.alive) {
                    this.fireArrow(PLAYER, fx, 4.2, fz, e, null, dmg, true, 'arrow', 0.6, 0)
                    continue
                }
            }
            const a = this.rng() * Math.PI * 2
            const d = Math.sqrt(this.rng()) * r
            this.fireAt(PLAYER, fx, 4.2, fz, s.x + Math.cos(a) * d, 0.05, s.z + Math.sin(a) * d, dmg, true, 'arrow', 0)
        }
        if (s.left <= 0) this.storm = null
        else this.events.push({ type: 'shoot', x: k.x, z: k.z, side: PLAYER, projectile: 'arrow' })
    }

    // ─── Units ───────────────────────────────────────────────────────────

    /**
     * Friendly walkability: open ground and gates for everyone; archers may
     * also stand on walls. Nobody else climbs them.
     */
    friendlyWalkable(i: number, kind: UnitKind = 'archer'): boolean {
        if (i < 0 || this.grid.solid(i)) return false
        const b = this.buildingAtCell(i)
        if (!b) return true
        if (b.kind === 'gate') return true
        return b.kind === 'wall' && kind === 'archer'
    }

    /** The centre of the nearest wall segment within reach, for archers aimed near a wall. */
    snapToWall(x: number, z: number, reach = 1.4): { x: number, z: number } | null {
        const cx = Math.floor(x)
        const cz = Math.floor(z)
        let best: { x: number, z: number } | null = null
        let bestD = reach * reach
        for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
                const nx = cx + dx
                const nz = cz + dz
                if (!this.grid.inBounds(nx, nz) || !this.isWallCell(this.grid.idx(nx, nz))) continue
                const d = (nx + 0.5 - x) ** 2 + (nz + 0.5 - z) ** 2
                if (d < bestD) {
                    bestD = d
                    best = { x: nx + 0.5, z: nz + 0.5 }
                }
            }
        }
        return best
    }

    /** Ground a raider can walk on: no terrain, no structure (bar walls a siege tower opened). */
    private readonly enemyOpen = (i: number): boolean => i >= 0 && !this.grid.solid(i) && (this.grid.occupant[i]! < 0 || this.enemyWall[i] === 1)

    private walkable(u: Unit, x: number, z: number): boolean {
        const i = this.grid.cellAt(x, z)
        if (i < 0 || this.grid.solid(i)) return false
        const id = this.grid.occupant[i]!
        if (id < 0) return true
        if (u.side === ENEMY) return this.enemyWall[i] === 1
        const b = this.buildingById.get(id)
        if (!b) return true
        return b.kind === 'gate' || (b.kind === 'wall' && u.kind === 'archer')
    }

    /**
     * Which way a wall segment's parapet faces (Y rotation; 0 = +Z). A straight
     * run faces across itself, away from the keep; corners face outward.
     */
    wallFacing(b: { cx: number, cz: number }): number {
        const n = this.grid.size
        const seg = (x: number, z: number): boolean => {
            if (x < 0 || z < 0 || x >= n || z >= n) return false
            const o = this.buildingAtCell(z * n + x)
            return !!o && BUILDINGS[o.kind].segment === true
        }
        const ew = seg(b.cx - 1, b.cz) || seg(b.cx + 1, b.cz)
        const ns = seg(b.cx, b.cz - 1) || seg(b.cx, b.cz + 1)
        const k = this.keepCenter
        const dx = b.cx + 0.5 - k.x
        const dz = b.cz + 0.5 - k.z
        const alongX = ew && !ns ? true : ns && !ew ? false : Math.abs(dz) >= Math.abs(dx)
        if (alongX) return dz >= 0 ? 0 : Math.PI
        return dx >= 0 ? Math.PI / 2 : -Math.PI / 2
    }

    private isWallCell(i: number): boolean {
        return this.buildingAtCell(i)?.kind === 'wall'
    }

    private isGateCell(i: number): boolean {
        return this.buildingAtCell(i)?.kind === 'gate'
    }

    private defaultFacing(x: number, z: number): number {
        const k = this.keepCenter
        const dx = x - k.x
        const dz = z - k.z
        if (dx * dx + dz * dz > 4) return Math.atan2(dx, dz)
        const lane = this.difficulty.lanes[0]!
        return Math.atan2(lane.x - k.x, lane.z - k.z)
    }

    /** Nearest friendly-walkable point to (x, z), searching outward a few cells. */
    private nearestWalkable(x: number, z: number, maxR = 4, ok: (i: number) => boolean = i => this.friendlyWalkable(i)): { x: number, z: number } | null {
        const i = this.grid.cellAt(x, z)
        if (i >= 0 && ok(i)) return { x, z }
        const cx = Math.floor(x)
        const cz = Math.floor(z)
        let best: { x: number, z: number } | null = null
        let bestD = Infinity
        for (let r = 1; r <= maxR && !best; r++) {
            for (let dz = -r; dz <= r; dz++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
                    const nx = cx + dx
                    const nz = cz + dz
                    if (!this.grid.inBounds(nx, nz) || !ok(this.grid.idx(nx, nz))) continue
                    const px = nx + 0.5
                    const pz = nz + 0.5
                    const d = (px - x) ** 2 + (pz - z) ** 2
                    if (d < bestD) {
                        bestD = d
                        best = { x: px, z: pz }
                    }
                }
            }
        }
        return best
    }

    /**
     * Where each soldier of a pack stands around (x, z). Archers aimed at a
     * wall line up along it; melee packs dropped by a gate plug it and form
     * ranks behind; everything else forms ranks facing away from the keep.
     */
    formation(kind: UnitKind, x: number, z: number, count: number): Formation {
        const facing = this.defaultFacing(x, z)
        const slots: { x: number, z: number }[] = []
        const center = this.grid.cellAt(x, z)
        let wallBound = false
        if (kind === 'archer' && center >= 0 && this.isWallCell(center)) {
            const n = this.grid.size
            const seen = new Set<number>([center])
            const order = [center]
            for (let q = 0; q < order.length && order.length < count; q++) {
                const c = order[q]!
                const ccx = c % n
                const ccz = (c - ccx) / n
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = ccx + dx
                        const nz = ccz + dz
                        if (!this.grid.inBounds(nx, nz)) continue
                        const ni = this.grid.idx(nx, nz)
                        if (seen.has(ni) || !this.isWallCell(ni)) continue
                        seen.add(ni)
                        order.push(ni)
                    }
                }
            }
            // One archer per segment along the wall; double up only on short walls.
            const perCell = order.length >= count ? 1 : 2
            for (const c of order) {
                const ccx = c % n
                const ccz = (c - ccx) / n
                // Stand on the walkway, just behind the parapet.
                const face = this.wallFacing({ cx: ccx, cz: ccz })
                const fx = Math.sin(face)
                const fz = Math.cos(face)
                const offsets = perCell === 1 ? [0] : [-0.22, 0.22]
                for (const o of offsets) {
                    if (slots.length < count) slots.push({ x: ccx + 0.5 - fx * 0.14 + fz * o, z: ccz + 0.5 - fz * 0.14 - fx * o })
                }
            }
            wallBound = true
            if (slots.length >= count) return { slots, wallBound, facing, gateBound: false }
        }
        if ((kind === 'warrior' || kind === 'knight') && slots.length === 0) {
            const gate = this.gateFormation(kind, x, z, count)
            if (gate) return gate
        }

        const rest = count - slots.length
        const cols = Math.ceil(Math.sqrt(rest * 1.6))
        const rows = Math.ceil(rest / cols)
        const spacing = kind === 'warrior' ? 0.72 : kind === 'knight' ? 0.84 : kind === 'catapult' ? 1.4 : 0.8
        const fx = Math.sin(facing)
        const fz = Math.cos(facing)
        const rx = Math.cos(facing)
        const rz = -Math.sin(facing)
        for (let k = 0; k < rest; k++) {
            const r = Math.floor(k / cols)
            const rowCount = Math.min(cols, rest - r * cols)
            const lx = (k % cols - (rowCount - 1) / 2) * spacing
            const lz = (r - (rows - 1) / 2) * spacing
            const px = x + rx * lx - fx * lz
            const pz = z + rz * lx - fz * lz
            const spot = this.nearestWalkable(px, pz, 4, i => this.friendlyWalkable(i, kind)) ?? { x, z }
            slots.push(spot)
        }
        return { slots, wallBound, facing, gateBound: false }
    }

    /** A melee pack dropped by a gate: the front rank plugs the gate, the rest wait just inside. */
    private gateFormation(kind: UnitKind, x: number, z: number, count: number): Formation | null {
        const n = this.grid.size
        const cx = Math.floor(x)
        const cz = Math.floor(z)
        let g = -1
        let bestD = 1.8 * 1.8
        for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
                const nx = cx + dx
                const nz = cz + dz
                if (!this.grid.inBounds(nx, nz)) continue
                const i = this.grid.idx(nx, nz)
                if (!this.isGateCell(i)) continue
                const d = (nx + 0.5 - x) ** 2 + (nz + 0.5 - z) ** 2
                if (d < bestD) {
                    bestD = d
                    g = i
                }
            }
        }
        if (g < 0) return null
        const cells = [g]
        for (let q = 0; q < cells.length && cells.length < 3; q++) {
            const c = cells[q]!
            const ccx = c % n
            const ccz = (c - ccx) / n
            for (let d = 0; d < 8 && cells.length < 3; d++) {
                const nx = ccx + DX[d]!
                const nz = ccz + DZ[d]!
                if (!this.grid.inBounds(nx, nz)) continue
                const ni = this.grid.idx(nx, nz)
                if (!cells.includes(ni) && this.isGateCell(ni)) cells.push(ni)
            }
        }
        const face = this.wallFacing({ cx: g % n, cz: Math.floor(g / n) })
        const fx = Math.sin(face)
        const fz = Math.cos(face)
        const lx = Math.cos(face)
        const lz = -Math.sin(face)
        const slots: { x: number, z: number }[] = []
        let gx = 0
        let gz = 0
        for (const c of cells) {
            const px = c % n + 0.5
            const pz = Math.floor(c / n) + 0.5
            gx += px / cells.length
            gz += pz / cells.length
            if (slots.length < count) slots.push({ x: px + fx * 0.1, z: pz + fz * 0.1 })
        }
        const rest = count - slots.length
        const cols = Math.max(2, Math.min(4, cells.length + 1))
        const spacing = kind === 'knight' ? 0.84 : 0.72
        for (let k = 0; k < rest; k++) {
            const row = Math.floor(k / cols)
            const rowCount = Math.min(cols, rest - row * cols)
            const off = (k % cols - (rowCount - 1) / 2) * spacing
            const back = 0.95 + row * spacing
            const px = gx + lx * off - fx * back
            const pz = gz + lz * off - fz * back
            slots.push(this.nearestWalkable(px, pz, 3, i => this.friendlyWalkable(i, kind)) ?? { x: gx, z: gz })
        }
        return { slots, wallBound: false, facing: face, gateBound: true }
    }

    packCost(kind: UnitKind): Cost {
        return UNITS[kind].cost
    }

    previewDeploy(kind: UnitKind, x: number, z: number): DeployPreview {
        const cost = this.packCost(kind)
        // Archers aimed near a wall hop onto it.
        if (kind === 'archer') {
            const snap = this.snapToWall(x, z)
            if (snap) {
                x = snap.x
                z = snap.z
            }
        }
        const empty = { slots: [], cost, wallBound: false, x, z }
        if (this.over) return { ...empty, ok: false, reason: 'The run is over' }
        const unlocked = this.unitUnlocked(kind)
        if (!unlocked.ok) return { ...empty, ok: false, reason: unlocked.reason }
        const i = this.grid.cellAt(x, z)
        if (i < 0 || !this.friendlyWalkable(i, kind)) return { ...empty, ok: false, reason: kind !== 'archer' && this.isWallCell(i) ? `${UNITS[kind].name} can't stand on walls` : 'Can\'t stand there' }
        const { slots, wallBound, gateBound } = this.formation(kind, x, z, this.packSize(kind))
        const base = { slots, cost, wallBound, gateBound, x, z }
        if (!this.inTerritory(x, z)) return { ...base, ok: false, reason: 'Outside your territory' }
        if (this.playerPacks >= this.packCap) return { ...base, ok: false, reason: `Pack cap reached (${this.packCap})` }
        if (!this.canAfford(cost)) return { ...base, ok: false, reason: 'Not enough resources' }
        return { ...base, ok: true }
    }

    deployPack(kind: UnitKind, x: number, z: number): ActionResult & { packId?: number } {
        const p = this.previewDeploy(kind, x, z)
        if (!p.ok) return fail(p.reason ?? 'Cannot deploy')
        this.pay(p.cost)
        const pack = this.createPack(PLAYER, kind, p.x, p.z, p.slots, p.wallBound)
        pack.gateBound = p.gateBound === true
        this.stats.packsDeployed++
        this.events.push({ type: 'deploy', packId: pack.id, kind, x: p.x, z: p.z })
        return { ok: true, packId: pack.id }
    }

    private createPack(side: Side, kind: UnitKind, x: number, z: number, slots: { x: number, z: number }[], wallBound: boolean, trait: PackTrait = 'none', lane = -1, wave = 0): Pack {
        const pack: Pack = {
            id: this.nextId++,
            side,
            kind,
            unitIds: [],
            anchorX: x,
            anchorZ: z,
            facing: side === PLAYER ? this.defaultFacing(x, z) : Math.atan2(this.keepCenter.x - x, this.keepCenter.z - z),
            moving: false,
            path: [],
            pathIndex: 0,
            leaderX: x,
            leaderZ: z,
            marchOffsets: [],
            wallBound,
            gateBound: false,
            trait,
            lane,
            wave,
            size0: slots.length,
            siegeTarget: -1,
            siegeAt: 0,
            flank: null,
            routed: false,
            routedAt: 0,
            spawnedAt: this.time
        }
        this.packs.set(pack.id, pack)
        for (const s of slots) this.spawnUnit(pack, s.x, s.z)
        return pack
    }

    private spawnUnit(pack: Pack, x: number, z: number): Unit {
        const def = UNITS[pack.kind]
        const stats = this.unitStats(pack.kind, pack.side, pack.trait)
        const tr = TRAITS[pack.trait]
        const u: Unit = {
            id: this.nextId++,
            side: pack.side,
            kind: pack.kind,
            packId: pack.id,
            x,
            z,
            px: x,
            pz: z,
            angle: pack.facing,
            hp: stats.hp,
            maxHp: stats.hp,
            damage: stats.damage,
            range: stats.range,
            speed: def.speed * (pack.side === ENEMY ? 0.92 * tr.speed : 1) * (1 + (this.rng() - 0.5) * 0.08),
            radius: def.radius,
            cooldown: this.rng() * def.cooldown,
            targetUnit: -1,
            targetBuilding: -1,
            slotX: x,
            slotZ: z,
            elevated: false,
            moving: false,
            scan: this.rng() * 0.25,
            alive: true,
            spawnedAt: this.time,
            lastAttackAt: -99,
            lastHitAt: -99,
            armor: stats.armor,
            siege: stats.siege,
            splash: stats.splash,
            knock: def.knock * tr.knock,
            incoming: 0,
            bonus: 1,
            rallyUntil: -99,
            wp: -1,
            via: -1,
            docked: false,
            deploy: 0
        }
        u.elevated = u.side === PLAYER && this.isWallCell(this.grid.cellAt(x, z))
        this.units.push(u)
        this.unitById.set(u.id, u)
        pack.unitIds.push(u.id)
        if (u.side === ENEMY) this.enemyCount++
        return u
    }

    reinforceCost(packId: number): Cost | null {
        const pack = this.packs.get(packId)
        if (!pack || pack.side !== PLAYER) return null
        const size = this.packSize(pack.kind)
        const missing = size - pack.unitIds.length
        if (missing <= 0) return null
        return scaleCost(this.packCost(pack.kind), missing / size, false, true)
    }

    reinforcePack(packId: number): ActionResult {
        const pack = this.packs.get(packId)
        if (!pack || pack.side !== PLAYER || this.over) return fail('Gone')
        const cost = this.reinforceCost(packId)
        if (!cost) return fail('Already at full strength')
        if (!this.canAfford(cost)) return fail('Not enough resources')
        this.pay(cost)
        const size = this.packSize(pack.kind)
        const { slots } = this.formation(pack.kind, pack.anchorX, pack.anchorZ, size)
        const taken = pack.unitIds.map(id => this.unitById.get(id)!).filter(Boolean)
        // Fill the slots furthest from any surviving soldier first.
        const free = slots.filter(s => !taken.some(u => Math.hypot(u.slotX - s.x, u.slotZ - s.z) < 0.3))
        for (let k = pack.unitIds.length; k < size; k++) {
            const s = free.shift() ?? { x: pack.anchorX, z: pack.anchorZ }
            const u = this.spawnUnit(pack, s.x, s.z)
            if (pack.moving) {
                u.x = u.px = pack.leaderX
                u.z = u.pz = pack.leaderZ
            }
        }
        this.events.push({ type: 'deploy', packId: pack.id, kind: pack.kind, x: pack.anchorX, z: pack.anchorZ })
        return OK
    }

    disbandPack(packId: number): ActionResult {
        const pack = this.packs.get(packId)
        if (!pack || pack.side !== PLAYER) return fail('Gone')
        for (const id of pack.unitIds) {
            const u = this.unitById.get(id)
            if (u) {
                u.alive = false
                this.unitById.delete(id)
            }
        }
        this.units = this.units.filter(u => u.alive)
        this.packs.delete(packId)
        return OK
    }

    /** Preview of a move order: the slots the pack would take. */
    previewMove(packId: number, x: number, z: number): DeployPreview {
        const pack = this.packs.get(packId)
        if (pack?.kind === 'archer') {
            const snap = this.snapToWall(x, z)
            if (snap) {
                x = snap.x
                z = snap.z
            }
        }
        const empty = { slots: [], cost: {}, wallBound: false, x, z }
        if (!pack) return { ...empty, ok: false, reason: 'Gone' }
        const i = this.grid.cellAt(x, z)
        if (i < 0 || !this.friendlyWalkable(i, pack.kind)) return { ...empty, ok: false, reason: 'Can\'t go there' }
        const f = this.formation(pack.kind, x, z, pack.unitIds.length)
        return { ok: true, slots: f.slots, cost: {}, wallBound: f.wallBound, gateBound: f.gateBound, x, z }
    }

    movePack(packId: number, x: number, z: number): ActionResult {
        const pack = this.packs.get(packId)
        if (!pack || pack.side !== PLAYER || this.over) return fail('Gone')
        if (pack.kind === 'archer') {
            const snap = this.snapToWall(x, z)
            if (snap) {
                x = snap.x
                z = snap.z
            }
        }
        const kind = pack.kind
        const dest = this.grid.cellAt(x, z)
        if (dest < 0 || !this.friendlyWalkable(dest, kind)) return fail('Can\'t go there')
        const units = pack.unitIds.map(id => this.unitById.get(id)).filter((u): u is Unit => !!u)
        if (units.length === 0) return fail('Gone')
        let sx = 0
        let sz = 0
        for (const u of units) {
            sx += u.x
            sz += u.z
        }
        sx /= units.length
        sz /= units.length
        const startPoint = this.nearestWalkable(sx, sz, 4, i => this.friendlyWalkable(i, kind)) ?? { x: units[0]!.x, z: units[0]!.z }
        const start = this.grid.cellAt(startPoint.x, startPoint.z)
        const cells = findPath(this.grid, start, dest, i => this.friendlyCost(i, kind))
        if (!cells) return fail('No way through')
        const n = this.grid.size
        const raw = cells.map(c => ({ x: c % n + 0.5, z: Math.floor(c / n) + 0.5 }))
        raw[raw.length - 1] = { x, z }
        pack.path = this.smoothPath(startPoint, raw, kind)
        pack.pathIndex = 0
        pack.leaderX = startPoint.x
        pack.leaderZ = startPoint.z
        pack.moving = pack.path.length > 0
        pack.anchorX = x
        pack.anchorZ = z
        const f = this.formation(pack.kind, x, z, units.length)
        pack.facing = f.facing
        pack.wallBound = f.wallBound
        pack.gateBound = f.gateBound
        // Keep each soldier's relative spot in the column by matching slots by distance.
        const slots = [...f.slots]
        pack.marchOffsets = []
        for (const u of units) {
            let best = 0
            let bestD = Infinity
            slots.forEach((s, k) => {
                const d = (s.x - x - (u.x - sx)) ** 2 + (s.z - z - (u.z - sz)) ** 2
                if (d < bestD) {
                    bestD = d
                    best = k
                }
            })
            const s = slots.splice(best, 1)[0] ?? { x, z }
            u.slotX = s.x
            u.slotZ = s.z
            u.targetUnit = -1
            u.targetBuilding = -1
            u.via = -1
            u.moving = true
            pack.marchOffsets.push({ x: (s.x - x) * 0.7, z: (s.z - z) * 0.7 })
        }
        return OK
    }

    private friendlyCost(i: number, kind: UnitKind): number {
        if (this.grid.solid(i)) return Infinity
        const b = this.buildingAtCell(i)
        if (!b) return 1
        if (b.kind === 'gate') return 1
        if (b.kind === 'wall' && kind === 'archer') return 4
        return Infinity
    }

    /** Can a friendly unit of `kind` walk straight from a to b (stopping `short` of b)? */
    private lineWalkable(ax: number, az: number, bx: number, bz: number, kind: UnitKind, short = 0): boolean {
        const d = Math.hypot(bx - ax, bz - az) - short
        if (d <= 0) return true
        const steps = Math.ceil(d / 0.3)
        const ux = (bx - ax) / (d + short)
        const uz = (bz - az) / (d + short)
        for (let s = 1; s <= steps; s++) {
            const t = d * s / steps
            const i = this.grid.cellAt(ax + ux * t, az + uz * t)
            if (i < 0 || this.friendlyCost(i, kind) !== 1) return false
        }
        return true
    }

    /** Can a raider walk straight from a to b (stopping `short` of b)? */
    private lineOpenEnemy(ax: number, az: number, bx: number, bz: number, short: number): boolean {
        const d = Math.hypot(bx - ax, bz - az) - short
        if (d <= 0) return true
        const steps = Math.ceil(d / 0.3)
        const ux = (bx - ax) / (d + short)
        const uz = (bz - az) / (d + short)
        for (let s = 1; s <= steps; s++) {
            const t = d * s / steps
            if (!this.enemyOpen(this.grid.cellAt(ax + ux * t, az + uz * t))) return false
        }
        return true
    }

    private smoothPath(start: { x: number, z: number }, pts: { x: number, z: number }[], kind: UnitKind): { x: number, z: number }[] {
        const out: { x: number, z: number }[] = []
        let from = start
        let k = 0
        while (k < pts.length) {
            let far = k
            for (let j = pts.length - 1; j > k; j--) {
                if (this.lineWalkable(from.x, from.z, pts[j]!.x, pts[j]!.z, kind)) {
                    far = j
                    break
                }
            }
            out.push(pts[far]!)
            from = pts[far]!
            k = far + 1
        }
        return out
    }

    // ─── Spatial hash ────────────────────────────────────────────────────

    private rebuildBuckets(): void {
        const units = this.units
        this.bucketHead.fill(-1)
        if (this.bucketNext.length < units.length) this.bucketNext = new Int32Array(Math.max(64, units.length * 2))
        const b = this.buckets
        for (let k = 0; k < units.length; k++) {
            const u = units[k]!
            const bx = Math.min(b - 1, Math.max(0, Math.floor(u.x / BUCKET)))
            const bz = Math.min(b - 1, Math.max(0, Math.floor(u.z / BUCKET)))
            const h = u.side * b * b + bz * b + bx
            this.bucketNext[k] = this.bucketHead[h]!
            this.bucketHead[h] = k
        }
    }

    /** Nearest living unit of `side` within radius (optional filter). */
    nearestUnit(x: number, z: number, radius: number, side: Side, filter?: (u: Unit) => boolean): Unit | null {
        const b = this.buckets
        const x0 = Math.max(0, Math.floor((x - radius) / BUCKET))
        const x1 = Math.min(b - 1, Math.floor((x + radius) / BUCKET))
        const z0 = Math.max(0, Math.floor((z - radius) / BUCKET))
        const z1 = Math.min(b - 1, Math.floor((z + radius) / BUCKET))
        let best: Unit | null = null
        let bestD = radius * radius
        for (let bz = z0; bz <= z1; bz++) {
            for (let bx = x0; bx <= x1; bx++) {
                for (let k = this.bucketHead[side * b * b + bz * b + bx]!; k >= 0; k = this.bucketNext[k]!) {
                    const u = this.units[k]
                    if (!u || !u.alive || u.side !== side) continue
                    const d = (u.x - x) ** 2 + (u.z - z) ** 2
                    if (d < bestD && (!filter || filter(u))) {
                        bestD = d
                        best = u
                    }
                }
            }
        }
        return best
    }

    /** Indices (into `units`) of living units of `side` within r, written to qBuf; returns the count. */
    private gather(x: number, z: number, r: number, side: Side): number {
        const b = this.buckets
        const x0 = Math.max(0, Math.floor((x - r) / BUCKET))
        const x1 = Math.min(b - 1, Math.floor((x + r) / BUCKET))
        const z0 = Math.max(0, Math.floor((z - r) / BUCKET))
        const z1 = Math.min(b - 1, Math.floor((z + r) / BUCKET))
        const r2 = r * r
        const buf = this.qBuf
        let n = 0
        for (let bz = z0; bz <= z1; bz++) {
            for (let bx = x0; bx <= x1; bx++) {
                for (let k = this.bucketHead[side * b * b + bz * b + bx]!; k >= 0; k = this.bucketNext[k]!) {
                    const u = this.units[k]
                    if (!u || !u.alive || u.side !== side) continue
                    if ((u.x - x) ** 2 + (u.z - z) ** 2 > r2) continue
                    if (n < buf.length) buf[n++] = k
                }
            }
        }
        return n
    }

    /** How many living units of `side` stand within r (no buffer, safe inside a gather loop). */
    private countNear(x: number, z: number, r: number, side: Side): number {
        const b = this.buckets
        const x0 = Math.max(0, Math.floor((x - r) / BUCKET))
        const x1 = Math.min(b - 1, Math.floor((x + r) / BUCKET))
        const z0 = Math.max(0, Math.floor((z - r) / BUCKET))
        const z1 = Math.min(b - 1, Math.floor((z + r) / BUCKET))
        const r2 = r * r
        let n = 0
        for (let bz = z0; bz <= z1; bz++) {
            for (let bx = x0; bx <= x1; bx++) {
                for (let k = this.bucketHead[side * b * b + bz * b + bx]!; k >= 0; k = this.bucketNext[k]!) {
                    const u = this.units[k]
                    if (u && u.alive && u.side === side && (u.x - x) ** 2 + (u.z - z) ** 2 <= r2) n++
                }
            }
        }
        return n
    }

    // ─── Tick ────────────────────────────────────────────────────────────

    recomputeFlow(): void {
        const g = this.grid
        const cost = this.flowCost
        const occ = g.occupant
        for (let i = 0; i < cost.length; i++) {
            if (g.solid(i)) {
                cost[i] = Infinity
                continue
            }
            const id = occ[i]!
            if (id < 0) {
                cost[i] = g.terrain[i] === Terrain.Road ? 0.85 : 1
                continue
            }
            if (this.enemyWall[i] === 1) {
                cost[i] = 1.5
                continue
            }
            // Breaking through is priced by hp: raiders happily walk a detour
            // to an open gap, and only bash through when the way round is long.
            const b = this.buildingById.get(id)
            cost[i] = b ? 2 + b.hp / 22 : 1
        }
        const goals: number[] = []
        const k = this.keep
        for (let z = k.cz; z < k.cz + k.size; z++) {
            for (let x = k.cx; x < k.cx + k.size; x++) goals.push(g.idx(x, z))
        }
        computeFlowFromCosts(g, goals, cost)
        this.flowDirty = false
        this.flowStale = false
        this.flowRefreshAt = this.time + 2
    }

    step(): void {
        if (this.over) return
        if (this.listsDirty) this.refreshLists()
        if (this.rampsDirty) this.rebuildRamps()
        if (this.flowDirty || (this.flowStale && this.time >= this.flowRefreshAt)) this.recomputeFlow()
        const dt = TICK
        this.time += dt
        this.tickCount++

        this.director()
        this.produce(dt)
        if (this.tickCount % 20 === 0) this.upkeep()
        this.rebuildBuckets()
        if (this.storm) this.stormTick()
        for (const pack of this.packs.values()) if (pack.moving) this.advancePack(pack, dt)
        const units = this.units
        const count = units.length
        for (let k = 0; k < count; k++) {
            const u = units[k]!
            if (!u.alive) continue
            u.px = u.x
            u.pz = u.z
            const pack = this.packs.get(u.packId)
            if (u.kind === 'catapult') this.thinkCatapult(u, pack, dt)
            else if (u.kind === 'ram' || u.kind === 'siegetower') this.thinkMachine(u, pack, dt)
            else if (u.side === PLAYER) this.thinkFriendly(u, pack, dt)
            else this.thinkEnemy(u, pack, dt)
        }
        this.separate()
        for (const b of this.buildings) if (BUILDINGS[b.kind].attack) this.buildingAttack(b, dt)
        this.updateArrows(dt)
        if (this.loot.length > 0 && this.tickCount % 5 === 0) this.checkLoot()
        this.cleanup()

        if (this.keep.hp <= 0 && !this.over) {
            this.over = 'defeat'
            this.events.push({ type: 'defeat' })
        } else if (this.time * 1000 >= HOLDFAST_WIN_MS && !this.over) {
            this.over = 'victory'
            this.events.push({ type: 'victory' })
        }
    }

    private produce(dt: number): void {
        const rates = this.rates
        rates.gold = 0
        rates.wood = 0
        rates.stone = 0
        rates.crystal = 0
        const mult = this.productionMult()
        for (const b of this.buildings) {
            const p = BUILDINGS[b.kind].produces
            if (!p) continue
            let out = (p.rate[b.level - 1] ?? 0) * mult
            if (p.consumes) {
                const need = out * p.consumes.ratio * dt
                const have = this.resources[p.consumes.resource]
                const frac = need > 0 ? Math.min(1, have / need) : 1
                out *= frac
                this.resources[p.consumes.resource] -= need * frac
                rates[p.consumes.resource] -= out * p.consumes.ratio
            }
            this.resources[p.resource] += out * dt
            rates[p.resource] += out
        }
    }

    /** Once a second: walls patch up, soldiers bind wounds, beaten packs break. */
    private upkeep(): void {
        const regen = STRUCTURE_REGEN + STRUCTURE_REGEN_MASONRY * this.upgrades.masonry
        for (const b of this.buildings) {
            if (b.hp >= b.maxHp || !(BUILDINGS[b.kind].segment || b.kind === 'tower')) continue
            if (this.time - b.lastHitAt < STRUCTURE_REGEN_DELAY) continue
            b.hp = Math.min(b.maxHp, b.hp + b.maxHp * regen)
        }
        for (const u of this.units) {
            if (!u.alive || u.side !== PLAYER || u.hp >= u.maxHp) continue
            if (this.time - u.lastHitAt < UNIT_REGEN_DELAY) continue
            u.hp = Math.min(u.maxHp, u.hp + u.maxHp * UNIT_REGEN)
        }
        if (this.bloodmoon) return
        for (const p of this.packs.values()) {
            if (p.side !== ENEMY || p.routed || !TRAITS[p.trait].routs) continue
            if (p.kind === 'catapult' || p.kind === 'ram' || p.kind === 'siegetower') continue
            if (this.time - p.spawnedAt < 15 || p.unitIds.length > p.size0 * ROUT_SHARE) continue
            p.routed = true
            p.routedAt = this.time
            const u = this.unitById.get(p.unitIds[0] ?? -1)
            for (const id of p.unitIds) {
                const o = this.unitById.get(id)
                if (o) {
                    o.targetUnit = -1
                    o.targetBuilding = -1
                }
            }
            this.events.push({ type: 'rout', packId: p.id, x: u?.x ?? 0, z: u?.z ?? 0 })
        }
    }

    private director(): void {
        const t = this.time
        const m = t / 60
        this.difficulty.lanes.forEach((lane, k) => {
            if (!this.openLanes.has(k) && m + WAVE_WARNING / 60 >= lane.opensAt) {
                this.openLanes.add(k)
                if (lane.opensAt > 0) this.events.push({ type: 'lane-opened', lane: k })
            }
        })
        if (!this.bloodmoon && m >= BLOODMOON_AT) {
            this.bloodmoon = true
            this.events.push({ type: 'bloodmoon' })
        }
        if (!this.pending && t >= this.nextWaveAt - WAVE_WARNING) {
            this.pending = this.planWave(this.nextWaveAt)
            const p = this.pending
            this.events.push({ type: 'wave-incoming', wave: p.wave, lanes: p.lanes, at: p.at, warband: p.warband, theme: p.theme })
        }
        if (this.pending && t >= this.pending.at) {
            const w = this.pending
            this.pending = null
            this.spawnWave(w)
            this.nextWaveAt = t + (m >= BLOODMOON_AT ? BLOODMOON_INTERVAL : waveInterval(m))
        }
        if (this.deferred.length > 0 && this.tickCount % 10 === 0) this.spawnDeferred()
        if (t >= this.nextLootAt) this.spawnLoot()
    }

    /** How much weaker a lane's defences are: 1 = wide open, toward 0 = heavily walled. */
    private laneWeakness(k: number): number {
        const lane = this.difficulty.lanes[k]!
        const f = this.grid.flow[this.grid.idx(lane.x, lane.z)]!
        const c = this.keepCenter
        const straight = Math.hypot(lane.x - c.x, lane.z - c.z)
        const extra = Number.isFinite(f) ? Math.max(0, f - straight * 0.95) : 200
        return 1 / (1 + extra / 25)
    }

    private planWave(at: number): PlannedWave {
        const d = this.difficulty
        const m = at / 60
        const wave = this.wave + 1
        const warband = wave % 5 === 0
        const theme: WaveTheme = warband ? WARBAND_THEMES[(wave / 5 - 1) % WARBAND_THEMES.length]! : 'raid'
        let packs = 1 + Math.floor(m / d.packsEvery) + (wave > 5 ? d.extraPacks : 0) + (warband ? (wave >= 10 ? 2 : 1) : 0)
        if (m > BLOODMOON_AT) packs += Math.floor((m - BLOODMOON_AT) * 1.5)
        if (theme === 'horde') packs += 1
        const size = Math.min(22, 6 + Math.floor(m / d.sizeEvery) + (warband ? 1 : 0))
        let archerShare = wave <= 2 ? 0 : Math.min(0.5, 0.25 + m * 0.012)
        if (theme === 'volley') archerShare = 0.7
        else if (theme === 'shieldwall' || theme === 'sappers' || theme === 'berserkers') archerShare *= 0.5
        const knightShare = m < d.knightsFrom ? 0 : Math.min(0.3, 0.1 + (m - d.knightsFrom) * 0.025)
        const traitChance = Math.max(0, Math.min(0.4, (m - 6) * 0.035))

        const open = [...this.openLanes].sort((a, b) => a - b)
        // Freshly opened lanes go first, so a new threat is never a surprise.
        const fresh = open.filter(k => d.lanes[k]!.opensAt > 0 && Math.abs(d.lanes[k]!.opensAt - m) < 1)
        const offset = Math.floor(this.rng() * open.length)
        const weak = open.map(k => this.laneWeakness(k) ** 2)
        const weakSum = weak.reduce((a, b) => a + b, 0)
        const pickLane = (p: number): number => {
            if (p < fresh.length) return fresh[p]!
            // Cunning raiders lean on the lane you defend least.
            if (weakSum > 0 && this.rng() < d.cunning * 0.6) {
                let r = this.rng() * weakSum
                for (let k = 0; k < open.length; k++) {
                    r -= weak[k]!
                    if (r <= 0) return open[k]!
                }
            }
            return open[(p + offset) % open.length]!
        }

        const list: PlannedPack[] = []
        for (let p = 0; p < packs; p++) {
            const lane = pickLane(p)
            if (this.rng() < knightShare && theme !== 'volley') {
                list.push({ lane, kind: 'knight', size: Math.max(3, Math.min(6, Math.round(size * 0.4))), trait: 'none', flank: false })
                continue
            }
            const kind: UnitKind = this.rng() < archerShare ? 'archer' : 'warrior'
            let trait: PackTrait = 'none'
            if (theme !== 'raid' && theme !== 'horde' && TRAITS[theme].kind === kind && this.rng() < 0.8) trait = theme
            else if (this.rng() < traitChance) {
                const options: PackTrait[] = kind === 'archer' ? ['volley'] : ['shieldwall', 'sappers', 'berserkers']
                trait = options[Math.floor(this.rng() * options.length)]!
            }
            const flank = m >= d.flankFrom && this.rng() < d.flankChance
            list.push({ lane, kind, size, trait, flank })
        }
        // Siege engines trundle in behind the packs of their lane.
        const catapults = m < d.catapultsFrom ? 0 : (m < d.catapultsFrom + 6 ? 1 : 2) + (m > BLOODMOON_AT ? 1 : 0)
        const rams = m < d.ramsFrom ? 0 : (warband ? 2 : 1) + (m > BLOODMOON_AT ? 1 : 0)
        const towers = m < d.towersFrom ? 0 : m > BLOODMOON_AT ? 2 : wave % 2 === 0 ? 1 : 0
        const escorted = list.length
        const machine = (kind: UnitKind): void => {
            const escort = list[Math.floor(this.rng() * escorted)]!
            list.push({ lane: escort.lane, kind, size: 1, trait: 'none', flank: false })
        }
        for (let c = 0; c < catapults && escorted > 0; c++) machine('catapult')
        for (let c = 0; c < rams && escorted > 0; c++) machine('ram')
        for (let c = 0; c < towers && escorted > 0; c++) machine('siegetower')
        return { at, wave, lanes: [...new Set(list.map(p => p.lane))], packs: list, warband, theme }
    }

    private spawnWave(w: PlannedWave): void {
        this.wave = w.wave
        this.stats.wave = w.wave
        this.waveLive.set(w.wave, { packs: w.packs.length, perfect: true })
        const perLane = new Map<number, number>()
        for (const p of w.packs) {
            const k = perLane.get(p.lane) ?? 0
            perLane.set(p.lane, k + 1)
            if (this.enemyCount + p.size > MAX_ENEMIES) {
                this.deferred.push({ ...p, wave: w.wave })
                continue
            }
            this.spawnEnemyPack(p, w.wave, k)
        }
        this.events.push({ type: 'wave-spawned', wave: w.wave, lanes: w.lanes })
    }

    private spawnDeferred(): void {
        while (this.deferred.length > 0) {
            const p = this.deferred[0]!
            if (this.enemyCount + p.size > MAX_ENEMIES) return
            this.deferred.shift()
            this.spawnEnemyPack(p, p.wave, 0)
        }
    }

    private spawnEnemyPack(p: PlannedPack, wave: number, queue: number): void {
        const lane = this.difficulty.lanes[p.lane]!
        // Packs from the same lane queue up behind each other.
        const k2 = this.keepCenter
        const dx = k2.x - lane.x
        const dz = k2.z - lane.z
        const len = Math.hypot(dx, dz) || 1
        const back = queue * 2.4
        const cx = lane.x + 0.5 - dx / len * back
        const cz = lane.z + 0.5 - dz / len * back
        const slots: { x: number, z: number }[] = []
        const cols = Math.ceil(Math.sqrt(p.size))
        const fx = dx / len
        const fz = dz / len
        for (let s = 0; s < p.size; s++) {
            const ox = (s % cols - (cols - 1) / 2) * 0.7 + rngRange(this.rng, -0.12, 0.12)
            const oz = (Math.floor(s / cols) - (cols - 1) / 2) * 0.7 + rngRange(this.rng, -0.12, 0.12)
            // Rotate the square so it faces the keep.
            let x = cx + fz * ox - fx * oz
            let z = cz - fx * ox - fz * oz
            x = Math.min(MAP_SIZE - 0.3, Math.max(0.3, x))
            z = Math.min(MAP_SIZE - 0.3, Math.max(0.3, z))
            const i = this.grid.cellAt(x, z)
            if (i < 0 || this.grid.solid(i) || this.grid.occupant[i]! >= 0) {
                x = lane.x + 0.5 + rngRange(this.rng, -0.3, 0.3)
                z = lane.z + 0.5 + rngRange(this.rng, -0.3, 0.3)
            }
            slots.push({ x, z })
        }
        const pack = this.createPack(ENEMY, p.kind, cx, cz, slots, false, p.trait, p.lane, wave)
        if (p.flank) {
            pack.flank = this.flankRoute(p.lane)
            if (pack.flank) {
                for (const id of pack.unitIds) {
                    const u = this.unitById.get(id)
                    if (u) u.wp = 0
                }
            }
        }
    }

    /** A route from a lane to a point beside the base, round the walls: flankers hit where you aren't. */
    private flankRoute(laneIdx: number): number[] | null {
        const lane = this.difficulty.lanes[laneIdx]!
        const k = this.keepCenter
        const n = this.grid.size
        const base = Math.atan2(lane.x - k.x, lane.z - k.z)
        const side = this.rng() < 0.5 ? -1 : 1
        const ang = base + side * rngRange(this.rng, 0.9, 1.5)
        const r = this.territory + 3
        const gx = Math.min(n - 4, Math.max(3, k.x + Math.sin(ang) * r))
        const gz = Math.min(n - 4, Math.max(3, k.z + Math.cos(ang) * r))
        const spot = this.nearestWalkable(gx, gz, 5, this.enemyOpen)
        if (!spot) return null
        const from = this.grid.idx(lane.x, lane.z)
        const to = this.grid.cellAt(spot.x, spot.z)
        const path = findPath(this.grid, from, to, i => (this.enemyOpen(i) ? 1 : Infinity))
        if (!path || path.length < 4 || path.length > 110) return null
        return path
    }

    // ─── Loot ────────────────────────────────────────────────────────────

    private spawnLoot(): void {
        const [lo, hi] = LOOT.every
        this.nextLootAt = this.time + rngRange(this.rng, lo, hi)
        const k = this.keepCenter
        const n = this.grid.size
        for (let tries = 0; tries < 24; tries++) {
            const a = this.rng() * Math.PI * 2
            const r = rngRange(this.rng, this.territory * 0.6, this.territory + 3)
            const x = k.x + Math.sin(a) * r
            const z = k.z + Math.cos(a) * r
            if (x < EDGE_MARGIN || z < EDGE_MARGIN || x > n - EDGE_MARGIN || z > n - EDGE_MARGIN) continue
            const i = this.grid.cellAt(x, z)
            if (i < 0 || this.grid.solid(i) || this.grid.occupant[i]! >= 0) continue
            const m = this.minutes
            const roll = this.rng()
            let reward: Cost
            if (roll < 0.4 || this.keepLevel < 2) reward = { gold: Math.round(90 + m * 14), wood: Math.round(40 + m * 6) }
            else if (roll < 0.7) reward = { stone: Math.round(40 + m * 6), wood: Math.round(60 + m * 8) }
            else reward = { crystal: Math.round(10 + m * 1.5), gold: Math.round(60 + m * 8) }
            const cx = Math.floor(x) + 0.5
            const cz = Math.floor(z) + 0.5
            const l: Loot = { id: this.nextId++, x: cx, z: cz, expiresAt: this.time + LOOT.lifetime, reward }
            this.loot.push(l)
            this.events.push({ type: 'loot-spawned', id: l.id, x: l.x, z: l.z })
            return
        }
    }

    private checkLoot(): void {
        let w = 0
        for (const l of this.loot) {
            const finder = this.nearestUnit(l.x, l.z, LOOT.pickup, PLAYER)
            if (finder) {
                this.gain(l.reward)
                this.events.push({ type: 'loot-collected', id: l.id, x: l.x, z: l.z, reward: l.reward })
                continue
            }
            if (this.time >= l.expiresAt) {
                this.events.push({ type: 'loot-expired', id: l.id, x: l.x, z: l.z })
                continue
            }
            this.loot[w++] = l
        }
        this.loot.length = w
    }

    // ─── Friendly soldiers ───────────────────────────────────────────────

    private advancePack(pack: Pack, dt: number): void {
        const target = pack.path[pack.pathIndex]
        if (!target) {
            pack.moving = false
            return
        }
        // March at the pace of the slowest soldier, and wait for stragglers.
        let lag = 0
        let rallied = false
        pack.unitIds.forEach((id, k) => {
            const u = this.unitById.get(id)
            const o = pack.marchOffsets[k]
            if (!u || !o) return
            if (u.rallyUntil > this.time) rallied = true
            lag = Math.max(lag, Math.hypot(u.x - (pack.leaderX + o.x), u.z - (pack.leaderZ + o.z)))
        })
        const speed = UNITS[pack.kind].speed * 0.9 * (lag > 2.5 ? 0.35 : 1) * (rallied ? RALLY_SPEED : 1)
        const dx = target.x - pack.leaderX
        const dz = target.z - pack.leaderZ
        const d = Math.hypot(dx, dz)
        const step = speed * dt
        if (d <= step) {
            pack.leaderX = target.x
            pack.leaderZ = target.z
            pack.pathIndex++
            if (pack.pathIndex >= pack.path.length) pack.moving = false
        } else {
            pack.leaderX += dx / d * step
            pack.leaderZ += dz / d * step
        }
        if (!pack.moving) {
            for (const id of pack.unitIds) {
                const u = this.unitById.get(id)
                if (u) u.moving = false
            }
        }
    }

    private marchInPack(u: Unit, pack: Pack, dt: number): void {
        u.targetUnit = -1
        const k = pack.unitIds.indexOf(u.id)
        const o = pack.marchOffsets[k] ?? { x: 0, z: 0 }
        let gx = pack.leaderX + o.x
        let gz = pack.leaderZ + o.z
        if (!this.walkable(u, gx, gz)) {
            gx = pack.leaderX
            gz = pack.leaderZ
        }
        this.moveToward(u, gx, gz, dt, 0.05)
    }

    /** Attack range including walls and watchtower auras. */
    private rangeOf(u: Unit): number {
        if (u.kind !== 'archer') return u.range
        return u.range + (u.elevated ? WALL_RANGE_BONUS : 0) + (u.bonus > 1 ? TOWER_AURA.range : 0)
    }

    private nearTower(x: number, z: number): boolean {
        const r2 = TOWER_AURA.radius * TOWER_AURA.radius
        for (const t of this.towerList) {
            if (!t.alive) continue
            if ((t.cx + t.size / 2 - x) ** 2 + (t.cz + t.size / 2 - z) ** 2 <= r2) return true
        }
        return false
    }

    private thinkFriendly(u: Unit, pack: Pack | undefined, dt: number): void {
        u.cooldown -= dt
        u.scan -= dt
        if (pack?.moving && u.moving) {
            this.marchInPack(u, pack, dt)
            return
        }
        if (u.moving && Math.hypot(u.x - u.slotX, u.z - u.slotZ) < 0.2) u.moving = false
        const ranged = u.kind === 'archer'
        const holdWall = ranged && pack?.wallBound === true && u.elevated

        if (u.scan <= 0) {
            u.scan = 0.25
            if (ranged) {
                u.bonus = this.nearTower(u.x, u.z) ? 1 + TOWER_AURA.damage : 1
                u.targetUnit = this.rangedTarget(u, this.rangeOf(u), holdWall ? 0 : UNITS[u.kind].leash)?.id ?? -1
            } else {
                u.targetUnit = this.meleeTarget(u, pack)?.id ?? -1
            }
        }

        const t = u.targetUnit >= 0 ? this.unitById.get(u.targetUnit) : undefined
        if (t?.alive) {
            const d = Math.hypot(t.x - u.x, t.z - u.z)
            const range = this.rangeOf(u)
            const reach = ranged ? range : range + u.radius + t.radius
            u.angle = turnToward(u.angle, Math.atan2(t.x - u.x, t.z - u.z), dt * 10)
            if (d <= reach) {
                if (u.cooldown <= 0) this.attackUnit(u, t)
                return
            }
            if (holdWall) return
            if (!ranged && u.via >= 0) {
                const n = this.grid.size
                const gx = u.via % n + 0.5
                const gz = Math.floor(u.via / n) + 0.5
                if (Math.hypot(u.x - gx, u.z - gz) > 0.35) {
                    this.moveToward(u, gx, gz, dt, 0.05)
                    return
                }
                u.via = -1
            }
            this.moveToward(u, t.x, t.z, dt, reach * 0.85)
            return
        }
        u.targetUnit = -1
        u.via = -1
        this.moveToward(u, u.slotX, u.slotZ, dt, 0.04)
        if (Math.hypot(u.x - u.slotX, u.z - u.slotZ) < 0.1 && pack) u.angle = turnToward(u.angle, pack.facing, dt * 4)
    }

    /**
     * How urgent a raider is for our shooters: the closer it is to the keep
     * (by the raiders' own flow field), the more it matters. Raiders hitting
     * our walls, siege engines and archers jump the queue; ones already doomed
     * by arrows in flight drop to the back.
     */
    private threatScore(e: Unit, d: number): number {
        const cell = this.grid.cellAt(e.x, e.z)
        const f = cell >= 0 ? Math.min(this.grid.flow[cell]!, 300) : 300
        let s = d + f * 0.3
        if (e.targetBuilding >= 0) s -= 2
        if (e.kind === 'catapult') s -= 6
        else if (e.kind === 'archer') s -= 1
        else if (e.kind === 'ram') s += 3
        else if (e.kind === 'siegetower') s += e.docked ? -2 : 2
        if (this.packs.get(e.packId)?.routed) s += 4
        if (e.incoming >= e.hp) s += 60
        return s
    }

    private rangedTarget(u: Unit, range: number, leash: number): Unit | null {
        const r = leash > 0 ? Math.max(range, UNITS[u.kind].aggro) + 1 : range
        const count = this.gather(u.x, u.z, r, ENEMY)
        const lim = (leash + range) ** 2
        let best: Unit | null = null
        let bestS = Infinity
        for (let q = 0; q < count; q++) {
            const e = this.units[this.qBuf[q]!]!
            if (leash > 0 && this.distSq(e.x, e.z, u.slotX, u.slotZ) > lim) continue
            const d = Math.sqrt(this.distSq(e.x, e.z, u.x, u.z))
            let s = this.threatScore(e, d)
            if (d > range) s += 4 + (d - range) * 2
            if (e.id === u.targetUnit) s -= 1.5
            if (s < bestS) {
                bestS = s
                best = e
            }
        }
        return best
    }

    /** Best target for a keep or tower shot. */
    private towerTarget(x: number, z: number, range: number, exclude: number): Unit | null {
        const count = this.gather(x, z, range, ENEMY)
        let best: Unit | null = null
        let bestS = Infinity
        for (let q = 0; q < count; q++) {
            const e = this.units[this.qBuf[q]!]!
            if (e.id === exclude) continue
            const s = this.threatScore(e, Math.sqrt(this.distSq(e.x, e.z, x, z)))
            if (s < bestS) {
                bestS = s
                best = e
            }
        }
        return best
    }

    /**
     * A melee defender's pick: the nearest raider it can actually get at,
     * straight there or out through a gate near its post. Knights hunt siege
     * engines first.
     */
    private meleeTarget(u: Unit, pack: Pack | undefined): Unit | null {
        const def = UNITS[u.kind]
        const leash = pack?.gateBound ? 2.5 : def.leash
        const reach = u.range + u.radius + 0.3
        const lim = (leash + reach) ** 2
        const cur = u.targetUnit >= 0 ? this.unitById.get(u.targetUnit) : undefined
        if (cur?.alive && this.distSq(cur.x, cur.z, u.slotX, u.slotZ) <= lim && this.meleeRoute(u, cur, leash, reach)) return cur
        u.via = -1
        const count = this.gather(u.x, u.z, def.aggro + (u.kind === 'knight' ? 3 : 1), ENEMY)
        const buf = this.qBuf
        for (let attempt = 0; attempt < 4; attempt++) {
            let best = -1
            let bestS = Infinity
            for (let q = 0; q < count; q++) {
                const k = buf[q]!
                if (k < 0) continue
                const e = this.units[k]!
                if (this.distSq(e.x, e.z, u.slotX, u.slotZ) > lim) {
                    buf[q] = -1
                    continue
                }
                let s = Math.sqrt(this.distSq(e.x, e.z, u.x, u.z))
                if (e.kind === 'catapult') s -= u.kind === 'knight' ? 8 : 3
                else if (e.kind === 'ram') s -= 6
                else if (e.kind === 'siegetower') s -= e.docked ? 8 : 5
                if (e.targetBuilding >= 0) s -= 1
                if (s < bestS) {
                    bestS = s
                    best = q
                }
            }
            if (best < 0) return null
            const e = this.units[buf[best]!]!
            buf[best] = -1
            if (this.meleeRoute(u, e, leash, reach)) return e
        }
        return null
    }

    /** Can this melee soldier get at the raider? Sets u.via when the way is through a gate. */
    private meleeRoute(u: Unit, e: Unit, leash: number, reach: number): boolean {
        if (Math.hypot(e.x - u.x, e.z - u.z) <= reach + 0.15 || this.lineWalkable(u.x, u.z, e.x, e.z, u.kind, reach * 0.8)) {
            u.via = -1
            return true
        }
        const g = this.gateRoute(u, e, leash)
        u.via = g
        return g >= 0
    }

    /** A gate near this soldier's post it can walk through to reach a raider outside. */
    private gateRoute(u: Unit, e: Unit, leash: number): number {
        let best = -1
        let bestD = Infinity
        const lim = (leash + 1) ** 2
        for (const g of this.gateList) {
            if (!g.alive) continue
            const gx = g.cx + 0.5
            const gz = g.cz + 0.5
            if (this.distSq(gx, gz, e.x, e.z) > 16 || this.distSq(gx, gz, u.slotX, u.slotZ) > lim) continue
            const d = Math.hypot(gx - u.x, gz - u.z) + Math.hypot(e.x - gx, e.z - gz)
            if (d >= bestD) continue
            if (!this.lineWalkable(u.x, u.z, gx, gz, u.kind) || !this.lineWalkable(gx, gz, e.x, e.z, u.kind, 0.9)) continue
            best = this.grid.idx(g.cx, g.cz)
            bestD = d
        }
        return best
    }

    // ─── Raiders ─────────────────────────────────────────────────────────

    private thinkEnemy(u: Unit, pack: Pack | undefined, dt: number): void {
        u.cooldown -= dt
        u.scan -= dt
        if (pack?.routed) {
            this.flee(u, pack, dt)
            return
        }
        const ranged = u.kind === 'archer'
        if (u.scan <= 0) {
            u.scan = 0.3
            const t = ranged ? this.enemyRangedTarget(u) : this.enemyMeleeTarget(u, pack)
            u.targetUnit = t?.id ?? -1
            u.targetBuilding = t ? -1 : this.pickSiegeTarget(u, pack)
        }

        const t = u.targetUnit >= 0 ? this.unitById.get(u.targetUnit) : undefined
        if (t?.alive) {
            const d = Math.hypot(t.x - u.x, t.z - u.z)
            const reach = ranged ? u.range : u.range + u.radius + t.radius
            u.angle = turnToward(u.angle, Math.atan2(t.x - u.x, t.z - u.z), dt * 10)
            if (d <= reach) {
                if (u.cooldown <= 0) this.attackUnit(u, t)
                return
            }
            this.moveToward(u, t.x, t.z, dt, reach * 0.85)
            return
        }
        const b = u.targetBuilding >= 0 ? this.buildingById.get(u.targetBuilding) : undefined
        if (b?.alive) {
            const d = distToRect(u.x, u.z, b)
            const reach = ranged ? u.range : u.range + u.radius + 0.1
            if (d <= reach) {
                u.angle = turnToward(u.angle, Math.atan2(b.cx + b.size / 2 - u.x, b.cz + b.size / 2 - u.z), dt * 10)
                if (u.cooldown <= 0) this.attackBuilding(u, b)
                if (pack && pack.siegeTarget === b.id) pack.siegeAt = this.time
                return
            }
            // Crowded out of the breach: widen it with a segment beside it.
            if (!ranged && d < 1.9) {
                const side = this.besideBreach(u, b, reach)
                if (side) {
                    u.angle = turnToward(u.angle, Math.atan2(side.cx + 0.5 - u.x, side.cz + 0.5 - u.z), dt * 10)
                    if (u.cooldown <= 0) this.attackBuilding(u, side)
                    return
                }
            }
            if (ranged || d < 6) {
                const px = Math.max(b.cx, Math.min(b.cx + b.size, u.x))
                const pz = Math.max(b.cz, Math.min(b.cz + b.size, u.z))
                this.moveToward(u, px, pz, dt, ranged ? reach * 0.9 : reach * 0.6)
                return
            }
        }
        this.march(u, pack, dt)
    }

    /** A raider bowman's pick: archers on our walls first, and nobody already doomed. */
    private enemyRangedTarget(u: Unit): Unit | null {
        const count = this.gather(u.x, u.z, u.range + 0.5, PLAYER)
        let best: Unit | null = null
        let bestS = Infinity
        for (let q = 0; q < count; q++) {
            const e = this.units[this.qBuf[q]!]!
            let s = Math.sqrt(this.distSq(e.x, e.z, u.x, u.z))
            if (e.elevated) s -= 2.5
            if (e.kind === 'catapult') s -= 3
            else if (e.kind === 'archer') s -= 0.5
            if (e.incoming >= e.hp) s += 40
            if (e.id === u.targetUnit) s -= 1
            if (s < bestS) {
                bestS = s
                best = e
            }
        }
        return best
    }

    /** A raider brawler's pick: a defender it can walk up to (never through a wall). */
    private enemyMeleeTarget(u: Unit, pack: Pack | undefined): Unit | null {
        const trait = TRAITS[pack?.trait ?? 'none']
        const reach = u.range + u.radius + 0.3
        const aggro = UNITS[u.kind].aggro * 0.8
        const cur = u.targetUnit >= 0 ? this.unitById.get(u.targetUnit) : undefined
        if (cur?.alive && (!cur.elevated || u.elevated)) {
            const d = Math.hypot(cur.x - u.x, cur.z - u.z)
            if (d <= reach + 0.15 || (d < aggro + 2 && !trait.walls && this.lineOpenEnemy(u.x, u.z, cur.x, cur.z, reach * 0.8))) return cur
        }
        const r = trait.walls ? reach + 0.4 : aggro
        const count = this.gather(u.x, u.z, r, PLAYER)
        const buf = this.qBuf
        for (let attempt = 0; attempt < 3; attempt++) {
            let best = -1
            let bestD = Infinity
            for (let q = 0; q < count; q++) {
                const k = buf[q]!
                if (k < 0) continue
                const e = this.units[k]!
                if (e.elevated && !u.elevated) {
                    buf[q] = -1
                    continue
                }
                const d = this.distSq(e.x, e.z, u.x, u.z)
                if (d < bestD) {
                    bestD = d
                    best = q
                }
            }
            if (best < 0) return null
            const e = this.units[buf[best]!]!
            buf[best] = -1
            if (Math.sqrt(bestD) <= reach + 0.15 || this.lineOpenEnemy(u.x, u.z, e.x, e.z, reach * 0.8)) return e
        }
        return null
    }

    /**
     * What a raider should hit when no soldier is in reach: the structure
     * blocking its path (looked ahead by bow range for archers), focused on
     * the pack's chosen breach; else a non-wall building close by.
     */
    private pickSiegeTarget(u: Unit, pack: Pack | undefined): number {
        const cell = this.grid.cellAt(u.x, u.z)
        const ranged = u.kind === 'archer' || u.kind === 'catapult'
        let blocking: Building | undefined
        if (cell >= 0) {
            let c = cell
            const look = ranged ? Math.floor(u.range) : 1
            for (let s = 0; s < look; s++) {
                const next = flowNext(this.grid, c, this.enemyOpen)
                if (next < 0) break
                const b = this.enemyWall[next] === 1 ? undefined : this.buildingAtCell(next)
                if (b) {
                    blocking = b
                    break
                }
                c = next
            }
        }
        if (blocking) {
            if (!pack) return blocking.id
            const near = ranged ? u.range : 5
            const focus = pack.siegeTarget >= 0 ? this.buildingById.get(pack.siegeTarget) : undefined
            if (focus?.alive && this.time - pack.siegeAt < FOCUS_STALE) {
                return distToRect(u.x, u.z, focus) < near ? focus.id : blocking.id
            }
            const choice = this.chooseBreach(blocking)
            pack.siegeTarget = choice.id
            pack.siegeAt = this.time
            return distToRect(u.x, u.z, choice) < near ? choice.id : blocking.id
        }
        const raid = ranged ? u.range * 0.8 : 2
        let best = -1
        let bestD = raid
        for (const b of this.buildings) {
            if (BUILDINGS[b.kind].segment) continue
            const d = distToRect(u.x, u.z, b)
            if (d < bestD) {
                bestD = d
                best = b.id
            }
        }
        return best
    }

    /**
     * Where a pack breaks in: cunning raiders look along the wall for the
     * weakest segment facing them (a damaged one, a gate with nobody on it)
     * instead of the one straight ahead.
     */
    private chooseBreach(b: Building): Building {
        if (!BUILDINGS[b.kind].segment || this.rng() >= this.difficulty.cunning) return b
        const n = this.grid.size
        const flow = this.grid.flow
        const fb = flow[this.grid.idx(b.cx, b.cz)]!
        let best = b
        let bestS = this.breachScore(b)
        for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
                if (dx === 0 && dz === 0) continue
                const x = b.cx + dx
                const z = b.cz + dz
                if (x < 0 || z < 0 || x >= n || z >= n) continue
                const o = this.buildingAtCell(z * n + x)
                if (!o || !BUILDINGS[o.kind].segment) continue
                // Only segments on the raiders' side: an open neighbour at least as far out.
                let facesOut = false
                for (let d = 0; d < 4 && !facesOut; d++) {
                    const nx = x + DX[d]!
                    const nz = z + DZ[d]!
                    if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue
                    const ni = nz * n + nx
                    if (this.enemyOpen(ni) && flow[ni]! >= fb - 1) facesOut = true
                }
                if (!facesOut) continue
                const s = this.breachScore(o)
                if (s < bestS) {
                    bestS = s
                    best = o
                }
            }
        }
        return best
    }

    private breachScore(b: Building): number {
        return b.hp + 90 * this.countNear(b.cx + 0.5, b.cz + 0.5, 1.6, PLAYER)
    }

    /** A wall segment next to the pack's breach that this raider can reach. */
    private besideBreach(u: Unit, focus: Building, reach: number): Building | null {
        const n = this.grid.size
        const cx = Math.floor(u.x)
        const cz = Math.floor(u.z)
        const fx = focus.cx + focus.size / 2
        const fz = focus.cz + focus.size / 2
        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                const x = cx + dx
                const z = cz + dz
                if (x < 0 || z < 0 || x >= n || z >= n) continue
                const o = this.buildingAtCell(z * n + x)
                if (!o || o === focus || !BUILDINGS[o.kind].segment) continue
                if ((o.cx + 0.5 - fx) ** 2 + (o.cz + 0.5 - fz) ** 2 > 2.6) continue
                if (distToRect(u.x, u.z, o) <= reach) return o
            }
        }
        return null
    }

    /**
     * March down the flow field toward the keep (or along a flanking route
     * first), aiming two cells ahead when the way is clear so crowds round
     * wall ends instead of grinding.
     */
    private march(u: Unit, pack: Pack | undefined, dt: number): void {
        if (u.wp >= 0 && pack?.flank && this.followFlank(u, pack.flank, dt)) return
        const cell = this.grid.cellAt(u.x, u.z)
        const next = cell >= 0 ? flowNext(this.grid, cell, this.enemyOpen) : -1
        if (next >= 0) {
            const n = this.grid.size
            let tx = next % n + 0.5
            let tz = Math.floor(next / n) + 0.5
            const next2 = this.enemyOpen(next) ? flowNext(this.grid, next, this.enemyOpen) : -1
            if (next2 >= 0 && this.enemyOpen(next2)) {
                const x2 = next2 % n + 0.5
                const z2 = Math.floor(next2 / n) + 0.5
                const mx = (u.x + x2) / 2
                const mz = (u.z + z2) / 2
                if (this.enemyOpen(this.grid.cellAt(mx, mz))) {
                    tx = x2
                    tz = z2
                }
            }
            this.moveToward(u, tx, tz, dt, 0)
        } else {
            const k = this.keepCenter
            this.moveToward(u, k.x, k.z, dt, 0)
        }
    }

    private followFlank(u: Unit, route: number[], dt: number): boolean {
        const n = this.grid.size
        let wp = u.wp
        // Skip ahead to just past the furthest nearby waypoint.
        for (let k = Math.min(route.length - 1, wp + 4); k >= wp; k--) {
            const c = route[k]!
            if ((c % n + 0.5 - u.x) ** 2 + (Math.floor(c / n) + 0.5 - u.z) ** 2 < 1.2) {
                wp = k + 1
                break
            }
        }
        if (wp >= route.length) {
            u.wp = -1
            return false
        }
        const c = route[wp]!
        if (!this.enemyOpen(c)) {
            u.wp = -1
            return false
        }
        u.wp = wp
        this.moveToward(u, c % n + 0.5, Math.floor(c / n) + 0.5, dt, 0)
        return true
    }

    /** A broken raider runs back up the flow field and slips away at the edge. */
    private flee(u: Unit, pack: Pack, dt: number): void {
        const lane = this.difficulty.lanes[pack.lane]
        const n = this.grid.size
        const k = this.keepCenter
        const far = Math.hypot(u.x - k.x, u.z - k.z) > this.territory + 12
        if (!lane || far || this.time - pack.routedAt > 25 || Math.hypot(u.x - lane.x, u.z - lane.z) < 3
            || u.x < 1.2 || u.z < 1.2 || u.x > n - 1.2 || u.z > n - 1.2) {
            u.alive = false
            return
        }
        const cell = this.grid.cellAt(u.x, u.z)
        const cx = cell % n
        const cz = (cell - cx) / n
        const flow = this.grid.flow
        let best = -1
        let bestV = flow[cell]!
        for (let d = 0; d < 8; d++) {
            const nx = cx + DX[d]!
            const nz = cz + DZ[d]!
            if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue
            const ni = nz * n + nx
            const v = flow[ni]!
            if (!this.enemyOpen(ni) || !Number.isFinite(v)) continue
            if (d >= 4 && (!this.enemyOpen(cz * n + nx) || !this.enemyOpen(nz * n + cx))) continue
            if (v > bestV) {
                bestV = v
                best = ni
            }
        }
        if (best >= 0) this.moveToward(u, best % n + 0.5, Math.floor(best / n) + 0.5, dt, 0)
        else this.moveToward(u, lane.x + 0.5, lane.z + 0.5, dt, 0)
    }

    // ─── Siege engines ───────────────────────────────────────────────────

    private thinkCatapult(u: Unit, pack: Pack | undefined, dt: number): void {
        u.cooldown -= dt
        u.scan -= dt
        const minR = UNITS.catapult.minRange
        if (u.side === PLAYER) {
            if (pack?.moving && u.moving) {
                this.marchInPack(u, pack, dt)
                return
            }
            if (u.moving && Math.hypot(u.x - u.slotX, u.z - u.slotZ) < 0.2) u.moving = false
            if (u.scan <= 0) {
                u.scan = 0.5
                u.targetUnit = this.boulderTarget(u, ENEMY)?.id ?? -1
            }
            const t = u.targetUnit >= 0 ? this.unitById.get(u.targetUnit) : undefined
            if (t?.alive) {
                const d = Math.hypot(t.x - u.x, t.z - u.z)
                u.angle = turnToward(u.angle, Math.atan2(t.x - u.x, t.z - u.z), dt * 3)
                if (d <= u.range && d >= minR && u.cooldown <= 0) this.lobBoulder(u, t.x, t.z, t, null)
                if (d <= u.range + 0.5) return
            }
            u.targetUnit = -1
            this.moveToward(u, u.slotX, u.slotZ, dt, 0.04)
            if (Math.hypot(u.x - u.slotX, u.z - u.slotZ) < 0.1 && pack) u.angle = turnToward(u.angle, pack.facing, dt * 2)
            return
        }
        if (pack?.routed) {
            this.flee(u, pack, dt)
            return
        }
        if (u.scan <= 0) {
            u.scan = 0.5
            u.targetBuilding = this.catapultSiegeTarget(u)
            u.targetUnit = u.targetBuilding < 0 ? this.boulderTarget(u, PLAYER)?.id ?? -1 : -1
        }
        const b = u.targetBuilding >= 0 ? this.buildingById.get(u.targetBuilding) : undefined
        if (b?.alive && distToRect(u.x, u.z, b) <= u.range) {
            const bx = b.cx + b.size / 2
            const bz = b.cz + b.size / 2
            u.angle = turnToward(u.angle, Math.atan2(bx - u.x, bz - u.z), dt * 3)
            if (u.cooldown <= 0) this.lobBoulder(u, bx, bz, null, b)
            return
        }
        const t = u.targetUnit >= 0 ? this.unitById.get(u.targetUnit) : undefined
        if (t?.alive) {
            const d = Math.hypot(t.x - u.x, t.z - u.z)
            if (d <= u.range && d >= minR) {
                u.angle = turnToward(u.angle, Math.atan2(t.x - u.x, t.z - u.z), dt * 3)
                if (u.cooldown <= 0) this.lobBoulder(u, t.x, t.z, t, null)
                return
            }
        }
        this.march(u, pack, dt)
    }

    /** A raider catapult's pick: towers in range, then the wall in its way, then any building. */
    private catapultSiegeTarget(u: Unit): number {
        let best = -1
        let bestD = u.range
        for (const t of this.towerList) {
            if (!t.alive) continue
            const d = distToRect(u.x, u.z, t)
            if (d < bestD) {
                bestD = d
                best = t.id
            }
        }
        if (best >= 0) return best
        const blocking = this.pickSiegeTarget(u, undefined)
        if (blocking >= 0) return blocking
        bestD = u.range
        for (const b of this.buildings) {
            if (BUILDINGS[b.kind].segment) continue
            const d = distToRect(u.x, u.z, b)
            if (d < bestD) {
                bestD = d
                best = b.id
            }
        }
        return best
    }

    /** Where a boulder does the most good: the thickest knot of targets, siege engines first. */
    private boulderTarget(u: Unit, side: Side): Unit | null {
        const count = this.gather(u.x, u.z, u.range, side)
        if (count === 0) return null
        const minR2 = UNITS.catapult.minRange ** 2
        const stride = Math.max(1, Math.ceil(count / 24))
        const splash = Math.max(0.8, u.splash)
        let best: Unit | null = null
        let bestS = -Infinity
        for (let q = 0; q < count; q += stride) {
            const e = this.units[this.qBuf[q]!]!
            if (this.distSq(e.x, e.z, u.x, u.z) < minR2) continue
            let s = this.countNear(e.x, e.z, splash, side)
            if (e.kind === 'catapult' || e.kind === 'ram' || e.kind === 'siegetower') s += 5
            if (e.elevated) s += 1
            if (e.id === u.targetUnit) s += 0.5
            if (s > bestS) {
                bestS = s
                best = e
            }
        }
        return best
    }

    private lobBoulder(u: Unit, tx: number, tz: number, unit: Unit | null, building: Building | null): void {
        u.cooldown = UNITS.catapult.cooldown * (0.9 + this.rng() * 0.2) / (u.rallyUntil > this.time ? RALLY_HASTE : 1)
        u.lastAttackAt = this.time
        const d = Math.hypot(tx - u.x, tz - u.z)
        const flight = Math.max(0.7, d / BOULDER_SPEED)
        let ax = tx
        let az = tz
        if (unit) {
            ax += (unit.x - unit.px) / TICK * flight * 0.8
            az += (unit.z - unit.pz) / TICK * flight * 0.8
        }
        const spread = building ? 0.1 : 0.15 + d * 0.035
        ax += rngRange(this.rng, -spread, spread)
        az += rngRange(this.rng, -spread, spread)
        const toY = building ? (BUILDINGS[building.kind].segment ? WALL_HEIGHT * 0.8 : 1.2) : 0.1
        const rally = u.rallyUntil > this.time ? RALLY_DAMAGE : 1
        this.arrows.push({
            id: this.nextId++,
            side: u.side,
            fromX: u.x,
            fromY: 1.1,
            fromZ: u.z,
            toX: ax,
            toY,
            toZ: az,
            targetUnit: -1,
            targetBuilding: building?.id ?? -1,
            damage: u.damage * rally,
            t: 0,
            duration: flight,
            fire: false,
            projectile: 'boulder',
            splash: Math.max(0.8, u.splash),
            structureDamage: u.siege * rally
        })
        this.events.push({ type: 'shoot', x: u.x, z: u.z, side: u.side, projectile: 'boulder' })
    }

    // ─── War machines ────────────────────────────────────────────────────

    /**
     * Rams and siege towers ignore soldiers. A ram trundles down the raiders'
     * route and batters the first gate (or wall) in its way; a siege tower
     * parks against a wall and lowers a bridge that lets raiders climb it.
     */
    private thinkMachine(u: Unit, pack: Pack | undefined, dt: number): void {
        u.cooldown -= dt
        u.scan -= dt
        if (u.docked) {
            const wall = this.buildingById.get(u.targetBuilding)
            if (!wall?.alive) {
                u.docked = false
                u.deploy = 0
                u.targetBuilding = -1
                this.rampsDirty = true
                return
            }
            if (u.deploy < 1) {
                u.deploy = Math.min(1, u.deploy + dt / SIEGE_TOWER.deploy)
                if (u.deploy >= 1) this.rampsDirty = true
            }
            return
        }
        if (u.scan <= 0) {
            u.scan = 0.5
            u.targetBuilding = u.kind === 'ram' ? this.ramTarget(u) : this.dockTarget(u)
        }
        const b = u.targetBuilding >= 0 ? this.buildingById.get(u.targetBuilding) : undefined
        if (b?.alive) {
            const d = distToRect(u.x, u.z, b)
            const bx = b.cx + b.size / 2
            const bz = b.cz + b.size / 2
            if (u.kind === 'ram') {
                const reach = u.range + u.radius + 0.1
                if (d <= reach) {
                    u.angle = turnToward(u.angle, Math.atan2(bx - u.x, bz - u.z), dt * 3)
                    if (u.cooldown <= 0) {
                        u.cooldown = UNITS.ram.cooldown
                        u.lastAttackAt = this.time
                        this.damageBuilding(b, u.siege)
                        this.events.push({ type: 'ram-hit', id: b.id, x: bx, z: bz })
                    }
                    return
                }
                if (d < 6) {
                    const px = Math.max(b.cx, Math.min(b.cx + b.size, u.x))
                    const pz = Math.max(b.cz, Math.min(b.cz + b.size, u.z))
                    this.moveToward(u, px, pz, dt, reach * 0.7)
                    return
                }
            } else {
                if (d <= u.radius + 0.2) {
                    u.docked = true
                    u.deploy = 0
                    u.angle = Math.atan2(bx - u.x, bz - u.z)
                    this.events.push({ type: 'tower-docked', unitId: u.id, x: u.x, z: u.z, wallId: b.id })
                    return
                }
                if (d < 6) {
                    const spot = this.dockSpot(b)
                    if (spot) this.moveToward(u, spot.x, spot.z, dt, 0)
                    else this.moveToward(u, bx, bz, dt, u.radius)
                    return
                }
            }
        }
        this.march(u, pack, dt)
    }

    /** The first structure down the raiders' route from a unit, `look` cells ahead. */
    private blockingAhead(u: Unit, look: number): Building | undefined {
        let c = this.grid.cellAt(u.x, u.z)
        if (c < 0) return undefined
        for (let s = 0; s < look; s++) {
            const next = flowNext(this.grid, c, this.enemyOpen)
            if (next < 0) return undefined
            const b = this.enemyWall[next] === 1 ? undefined : this.buildingAtCell(next)
            if (b) return b
            c = next
        }
        return undefined
    }

    /** The nearest segment to `b` on the raiders' side of the wall that passes `ok`, or null. */
    private segmentNear(b: Building, r: number, ok: (o: Building) => boolean): Building | null {
        const n = this.grid.size
        const flow = this.grid.flow
        const fb = flow[this.grid.idx(b.cx, b.cz)]!
        let best: Building | null = null
        let bestD = Infinity
        for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
                const x = b.cx + dx
                const z = b.cz + dz
                if (x < 0 || z < 0 || x >= n || z >= n) continue
                const i = z * n + x
                const o = this.buildingAtCell(i)
                if (!o || !ok(o) || this.enemyWall[i] === 1) continue
                let facesOut = false
                for (let d = 0; d < 4 && !facesOut; d++) {
                    const nx = x + DX[d]!
                    const nz = z + DZ[d]!
                    if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue
                    const ni = nz * n + nx
                    if (this.grid.occupant[ni]! < 0 && !this.grid.solid(ni) && flow[ni]! >= fb - 1) facesOut = true
                }
                if (!facesOut) continue
                const dd = dx * dx + dz * dz
                if (dd < bestD) {
                    bestD = dd
                    best = o
                }
            }
        }
        return best
    }

    /** A ram goes for a gate if there is one close to where its route meets the wall. */
    private ramTarget(u: Unit): number {
        const b = this.blockingAhead(u, 4)
        if (!b) {
            const k = this.keep
            return distToRect(u.x, u.z, k) < 2 ? k.id : -1
        }
        if (b.kind === 'gate' || !BUILDINGS[b.kind].segment) return b.id
        return (this.segmentNear(b, 3, o => o.kind === 'gate') ?? b).id
    }

    /** A siege tower wants a plain wall segment (not a gate) on its route. */
    private dockTarget(u: Unit): number {
        const b = this.blockingAhead(u, 5)
        if (!b || !BUILDINGS[b.kind].segment) return -1
        if (b.kind === 'wall') return b.id
        return this.segmentNear(b, 3, o => o.kind === 'wall')?.id ?? -1
    }

    /** The open cell on the raiders' side of a wall segment, where a siege tower parks. */
    private dockSpot(b: Building): { x: number, z: number } | null {
        const n = this.grid.size
        const flow = this.grid.flow
        let best = -1
        let bestV = -Infinity
        for (let d = 0; d < 4; d++) {
            const nx = b.cx + DX[d]!
            const nz = b.cz + DZ[d]!
            if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue
            const ni = nz * n + nx
            if (this.grid.solid(ni) || this.grid.occupant[ni]! >= 0) continue
            const v = flow[ni]!
            if (Number.isFinite(v) && v > bestV) {
                bestV = v
                best = ni
            }
        }
        return best < 0 ? null : { x: best % n + 0.5, z: Math.floor(best / n) + 0.5 }
    }

    /** Mark the wall cells raiders can walk: a stretch of wall either side of each deployed siege tower. */
    private rebuildRamps(): void {
        const walls = this.enemyWall
        walls.fill(0)
        const n = this.grid.size
        let any = false
        const queue: number[] = []
        const depth: number[] = []
        for (const u of this.units) {
            if (!u.alive || u.kind !== 'siegetower' || !u.docked || u.deploy < 1) continue
            const wall = this.buildingById.get(u.targetBuilding)
            if (!wall?.alive) continue
            const start = this.grid.idx(wall.cx, wall.cz)
            if (walls[start] === 1) continue
            walls[start] = 1
            any = true
            queue.length = 0
            depth.length = 0
            queue.push(start)
            depth.push(0)
            for (let q = 0; q < queue.length; q++) {
                if (depth[q]! >= SIEGE_TOWER.reach) continue
                const c = queue[q]!
                const cx = c % n
                const cz = (c - cx) / n
                for (let d = 0; d < 8; d++) {
                    const nx = cx + DX[d]!
                    const nz = cz + DZ[d]!
                    if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue
                    const ni = nz * n + nx
                    if (walls[ni] === 1 || !this.isWallCell(ni)) continue
                    walls[ni] = 1
                    queue.push(ni)
                    depth.push(depth[q]! + 1)
                }
            }
        }
        this.rampsActive = any
        this.rampsDirty = false
        this.flowDirty = true
        this.popCheck = true
    }

    // ─── Combat ──────────────────────────────────────────────────────────

    private attackUnit(u: Unit, t: Unit): void {
        const rallied = u.rallyUntil > this.time
        u.cooldown = UNITS[u.kind].cooldown * (0.9 + this.rng() * 0.2) / (rallied ? RALLY_HASTE : 1)
        u.lastAttackAt = this.time
        const dmg = u.damage * u.bonus * (rallied ? RALLY_DAMAGE : 1)
        if (u.kind === 'archer') {
            this.fireArrow(u.side, u.x, (u.elevated ? WALL_HEIGHT : 0) + UNIT_CHEST + 0.2, u.z, t, null, dmg, false, 'arrow', u.elevated ? 0.8 : 1, 0)
            this.events.push({ type: 'shoot', x: u.x, z: u.z, side: u.side, projectile: 'arrow' })
        } else {
            this.damageUnit(t, dmg, u.x, u.z, u.knock, false)
            this.events.push({ type: 'hit', x: t.x, z: t.z, side: t.side, melee: true })
        }
    }

    private attackBuilding(u: Unit, b: Building): void {
        u.cooldown = UNITS[u.kind].cooldown * (0.9 + this.rng() * 0.2)
        u.lastAttackAt = this.time
        if (u.kind === 'archer') {
            this.fireArrow(u.side, u.x, UNIT_CHEST + 0.2, u.z, null, b, u.siege, false, 'arrow', 1, 0)
            this.events.push({ type: 'shoot', x: u.x, z: u.z, side: u.side, projectile: 'arrow' })
        } else {
            this.damageBuilding(b, u.siege)
        }
    }

    private buildingAttack(b: Building, dt: number): void {
        const atk = BUILDINGS[b.kind].attack!
        b.cooldown -= dt
        if (b.cooldown > 0) return
        const lvl = b.level - 1
        const range = atk.range[lvl] ?? atk.range[atk.range.length - 1]!
        const cx = b.cx + b.size / 2
        const cz = b.cz + b.size / 2
        const target = this.towerTarget(cx, cz, range + b.size / 2, -1)
        if (!target) {
            b.cooldown = 0.2
            return
        }
        const dmg = (atk.damage[lvl] ?? atk.damage[atk.damage.length - 1]!) * (1 + 0.3 * this.upgrades.fletching)
        const height = b.kind === 'keep' ? 3.6 : 3.1
        const bolt = (b.kind === 'tower' && b.level >= 2) || (b.kind === 'keep' && b.level >= 3)
        const projectile: Projectile = bolt ? 'bolt' : 'arrow'
        const splash = b.kind === 'tower' && b.level >= 4 ? 0.8 : 0
        const fire = this.upgrades.fletching > 0
        this.fireArrow(PLAYER, cx, height, cz, target, null, dmg, fire, projectile, 0.6, splash)
        if (b.kind === 'keep' && b.level >= 3) {
            const second = this.towerTarget(cx, cz, range + 2, target.id)
            if (second) this.fireArrow(PLAYER, cx, height, cz, second, null, dmg, fire, projectile, 0.6, 0)
        }
        b.cooldown = atk.cooldown
        b.lastAttackAt = this.time
        this.events.push({ type: 'shoot', x: cx, z: cz, side: PLAYER, projectile })
    }

    /**
     * Loose an arrow (or bolt) at a unit or building. Arrows at a unit on the
     * move can go wide; a stray lands on the ground and only hurts whoever is
     * standing there.
     */
    private fireArrow(side: Side, x: number, y: number, z: number, unit: Unit | null, building: Building | null, damage: number, fire: boolean, projectile: Projectile = 'arrow', accuracy = 1, splash = 0): void {
        if (building) {
            const tx = Math.max(building.cx + 0.2, Math.min(building.cx + building.size - 0.2, x))
            const tz = Math.max(building.cz + 0.2, Math.min(building.cz + building.size - 0.2, z))
            const ty = BUILDINGS[building.kind].segment ? WALL_HEIGHT * 0.8 : 1.2
            this.pushArrow(side, x, y, z, tx, ty, tz, -1, building.id, damage, fire, projectile, splash)
            return
        }
        if (!unit) return
        const d = Math.hypot(unit.x - x, unit.z - z)
        const vx = unit.x - unit.px
        const vz = unit.z - unit.pz
        const moving = vx * vx + vz * vz > 0.0004
        const miss = (BASE_MISS + (moving ? MOVING_MISS * Math.min(1, d / 8) : 0)) * accuracy
        if (this.rng() < miss) {
            const speed = projectile === 'bolt' ? BOLT_SPEED : ARROW_SPEED
            const flight = Math.max(0.18, d / speed)
            const a = this.rng() * Math.PI * 2
            const off = 0.55 + this.rng() * 0.7
            const tx = unit.x + vx / TICK * flight * 0.5 + Math.cos(a) * off
            const tz = unit.z + vz / TICK * flight * 0.5 + Math.sin(a) * off
            this.fireAt(side, x, y, z, tx, unit.elevated ? WALL_HEIGHT : 0.05, tz, damage, fire, projectile, splash)
            return
        }
        unit.incoming += damage * (1 - unit.armor)
        this.pushArrow(side, x, y, z, unit.x, (unit.elevated ? WALL_HEIGHT : 0) + UNIT_CHEST, unit.z, unit.id, -1, damage, fire, projectile, splash)
    }

    /** An arrow at a spot on the ground. */
    private fireAt(side: Side, x: number, y: number, z: number, tx: number, ty: number, tz: number, damage: number, fire: boolean, projectile: Projectile, splash: number): void {
        this.pushArrow(side, x, y, z, tx, ty, tz, -1, -1, damage, fire, projectile, splash)
    }

    private pushArrow(side: Side, x: number, y: number, z: number, tx: number, ty: number, tz: number, unitId: number, buildingId: number, damage: number, fire: boolean, projectile: Projectile, splash: number): void {
        const d = Math.hypot(tx - x, tz - z)
        const speed = projectile === 'bolt' ? BOLT_SPEED : ARROW_SPEED
        this.arrows.push({
            id: this.nextId++,
            side,
            fromX: x,
            fromY: y,
            fromZ: z,
            toX: tx,
            toY: ty,
            toZ: tz,
            targetUnit: unitId,
            targetBuilding: buildingId,
            damage,
            t: 0,
            duration: Math.max(0.18, d / speed),
            fire,
            projectile,
            splash,
            structureDamage: 0
        })
    }

    private updateArrows(dt: number): void {
        let w = 0
        const arrows = this.arrows
        for (let k = 0; k < arrows.length; k++) {
            const a = arrows[k]!
            a.t += dt
            const u = a.targetUnit >= 0 ? this.unitById.get(a.targetUnit) : undefined
            if (u?.alive) {
                a.toX = u.x
                a.toZ = u.z
                a.toY = (u.elevated ? WALL_HEIGHT : 0) + UNIT_CHEST
            }
            if (a.t < a.duration) {
                arrows[w++] = a
                continue
            }
            if (a.projectile === 'boulder') {
                this.landBoulder(a)
                continue
            }
            if (u) u.incoming = Math.max(0, u.incoming - a.damage * (1 - u.armor))
            const victim: Side = a.side === PLAYER ? ENEMY : PLAYER
            if (u?.alive) {
                this.damageUnit(u, a.damage, a.fromX, a.fromZ, a.projectile === 'bolt' ? 0.08 : 0.03, true)
                this.events.push({ type: 'hit', x: u.x, z: u.z, side: u.side, melee: false })
            } else if (a.targetBuilding >= 0) {
                const b = this.buildingById.get(a.targetBuilding)
                if (b?.alive) this.damageBuilding(b, a.damage)
            } else if (a.targetUnit < 0) {
                // A stray: it only hurts whoever it lands on.
                const lucky = this.nearestUnit(a.toX, a.toZ, 0.4, victim)
                if (lucky) {
                    this.damageUnit(lucky, a.damage, a.fromX, a.fromZ, 0.03, true)
                    this.events.push({ type: 'hit', x: lucky.x, z: lucky.z, side: lucky.side, melee: false })
                }
            }
            if (a.splash > 0) {
                const count = this.gather(a.toX, a.toZ, a.splash + 0.3, victim)
                for (let q = 0; q < count; q++) {
                    const e = this.units[this.qBuf[q]!]!
                    if (e === u || !e.alive) continue
                    this.damageUnit(e, a.damage * 0.5, a.toX, a.toZ, 0.12, true)
                }
                this.events.push({ type: 'impact', x: a.toX, z: a.toZ, radius: a.splash, side: a.side })
            }
        }
        arrows.length = w
    }

    private landBoulder(a: Arrow): void {
        const victim: Side = a.side === PLAYER ? ENEMY : PLAYER
        const x = a.toX
        const z = a.toZ
        if (a.side === ENEMY && a.structureDamage > 0) {
            const main = a.targetBuilding >= 0 ? this.buildingById.get(a.targetBuilding) : undefined
            if (main?.alive) this.damageBuilding(main, a.structureDamage)
            // The blast cracks the segments beside the one it hit.
            const n = this.grid.size
            const r = Math.ceil(a.splash)
            const cx = Math.floor(x)
            const cz = Math.floor(z)
            for (let dz = -r; dz <= r; dz++) {
                for (let dx = -r; dx <= r; dx++) {
                    const bx = cx + dx
                    const bz = cz + dz
                    if (bx < 0 || bz < 0 || bx >= n || bz >= n) continue
                    const o = this.buildingAtCell(bz * n + bx)
                    if (!o || o === main || o.cx !== bx || o.cz !== bz) continue
                    if (distToRect(x, z, o) <= a.splash * 0.6) this.damageBuilding(o, a.structureDamage * 0.4)
                }
            }
        }
        const count = this.gather(x, z, a.splash + 0.4, victim)
        for (let q = 0; q < count; q++) {
            const e = this.units[this.qBuf[q]!]!
            if (!e.alive) continue
            const d = Math.hypot(e.x - x, e.z - z)
            const fall = 1 - 0.6 * Math.min(1, d / (a.splash + e.radius))
            this.damageUnit(e, a.damage * fall, x, z, 0.3 * fall, false)
        }
        this.events.push({ type: 'impact', x, z, radius: a.splash, side: a.side })
    }

    private damageUnit(u: Unit, amount: number, fromX: number, fromZ: number, knock: number, ranged: boolean): void {
        if (!u.alive) return
        u.hp -= ranged ? amount * (1 - u.armor) : amount
        u.lastHitAt = this.time
        // Retaliate: an idle soldier who gets hit turns to face the attacker.
        if (u.targetUnit < 0) u.scan = 0
        if (u.hp <= 0) {
            u.alive = false
            this.events.push({ type: 'death', x: u.x, z: u.z, side: u.side, kind: u.kind, elevated: u.elevated })
            if (u.side === ENEMY) this.onKill(u)
            return
        }
        if (knock <= 0 || u.kind === 'catapult') return
        // Hits shove: heavy knights and anyone on a wall barely budge.
        const k = knock * (u.kind === 'knight' ? 0.45 : 1) * (u.elevated ? 0.2 : 1)
        const dx = u.x - fromX
        const dz = u.z - fromZ
        const d = Math.hypot(dx, dz) || 1
        const nx = u.x + dx / d * k
        const nz = u.z + dz / d * k
        if (this.walkable(u, nx, u.z)) u.x = nx
        if (this.walkable(u, u.x, nz)) u.z = nz
    }

    private onKill(u: Unit): void {
        this.stats.kills++
        const amount = KILL_BOUNTY[u.kind]
        this.gain({ gold: amount })
        this.events.push({ type: 'bounty', x: u.x, z: u.z, amount })
        this.streak = this.time - this.lastKillAt <= STREAK.window ? this.streak + 1 : 1
        this.lastKillAt = this.time
        if (this.streak > this.bestStreak) this.bestStreak = this.streak
        if ((STREAK.marks as readonly number[]).includes(this.streak)) {
            const bonus = this.streak * STREAK.goldPerKill
            this.gain({ gold: bonus })
            this.events.push({ type: 'streak', count: this.streak, bonus })
        }
    }

    private damageBuilding(b: Building, amount: number): void {
        if (!b.alive) return
        b.hp -= amount
        b.lastHitAt = this.time
        this.flowStale = true
        this.events.push({ type: 'building-hit', id: b.id })
        if (b.kind === 'keep') this.spoilWaves()
        if (b.hp <= 0) {
            b.hp = 0
            if (b.kind === 'keep') return
            this.removeBuilding(b)
            this.spoilWaves()
            this.events.push({ type: 'building-destroyed', id: b.id, kind: b.kind, cx: b.cx, cz: b.cz, size: b.size })
            if (BUILDINGS[b.kind].segment) this.events.push({ type: 'breach', id: b.id, kind: b.kind, cx: b.cx, cz: b.cz })
        }
    }

    /** A building fell or the keep was hit: no wave on the field can be a perfect defence now. */
    private spoilWaves(): void {
        for (const s of this.waveLive.values()) s.perfect = false
    }

    private waveCleared(wave: number, perfect: boolean): void {
        const mult = perfect ? WAVE_REWARD.perfect : 1
        const reward: Cost = {
            gold: Math.round((WAVE_REWARD.gold + WAVE_REWARD.goldPerWave * wave) * mult),
            wood: Math.round((WAVE_REWARD.wood + WAVE_REWARD.woodPerWave * wave) * mult)
        }
        this.gain(reward)
        this.wavesCleared++
        if (perfect) this.perfectWaves++
        this.events.push({ type: 'wave-cleared', wave, reward, perfect })
    }

    private moveToward(u: Unit, tx: number, tz: number, dt: number, stop: number): void {
        const dx = tx - u.x
        const dz = tz - u.z
        const d = Math.hypot(dx, dz)
        if (d <= stop + 1e-4) return
        const speed = u.speed * (u.rallyUntil > this.time ? RALLY_SPEED : 1)
        const step = Math.min(d - stop, speed * dt)
        const nx = u.x + dx / d * step
        const nz = u.z + dz / d * step
        let moved = false
        if (this.walkable(u, nx, u.z)) {
            u.x = nx
            moved = true
        }
        if (this.walkable(u, u.x, nz)) {
            u.z = nz
            moved = true
        }
        if (moved && d > 0.05) u.angle = turnToward(u.angle, Math.atan2(dx, dz), dt * 8)
    }

    /**
     * Soft push-apart so crowds spread into lines instead of stacking. Soldiers
     * busy fighting are heavier (they hold their spot), and defenders give
     * ground to raiders more slowly than raiders to them: a line holds.
     */
    private separate(): void {
        this.rebuildBuckets()
        const b = this.buckets
        const units = this.units
        const now = this.time
        const plane = b * b
        for (let k = 0; k < units.length; k++) {
            const u = units[k]!
            if (!u.alive) continue
            const bx = Math.floor(u.x / BUCKET)
            const bz = Math.floor(u.z / BUCKET)
            const heavy = u.kind === 'catapult' || u.kind === 'ram' || u.kind === 'siegetower'
            const mass = heavy ? 0.06 : now - u.lastAttackAt < 0.8 ? 0.16 : u.kind === 'knight' ? 0.26 : 0.36
            let pushX = 0
            let pushZ = 0
            let contacts = 0
            for (let side = 0; side < 2 && contacts < 8; side++) {
                for (let oz = bz - 1; oz <= bz + 1; oz++) {
                    if (oz < 0 || oz >= b) continue
                    for (let ox = bx - 1; ox <= bx + 1; ox++) {
                        if (ox < 0 || ox >= b) continue
                        for (let j = this.bucketHead[side * plane + oz * b + ox]!; j >= 0; j = this.bucketNext[j]!) {
                            if (j === k) continue
                            const o = units[j]!
                            if (!o.alive || o.elevated !== u.elevated) continue
                            const dx = u.x - o.x
                            const dz = u.z - o.z
                            const min = u.radius + o.radius
                            const d2 = dx * dx + dz * dz
                            if (d2 >= min * min) continue
                            const d = Math.sqrt(d2) || 0.01
                            let push = (min - d) * mass
                            if (o.side !== u.side && u.side === PLAYER) push *= 0.5
                            pushX += (d2 > 0 ? dx / d : (j < k ? 1 : -1)) * push
                            pushZ += (d2 > 0 ? dz / d : 0) * push
                            contacts++
                        }
                    }
                }
            }
            if (pushX === 0 && pushZ === 0) continue
            if (this.walkable(u, u.x + pushX, u.z)) u.x += pushX
            if (this.walkable(u, u.x, u.z + pushZ)) u.z += pushZ
        }
        const occ = this.grid.occupant
        const pop = this.popCheck
        this.popCheck = false
        for (const u of units) {
            if (!u.alive) continue
            // Pop out of anything that got built on top of us (or a ramp that closed).
            if (pop && !this.walkable(u, u.x, u.z)) {
                const spot = this.nearestWalkable(u.x, u.z, 3, u.side === ENEMY ? this.enemyOpen : i => this.friendlyWalkable(i, u.kind))
                if (spot) {
                    u.x = spot.x
                    u.z = spot.z
                }
            }
            const cell = this.grid.cellAt(u.x, u.z)
            if (u.side === PLAYER) u.elevated = cell >= 0 && occ[cell]! >= 0 && this.isWallCell(cell)
            else if (this.rampsActive || u.elevated) u.elevated = cell >= 0 && occ[cell]! >= 0
        }
    }

    private cleanup(): void {
        const units = this.units
        let w = 0
        let enemies = 0
        for (let k = 0; k < units.length; k++) {
            const u = units[k]!
            if (u.alive) {
                units[w++] = u
                if (u.side === ENEMY) enemies++
                continue
            }
            this.unitById.delete(u.id)
            if (u.docked) this.rampsDirty = true
            const p = this.packs.get(u.packId)
            if (p) this.deadPacks.add(p)
        }
        units.length = w
        this.enemyCount = enemies
        if (this.deadPacks.size === 0) return
        for (const pack of this.deadPacks) {
            const ids = pack.unitIds
            const offs = pack.marchOffsets
            const keepOffsets = pack.moving
            let j = 0
            for (let k = 0; k < ids.length; k++) {
                const id = ids[k]!
                if (!this.unitById.has(id)) continue
                if (keepOffsets && k < offs.length) offs[j] = offs[k]!
                ids[j++] = id
            }
            ids.length = j
            if (keepOffsets && offs.length > j) offs.length = j
            if (j > 0) continue
            this.packs.delete(pack.id)
            if (pack.side !== ENEMY) continue
            const s = this.waveLive.get(pack.wave)
            if (s && --s.packs <= 0) {
                this.waveLive.delete(pack.wave)
                this.waveCleared(pack.wave, s.perfect)
            }
        }
        this.deadPacks.clear()
    }

    private distSq(ax: number, az: number, bx: number, bz: number): number {
        return (ax - bx) ** 2 + (az - bz) ** 2
    }

    // ─── Helpers for the UI ──────────────────────────────────────────────

    /** Search outward for a free spot for a building of `size` near a point. */
    findFreeSpot(size: number, x: number, z: number, maxR = 8): { cx: number, cz: number } | null {
        const ox = Math.round(x)
        const oz = Math.round(z)
        for (let r = 0; r <= maxR; r++) {
            for (let dz = -r; dz <= r; dz++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
                    if (this.footprintClear(size, ox + dx, oz + dz) === null) return { cx: ox + dx, cz: oz + dz }
                }
            }
        }
        return null
    }

    /** Give up: the keep falls on the spot. */
    surrender(): void {
        if (this.over) return
        this.keep.hp = 0
        this.over = 'defeat'
        this.events.push({ type: 'defeat' })
    }

    /** Seconds until the next wave reaches the map edge. */
    get nextWaveIn(): number {
        return Math.max(0, (this.pending?.at ?? this.nextWaveAt) - this.time)
    }
}

export function distToRect(x: number, z: number, b: { cx: number, cz: number, size: number }): number {
    const dx = Math.max(b.cx - x, 0, x - (b.cx + b.size))
    const dz = Math.max(b.cz - z, 0, z - (b.cz + b.size))
    return Math.sqrt(dx * dx + dz * dz)
}

export function turnToward(a: number, target: number, maxStep: number): number {
    let d = target - a
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    if (Math.abs(d) <= maxStep) return target
    return a + Math.sign(d) * maxStep
}

/** Multiply a cost, rounding to friendly numbers (5s above 50). */
export function scaleCost(cost: Cost, mult: number, floor = false, ceil = false): Cost {
    const out: Cost = {}
    for (const r of RESOURCES) {
        const v = cost[r]
        if (!v) continue
        const raw = v * mult
        let n: number
        if (floor) n = Math.floor(raw)
        else if (ceil) n = Math.ceil(raw)
        else n = raw >= 50 ? Math.round(raw / 5) * 5 : Math.round(raw)
        if (n > 0) out[r] = n
    }
    return out
}

export function costEntries(cost: Cost): [Resource, number][] {
    return RESOURCES.filter(r => (cost[r] ?? 0) > 0).map(r => [r, cost[r]!])
}
