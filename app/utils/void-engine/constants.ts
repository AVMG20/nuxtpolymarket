// The sector is authored at 2x the visible viewport in each axis — four
// screens of space — and the camera pans over it. The `view` container is
// scaled to fit the host element on resize, exactly like the pirate raid.
export const VIEW_W = 1400
export const VIEW_H = 820
export const WORLD_W = VIEW_W * 2
export const WORLD_H = VIEW_H * 2

export const MOTHERSHIP_RADIUS = 120

/** How hard WASD pushes, as a multiple of top speed per second. */
export const THRUST_ACCEL = 3.2
/** Passive drag — space is frictionless, the ship's RCS is not. */
export const LINEAR_DRAG = 1.35
/** Ceiling on how long any bullet may live, whatever its range/speed ratio says. */
export const PLAYER_SHOT_LIFE_MS = 1400
export const ENEMY_SHOT_SPEED = 430

export const MINING_BREAK_GRACE_MS = 900
export const ROCK_RESPAWN_MS = 26_000

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

export const STAR_LAYERS = [
    { count: 300, parallax: 0.2, radius: 1, alpha: 0.45, tint: 0x93c5fd },
    { count: 190, parallax: 0.45, radius: 1.5, alpha: 0.65, tint: 0xe0f2fe },
    { count: 95, parallax: 0.75, radius: 2.2, alpha: 0.9, tint: 0xffffff }
] as const

export const NEBULA_COLORS = [0x1e1b4b, 0x312e81, 0x0f766e, 0x581c87, 0x7f1d1d, 0x155e75] as const

export const DUST_MOTE_COUNT = 90
