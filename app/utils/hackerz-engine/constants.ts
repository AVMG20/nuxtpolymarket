/**
 * The field is simulated on a flat plane in **field units**, which are the old
 * side-on engine's pixels. Every distance in `#shared/utils/gamelogic/hackerz`
 * (speeds, standoffs, turret ranges, splash radii) and in the balance sim is
 * written in them, so keeping the unit is what keeps the balance honest.
 *
 * A point on the field is `(u, d)`: `u` runs along the wall (0 is the centre,
 * negative is left), `d` is the distance out from the wall face. The renderer
 * maps that onto three.js world space with `FIELD_SCALE`.
 */

/** Distance from the spawn line to the wall face — the sim's `FIELD_WIDTH`. */
export const FIELD_DEPTH = 1042
/** Spawns are staggered this far behind the spawn line, so a wave arrives ragged. */
export const SPAWN_SPREAD = 220
/** Half the width of the lane enemies walk in. */
export const FIELD_HALF_WIDTH = 400
/** Anything knocked back past this is culled. */
export const DESPAWN_DEPTH = FIELD_DEPTH + 420

/** World units per field unit. */
export const FIELD_SCALE = 0.05
/** Enemy body heights in the rules are pixel heights; this sizes the 3D model from them. */
export const MODEL_HEIGHT_SCALE = FIELD_SCALE * 1.45

/**
 * The wall is two pieces. A light fence stands on d = 0 — that is what enemies
 * walk up to and hit — and the deck you fight from sits a gap behind it, so a
 * unit pressed against the fence is still out in front of every barrel.
 * World units; the fence runs this many field units either side of centre.
 */
export const WALL_HALF_LENGTH = 560
export const FENCE_HEIGHT = 2.6
/** How far out in front of the fence the ICE Barrier stands, in field units. */
export const SHIELD_D = 26
/** Deck top height, front edge distance behind the fence, and depth. */
export const WALL_HEIGHT = 3.2
export const DECK_FRONT = 7
export const WALL_THICKNESS = 14
/** Turrets and the rail stand this far back on the deck (world z). */
export const GUN_Z = DECK_FRONT + 1.4

/**
 * Turret mounts along the parapet, filled from the centre outwards so the first
 * two flank the player's rail and a full battery spans the whole lane. The last
 * four stand in a raised second row further back on the deck, staggered into the
 * gaps of the front row so they fire between and over it.
 */
export const MOUNT_U = [-120, 120, -235, 235, -350, 350, -465, 465, -178, 178, -292, 292] as const
/** The first mount slot of the back row. */
export const MOUNT_BACK_FROM = 8
/** How much further back on the deck (world z) the back row stands, and how high its pedestals lift it. */
export const MOUNT_BACK_Z = 3.2
export const MOUNT_BACK_RISE = 0.9

export function mountPosition(slot: number) {
    const back = slot >= MOUNT_BACK_FROM
    return { u: MOUNT_U[slot] ?? 0, d: 0, back, z: back ? MOUNT_BACK_Z : 0, rise: back ? MOUNT_BACK_RISE : 0 }
}

/** The player's rail sits dead centre on the wall. */
export const RAIL_U = 0

export const BULLET_LIFE_MS = 900
/** Fat enough to feel fair on the small fast movers. */
export const BULLET_RADIUS = 9

/** Enemy ordnance lobs in under gravity, in field units per second. */
export const SPIT_SPEED = 620
export const SPIT_GRAVITY = 520

/** Width of the electrified band directly in front of the wall. */
export const SPIKE_BAND = 168

/** How far the ICE pulse reaches, and how hard it shoves. */
export const PULSE_RADIUS = 1500
export const PULSE_KNOCKBACK = 320

/** Camera shake, in world units. */
export const SHAKE_DECAY = 7.5
export const MAX_SHAKE = 1.1

/** Dropped coins fly to the wall on this arc before they bank. */
export const COIN_FLIGHT_MS = 620

/** The end-of-wave purge sweeps out from the wall to here, over this long. */
export const PURGE_REACH = FIELD_DEPTH + 160
export const PURGE_MS = 620

/** Screen-space slack when clicking a target, in CSS pixels. */
export const PICK_SLACK_PX = 22
