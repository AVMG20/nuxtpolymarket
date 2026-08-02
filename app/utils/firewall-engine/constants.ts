/**
 * The field is a single fixed screen — there is no camera and nothing scrolls,
 * which is the whole reason a lane defence reads clearly: everything that can
 * kill you is visible at all times.
 */
export const VIEW_W = 1280
export const VIEW_H = 720

/** Where the sky stops and the grid plain starts. */
export const HORIZON_Y = 300

/**
 * Enemies walk along one of many parallel lanes between these two baselines.
 * The near lane is drawn bigger and sorted in front, which is the only depth
 * cue a flat side-on scene gets.
 */
export const LANE_NEAR_Y = 654
export const LANE_FAR_Y = 432
export const LANE_NEAR_SCALE = 1.12
export const LANE_FAR_SCALE = 0.62

/** The wall face enemies stop at. Fixed — only the tower on top of it grows. */
export const WALL_X = 962
export const WALL_TOP_Y = 336

// ─── The tower ──────────────────────────────────────────────────────────────

/**
 * The tower is built out of floors, and a floor is two turret mounts.
 *
 * It starts as a single storey barely clearing the parapet and gains one storey
 * per pair of mounts, so the silhouette on screen *is* the readout of how much
 * has been spent on it — a maxed spire is four times the building a fresh run
 * deploys with. Mounts sit on balconies at the two outer edges of each storey
 * rather than in a row along the parapet: a clumped battery reads as one gun,
 * and spreading them across the tower's width also spreads their fire over the
 * field.
 */
export const TOWER_X = 1000
export const TOWER_W = 236
export const TOWER_FLOOR_H = 62
export const TOWER_ROOF_H = 26
export const TOWER_MAX_FLOORS = 4
/** Mounts per storey. Slots fill left, right, then up. */
export const MOUNTS_PER_FLOOR = 2

export function towerFloors(slots: number) {
    return Math.max(1, Math.min(TOWER_MAX_FLOORS, Math.ceil(slots / MOUNTS_PER_FLOOR)))
}

/** Top of the roof slab, which everything crowning the tower hangs off. */
export function towerTopY(slots: number) {
    return WALL_TOP_Y - towerFloors(slots) * TOWER_FLOOR_H - TOWER_ROOF_H
}

/** Where mount `slot` bolts on. Balconies alternate left edge, right edge, going up. */
export function mountPosition(slot: number) {
    const floor = Math.floor(slot / MOUNTS_PER_FLOOR)
    const side = slot % MOUNTS_PER_FLOOR
    return {
        x: side === 0 ? TOWER_X - 2 : TOWER_X + TOWER_W + 2,
        y: WALL_TOP_Y - floor * TOWER_FLOOR_H - TOWER_FLOOR_H * 0.5,
        /** -1 for a balcony hanging off the left face, +1 for the right. */
        facing: side === 0 ? -1 : 1
    }
}

/** Muzzle of the player's rail — dead centre of the roof, so it rises with the tower. */
export const MUZZLE_X = TOWER_X + TOWER_W * 0.5
export function muzzleY(slots: number) {
    return towerTopY(slots) - 16
}
export const BARREL_LENGTH = 62

/** Centre of the core diamond behind the tower glass, on the ground storey. */
export const CORE_X = TOWER_X + TOWER_W * 0.5
export const CORE_Y = WALL_TOP_Y - TOWER_FLOOR_H * 0.52

/** Enemies enter from off-screen left so they never pop into existence. */
export const SPAWN_X = -80
/** Anything that drifts past this (knocked back, mostly) is culled. */
export const DESPAWN_X = -260

export const BULLET_SPEED = 2600
export const BULLET_LIFE_MS = 900
/** Fat enough to feel fair on the small fast movers without auto-aiming. */
export const BULLET_RADIUS = 9

export const SENTRY_BULLET_SPEED = 1700

/** Lancer plasma arcs in under gravity, so it has to be a slow lob. */
export const SPIT_SPEED = 620
export const SPIT_GRAVITY = 520

/** Width of the electrified band that sits directly in front of the wall. */
export const SPIKE_BAND = 168

/** How far the ICE pulse reaches, and how hard it shoves. */
export const PULSE_RADIUS = 1500
export const PULSE_KNOCKBACK = 320

/** Enemies are pushed out of each other so a wave never stacks into one column. */
export const CROWD_PUSH = 46

export const SHAKE_DECAY = 7.5
export const MAX_SHAKE = 22

/** Dropped coins fly to the wall on this arc before they bank. */
export const COIN_FLIGHT_MS = 620

/** Cosmetic layers behind the action. */
export const STAR_COUNT = 90
export const RIDGE_LAYERS = [
    { y: 244, height: 96, hex: 0x0b1220, alpha: 1, jags: 9 },
    { y: 272, height: 74, hex: 0x0e1729, alpha: 1, jags: 13 }
] as const

/** Floor grid spacing in screen space; the perspective is faked, not projected. */
export const GRID_ROWS = 11
export const GRID_COLS = 22
