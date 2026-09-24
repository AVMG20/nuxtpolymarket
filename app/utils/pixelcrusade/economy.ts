// Pixel Crusade progression maths. Pure functions so balance can be tuned in isolation.

export type ClassId = 'warrior' | 'ranger' | 'mage' | 'paladin'
export type UpgradeId = 'damage' | 'speed' | 'crit' | 'critPower' | 'special'

export interface HeroClass {
    id: ClassId
    name: string
    special: string
    blurb: string
    /** Base damage multiplier; each class is a big step up from the last. */
    dmgMult: number
    /** Attacks per second at speed level 0. */
    rate: number
    critBase: number
    /** Hits needed to charge the special. */
    specialEvery: number
    /** Damage multiplier of the special at special level 0. */
    specialMult: number
    ranged: boolean
    /** Highest stage reached in a run that unlocks this class on prestige. */
    unlockStage: number
}

export const CLASSES: HeroClass[] = [
    {
        id: 'warrior', name: 'Warrior', special: 'Ground Slam',
        blurb: 'Sword and board. Leaps up and slams the earth.',
        dmgMult: 1, rate: 1.1, critBase: 0.05, specialEvery: 6, specialMult: 4, ranged: false, unlockStage: 0
    },
    {
        id: 'ranger', name: 'Ranger', special: 'Arrow Rain',
        blurb: 'Fast shots from range, then a storm of arrows.',
        dmgMult: 4, rate: 1.6, critBase: 0.12, specialEvery: 5, specialMult: 6, ranged: true, unlockStage: 25
    },
    {
        id: 'mage', name: 'Mage', special: 'Meteor',
        blurb: 'Arcane bolts, and a meteor when the staff is charged.',
        dmgMult: 18, rate: 1.0, critBase: 0.08, specialEvery: 4, specialMult: 10, ranged: true, unlockStage: 40
    },
    {
        id: 'paladin', name: 'Paladin', special: 'Judgement',
        blurb: 'Holy warhammer. Calls a pillar of light down on the foe.',
        dmgMult: 80, rate: 1.3, critBase: 0.1, specialEvery: 5, specialMult: 9, ranged: false, unlockStage: 55
    }
]

export const CLASS_BY_ID = Object.fromEntries(CLASSES.map(c => [c.id, c])) as Record<ClassId, HeroClass>

export interface UpgradeDef {
    id: UpgradeId
    name: string
    baseCost: number
    growth: number
    max: number
}

export const UPGRADES: UpgradeDef[] = [
    { id: 'damage', name: 'Damage', baseCost: 5, growth: 1.13, max: Infinity },
    { id: 'speed', name: 'Attack speed', baseCost: 25, growth: 1.42, max: 30 },
    { id: 'crit', name: 'Crit chance', baseCost: 40, growth: 1.36, max: 45 },
    { id: 'critPower', name: 'Crit power', baseCost: 35, growth: 1.28, max: Infinity },
    { id: 'special', name: 'Special power', baseCost: 60, growth: 1.3, max: Infinity }
]

export const KILLS_PER_STAGE = 6
export const BOSS_EVERY = 10
export const BOSS_TIME = 30
export const MAX_ATTACK_RATE = 5

export type Levels = Record<UpgradeId, number>

export function emptyLevels(): Levels {
    return { damage: 0, speed: 0, crit: 0, critPower: 0, special: 0 }
}

export function isBossStage(stage: number): boolean {
    return stage % BOSS_EVERY === 0
}

export function monsterHp(stage: number, boss: boolean): number {
    return Math.ceil(10 * Math.pow(1.26, stage - 1) * (boss ? 10 : 1))
}

export function monsterGold(stage: number, boss: boolean): number {
    return Math.ceil(2 * Math.pow(1.2, stage - 1) * (boss ? 8 : 1))
}

export function upgradeCost(def: UpgradeDef, level: number): number {
    return Math.ceil(def.baseCost * Math.pow(def.growth, level))
}

/** Total cost of buying `qty` levels starting at `level`. */
export function upgradeCostN(def: UpgradeDef, level: number, qty: number): number {
    let total = 0
    for (let i = 0; i < qty; i++) total += upgradeCost(def, level + i)
    return total
}

/** How many levels are affordable with `gold` (capped by the upgrade max). */
export function affordable(def: UpgradeDef, level: number, gold: number): number {
    let n = 0
    let spent = 0
    while (level + n < def.max && n < 1000) {
        const c = upgradeCost(def, level + n)
        if (spent + c > gold) break
        spent += c
        n++
    }
    return n
}

export function soulBonus(souls: number): number {
    return 1 + souls * 0.1
}

export function hitDamage(cls: HeroClass, lv: Levels, souls: number): number {
    const l = lv.damage
    return 3 * (1 + l) * Math.pow(1.04, l) * cls.dmgMult * soulBonus(souls)
}

export function attackRate(cls: HeroClass, lv: Levels): number {
    return Math.min(MAX_ATTACK_RATE, cls.rate * (1 + lv.speed * 0.06))
}

export function critChance(cls: HeroClass, lv: Levels): number {
    return Math.min(0.75, cls.critBase + lv.crit * 0.01)
}

export function critMult(lv: Levels): number {
    return 2 + lv.critPower * 0.25
}

export function specialMult(cls: HeroClass, lv: Levels): number {
    return cls.specialMult * (1 + lv.special * 0.25)
}

export const PRESTIGE_MIN_STAGE = 20

/** Souls earned for prestiging with this best stage in the run. */
export function soulsFor(maxStage: number): number {
    if (maxStage < PRESTIGE_MIN_STAGE) return 0
    return Math.floor(Math.pow(1.55, (maxStage - 15) / 5))
}

/** Average damage per second (crit and special folded in), for the stats readout. */
export function dps(cls: HeroClass, lv: Levels, souls: number): number {
    const hit = hitDamage(cls, lv, souls)
    const cc = critChance(cls, lv)
    const avgHit = hit * (1 + cc * (critMult(lv) - 1))
    const perCycle = avgHit * (cls.specialEvery - 1) + avgHit * specialMult(cls, lv)
    return perCycle / cls.specialEvery * attackRate(cls, lv)
}
