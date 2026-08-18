// Call of Xeno — mid-run checkpoint model.
//
// Shared verbatim by the client (builds the save at every round boundary,
// restores it on resume) and the server (validates the shape, clamps the
// points). Only round-boundary state is frozen: enemies in flight are
// deliberately not persisted, so a crash costs the round in progress,
// never the run.

import {
    CALL_OF_XENO_PERKS,
    CALL_OF_XENO_WEAPONS,
    CALL_OF_XENO_EQUIPMENT,
    packAPunch,
    type CallOfXenoPerkId,
    type CallOfXenoEquipmentId,
    type CallOfXenoWeaponId
} from './call-of-xeno'
import { CALL_OF_XENO_DOORS } from './call-of-xeno-map'
import {
    CALL_OF_XENO_MAX_GROSS,
    CALL_OF_XENO_MAX_SETTLED_ROUND,
    callOfXenoMaxGrossForElapsedMs,
    type CallOfXenoDifficulty
} from './call-of-xeno-meta'

export const CALL_OF_XENO_SAVE_VERSION = 1

export interface CallOfXenoSavedWeapon {
    base: CallOfXenoWeaponId
    /** Pack-a-Punch tier, 0-3. */
    tier: number
    mag: number
    reserve: number
}

export interface CallOfXenoRunSave {
    version: number
    /** The round that starts next — everything before it is completed. */
    round: number
    /** Spendable points banked at the round boundary. */
    score: number
    /** Lifetime points earned — what the settle pays on. */
    grossEarned: number
    hp: number
    hpMax: number
    perks: CallOfXenoPerkId[]
    quickReviveBuys: number
    weapons: CallOfXenoSavedWeapon[]
    activeSlot: number
    /**
     * Workbench equipment bought but not yet deployed. Units already on the
     * field are in-flight state, like enemies, and are not persisted. Absent
     * on saves written before the workbench existed.
     */
    equipment?: CallOfXenoEquipmentId[]
    powered: boolean
    doors: string[]
    /** Player position and facing. */
    x: number
    z: number
    y: number
    yaw: number
    runTime: number
    stats: {
        kills: number
        headshots: number
        spins: number
        barrels: number
        boards: number
    }
}

const PERK_IDS = Object.keys(CALL_OF_XENO_PERKS)
const WEAPON_IDS = Object.keys(CALL_OF_XENO_WEAPONS)
const DOOR_IDS = CALL_OF_XENO_DOORS.map(door => door.id)

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

function isCount(value: unknown, max: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
}

/**
 * Validates a save posted by a client. Everything here is a bound rather
 * than a business rule: the endpoint that stores it re-checks the part
 * that decides money against the server's own clock, and this only
 * guarantees the blob is the shape the game can read back.
 */
export function callOfXenoValidateSave(save: unknown): save is CallOfXenoRunSave {
    if (typeof save !== 'object' || save === null) return false
    const candidate = save as CallOfXenoRunSave
    if (candidate.version !== CALL_OF_XENO_SAVE_VERSION) return false
    if (!isCount(candidate.round, CALL_OF_XENO_MAX_SETTLED_ROUND) || candidate.round < 2) return false
    // Starting points can add 10k on top of anything earned, so the score
    // bound carries that margin over the gross ceiling.
    if (!isFiniteNumber(candidate.score) || candidate.score < 0 || candidate.score > CALL_OF_XENO_MAX_GROSS + 20_000) return false
    if (!isFiniteNumber(candidate.grossEarned) || candidate.grossEarned < 0 || candidate.grossEarned > CALL_OF_XENO_MAX_GROSS) return false
    // 100 base + 5×25 armour + the Juggernog pool leaves 275 legit; 500 is
    // the bound with room for future tuning.
    if (!isFiniteNumber(candidate.hpMax) || candidate.hpMax < 100 || candidate.hpMax > 500) return false
    if (!isFiniteNumber(candidate.hp) || candidate.hp < 1 || candidate.hp > candidate.hpMax) return false

    if (!Array.isArray(candidate.perks) || candidate.perks.length > PERK_IDS.length) return false
    if (!candidate.perks.every(id => PERK_IDS.includes(id))) return false
    if (new Set(candidate.perks).size !== candidate.perks.length) return false
    if (!isCount(candidate.quickReviveBuys, 3)) return false

    if (!Array.isArray(candidate.weapons) || candidate.weapons.length < 1 || candidate.weapons.length > 2) return false
    for (const weapon of candidate.weapons) {
        if (typeof weapon !== 'object' || weapon === null) return false
        if (!WEAPON_IDS.includes(weapon.base)) return false
        if (!isCount(weapon.tier, 3)) return false
        const def = packAPunch(CALL_OF_XENO_WEAPONS[weapon.base], weapon.tier)
        if (!isCount(weapon.mag, def.magSize)) return false
        if (!isCount(weapon.reserve, def.reserveAmmo)) return false
    }
    if (!isCount(candidate.activeSlot, candidate.weapons.length - 1)) return false

    if (candidate.equipment !== undefined) {
        if (!Array.isArray(candidate.equipment) || candidate.equipment.length > 3) return false
        if (!candidate.equipment.every(id => (Object.keys(CALL_OF_XENO_EQUIPMENT) as CallOfXenoEquipmentId[]).includes(id))) return false
    }

    if (typeof candidate.powered !== 'boolean') return false
    if (!Array.isArray(candidate.doors) || candidate.doors.length > DOOR_IDS.length) return false
    if (!candidate.doors.every(id => DOOR_IDS.includes(id))) return false
    if (new Set(candidate.doors).size !== candidate.doors.length) return false

    if (!isFiniteNumber(candidate.x) || Math.abs(candidate.x) > 150) return false
    if (!isFiniteNumber(candidate.z) || Math.abs(candidate.z) > 150) return false
    if (!isFiniteNumber(candidate.y) || Math.abs(candidate.y) > 50) return false
    if (!isFiniteNumber(candidate.yaw) || Math.abs(candidate.yaw) > Math.PI * 4) return false
    if (!isFiniteNumber(candidate.runTime) || candidate.runTime < 0 || candidate.runTime > 86_400) return false

    const stats = candidate.stats
    if (typeof stats !== 'object' || stats === null) return false
    return (['kills', 'headshots', 'spins', 'barrels', 'boards'] as const).every(key =>
        isCount(stats[key], 10_000_000)
    )
}

/**
 * The payout ceiling's 2-minute grace would clamp a round-1/2 boundary save
 * to the starting points — a crash there would cost real earned points.
 * This floor covers what the opening rounds can honestly bank (about 75
 * zombies at ~110 points a kill) until the wall-clock ramp takes over.
 */
export const CALL_OF_XENO_SAVE_EARLY_POINTS_FLOOR = 20_000

/**
 * What a checkpoint stored at `elapsedMs` may hold in points. Same honesty
 * ceiling the settle applies, floored for the grace window.
 */
export function callOfXenoSavePointsCeiling(elapsedMs: number, difficulty: CallOfXenoDifficulty): number {
    return Math.max(
        CALL_OF_XENO_SAVE_EARLY_POINTS_FLOOR,
        callOfXenoMaxGrossForElapsedMs(elapsedMs, difficulty)
    )
}
