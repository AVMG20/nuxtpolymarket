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

/** The wall face enemies stop at, and the tower behind it. */
export const WALL_X = 962
export const TOWER_X = 1000
export const TOWER_TOP_Y = 176

/** Muzzle of the player's rail — on the tower's crown. */
export const MUZZLE_X = 1044
export const MUZZLE_Y = 236
export const BARREL_LENGTH = 62

/** Enemies enter from off-screen left so they never pop into existence. */
export const SPAWN_X = -80
/** Anything that drifts past this (knocked back, mostly) is culled. */
export const DESPAWN_X = -260

export const BULLET_SPEED = 2600
export const BULLET_LIFE_MS = 900
/** Fat enough to feel fair on the small fast movers without auto-aiming. */
export const BULLET_RADIUS = 9

export const SENTRY_RANGE = 900
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

/** Cosmetic layers behind the action. */
export const STAR_COUNT = 90
export const RIDGE_LAYERS = [
    { y: 244, height: 96, hex: 0x0b1220, alpha: 1, jags: 9 },
    { y: 272, height: 74, hex: 0x0e1729, alpha: 1, jags: 13 }
] as const

/** Floor grid spacing in screen space; the perspective is faked, not projected. */
export const GRID_ROWS = 11
export const GRID_COLS = 22
