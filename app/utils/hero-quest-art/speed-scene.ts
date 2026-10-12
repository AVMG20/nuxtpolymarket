// The Battle Speed scene: every block for sale as a grid, a row per speed and a column per length,
// each cell a Buy button with its price in Gems. Above it, the block running now and how long it
// has left; under it, what a boost does and, while offline efficiency is under 100%, that a boost
// spent away pays only that share of itself (`idle-mechanics.md` §3).

import { C } from './palette'
import type { Surface } from './surface'
import { drawText, textWidth } from './font'
import { glyph } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { plateButton, type Box } from './collections-scene'
import type { SceneBackdrops } from './menu-band'

export interface SpeedView {
    /** The speed running now; 1 when no block is. */
    multiplier: number
    /** The running block's time left, spelled out; null when none runs. */
    left: string | null
    /** The Gem balance, as shown and as a number to price against. */
    gems: string
    gemCount: number
    /** 0–1: the share of a boost a window spent away realises. */
    offlineEfficiency: number
    tiers: readonly { speed: number, blocks: readonly { minutes: number, gems: number }[] }[]
    /** A block pressed once, waiting for the second press that confirms it. */
    armed?: SpeedBlock | null
}

export interface SpeedBlock { speed: number, minutes: number }

const LABEL_X = 10
const GRID_X = 36
const CELL_W = 54
const CELL_H = 14
const GAP = 3
const HEAD_Y = 31
const GRID_Y = 40
const ROW_PITCH = 18
const NOTE_Y = 118
/** Room the Gem glyph takes after a price. */
const GEM_GAP = 15

const BUY_PLATE = [C.green0, C.green1, C.green2] as const
const CONFIRM_PLATE = [C.gold0, C.gold1, C.gold2] as const

function durationLabel(minutes: number): string {
    return minutes < 60 ? `${minutes} MIN` : `${minutes / 60} HOUR${minutes > 60 ? 'S' : ''}`
}

function cellBox(row: number, col: number): Box {
    return { x: GRID_X + col * (CELL_W + GAP), y: GRID_Y + row * ROW_PITCH, w: CELL_W, h: CELL_H }
}

/** The block whose Buy button a point on the view is over. */
export function speedBlockAt(view: SpeedView, x: number, y: number): SpeedBlock | null {
    for (let r = 0; r < view.tiers.length; r++) {
        const tier = view.tiers[r]!
        for (let c = 0; c < tier.blocks.length; c++) {
            const b = cellBox(r, c)
            if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return { speed: tier.speed, minutes: tier.blocks[c]!.minutes }
        }
    }
    return null
}

/** Whether a block can be bought now: affordable, and the running block's speed or none. */
export function speedBlockOpen(view: SpeedView, block: SpeedBlock): boolean {
    const price = view.tiers.find(t => t.speed === block.speed)?.blocks.find(b => b.minutes === block.minutes)?.gems
    return price !== undefined && price <= view.gemCount && (view.multiplier === 1 || view.multiplier === block.speed)
}

export class SpeedScene {
    constructor(private readonly backdrops: SceneBackdrops) {}

    /** `hover` is the block whose Buy button is under the pointer; `busy` holds every button. */
    render(t: number, view: SpeedView, hover: SpeedBlock | null, pressed: boolean, busy: boolean): Surface {
        // a tab in the Shop: the tabs stand where a title would (`shop-tabs.ts`), drawn over by the canvas
        const s = this.backdrops.render('shop', t, false)
        const gw = textWidth(view.gems.toUpperCase())
        drawText(s, view.gems.toUpperCase(), s.w - 6, 4, C.bone1, { align: 2, shadow: 1 })
        glyph(s, CURRENCY_ICONS.gems!, s.w - 6 - gw - 9, 6, true)

        if (view.left) drawText(s, `${view.multiplier}X RUNNING, ${view.left} LEFT`, 6, 16, C.gold3, { shadow: 1 })
        else drawText(s, 'NO BOOST RUNNING: BATTLES PLAY AT 1X', 6, 16, C.stone3, { shadow: 1 })

        const durations = view.tiers[0]?.blocks ?? []
        durations.forEach((b, c) => {
            const box = cellBox(0, c)
            drawText(s, durationLabel(b.minutes), box.x + (box.w >> 1), HEAD_Y, C.stone3, { align: 1, shadow: 1 })
        })
        view.tiers.forEach((tier, r) => {
            const running = view.multiplier === tier.speed
            drawText(s, `${tier.speed}X`, LABEL_X, cellBox(r, 0).y + 4, running ? C.gold3 : C.bone1, { shadow: 1 })
            tier.blocks.forEach((block, c) => {
                const box = cellBox(r, c)
                const enabled = !busy && speedBlockOpen(view, { speed: tier.speed, minutes: block.minutes })
                const lit = hover?.speed === tier.speed && hover.minutes === block.minutes
                // pressed once to spend: the cell waits for its confirm, the note under the grid says what for
                if (view.armed?.speed === tier.speed && view.armed.minutes === block.minutes) {
                    plateButton(s, box, 'CONFIRM', CONFIRM_PLATE, enabled, true, pressed)
                    return
                }
                plateButton(s, box, '', BUY_PLATE, enabled, lit, pressed)
                // the price beside the Gem that pays it, centred on the button
                const label = String(block.gems)
                const lw = textWidth(label) + GEM_GAP
                const sink = enabled && lit && pressed ? 1 : 0
                const x0 = box.x + ((box.w - lw) >> 1)
                drawText(s, label, x0, box.y + 4 + sink, enabled ? C.white : C.stone2, { shadow: 1 })
                glyph(s, CURRENCY_ICONS.gems!, x0 + lw - 6, box.y + (CELL_H >> 1) + sink, true)
            })
        })

        const armed = view.armed
        const armedPrice = armed ? view.tiers.find(t => t.speed === armed.speed)?.blocks.find(b => b.minutes === armed.minutes)?.gems : undefined
        const notes = armed && armedPrice !== undefined
            ? [`PRESS AGAIN TO BUY ${armed.speed}X FOR ${durationLabel(armed.minutes)}: ${armedPrice} GEMS.`]
            : ['WAVES EARN FASTER. A BOSS FIGHT ONLY PLAYS FASTER.']
        if (view.multiplier > 1) notes.push(`BUY ${view.multiplier}X AGAIN TO EXTEND IT. OTHER SPEEDS WAIT FOR IT TO END.`)
        if (view.offlineEfficiency < 1) notes.push(`AWAY, A BOOST PAYS AT YOUR ${Math.round(view.offlineEfficiency * 100)}% OFFLINE RATE.`)
        notes.forEach((n, k) => drawText(s, n, 6, NOTE_Y + k * 8, C.stone3, { shadow: 1 }))
        return s
    }
}
