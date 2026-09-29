// Ability and skill icons (asset-list §3.1): 16 class-tree skills (square), 36 Training
// Grounds skills (circular), 28 Champion abilities (diamond crest). 80 glyphs, one each.

import { C } from './palette'
import type { Surface } from './surface'
import { M, sword, axe, hammer, shield, arrow, antlers, ShieldStyle, type Mat } from './weapons'
import { type Glyph, CLEAR, rect, px, line, disc, ring, tri, ellipse, poly, arc } from './icon-kit'

const R = Math.round

// ── Shared glyph parts ─────────────────────────────────────────────────────────────

function bolt(g: Surface, x: number, y: number, c: number, hi: number): void {
    poly(g, [2, -8, -3, 0, 0, 0, -2, 8, 4, -2, 1, -2, 3, -8], x, y, c)
    line(g, x + 2, y - 7, x - 2, y, hi)
}
function heart(g: Surface, x: number, y: number, r: number, c: number, hi: number): void {
    disc(g, x - r + 1, y - 1, r, c); disc(g, x + r - 1, y - 1, r, c)
    tri(g, x - r * 2 + 1, y, x + r * 2 - 1, y, x, y + r * 2, c)
    px(g, x - r, y - r, hi)
}
function coin(g: Surface, x: number, y: number, r: number): void {
    disc(g, x, y, r, C.gold1); disc(g, x - 0.5, y - 0.5, r - 1, C.gold2); px(g, x - 1, y - 1, C.gold3)
    rect(g, x, y - r + 2, 1, r * 2 - 3, C.gold1)
}
function upArrow(g: Surface, x: number, y: number, c: number, h = 8): void {
    tri(g, x - 4, y - h / 2 + 4, x + 4, y - h / 2 + 4, x, y - h / 2, c)
    rect(g, x - 1, y - h / 2 + 4, 3, h - 4, c)
}
function downArrow(g: Surface, x: number, y: number, c: number, h = 8): void {
    tri(g, x - 4, y + h / 2 - 4, x + 4, y + h / 2 - 4, x, y + h / 2, c)
    rect(g, x - 1, y - h / 2, 3, h - 4, c)
}
function skull(g: Surface, x: number, y: number, c: number = C.bone1): void {
    ellipse(g, x, y - 1, 4, 4, c)
    rect(g, x - 2, y + 2, 5, 2, c)
    rect(g, x - 2, y - 1, 2, 2, C.ink); rect(g, x + 1, y - 1, 2, 2, C.ink)
    px(g, x, y + 2, C.ink); px(g, x - 2, y + 3, C.ink); px(g, x + 2, y + 3, C.ink)
    px(g, x - 2, y - 3, C.white)
}
function flame(g: Surface, x: number, y: number, h: number, outer: number, mid: number, core: number): void {
    tri(g, x - 4, y + 3, x + 4, y + 3, x + 1, y - h, outer)
    disc(g, x, y + 2, 4, outer)
    tri(g, x - 2, y + 3, x + 3, y + 3, x, y - h + 4, mid)
    disc(g, x, y + 3, 2, core)
}
function swirl(g: Surface, x: number, y: number, r: number, c: number, c2: number): void {
    for (let i = 0; i < 26; i++) {
        const a = i * 0.45
        const rr = r * (i / 26)
        px(g, R(x + Math.cos(a) * rr), R(y + Math.sin(a) * rr), i & 1 ? c : c2)
    }
}
function sparkle(g: Surface, x: number, y: number, r: number, c: number): void {
    line(g, x - r, y, x + r, y, c); line(g, x, y - r, x, y + r, c); px(g, x, y, C.white)
}
function crown(g: Surface, x: number, y: number): void {
    rect(g, x - 6, y, 13, 4, C.gold1)
    for (let i = 0; i < 4; i++) tri(g, x - 6 + i * 4, y, x - 4 + i * 4, y, x - 5 + i * 4, y - 5, C.gold2)
    tri(g, x + 5, y, x + 7, y, x + 6, y - 5, C.gold2)
    px(g, x, y + 1, C.red2); px(g, x - 4, y + 1, C.cyan); px(g, x + 4, y + 1, C.cyan)
    rect(g, x - 6, y, 13, 1, C.gold3)
}
function waves(g: Surface, x: number, y: number, n: number, c: number): void {
    for (let i = 0; i < n; i++) arc(g, x, y, 3 + i * 3, -0.8, 0.8, i === 0 ? C.white : c)
}
function chains(g: Surface, x0: number, y0: number, x1: number, y1: number, c: number, hi: number): void {
    const n = R(Math.hypot(x1 - x0, y1 - y0) / 3)
    for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n
        const y = y0 + (y1 - y0) * i / n
        if (i & 1) ring(g, x, y, 1, c); else { px(g, x, y, hi); px(g, x + 1, y, c) }
    }
}
function potion(g: Surface, x: number, y: number, liquid: Mat): void {
    disc(g, x, y + 2, 5, C.steel3)
    disc(g, x, y + 2, 4, liquid[1])
    rect(g, x - 4, y + 1, 9, 1, liquid[2])
    rect(g, x - 1, y - 6, 3, 5, C.steel3)
    rect(g, x - 2, y - 7, 5, 2, C.brown2)
    px(g, x - 2, y, C.white)
}
function book(g: Surface, x: number, y: number, cover: number, page: number): void {
    rect(g, x - 7, y - 4, 7, 10, cover); rect(g, x + 1, y - 4, 7, 10, cover)
    rect(g, x - 6, y - 3, 6, 8, page); rect(g, x + 1, y - 3, 6, 8, page)
    rect(g, x, y - 4, 1, 10, C.brown0)
    for (let i = 0; i < 3; i++) { line(g, x - 5, y - 1 + i * 2, x - 2, y - 1 + i * 2, C.stone2); line(g, x + 2, y - 1 + i * 2, x + 5, y - 1 + i * 2, C.stone2) }
}
function eye(g: Surface, x: number, y: number, iris: number): void {
    ellipse(g, x, y, 7, 3, C.white)
    disc(g, x, y, 2.5, iris); disc(g, x, y, 1, C.ink); px(g, x - 1, y - 1, C.white)
}
function hourglass(g: Surface, x: number, y: number, sand: number): void {
    rect(g, x - 5, y - 8, 11, 2, C.brown2); rect(g, x - 5, y + 7, 11, 2, C.brown2)
    tri(g, x - 4, y - 6, x + 4, y - 6, x, y, C.frost); tri(g, x - 4, y + 7, x + 4, y + 7, x, y, C.frost)
    tri(g, x - 2, y - 3, x + 2, y - 3, x, y, sand); tri(g, x - 3, y + 7, x + 3, y + 7, x, y + 3, sand)
}

// ── Class-tree skills (square) ─────────────────────────────────────────────────────

export const CLASS_SKILL_ICONS: Readonly<Record<string, Glyph>> = {
    skill_haste: (g, x, y) => {
        // a winged boot
        rect(g, x - 3, y - 6, 5, 9, C.brown2); rect(g, x - 3, y + 2, 9, 3, C.brown2); rect(g, x - 3, y + 5, 10, 1, C.brown0)
        rect(g, x - 2, y - 6, 1, 8, C.brown3)
        for (let i = 0; i < 3; i++) line(g, x - 4, y - 4 + i * 2, x - 9, y - 7 + i * 3, i === 0 ? C.white : C.gold3)
        for (let i = 0; i < 3; i++) line(g, x + 4 + i, y - 6 + i * 3, x + 8 + i, y - 6 + i * 3, C.gold2)
    },
    skill_whirlwind: (g, x, y) => {
        arc(g, x, y, 8, 0, Math.PI * 1.6, C.steel3); arc(g, x, y, 7, 0.3, Math.PI * 1.6, C.gold2); arc(g, x, y, 5, Math.PI, Math.PI * 2.4, C.steel2)
        sword(g, x - 1, y + 1, -0.8, 10, M.steel, M.bronze, C.brown1)
    },
    skill_threatening_roar: (g, x, y) => {
        // a barbarian in profile, facing right: horned helm, jaw dropped wide, the roar rolling out ahead of him
        const hx = x - 3
        const hy = y + 1
        poly(g, [-3, -5, -6, -6, -8, -9, -7, -10, -5, -8, -2, -6], hx, hy, C.bone1)
        poly(g, [1, -6, 2, -9, 4, -9, 4, -7, 3, -5], hx, hy, C.bone1)
        ellipse(g, hx + 1, hy, 4, 4, C.skin1)
        tri(g, hx + 4, hy - 2, hx + 7, hy + 1, hx + 4, hy + 1, C.skin1)
        ellipse(g, hx, hy - 4, 5, 3, C.steel2)
        rect(g, hx - 5, hy - 3, 10, 1, C.steel1)
        line(g, hx + 1, hy - 2, hx + 3, hy - 1, C.ink)
        px(g, hx + 2, hy, C.white)
        poly(g, [-3, 1, -3, 6, 0, 9, 3, 8, 1, 5, 0, 2], hx, hy, C.brown2)
        tri(g, hx + 2, hy + 3, hx + 7, hy + 2, hx + 7, hy + 7, C.red0)
        line(g, hx + 4, hy + 3, hx + 6, hy + 2, C.white)
        for (const [r, c] of [[6, C.white], [8, C.red3]] as const) arc(g, hx + 5, hy + 4, r, -0.55, 0.55, c)
    },
    skill_enrage: (g, x, y) => {
        // powering up: a spiked aura bursting upward round a dark figure, red outside, gold where it hugs the body
        const spikes = [[-8, -3], [-5, -8], [-2, -10], [2, -10], [5, -8], [8, -3]] as const
        for (const [tx, ty] of spikes) tri(g, x + tx * 0.6 - 3, y + 6, x + tx * 0.6 + 3, y + 6, x + tx, y + ty, C.red1)
        ellipse(g, x, y + 4, 8, 6, C.red1)
        for (const [tx, ty] of spikes) tri(g, x + tx * 0.5 - 2, y + 6, x + tx * 0.5 + 2, y + 6, x + tx * 0.75, y + ty * 0.75, C.orange)
        ellipse(g, x, y + 4, 6, 5, C.orange)
        ellipse(g, x, y + 2, 5, 7, C.gold3)
        ellipse(g, x, y + 3, 3, 5, C.white)
        // the figure: head, shoulders, fists thrown up
        disc(g, x, y - 2, 1.5, C.ink)
        poly(g, [-2, 1, 2, 1, 1, 9, -1, 9], x, y, C.ink)
        line(g, x - 2, y + 1, x - 4, y - 3, C.ink); line(g, x + 2, y + 1, x + 4, y - 3, C.ink)
        // the charge streaking up off it
        for (const [sx, top] of [[-7, -5], [-3, -9], [3, -9], [7, -5]] as const) line(g, x + sx, y + top + 3, x + sx, y + top, C.white)
    },
    skill_shockwave: (g, x, y) => {
        // a blade-wave: a blue crescent flung off the sword, flying right
        disc(g, x + 2, y, 8, C.blue1)
        disc(g, x + 1, y, 7, C.cyan)
        disc(g, x - 3, y, 8, CLEAR)
        arc(g, x + 2, y, 8, -0.95, 0.95, C.white)
        for (const dy of [-5, 0, 5]) line(g, x - 3, y + dy, x - 1 + (dy ? 0 : 1), y + dy, C.frost)
        sword(g, x - 7, y + 8, -Math.PI / 2, 16, M.steel, M.gold, C.brown0)
    },
    skill_disciple: (g, x, y) => {
        // a hooded acolyte in a pale robe under a halo, hands clasped, tending the party
        poly(g, [-8, 10, -6, 3, -3, 1, 3, 1, 6, 3, 8, 10], x, y, C.bone1)
        poly(g, [2, 1, 6, 3, 8, 10, 3, 10], x, y, C.bone0)
        ellipse(g, x, y - 3, 5, 5, C.bone1)
        tri(g, x - 2, y - 7, x + 2, y - 7, x, y - 10, C.bone1)
        ellipse(g, x + 2, y - 3, 3, 5, C.bone0)
        ellipse(g, x, y - 2, 3, 3, C.brown1)
        rect(g, x - 2, y - 1, 4, 3, C.skin1)
        px(g, x - 1, y - 1, C.ink); px(g, x + 1, y - 1, C.ink)
        rect(g, x - 1, y + 3, 3, 4, C.skin1); rect(g, x, y + 3, 1, 4, C.skin0); px(g, x - 1, y + 3, C.skin2)
        ellipse(g, x, y - 11, 5, 1.5, C.gold3); ellipse(g, x, y - 11, 3, 0.5, CLEAR)
        rect(g, x + 7, y - 7, 1, 5, C.green4); rect(g, x + 5, y - 5, 5, 1, C.green4); px(g, x + 7, y - 5, C.white)
    },
    skill_ethereal_bouncebolt: (g, x, y) => {
        line(g, x - 8, y + 6, x - 3, y - 4, C.purple2); line(g, x - 3, y - 4, x + 2, y + 4, C.purple2); line(g, x + 2, y + 4, x + 7, y - 6, C.pink)
        disc(g, x + 7, y - 6, 2, C.pink); px(g, x + 7, y - 6, C.white)
        px(g, x - 3, y - 4, C.white); px(g, x + 2, y + 4, C.white)
    },
    skill_lightning_storm: (g, x, y) => {
        ellipse(g, x, y - 5, 8, 3, C.night2); ellipse(g, x - 3, y - 6, 4, 3, C.night3); ellipse(g, x + 3, y - 6, 4, 2, C.stone2)
        bolt(g, x, y + 3, C.gold3, C.white)
    },
    skill_meteor_shower: (g, x, y) => {
        for (const [ox, oy, r] of [[3, 3, 3], [-5, -2, 2], [5, -6, 1.5]] as const) {
            line(g, x + ox - 5, y + oy - 5, x + ox, y + oy, C.orange, 2)
            disc(g, x + ox, y + oy, r, C.lava1); px(g, x + ox, y + oy, C.gold3)
        }
    },
    skill_totem_storm: (g, x, y) => {
        // a wooden post crowned with antlers
        rect(g, x - 2, y - 3, 4, 10, C.brown2); rect(g, x - 2, y - 3, 1, 10, C.brown1)
        rect(g, x - 2, y - 1, 4, 1, C.brown0); px(g, x - 1, y, C.teal3)
        antlers(g, x, y - 3, -Math.PI / 2)
        swirl(g, x, y + 2, 10, C.teal3, C.white)
    },
    skill_raise_dead: (g, x, y) => {
        rect(g, x - 9, y + 6, 19, 3, C.green1)
        // a skeletal hand clawing out of the grave-dirt
        rect(g, x - 1, y - 1, 3, 8, C.bone1)
        for (let i = 0; i < 4; i++) line(g, x - 3 + i * 2, y - 1, x - 4 + i * 3, y - 7 + (i === 0 || i === 3 ? 2 : 0), C.bone1)
        px(g, x - 7, y + 5, C.green4); px(g, x + 6, y + 4, C.green4)
    },
    skill_piercing_arrow: (g, x, y) => {
        // through two targets and out, on a long needle of a head
        ring(g, x - 4, y, 4, C.green3); ring(g, x + 2, y, 3, C.green2)
        line(g, x - 11, y, x + 4, y, C.brown3)
        line(g, x - 11, y - 2, x - 9, y, C.green4); line(g, x - 11, y + 2, x - 9, y, C.green4)
        tri(g, x + 3, y - 2, x + 3, y + 2, x + 11, y, C.steel2)
        line(g, x + 3, y - 2, x + 11, y, C.white)
        px(g, x + 11, y, C.white)
    },
    skill_fan_of_arrows: (g, x, y) => {
        // three arrows loosed at once, spreading from the bow
        const ox = x - 8
        const oy = y
        for (const a of [-0.72, 0, 0.72]) {
            const tx = ox + Math.cos(a) * 15
            const ty = oy + Math.sin(a) * 15
            line(g, ox + Math.cos(a) * 4, oy + Math.sin(a) * 4, tx, ty, C.brown3)
            tri(g, tx - Math.cos(a) * 3 - Math.sin(a) * 2, ty - Math.sin(a) * 3 + Math.cos(a) * 2, tx - Math.cos(a) * 3 + Math.sin(a) * 2, ty - Math.sin(a) * 3 - Math.cos(a) * 2, tx + Math.cos(a), ty + Math.sin(a), C.steel3)
            px(g, R(tx + Math.cos(a)), R(ty + Math.sin(a)), C.white)
            px(g, R(ox + Math.cos(a) * 4 - Math.sin(a)), R(oy + Math.sin(a) * 4 + Math.cos(a)), C.green4)
        }
    },
    skill_arrow_rain: (g, x, y) => {
        for (let i = 0; i < 4; i++) arrow(g, x - 6 + i * 4, y + 2 + (i & 1) * 5, Math.PI / 2 - 0.2, C.brown3, C.gold3, C.white)
        ellipse(g, x, y - 7, 7, 2, C.stone2)
    },
    skill_kill_shot: (g, x, y) => {
        ring(g, x, y, 7, C.red2); ring(g, x, y, 3, C.red2)
        for (let i = 0; i < 3; i++) { px(g, x - 9 + i, y, C.red3); px(g, x + 7 + i, y, C.red3); px(g, x, y - 9 + i, C.red3); px(g, x, y + 7 + i, C.red3) }
        disc(g, x, y, 1, C.white)
    },
    skill_mans_best_friend: (g, x, y) => {
        // a wolf's head in profile
        ellipse(g, x - 1, y, 6, 5, C.stone2)
        rect(g, x + 3, y - 1, 6, 4, C.stone3); px(g, x + 8, y - 1, C.ink)
        tri(g, x - 6, y - 3, x - 3, y - 3, x - 6, y - 10, C.stone2); tri(g, x - 2, y - 4, x + 1, y - 4, x - 1, y - 10, C.stone3)
        px(g, x + 2, y - 2, C.gold2); rect(g, x + 3, y + 3, 5, 1, C.stone1); px(g, x + 4, y + 3, C.white)
    }
}

// ── Champion abilities (crest) ─────────────────────────────────────────────────────

export const CHAMPION_ABILITY_ICONS: Readonly<Record<string, Glyph>> = {
    Cleave: (g, x, y) => { axe(g, x - 5, y + 6, -0.9, 12, M.steel, M.wood); arc(g, x, y, 8, -1.8, 0.6, C.white) },
    'Piercing Bolt': (g, x, y) => { line(g, x - 9, y, x + 6, y, C.blue2, 2); tri(g, x + 5, y - 3, x + 5, y + 3, x + 10, y, C.cyan); ring(g, x - 2, y, 4, C.frost); px(g, x + 8, y, C.white) },
    'Rising Flame': (g, x, y) => { flame(g, x, y + 2, 11, C.lava1, C.orange, C.gold3); rect(g, x - 8, y + 7, 17, 1, C.lava0) },
    'Execute Strike': (g, x, y) => { skull(g, x, y + 2); sword(g, x, y - 9, Math.PI / 2 - 0.3, 12, M.steel, M.gold, C.brown0) },
    Volley: (g, x, y) => { for (let i = 0; i < 3; i++) arrow(g, x + 4 + i * 2, y - 4 + i * 4, 0.5, C.brown3, C.steel3, C.bone1) },
    'Focused Barrage': (g, x, y) => { ring(g, x, y, 3, C.orange); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; line(g, x + Math.cos(a) * 9, y + Math.sin(a) * 9, x + Math.cos(a) * 4, y + Math.sin(a) * 4, i & 1 ? C.white : C.orange) } },
    Rupture: (g, x, y) => { disc(g, x, y + 3, 3, C.red1); tri(g, x - 3, y + 2, x + 3, y + 2, x, y - 6, C.red1); px(g, x - 1, y + 1, C.red3); for (const a of [-2.2, -0.9, 0.2]) line(g, x, y, x + Math.cos(a) * 9, y + Math.sin(a) * 9, C.red2) },
    Provoke: (g, x, y) => { rect(g, x - 1, y - 8, 3, 11, C.red2); rect(g, x - 1, y + 5, 3, 3, C.red2); px(g, x, y - 7, C.red3); waves(g, x + 3, y, 2, C.red3) },
    'Bulwark Stance': (g, x, y) => { shield(g, x, y, ShieldStyle.Tower, M.gold, M.steel, C.gold2); arc(g, x, y, 10, Math.PI * 1.1, Math.PI * 1.9, C.gold3) },
    "Guardian's Reflect": (g, x, y) => { shield(g, x - 2, y, ShieldStyle.Kite, M.steel, [C.frost, C.cyan, C.white], C.white); line(g, x + 3, y - 2, x + 9, y - 7, C.pink); line(g, x + 3, y + 1, x + 9, y + 6, C.cyan) },
    'Rallying Shout': (g, x, y) => { line(g, x - 5, y - 8, x - 5, y + 8, C.brown2); poly(g, [0, 0, 10, 1, 7, 4, 10, 7, 0, 7], x - 5, y - 8, C.red1); upArrow(g, x + 5, y + 4, C.gold3, 7) },
    'Iron Skin': (g, x, y) => { rect(g, x - 5, y - 7, 10, 14, C.steel2); rect(g, x - 5, y - 7, 10, 2, C.steel3); for (let i = 0; i < 3; i++) rect(g, x - 5, y - 3 + i * 4, 10, 1, C.steel1); px(g, x - 3, y - 5, C.white); rect(g, x - 7, y - 8, 3, 4, C.steel1); rect(g, x + 4, y - 8, 3, 4, C.steel1) },
    'Ground Slam': (g, x, y) => { hammer(g, x - 2, y - 3, Math.PI / 2 + 0.2, 7, M.iron, M.wood); rect(g, x - 9, y + 7, 19, 1, C.stone3); for (let i = 0; i < 4; i++) px(g, x - 7 + i * 5, y + 5 - (i & 1), C.stone3) },
    "Guardian's Vow": (g, x, y) => { heart(g, x, y - 2, 3, C.gold2, C.gold3); for (const d of [-1, 1]) line(g, x + d * 4, y + 3, x + d * 9, y + 8, C.gold3); ring(g, x, y, 10, C.gold1) },
    'Mending Light': (g, x, y) => { rect(g, x - 1, y - 7, 3, 15, C.green4); rect(g, x - 7, y - 1, 15, 3, C.green4); rect(g, x, y - 6, 1, 13, C.white); rect(g, x - 6, y, 13, 1, C.white) },
    Sanctuary: (g, x, y) => { ellipse(g, x, y + 5, 9, 3, C.gold1); ellipse(g, x, y + 5, 6, 1, C.gold3); for (let i = -2; i <= 2; i++) line(g, x + i * 3, y + 4, x + i * 3, y - 6 + Math.abs(i) * 2, C.gold2) },
    'Tide of Renewal': (g, x, y) => { for (let i = 0; i < 3; i++) arc(g, x - 2 + i * 2, y + 2 + i * 3, 6, Math.PI, Math.PI * 1.9, i === 0 ? C.white : C.teal3); rect(g, x + 4, y - 7, 2, 6, C.green4); rect(g, x + 2, y - 5, 6, 2, C.green4) },
    Empower: (g, x, y) => { disc(g, x, y + 2, 5, C.orange); upArrow(g, x, y - 1, C.gold3, 12); px(g, x, y - 6, C.white) },
    'Haste Blessing': (g, x, y) => { for (let i = 0; i < 3; i++) line(g, x - 9, y - 4 + i * 4, x + 1, y - 4 + i * 4, i === 1 ? C.white : C.cyan); tri(g, x + 1, y - 7, x + 1, y + 7, x + 9, y, C.frost) },
    'Second Wind': (g, x, y) => { line(g, x, y + 8, x, y - 8, C.gold3); for (let i = 0; i < 6; i++) { line(g, x, y - 6 + i * 2, x - 6 + i, y - 8 + i * 3, C.gold2); line(g, x, y - 6 + i * 2, x + 6 - i, y - 8 + i * 3, C.gold2) } },
    Purify: (g, x, y) => { sparkle(g, x, y, 8, C.frost); sparkle(g, x - 5, y + 5, 3, C.white); sparkle(g, x + 6, y - 5, 2, C.white); for (const [a, b] of [[-7, -6], [7, 6]]) px(g, x + a!, y + b!, C.purple1) },
    Weaken: (g, x, y) => { downArrow(g, x - 3, y, C.purple2, 14); downArrow(g, x + 5, y + 3, C.pink, 8) },
    Slow: (g, x, y) => { ring(g, x, y, 8, C.cyan); ring(g, x, y, 7, C.blue1); line(g, x, y, x, y - 5, C.white); line(g, x, y, x - 4, y + 2, C.frost); px(g, x, y, C.white) },
    Silence: (g, x, y) => { ellipse(g, x, y, 6, 4, C.bone1); line(g, x - 4, y, x + 4, y, C.ink); ring(g, x, y, 9, C.purple2); line(g, x - 6, y - 6, x + 6, y + 6, C.pink, 2) },
    'Shatter Armor': (g, x, y) => { poly(g, [-6, -7, 6, -7, 6, 2, 0, 8, -6, 2], x, y, C.steel2); line(g, x - 1, y - 7, x + 1, y, C.ink); line(g, x + 1, y, x - 2, y + 7, C.ink); line(g, x + 1, y, x + 6, y - 2, C.ink); tri(g, x + 7, y + 3, x + 10, y + 5, x + 8, y + 8, C.steel3) },
    'Chain Bind': (g, x, y) => { chains(g, x - 9, y - 6, x + 9, y + 6, C.steel2, C.steel3); chains(g, x - 9, y + 6, x + 9, y - 6, C.steel2, C.steel3) },
    'Unraveling Curse': (g, x, y) => { ring(g, x, y, 6, C.purple1); for (let i = 0; i < 4; i++) { const a = -Math.PI / 2 + (i - 1.5) * 0.6; for (let k = 6; k < 11; k++) px(g, R(x + Math.cos(a) * k + Math.sin(k) * 1), R(y + Math.sin(a) * k), i & 1 ? C.pink : C.haze) } px(g, x, y, C.pink) },
    Frostbind: (g, x, y) => { for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; line(g, x, y, x + Math.cos(a) * 9, y + Math.sin(a) * 9, i & 1 ? C.frost : C.cyan) } disc(g, x, y, 2, C.white) }
}

// ── Training Grounds skills (circular) ─────────────────────────────────────────────

/** A pixel map at (x, y), its top-left `ox`, `oy` from there: one character per pixel, '.' clear. */
function pix(g: Surface, x: number, y: number, ox: number, oy: number, rows: readonly string[], key: Readonly<Record<string, number>>): void {
    for (let r = 0; r < rows.length; r++) {
        for (let k = 0; k < rows[r]!.length; k++) {
            const c = key[rows[r]![k]!]
            if (c !== undefined) px(g, x + ox + k, y + oy + r, c)
        }
    }
}

/** A clenched fist seen from the side, knuckles to the right, thumb across the front, a leather wrap at the wrist. */
const FIST = [
    '.mmmmmm..',
    'mhhhhhhm.',
    'mmmmmmhhm',
    'mmmmmmddd',
    'mmmmmmhhm',
    'mmmmmmddd',
    'mmmmmmhhm',
    'mtttttddm',
    '.mttttmm.',
    '..ccccc..'
] as const

/** A pickaxe along angle `a` from its butt at (x, y): a haft, and a head curving back to two points. */
function pickaxe(g: Surface, x: number, y: number, a: number, len: number): void {
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const hx = x + ux * len
    const hy = y + uy * len
    line(g, x, y, hx, hy, C.brown2, 2)
    const at = (u: number, v: number): [number, number] => [hx + ux * u - uy * v, hy + uy * u + ux * v]
    const pts = [at(2, 0), at(1, 7), at(-2, 9), at(-1, 6), at(-1, 0), at(-1, -6), at(-2, -9), at(1, -7)].flat()
    poly(g, pts, 0, 0, C.steel2)
    const [ax, ay] = at(2, 0)
    const [bx, by] = at(1, -7)
    const [cx, cy] = at(1, 7)
    line(g, bx, by, ax, ay, C.steel3); line(g, ax, ay, cx, cy, C.steel3)
}

/** A crown set with gems: five points tipped with pearls, a band of ruby, sapphire and emerald. */
function jeweledCrown(g: Surface, x: number, y: number): void {
    rect(g, x - 8, y, 17, 5, C.gold1)
    for (let i = 0; i < 5; i++) {
        const px_ = x - 8 + i * 4
        tri(g, px_, y, px_ + 1 + (i === 4 ? 0 : 0), y, px_ + (i === 4 ? 0 : 0), y - 5 - (i === 2 ? 2 : i & 1 ? 0 : 1), C.gold2)
        tri(g, px_ - 1, y + 1, px_ + 2, y + 1, px_, y - 5 - (i === 2 ? 2 : i & 1 ? 0 : 1), C.gold2)
        const top = y - 7 - (i === 2 ? 2 : i & 1 ? 0 : 1)
        rect(g, px_ - 1, top, 2, 2, C.white); px(g, px_, top + 1, C.bone0)
    }
    rect(g, x - 8, y, 17, 1, C.gold3)
    rect(g, x - 8, y + 4, 17, 1, C.gold0)
    disc(g, x, y + 2, 1.5, C.red2); px(g, x, y + 1, C.red3)
    for (const [dx, c, hi] of [[-5, C.blue2, C.cyan], [5, C.green3, C.green4]] as const) { rect(g, x + dx - 1, y + 1, 3, 3, c); px(g, x + dx - 1, y + 1, hi) }
}

export const TRAINING_SKILL_ICONS: Readonly<Record<string, Glyph>> = {
    skill_quick_strike: (g, x, y) => { for (let i = 0; i < 3; i++) line(g, x - 10 + i * 2, y + 3 - i * 4, x - 5 + i * 2, y + 3 - i * 4, C.white); sword(g, x - 5, y + 7, -0.8, 17, M.steel, M.gold, C.brown1) },
    skill_steadying_breath: (g, x, y) => {
        // the cartoon sigh of relief: a puff of breath, and the lines it was blown out along
        for (const [dx, dy, r] of [[-1, 1, 3], [2, -1, 4], [6, -2, 3], [6, 2, 3], [2, 3, 3]] as const) disc(g, x + dx, y + dy, r, C.frost)
        for (const [dx, dy, r] of [[-1, 0, 2], [2, -2, 3], [6, -3, 2], [5, 1, 2]] as const) disc(g, x + dx, y + dy, r, C.white)
        for (const dy of [-3, 0, 3]) line(g, x - 10, y + dy + 1, x - 6 + (dy ? 0 : 1), y + dy + 1, C.frost)
    },
    skill_coin_toss: (g, x, y) => {
        // a coin flipped high, three arcs shrinking away behind it down to the left
        coin(g, x + 3, y - 3, 5)
        for (const [dx, dy, r, c] of [[-1, 2, 4, C.gold3], [-5, 5, 3, C.gold2], [-8, 8, 2, C.gold1]] as const) arc(g, x + dx, y + dy, r, Math.PI * 0.55, Math.PI * 1.2, c)
    },
    skill_marching_drill: (g, x, y) => { for (let i = 0; i < 3; i++) { rect(g, x - 7 + i * 5, y - 5 + (i & 1), 3, 10, C.brown2); px(g, x - 6 + i * 5, y - 6 + (i & 1), C.steel3) } rect(g, x - 9, y + 6, 18, 1, C.stone3) },
    skill_iron_discipline: (g, x, y) => { rect(g, x - 5, y - 5, 11, 11, C.steel2); rect(g, x - 5, y - 5, 11, 2, C.steel3); rect(g, x - 1, y - 3, 3, 7, C.steel1); px(g, x - 4, y - 4, C.white) },
    skill_apprentices_ledger: (g, x, y) => book(g, x, y, C.brown2, C.bone1),
    skill_focused_blow: (g, x, y) => {
        // one heavy punch: a fist landing, the impact bursting off its knuckles
        pix(g, x, y, -7, -5, FIST, { m: C.skin1, h: C.skin2, d: C.skin0, t: C.skin2, c: C.brown2 })
        for (const a of [-1.1, -0.45, 0.2, 0.85]) line(g, x + 4 + Math.cos(a) * 3, y + Math.sin(a) * 3, x + 4 + Math.cos(a) * 7, y + Math.sin(a) * 7, a === -0.45 || a === 0.2 ? C.white : C.gold3)
        for (const dy of [-4, 0, 4]) line(g, x - 11, y + dy, x - 9, y + dy, C.frost)
    },
    skill_adrenaline_surge: (g, x, y) => {
        // the heart pounding: a trace that spikes clean off the top and bottom
        heart(g, x, y - 1, 4, C.red1, C.red2)
        const pts = [[-11, 2], [-6, 2], [-4, 5], [-1, -10], [2, 9], [4, 2], [11, 2]] as const
        for (let i = 0; i < pts.length - 1; i++) line(g, x + pts[i]![0], y + pts[i]![1], x + pts[i + 1]![0], y + pts[i + 1]![1], C.white)
        px(g, x - 1, y - 10, C.red3)
    },
    skill_prospectors_instinct: (g, x, y) => { pickaxe(g, x - 7, y + 8, -0.8, 11); disc(g, x + 6, y + 6, 2, C.gold2); px(g, x + 5, y + 5, C.gold3); sparkle(g, x + 8, y + 1, 2, C.gold3) },
    skill_sharpened_reflexes: (g, x, y) => { eye(g, x, y, C.cyan); line(g, x - 8, y - 5, x - 4, y - 3, C.white); line(g, x + 8, y - 5, x + 4, y - 3, C.white) },
    skill_endurance_training: (g, x, y) => { rect(g, x - 8, y - 1, 17, 3, C.steel2); rect(g, x - 8, y - 4, 3, 9, C.stone1); rect(g, x + 6, y - 4, 3, 9, C.stone1); rect(g, x - 10, y - 3, 2, 7, C.stone2); rect(g, x + 9, y - 3, 2, 7, C.stone2) },
    skill_scholars_notes: (g, x, y) => { rect(g, x - 5, y - 7, 11, 14, C.bone1); for (let i = 0; i < 4; i++) line(g, x - 3, y - 4 + i * 3, x + 3, y - 4 + i * 3, C.stone2); line(g, x + 3, y + 7, x + 8, y - 3, C.brown2); px(g, x + 8, y - 4, C.ink) },
    skill_piercing_focus: (g, x, y) => { ring(g, x, y, 6, C.cyan); line(g, x - 9, y, x + 9, y, C.white); line(g, x, y - 9, x, y + 9, C.frost); px(g, x, y, C.red2) },
    skill_vigor_renewal: (g, x, y) => { swirl(g, x, y, 10, C.green4, C.green2); rect(g, x - 2, y - 6, 5, 13, C.ink); rect(g, x - 6, y - 2, 13, 5, C.ink); rect(g, x - 1, y - 5, 3, 11, C.white); rect(g, x - 5, y - 1, 11, 3, C.white) },
    skill_gamblers_strike: (g, x, y) => {
        rect(g, x - 8, y - 2, 9, 9, C.white); rect(g, x - 8, y + 6, 9, 1, C.bone0); px(g, x - 6, y, C.red1); px(g, x - 4, y + 2, C.red1); px(g, x - 2, y + 4, C.red1)
        // a stiletto: a narrow blade tapering to a needle point
        const a = -0.85
        const ux = Math.cos(a)
        const uy = Math.sin(a)
        const gx = x + 1
        const gy = y + 4
        poly(g, [gx - uy * 1.5, gy + ux * 1.5, gx + uy * 1.5, gy - ux * 1.5, gx + ux * 12, gy + uy * 12], 0, 0, C.steel2)
        line(g, gx, gy, gx + ux * 12, gy + uy * 12, C.steel3)
        line(g, gx - uy * 3, gy + ux * 3, gx + uy * 3, gy - ux * 3, C.gold2)
        line(g, gx, gy, gx - ux * 4, gy - uy * 4, C.brown1)
    },
    skill_battle_focus: (g, x, y) => { ring(g, x, y, 8, C.red2); ring(g, x, y, 5, C.red1); disc(g, x, y, 2, C.white); line(g, x + 3, y - 3, x + 9, y - 9, C.brown2); tri(g, x + 1, y - 1, x + 4, y - 1, x + 1, y - 4, C.steel3) },
    skill_fortified_resolve: (g, x, y) => { shield(g, x, y, ShieldStyle.Kite, M.steel, [C.blue0, C.blue1, C.blue2], C.gold2); upArrow(g, x + 6, y + 3, C.gold3, 7) },
    skill_merchants_eye: (g, x, y) => { eye(g, x, y - 1, C.gold2); coin(g, x + 5, y + 5, 3) },
    skill_twin_strike: (g, x, y) => { sword(g, x - 8, y + 8, -0.8, 18, M.steel, M.gold, C.brown1); sword(g, x + 8, y + 8, -2.35, 18, M.steel, M.gold, C.brown1) },
    skill_battlefield_surge: (g, x, y) => {
        // healing on the charge: a green cross dashing forward, speed streaming off it
        for (const [dy, c] of [[-4, C.gold3], [0, C.white], [4, C.gold3]] as const) line(g, x - 11, y + dy, x - 5 + (dy ? 0 : 2), y + dy, c)
        rect(g, x - 1, y - 7, 5, 15, C.green2); rect(g, x - 5, y - 3, 13, 5, C.green2)
        rect(g, x, y - 6, 3, 13, C.green4); rect(g, x - 4, y - 2, 11, 3, C.green4)
        rect(g, x + 1, y - 5, 1, 11, C.white)
    },
    skill_treasure_hunters_gambit: (g, x, y) => { rect(g, x - 5, y + 1, 11, 6, C.brown2); rect(g, x - 5, y - 2, 11, 3, C.brown1); rect(g, x - 5, y + 1, 11, 1, C.gold1); rect(g, x, y + 1, 2, 2, C.gold2); coin(g, x - 5, y - 6, 2); coin(g, x, y - 8, 2); coin(g, x + 5, y - 6, 2) },
    skill_veterans_instincts: (g, x, y) => { rect(g, x - 5, y - 5, 11, 4, C.gold1); for (let i = 0; i < 3; i++) tri(g, x - 5 + i * 5, y + 1 + i, x + 1 + i * 5 - 5, y + 1 + i, x - 2 + i * 5 - 1, y + 6 + i, C.red1); line(g, x - 5, y - 2, x + 5, y - 2, C.gold3) },
    skill_warlords_ledger: (g, x, y) => { book(g, x, y, C.red1, C.bone1); px(g, x - 3, y - 6, C.gold2); px(g, x + 3, y - 6, C.gold2) },
    skill_adaptive_plating: (g, x, y) => { for (let i = 0; i < 3; i++) { rect(g, x - 7 + i * 2, y - 6 + i * 4, 13 - i * 2, 4, i === 0 ? C.steel3 : i === 1 ? C.steel2 : C.steel1); px(g, x - 6 + i * 2, y - 5 + i * 4, C.white) } },
    skill_executioners_edge: (g, x, y) => { axe(g, x - 6, y + 7, -0.9, 14, M.blood, M.darkwood, false); skull(g, x + 5, y + 4, C.bone0) },
    skill_phoenix_draught: (g, x, y) => { potion(g, x, y + 1, [C.red0, C.orange, C.gold3]); for (const d of [-1, 1]) for (let i = 0; i < 3; i++) line(g, x + d * 3, y - 1, x + d * (7 + i), y - 5 + i * 2, i === 0 ? C.gold3 : C.lava1) },
    skill_fortunes_gambit: (g, x, y) => { for (let i = -1; i <= 1; i++) { const cx = x + i * 5; rect(g, cx - 3, y - 6 + Math.abs(i) * 2, 7, 10, i === 0 ? C.white : C.red1); if (i === 0) { px(g, cx, y - 2, C.gold2); px(g, cx, y - 3, C.gold3) } else rect(g, cx - 2, y - 5 + Math.abs(i) * 2, 5, 8, C.red2) } },
    skill_grandmasters_focus: (g, x, y) => { ring(g, x, y, 8, C.purple2); ring(g, x, y, 5, C.gold2); eye(g, x, y, C.purple2) },
    skill_tycoons_vault: (g, x, y) => { rect(g, x - 7, y - 6, 15, 13, C.steel1); rect(g, x - 6, y - 5, 13, 11, C.steel2); ring(g, x, y, 4, C.steel3); line(g, x, y, x + 3, y - 3, C.gold2); px(g, x, y, C.gold3) },
    skill_unbreakable_will: (g, x, y) => { poly(g, [0, -9, 7, -5, 6, 3, 0, 9, -6, 3, -7, -5], x, y, C.steel2); poly(g, [0, -6, 4, -3, 4, 2, 0, 6, -4, 2, -4, -3], x, y, C.gold2); px(g, x - 1, y - 3, C.white) },
    skill_ragnarok_strike: (g, x, y) => {
        // a greatsword wreathed in fire: short tongues flickering up both edges, embers thrown off it
        sword(g, x, y + 9, -Math.PI / 2, 18, M.lava, M.gold, C.brown0, true)
        for (const [dx, dy] of [[-3, 2], [3, -1], [-3, -4], [3, -7], [-2, -10]] as const) tri(g, x + dx, y + dy + 1, x + dx + (dx < 0 ? -1 : 1), y + dy + 1, x + dx + (dx < 0 ? -1 : 1), y + dy - 2, dy < -5 ? C.gold3 : C.orange)
        for (const [dx, dy] of [[-7, -4], [7, -8], [-6, -10], [6, 1]] as const) px(g, x + dx, y + dy, C.gold3)
    },
    skill_aegis_of_renewal: (g, x, y) => {
        // a kite shield bearing a white cross, cleansing sparkles round it
        shield(g, x, y, ShieldStyle.Kite, M.gold, [C.teal1, C.teal2, C.teal3], C.gold3)
        rect(g, x - 1, y - 4, 3, 9, C.white); rect(g, x - 3, y - 2, 7, 3, C.white)
        sparkle(g, x - 8, y - 6, 2, C.teal3); sparkle(g, x + 8, y - 3, 2, C.teal3); sparkle(g, x + 7, y + 7, 1, C.white)
    },
    skill_kings_ransom: (g, x, y) => jeweledCrown(g, x, y + 2),
    skill_ascendants_grace: (g, x, y) => { for (const d of [-1, 1]) for (let i = 0; i < 4; i++) line(g, x + d * 2, y + 2, x + d * (6 + i), y - 6 + i * 3, i === 0 ? C.white : C.gold3); disc(g, x, y + 2, 2, C.gold2); ellipse(g, x, y - 8, 4, 1, C.gold3) },
    skill_emperors_treasury: (g, x, y) => { for (let r = 0; r < 3; r++) for (let i = 0; i <= r; i++) coin(g, x - r * 3 + i * 6, y - 4 + r * 4, 3); crown(g, x, y - 9) },
    skill_immortal_vanguard: (g, x, y) => { shield(g, x, y + 1, ShieldStyle.Tower, M.gold, M.blood, C.gold3); sword(g, x - 7, y + 7, -1.2, 14, M.steel, M.gold, C.brown0); ellipse(g, x, y - 10, 5, 1, C.gold3) }
}

// Shared glyph parts, reused by the item and status icon sets.
export const ABILITY_ICON_PARTS = { bolt, heart, coin, upArrow, downArrow, skull, flame, swirl, sparkle, crown, waves, chains, potion, book, eye, hourglass }
