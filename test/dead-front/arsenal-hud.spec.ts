import { describe, expect, it } from 'vitest'
import { DF_MAP, dfInteractables } from '#shared/utils/dead-front/map'
import type { DfPlayerSnap, DfSnapshot, DfWorldSnap } from '#shared/utils/dead-front/protocol'
import { DF_RARITIES } from '#shared/utils/dead-front/rarity'
import { DF_RECIPES, dfMergeArsenalMine } from '#shared/utils/dead-front/salvage'
import type { DfArsenalSnap } from '#shared/utils/dead-front/salvage'
import { DF_BENCH_PICKS, dfArsenalFeedLine, dfBenchList, dfBenchPrompt, dfKitPrompt } from '../../app/utils/dead-front/engine/arsenal-prompt'
import { dfHudFeedLine } from '../../app/utils/dead-front/engine/hud'
import type { DfHudFeedContext } from '../../app/utils/dead-front/engine/hud'
import { DfHintTracker } from '../../app/utils/dead-front/engine/hints'
import type { DfHintFacts } from '../../app/utils/dead-front/engine/hints'
import { dfPromptFor } from '../../app/utils/dead-front/engine/prompt'

function player(over: Partial<DfPlayerSnap> = {}): DfPlayerSnap {
    return {
        pid: 0, userId: 'u', name: 'Tommy', pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, flags: 0,
        life: 'alive', health: 150, maxHealth: 150, points: 500, kills: 0, headshots: 0, downs: 0, revives: 0,
        perks: [], weapons: [{ id: 'thompson', pap: 0, mag: 30, reserve: 120, attachments: {} }], slot: 0,
        grenades: 2, bleedout: 0, reviveProgress: 0, selfRevives: 0, connected: true, ...over
    }
}

function world(arsenal: Partial<DfArsenalSnap> = {}, over: Partial<DfWorldSnap> = {}): DfWorldSnap {
    return {
        doors: [], planks: {}, power: false,
        box: { spot: 0, state: 'idle', timer: 0 },
        pap: { state: 'idle', timer: 0 },
        egg: { step: 'power', fusesFound: [], charge: 0, chargeNeeded: 15, rodsOn: [], rodTimer: 0 },
        double: 0, insta: 0,
        arsenal: { players: [{ pid: 0, equip: null, kit: false, support: [] }], sentries: [], decoys: [], scrap: 0, parts: 0, ...arsenal },
        ...over
    }
}

const bench = dfInteractables(DF_MAP).find(i => i.kind === 'bench')!

describe('arsenal HUD: the workbench', () => {
    it('lists every recipe and the upgrade, says why one can\'t be made', () => {
        const items = dfBenchList({ world: world({ scrap: 7, parts: 0 }), me: player() }, 'sentry')
        expect(items.map(i => i.key)).toEqual(['sentry', 'decoy', 'kit', 'barrage', 'zeppelin', 'launcher', 'bomber', 'upgrade'])
        expect(items.map(i => i.key)).toEqual([...DF_BENCH_PICKS])
        expect(items.find(i => i.key === 'sentry')).toMatchObject({ ok: true, selected: true })
        expect(items.find(i => i.key === 'launcher')).toMatchObject({ ok: false, why: `Need ${DF_RECIPES.launcher.scrap - 7} more scrap` })
        expect(items.find(i => i.key === 'kit')).toMatchObject({ ok: false, why: `Need ${DF_RECIPES.kit.scrap - 7} more scrap` })
        const up = items.find(i => i.key === 'upgrade')!
        expect(up.ok).toBe(true)
        expect(up.name).toContain('Rare')
        expect(up.tint).toBe(DF_RARITIES[1]!.color)
    })

    it('the prompt: hold F to make it, tap for the next; greyed with the reason', () => {
        const ok = dfPromptFor(bench, { map: DF_MAP, world: world({ scrap: 20 }), me: player(), solo: true, benchPick: 'sentry' })!
        expect(ok.text).toBe('Hold F to craft Lewis Sentry')
        expect(ok.ok).toBe(true)
        expect(ok.action).toBe('none')
        const no = dfBenchPrompt(bench, { world: world({ scrap: 0 }), me: player() }, 'decoy')!
        expect(no.ok).toBe(false)
        expect(no.sub).toContain('more scrap')
        const legendary = dfBenchPrompt(bench, { world: world({ scrap: 99, parts: 9 }), me: player({ weapons: [{ id: 'thompson', pap: 0, mag: 30, reserve: 120, attachments: {}, rarity: 3 }] }) }, 'upgrade')!
        expect(legendary.ok).toBe(false)
        expect(legendary.sub).toContain('Already Legendary')
    })

    it('upgrade kits on the ground: apply, or "Already Epic"', () => {
        const kit = { id: 4, tier: 2, pos: { x: 0, y: 0, z: 0 }, yaw: 0, ttl: 100 }
        const apply = dfKitPrompt(kit, player())
        expect(apply.text).toBe('Hold F to apply the Epic Upgrade Kit')
        expect(apply.ok).toBe(true)
        expect(apply.tint).toBe(DF_RARITIES[2]!.color)
        const keep = dfKitPrompt(kit, player({ weapons: [{ id: 'thompson', pap: 0, mag: 30, reserve: 120, attachments: {}, rarity: 2 }] }))
        expect(keep.ok).toBe(false)
        expect(keep.sub).toBe('Already Epic')
    })

    it('the box offer names a weapon or a kit in its rarity colour', () => {
        const box = dfInteractables(DF_MAP).find(i => i.kind === 'box' && i.id === DF_MAP.boxSpots[0]!.id)!
        const offer = (b: Partial<DfWorldSnap['box']>) => dfPromptFor(box, { map: DF_MAP, world: world({}, { box: { spot: 0, state: 'ready', owner: 0, timer: 5, ...b } }), me: player(), solo: true })!
        expect(offer({ weapon: 'mp18', rarity: 3 }).tint).toBe(DF_RARITIES[3]!.color)
        expect(offer({ weapon: 'mp18' }).tint).toBeUndefined()
        expect(offer({ kit: 1 }).text).toBe('Hold F to take the Rare Upgrade Kit')
    })
})

describe('arsenal HUD: feed, snapshot slice and hints', () => {
    const c: DfHudFeedContext = { me: 0, name: p => `P${p}`, color: () => '#fff', doorLabel: () => null, weaponName: id => id.toUpperCase(), powerupName: () => '' }

    it('feed lines for rarity, support and challenges (the weapon line in its colour)', () => {
        const pulled = dfHudFeedLine({ k: 'rarity', p: 1, weapon: 'thompson', rarity: 3, how: 'box' }, c)!
        expect(pulled.text).toBe('pulled a Legendary THOMPSON')
        expect(pulled.textColor).toBe(DF_RARITIES[3]!.color)
        expect(dfHudFeedLine({ k: 'rarity', p: 0, weapon: 'mp18', rarity: 1, how: 'bench' }, c)!.text).toBe('upgraded the MP18 to Rare')
        expect(dfHudFeedLine({ k: 'strike', p: 1, reward: 'barrage', id: 1, at: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 }, hits: [] }, c)!.text).toBe('called in an Artillery Barrage')
        expect(dfArsenalFeedLine({ k: 'salvage', p: 0, kind: 'scrap', n: 1, id: 1, pos: { x: 0, y: 0, z: 0 } }, { me: 0, line: () => ({ tone: 'pale', who: null, whoColor: null, text: '', target: null, targetColor: null }), weaponName: id => id })).toBeNull()
    })

    it('the private slice folds into the world and the events', () => {
        const s = {
            world: world({ scrap: undefined, parts: undefined }),
            events: [],
            mine: { scrap: 5, parts: 1, drops: [{ id: 3, kind: 'scrap' as const, pos: { x: 0, y: 0, z: 0 }, n: 2, ttl: 30 }], events: [{ k: 'salvage' as const, p: 0, kind: 'scrap' as const, n: 2, id: 9, pos: { x: 0, y: 0, z: 0 } }] }
        } as unknown as DfSnapshot
        dfMergeArsenalMine(s)
        expect(s.world.arsenal!.scrap).toBe(5)
        expect(s.world.arsenal!.drops).toHaveLength(1)
        expect(s.events).toHaveLength(1)
        expect(s.mine).toBeUndefined()
    })

    it('teaches salvage, the bench, gear and support once each', () => {
        const t = new DfHintTracker()
        const f: DfHintFacts = {
            time: 10, alive: true, round: 3, phase: 'active', points: 0, brokenWindowNear: false, zombieClose: false, wallbuyNear: false,
            cheapestDoor: Infinity, doorsOpen: 1, power: true, perkNear: false, downedMate: null, reviving: false, salvage: 3
        }
        expect(t.update(f)?.id).toBe('salvage')
        f.time = 30
        f.reward = 'Artillery Barrage'
        // the first hint's time is up, a breather, then the next
        expect(t.update(f)).toBeNull()
        f.time = 34
        expect(t.update(f)?.text).toBe('Hold X to call in the Artillery Barrage')
    })
})
