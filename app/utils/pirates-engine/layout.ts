import type { SimGun } from './types'

// Hull and gun geometry shared by the sim (muzzle positions, hit radii) and
// the renderer (where each barrel is drawn), so a shot always leaves from the
// barrel the player sees.

export const PLAYER_HULL_LENGTH = 84
export const PLAYER_HULL_BEAM = 34
export const ENEMY_HULL_LENGTH = 74
export const ENEMY_HULL_BEAM = 30

export interface HullSize {
    length: number
    beam: number
}

export function playerHull(sizeScale = 1): HullSize {
    return { length: PLAYER_HULL_LENGTH * sizeScale, beam: PLAYER_HULL_BEAM * sizeScale }
}

export function enemyHull(sizeScale = 1): HullSize {
    return { length: ENEMY_HULL_LENGTH * sizeScale, beam: ENEMY_HULL_BEAM * sizeScale }
}

/** Radius used for clicks and shot hits on a hull. */
export function hullHitRadius(hull: HullSize) {
    return Math.max(hull.beam * 0.9, hull.length * 0.42)
}

/**
 * Ship-local mount points for `count` guns (+x = bow). One gun sits on the
 * foredeck centreline; more guns pair up port and starboard from bow to
 * stern, with an odd one out on the bow chaser.
 */
export function pirateGunMounts(count: number, hull: HullSize): { x: number, y: number }[] {
    if (count <= 0) return []
    if (count === 1) return [{ x: hull.length * 0.26, y: 0 }]
    const mounts: { x: number, y: number }[] = []
    const odd = count % 2 === 1
    if (odd) mounts.push({ x: hull.length * 0.36, y: 0 })
    const pairs = Math.floor(count / 2)
    const front = hull.length * (odd ? 0.16 : 0.24)
    const back = -hull.length * 0.28
    for (let i = 0; i < pairs; i++) {
        const t = pairs === 1 ? 0.5 : i / (pairs - 1)
        const x = front + (back - front) * t
        // The hull narrows toward bow and stern; keep barrels on the planking.
        const taper = 1 - Math.min(0.35, Math.abs(x) / hull.length * 0.6)
        const y = hull.beam * 0.36 * taper
        mounts.push({ x, y: -y }, { x, y })
    }
    return mounts
}

export interface GunSpec {
    count: number
    style: SimGun['style']
    length: number
    bore: number
    color: number
}

/** How many guns each enemy tier carries and what they look like. */
export const ENEMY_GUNS: Record<string, GunSpec> = {
    sloop: { count: 2, style: 'cannon', length: 6, bore: 3, color: 0x57534e },
    razorskiff: { count: 1, style: 'cannon', length: 6, bore: 2.6, color: 0xfb923c },
    fireship: { count: 0, style: 'cannon', length: 0, bore: 0, color: 0 },
    corsair: { count: 3, style: 'cannon', length: 7, bore: 3.2, color: 0xef4444 },
    brigantine: { count: 4, style: 'cannon', length: 7, bore: 3.2, color: 0x64748b },
    sniper: { count: 1, style: 'long', length: 22, bore: 3, color: 0xd946ef },
    ironclad: { count: 4, style: 'cannon', length: 8, bore: 4, color: 0x60a5fa },
    harpooner: { count: 1, style: 'harpoon', length: 16, bore: 4, color: 0x2dd4bf },
    frigate: { count: 6, style: 'cannon', length: 8, bore: 3.4, color: 0xf59e0b },
    mortar: { count: 2, style: 'mortar', length: 9, bore: 7, color: 0xa8a29e },
    tidecaller: { count: 2, style: 'cannon', length: 6, bore: 3, color: 0x67e8f9 },
    manowar: { count: 8, style: 'cannon', length: 8, bore: 3.6, color: 0xf43f5e },
    ghostship: { count: 4, style: 'spectral', length: 8, bore: 3.4, color: 0x5eead4 },
    dreadnought: { count: 10, style: 'cannon', length: 9, bore: 4.2, color: 0xef4444 },
    phantom: { count: 8, style: 'spectral', length: 9, bore: 4, color: 0x99f6e4 },
    kraken: { count: 0, style: 'cannon', length: 0, bore: 0, color: 0 }
}

/** Player barrels grow with the cannon tier: a swivel is a stub, a Leviathan a long bronze-and-fire bombard. */
export const PLAYER_GUN_SIZE: Record<string, { length: number, bore: number }> = {
    swivel: { length: 5, bore: 2.6 },
    carronade: { length: 6, bore: 3.4 },
    culverin: { length: 7, bore: 3.2 },
    longgun: { length: 8, bore: 3.2 },
    basilisk: { length: 8, bore: 3.8 },
    mythril: { length: 9, bore: 4 },
    adamantite: { length: 10, bore: 4.3 },
    leviathan: { length: 10, bore: 4.6 }
}
