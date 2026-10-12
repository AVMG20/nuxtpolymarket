// A scene's tabs along its top left, where its title would stand: the Shop's (Upgrades, Battle
// Speed) and the Calendar's (Calendar, Milestones), each tab a route of its own (the user's calls,
// 2026-10-10, to free menu buttons). The open one is lit and gold, one not open yet is dim, and one
// with something waiting carries a red dot.

import { C } from './palette'
import { rect, type Surface } from './surface'
import { drawText, textWidth } from './font'

export interface SceneTab {
    id: string
    label: string
    /** Its feature isn't open yet: drawn dim, never pressed. */
    locked?: boolean
    /** Something waits behind it: a red dot, as on the menu band. */
    alert?: boolean
}

const TAB_X = 4
const TAB_Y = 1
const TAB_H = 12
const TAB_PAD = 6
const TAB_GAP = 2

interface Box {
    x: number
    y: number
    w: number
    h: number
}

function tabBoxes(tabs: readonly SceneTab[]): Box[] {
    let x = TAB_X
    return tabs.map((tab) => {
        const w = textWidth(tab.label.toUpperCase()) + TAB_PAD * 2
        const b = { x, y: TAB_Y, w, h: TAB_H }
        x += w + TAB_GAP
        return b
    })
}

/** The tab under a point, or null. */
export function sceneTabAt(tabs: readonly SceneTab[], x: number, y: number): string | null {
    const boxes = tabBoxes(tabs)
    const i = boxes.findIndex(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
    return i < 0 ? null : tabs[i]!.id
}

/** The tabs, `open` lit. */
export function drawSceneTabs(s: Surface, tabs: readonly SceneTab[], open: string, hover: string | null): void {
    tabBoxes(tabs).forEach((b, i) => {
        const tab = tabs[i]!
        const on = tab.id === open
        const lit = !on && !tab.locked && hover === tab.id
        rect(s, b.x, b.y, b.w, b.h, C.ink)
        rect(s, b.x + 1, b.y + 1, b.w - 2, b.h - 2, on ? C.night1 : lit ? C.night2 : C.night0)
        rect(s, b.x + 1, b.y + 1, b.w - 2, 1, on ? C.night3 : C.night1)
        const color = on ? C.gold2 : tab.locked ? C.stone1 : lit ? C.bone1 : C.stone3
        drawText(s, tab.label.toUpperCase(), b.x + TAB_PAD, b.y + 3, color, { shadow: 1 })
        if (tab.alert && !tab.locked) {
            rect(s, b.x + b.w - 4, b.y + 1, 3, 3, C.ink)
            rect(s, b.x + b.w - 3, b.y + 2, 2, 2, C.red2)
        }
    })
}
