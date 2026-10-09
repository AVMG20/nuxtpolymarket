// The Arena scene (`arena.md`): five tabs over one panel, in the colosseum's tab background.
//
// Fight: the three candidates as cards (`ui-art.ts`'s `arena_candidate`), each its name, Rating,
// Defense GPN and the defence it fields as faces in their rows (the Training Dummy as itself), with
// an Attack button; under them today's attacks, an extra one to buy and a paid refresh. A season
// reward waiting goes on a gold strip above the cards. Defence: the stored defence as the Loadouts
// detail draws a slot, and the buttons that copy the live party or a saved Loadout into it. Shop:
// everything Medals buy, a row each. Log and Ranking: the battle log (`arena_log`) and the Rating
// leaderboard (`arena_leaderboard`), a page at a time.
//
// Every number shown comes from the server's payload; the scene decides nothing.

import { C } from './palette'
import { rect, blit, dither, type Surface } from './surface'
import { drawText, textWidth } from './font'
import { glyph, type Glyph } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { panel } from './ui-art'
import { headOf, HEAD } from './demo'
import { collectionTile, plateButton, type Box } from './collections-scene'
import { drawCreature } from './creature'
import { TRAINING_DUMMY } from './raids'
import { KEY_ICON } from './raids-scene'
import type { SceneBackdrops } from './menu-band'
import type { RaidId } from '../../../shared/utils/hero-quest/content/raids'
import { HQ_ARENA_TABS, HQ_ARENA_TAB_LABELS, type HqArenaTab } from '../hero-quest-scenes'

/** A face on a card or in the defence: an art asset (`hero/<class>` or `champion/<id>`) and its row. */
export interface ArenaFace { asset: string, row: 'front' | 'back' }

export interface ArenaCandidateView {
    slot: number
    /** What an attack names. */
    id: string
    dummy: boolean
    name: string
    /** This season's Rating; null for the dummy. */
    rating: number | null
    /** The defence's GPN, spelled out; null for the dummy. */
    gpn: string | null
    faces: readonly ArenaFace[]
}

export interface ArenaItemView {
    id: string
    kind: 'seals' | 'keys' | 'gold' | 'gems'
    /** The gacha a Seal is for, or the raid a Key opens: what picks its icon. */
    system?: string
    raid?: RaidId
    name: string
    /** What one buys, where the name doesn't say: Gold's "30 MIN" of income. */
    sub: string
    price: number
    /** Priced as a last resort (§6), and said so. */
    poor: boolean
}

function itemIcon(item: ArenaItemView): Glyph {
    switch (item.kind) {
        case 'seals': return CURRENCY_ICONS[`seal_${item.system}`] ?? MEDAL
        case 'keys': return CURRENCY_ICONS[KEY_ICON[item.raid!]] ?? MEDAL
        case 'gold': return CURRENCY_ICONS.gold!
        case 'gems': return CURRENCY_ICONS.gems!
    }
}

export interface ArenaLogView {
    /** WON / LOST as the attacker, HELD / FELL as the defender. */
    outcome: string
    won: boolean
    attacker: boolean
    opponent: string
    ratingChange: number
    medals: number
    /** How long ago, spelled out. */
    ago: string
}

export interface ArenaBoardRow { rank: number, name: string, rating: number, you: boolean, gap?: boolean }

export interface ArenaView {
    tab: HqArenaTab
    /** The open page of a paged tab (Shop has one; Log and Ranking page). */
    page: number
    busy: boolean
    rating: number
    medals: number
    season: number
    /** Time to the season's end, spelled out. */
    seasonLeft: string
    attemptsLeft: number
    attemptsFree: number
    attemptPrice: number
    refreshGems: number
    gems: number
    /** Finished seasons' rewards waiting to be claimed. */
    rewards: readonly { season: number, rank: number, medals: number }[]
    /** Null while the list loads. */
    candidates: readonly ArenaCandidateView[] | null
    /** Null with no defence set. */
    defense: {
        gpn: string
        faces: readonly ArenaFace[]
        skills: readonly { id: string, rarity: string }[]
        artifacts: readonly { id: string, rarity: string }[]
        gear: readonly { id: string, rarity: string }[]
    } | null
    /** The saved Loadouts a defence can be copied from, slot by slot. */
    loadouts: readonly { slotIndex: number, name: string, saved: boolean }[]
    shop: readonly ArenaItemView[]
    log: readonly ArenaLogView[] | null
    board: { rows: readonly ArenaBoardRow[], me: { rank: number, rating: number } | null } | null
}

export type ArenaTarget =
    | `tab:${HqArenaTab}`
    | `attack:${number}`
    | 'buy-attempt' | 'refresh' | 'claim'
    | 'def:live' | `def:${number}`
    | `shop:${string}:${1 | 10}`
    | 'prev' | 'next'

const TAB_Y = 2
const TAB_H = 13
const TAB_W = 50
const TAB_GAP = 2
const P = { x: 4, y: 14, w: 264 }
const BTN_H = 13
const CARD_GAP = 4
const LOG_ROWS = 11
const BOARD_ROWS = 10
const SHOP_ROWS = 6
const ROW_H = 10

const RED = [C.red0, C.red1, C.red2] as const
const GREEN = [C.green0, C.green1, C.green2] as const
const BLUE = [C.blue0, C.blue1, C.blue2] as const
const GOLD = [C.gold0, C.gold1, C.gold2] as const
const PURPLE = [C.purple0, C.purple1, C.purple2] as const
const STONE = [C.stone0, C.stone1, C.stone2] as const

const MEDAL = CURRENCY_ICONS.arena_medals!

function panelH(h: number): number {
    return h - P.y - 2
}

function tabX(w: number, i: number): number {
    const row = HQ_ARENA_TABS.length * TAB_W + (HQ_ARENA_TABS.length - 1) * TAB_GAP
    return ((w - row) >> 1) + i * (TAB_W + TAB_GAP)
}

const inside = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h

/** `text` cut to `max` px. */
function fit(text: string, max: number): string {
    let t = text
    while (t && textWidth(t) > max) t = t.slice(0, -1)
    return t
}

function btn(label: string, x: number, y: number): Box {
    return { x, y, w: textWidth(label) + 10, h: BTN_H }
}

// ── Layout, shared by drawing and hit-testing ────────────────────────────────────

function footerY(h: number): number {
    return P.y + panelH(h) - BTN_H - 4
}

function claimBox(): Box {
    return { x: P.x + P.w - 50, y: P.y + 15, w: 44, h: BTN_H }
}

function cardBoxes(view: ArenaView, h: number): Box[] {
    const top = P.y + 14 + (view.rewards.length ? 17 : 0)
    const bottom = footerY(h) - 3
    const w = Math.floor((P.w - 12 - 2 * CARD_GAP) / 3)
    return [0, 1, 2].map(i => ({ x: P.x + 6 + i * (w + CARD_GAP), y: top, w, h: bottom - top }))
}

function attackBox(card: Box): Box {
    return { x: card.x + 4, y: card.y + card.h - BTN_H - 4, w: card.w - 8, h: BTN_H }
}

function refreshLabel(view: ArenaView): string {
    return `REFRESH ${view.refreshGems} GEMS`
}

function buyAttemptLabel(view: ArenaView): string {
    return `+1 ATTACK ${view.attemptPrice} GEMS`
}

function fightFooter(view: ArenaView, h: number): { refresh: Box, buy: Box } {
    const y = footerY(h)
    const refresh = btn(refreshLabel(view), 0, y)
    refresh.x = P.x + P.w - 6 - refresh.w
    const buy = btn(buyAttemptLabel(view), 0, y)
    buy.x = refresh.x - 4 - buy.w
    return { refresh, buy }
}

function defenseButtons(view: ArenaView, h: number): { id: ArenaTarget, label: string, box: Box, enabled: boolean }[] {
    const y = footerY(h)
    const live = btn('COPY LIVE PARTY', P.x + 6, y)
    const out = [{ id: 'def:live' as ArenaTarget, label: 'COPY LIVE PARTY', box: live, enabled: true }]
    let x = live.x + live.w + 4 + textWidth('OR A LOADOUT') + 4
    for (const l of view.loadouts) {
        const label = String(l.slotIndex + 1)
        const box = { x, y, w: 13, h: BTN_H }
        out.push({ id: `def:${l.slotIndex}`, label, box, enabled: l.saved })
        x += 15
    }
    return out
}

function shopRowBox(i: number): Box {
    const colW = (P.w - 16) >> 1
    return { x: P.x + 6 + (i % 2) * (colW + 4), y: P.y + 14 + Math.floor(i / 2) * 20, w: colW, h: 19 }
}

function shopButtons(row: Box): { n: 1 | 10, box: Box }[] {
    const ten = { x: row.x + row.w - 22, y: row.y + 3, w: 20, h: BTN_H }
    const one = { x: ten.x - 20, y: row.y + 3, w: 18, h: BTN_H }
    return [{ n: 1, box: one }, { n: 10, box: ten }]
}

function pagerBoxes(h: number): { prev: Box, next: Box } {
    const y = footerY(h)
    const next = { x: P.x + P.w - 6 - 16, y, w: 16, h: BTN_H }
    return { prev: { x: next.x - 18, y, w: 16, h: BTN_H }, next }
}

/** How many pages the open tab has, at least 1. */
export function arenaPages(view: ArenaView): number {
    const rows = view.tab === 'log' ? view.log?.length ?? 0 : view.tab === 'ranking' ? view.board?.rows.length ?? 0 : view.tab === 'shop' ? view.shop.length : 0
    const per = view.tab === 'log' ? LOG_ROWS : view.tab === 'ranking' ? BOARD_ROWS : 2 * SHOP_ROWS
    return Math.max(1, Math.ceil(rows / per))
}

/** What a point on the view is over. */
export function arenaTargetAt(view: ArenaView, w: number, h: number, x: number, y: number): ArenaTarget | null {
    if (y >= TAB_Y && y < P.y) {
        for (let i = 0; i < HQ_ARENA_TABS.length; i++) {
            const x0 = tabX(w, i)
            if (x >= x0 && x < x0 + TAB_W) return `tab:${HQ_ARENA_TABS[i]!}`
        }
        return null
    }
    switch (view.tab) {
        case 'fight': {
            if (view.rewards.length && inside(claimBox(), x, y)) return 'claim'
            const cards = cardBoxes(view, h)
            for (let i = 0; i < cards.length; i++) if (inside(attackBox(cards[i]!), x, y)) return `attack:${i}`
            const f = fightFooter(view, h)
            if (inside(f.refresh, x, y)) return 'refresh'
            if (inside(f.buy, x, y)) return 'buy-attempt'
            return null
        }
        case 'defense':
            return defenseButtons(view, h).find(b => inside(b.box, x, y))?.id ?? null
        case 'shop': {
            const first = view.page * 2 * SHOP_ROWS
            for (let i = 0; i < 2 * SHOP_ROWS && first + i < view.shop.length; i++) {
                const hit = shopButtons(shopRowBox(i)).find(b => inside(b.box, x, y))
                if (hit) return `shop:${view.shop[first + i]!.id}:${hit.n}`
            }
            break
        }
        default:
    }
    if (arenaPages(view) > 1) {
        const p = pagerBoxes(h)
        if (inside(p.prev, x, y)) return 'prev'
        if (inside(p.next, x, y)) return 'next'
    }
    return null
}

/** Whether a press on `target` does anything now. */
export function arenaTargetEnabled(view: ArenaView, target: ArenaTarget): boolean {
    if (target.startsWith('tab:')) return target !== `tab:${view.tab}`
    if (target === 'prev') return view.page > 0
    if (target === 'next') return view.page < arenaPages(view) - 1
    if (view.busy) return false
    if (target === 'claim') return view.rewards.length > 0
    if (target === 'refresh') return view.gems >= view.refreshGems
    if (target === 'buy-attempt') return view.gems >= view.attemptPrice
    if (target.startsWith('attack:')) {
        const c = view.candidates?.[Number(target.slice(7))]
        return !!c && view.attemptsLeft > 0 && (c.dummy || c.rating !== null)
    }
    if (target === 'def:live') return true
    if (target.startsWith('def:')) return view.loadouts.find(l => l.slotIndex === Number(target.slice(4)))?.saved ?? false
    if (target.startsWith('shop:')) {
        const [, id, n] = target.split(':')
        const item = view.shop.find(i => i.id === id)
        return !!item && view.medals >= item.price * Number(n)
    }
    return false
}

// ── Drawing ────────────────────────────────────────────────────────────────────────

export class ArenaScene {
    private readonly heads = new Map<string, Surface>()

    constructor(private readonly backdrops: SceneBackdrops) {}

    private head(asset: string): Surface {
        let h = this.heads.get(asset)
        if (!h) {
            h = headOf(asset)
            this.heads.set(asset, h)
        }
        return h
    }

    render(t: number, view: ArenaView, hover: ArenaTarget | null, pressed: boolean): Surface {
        const s = this.backdrops.render('arena', t, false)
        HQ_ARENA_TABS.forEach((id, i) => this.drawTab(s, i, id, view.tab, hover))
        const ph = panelH(s.h)
        panel(s, P.x, P.y, P.w, ph)
        // the open tab runs into the panel
        const open = HQ_ARENA_TABS.indexOf(view.tab)
        rect(s, tabX(s.w, open) + 1, P.y, TAB_W - 2, 2, C.night1)
        this.drawHeader(s, view)
        const enabled = (target: ArenaTarget) => arenaTargetEnabled(view, target)
        const lit = (target: ArenaTarget) => hover === target
        switch (view.tab) {
            case 'fight': this.drawFight(s, t, view, lit, enabled, pressed); break
            case 'defense': this.drawDefense(s, view, lit, enabled, pressed); break
            case 'shop': this.drawShop(s, view, lit, enabled, pressed); break
            case 'log': this.drawLog(s, view); break
            case 'ranking': this.drawRanking(s, view); break
        }
        if (arenaPages(view) > 1) {
            const p = pagerBoxes(s.h)
            plateButton(s, p.prev, '<', STONE, enabled('prev'), lit('prev'), pressed)
            plateButton(s, p.next, '>', STONE, enabled('next'), lit('next'), pressed)
            drawText(s, `${view.page + 1}/${arenaPages(view)}`, p.prev.x - 4, p.prev.y + 4, C.stone3, { align: 2, shadow: 1 })
        }
        return s
    }

    private drawTab(s: Surface, i: number, id: HqArenaTab, open: HqArenaTab, hover: ArenaTarget | null): void {
        const x = tabX(s.w, i)
        const on = id === open
        rect(s, x, TAB_Y, TAB_W, TAB_H + (on ? 1 : 0), C.ink)
        rect(s, x + 1, TAB_Y + 1, TAB_W - 2, TAB_H - (on ? 0 : 2), on ? C.night1 : hover === `tab:${id}` ? C.night2 : C.night0)
        rect(s, x + 1, TAB_Y + 1, TAB_W - 2, 1, on ? C.night3 : C.night1)
        drawText(s, HQ_ARENA_TAB_LABELS[id].toUpperCase(), x + (TAB_W >> 1), TAB_Y + 4, on ? C.gold2 : C.bone0, { align: 1, shadow: 1 })
    }

    /** The line every tab shares: Rating, the season and its clock, and the Medals in hand. */
    private drawHeader(s: Surface, view: ArenaView): void {
        const y = P.y + 4
        const rw = drawText(s, 'RATING', P.x + 6, y, C.stone3, { shadow: 1 })
        drawText(s, String(view.rating), P.x + 10 + rw, y, C.gold3, { shadow: 1 })
        drawText(s, `SEASON ${view.season}  ${view.seasonLeft}`, P.x + (P.w >> 1) + 10, y, C.bone0, { align: 1, shadow: 1 })
        const medals = String(view.medals)
        const right = P.x + P.w - 6
        drawText(s, medals, right, y, C.gold3, { align: 2, shadow: 1 })
        glyph(s, MEDAL, right - textWidth(medals) - 7, y + 1, true)
        rect(s, P.x + 4, P.y + 11, P.w - 8, 1, C.night2)
    }

    // ── Fight ──

    private drawFight(s: Surface, t: number, view: ArenaView, lit: (t: ArenaTarget) => boolean, enabled: (t: ArenaTarget) => boolean, pressed: boolean): void {
        if (view.rewards.length) {
            // a finished season's reward, waiting: a gold strip over the cards
            const box = claimBox()
            panel(s, P.x + 4, box.y - 2, P.w - 8, BTN_H + 4, GOLD, C.night2)
            const best = view.rewards.reduce((a, b) => b.medals > a.medals ? b : a)
            const total = view.rewards.reduce((sum, r) => sum + r.medals, 0)
            const text = view.rewards.length === 1
                ? `SEASON ${best.season} OVER: RANK ${best.rank}, ${total} MEDALS`
                : `${view.rewards.length} SEASONS OVER: ${total} MEDALS`
            drawText(s, fit(text, box.x - P.x - 14), P.x + 9, box.y + 4, C.gold3, { shadow: 1 })
            plateButton(s, box, 'CLAIM', GREEN, enabled('claim'), lit('claim'), pressed)
        }

        const cards = cardBoxes(view, s.h)
        if (!view.candidates) {
            drawText(s, 'FINDING OPPONENTS...', P.x + (P.w >> 1), cards[0]!.y + 30, C.stone3, { align: 1, shadow: 1 })
        } else {
            view.candidates.forEach((c, i) => {
                const b = cards[i]
                if (b) this.drawCard(s, t, b, c, `attack:${i}`, view, lit, enabled, pressed)
            })
        }

        const y = footerY(s.h)
        const left = view.attemptsLeft
        drawText(s, 'ATTACKS', P.x + 6, y + 4, C.stone3, { shadow: 1 })
        drawText(s, `${left}/${view.attemptsFree}`, P.x + 6 + textWidth('ATTACKS') + 4, y + 4, left > 0 ? C.gold3 : C.red2, { shadow: 1 })
        const f = fightFooter(view, s.h)
        plateButton(s, f.buy, buyAttemptLabel(view), PURPLE, enabled('buy-attempt'), lit('buy-attempt'), pressed)
        plateButton(s, f.refresh, refreshLabel(view), BLUE, enabled('refresh'), lit('refresh'), pressed)
    }

    private drawCard(s: Surface, t: number, b: Box, c: ArenaCandidateView, target: ArenaTarget, view: ArenaView, lit: (t: ArenaTarget) => boolean, enabled: (t: ArenaTarget) => boolean, pressed: boolean): void {
        const gone = !c.dummy && c.rating === null
        panel(s, b.x, b.y, b.w, b.h, c.dummy ? STONE : RED, c.dummy ? C.night0 : C.night1)
        if (lit(target)) this.ring(s, b)
        const cx = b.x + (b.w >> 1)
        drawText(s, fit(c.name.toUpperCase(), b.w - 8), cx, b.y + 4, c.dummy ? C.bone0 : C.white, { align: 1, shadow: 1 })
        if (c.dummy) {
            drawText(s, 'ALWAYS A WIN', cx, b.y + 12, C.stone3, { align: 1, shadow: 1 })
            drawCreature(s, cx, attackBox(b).y - 3, TRAINING_DUMMY, 'static', t, -1)
        } else if (gone) {
            drawText(s, 'NO LONGER HERE', cx, b.y + 30, C.stone2, { align: 1, shadow: 1 })
        } else {
            drawText(s, String(c.rating), b.x + 5, b.y + 12, C.gold3, { shadow: 1 })
            drawText(s, c.gpn ?? '', b.x + b.w - 5, b.y + 12, C.stone3, { align: 2, shadow: 1 })
            this.drawFaces(s, b.x + 5, b.y + 21, b.w - 10, c.faces)
        }
        plateButton(s, attackBox(b), 'ATTACK', RED, enabled(target), lit(target), pressed)
    }

    /** A party's faces in two rows, front over back, the row's letter before each. */
    private drawFaces(s: Surface, x: number, y: number, w: number, faces: readonly ArenaFace[]): void {
        const pitch = Math.min(16, Math.floor((w - 8 - HEAD) / 2))
        const rows = ['front', 'back'] as const
        rows.forEach((row, k) => {
            const ry = y + k * (HEAD + 1)
            drawText(s, row === 'front' ? 'F' : 'B', x, ry + 7, row === 'front' ? C.red3 : C.blue2, { shadow: 1 })
            faces.filter(f => f.row === row).forEach((f, i) => blit(s, this.head(f.asset), x + 6 + i * pitch, ry))
        })
    }

    private ring(s: Surface, b: Box): void {
        rect(s, b.x - 1, b.y - 1, b.w + 2, 1, C.white)
        rect(s, b.x - 1, b.y + b.h, b.w + 2, 1, C.white)
        rect(s, b.x - 1, b.y, 1, b.h, C.white)
        rect(s, b.x + b.w, b.y, 1, b.h, C.white)
    }

    // ── Defence ──

    private drawDefense(s: Surface, view: ArenaView, lit: (t: ArenaTarget) => boolean, enabled: (t: ArenaTarget) => boolean, pressed: boolean): void {
        const x = P.x + 6
        const y = P.y + 15
        const d = view.defense
        if (!d) {
            drawText(s, 'NO DEFENCE SET.', x, y + 4, C.gold2, { shadow: 1 })
            const lines = [
                'OTHER PLAYERS CAN ONLY DRAW YOU AS AN OPPONENT',
                'ONCE YOU HAVE ONE. THE AI FIGHTS WITH IT WHILE',
                'YOU ARE AWAY; IT NEVER CHANGES YOUR LIVE PARTY.',
                'COPY YOUR LIVE PARTY OR A SAVED LOADOUT BELOW.'
            ]
            lines.forEach((line, i) => drawText(s, line, x, y + 16 + i * 8, C.stone3, { shadow: 1 }))
        } else {
            const lw = drawText(s, 'DEFENSE GPN', x, y, C.stone3, { shadow: 1 })
            drawText(s, d.gpn, x + lw + 4, y, C.gold3, { shadow: 1 })
            this.drawFaces(s, x, y + 10, 100, d.faces)
            const rx = P.x + 112
            const group = (label: string, tab: 'skills' | 'artifacts' | 'gear', entries: readonly { id: string, rarity: string }[], gy: number) => {
                const w = drawText(s, label, rx, gy, C.gold2, { shadow: 1 })
                drawText(s, String(entries.length), rx + w + 4, gy, C.bone0, { shadow: 1 })
                if (!entries.length) drawText(s, 'NONE', rx, gy + 13, C.stone2, { shadow: 1 })
                entries.forEach((e, k) => blit(s, collectionTile(tab, { ...e, owned: true, mark: null }), rx + k * 24, gy + 7))
            }
            group('SKILLS', 'skills', d.skills, y)
            group('ARTIFACTS', 'artifacts', d.artifacts, y + 33)
            group('GEAR', 'gear', d.gear, y + 66)
            drawText(s, 'FOUGHT BY THE AI', x, y + 52, C.stone3, { shadow: 1 })
            drawText(s, 'WHILE YOU ARE AWAY.', x, y + 60, C.stone3, { shadow: 1 })
            drawText(s, 'NEVER YOUR LIVE PARTY.', x, y + 68, C.stone3, { shadow: 1 })
        }
        const buttons = defenseButtons(view, s.h)
        const live = buttons[0]!
        drawText(s, 'OR A LOADOUT', live.box.x + live.box.w + 4, live.box.y + 4, C.stone3, { shadow: 1 })
        for (const b of buttons) plateButton(s, b.box, b.label, b.id === 'def:live' ? GREEN : BLUE, enabled(b.id) && b.enabled, lit(b.id), pressed)
    }

    // ── Shop ──

    private drawShop(s: Surface, view: ArenaView, lit: (t: ArenaTarget) => boolean, enabled: (t: ArenaTarget) => boolean, pressed: boolean): void {
        const first = view.page * 2 * SHOP_ROWS
        view.shop.slice(first, first + 2 * SHOP_ROWS).forEach((item, i) => {
            const b = shopRowBox(i)
            rect(s, b.x, b.y, b.w, b.h, i % 4 < 2 ? C.night0 : C.night2)
            glyph(s, itemIcon(item), b.x + 9, b.y + 9, true)
            const buttons = shopButtons(b)
            const room = buttons[0]!.box.x - b.x - 22
            drawText(s, fit(item.name.toUpperCase(), room), b.x + 19, b.y + 3, C.bone1, { shadow: 1 })
            // a medal's glyph is taller than the row's second line: the price is spelled out instead
            const price = `${item.price} MEDALS`
            drawText(s, price, b.x + 19, b.y + 11, item.poor ? C.red3 : C.gold3, { shadow: 1 })
            drawText(s, fit(item.poor ? 'POOR' : item.sub, room - textWidth(price) - 4), b.x + 23 + textWidth(price), b.y + 11, C.stone3, { shadow: 1 })
            for (const { n, box } of buttons) {
                const target: ArenaTarget = `shop:${item.id}:${n}`
                plateButton(s, box, n === 1 ? 'x1' : 'x10', GREEN, enabled(target), lit(target), pressed)
            }
        })
    }

    // ── Log ──

    private drawLog(s: Surface, view: ArenaView): void {
        const x = P.x + 6
        const y0 = P.y + 15
        if (!view.log) {
            drawText(s, 'LOADING...', x, y0 + 4, C.stone3, { shadow: 1 })
            return
        }
        if (!view.log.length) {
            drawText(s, 'NO MATCHES YET. ATTACK FROM THE FIGHT TAB;', x, y0 + 4, C.stone3, { shadow: 1 })
            drawText(s, 'MATCHES AGAINST YOUR DEFENCE SHOW HERE TOO.', x, y0 + 12, C.stone3, { shadow: 1 })
            return
        }
        view.log.slice(view.page * LOG_ROWS, (view.page + 1) * LOG_ROWS).forEach((row, i) => {
            const y = y0 + i * ROW_H
            rect(s, x - 1, y, P.w - 10, ROW_H - 1, i & 1 ? C.night0 : C.night2)
            drawText(s, row.outcome, x + 2, y + 2, row.won ? C.green4 : C.red3, { shadow: 1 })
            drawText(s, fit(row.opponent.toUpperCase(), 92), x + 34, y + 2, row.attacker ? C.bone1 : C.cyan, { shadow: 1 })
            const delta = row.ratingChange > 0 ? `+${row.ratingChange}` : String(row.ratingChange)
            drawText(s, delta, x + 154, y + 2, row.ratingChange > 0 ? C.green4 : row.ratingChange < 0 ? C.red3 : C.stone3, { align: 2, shadow: 1 })
            if (row.medals > 0) drawText(s, `+${row.medals} MEDALS`, x + 214, y + 2, C.gold3, { align: 2, shadow: 1 })
            drawText(s, row.ago, P.x + P.w - 8, y + 2, C.stone3, { align: 2, shadow: 1 })
        })
    }

    // ── Ranking ──

    private drawRanking(s: Surface, view: ArenaView): void {
        const x = P.x + 6
        const y0 = P.y + 15
        if (!view.board) {
            drawText(s, 'LOADING...', x, y0 + 4, C.stone3, { shadow: 1 })
            return
        }
        if (!view.board.rows.length) {
            drawText(s, 'NOBODY HAS FOUGHT THIS SEASON YET.', x, y0 + 4, C.stone3, { shadow: 1 })
        }
        view.board.rows.slice(view.page * BOARD_ROWS, (view.page + 1) * BOARD_ROWS).forEach((row, i) => {
            const y = y0 + i * ROW_H
            if (row.gap) {
                drawText(s, '...', x + 10, y + 2, C.stone3, { shadow: 1 })
                return
            }
            rect(s, x - 1, y, P.w - 10, ROW_H - 1, row.you ? C.blue1 : i & 1 ? C.night0 : C.night2)
            const rankColor = row.rank === 1 ? C.gold3 : row.rank === 2 ? C.steel3 : row.rank === 3 ? C.orange : C.white
            drawText(s, String(row.rank), x + 14, y + 2, rankColor, { align: 2, shadow: 1 })
            drawText(s, fit((row.you ? `${row.name} (YOU)` : row.name).toUpperCase(), 150), x + 22, y + 2, row.you ? C.white : C.bone1, { shadow: 1 })
            drawText(s, String(row.rating), P.x + P.w - 8, y + 2, row.you ? C.white : C.gold3, { align: 2, shadow: 1 })
        })
        const me = view.board.me
        drawText(s, me ? `YOUR RANK ${me.rank}` : 'FIGHT A RATED MATCH TO BE RANKED', x, footerY(s.h) + 4, me ? C.gold3 : C.stone3, { shadow: 1 })
    }
}

// ── The result, after an attack's replay ───────────────────────────────────────────

export interface ArenaResultView {
    won: boolean
    dummy: boolean
    opponent: string
    ratingChange: number
    rating: number
    medals: number
}

const RESULT = { w: 128, h: 66 }
const RESULT_BTN = { w: 52, h: 13 }

function resultBox(w: number, h: number): Box {
    return { x: (w - RESULT.w) >> 1, y: (h - RESULT.h) >> 1, w: RESULT.w, h: RESULT.h }
}

function resultButtonBox(w: number, h: number): Box {
    const b = resultBox(w, h)
    return { x: b.x + ((b.w - RESULT_BTN.w) >> 1), y: b.y + b.h - RESULT_BTN.h - 5, w: RESULT_BTN.w, h: RESULT_BTN.h }
}

/** Whether a point on a view `w` × `h` is on the result popup's button. */
export function onArenaResultButton(w: number, h: number, x: number, y: number): boolean {
    return inside(resultButtonBox(w, h), x, y)
}

/** The popup over the stage once an attack's replay is done: the result, the Rating it moved and the Medals it paid. */
export function drawArenaResult(s: Surface, view: ArenaResultView, lit: boolean, pressed: boolean): void {
    dither(s, 0, 0, s.w, s.h, C.ink, 9)
    const b = resultBox(s.w, s.h)
    panel(s, b.x, b.y, b.w, b.h, view.won ? GOLD : RED)
    const cx = b.x + (b.w >> 1)
    drawText(s, `VS ${fit(view.opponent.toUpperCase(), b.w - 24)}`, cx, b.y + 5, C.bone1, { align: 1, shadow: 1 })
    drawText(s, view.won ? 'VICTORY' : 'DEFEAT', cx, b.y + 14, view.won ? C.gold2 : C.red2, { font: 'big', align: 1, shadow: 1 })
    const delta = view.dummy ? 'RATING UNCHANGED' : `RATING ${view.rating} (${view.ratingChange >= 0 ? '+' : ''}${view.ratingChange})`
    drawText(s, delta, cx, b.y + 26, view.dummy || view.ratingChange === 0 ? C.stone3 : view.ratingChange > 0 ? C.green4 : C.red3, { align: 1, shadow: 1 })
    drawText(s, `+${view.medals} MEDALS`, cx, b.y + 35, C.gold3, { align: 1, shadow: 1 })
    plateButton(s, resultButtonBox(s.w, s.h), 'CONTINUE', GREEN, true, lit, pressed)
}
