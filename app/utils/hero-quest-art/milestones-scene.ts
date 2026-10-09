// The Milestones scene: one card per milestone track, two columns of them. A card names the track's
// next step, with a bar of the feat toward it; a card with steps waiting pulses gold and claims them
// all when pressed. The last slot claims every track at once, and the line under the grid spells out
// what the card pointed at pays.

import { C } from './palette'
import { rect, type Surface } from './surface'
import { drawText, textWidth } from './font'
import { glyph, type Glyph } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { panel } from './ui-art'
import { plateButton, type Box } from './collections-scene'
import { KEY_ICON } from './raids-scene'
import type { SceneBackdrops } from './menu-band'
import { getRaid } from '../../../shared/utils/hero-quest/content/raids'
import { mergeMilestoneRewards, type MilestoneReward, type MilestoneRow } from '../../../shared/utils/hero-quest/milestones'
import type { GachaSystem } from '../../../shared/utils/hero-quest/gacha'

export interface MilestonesView {
    rows: readonly MilestoneRow[]
}

/** A track's card, by its place in `rows`, or the claim-all button. */
export type MilestonesTarget = 'all' | `row:${number}`

const COLS = 2
const ROWS = 6
const CARD_H = 19
const GAP_X = 4
const GAP_Y = 2
const GRID_X = 6
const GRID_Y = 14
const INFO_Y = GRID_Y + ROWS * (CARD_H + GAP_Y) + 1

const CLAIM_PLATE = [C.green0, C.green1, C.green2] as const

const SEAL_NAME: Readonly<Record<GachaSystem, string>> = { gear: 'FORGE SEALS', champion: 'GUILD SEALS', skill: 'SKILL SEALS', artifact: 'EXCAVATION SEALS' }
const OWNED_NOUN: Readonly<Record<GachaSystem, string>> = { gear: 'GEAR', champion: 'CHAMPIONS', skill: 'SKILLS', artifact: 'ARTIFACTS' }

/** A pennant planted on a hill: a World taken. */
const FLAG: Glyph = (g, x, y) => {
    rect(g, x - 7, y + 4, 15, 3, C.green1)
    rect(g, x - 5, y + 3, 11, 1, C.green2)
    rect(g, x - 2, y - 7, 1, 11, C.brown2)
    rect(g, x - 1, y - 7, 7, 5, C.red1)
    rect(g, x - 1, y - 7, 7, 1, C.red2)
    rect(g, x + 5, y - 5, 1, 1, C.red0)
}

function cardBox(w: number, i: number): Box {
    const cw = (w - 2 * GRID_X - (COLS - 1) * GAP_X) >> 1
    return { x: GRID_X + (i % COLS) * (cw + GAP_X), y: GRID_Y + Math.floor(i / COLS) * (CARD_H + GAP_Y), w: cw, h: CARD_H }
}

/** The claim-all button: the grid's last slot. */
function allBox(w: number): Box {
    const b = cardBox(w, COLS * ROWS - 1)
    return { x: b.x, y: b.y + 3, w: b.w, h: 13 }
}

function inside(b: Box, x: number, y: number): boolean {
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

/** `text`, cut short with an ellipsis where it would run past `w` px. */
function fit(text: string, w: number): string {
    if (textWidth(text) <= w) return text
    let cut = text
    while (cut.length && textWidth(`${cut}...`) > w) cut = cut.slice(0, -1)
    return `${cut.trimEnd()}...`
}

function iconFor(row: MilestoneRow): Glyph {
    if (row.kind === 'worlds') return FLAG
    if (row.kind === 'prestige') return CURRENCY_ICONS.void_shards!
    if (row.kind === 'raid') return CURRENCY_ICONS[KEY_ICON[row.raid!]]!
    return CURRENCY_ICONS[`seal_${row.system}`]!
}

/** What the next step asks for; once every step is claimed, what the track came to. */
export function milestoneTitle(row: MilestoneRow): string {
    const target = row.next?.target ?? row.progress
    switch (row.kind) {
        case 'worlds': return `CLEAR ${target} WORLD${target === 1 ? '' : 'S'}`
        case 'prestige': return `PRESTIGE ${target} TIME${target === 1 ? '' : 'S'}`
        case 'raid': return `${getRaid(row.raid!).name.toUpperCase()} LV ${target}`
        case 'collection': {
            const noun = OWNED_NOUN[row.system!]
            if (!row.next) return `ALL ${row.progress} ${noun} OWNED`
            return row.next.step === row.steps ? `OWN ALL ${target} ${noun}` : `OWN ${target} ${noun}`
        }
    }
}

/** Rewards spelled out in full, joined. */
export function milestoneRewardLabel(rewards: readonly MilestoneReward[]): string {
    return rewards.map((r) => {
        switch (r.kind) {
            case 'all_seals': return `${r.amount} OF EVERY SEAL`
            case 'seals': return `${r.amount} ${SEAL_NAME[r.system]}`
            case 'gems': return `${r.amount} GEMS`
            case 'keys': return `${r.amount} ${getRaid(r.raid).key.toUpperCase()}`
        }
    }).join(' + ')
}

/** Whether the claim-all button does anything now. */
export function milestonesClaimAllEnabled(view: MilestonesView): boolean {
    return view.rows.some(r => r.claimable.length > 0)
}

/** What a point on the view is over. */
export function milestonesTargetAt(view: MilestonesView, w: number, x: number, y: number): MilestonesTarget | null {
    if (inside(allBox(w), x, y)) return 'all'
    for (let i = 0; i < view.rows.length && i < COLS * ROWS - 1; i++) {
        if (inside(cardBox(w, i), x, y)) return `row:${i}`
    }
    return null
}

export class MilestonesScene {
    constructor(private readonly backdrops: SceneBackdrops) {}

    /** `hover` is what the pointer is over; `busy` holds every claim while one is on its way. */
    render(t: number, view: MilestonesView, hover: MilestonesTarget | null, pressed: boolean, busy: boolean): Surface {
        const s = this.backdrops.render('milestones', t, false)
        const ready = view.rows.filter(r => r.claimable.length > 0).length
        drawText(s, 'MILESTONES', 6, 4, C.gold2, { shadow: 1 })
        if (ready) drawText(s, `${ready} READY`, s.w - 6, 4, C.gold3, { align: 2, shadow: 1 })

        const pulse = Math.floor(t * 3) % 2 === 0
        view.rows.forEach((row, i) => {
            if (i >= COLS * ROWS - 1) return
            const b = cardBox(s.w, i)
            const waiting = row.claimable.length > 0
            const lit = hover === `row:${i}`
            const sink = waiting && lit && pressed && !busy ? 1 : 0
            panel(s, b.x, b.y + sink, b.w, b.h - sink, undefined, waiting ? C.night2 : C.night1)
            glyph(s, iconFor(row), b.x + 10, b.y + 10 + sink, true)

            const tx = b.x + 20
            const target = row.next?.target ?? row.progress
            drawText(s, milestoneTitle(row), tx, b.y + 3 + sink, row.next ? C.bone1 : C.stone3, { shadow: 1 })

            if (waiting) {
                const steps = row.reached - row.claimed
                drawText(s, steps > 1 ? `PRESS TO CLAIM ${steps} STEPS` : 'PRESS TO CLAIM', tx, b.y + 11 + sink, pulse || lit ? C.gold3 : C.gold1, { shadow: 1 })
            } else {
                // the feat toward the next step, and the count beside it; full once every step is claimed
                const count = row.next ? `${Math.min(row.progress, target)}/${target}` : 'DONE'
                const bw = b.w - 24 - textWidth(count) - 3
                drawText(s, count, b.x + b.w - 4, b.y + 11 + sink, C.stone3, { align: 2, shadow: 1 })
                const fill = row.next ? Math.floor(bw * Math.min(1, row.progress / Math.max(1, target))) : bw
                rect(s, tx, b.y + 12 + sink, bw, 3, C.ink)
                rect(s, tx, b.y + 12 + sink, fill, 3, row.next ? C.gold1 : C.green1)
                if (fill > 0) rect(s, tx, b.y + 12 + sink, fill, 1, row.next ? C.gold2 : C.green2)
            }

            // the outline: a card with steps waiting pulses gold
            const rim = waiting ? (pulse || lit ? C.gold3 : C.gold1) : lit ? C.steel3 : null
            if (rim !== null) {
                rect(s, b.x - 1, b.y - 1 + sink, b.w + 2, 1, rim)
                rect(s, b.x - 1, b.y + b.h, b.w + 2, 1, rim)
                rect(s, b.x - 1, b.y - 1 + sink, 1, b.h + 2 - sink, rim)
                rect(s, b.x + b.w, b.y - 1 + sink, 1, b.h + 2 - sink, rim)
            }
        })

        plateButton(s, allBox(s.w), ready ? 'CLAIM ALL' : 'NOTHING TO CLAIM', CLAIM_PLATE, ready > 0 && !busy, hover === 'all', pressed)

        // what the card pointed at pays: what's waiting, else its next step
        const at = hover?.startsWith('row:') ? view.rows[Number(hover.slice(4))] : undefined
        if (at) {
            const text = at.claimable.length
                ? `CLAIM: ${milestoneRewardLabel(at.claimable)}`
                : at.next
                    ? `STEP ${at.next.step}: ${milestoneRewardLabel(at.next.reward)}`
                    : 'EVERY STEP CLAIMED'
            drawText(s, fit(text, s.w - 12), 6, INFO_Y, at.claimable.length ? C.gold3 : C.bone1, { shadow: 1 })
        } else if (hover === 'all' && ready) {
            const all = mergeMilestoneRewards(view.rows.flatMap(r => r.claimable))
            drawText(s, fit(`CLAIM: ${milestoneRewardLabel(all)}`, s.w - 12), 6, INFO_Y, C.gold3, { shadow: 1 })
        } else {
            drawText(s, 'POINT AT A MILESTONE TO SEE WHAT IT PAYS.', 6, INFO_Y, C.stone2, { shadow: 1 })
        }
        return s
    }
}
