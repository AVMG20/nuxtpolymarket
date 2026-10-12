import { describe, expect, it } from 'vitest'
import { WORLDS, ENEMY_STYLES, enemyNameAt, getWorld, runProgress } from '#shared/utils/hero-quest/content/worlds'
import { CHAMPIONS } from '#shared/utils/hero-quest/content/champions'
import {
    BOSS_STAGE,
    ELITE_STAGE_MAX,
    ELITE_STAGE_MIN,
    STAGES_PER_WORLD,
    SUPER_BOSS_STAGE,
    WORLD_COUNT
} from '#shared/utils/hero-quest/constants'

describe('hero-quest worlds', () => {
    it('has exactly one world per run position', () => {
        expect(WORLDS).toHaveLength(WORLD_COUNT)
    })

    it('has unique, stable string IDs', () => {
        expect(new Set(WORLDS.map(world => world.id)).size).toBe(WORLDS.length)
        for (const world of WORLDS) {
            expect(world.id, world.name).toMatch(/^world_[a-z0-9_]+$/)
        }
    })

    it('indexes 1..N in play order, so a reorder cannot silently move a save', () => {
        WORLDS.forEach((world, position) => {
            expect(world.index).toBe(position + 1)
        })
    })

    it('names World 10 The Void, or Void Shards needs renaming', () => {
        const last = getWorld(WORLD_COUNT)
        expect(last.id).toBe('world_the_void')
        expect(last.name).toBe('The Void')
    })

    it('names every enemy role and gives every world a theme', () => {
        for (const world of WORLDS) {
            expect(world.hordeName.length, world.id).toBeGreaterThan(0)
            for (const style of ENEMY_STYLES) expect(world.roster[style].length, `${world.id} ${style}`).toBeGreaterThan(0)
            expect(world.bossName.length, world.id).toBeGreaterThan(0)
            expect(world.superBossName.length, world.id).toBeGreaterThan(0)
            expect(world.theme.length, world.id).toBeGreaterThan(0)
        }
    })

    it('never uses a name twice across worlds', () => {
        const names = WORLDS.flatMap(world => [world.name, world.hordeName, ...ENEMY_STYLES.map(style => world.roster[style]), world.bossName, world.superBossName])
        expect(new Set(names).size).toBe(names.length)
    })

    it('starts no boss name with "The", which the fight button and gate copy read as a proper name', () => {
        // The screen says "Fight <name>" and "<name> blocks the way"; a leading article reads
        // "Fight The Void Herald".
        for (const world of WORLDS) {
            expect(world.bossName, world.id).not.toMatch(/^the\s/i)
            expect(world.superBossName, world.id).not.toMatch(/^the\s/i)
        }
    })

    it('never reuses a Champion given name or title, so a boss cannot be mistaken for a pull', () => {
        const championWords = new Set(CHAMPIONS.flatMap(champion => [champion.givenName, champion.title]).map(word => word.toLowerCase()))
        for (const world of WORLDS) {
            for (const name of [world.hordeName, ...ENEMY_STYLES.map(style => world.roster[style]), world.bossName, world.superBossName]) {
                const clashes = name.split(/[\s,]+/).filter(word => championWords.has(word.toLowerCase()))
                expect(clashes, `${world.id}: ${name}`).toEqual([])
            }
        }
    })

    it('throws on an out-of-range index rather than returning a wrong world', () => {
        expect(() => getWorld(0)).toThrow()
        expect(() => getWorld(WORLD_COUNT + 1)).toThrow()
    })

    describe('enemy naming by archetype', () => {
        it('uses the boss name at Stage 5 and the super boss name at Stage 10', () => {
            const world = getWorld(1)
            expect(enemyNameAt(1, BOSS_STAGE)).toEqual({ name: world.bossName, archetype: 'boss' })
            expect(enemyNameAt(1, SUPER_BOSS_STAGE)).toEqual({ name: world.superBossName, archetype: 'super_boss' })
        })

        it('keeps the trash name for elites — they are the same roster, stat-buffed', () => {
            const world = getWorld(1)
            for (let stage = ELITE_STAGE_MIN; stage <= ELITE_STAGE_MAX; stage++) {
                expect(enemyNameAt(1, stage)).toEqual({ name: world.hordeName, archetype: 'elite' })
            }
        })

        it('uses the trash name on wave stages', () => {
            expect(enemyNameAt(3, 1).archetype).toBe('wave')
            expect(enemyNameAt(3, 1).name).toBe(getWorld(3).hordeName)
        })
    })

    describe('run progress', () => {
        it('starts at zero and ends one short of the total', () => {
            expect(runProgress(1, 1)).toEqual({ cleared: 0, total: WORLD_COUNT * STAGES_PER_WORLD })
            expect(runProgress(WORLD_COUNT, STAGES_PER_WORLD).cleared).toBe(WORLD_COUNT * STAGES_PER_WORLD - 1)
        })

        it('advances by exactly one per stage, with no seam at a world boundary', () => {
            let previous = -1
            for (let world = 1; world <= WORLD_COUNT; world++) {
                for (let stage = 1; stage <= STAGES_PER_WORLD; stage++) {
                    const { cleared } = runProgress(world, stage)
                    expect(cleared).toBe(previous + 1)
                    previous = cleared
                }
            }
        })
    })
})
