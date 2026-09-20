import { describe, expect, it } from 'vitest'
import { VOID_ZONES, VOID_ZONE_PLAIN, voidDepthLoot, voidDepthThreat, voidJumpDanger, type VoidZoneMods } from '#shared/utils/gamelogic/void-pilot'
import { ENEMIES, depthDesolators, spawnWeight } from '../../app/utils/void/data'

describe('void jump zones', () => {
    it('gives every zone a short upside and a short downside', () => {
        for (const zone of VOID_ZONES) {
            expect(zone.boons.length, zone.id).toBeGreaterThan(0)
            expect(zone.banes.length, zone.id).toBeGreaterThan(0)
            for (const chip of [...zone.boons, ...zone.banes]) expect(chip.length, chip).toBeLessThanOrEqual(24)
        }
    })

    it('keeps the percentage chips honest against the multipliers the engine reads', () => {
        const keys: Record<string, keyof VoidZoneMods> = { 'ore': 'ore', 'salvage': 'salvage', 'rocks': 'rocks', 'patrols': 'patrols', 'relics': 'relics', 'scanner': 'scan', 'shield regen': 'shieldRegen', 'enemy sight': 'vision', 'wrecks and caches': 'wrecks' }
        let checked = 0
        for (const zone of VOID_ZONES) {
            for (const chip of [...zone.boons, ...zone.banes]) {
                const match = chip.match(/^([+-]\d+)% (.+)$/)
                if (!match) continue
                const key = keys[match[2]!]
                expect(key, chip).toBeDefined()
                expect(zone.mods[key!], chip).toBeCloseTo(1 + Number(match[1]) / 100, 5)
                checked++
            }
            // A multiplier nobody is told about would be a hidden rule.
            for (const key of Object.keys(VOID_ZONE_PLAIN) as (keyof VoidZoneMods)[]) {
                if (zone.mods[key] === VOID_ZONE_PLAIN[key] || key === 'elites' || key === 'caches') continue
                const label = Object.entries(keys).find(([, k]) => k === key)![0]
                expect([...zone.boons, ...zone.banes].some(chip => chip.endsWith(label)), `${zone.id}.${key}`).toBe(true)
            }
        }
        expect(checked).toBeGreaterThan(8)
        expect(VOID_ZONES.find(z => z.id === 'graveyard')!.mods.caches).toBe(2)
    })

    it('makes every jump bite harder than the last while loot climbs at a flat rate', () => {
        expect(voidDepthThreat(1)).toBe(1)
        expect(voidDepthLoot(1)).toBe(1)
        for (let depth = 2; depth <= 8; depth++) {
            const step = voidDepthThreat(depth) - voidDepthThreat(depth - 1)
            const before = voidDepthThreat(depth - 1) - voidDepthThreat(Math.max(1, depth - 2))
            expect(step).toBeGreaterThan(before)
            expect(voidDepthLoot(depth) - voidDepthLoot(depth - 1)).toBeCloseTo(0.2, 5)
            expect(voidDepthThreat(depth)).toBeGreaterThan(voidDepthLoot(depth))
        }
        expect(voidDepthThreat(2)).toBeCloseTo(1.29, 5)
        expect(voidDepthThreat(5)).toBeCloseTo(2.64, 5)
    })

    it('reads danger as one to five skulls', () => {
        expect(voidJumpDanger(2, 'calm')).toBe(1)
        expect(voidJumpDanger(2, 'ion')).toBe(1)
        expect(voidJumpDanger(2, 'pirates')).toBe(2)
        expect(voidJumpDanger(4, 'rich')).toBe(4)
        expect(voidJumpDanger(8, 'pirates')).toBe(5)
    })

    it('only fields the Desolator past a gate, more often the deeper the run', () => {
        for (let tier = 1; tier <= 5; tier++) {
            expect(spawnWeight('desolator', tier, 1)).toBe(0)
            expect(spawnWeight('desolator', tier, 2)).toBeGreaterThan(0)
            expect(spawnWeight('desolator', tier, 4)).toBeGreaterThan(spawnWeight('desolator', tier, 2))
            expect(spawnWeight('raider', tier, 4)).toBe(ENEMIES.raider.weights[tier - 1])
            expect(spawnWeight('mauler', tier, 3)).toBeGreaterThanOrEqual(ENEMIES.mauler.weights[tier - 1]!)
        }
        expect(depthDesolators(1)).toBe(0)
        expect(depthDesolators(2)).toBe(1)
        expect(depthDesolators(8)).toBe(3)
    })

    it('pays a Desolator no better than a Mauler', () => {
        const total = (kind: 'desolator' | 'mauler') => ENEMIES[kind].drops.reduce((sum, d) => sum + d.max * (d.chance ?? 1), 0)
        expect(total('desolator')).toBeLessThanOrEqual(total('mauler'))
    })
})
