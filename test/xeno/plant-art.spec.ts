import { describe, expect, it } from 'vitest'
import {
    PLANT_STAGES,
    PLANT_TYPES,
    buildPlantArt,
    getPlantArt,
    makeHybridTypeId,
    plantGenome,
    plantGrowScale,
    plantStageForProgress,
    type PlantArt
} from '../../shared/utils/xeno'

const HYBRIDS = [
    makeHybridTypeId([{ id: 'abyssform', speed: 4, yield: 3 }, { id: 'swiftcane', speed: 2, yield: 1 }]),
    makeHybridTypeId([{ id: 'crystal-vine', speed: 1, yield: 1 }, { id: 'deepfrond', speed: 1, yield: 1 }, { id: 'swiftcane', speed: 1, yield: 1 }]),
    makeHybridTypeId([{ id: 'bloom', speed: 1, yield: 1 }, { id: 'glowshroom', speed: 1, yield: 1 }, { id: 'starweave', speed: 1, yield: 1 }, { id: 'xenoform', speed: 1, yield: 1 }]),
    makeHybridTypeId([{ id: 'cosmosbloom', speed: 3, yield: 2 }]),
    'hybrid:sprout+tendril'
]

const ALL_IDS = [...PLANT_TYPES.map(p => p.id), ...HYBRIDS]

// Absolute M/L/C/Q/Z only, every coordinate a finite number near the 0..100 viewBox.
const PATH_RE = /^(?:M-?[\d.]+ -?[\d.]+(?:[LCQ]-?[\d.]+(?: -?[\d.]+)*)*Z?)+$/

function expectValid(art: PlantArt) {
    expect(art.ground.length).toBeGreaterThan(0)
    expect(art.plant.length).toBeGreaterThan(0)
    for (const p of [...art.ground, ...art.plant, ...art.air]) {
        expect(p.d).toMatch(PATH_RE)
        expect(p.fill || p.stroke).toBeTruthy()
        for (const n of p.d.match(/-?[\d.]+/g)!.map(Number)) {
            expect(Number.isFinite(n)).toBe(true)
            expect(n).toBeGreaterThan(-20)
            expect(n).toBeLessThan(120)
        }
        if (p.width != null) expect(p.width).toBeGreaterThan(0)
        if (p.opacity != null) expect(p.opacity).toBeGreaterThan(0)
    }
}

describe('xeno plant art', () => {
    it('draws every species and hybrid at every stage, in colour and as a silhouette', () => {
        for (const id of ALL_IDS) {
            for (const stage of PLANT_STAGES) {
                const art = getPlantArt(id, stage)
                expect(art, `${id} ${stage}`).not.toBeNull()
                expectValid(art!)
                const sil = getPlantArt(id, stage, true)!
                expectValid(sil)
                for (const p of [...sil.ground, ...sil.plant]) expect(p.fill ?? p.stroke).toBe('currentColor')
                expect(sil.air).toHaveLength(0)
            }
        }
    })

    it('is deterministic per id', () => {
        for (const id of ALL_IDS) {
            const genome = plantGenome(id)!
            expect(JSON.stringify(plantGenome(id))).toBe(JSON.stringify(genome))
            for (const stage of PLANT_STAGES) {
                expect(JSON.stringify(buildPlantArt(genome, stage))).toBe(JSON.stringify(buildPlantArt(plantGenome(id)!, stage)))
            }
        }
    })

    it('draws one shared soil layer, which PlantIcon registers once', () => {
        for (const silhouette of [false, true]) {
            const ground = JSON.stringify(getPlantArt('sprout', 'ready', silhouette)!.ground)
            for (const id of ALL_IDS) {
                for (const stage of PLANT_STAGES) expect(JSON.stringify(getPlantArt(id, stage, silhouette)!.ground)).toBe(ground)
            }
        }
    })

    it('memoises per id and stage', () => {
        expect(getPlantArt('bloom', 'growing')).toBe(getPlantArt('bloom', 'growing'))
        expect(getPlantArt('bloom', 'growing')).not.toBe(getPlantArt('bloom', 'ready'))
    })

    it('gives every species its own look', () => {
        const ready = new Set(ALL_IDS.map(id => JSON.stringify(getPlantArt(id, 'ready')!.plant)))
        expect(ready.size).toBe(ALL_IDS.length)
        const genomes = PLANT_TYPES.map(p => plantGenome(p.id)!.genes[0]!)
        const looks = new Set(genomes.map(g => `${g.archetype}|${g.body}|${g.light}|${g.count}`))
        // Void plants share a palette but differ in archetype or count.
        expect(looks.size).toBeGreaterThanOrEqual(PLANT_TYPES.length - 2)
    })

    it('grows between stages', () => {
        for (const id of ['sprout', 'omega-core', HYBRIDS[0]!]) {
            const [seedling, growing, ready] = PLANT_STAGES.map(s => getPlantArt(id, s)!)
            expect(seedling!.plant).not.toEqual(growing!.plant)
            expect(growing!.plant).not.toEqual(ready!.plant)
            expect(seedling!.ground).toEqual(ready!.ground)
        }
    })

    it('builds hybrids from their resources', () => {
        const genome = plantGenome(HYBRIDS[1]!)!
        expect(genome.hybrid).toBe(true)
        expect(genome.genes.map(g => g.id)).toEqual(['crystal-vine', 'deepfrond', 'swiftcane'])
        expect(genome.genes.map(g => g.archetype)).toEqual(['crystal', 'frond', 'spire'])
        expect(genome.tier).toBe(4)
        // A hybrid shows each resource's colour.
        const fills = new Set(getPlantArt(HYBRIDS[1]!, 'ready')!.plant.map(p => p.fill))
        for (const g of genome.genes) expect(fills.has(g.body)).toBe(true)
    })

    it('marks void plants and gives them the void palette', () => {
        for (const p of PLANT_TYPES.filter(p => p.voidPlant)) {
            const genome = plantGenome(p.id)!
            expect(genome.void).toBe(true)
            expect(genome.genes[0]!.body).toBe('#55448a')
            expect(getPlantArt(p.id, 'ready')!.air.length).toBeGreaterThan(0)
        }
    })

    it('adds detail by tier, not size', () => {
        const t1 = getPlantArt('sprout', 'ready')!
        const t9 = getPlantArt('chronofrond', 'ready')!
        expect(t9.plant.length).toBeGreaterThan(t1.plant.length)
        expect(t9.air.length).toBeGreaterThan(0)
        expect(t1.air).toHaveLength(0)
    })

    it('returns null for unknown ids so the icon falls back', () => {
        for (const id of [null, undefined, '', 'not-a-plant', 'hybrid:', 'hybrid:nope~1~1']) {
            expect(plantGenome(id)).toBeNull()
            expect(getPlantArt(id)).toBeNull()
        }
        // Unknown resources inside a hybrid are skipped.
        expect(plantGenome('hybrid:nope~1~1+bloom~1~1')!.genes.map(g => g.id)).toEqual(['bloom'])
    })

    it('maps progress to stages and a growth scale', () => {
        expect(plantStageForProgress(0)).toBe('seedling')
        expect(plantStageForProgress(0.5)).toBe('growing')
        expect(plantStageForProgress(1)).toBe('ready')
        expect(plantGrowScale('ready', 0.3)).toBe(1)
        expect(plantGrowScale('growing')).toBe(1)
        expect(plantGrowScale('seedling', 0)).toBeLessThan(plantGrowScale('seedling', 0.1))
        expect(plantGrowScale('growing', 0.3)).toBeLessThan(plantGrowScale('growing', 0.9))
        expect(plantGrowScale('growing', 2)).toBe(1)
    })
})
