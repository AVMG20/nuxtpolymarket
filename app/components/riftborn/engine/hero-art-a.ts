import type { Graphics } from 'pixi.js'
import type { HeroArt } from './hero-types'

type Col = Parameters<HeroArt['cape']['draw']>[1]
type Shape = (g: Graphics) => void

const OUT = 0x14101c

/** Fills a shape, runs the detail pass on top of it, then outlines it */
function body(g: Graphics, c: Col, shape: Shape, color: number, detail?: (d: Graphics) => void): void {
    shape(g)
    g.fill(c(color))
    detail?.(g)
    shape(g)
    g.stroke({ width: 1.5, color: c(OUT) })
}

/** A single detail line, optionally translucent */
function line(g: Graphics, c: Col, x1: number, y1: number, x2: number, y2: number, color: number, width = 1, alpha = 1): void {
    g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width, color: c(color), alpha })
}

// ─── Knight: silver plate, gold trim, blue tabard, great helm, two-handed cleaver ───

const knight: HeroArt = {
    cape: {
        w: 44,
        h: 64,
        draw(g, c) {
            // Blue tabard-cloak hanging from the shoulders and trailing back
            body(g, c, s => s.poly([-8, -3, 7, -3, 6, 22, 1, 28, -4, 23, -10, 30, -16, 25, -18, 17, -13, 8]), 0x2a4a8a, d => {
                d.poly([-8, -3, -3, -3, -6, 22, -10, 30, -16, 25, -18, 17, -13, 8]).fill(c(0x1d3566))
                line(d, c, 2, -1, 0, 18, 0x3d62b0, 2)
            })
            g.moveTo(6, 22).lineTo(1, 28).lineTo(-4, 23).lineTo(-10, 30).lineTo(-16, 25).stroke({ width: 2, color: c(0xf5c451) })
        }
    },
    leg: {
        w: 22,
        h: 32,
        draw(g, c) {
            // Cuisse, greave with a gold knee cop, steel sabaton
            body(g, c, s => s.roundRect(-3.5, -2, 7.5, 10, 3), 0x8a8ea0, d => {
                line(d, c, -2.5, 0, -2.5, 6, 0xaeb3c2, 1, 0.6)
            })
            body(g, c, s => s.roundRect(-3.5, 5, 7.5, 7, 2.5), 0xc9ccd6, d => {
                d.circle(0.25, 6.5, 2.2).fill(c(0xf5c451))
            })
            body(g, c, s => s.roundRect(-4.5, 9.5, 13, 4.5, 2), 0x3a3e4c, d => {
                d.rect(-3, 10.5, 9, 1).fill(c(0x5a5e6c))
            })
        }
    },
    torso: {
        w: 42,
        h: 38,
        draw(g, c) {
            // Far-side pauldron, behind the breastplate
            body(g, c, s => s.ellipse(-10, -10.5, 7, 6), 0x8a8ea0)

            // Breastplate with shaded flank, ridge, rim light, gold collar and chest gem
            body(g, c, s => s.roundRect(-11, -13, 22, 27, 6), 0xc9ccd6, d => {
                d.roundRect(-11, -12, 6, 25, 4).fill(c(0x8a8ea0))
                d.rect(-1, -11, 2, 14).fill(c(0xaeb3c2))
                d.roundRect(2, -12, 7, 5, 2.5).fill({ color: c(0xffffff), alpha: 0.45 })
                d.roundRect(-10, -13, 20, 3, 1.5).fill(c(0xf5c451))
                const gem = [0, -10, 3, -7, 0, -4, -3, -7]
                d.poly(gem).fill(c(0xf5c451))
                d.poly(gem).stroke({ width: 1, color: c(OUT) })
                d.circle(-1, -8.5, 0.8).fill({ color: c(0xffffff), alpha: 0.9 })
            })

            // Gold tabard over the front with a blue cross and hem
            body(g, c, s => s.poly([-6.5, -5, 6.5, -5, 8, 15, -8, 15]), 0xe0a832, d => {
                d.poly([-6.5, -5, -2.5, -5, -4.5, 15, -8, 15]).fill(c(0xb07a1c))
                d.poly([3, -5, 6.5, -5, 8, 15, 5, 15]).fill(c(0xf8d070))
                d.rect(-1.3, -3, 2.6, 13).fill(c(0x2a4a8a))
                d.rect(-4.5, 1.5, 9, 2.6).fill(c(0x2a4a8a))
                d.rect(-8, 12, 16, 3).fill(c(0x2a4a8a))
            })

            // Leather belt with a gold buckle
            body(g, c, s => s.roundRect(-11, 1, 22, 3.5, 1.2), 0x3a2818)
            body(g, c, s => s.roundRect(-3, 0.5, 6, 4.5, 1), 0xf5c451)

            // Near-side layered pauldron with a gold rim, over the chest
            body(g, c, s => s.ellipse(9.5, -10.5, 8, 6.5), 0xd8dce6, d => {
                d.ellipse(9.5, -7.5, 7.5, 3).fill(c(0xaeb3c2))
                d.ellipse(9.5, -10.5, 8, 6.5).stroke({ width: 1.4, color: c(0xf5c451) })
                d.circle(7.5, -13, 1.8).fill({ color: c(0xffffff), alpha: 0.6 })
                d.circle(12, -9, 0.9).fill(c(0xf5c451))
            })
        }
    },
    head: {
        w: 46,
        h: 68,
        draw(g, c) {
            // Red plume streaming back off the crest
            body(g, c, s => s.moveTo(-3, -19).quadraticCurveTo(-10, -35, -20, -29).quadraticCurveTo(-12, -26, -8, -20).quadraticCurveTo(-5, -18, -3, -19).closePath(), 0xe0413a)
            line(g, c, -5, -22, -17, -29, 0xff8a7a, 1.2, 0.8)

            // Great helm: gold crest band, shaded back flank, visor slit, rivets
            body(g, c, s => s.roundRect(-9, -21, 18, 20, 6), 0xd8dce6, d => {
                d.roundRect(-9, -21, 5, 19, 3).fill(c(0x9ea3b3))
                d.circle(-3, -16, 2.5).fill({ color: c(0xffffff), alpha: 0.5 })
                d.roundRect(-8.5, -19, 17, 3, 1).fill(c(0xf5c451))
                d.rect(-9, -4, 18, 2.5).fill(c(0xf5c451))
                d.roundRect(0, -12, 7.5, 3, 1.5).fill(c(0x14101c))
                d.circle(-5, -8, 0.9).fill(c(0x14101c))
                d.circle(-1, -8, 0.9).fill(c(0x14101c))
                d.circle(-6, -6.5, 1).fill(c(0xf5c451))
                d.circle(5, -6.5, 1).fill(c(0xf5c451))
            })
        }
    },
    weapon: {
        w: 86,
        h: 24,
        draw(g, c) {
            // Leather-wrapped grip, gold pommel and gold crossguard
            body(g, c, s => s.roundRect(-7, -2.5, 11, 5, 1.5), 0x5a3a22, d => {
                d.rect(-5, -2.5, 1, 5).fill(c(0x2a1a10))
                d.rect(-1, -2.5, 1, 5).fill(c(0x2a1a10))
            })
            body(g, c, s => s.circle(-8, 0, 3.2), 0xf5c451)
            body(g, c, s => s.roundRect(3, -9, 4.5, 18, 2), 0xf5c451)

            // Wide cleaver blade with a fuller, lower bevel and an edge highlight
            body(g, c, s => s.poly([7.5, -5, 33, -7, 40, -2, 42, 0, 40, 2, 33, 6.5, 7.5, 5]), 0xe8eef8, d => {
                d.poly([7.5, 1.5, 42, 0, 40, 2, 33, 6.5, 7.5, 5]).fill(c(0xb8c0d0))
                d.rect(9, -1, 24, 1.5).fill(c(0xaab2c4))
                d.rect(9, -5, 1.5, 10).fill(c(0xf5c451))
                line(d, c, 10, -4, 32, -6.2, 0xffffff, 1.2, 0.85)
            })
        }
    },
    back: {
        w: 36,
        h: 36,
        draw(g, c) {
            // Big round blue shield strapped across the back, gold rim and boss
            body(g, c, s => s.circle(-4, 4, 11), 0x2a4a8a, d => {
                d.circle(-4, 4, 7.5).stroke({ width: 1, color: c(0x1d3566) })
                line(d, c, -11, 0, -6, -4, 0xffffff, 2, 0.35)
                d.circle(-4, 4, 3).fill(c(0xf5c451))
            })
            g.circle(-4, 4, 11).stroke({ width: 2.5, color: c(0xf5c451) })
        }
    },
    anchors: {
        cape: [-3, -8],
        legBack: [-4, 10],
        legFront: [4, 10],
        head: [1, -9],
        hand: [9, 1],
        back: [-8, -2]
    },
    accent: { x: 0, y: -7, r: 5, color: 0xf5c451 },
    motion: 'swing',
    rest: -0.9
}

// ─── Ranger: green hooded cloak, leather jerkin, shadowed hood with glowing eyes, longbow ───

const ranger: HeroArt = {
    cape: {
        w: 44,
        h: 64,
        draw(g, c) {
            // Long green cloak with a ragged hem
            body(g, c, s => s.poly([-8, -2, 7, -2, 6, 22, 2, 18, -2, 30, -6, 20, -10, 28, -14, 18, -19, 20, -17, 8, -20, 0]), 0x3d9c5a, d => {
                d.poly([-8, -2, -2, -2, -6, 20, -10, 28, -14, 18, -19, 20, -17, 8, -20, 0]).fill(c(0x2f6e42))
                line(d, c, 3, 0, 2, 14, 0x9effc0, 1.2, 0.3)
                line(d, c, -4, 2, -9, 12, 0x2f6e42, 1)
            })
        }
    },
    leg: {
        w: 22,
        h: 32,
        draw(g, c) {
            // Breeches, wrapped calf and a leather boot with a cuff
            body(g, c, s => s.roundRect(-3.5, -2, 7.5, 10, 3), 0x4a3a28, d => {
                line(d, c, 2, 0, 2, 7, 0xffffff, 1.2, 0.1)
            })
            body(g, c, s => s.roundRect(-3.5, 6, 7.5, 6, 2), 0x3a2c1c)
            body(g, c, s => s.roundRect(-4.5, 9.5, 13, 4.5, 2), 0x2a1e14, d => {
                d.rect(-3, 10.5, 9, 1).fill(c(0x6a4428))
            })
        }
    },
    torso: {
        w: 34,
        h: 34,
        draw(g, c) {
            // Green tunic with a shaded flank
            body(g, c, s => s.roundRect(-10, -13, 20, 27, 5), 0x3d9c5a, d => {
                d.roundRect(-10, -13, 5, 26, 3).fill(c(0x2f7e48))
            })

            // Leather jerkin with stitching
            body(g, c, s => s.poly([-9, -12, 9, -12, 8, 12, -8, 12]), 0x6a4428, d => {
                d.poly([-9, -12, -6, -12, -7, 12, -8, 12]).fill(c(0x4a2e18))
                line(d, c, 4, -9, 5, 9, 0x2a1a10, 0.8, 0.8)
                d.roundRect(3, -11, 4, 3, 1.5).fill({ color: c(0xffffff), alpha: 0.2 })
            })

            // Diagonal bandolier strap
            body(g, c, s => s.poly([-6, -12, -3, -12, 6, 12, 3, 12]), 0x3e2818)

            // Belt with a buckle and a pouch
            body(g, c, s => s.roundRect(-11, 6, 22, 4, 1.5), 0x2a1a10, d => {
                d.roundRect(-2.5, 6.5, 5, 3, 1).fill(c(0xc8a040))
            })
            body(g, c, s => s.roundRect(6, 9, 5, 5, 1.5), 0x6a4428)
        }
    },
    head: {
        w: 36,
        h: 52,
        draw(g, c) {
            // Pointed hood peak swept back
            body(g, c, s => s.poly([-9, -14, -15, -25, -3, -24, 3, -19]), 0x3d9c5a)

            // Round hood with a rim light
            body(g, c, s => s.circle(-1, -11, 11), 0x2f7e48, d => {
                line(d, c, -2, -21, 8, -12, 0x5fe08a, 1.5, 0.35)
            })

            // Shadowed face opening
            body(g, c, s => s.ellipse(3, -10, 6.5, 7.5), 0x1a2a1e, d => {
                d.ellipse(4, -8, 4, 5).fill(c(0x0c1610))
            })

            // Two glowing green eyes
            g.circle(1.5, -11, 1.8).fill(c(0x9effc0))
            g.circle(5.5, -11, 1.8).fill(c(0x9effc0))
            g.circle(2, -11.6, 0.6).fill(c(0xffffff))
            g.circle(6, -11.6, 0.6).fill(c(0xffffff))
        }
    },
    weapon: {
        w: 52,
        h: 46,
        draw(g, c) {
            // Recurve stave bulging toward +x, string on the -x side
            g.moveTo(-7, -20).quadraticCurveTo(9, 0, -7, 20).stroke({ width: 5, color: c(OUT) })
            g.moveTo(-7, -20).quadraticCurveTo(9, 0, -7, 20).stroke({ width: 3, color: c(0x8a5a30) })
            g.moveTo(-7, -20).lineTo(-7, 20).stroke({ width: 1, color: c(0xe8e8e8) })

            // Wrapped grip at the pivot
            body(g, c, s => s.roundRect(-2.5, -4.5, 5, 9, 2), 0x3e2818, d => {
                d.rect(-2, -2, 4, 1).fill(c(0x6a4428))
                d.rect(-2, 1, 4, 1).fill(c(0x6a4428))
            })

            // Nocked arrow pointing along +x
            line(g, c, -7, 0, 20, 0, 0xd8c8a8, 1.4)
            g.poly([-12, -3.5, -7, 0, -12, 3.5, -10, 0]).fill(c(0xc8402a))
            body(g, c, s => s.poly([19, -2.6, 25, 0, 19, 2.6]), 0xc8d0dc)
        }
    },
    back: {
        w: 36,
        h: 54,
        draw(g, c) {
            // Arrow shafts with fletchings poking out of the quiver mouth
            line(g, c, -6, -9, -3, -25, 0xd8c8a8, 1.2)
            line(g, c, -4, -10, -1, -26, 0xd8c8a8, 1.2)
            line(g, c, -2, -10, 1, -23, 0xd8c8a8, 1.2)
            g.poly([-6, -19, -3, -24, 0, -19, -3, -21]).fill(c(0xe8e0cc))
            g.poly([-4, -20, -1, -25, 2, -20, -1, -22]).fill(c(0xc8402a))
            g.poly([-2, -17, 1, -22, 4, -17, 1, -19]).fill(c(0xe8e0cc))

            // Leather quiver tube with two straps
            body(g, c, s => s.poly([-6, -13, 0, -13, -6, 12, -12, 12]), 0x6a4428, d => {
                line(d, c, -8.5, -4, -1.5, -4, 0x3e2818, 1.6)
                line(d, c, -10.5, 4, -3.5, 4, 0x3e2818, 1.6)
            })
        }
    },
    anchors: {
        cape: [-3, -8],
        legBack: [-4, 10],
        legFront: [4, 10],
        head: [1, -9],
        hand: [9, 1],
        back: [-8, -2]
    },
    accent: { x: 4.5, y: -20, r: 5, color: 0x5fe08a },
    motion: 'draw',
    rest: 0
}

// ─── Pyromancer: crimson robe, gold trim, tall brimmed hat, ember mantle, fire-crystal staff ───

const pyromancer: HeroArt = {
    cape: {
        w: 46,
        h: 44,
        draw(g, c) {
            // Short flowing ember mantle with a flame-like hem
            body(g, c, s => s.poly([-8, -2, 8, -2, 8, 6, 5, 12, 1, 8, -3, 18, -8, 12, -13, 20, -16, 12, -22, 14, -19, 6, -14, -2]), 0xff6a2b, d => {
                d.poly([-8, -2, 2, -2, -2, 10, -8, 12, -13, 20, -16, 12, -19, 6, -14, -2]).fill(c(0xc8401a))
                d.poly([-3, -2, 4, -2, 3, 6, 0, 3]).fill({ color: c(0xffb347), alpha: 0.85 })
            })
        }
    },
    leg: {
        w: 22,
        h: 32,
        draw(g, c) {
            // Dark red breeches under the robe, dark boots with a gold trim
            body(g, c, s => s.roundRect(-3.5, -2, 7.5, 10, 3), 0x3a1a14)
            body(g, c, s => s.roundRect(-3.5, 6, 7.5, 6, 2), 0x2a1210)
            body(g, c, s => s.roundRect(-4.5, 9.5, 13, 4.5, 2), 0x2a1a12, d => {
                d.rect(-3, 10.5, 9, 1).fill(c(0xf5c451))
            })
        }
    },
    torso: {
        w: 34,
        h: 44,
        draw(g, c) {
            // Crimson robe with a shaded side, dark red hem and gold trim
            body(g, c, s => s.poly([-9, -13, 9, -13, 13, 19, -13, 19]), 0xc2412a, d => {
                d.poly([-9, -13, -4, -13, -10, 19, -13, 19]).fill(c(0x9a2e1e))
                line(d, c, 6, -11, 10, 14, 0xe0603a, 1.6, 0.6)
                d.poly([-13, 11, 13, 11, 13, 19, -13, 19]).fill(c(0x6e1812))
                d.rect(-13, 10, 26, 2).fill(c(0xf5c451))
                d.poly([-6, -13, 6, -13, 0, -3]).fill(c(0x3a0e0a))
                line(d, c, -6, -13, 0, -3, 0xf5c451, 2)
                line(d, c, 0, -3, 6, -13, 0xf5c451, 2)
                d.rect(-10, 2, 20, 3).fill(c(0xf5c451))
                d.circle(0, 7.5, 1.2).fill(c(0xf5c451))
                d.circle(0, 14, 1.2).fill(c(0xf5c451))
            })
        }
    },
    head: {
        w: 36,
        h: 70,
        draw(g, c) {
            // Orange hair tufts behind the brim
            body(g, c, s => s.poly([-6, -14, -13, -8, -12, -2, -8, -5, -7, 3, -4, -6]), 0xff7a3a)

            // Skin face with a small dark eye, nose and mouth
            body(g, c, s => s.circle(1, -10, 8), 0xf2c6a0, d => {
                d.ellipse(3, -4, 6, 3).fill(c(0xe0a880))
            })
            g.circle(5, -11, 1.4).fill(c(0x2a1010))
            line(g, c, 3, -15, 7, -15.5, 0x2a1010, 1)
            g.circle(8.5, -9, 1.1).fill(c(0xe0a880))
            g.ellipse(4, -7, 2, 1.3).fill({ color: c(0xff7a5a), alpha: 0.5 })
            g.moveTo(4, -4.5).quadraticCurveTo(6, -3.5, 8, -4.5).stroke({ width: 0.9, color: c(0x7a3a2a) })

            // Wide dark-red brim
            body(g, c, s => s.ellipse(0, -17, 16, 4), 0x4a1410)

            // Tall pointed hat with an orange band
            body(g, c, s => s.moveTo(-9, -18).lineTo(9, -18).quadraticCurveTo(5, -26, -1, -29).quadraticCurveTo(-4, -31, -8, -33).quadraticCurveTo(-6, -25, -9, -18).closePath(), 0x5a1d16, d => {
                d.poly([-8.5, -20.5, 6, -20.5, 4.5, -23.5, -6.5, -23.5]).fill(c(0xff9a3a))
                line(d, c, 3, -18, -3, -30, 0xffffff, 1, 0.22)
            })
        }
    },
    weapon: {
        w: 80,
        h: 44,
        draw(g, c) {
            // Gnarled staff: knotted rod with a forked branch near the top
            body(g, c, s => s.poly([-9, -1.8, 22, -1.4, 25, -2.6, 26, 0.6, 22, 1.4, -9, 1.9]), 0x6a4a2a, d => {
                d.circle(6, -0.6, 1.1).fill(c(0x3e2a16))
                d.circle(-3, 0.6, 0.9).fill(c(0x3e2a16))
                line(d, c, -8, -0.8, 21, -0.6, 0x9a7040, 0.8, 0.9)
            })
            body(g, c, s => s.poly([13, -1, 18, -6, 24, -11, 26, -9.5, 21, -3, 17, 1]), 0x6a4a2a)

            // Ember-wood tongue of flame above the crystal
            body(g, c, s => s.moveTo(27, -10).quadraticCurveTo(25, -16, 31, -20).quadraticCurveTo(31, -15, 35, -13).quadraticCurveTo(37, -9, 35, -9).closePath(), 0xff6a2b)

            // Claw cradle holding the fire crystal
            body(g, c, s => s.roundRect(22, -3, 18, 4, 2), 0x4a3018)
            body(g, c, s => s.poly([23, -1.5, 27, -1.5, 30, -12, 27, -13, 23, -6]), 0x4a3018)
            body(g, c, s => s.poly([34, -1.5, 38, -1.5, 39, -7, 36, -8, 33, -4]), 0x4a3018)

            // Burning fire crystal
            body(g, c, s => s.circle(31, -7, 5.5), 0xff9a3a, d => {
                d.circle(31, -7, 3.2).fill(c(0xffc24a))
                d.circle(31, -7.5, 1.5).fill(c(0xfff3c0))
                d.circle(29, -9, 1).fill({ color: c(0xffffff), alpha: 0.8 })
            })
        }
    },
    anchors: {
        cape: [-3, -8],
        legBack: [-4, 10],
        legFront: [4, 10],
        head: [1, -9],
        hand: [9, 1]
    },
    accent: { x: 31, y: -7, r: 8, color: 0xff6a2b, onWeapon: true },
    motion: 'cast',
    rest: -1.2
}

export const HERO_ART_A: { knight: HeroArt, ranger: HeroArt, pyromancer: HeroArt } = {
    knight,
    ranger,
    pyromancer
}
