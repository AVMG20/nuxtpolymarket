import { DF_SUPPORT_HELD, DF_SUPPORT } from '#shared/utils/dead-front/support'
import type { DfSupportId } from '#shared/utils/dead-front/support'
import type { DfInteractable } from '#shared/utils/dead-front/map'
import type { DfEvent, DfHeldWeapon, DfPlayerSnap, DfWorldSnap } from '#shared/utils/dead-front/protocol'
import { DF_RARITY_MAX, dfClampRarity, dfKitFits, dfKitName, dfRarity, dfRarityApplies, dfRarityUpgradeCost } from '#shared/utils/dead-front/rarity'
import { DF_CRAFT_ORDER, DF_RECIPES, dfCraftBlockText, dfCraftBlocked, dfCrateBlocked, dfRecipeCost } from '#shared/utils/dead-front/salvage'
import type { DfCraftId, DfCrateSnap, DfKitDropSnap, DfKitState, DfSalvagePool } from '#shared/utils/dead-front/salvage'
import { DF_WEAPONS } from '#shared/utils/dead-front/weapons'
import type { DfHudFeedLine, DfHudFeedTone } from './hud'
import type { DfPrompt } from './prompt'

// The pure side of the arsenal HUD (tested): the workbench prompt and its
// craft list, the upgrade-kit prompt, the squad-feed lines for crafting,
// rarity and support, and the HUD state shape the Vue overlay renders.

/** What the bench is set to make: a recipe or a rarity upgrade of the held weapon. */
export type DfBenchPick = DfCraftId | 'upgrade'

export const DF_BENCH_PICKS: readonly DfBenchPick[] = [...DF_CRAFT_ORDER, 'upgrade']

/** Cards per row in the bench shop (the arrows step a row with up / down). */
export const DF_BENCH_COLS = 4

export interface DfHudBenchItem {
    key: DfBenchPick
    name: string
    /** "12 scrap · 1 part" (empty when there's nothing to pay for). */
    cost: string
    ok: boolean
    /** Why not, when it can't be made (its description when it can). */
    why: string
    /** One line on what it does. */
    desc: string
    selected: boolean
    /** Name colour (an upgrade's tier). */
    tint: string | null
    /** Its accent colour (the card's icon and glow). */
    color: string
    scrap: number
    /** Short of scrap for it. */
    shortScrap: boolean
    /** The weapon an upgrade improves, and the tier it reaches. */
    weapon?: { id: DfHeldWeapon['id'], rarity: number }
}

export interface DfHudArsenal {
    scrap: number
    /** Seconds left on the lent grenade launcher (0: none out). */
    launcher: number
    equip: 'sentry' | 'decoy' | null
    kit: boolean
    /** Support held for X, oldest first (X calls in the newest). */
    support: { id: DfSupportId, name: string }[]
    /** The bench shop while it is open. */
    bench: { items: DfHudBenchItem[], hold: number } | null
    /** Bumps when a craft is refused (the shop shakes). */
    denyKey: number
    challenge: { text: string, n: number, goal: number, done: boolean } | null
    /** Bumps on every pickup (the counter pops). */
    salvageKey: number
    /** Holding Q / X: what is being placed or called in. */
    targeting: string | null
}

export interface DfArsenalPromptCtx {
    world: DfWorldSnap
    me: DfPlayerSnap
}

function pool(w: DfWorldSnap): DfSalvagePool {
    return { scrap: w.arsenal?.scrap ?? 0 }
}

/** The local player's carried gear as the bench rules see it. */
export function dfKitStateOf(c: DfArsenalPromptCtx): DfKitState {
    const g = c.world.arsenal?.players.find(p => p.pid === c.me.pid)
    return { equip: g?.equip ?? null, kit: g?.kit ?? false, support: g?.support.length ?? 0, supportMax: DF_SUPPORT_HELD.max }
}

/** The weapon in hand (one in the Pack-a-Punch isn't). */
export function dfHeldOf(me: DfPlayerSnap): DfHeldWeapon | null {
    const w = me.weapons[me.slot]
    return w && !w.away ? w : null
}

/** A weapon's name as the HUD shows it (its Pack-a-Punch name when packed). */
export function dfWeaponDisplayName(id: DfHeldWeapon['id'], pap = 0): string {
    const def = DF_WEAPONS[id]
    if (!def) return String(id)
    return pap > 0 ? def.papNames[Math.min(3, pap) - 1] ?? def.name : def.name
}

const UPGRADE_DESC = 'Raises the weapon in your hands one rarity tier: more damage, a bigger magazine'

/** One card of the bench shop. */
export function dfBenchItem(pick: DfBenchPick, c: DfArsenalPromptCtx, selected: boolean): DfHudBenchItem {
    const pl = pool(c.world)
    if (pick === 'upgrade') {
        const w = dfHeldOf(c.me)
        const base = { key: pick, selected, tint: null as string | null, desc: UPGRADE_DESC, color: dfRarity(1).color, scrap: 0, shortScrap: false }
        if (!w || !dfRarityApplies(w.id)) {
            const why = !w
                ? c.me.weapons[c.me.slot]?.away ? 'Your weapon is in the Pack-a-Punch' : 'Nothing in hand'
                : DF_WEAPONS[w.id]?.temporary ? 'A borrowed launcher can\'t be improved' : `The ${dfWeaponDisplayName(w.id, w.pap)} is one of a kind`
            return { ...base, name: 'Upgrade weapon', cost: '', ok: false, why }
        }
        const r = dfClampRarity(w.rarity)
        const cost = dfRarityUpgradeCost(r)
        const name = `${dfWeaponDisplayName(w.id, w.pap)} → ${r >= DF_RARITY_MAX ? dfRarity(r).name : dfRarity(r + 1).name}`
        if (!cost) return { ...base, name, cost: '', ok: false, why: 'Already Legendary', tint: dfRarity(r).color, color: dfRarity(r).color, weapon: { id: w.id, rarity: r } }
        const shortScrap = pl.scrap < cost.scrap
        const short = shortScrap ? `Need ${cost.scrap - pl.scrap} more scrap` : ''
        const next = dfRarity(r + 1).color
        return { ...base, name, cost: `${cost.scrap} scrap`, ok: !short, why: short || UPGRADE_DESC, tint: next, color: next, scrap: cost.scrap, shortScrap, weapon: { id: w.id, rarity: r + 1 } }
    }
    const r = DF_RECIPES[pick]
    const b = dfCraftBlocked(r, pl, dfKitStateOf(c))
    return {
        key: pick, name: r.name, cost: dfRecipeCost(r), ok: b === null, why: b ? dfCraftBlockText(b, r, pl) : r.desc, desc: r.desc, selected, tint: null,
        color: r.color, scrap: r.scrap, shortScrap: pl.scrap < r.scrap
    }
}

/** The bench's whole list, `pick` selected. */
export function dfBenchList(c: DfArsenalPromptCtx, pick: DfBenchPick): DfHudBenchItem[] {
    return DF_BENCH_PICKS.map(k => dfBenchItem(k, c, k === pick))
}

/** The workbench prompt (the shop is closed): press F to open it, and how much it would make. */
export function dfBenchPrompt(it: DfInteractable, c: DfArsenalPromptCtx): DfPrompt | null {
    if (c.me.life !== 'alive') return null
    const pl = pool(c.world)
    const can = DF_BENCH_PICKS.filter(k => dfBenchItem(k, c, false).ok).length
    const sub = `${pl.scrap} scrap · ${can ? `${can} thing${can === 1 ? '' : 's'} you can make` : 'nothing you can afford yet'}`
    return { id: it.id, kind: 'bench', text: 'Press F to open the workbench', sub, cost: null, ok: true, action: 'none', repeat: false }
}

function aOrAn(name: string): string {
    return /^[AEIOU]/i.test(name) ? 'an' : 'a'
}

/** The prompt for a supply crate this player can't carry right now (one they can is taken by walking over it). */
export function dfCratePrompt(cr: DfCrateSnap, c: DfArsenalPromptCtx): DfPrompt | null {
    const r = DF_RECIPES[cr.item]
    const block = dfCrateBlocked(cr.item, dfKitStateOf(c))
    if (!block) return null
    const why = block === 'full' ? 'Call in your support first (X)' : block === 'hands' ? 'Place your gear first (Q)' : 'Already carrying one'
    return { id: `crate:${cr.id}`, kind: 'crate', text: `Supply crate: ${r.name}`, sub: why, cost: null, ok: false, action: 'none', repeat: false, tint: r.color }
}

/** The prompt for an upgrade kit on the ground. */
export function dfKitPrompt(k: DfKitDropSnap, me: DfPlayerSnap): DfPrompt {
    const name = dfKitName(k.tier)
    const color = dfRarity(k.tier).color
    const w = dfHeldOf(me)
    const fit = dfKitFits(dfClampRarity(k.tier), w?.id, w?.rarity)
    const base = { id: `kit:${k.id}`, kind: 'kit' as const, cost: null, repeat: false, tint: color }
    if (fit === 'apply') return { ...base, text: `Hold F to apply the ${name}`, sub: `${dfWeaponDisplayName(w!.id, w!.pap)} becomes ${dfRarity(k.tier).name}`, ok: true, action: 'none' }
    if (fit === 'none') return { ...base, text: name, sub: w ? 'This weapon can\'t be improved' : 'Nothing in hand', ok: false, action: 'none' }
    return { ...base, text: name, sub: `Already ${dfRarity(w?.rarity).name}`, ok: false, action: 'none' }
}

interface FeedCtx {
    me: number
    line(tone: DfHudFeedTone, pid: number | null, text: string, target?: number | null): DfHudFeedLine
    weaponName(id: string): string
}

/** Squad-feed lines for the arsenal's events (null for the rest). */
export function dfArsenalFeedLine(ev: DfEvent, c: FeedCtx): DfHudFeedLine | null {
    switch (ev.k) {
        case 'rarity': {
            const rar = dfRarity(ev.rarity)
            const name = c.weaponName(ev.weapon)
            const text = ev.how === 'box' ? `pulled a ${rar.name} ${name}` : `upgraded the ${name} to ${rar.name}`
            return { ...c.line('gold', ev.p, text), textColor: rar.color }
        }
        case 'kitDrop':
            return { ...c.line('pale', ev.p, `set down a ${dfKitName(ev.tier)}`), textColor: dfRarity(ev.tier).color }
        case 'strike':
            return c.line('red', ev.p, `called in ${aOrAn(DF_SUPPORT[ev.reward].name)} ${DF_SUPPORT[ev.reward].name}`)
        case 'crate': {
            // a supply crate: found by its killer, or taken by someone else once it was open
            const r = DF_RECIPES[ev.item]
            const line = ev.p === ev.owner ? c.line('gold', ev.p, `found ${aOrAn(r.name)} ${r.name}`) : c.line('gold', ev.p, `took the ${r.name} found by`, ev.owner)
            return { ...line, textColor: r.color }
        }
        case 'deploy':
            return ev.p === c.me ? null : c.line('pale', ev.p, ev.item === 'sentry' ? 'set up a Lewis Sentry' : 'wound up a Gramophone')
        case 'sentry':
            return ev.what === 'broken' ? c.line('red', null, 'A sentry was torn apart') : null
        case 'challenge':
            if (ev.what === 'done') return c.line('green', null, `Challenge complete: ${ev.text}`)
            return null
        default:
            return null
    }
}
