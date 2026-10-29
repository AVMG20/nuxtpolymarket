import type { Graphics } from 'pixi.js'
import type { Col, HeroArt } from './hero-types'

/*
 * Set B: part-based procedural heroes for the three new classes. Every part
 * is drawn around its own pivot and must stay inside its w x h box (the atlas
 * bakes it centred on the cell), so the boxes below are sized to the shapes.
 * Every colour goes through c() so the white silhouette bake works.
 */

interface Stroke {
    width: number
    color: number
}

/** Dark outline for a main shape */
function ink(c: Col, width = 1.5): Stroke {
    return { width, color: c(0x14101c) }
}

/** Boot at the foot of the leg panel, toe pointing +x (shared by every class) */
function boot(g: Graphics, c: Col, color: number): void {
    g.roundRect(-6, 9, 13, 5, 2).fill(c(color)).stroke(ink(c))
    g.rect(-6, 12.5, 13, 1.5).fill(c(0x0c0a12))
    g.rect(-5, 10, 7, 1).fill({ color: c(0xffffff), alpha: 0.2 })
}

export const HERO_ART_B: { stormcaller: HeroArt, necromancer: HeroArt, voidwalker: HeroArt } = {
    stormcaller: {
        cape: {
            w: 44,
            h: 80,
            draw(g, c) {
                // Navy mantle flowing back and down, with a zig-zag hem
                g.moveTo(6, -8).lineTo(-6, -10)
                    .quadraticCurveTo(-13, -2, -16, 12)
                    .quadraticCurveTo(-19, 24, -18, 32)
                    .lineTo(-13, 28).lineTo(-10, 37).lineTo(-5, 29)
                    .lineTo(0, 36).lineTo(4, 26).lineTo(6, 4)
                    .closePath().fill(c(0x12284a)).stroke(ink(c))
                // Darker fold on the lower back
                g.moveTo(-2, -4).quadraticCurveTo(-8, 8, -9, 20).lineTo(-4, 22)
                    .quadraticCurveTo(-2, 10, 2, 2).closePath().fill(c(0x0c1a33))
                // Pale blue trim along the outer edge
                g.moveTo(-6, -10).quadraticCurveTo(-13, -2, -16, 12)
                    .quadraticCurveTo(-19, 24, -18, 32).stroke({ width: 1.5, color: c(0x9fe4ff) })
                g.moveTo(-13, 28).lineTo(-10, 33).stroke({ width: 1, color: c(0x9fe4ff) })
            }
        },
        leg: {
            w: 18,
            h: 32,
            draw(g, c) {
                // Robe skirt, shaded on the back side and lit on the front
                g.moveTo(-6, -3).lineTo(6, -3).lineTo(7, 9).lineTo(-7, 9).closePath()
                    .fill(c(0x1f4f8a)).stroke(ink(c))
                g.moveTo(-6, -3).lineTo(-2, -3).lineTo(-3, 9).lineTo(-7, 9).closePath().fill(c(0x163a66))
                g.rect(3, -2, 2, 11).fill({ color: c(0x3f7fc0), alpha: 0.9 })
                // Pale hem trim above the boot
                g.rect(-7, 6, 14, 2).fill(c(0x9fe4ff))
                boot(g, c, 0x1a1420)
            }
        },
        torso: {
            w: 34,
            h: 34,
            draw(g, c) {
                // Deep blue robe, shoulders to hem
                g.moveTo(-9, -12).lineTo(9, -12).quadraticCurveTo(12, -6, 13, 12)
                    .lineTo(-13, 12).quadraticCurveTo(-12, -6, -9, -12).closePath()
                    .fill(c(0x1f4f8a)).stroke(ink(c))
                // Shade on the dark (back) side
                g.moveTo(-9, -12).lineTo(-5, -12).lineTo(-6, 12).lineTo(-13, 12)
                    .quadraticCurveTo(-12, -6, -9, -12).closePath().fill(c(0x163a66))
                // Light-blue centre stripe
                g.rect(-2, -12, 4, 24).fill(c(0x63c7ff))
                // Rim highlight on the lit side
                g.moveTo(8, -10).quadraticCurveTo(11, -2, 11, 10).stroke({ width: 1.5, color: c(0x4d8fd0) })
                // Sash with a gold buckle
                g.rect(-13, 5, 26, 3).fill(c(0x2a1a10))
                g.rect(-2, 4.5, 4, 4).fill(c(0xf5c451)).stroke({ width: 0.8, color: c(0x7a5a00) })
                // Yellow lightning-bolt sigil on the chest
                g.poly([3, -3, -3, 3, 0, 3, -3, 10, 4, 2, 1, 2]).fill(c(0xfff27a)).stroke({ width: 1, color: c(0x7a5a00) })
                // Sleeve on the staff arm, pale cuff
                g.ellipse(9, -3, 4, 6).fill(c(0x2a5d9c)).stroke(ink(c, 1))
                g.rect(6, 1, 6, 2).fill(c(0x9fe4ff))
            }
        },
        head: {
            w: 44,
            h: 72,
            draw(g, c) {
                // Hood drape down the back of the neck
                g.moveTo(-9, -14).quadraticCurveTo(-16, -4, -12, 6).lineTo(-5, 4).lineTo(-5, -8).closePath()
                    .fill(c(0x163a66)).stroke(ink(c))
                // Blue hood dome
                g.circle(-1, -11, 10.5).fill(c(0x1e4880)).stroke(ink(c))
                g.moveTo(-10, -12).quadraticCurveTo(-8, -20, 0, -20).quadraticCurveTo(-6, -15, -10, -12).closePath()
                    .fill(c(0x163a66))
                // Pale blue trim along the hood edge
                g.moveTo(-8, -15).quadraticCurveTo(-2, -25, 7, -18).stroke({ width: 1.5, color: c(0x9fe4ff) })
                // Lit face in the hood opening
                g.ellipse(3, -8, 6.5, 8).fill(c(0xe8c4a4)).stroke(ink(c, 1))
                g.ellipse(4, -9, 4, 5).fill({ color: c(0xffffff), alpha: 0.3 })
                g.circle(5, -11, 1.2).fill(c(0x101830))
                g.circle(1.5, -11, 1.2).fill(c(0x101830))
                g.moveTo(0, -14.5).lineTo(4, -14).stroke({ width: 1, color: c(0x6a7a9a) })
                // Long white beard
                g.moveTo(-6, -5).quadraticCurveTo(-8, 3, 0, 7).quadraticCurveTo(8, 5, 9, -4)
                    .quadraticCurveTo(3, -2, -6, -5).closePath().fill(c(0xf0f4ff)).stroke(ink(c, 1))
                g.moveTo(-2, 0).quadraticCurveTo(-1, 4, 0, 6).stroke({ width: 0.8, color: c(0xaab8d0) })
                g.moveTo(4, -1).quadraticCurveTo(4, 3, 3, 5).stroke({ width: 0.8, color: c(0xaab8d0) })
            }
        },
        weapon: {
            w: 84,
            h: 84,
            draw(g, c) {
                // Grip wrap
                g.roundRect(-3, -2.5, 7, 5, 1.5).fill(c(0x3a2418)).stroke(ink(c, 1))
                // Wooden staff with a lit top edge
                g.roundRect(3, -1.5, 29, 3, 1.2).fill(c(0x7a5230)).stroke(ink(c, 1))
                g.rect(4, -1.5, 27, 1).fill(c(0xa8784a))
                // Forked metal crown cradling the orb
                g.moveTo(31, -2.5).quadraticCurveTo(28, -10, 33, -13).lineTo(34, -11)
                    .quadraticCurveTo(32, -8, 33, -2.5).closePath().fill(c(0xc8d2e4)).stroke(ink(c, 1))
                g.moveTo(36, -2.5).quadraticCurveTo(41, -9, 37, -13).lineTo(36, -11)
                    .quadraticCurveTo(38, -8, 35, -2.5).closePath().fill(c(0xc8d2e4)).stroke(ink(c, 1))
                g.rect(31, -3, 5, 5).fill(c(0x8a94a8)).stroke(ink(c, 1))
                // Glowing blue orb
                g.circle(35, -7, 4.5).fill(c(0x63c7ff)).stroke(ink(c, 1))
                g.circle(34, -8, 2).fill(c(0xe8f8ff))
            }
        },
        anchors: {
            cape: [-3, -8],
            legBack: [-4, 10],
            legFront: [4, 10],
            head: [1, -9],
            hand: [9, 1]
        },
        accent: { x: 35, y: -7, r: 6, color: 0x63c7ff, onWeapon: true },
        motion: 'cast',
        rest: -1.3
    },
    necromancer: {
        cape: {
            w: 44,
            h: 80,
            draw(g, c) {
                // Long ragged robe tail, torn into spikes at the hem
                g.moveTo(6, -8).lineTo(-6, -10)
                    .quadraticCurveTo(-12, -4, -14, 10)
                    .lineTo(-17, 20).lineTo(-19, 30).lineTo(-13, 26).lineTo(-13, 36)
                    .lineTo(-8, 27).lineTo(-5, 35).lineTo(-1, 26).lineTo(2, 33)
                    .lineTo(5, 22).lineTo(6, 4)
                    .closePath().fill(c(0x2a1840)).stroke(ink(c))
                // Darker inner panel
                g.moveTo(-2, -4).quadraticCurveTo(-7, 8, -9, 22).lineTo(-6, 24)
                    .lineTo(-3, 14).quadraticCurveTo(0, 6, 3, 0).closePath().fill(c(0x1a0f26))
                // Violet rim on the torn back edge
                g.moveTo(-6, -10).quadraticCurveTo(-12, -4, -14, 10).lineTo(-17, 20)
                    .stroke({ width: 1.2, color: c(0x6a3aa0) })
            }
        },
        leg: {
            w: 18,
            h: 32,
            draw(g, c) {
                // Robe skirt with a tattered hem
                g.moveTo(-6, -3).lineTo(6, -3).lineTo(7, 5).lineTo(4, 8).lineTo(2, 5)
                    .lineTo(0, 9).lineTo(-2, 5).lineTo(-5, 8).lineTo(-7, 5).closePath()
                    .fill(c(0x3a2350)).stroke(ink(c))
                g.rect(-2, -3, 4, 8).fill(c(0x241430))
                boot(g, c, 0x1a1020)
            }
        },
        torso: {
            w: 34,
            h: 34,
            draw(g, c) {
                // Tattered purple robe, its hem torn into points
                g.moveTo(-10, -12).lineTo(10, -12).lineTo(13, 12).lineTo(9, 8).lineTo(6, 12)
                    .lineTo(2, 9).lineTo(-2, 12).lineTo(-6, 8).lineTo(-9, 12).lineTo(-12, 10)
                    .closePath().fill(c(0x3a2350)).stroke(ink(c))
                // Darker inner panel, open at the front
                g.moveTo(-5, -12).lineTo(5, -12).lineTo(4, 10).lineTo(-4, 10).closePath().fill(c(0x241430))
                // Shade on the back side
                g.moveTo(-10, -12).lineTo(-6, -12).lineTo(-7, 9).lineTo(-12, 10).closePath().fill(c(0x1e1030))
                // Rim highlight on the lit side
                g.moveTo(9, -10).quadraticCurveTo(11, 0, 12, 8).stroke({ width: 1.2, color: c(0x6a4a8a) })
                // Dark belt with a bone buckle
                g.rect(-11, 2, 22, 3).fill(c(0x1a0f16))
                g.roundRect(-2.5, 1.5, 5, 4, 1.5).fill(c(0xe8e0cc)).stroke({ width: 1, color: c(0x14101c) })
                // Ribbed bone pauldron on the staff shoulder
                g.ellipse(8, -9, 5.5, 4).fill(c(0xe8e0cc)).stroke(ink(c))
                g.moveTo(4, -10).quadraticCurveTo(8, -6, 12, -10).stroke({ width: 1, color: c(0x8a8478) })
                g.moveTo(4.5, -7).quadraticCurveTo(8, -4, 11.5, -7).stroke({ width: 1, color: c(0x8a8478) })
            }
        },
        head: {
            w: 44,
            h: 72,
            draw(g, c) {
                // Hood drape down behind the shoulders
                g.moveTo(-10, -14).quadraticCurveTo(-16, -2, -12, 6).lineTo(-6, 4).lineTo(-6, -10).closePath()
                    .fill(c(0x1e1030)).stroke(ink(c))
                // Purple hood framing the skull
                g.moveTo(-12, 6).lineTo(-12, -12).quadraticCurveTo(-11, -22, 2, -22)
                    .quadraticCurveTo(11, -20, 10, -10).lineTo(10, 2).lineTo(-6, 4).closePath()
                    .fill(c(0x2a1840)).stroke(ink(c))
                // Violet trim along the hood edge
                g.moveTo(-11, -12).quadraticCurveTo(-9, -20, 2, -21).quadraticCurveTo(8, -19, 9, -11)
                    .stroke({ width: 1.2, color: c(0x7a3ad0) })
                // Bone-white skull with its jaw
                g.circle(2, -12, 7.5).fill(c(0xe8e0cc)).stroke(ink(c, 1))
                g.roundRect(-2, -8, 10, 6, 2.5).fill(c(0xd8d0bc)).stroke(ink(c, 1))
                g.poly([2.5, -8, 4, -5, 1, -5]).fill(c(0x1a0a28))
                g.rect(-1, -3.6, 8, 1.4).fill(c(0x1a0a28))
                g.rect(1.5, -3.6, 0.6, 1.4).fill(c(0xe8e0cc))
                g.rect(4, -3.6, 0.6, 1.4).fill(c(0xe8e0cc))
                // Hollow eye sockets with glowing violet eyes
                g.ellipse(-0.5, -12, 2.6, 3).fill(c(0x1a0a28))
                g.ellipse(5, -12, 2.6, 3).fill(c(0x1a0a28))
                g.circle(-0.5, -12, 1.6).fill(c(0xc77dff))
                g.circle(5, -12, 1.6).fill(c(0xc77dff))
                g.circle(-0.5, -12, 0.7).fill(c(0xf0d8ff))
                g.circle(5, -12, 0.7).fill(c(0xf0d8ff))
            }
        },
        weapon: {
            w: 84,
            h: 84,
            draw(g, c) {
                // Grip wrap
                g.roundRect(-4, -2, 8, 4, 1.5).fill(c(0x1a1020)).stroke(ink(c, 1))
                // Dark shaft with a lit top edge
                g.roundRect(3, -1.5, 31, 3, 1.2).fill(c(0x3a2a3a)).stroke(ink(c, 1))
                g.rect(4, -1.5, 29, 0.8).fill(c(0x6a5a6e))
                // Big curved pale-steel blade hooking back over the shaft
                g.moveTo(31, -4).quadraticCurveTo(41, -20, 21, -31)
                    .quadraticCurveTo(29, -22, 31, -5).closePath()
                    .fill(c(0xc0c8d8)).stroke(ink(c))
                // Bright cutting edge
                g.moveTo(31, -4).quadraticCurveTo(41, -20, 21, -31).stroke({ width: 1, color: c(0xf4f8ff) })
                // Bone binding at the blade base
                g.rect(29, -6, 3, 6).fill(c(0x6a4a2a)).stroke({ width: 1, color: c(0x14101c) })
            }
        },
        anchors: {
            cape: [-3, -8],
            legBack: [-4, 10],
            legFront: [4, 10],
            head: [1, -9],
            hand: [9, 1]
        },
        accent: { x: 3, y: -21, r: 7, color: 0xc77dff },
        motion: 'reap',
        rest: -1.1
    },
    voidwalker: {
        cape: {
            w: 44,
            h: 80,
            draw(g, c) {
                // Long scarf streaming back in a ribbon
                g.moveTo(4, -8).quadraticCurveTo(-10, -11, -14, 4).quadraticCurveTo(-16, 16, -19, 28)
                    .quadraticCurveTo(-13, 14, -6, 6).quadraticCurveTo(-4, 0, 2, -2).closePath()
                    .fill(c(0x8a1a5a)).stroke(ink(c, 1.2))
                // Shorter tail flicking up and back
                g.moveTo(0, -6).quadraticCurveTo(-8, -14, -19, -17).quadraticCurveTo(-10, -10, -4, -3).closePath()
                    .fill(c(0x6a1248)).stroke(ink(c, 1))
                // Dark shade under the main scarf
                g.moveTo(-6, 6).quadraticCurveTo(-12, 16, -17, 26).quadraticCurveTo(-10, 18, -3, 8).closePath()
                    .fill(c(0x4a0c34))
                // Pink energy edge
                g.moveTo(4, -8).quadraticCurveTo(-10, -11, -14, 4).quadraticCurveTo(-16, 16, -19, 28)
                    .stroke({ width: 1, color: c(0xff3fa4) })
            }
        },
        leg: {
            w: 18,
            h: 32,
            draw(g, c) {
                // Sleek dark bodysuit leg with a pink energy seam
                g.roundRect(-5, -3, 11, 13, 3).fill(c(0x1e0a24)).stroke(ink(c))
                g.moveTo(-3, -1).lineTo(3, 8).stroke({ width: 1.2, color: c(0xff3fa4) })
                boot(g, c, 0x2b1030)
            }
        },
        torso: {
            w: 34,
            h: 34,
            draw(g, c) {
                // Narrow-waisted bodysuit
                g.moveTo(-8, -12).lineTo(8, -12).lineTo(7, 0).lineTo(9, 11).lineTo(-9, 11).lineTo(-7, 0)
                    .closePath().fill(c(0x2b1030)).stroke(ink(c))
                // Shade on the back side
                g.moveTo(-8, -12).lineTo(-3, -12).lineTo(-2, 11).lineTo(-9, 11).lineTo(-7, 0).closePath()
                    .fill(c(0x1e0a24))
                // Diagonal pink energy lines across the chest
                g.moveTo(-6, -9).lineTo(5, 2).stroke({ width: 1.5, color: c(0xff3fa4) })
                g.moveTo(-7, -2).lineTo(1, 8).stroke({ width: 1.5, color: c(0xff3fa4) })
                g.moveTo(2, -10).lineTo(7, -6).stroke({ width: 1, color: c(0xff7ac8) })
                // Glowing chest core
                g.circle(0, -5, 2).fill(c(0xffd0ec))
                // Belt with a pink buckle
                g.rect(-9, 6, 18, 2.5).fill(c(0x14081a))
                g.rect(-1.5, 5.5, 3, 3.5).fill(c(0xff3fa4))
                // Sleeve on the blade arm
                g.roundRect(5, -6, 8, 9, 3).fill(c(0x2b1030)).stroke(ink(c, 1))
                g.moveTo(5, 1).lineTo(13, 1).stroke({ width: 1, color: c(0xff3fa4) })
            }
        },
        head: {
            w: 44,
            h: 72,
            draw(g, c) {
                // Two small horn fins, back and front
                g.moveTo(-9, -15).quadraticCurveTo(-15, -26, -11, -33).quadraticCurveTo(-8, -26, -4, -19).closePath()
                    .fill(c(0x2b1030)).stroke(ink(c))
                g.moveTo(-2, -19).quadraticCurveTo(0, -29, 6, -33).quadraticCurveTo(4, -26, 6, -18).closePath()
                    .fill(c(0x2b1030)).stroke(ink(c))
                g.moveTo(-9, -15).quadraticCurveTo(-15, -26, -11, -33).stroke({ width: 1, color: c(0xff3fa4) })
                g.moveTo(-2, -19).quadraticCurveTo(0, -29, 6, -33).stroke({ width: 1, color: c(0xff3fa4) })
                // Dark helmet dome
                g.circle(-1, -12, 11).fill(c(0x1e0a24)).stroke(ink(c))
                g.moveTo(-6, -20).quadraticCurveTo(-1, -23, 4, -20).stroke({ width: 1, color: c(0x3a1a40) })
                // Glowing pink visor across the front
                g.roundRect(0, -15, 10, 6, 3).fill(c(0xff3fa4)).stroke(ink(c, 1))
                g.roundRect(3, -14, 5, 2, 1).fill(c(0xffd0ec))
                // Neck collar
                g.roundRect(-6, -2, 12, 5, 2).fill(c(0x14081a)).stroke(ink(c, 1))
            }
        },
        weapon: {
            w: 84,
            h: 84,
            draw(g, c) {
                // Hilt grip and cross guard
                g.roundRect(-4, -2, 8, 4, 1.5).fill(c(0x14081a)).stroke(ink(c, 1))
                g.roundRect(3, -5, 3, 10, 1.5).fill(c(0x3a1a40)).stroke(ink(c, 1))
                // Wavy kris blade
                g.moveTo(6, -2).bezierCurveTo(12, -5.5, 17, 1.5, 22, -1).quadraticCurveTo(25, -1, 28, 0)
                    .quadraticCurveTo(25, 1.5, 22, 1.5).bezierCurveTo(17, 2.5, 12, 0.5, 6, 2).closePath()
                    .fill(c(0x2b1030)).stroke(ink(c, 1))
                // Glowing pink edge and hot core
                g.moveTo(6, -2).bezierCurveTo(12, -5.5, 17, 1.5, 22, -1).quadraticCurveTo(25, -1, 28, 0)
                    .stroke({ width: 1.3, color: c(0xff3fa4) })
                g.moveTo(8, 0).bezierCurveTo(12, -2.5, 16, 0, 20, -0.5).stroke({ width: 0.8, color: c(0xffd0ec) })
                // Two floating pink crystal shards
                g.poly([14, -12, 17, -16, 20, -12, 17, -8]).fill(c(0xff3fa4)).stroke(ink(c, 1))
                g.poly([22, 9, 24, 6, 26, 9, 24, 12]).fill(c(0xff7ac8)).stroke(ink(c, 1))
            }
        },
        anchors: {
            cape: [-3, -8],
            legBack: [-4, 10],
            legFront: [4, 10],
            head: [1, -9],
            hand: [9, 1]
        },
        accent: { x: 6, y: -21, r: 7, color: 0xff3fa4 },
        motion: 'float',
        rest: -0.3
    }
}
