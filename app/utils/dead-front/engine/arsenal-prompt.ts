import { DF_KILLSTREAK, DF_REWARDS } from '#shared/utils/dead-front/killstreaks'
import type { DfRewardId } from '#shared/utils/dead-front/killstreaks'
import type { DfInteractable } from '#shared/utils/dead-front/map'
import type { DfEvent, DfHeldWeapon, DfPlayerSnap, DfWorldSnap } from '#shared/utils/dead-front/protocol'
import { DF_RARITY_MAX, dfClampRarity, dfKitFits, dfKitName, dfRarity, dfRarityApplies, dfRarityUpgradeCost } from '#shared/utils/dead-front/rarity'
import { DF_CRAFT_ORDER, DF_RECIPES, dfCraftBlockText, dfCraftBlocked, dfRecipeCost } from '#shared/utils/dead-front/salvage'
import type { DfCraftId, DfKitDropSnap, DfKitState, DfSalvagePool } from '#shared/utils/dead-front/salvage'
import { DF_WEAPONS } from '#shared/utils/dead-front/weapons'
import type { DfHudFeedLine, DfHudFeedTone } from './hud'
import type { DfPrompt } from './prompt'

// The pure side of the arsenal HUD (tested): the workbench prompt and its
// craft list, the upgrade-kit prompt, the squad-feed lines for crafting,
// rarity and support, and the HUD state shape the Vue overlay renders.

/** What the bench is set to make: a recipe or a rarity upgrade of the held weapon. */
export type DfBenchPick = DfCraftId | 'upgrade'

export const DF_BENCH_PICKS: readonly DfBenchPick[] = [...DF_CRAFT_ORDER, 'upgrade']

export interface DfHudBenchItem {
    key: DfBenchPick
    name: string
    cost: string
    ok: boolean
    /** Why not, when it can't be made. */
    why: string
    selected: boolean
    /** Name colour (an upgrade's tier). */
    tint: string | null
}

export interface DfHudArsenal {
    scrap: number
    parts: number
    /** Seconds left on the lent grenade launcher (0: none out). */
    launcher: number
    equip: 'sentry' | 'decoy' | null
    kit: boolean
    /** Kills toward the next reward. */
    streak: number
    next: { name: string, at: number, from: number }
    rewards: { id: DfRewardId, name: string }[]
    /** The craft list while at a bench. */
    bench: { items: DfHudBenchItem[], hold: number } | null
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
    return { scrap: w.arsenal?.scrap ?? 0, parts: w.arsenal?.parts ?? 0 }
}

/** The local player's carried gear as the bench rules see it. */
export function dfKitStateOf(c: DfArsenalPromptCtx): DfKitState {
    const g = c.world.arsenal?.players.find(p => p.pid === c.me.pid)
    return { equip: g?.equip ?? null, kit: g?.kit ?? false, rewards: g?.rewards.length ?? 0, rewardsMax: DF_KILLSTREAK.maxHeld }
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

/** One line of the bench's list. */
export function dfBenchItem(pick: DfBenchPick, c: DfArsenalPromptCtx, selected: boolean): DfHudBenchItem {
    const pl = pool(c.world)
    if (pick === 'upgrade') {
        const w = dfHeldOf(c.me)
        const base = { key: pick, selected, tint: null as string | null }
        if (!w || !dfRarityApplies(w.id)) {
            const why = !w
                ? c.me.weapons[c.me.slot]?.away ? 'Your weapon is in the Pack-a-Punch' : 'Nothing in hand'
                : DF_WEAPONS[w.id]?.temporary ? 'A borrowed launcher can\'t be improved' : `The ${dfWeaponDisplayName(w.id, w.pap)} is one of a kind`
            return { ...base, name: 'Upgrade weapon', cost: '', ok: false, why }
        }
        const r = dfClampRarity(w.rarity)
        const cost = dfRarityUpgradeCost(r)
        const name = `${dfWeaponDisplayName(w.id, w.pap)} → ${r >= DF_RARITY_MAX ? dfRarity(r).name : dfRarity(r + 1).name}`
        if (!cost) return { ...base, name, cost: '', ok: false, why: 'Already Legendary', tint: dfRarity(r).color }
        const costText = cost.parts > 0 ? `${cost.scrap} scrap · ${cost.parts} part${cost.parts > 1 ? 's' : ''}` : `${cost.scrap} scrap`
        const short = pl.scrap < cost.scrap ? `Need ${cost.scrap - pl.scrap} more scrap` : pl.parts < cost.parts ? (cost.parts - pl.parts === 1 ? 'Need a rare part' : `Need ${cost.parts - pl.parts} more rare parts`) : ''
        return { ...base, name, cost: costText, ok: !short, why: short, tint: dfRarity(r + 1).color }
    }
    const r = DF_RECIPES[pick]
    const b = dfCraftBlocked(r, pl, dfKitStateOf(c))
    return { key: pick, name: r.name, cost: dfRecipeCost(r), ok: b === null, why: b ? dfCraftBlockText(b, r, pl) : r.desc, selected, tint: null }
}

/** The bench's whole list, `pick` selected. */
export function dfBenchList(c: DfArsenalPromptCtx, pick: DfBenchPick): DfHudBenchItem[] {
    return DF_BENCH_PICKS.map(k => dfBenchItem(k, c, k === pick))
}

/** The workbench prompt for the selected item: hold F to make it, tap F for the next. */
export function dfBenchPrompt(it: DfInteractable, c: DfArsenalPromptCtx, pick: DfBenchPick): DfPrompt | null {
    if (c.me.life !== 'alive') return null
    const item = dfBenchItem(pick, c, true)
    const verb = pick === 'upgrade' ? 'upgrade' : 'craft'
    const text = item.ok ? `Hold F to ${verb} ${item.name}` : `${pick === 'upgrade' ? 'Upgrade' : 'Craft'} ${item.name}`
    const sub = item.ok ? `${item.cost} · tap F for the next` : `${item.why}${item.cost ? ` · ${item.cost}` : ''} · tap F for the next`
    return { id: it.id, kind: 'bench', text, sub, cost: null, ok: item.ok, action: 'none', repeat: false, tint: item.tint ?? undefined }
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
            return c.line('red', ev.p, `called in ${ev.reward === 'barrage' ? 'an' : 'a'} ${DF_REWARDS[ev.reward].name}`)
        case 'reward':
            return ev.p === c.me ? null : c.line('gold', ev.p, `earned ${ev.reward === 'barrage' ? 'an' : 'a'} ${DF_REWARDS[ev.reward].name}`)
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
