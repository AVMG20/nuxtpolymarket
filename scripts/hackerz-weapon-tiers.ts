import {
    HACKERZ_WEAPONS, hackerzEmptyLevels, hackerzEmptyMainframe, hackerzHpMultiplier, hackerzMainframeEffects, hackerzWeaponRuntime
} from '../shared/utils/gamelogic/hackerz'

/**
 * How each gun stacks up at the wave it unlocks, with no upgrades: damage a
 * second over a full magazine and reload, on one target and on a pack, and
 * the same divided by how tough hostiles are by then. A later gun should not
 * fall behind an earlier one once the hostiles' health is counted.
 *
 * A pack here: splash catches three neighbours, an arc makes all its jumps,
 * a pierce runs through every body it may.
 */
const effects = hackerzMainframeEffects(hackerzEmptyMainframe())
const rows = HACKERZ_WEAPONS.map((def) => {
    const w = hackerzWeaponRuntime(def.id, hackerzEmptyLevels(), effects)
    const cycle = (w.magazine * w.fireIntervalMs + w.reloadMs) / 1000
    const single = w.damage * w.pellets
    let pack = single
    if (w.splashRadius > 0) pack += 3 * w.splashDamage
    if (w.chain > 0) {
        let jump = w.damage * w.chainFalloff
        for (let j = 0; j < w.chain; j++) {
            pack += jump
            jump *= w.chainFalloff
        }
    }
    if (w.pierce > 0) pack = w.damage * (1 + w.pierce)
    const hp = hackerzHpMultiplier(def.unlockWave)
    const singleDps = single * w.magazine / cycle
    const packDps = pack * w.magazine / cycle
    return {
        gun: def.name,
        wave: def.unlockWave,
        cost: def.cost,
        singleDps: Math.round(singleDps),
        packDps: Math.round(packDps),
        hostileHp: `×${hp.toFixed(2)}`,
        singleVsHp: +(singleDps / hp).toFixed(1),
        packVsHp: +(packDps / hp).toFixed(1)
    }
})
console.table(rows)
