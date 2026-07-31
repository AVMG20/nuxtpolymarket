export const PATHWARDEN_GENERATOR_VERSION = 5
export const PATHWARDEN_SAVE_VERSION = 2

export type PathwardenCardinalDirection = 'north' | 'east' | 'south' | 'west'

export interface PathwardenGridPoint {
    col: number
    row: number
}

export interface PathwardenMapSize {
    cols: number
    rows: number
}

export type PathwardenRoomArchetype =
    | 'castle'
    | 'straight'
    | 'corner'
    | 'u-bend'
    | 'switchback'
    | 'y-junction'
    | 't-junction'
    | 'crossroads'
    | 'road-island'
    | 'loop'
    | 'bridge-river'
    | 'bridge-canyon'
    | 'mountain-pass'
    | 'river-valley'
    | 'lake-shore'
    | 'forest-road'
    | 'connector'

export type PathwardenFeatureKind =
    | 'river'
    | 'lake'
    | 'canyon'
    | 'bridge'
    | 'ford'
    | 'mountain'
    | 'cliff'
    | 'forest'
    | 'clearing'

export interface PathwardenRoomPort {
    id: string
    cell: PathwardenGridPoint
    direction: PathwardenCardinalDirection
    kind: 'entrance' | 'exit' | 'reconnection'
}

export interface PathwardenFeaturePort {
    id: string
    cell: PathwardenGridPoint
    direction: PathwardenCardinalDirection
    kind: PathwardenFeatureKind
}

export interface PathwardenRoadLink {
    id: string
    from: PathwardenGridPoint
    to: PathwardenGridPoint
    roomId: string
}

export interface PathwardenMapFeature {
    id: string
    kind: PathwardenFeatureKind
    roomIds: string[]
    cells: PathwardenGridPoint[]
    ports: PathwardenFeaturePort[]
}

export interface PathwardenMapRoom {
    id: string
    archetype: PathwardenRoomArchetype
    depth: number
    origin: PathwardenGridPoint
    rotation: 0 | 90 | 180 | 270
    reflected: boolean
    parentConnectionId: string | null
    footprint: PathwardenGridPoint[]
    revealCells: PathwardenGridPoint[]
    buildableCells: PathwardenGridPoint[]
    roadCells: PathwardenGridPoint[]
    terminalApproaches?: Array<{
        portId: string
        cells: PathwardenGridPoint[]
    }>
    roadLinkIds: string[]
    featureIds: string[]
    ports: PathwardenRoomPort[]
}

export interface PathwardenMapConnection {
    id: string
    fromRoomId: string
    fromPortId: string
    toRoomId: string
    toPortId: string
    kind: 'expansion' | 'reconnection'
    depth: number
    roadLinkIds: string[]
}

export interface PathwardenMapMetrics {
    maxDepth: number
    roomCount: number
    roadCellCount: number
    buildableCellCount: number
    frontierCountByDepth: number[]
    archetypeCounts: Partial<Record<PathwardenRoomArchetype, number>>
    featureCounts: Partial<Record<PathwardenFeatureKind, number>>
}

export interface PathwardenMapPlan {
    generatorVersion: number
    seed: number
    realm: number
    size: PathwardenMapSize
    castleRoomId: string
    rooms: PathwardenMapRoom[]
    connections: PathwardenMapConnection[]
    roadLinks: PathwardenRoadLink[]
    features: PathwardenMapFeature[]
    metrics: PathwardenMapMetrics
}

export interface PathwardenSavedTower {
    id: number
    type: string
    col: number
    row: number
    invested: number
    cooldown: number
    angle: number
    level: number
    merges?: number
    targeting: 'first' | 'strong' | 'fast'
    relicFamily?: string
    relicId?: string
    relicStacks: number
    relicPower: number
    relicShots: number
    relicEntity?: PathwardenSavedRelic
    relicEntities?: PathwardenSavedRelic[]
}

export interface PathwardenSavedEnemy {
    id: number
    type: string
    route: PathwardenGridPoint[]
    exitKey: string
    progress: number
    hp: number
    maxHp: number
    speed: number
    reward: number
    slow: number
    slowTimer: number
    healTimer: number
    attackTimer: number
    dotDamage: number
    dotTimer: number
    dotTick: number
}

export interface PathwardenSavedProjectile {
    type: string
    relicFamily?: string
    relicPower: number
    relicEffects?: PathwardenSavedRelicEffects
    echo: boolean
    targetId: number
    x: number
    y: number
    damage: number
    speed: number
    splash: number
    splashFactor: number
    slow: number
    color: string
    size: number
    trail: PathwardenGridPoint[]
    origin: PathwardenGridPoint
    age: number
    duration: number
    arcHeight: number
}

export interface PathwardenSavedRelic {
    instanceId: number
    id: string
    family: string
    rarity: string
    name: string
    description: string
    towerSpecific: boolean
    iconIndex: number
    power: number
    sellValue: number
    color?: string
    variationSeed?: number
    damageFactor?: number
    baseEffects?: PathwardenSavedRelicEffects
    effects?: PathwardenSavedRelicEffects
}

export interface PathwardenSavedRelicEffects {
    directDamagePct: number
    burnPct: number
    burnDuration: number
    slowPct: number
    slowDuration: number
    chainCount: number
    chainRetentionPct: number
    impactRadius: number
    impactDamagePct: number
    repairPct: number
    armorPiercePct: number
    echoEveryShots: number
    echoPowerPct: number
    attackSpeedPct: number
    rangePct: number
    aetherBonusPct: number
    keepHealPct: number
}

export interface PathwardenSavedAshPile {
    id: number
    sourceRelicId: string
    sourceFamily: string
    sourceRarity: string
    sourceName: string
    createdWave: number
    flakesGenerated: number
}

export interface PathwardenGameState {
    phase: string
    paused: boolean
    wave: number
    lives: number
    maxLives: number
    aether: number
    score: number
    streak: number
    flawlessWaves: number
    spawnLeft: number
    spawnTotal: number
    spawnTimer: number
    combatRandomState: number
    path: PathwardenGridPoint[]
    claimedRoomIds: string[]
    activeRoomIds: string[]
    selectedTower: string
    towerPurchases: Record<string, number>
    relicRanks: Record<string, number>
    globalRelics?: Record<string, { level: number, power: number, effects?: PathwardenSavedRelicEffects, color?: string }>
    relicInventory: PathwardenSavedRelic[]
    ashPiles?: PathwardenSavedAshPile[]
    interest: number
    canSellRelics: boolean
    towers: PathwardenSavedTower[]
    enemies: PathwardenSavedEnemy[]
    projectiles: PathwardenSavedProjectile[]
    towerId: number
    enemyId: number
    relicInstanceId: number
}

export interface PathwardenRunSave {
    saveVersion: number
    generatorVersion: number
    runId: string
    revision: number
    seed: number
    realm: number
    mapPlan: PathwardenMapPlan
    gameState: PathwardenGameState
}
