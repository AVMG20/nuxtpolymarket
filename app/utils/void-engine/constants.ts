// The sector is authored at 10x the visible viewport in each axis — 5 times
// bigger than original 2x in each axis — and the camera pans over it.
export const VIEW_W = 1400
export const VIEW_H = 820
export const WORLD_W = VIEW_W * 10
export const WORLD_H = VIEW_H * 10

export const MOTHERSHIP_RADIUS = 120

/** How hard WASD pushes, as a multiple of top speed per second. */
export const THRUST_ACCEL = 3.2
/** Passive drag — space is frictionless, the ship's RCS is not. */
export const LINEAR_DRAG = 1.35
/** Ceiling on how long any bullet may live, whatever its range/speed ratio says. */
export const PLAYER_SHOT_LIFE_MS = 1400
export const ENEMY_SHOT_SPEED = 430

export const MINING_BREAK_GRACE_MS = 900
/**
 * Loose field rock reseeds fairly quickly so a cluster is worth circling back
 * to; deposit rock takes long enough that clearing a site means moving on to
 * the next one rather than parking on it.
 */
export const ROCK_RESPAWN_MS = 34_000
export const DEPOSIT_ROCK_RESPAWN_MS = 78_000

/** Rich deposits are placed at least this far from the dock, and from each other. */
export const DEPOSIT_MIN_FROM_DOCK = 2600
export const DEPOSIT_MIN_SEPARATION = 2400
/** Field clusters keep clear of the dock ring and of the deposits. */
export const FIELD_MIN_FROM_DOCK = 900

export const CAMERA_LERP = 0.12
export const CAMERA_LOOKAHEAD = 0.22

export const SHOCKWAVE_TELEGRAPH_MS = 900
export const SHOCKWAVE_RADIUS = 300
export const SHOCKWAVE_EXPAND_MS = 620

export const RAILBEAM_CHARGE_MS = 1250
export const RAILBEAM_LENGTH = 1500
export const RAILBEAM_WIDTH = 26
export const RAILBEAM_ACTIVE_MS = 260

export const BOSS_REINFORCE_COUNT = 3

/** Proximity mines: dormant while arming, then live until they time out. */
export const MINE_ARM_MS = 1100
export const MINE_LIFE_MS = 26_000
export const MINE_TRIGGER_RADIUS = 78
export const MINE_BLAST_RADIUS = 130

/**
 * Star layers are tiled, not baked across the world. A sector is 10x the
 * viewport on each axis — 115 million square pixels — so a fixed pile of dots
 * spread over all of it works out to about a dozen stars on screen, which reads
 * as an empty grey void. One repeating tile per layer gives a dense field at a
 * constant cost, and scrolls the tile offset for parallax.
 */
export const STAR_TILE = 900
export const STAR_LAYERS = [
    { count: 260, parallax: 0.18, radius: 1, alpha: 0.5, tint: 0x93c5fd },
    { count: 130, parallax: 0.42, radius: 1.5, alpha: 0.7, tint: 0xe0f2fe },
    { count: 55, parallax: 0.72, radius: 2.2, alpha: 0.95, tint: 0xffffff }
] as const

/** The drifting gas behind everything, tinted to the sector and barely moving. */
export const NEBULA_TILE = 1200
export const NEBULA_PARALLAX = 0.08
export const NEBULA_BLOBS = 9

export const DUST_MOTE_COUNT = 260

/** Screen-space instrument sizes. */
export const MINIMAP_W = 320
export const MINIMAP_H = 188
export const MINIMAP_MARGIN = 22
/** Radius of the ring the off-screen contact arrows sit on, as a fraction of the viewport. */
export const MARKER_INSET = 46

