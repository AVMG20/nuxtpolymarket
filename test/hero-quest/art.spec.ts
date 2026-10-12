import { describe, expect, it } from 'vitest'
import { allArt, artById, ART_GROUPS, ART_ROUNDS } from '../../app/utils/hero-quest-art/catalog'
import { PALETTE, PALETTE_RGB, SCENERY, SCENERY_RAMPS, C, luma } from '../../app/utils/hero-quest-art/palette'
import { WORLD_SCENES, SW, SH, FLOOR_Y, FIGHT_BAND } from '../../app/utils/hero-quest-art/scenery'
import { ENEMY_WEAPONS, enemyLook } from '../../app/utils/hero-quest-art/enemies'
import { Surface } from '../../app/utils/hero-quest-art/surface'
import { HERO_ART, HERO_STATES } from '../../app/utils/hero-quest-art/heroes'
import { hasChampionSkin } from '../../app/utils/hero-quest-art/champions'
import { VFX_BY_ID } from '../../app/utils/hero-quest-art/vfx'
import { CLASS_NODES } from '#shared/utils/hero-quest/content/classes'
import { CHAMPIONS, CHAMPION_ABILITY_POOL, abilityId } from '#shared/utils/hero-quest/content/champions'
import { SKILLS } from '#shared/utils/hero-quest/content/skills'
import { ARTIFACTS } from '#shared/utils/hero-quest/content/artifacts'
import { GEAR } from '#shared/utils/hero-quest/content/gear'
import { WORLDS } from '#shared/utils/hero-quest/content/worlds'

// The art is procedural and keyed by content ID, so "is there art for X" is a property of the
// code. These pin it: a new class, Champion, skill or world without art fails here, and the
// counts are the ones asset-list.md locks.

const ids = new Set(allArt().map(a => a.id))
const count = (prefix: string) => allArt().filter(a => a.id.startsWith(prefix)).length

describe('Hero Quest art coverage', () => {
    it('gives every class node all six Hero states — 102 spritesheets, the Ascendant\'s included', () => {
        for (const node of CLASS_NODES) {
            expect(HERO_ART[node.id], node.id).toBeDefined()
            for (const st of HERO_STATES) expect(ids.has(`hero/${node.id}/${st}`), `${node.id} ${st}`).toBe(true)
        }
        expect(count('hero/')).toBe(102)
    })

    it('has 4 Champion chassis × 6 states and a skin for all 48 Champions', () => {
        expect(count('champion/chassis_')).toBe(24)
        for (const c of CHAMPIONS) expect(hasChampionSkin(c.id), c.id).toBe(true)
        expect(CHAMPIONS).toHaveLength(48)
    })

    it('has 3 summons × Move/Attack', () => {
        expect(count('summon/')).toBe(6)
    })

    it('dresses all 4 weapon rigs in every world, with the elite mark, a boss and a super boss', () => {
        for (const w of WORLDS) {
            for (const rig of ['sword', 'axe', 'bow', 'staff']) {
                for (const st of ['idle', 'attack', 'hit', 'death']) expect(ids.has(`enemy/${w.id}/${rig}/${st}`), `${w.id} ${rig} ${st}`).toBe(true)
            }
            expect(ids.has(`enemy/${w.id}/elite/idle`)).toBe(true)
            // every boss also has a special: its body, and the whole of it staged against the party
            for (const st of ['idle', 'attack', 'hit', 'death', 'entry', 'special', 'special_stage']) {
                expect(ids.has(`boss/${w.id}/${st}`), `boss ${w.id} ${st}`).toBe(true)
                expect(ids.has(`superboss/${w.id}/${st}`), `super ${w.id} ${st}`).toBe(true)
            }
            expect(ids.has(`bg/world/${w.id}`), `background ${w.id}`).toBe(true)
        }
        expect(count('boss/') + count('superboss/')).toBe(140)
    })

    it('has a custom VFX for all 63 abilities — 17 Hero (Convergence among them), 28 Champion, 18 Training Grounds actives', () => {
        for (const node of CLASS_NODES) expect(VFX_BY_ID[node.skill.id], node.skill.id).toBeDefined()
        for (const names of Object.values(CHAMPION_ABILITY_POOL)) for (const n of names) expect(VFX_BY_ID[abilityId(n)], n).toBeDefined()
        for (const s of SKILLS.filter(s => s.type === 'active')) expect(VFX_BY_ID[s.id], s.id).toBeDefined()
        expect(Object.keys(VFX_BY_ID)).toHaveLength(63)
    })

    it('has all 219 static icons: asset-list §3\'s 217, and the Ascendant\'s skill and medallion', () => {
        for (const node of CLASS_NODES) {
            expect(ids.has(`icon/skill/${node.skill.id}`), node.skill.id).toBe(true)
            expect(ids.has(`icon/class/${node.id}`), node.id).toBe(true)
        }
        for (const s of SKILLS) expect(ids.has(`icon/skill/${s.id}`), s.id).toBe(true)
        for (const names of Object.values(CHAMPION_ABILITY_POOL)) for (const n of names) expect(ids.has(`icon/ability/${abilityId(n)}`), n).toBe(true)
        for (const a of ARTIFACTS) expect(ids.has(`icon/artifact/${a.id}`), a.id).toBe(true)
        for (const g of GEAR) expect(ids.has(`icon/gear/${g.id}`), g.id).toBe(true)
        const icons = count('icon/skill/') + count('icon/ability/') + count('icon/artifact/') + count('icon/gear/') + count('icon/currency/')
            + count('frame/rarity/') + count('frame/trait/') + count('badge/archetype/') + count('icon/class/')
        expect(icons).toBe(219)
    })

    it('renders every asset to something, on the palette only', () => {
        for (const a of allArt()) {
            const s = new Surface(a.w, a.h, 0, 0)
            let drew = false
            for (const f of new Set([0, a.frames >> 1, a.frames - 1])) {
                s.clear()
                a.render(s, f)
                if (!s.isEmpty()) drew = true
                for (let i = 0; i < s.data.length; i++) if (s.data[i]! >= PALETTE.length) throw new Error(`${a.id} frame ${f} has an off-palette index`)
            }
            // a death's last frame is legitimately empty; some frame of every asset is not
            expect(drew, a.id).toBe(true)
        }
        // three frames of every asset, the full-scene special previews among them: seconds, not the default 5
    }, 30_000)

    it('tags every review round onto assets that exist', () => {
        // a typo in a round's prefix list would silently drop that asset from the gallery filter
        for (const r of ART_ROUNDS) {
            for (const p of r.prefixes) expect(allArt().some(a => a.id.startsWith(p)), `${r.label}: ${p}`).toBe(true)
            expect(allArt().filter(a => a.round === r.n).length, r.label).toBeGreaterThan(0)
        }
    })

    it('keeps review rounds off locked art', () => {
        // a locked group is settled: reopening it is a decision (unlock it in ART_GROUPS), not a round's side effect
        const locked = new Set(ART_GROUPS.filter(g => g.locked).map(g => g.id))
        for (const a of allArt()) if (a.round !== undefined) expect(locked.has(a.group), `${a.id} is locked`).toBe(false)
    })

    it('closes every Ascendant clip seamlessly: a loop onto itself, a one-shot onto idle', () => {
        // his six motes and the sway of his cape and robe run on one per-clip clock of whole turns
        const at = (st: string, f: number) => {
            const a = artById(`hero/class_ascendant/${st}`)!
            const s = new Surface(a.w, a.h, 0, 0)
            a.render(s, f < 0 ? a.frames : f)
            return s.data
        }
        const idleStart = at('idle', 0)
        for (const st of ['idle', 'move', 'attack', 'cast', 'hit']) {
            const end = at(st, -1)
            const start = st === 'idle' || st === 'move' ? at(st, 0) : idleStart
            expect(end.every((c, i) => c === start[i]), st).toBe(true)
        }
    })

    it('uses unique, path-shaped ids', () => {
        const all = allArt().map(a => a.id)
        expect(new Set(all).size).toBe(all.length)
        for (const id of all) expect(id).toMatch(/^[a-z0-9_]+(\/[a-z0-9_]+)+$/)
    })
})

// The palette's two tiers (palette.ts): characters are saturated and bright, scenery is darker
// and duller, and a world on the tier paints nothing but scenery behind its fighters. These
// are what stop an enemy blending into its own world — the Bramble Goblins once stood in
// front of hedges painted in their exact greens.

/** RGB distance under which two colours read as the same at a glance. */
const SAME_AT_A_GLANCE = 40
/** Share of a fight band allowed near an enemy's body colours. */
const MAX_BLEND = 0.05

function rgbDistance(a: number, b: number): number {
    const p = PALETTE_RGB[a]!
    const q = PALETTE_RGB[b]!
    return Math.hypot((p >> 16 & 255) - (q >> 16 & 255), (p >> 8 & 255) - (q >> 8 & 255), (p & 255) - (q & 255))
}

describe('Hero Quest palette tiers', () => {
    it('orders every scenery ramp dark → light', () => {
        for (const [name, ramp] of Object.entries(SCENERY_RAMPS)) {
            for (let i = 1; i < ramp.length; i++) expect(luma(C[ramp[i]!]), `${name} step ${i}`).toBeGreaterThan(luma(C[ramp[i - 1]!]))
        }
    })

    it('keeps every character off the scenery tier', () => {
        const bodies = ['hero/', 'champion/', 'summon/', 'enemy/', 'boss/', 'superboss/', 'raid/', 'arena/']
        for (const a of allArt()) {
            if (!bodies.some(p => a.id.startsWith(p))) continue
            // a special's staged preview is a scene with the boss in it, on a scenery backdrop
            if (/\/special\d*_stage$/.test(a.id)) continue
            const s = new Surface(a.w, a.h, 0, 0)
            for (const f of new Set([0, a.frames >> 1])) {
                s.clear()
                a.render(s, f)
                for (let i = 0; i < s.data.length; i++) if (SCENERY.has(s.data[i]!)) throw new Error(`${a.id} frame ${f} paints scenery colour ${s.data[i]}`)
            }
        }
    })

    it('paints the fight band of every tiered world in scenery only, clear of its enemies', () => {
        const tiered = WORLD_SCENES.filter(w => w.tiered)
        expect(tiered.length).toBeGreaterThan(0)
        for (const scene of tiered) {
            const index = WORLDS.findIndex(w => w.id === scene.id) + 1
            // the colours that make each of the world's creatures read: mid and light skin, clothes
            const body = ENEMY_WEAPONS.flatMap(kind => {
                const look = enemyLook(index, kind)
                return [look.skin[1], look.skin[2], look.pants, look.arm]
            })
            const s = new Surface(SW, SH, 0, 0)
            for (const t of [0, 0.8]) {
                s.clear()
                scene.draw(s, 0, t)
                let near = 0
                let n = 0
                for (let y = FLOOR_Y - FIGHT_BAND; y < FLOOR_Y; y++) {
                    for (let x = 0; x < SW; x++) {
                        const c = s.data[y * SW + x]!
                        if (!SCENERY.has(c)) throw new Error(`${scene.id} paints off-tier colour ${c} at ${x},${y}`)
                        n++
                        if (body.some(b => rgbDistance(b, c) < SAME_AT_A_GLANCE)) near++
                    }
                }
                expect(near / n, `${scene.id}: share of the fight band that blends with its enemies`).toBeLessThanOrEqual(MAX_BLEND)
            }
        }
    })
})
