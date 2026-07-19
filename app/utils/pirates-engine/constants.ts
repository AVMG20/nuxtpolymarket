// World is authored in a fixed design space and the whole `world` container is
// scaled to fit the host element on resize.
export const WORLD_W = 1400
export const WORLD_H = 820
export const BALL_SPEED = 780 // px/s
export const PLAYER_CANNON_FIRE_GAP_MS = 85
export const PICKUP_RADIUS = 46
export const HOLD_RANGE_FRACTION = 0.85
export const ROTATE_LERP = 0.12
export const WAYPOINT_REACH_DIST = 12
export const PLAYER_BOMB_RADIUS = 145
export const ENEMY_POWER_UP_DROP_CHANCE = 0.1
export const ENEMY_HEALTH_PACK_DROP_CHANCE = 0.05

// Pathfinding grid — coarse cells over circular island obstacles. Ships are
// treated as circles of SHIP_RADIUS for clearance checks.
export const CELL = 35
export const GRID_W = Math.ceil(WORLD_W / CELL)
export const GRID_H = Math.ceil(WORLD_H / CELL)
export const SHIP_RADIUS = 26
export const ISLAND_COUNT_MIN = 4
export const ISLAND_COUNT_MAX = 6
export const RAIDER_SHIP_SPRITE = '/pirates/sprites/raider-ship.png'
export const DPS_RAIDER_SPRITE = '/pirates/sprites/dps-raider.png'
export const TANK_RAIDER_SPRITE = '/pirates/sprites/tank-raider.png'
export const SNIPER_SHIP_SPRITE = '/pirates/sprites/sniper-ship.png'
export const ISLAND_SPRITES = [
    '/pirates/sprites/tropical-island.png',
    '/pirates/sprites/volcanic-island.png',
    '/pirates/sprites/ruins-island.png'
]
