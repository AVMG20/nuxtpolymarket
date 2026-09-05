// Detailed character silhouettes for the meadow's painted, isometric world.
// Geometry stays in sprite space: the renderer owns movement, damage flashes,
// scaling and depth sorting, and the simulation never depends on these shapes.
import type { Enemy, Player } from './engine'
import { clamp } from './geometry'

type Ctx = CanvasRenderingContext2D
type Point = readonly [number, number]
type Tint = (color: string) => string

/** Small material-aware drawing vocabulary, lit consistently from upper left. */
class Paint {
    constructor(readonly ctx: Ctx, readonly tint: Tint, readonly outline: string) {}

    material(color: string, x: number, y: number, w: number, h: number) {
        const n = parseInt(color.slice(1), 16)
        const shift = (amount: number) => this.tint(`rgb(${clamp((n >> 16 & 255) + amount, 0, 255)},${clamp((n >> 8 & 255) + amount, 0, 255)},${clamp((n & 255) + amount, 0, 255)})`)
        const g = this.ctx.createLinearGradient(x, y, x + w, y + h)
        g.addColorStop(0, shift(18))
        g.addColorStop(0.45, this.tint(color))
        g.addColorStop(1, shift(-22))
        return g
    }

    shape(points: readonly Point[], color: string, edge = true) {
        const c = this.ctx
        c.beginPath()
        for (let i = 0; i < points.length; i++) {
            const p = points[i]!
            if (i === 0) c.moveTo(p[0], p[1])
            else c.lineTo(p[0], p[1])
        }
        c.closePath()
        c.fillStyle = this.tint(color)
        c.fill()
        if (edge) {
            c.strokeStyle = this.outline
            c.lineWidth = 1.2
            c.stroke()
        }
    }

    oval(x: number, y: number, rx: number, ry: number, color: string, edge = true) {
        const c = this.ctx
        c.beginPath()
        c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
        c.fillStyle = rx > 3 ? this.material(color, x - rx, y - ry, rx * 2, ry * 2) : this.tint(color)
        c.fill()
        if (edge) {
            c.strokeStyle = this.outline
            c.lineWidth = 1.2
            c.stroke()
        }
    }

    line(points: readonly Point[], color: string, width = 1) {
        const c = this.ctx
        c.beginPath()
        for (let i = 0; i < points.length; i++) {
            const p = points[i]!
            if (i === 0) c.moveTo(p[0], p[1])
            else c.lineTo(p[0], p[1])
        }
        c.strokeStyle = this.tint(color)
        c.lineWidth = width
        c.lineCap = 'round'
        c.lineJoin = 'round'
        c.stroke()
    }

    rivet(x: number, y: number, color = '#e7c487') {
        this.oval(x, y, 0.9, 0.9, '#262938', false)
        this.oval(x - 0.2, y - 0.3, 0.55, 0.55, color, false)
    }

    gem(x: number, y: number, r: number, color: string) {
        this.shape([[x, y - r], [x + r * 0.7, y], [x, y + r], [x - r * 0.7, y]], color)
        this.shape([[x, y - r + 0.6], [x, y], [x - r * 0.5, y]], '#effbff', false)
    }
}

function greaves(p: Paint, stride: number, width: number, top: number, metal: string, dir: number) {
    for (const side of [-1, 1]) {
        const hip = side * width
        const foot = hip - side * stride
        p.line([[hip, top], [hip + (foot - hip) * 0.4, -8], [foot, -2]], '#252b38', 6)
        p.shape([[hip - 3, -11], [hip + 3, -11], [foot + 2.5, -3], [foot - 2.5, -3]], metal)
        p.line([[hip - 1.5, -10], [foot - 1, -4]], '#d0dbe4', 1.1)
        p.oval(hip, -12, 3.4, 2.5, metal)
        p.shape([[foot - 3, -4], [foot + 2, -4], [foot + dir * 6, -1], [foot + dir * 5, 1], [foot - 3, 1]], '#343c4a')
        p.line([[foot - 2, -0.5], [foot + dir * 4, -0.5]], '#8798a8')
    }
}

function cape(p: Paint, dir: number, top: number, bottom: number, width: number, sway: number, color: string, light: string, trim: string) {
    const tail = -dir * (width + sway)
    p.shape([[-width * 0.7, top], [width * 0.7, top], [tail + width * 0.6, bottom - 2], [tail + 2, bottom - 5], [tail - 2, bottom], [tail - width * 0.6, bottom - 3]], color)
    p.shape([[-width * 0.4, top + 2], [0, top + 4], [tail - 2, bottom - 3], [tail - width * 0.45, bottom - 5]], light, false)
    p.line([[width * 0.5, top + 4], [tail + width * 0.45, bottom - 5], [tail + 2, bottom - 7]], trim, 1.2)
    p.line([[0, top + 6], [tail + 1, bottom - 9]], color, 1.3)
}

function pauldron(p: Paint, x: number, y: number, side: number, metal: string, light: string, spiked = false) {
    p.shape([[x - 6, y + 1], [x - 5, y - 4], [x + 1, y - 6], [x + 6, y - 2], [x + 7, y + 3], [x, y + 5]], metal)
    p.shape([[x - 5, y], [x - 4, y - 3], [x + 1, y - 5], [x + 4, y - 2], [x, y]], light, false)
    p.line([[x - 5, y + 2], [x, y + 4], [x + 6, y + 2]], '#c4ae82')
    p.shape([[x - 4, y + 4], [x + 5, y + 4], [x + 4, y + 7], [x - 3, y + 6]], metal)
    p.rivet(x - 3, y + 1)
    p.rivet(x + 4, y + 1)
    if (spiked) {
        p.shape([[x + side * 2, y - 4], [x + side * 6, y - 13], [x + side * 6, y - 1]], '#b3a491')
    }
}

/** One hero rig shared by all six loadouts; equipment accents identify the role. */
export function drawHeroBody(ctx: Ctx, player: Player, bob: number, t: number, hurt: boolean, outline: string) {
    const p = new Paint(ctx, c => hurt ? '#ffd6d6' : c, outline)
    const dir = Math.cos(player.facing) < 0 ? -1 : 1
    const heavy = player.weapon === 'warhammer' || player.weapon === 'greataxe'
    const rogue = player.weapon === 'daggers'
    const reaper = player.weapon === 'scythe'
    const cloth = rogue ? '#346c69' : reaper ? '#5b477d' : '#315c9d'
    const metal = heavy ? '#8b9fac' : '#adbdc9'
    const stride = player.moving || player.dodge ? Math.sin(player.walk) * 5 : 0
    ctx.save()
    // The cape moves independently, while soles remain on the ground during bob.
    cape(p, dir, -28 - bob, -1, 12, Math.sin(t * 6 + player.walk) * 2 + (player.moving ? 5 : 0), '#782c39', '#c74e50', '#e2b978')
    greaves(p, stride, 4.5, -15 - bob, metal, dir)
    ctx.translate(0, -bob)
    // Split tabard over chainmail; scalloped links catch the light at its hem.
    p.shape([[-9, -24], [9, -24], [11, -9], [3, -7], [0, -13], [-3, -7], [-11, -10]], '#343f50')
    for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 7; i++) p.line([[-9 + i * 2.7, -13 + row * 2], [-8 + i * 2.7, -12 + row * 2], [-7 + i * 2.7, -13 + row * 2]], '#7c91a1', 0.65)
    }
    p.shape([[-6, -24], [6, -24], [7, -8], [2, -10], [0, -8], [-6, -9]], cloth)
    p.line([[-4, -21], [-4, -10]], '#84a6cf')
    // Sculpted cuirass with a central ridge and overlapping belly plates.
    p.shape([[-9, -30], [-4, -33], [5, -33], [10, -29], [8, -20], [0, -17], [-8, -21]], metal)
    p.shape([[-8, -29], [-3, -31], [0, -30], [0, -20], [-6, -23]], '#dae3e4', false)
    p.shape([[0, -30], [7, -29], [6, -22], [0, -20]], '#6c8399', false)
    p.line([[0, -31], [0, -20]], '#ecf3ed', 1.2)
    for (let i = 0; i < 2; i++) p.shape([[-8, -21 + i * 3], [0, -19 + i * 3], [8, -21 + i * 3], [7, -18 + i * 3], [0, -16 + i * 3], [-7, -18 + i * 3]], metal)
    // Leather baldric, clasp and a small field pouch.
    p.line([[-7, -31], [6, -18]], '#3a2e2e', 3.6)
    p.line([[-7, -31], [6, -18]], '#99663e', 2)
    p.line([[-8, -16], [8, -16]], '#4f3931', 3)
    p.gem(0, -16, 2.2, '#dcb870')
    p.shape([[-11, -18], [-7, -18], [-6, -12], [-10, -11], [-12, -13]], '#866044')
    p.line([[-11, -16], [-7, -15]], '#c9a475')
    p.rivet(-9, -15)
    pauldron(p, -10, -29, -1, metal, '#e1e7e5', heavy)
    pauldron(p, 10, -29, 1, metal, '#d4dfe3', heavy)
    // Gorget, shaded jaw and cheek guards make the face read as a volume.
    p.oval(0, -33, 6, 2.8, '#667b90')
    p.oval(dir, -38, 6.8, 7.1, '#d99d7c')
    p.shape([[-4, -41], [4, -42], [6, -37], [3, -33], [-3, -34]], '#f3c7a0', false)
    if (rogue || reaper) {
        p.shape([[-8, -35], [-9, -43], [-4, -50], [2, -52], [8, -45], [9, -34], [5, -32], [5, -42], [0, -45], [-5, -41], [-5, -33]], cloth)
        p.line([[-7, -42], [-2, -48], [2, -49]], '#93b6bf', 1.2)
        p.shape([[-5, -37], [6, -37], [4, -32], [-3, -32]], '#30434b')
    } else {
        p.shape([[-8, -37], [-8, -44], [-4, -48], [2, -49], [7, -46], [9, -40], [8, -36], [5, -38], [-4, -39]], metal)
        p.shape([[-6, -43], [-3, -47], [0, -47], [-1, -40], [-6, -40]], '#eef1e6', false)
        p.line([[1, -48], [2, -41], [7, -40]], '#6b8093')
        p.shape([[-8, -39], [-5, -39], [-4, -33], [-7, -34]], '#9daebe')
        p.shape([[6, -39], [8, -39], [7, -34], [4, -33]], '#8398aa')
        p.line([[-7, -40], [7, -39]], '#e4c382', 1.3)
        const tail = -dir * 15
        const flutter = Math.sin(t * 5 + player.walk * 0.3) * 2
        p.shape([[0, -48], [-dir * 2, -54], [-dir * 8, -54], [tail - dir * 3, -47 + flutter], [tail, -44 + flutter], [-dir * 9, -49], [-dir * 3, -49]], '#e4e3d5')
        p.line([[-dir * 2, -51], [-dir * 8, -52], [tail, -46 + flutter]], '#fff7dd', 1.3)
    }
    p.line([[dir - 3, -38], [dir + 3, -38]], '#352d36', 1.6)
    p.oval(dir * 3, -38, 0.8, 0.8, '#edf6f3', false)
    // A leaf-shaped gold brooch ties the hero to the meadow palette.
    p.gem(-6, -30, 2, '#ebc36b')
    ctx.restore()
}

/** Inlaid edges and wrapped grips follow the existing weapon-local transform. */
export function drawHeroWeaponDetails(ctx: Ctx, weapon: Player['weapon']) {
    const p = new Paint(ctx, c => c, '#292c39')
    switch (weapon) {
        case 'sword':
            p.shape([[3, -2.4], [29, -1], [35, 0], [3, 0]], '#f0f6eb', false)
            p.line([[4, 0.5], [28, 0.5]], '#6f8da8', 0.7)
            p.line([[-0.5, -5], [1, -4], [1, 4], [-0.5, 5]], '#fff0b3', 1)
            for (let i = -7; i < -1; i += 2) p.line([[i, -1.7], [i + 0.8, 1.7]], '#bf9b67', 0.7)
            p.gem(-9, 0, 2.2, '#dabb78')
            p.gem(1, 0, 1.7, '#83c2d1')
            break
        case 'greataxe':
            for (const side of [-1, 1]) {
                p.line([[33, side * 9], [36, side * 17], [47, side * 20]], '#475c70', 1.3)
                p.line([[35, side * 9], [38, side * 15], [44, side * 17]], '#e9dbc0', 0.8)
                p.gem(41, side * 11, 2.5, '#d7ad66')
                p.rivet(34, side * 3)
                p.rivet(46, side * 3)
            }
            p.line([[2, -1], [28, -1]], '#c09b65', 1)
            p.line([[31, -4], [48, -4]], '#ced8dc', 1)
            p.gem(-23, 0, 3, '#9baeb9')
            break
        case 'warhammer':
            p.shape([[31, -13], [50, -11], [47, -7], [35, -8]], '#d5e0df', false)
            p.shape([[50, -10], [52, -9], [53, 10], [49, 8]], '#515e70')
            p.line([[38, -7], [38, 7], [44, 7], [44, -7]], '#bca374', 1.2)
            p.gem(41, 0, 4, '#e3b775')
            p.rivet(34, -8)
            p.rivet(34, 8)
            p.rivet(47, -7)
            p.rivet(47, 7)
            p.line([[2, -1], [28, -1]], '#bc9560', 1)
            p.gem(-21, 0, 3, '#a2b5c2')
            break
        case 'scythe':
            p.line([[35, -6], [48, -13], [59, -21]], '#697b94', 0.8)
            p.line([[39, -7], [42, -11], [45, -10]], '#d9c393', 0.8)
            p.line([[48, -13], [51, -17], [54, -17]], '#d9c393', 0.8)
            p.gem(30, -1, 2.5, '#b89cd5')
            for (let i = 0; i < 4; i++) p.line([[-14 + i * 2, 0], [-13 + i * 2, 3]], '#c2a177', 0.7)
            p.line([[-28, 6], [-18, 3]], '#b6a578', 1)
            break
        case 'spear':
            p.shape([[39, -4], [56, 0], [40, 0]], '#f3f5e4', false)
            p.line([[40, 0], [54, 0]], '#617f96', 0.8)
            p.line([[-24, -0.8], [33, -0.8]], '#ccb17b', 0.8)
            for (let i = 0; i < 6; i++) p.line([[-5 + i * 2, -1.7], [-4 + i * 2, 1.7]], '#3c3832', 0.8)
            p.line([[35, -3], [35, 3]], '#edca8a', 1)
            p.shape([[35, 3], [40, 7], [36, 14], [34, 10]], '#a44545')
            p.line([[36, 5], [37, 9]], '#eea87d', 0.8)
            p.gem(-27, 0, 2, '#a9b9c0')
            break
        case 'daggers':
            p.shape([[2, -2.3], [16, -0.6], [19, 0], [2, 0]], '#eef6ed', false)
            p.line([[3, 0.6], [15, 0.3]], '#5d858e', 0.7)
            p.line([[0, -4], [1, 0], [0, 4]], '#d1b879', 1.5)
            for (let i = -5; i < 0; i += 2) p.line([[i, -1.5], [i + 0.8, 1.5]], '#a1987b', 0.7)
            p.gem(-7, 0, 1.7, '#89cabb')
            break
    }
}

export function drawHeroShieldDetails(ctx: Ctx) {
    const p = new Paint(ctx, c => c, '#333648')
    p.line([[-10, -16], [-10, 5], [0, 15], [10, 5], [10, -16], [-10, -16]], '#d5b574', 1.6)
    p.shape([[1, -14], [9, -14], [9, 4], [1, 12]], '#263f71', false)
    p.line([[0, -14], [0, 13]], '#f1d79e', 1)
    for (const side of [-1, 1]) for (const y of [-14, -5, 4]) p.rivet(side * 10, y)
    p.gem(0, -2, 3, '#e3c17c')
    p.line([[-7, -10], [-3, -8], [-3, -4]], '#799ec9', 0.8)
}

export function drawBogOgre(ctx: Ctx, e: Enemy, dir: number, bob: number, t: number, tint: Tint, outline: string) {
    const p = new Paint(ctx, tint, outline)
    const stride = Math.sin(e.walk) * 6
    ctx.save()
    for (const side of [-1, 1]) {
        const foot = side * 12 - side * stride
        p.line([[side * 12, -23], [side * 14, -12], [foot, -3]], '#344c3c', 11)
        p.line([[side * 11, -20], [foot, -5]], '#768354', 7)
        p.oval(foot + dir * 2, -2, 8, 4, '#718153')
        for (let i = 0; i < 3; i++) p.shape([[foot - 3 + i * 4, -3], [foot - 2 + i * 4, 0], [foot + i * 4, -2]], '#d1c798')
        p.line([[foot - 5, -7], [foot + 4, -6]], '#69503a', 3)
    }
    ctx.translate(0, -bob)
    // Huge hunch, shoulder muscles and a sagging belly with directional facets.
    p.oval(-dir * 6, -49, 26, 22, '#455d40')
    p.oval(0, -37, 29, 26, '#718455')
    p.oval(-4, -35, 23, 22, '#93a267', false)
    p.shape([[12, -54], [25, -44], [28, -32], [20, -19], [8, -14], [15, -30]], '#576c49', false)
    p.oval(-5, -31, 16, 15 + Math.sin(t * 2) * 0.4, '#a5ac73', false)
    p.line([[-13, -23], [-5, -21], [6, -23]], '#7c8957', 1.4)
    p.oval(4, -29, 2, 1.4, '#657349', false)
    // Mossy stone shoulder, root lashing, fungi and a heavy hanging arm.
    p.line([[-dir * 22, -46], [-dir * 30, -30], [-dir * 29, -21]], '#344c3c', 13)
    p.line([[-dir * 22, -46], [-dir * 29, -31], [-dir * 28, -23]], '#81905b', 9)
    p.oval(-dir * 29, -22, 6, 7, '#8e9a60')
    for (let i = 0; i < 3; i++) p.line([[-dir * 32 + i * 3, -23], [-dir * 32 + i * 3, -18]], '#566640')
    p.shape([[-30, -49], [-27, -61], [-18, -66], [-7, -59], [-9, -48], [-21, -44]], '#56625b')
    p.shape([[-27, -59], [-18, -64], [-10, -58], [-20, -55]], '#929780', false)
    p.line([[-23, -61], [-20, -54], [-24, -47]], '#333e3e', 1.3)
    p.line([[-29, -53], [-17, -50], [-8, -56]], '#ae9860', 2)
    for (let i = 0; i < 6; i++) {
        const x = -27 + i * 3
        p.oval(x, -60 + Math.sin(i * 2) * 3, 3.6, 2.1, i % 2 ? '#647d40' : '#87974b', false)
    }
    for (const [x, y, r] of [[-23, -66, 4], [-14, -64, 3], [-27, -61, 2.5]] as const) {
        p.line([[x, y + 4], [x, y]], '#b9ac83', 1.5)
        p.oval(x, y, r, r * 0.5, '#ba764d')
        p.line([[x - r * 0.5, y - 0.5], [x + r * 0.3, y - 0.5]], '#e0b274')
    }
    // A stitched hide apron and teeth hanging from a rope belt.
    p.shape([[-18, -23], [16, -23], [17, -10], [9, -7], [3, -10], [-4, -7], [-16, -10]], '#62432f')
    p.shape([[-14, -21], [-2, -21], [-4, -10], [-13, -12]], '#8d6441', false)
    p.line([[-18, -22], [-4, -19], [17, -22]], '#c0a06b', 2.6)
    for (let i = 0; i < 5; i++) p.line([[-2, -18 + i * 1.6], [1, -17 + i * 1.6]], '#c8ab79', 0.8)
    for (const x of [-12, 7, 13]) p.shape([[x, -20], [x + 3, -20], [x + 1, -14]], '#e0d2a4')
    // Broad asymmetrical face, recessed sockets, nose and protruding tusks.
    const hx = dir * 5
    p.oval(hx, -65, 14, 13, '#6c8152')
    p.oval(hx - 3, -68, 9, 7, '#94a269', false)
    for (const side of [-1, 1]) {
        p.shape([[hx + side * 10, -70], [hx + side * 20, -73], [hx + side * 15, -63], [hx + side * 10, -63]], '#778b57')
        p.oval(hx + side * 5, -68, 4, 2.8, '#3e503b', false)
        p.oval(hx + side * 5 + dir, -68, 1.7, 1.5, '#ffc970', false)
        p.line([[hx + side * 5 + dir, -69], [hx + side * 5 + dir, -67]], '#2d2f28', 0.9)
        p.line([[hx + side * 2, -72], [hx + side * 9, -70]], '#63774d', 3)
    }
    p.oval(hx + dir * 2, -63, 5, 3.4, '#a4ad72')
    p.oval(hx + dir * 3, -62, 1.5, 0.8, '#556841', false)
    p.oval(hx, -57, 10, 5.5, '#8c995e')
    p.line([[hx - 7, -59], [hx, -58], [hx + 7, -60]], '#354333', 2.2)
    for (const side of [-1, 1]) p.shape([[hx + side * 5, -57], [hx + side * 8, -58], [hx + side * 9, -66], [hx + side * 6, -62]], '#ece0b3')
    p.line([[hx - 8, -74], [hx - 5, -70], [hx - 7, -66]], '#c0b085', 1.2)
    for (const [x, y] of [[17, -47], [22, -37], [-17, -37], [13, -58]] as const) {
        p.oval(x, y, 2.3, 1.8, '#647c4b', false)
        p.oval(x - 0.6, y - 0.6, 0.8, 0.6, '#bac18a', false)
    }
    // The original windup/recovery angles remain the source of the club pose.
    const raise = e.state === 'windup' && e.attack ? -1.8 * clamp(e.stateT / e.attack.windup, 0, 1) : e.state === 'recover' ? 0.9 : 0
    ctx.save()
    ctx.translate(dir * 24, -40)
    ctx.rotate(dir * (0.6 + raise))
    p.shape([[-3, -4], [31, -5], [44, -9], [49, 0], [42, 10], [28, 5], [-3, 4]], '#68472e')
    p.line([[6, -2], [29, -2], [42, -5]], '#a47b49', 1.7)
    p.line([[12, 2], [30, 2], [40, 6]], '#3b3329', 1.4)
    p.shape([[27, -8], [36, -12], [49, -7], [52, 4], [44, 12], [31, 8]], '#596b67')
    p.shape([[29, -7], [36, -10], [46, -6], [38, -1]], '#97a18b', false)
    p.line([[38, -10], [36, -2], [43, 2], [41, 10]], '#354742', 1.5)
    for (const x of [28, 44]) p.line([[x, -7], [x + 1, 8]], '#ad9769', 2.5)
    p.shape([[31, -9], [33, -18], [37, -11]], '#c8c8a6')
    p.shape([[45, 9], [49, 17], [50, 4]], '#c8c8a6')
    for (let i = 0; i < 4; i++) p.line([[i * 3, -4], [i * 3 + 2, 4]], '#b49562', 1.2)
    p.oval(0, 1, 5, 6, '#8c995e')
    ctx.restore()
    ctx.restore()
}

function bossSword(p: Paint, length: number, dark: boolean) {
    p.shape([[-9, -2.5], [4, -2.5], [4, 2.5], [-9, 2.5]], '#3a2b32')
    for (let i = -7; i < 3; i += 2.5) p.line([[i, -2], [i + 1, 2]], '#998783', 0.8)
    p.gem(-11, 0, 3, dark ? '#dc744d' : '#86cde4')
    p.shape([[2, -4], [-1, -9], [3, -10], [7, -4], [7, 4], [3, 10], [-1, 9], [2, 4]], dark ? '#b89459' : '#afc4d5')
    p.shape([[7, -4], [length - 10, -3], [length, 0], [length - 10, 3], [7, 4]], dark ? '#8d9aaa' : '#cbdfe8')
    p.shape([[8, -3], [length - 10, -2], [length - 1, 0], [8, 0]], '#eef5ed', false)
    p.line([[10, 0], [length - 9, 0]], dark ? '#445369' : '#698aaf', 1)
    for (let i = 0; i < 3; i++) p.line([[15 + i * 6, -1.4], [17 + i * 6, 0], [15 + i * 6, 1.4]], dark ? '#eab875' : '#9cf0fa', 0.8)
}

export function drawAshenWarlord(ctx: Ctx, e: Enemy, dir: number, bob: number, t: number, tint: Tint, outline: string) {
    const p = new Paint(ctx, tint, outline)
    ctx.save()
    cape(p, dir, -42 - bob, -3, 17, Math.sin(t * 5) * 3, '#4b2736', '#94433f', '#ba925c')
    greaves(p, Math.sin(e.walk) * 5, 7, -20 - bob, '#626675', dir)
    ctx.translate(0, -bob)
    // Layered faulds and a torn crimson tabard under the blackened plate.
    p.shape([[-10, -28], [11, -28], [12, -6], [4, -10], [1, -6], [-9, -9]], '#973e3c')
    p.line([[-6, -25], [-5, -11]], '#d49867', 1.1)
    for (let row = 0; row < 3; row++) {
        const y = -25 + row * 4
        p.shape([[-12, y], [12, y], [14, y + 4], [4, y + 5], [0, y + 3], [-5, y + 5], [-14, y + 4]], '#424553')
        p.line([[-11, y + 1], [-4, y + 2]], '#8c8c96')
    }
    p.shape([[-14, -42], [-7, -47], [7, -47], [15, -41], [10, -27], [0, -23], [-11, -28]], '#484d5c')
    p.shape([[-12, -40], [-5, -43], [0, -41], [0, -27], [-8, -30]], '#757c87', false)
    p.shape([[1, -41], [12, -40], [8, -29], [1, -26]], '#303642', false)
    p.line([[-11, -40], [-3, -37], [0, -32], [3, -37], [12, -40]], '#c4a16b', 1.8)
    p.gem(0, -37, 3.5, '#df674b')
    p.line([[-10, -26], [0, -25], [10, -26]], '#ad8454', 2.6)
    p.gem(0, -25, 2.7, '#e1b96d')
    for (const side of [-1, 1]) {
        p.line([[side * 15, -39], [side * 19, -28]], '#333745', 7)
        p.shape([[side * 15 - 4, -33], [side * 15 + 4, -34], [side * 19 + 4, -26], [side * 19 - 3, -24]], '#656c7c')
        pauldron(p, side * 15, -41, side, '#4b505e', '#92939b', true)
        p.rivet(side * 9, -31)
    }
    // Fur mantle breaks up the straight shoulder line.
    for (let i = 0; i < 9; i++) {
        const x = -15 + i * 3.6
        p.shape([[x - 2, -47], [x + 3, -47], [x + 3, -43], [x, -41 - i % 2], [x - 2, -44]], i % 2 ? '#8e8172' : '#b2a18a')
    }
    // Faceted helmet, cheek plates, breathing slots and curved ivory horns.
    p.shape([[-10, -45], [-10, -60], [-6, -65], [3, -67], [10, -61], [10, -47], [0, -43]], '#565b69')
    p.shape([[-8, -60], [-4, -63], [0, -64], [-1, -46], [-7, -48]], '#92939b', false)
    p.shape([[1, -63], [8, -60], [8, -48], [2, -46]], '#333947', false)
    p.line([[0, -65], [0, -46]], '#bd9a66', 1.5)
    p.shape([[-8, -57], [0, -55], [8, -58], [7, -53], [0, -52], [-7, -54]], '#24232e')
    p.line([[-6, -55], [-2, -54]], '#ff9860', 1.5)
    p.line([[2, -54], [6, -55]], '#ff9860', 1.5)
    for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) p.line([[side * (3 + i * 1.7), -51], [side * (3 + i * 1.7), -48]], '#252a35', 0.9)
        p.shape([[side * 8, -58], [side * 15, -61], [side * 19, -68], [side * 18, -76], [side * 14, -68], [side * 8, -64]], '#bcb195')
        p.line([[side * 10, -62], [side * 15, -65], [side * 18, -72]], '#f0dfb7', 1.2)
        p.line([[side * 11, -60], [side * 12, -64]], '#766e61')
    }
    const flutter = Math.sin(t * 5) * 2
    p.shape([[0, -66], [-dir * 3, -74], [-dir * 10, -77], [-dir * 20, -73 + flutter], [-dir * 25, -64 + flutter], [-dir * 17, -68], [-dir * 10, -70], [-dir * 3, -66]], '#a14745')
    p.line([[-dir * 3, -71], [-dir * 10, -74], [-dir * 20, -70 + flutter]], '#df8060', 1.5)
    const raise = e.state === 'windup' && e.attack ? -1.4 * clamp(e.stateT / e.attack.windup, 0, 1) : e.state === 'recover' ? 0.9 : 0
    ctx.save()
    ctx.translate(dir * 14, -32)
    ctx.rotate(dir * (0.5 + raise))
    bossSword(p, 50, true)
    p.oval(-2, 0, 3.5, 4, '#7d8490')
    ctx.restore()
    if (e.shield && !e.shield.broken) {
        ctx.save()
        ctx.translate(dir * 22, -31)
        p.shape([[-11, -20], [0, -24], [11, -20], [10, 10], [0, 24], [-10, 10]], '#ac8a58')
        p.shape([[-8, -18], [0, -21], [8, -18], [7, 9], [0, 19], [-7, 9]], '#393b48')
        p.shape([[-7, -17], [0, -20], [0, 17], [-6, 8]], '#565b68', false)
        p.shape([[0, -13], [5, -4], [2, -5], [6, 6], [0, 12], [-6, 6], [-2, -5], [-5, -4]], '#bd5747')
        p.gem(0, 1, 3.5, '#e4b76c')
        for (const side of [-1, 1]) for (const y of [-16, -5, 8]) p.rivet(side * 9, y)
        p.line([[-6, 2], [-2, 5], [-4, 8]], '#a0a0a3', 0.7)
        ctx.restore()
    }
    ctx.restore()
}

export function drawBriarMatriarch(ctx: Ctx, e: Enemy, dir: number, bob: number, t: number, tint: Tint, outline: string) {
    const p = new Paint(ctx, tint, outline)
    const bristle = e.state === 'windup' && e.attack ? clamp(e.stateT / e.attack.windup, 0, 1) : 0
    ctx.save()
    // Articulated woody legs with bark facets, thorn joints and rooted toes.
    for (let i = 0; i < 6; i++) {
        const side = i < 3 ? -1 : 1
        const k = i % 3
        const spread = (26 + k * 12) * side
        const lift = Math.sin(e.walk * 0.8 + i) * 4 + bristle * 6
        const jointX = spread * 0.78
        const jointY = -39 - k * 3 - lift - bob
        p.line([[side * 8, -26 - k * 6 - bob], [jointX, jointY], [spread, -3]], '#313e30', 6 - k * 0.7)
        p.line([[side * 8, -26 - k * 6 - bob], [jointX, jointY], [spread, -3]], '#7e8050', 3.5 - k * 0.5)
        p.line([[jointX - 0.8, jointY + 2], [spread - 1, -6]], '#b2af71', 0.9)
        p.oval(jointX, jointY, 3, 3.5, '#516c3e')
        p.shape([[jointX - 2, jointY], [jointX + side * 5, jointY - 9], [jointX + 2, jointY + 3]], '#a6ad70')
        p.line([[spread - side * 4, -1], [spread, -3], [spread + side * 4, -1]], '#6b6a43', 1.6)
    }
    ctx.translate(0, -bob)
    // Overlapping bramble carapace scales wrap around the abdomen.
    p.oval(-dir * 6, -26, 27, 22, '#334e37')
    for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 5; i++) {
            const x = -dir * 6 - 21 + i * 9 + (row % 2) * 2
            const y = -39 + row * 11 + Math.abs(i - 2) * 2
            p.shape([[x - 4, y], [x + 2, y - 4], [x + 7, y + 1], [x + 4, y + 11], [x, y + 7]], (i + row) % 2 ? '#526e41' : '#6a824d')
            p.line([[x + 1, y - 1], [x + 2, y + 6]], '#a5ae72', 0.8)
        }
    }
    for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2 + e.seed
        const x = -dir * 6 + Math.cos(a) * 23
        const y = -26 + Math.sin(a) * 18
        p.shape([[x - 3, y + 2], [x + Math.cos(a) * (10 + bristle * 3), y + Math.sin(a) * (9 + bristle * 3)], [x + 3, y - 2]], '#97a96b')
    }
    // Curling vines and little rose buds add organic detail without particles.
    for (const side of [-1, 1]) {
        p.line([[side * 13, -18], [side * 23, -24], [side * 19, -34], [side * 11, -37]], '#a1a564', 1.5)
        for (let i = 0; i < 3; i++) p.oval(side * (14 + i * 3), -32 + i * 4, 2.4, 1.7, i % 2 ? '#be6276' : '#dfa08c')
    }
    const hx = dir * 8
    p.oval(hx, -37, 14, 13, '#68834e')
    p.shape([[hx - 11, -39], [hx - 8, -53], [hx - 4, -61], [hx + 4, -61], [hx + 9, -51], [hx + 11, -38], [hx, -33]], '#786241')
    p.shape([[hx - 7, -48], [hx - 3, -57], [hx, -58], [hx - 1, -37], [hx - 6, -40]], '#b39960', false)
    for (const side of [-1, 1]) {
        p.line([[hx + side * 6, -52], [hx + side * 3, -46], [hx + side * 7, -40]], '#463e32', 1.3)
        p.shape([[hx, -48], [hx + side * 13, -55], [hx + side * 10, -44], [hx + side * 4, -39]], '#789453')
        p.line([[hx + side * 2, -45], [hx + side * 10, -51]], '#b5bd79')
    }
    p.gem(hx, -43, 3, '#e3b57d')
    // Two whorls of pointed petals, with veins and a gilded seed-pod face.
    for (let layer = 0; layer < 2; layer++) {
        for (let i = 0; i < 7; i++) {
            const a = -Math.PI + i / 6 * Math.PI
            const r = (layer ? 13 : 18) + Math.sin(t * 2 + i) * 1.2 + bristle * 4
            ctx.save()
            ctx.translate(hx, -61)
            ctx.rotate(a + Math.PI / 2)
            p.shape([[-3, -5], [-6, -r + 5], [0, -r - 6], [5, -r + 4], [3, -5]], layer ? '#cf7790' : '#874d75')
            p.line([[0, -6], [-1, -r + 2], [0, -r - 3]], layer ? '#f2b4b1' : '#c789a1', 0.85)
            ctx.restore()
        }
    }
    p.shape([[hx - 8, -66], [hx, -72], [hx + 8, -66], [hx + 6, -57], [hx, -53], [hx - 6, -57]], '#c8b571')
    p.shape([[hx - 6, -65], [hx, -70], [hx, -55], [hx - 4, -58]], '#ead59a', false)
    for (const [x, y, r] of [[-4, -64, 2], [3, -64, 2], [-2, -59, 1.3], [3, -59, 1.3]] as const) {
        p.oval(hx + x, y, r, r * 1.2, '#34283e')
        p.oval(hx + x - 0.3, y - 0.7, 0.6, 0.6, '#ffe2a5', false)
    }
    p.line([[hx - 2, -55], [hx, -53], [hx + 2, -55]], '#65533d')
    // Curved scythe forearms spread through the existing attack windup.
    for (const side of [-1, 1]) {
        ctx.save()
        ctx.translate(hx + side * 11, -44)
        ctx.rotate(side * (0.5 - bristle * 1.1))
        p.line([[0, 0], [side * 12, -4], [side * 20, 1]], '#3f5539', 5)
        p.line([[0, -1], [side * 12, -5]], '#9ca768', 2)
        p.oval(side * 13, -3, 3.3, 3, '#819650')
        p.shape([[side * 16, -3], [side * 24, -4], [side * 33, 2], [side * 37, 11], [side * 27, 4], [side * 19, 3]], '#c8c791')
        p.line([[side * 24, -2], [side * 31, 3], [side * 35, 8]], '#f0e1ad', 1.2)
        p.shape([[side * 4, -3], [side * 9, -11], [side * 10, -4]], '#8a9d5b')
        ctx.restore()
    }
    ctx.restore()
}

export function drawHollowKnight(ctx: Ctx, e: Enemy, dir: number, bob: number, t: number, tint: Tint, outline: string) {
    const p = new Paint(ctx, tint, outline)
    const parry = e.parryT > 0 || (e.state === 'windup' && e.attack?.kind === 'parry')
    ctx.save()
    cape(p, dir, -43 - bob, -5, 14, Math.sin(t * 4.5) * 3, '#283651', '#4d6084', '#98aeca')
    greaves(p, Math.sin(e.walk) * 5, 6, -18 - bob, '#8c9eb7', dir)
    ctx.translate(0, -bob)
    p.shape([[-7, -28], [8, -28], [8, -9], [2, -6], [0, -10], [-5, -7]], '#465980')
    p.line([[-3, -24], [-2, -11]], '#c2cbe0')
    for (let i = 0; i < 3; i++) {
        const y = -26 + i * 4
        p.shape([[-9, y], [0, y + 2], [9, y], [11, y + 4], [3, y + 6], [0, y + 4], [-3, y + 6], [-11, y + 4]], '#7a8fa9')
        p.line([[-8, y + 1], [-2, y + 3]], '#d5e4eb')
    }
    // Fluted silver cuirass: bright left plane, cool reflected right edge.
    p.shape([[-12, -43], [-5, -47], [5, -47], [12, -43], [9, -29], [0, -23], [-9, -29]], '#849ab6')
    p.shape([[-10, -42], [-4, -44], [0, -41], [0, -26], [-7, -31]], '#cfdee6', false)
    p.shape([[1, -41], [10, -42], [7, -31], [1, -26]], '#546d91', false)
    p.line([[0, -43], [0, -26]], '#eff9f5', 1.3)
    for (const side of [-1, 1]) {
        p.line([[side * 9, -41], [side * 5, -36], [side * 3, -29]], '#a6c2d7')
        p.line([[side * 13, -39], [side * 15, -31]], '#465674', 6)
        p.shape([[side * 15 - 3, -34], [side * 15 + 3, -34], [side * 17 + 3, -26], [side * 17 - 3, -26]], '#96adc5')
        pauldron(p, side * 13, -41, side, '#8ea4be', '#e3edf0')
    }
    p.gem(0, -38, 2.3, '#8be0ee')
    p.line([[-8, -25], [0, -24], [8, -25]], '#aabacd', 2)
    p.gem(0, -24, 2, '#b8e9ed')
    p.oval(0, -46, 7, 3, '#627b99')
    // Pointed great helm, hollow visor, engraved cheek vents and a swept crest.
    p.shape([[-9, -47], [-10, -61], [-6, -66], [0, -71], [7, -66], [10, -60], [8, -48], [0, -44]], '#91a8c1')
    p.shape([[-8, -61], [-5, -65], [0, -69], [0, -47], [-6, -50]], '#d1e0e7', false)
    p.shape([[2, -67], [8, -61], [6, -49], [2, -47]], '#5f7d9f', false)
    p.line([[0, -69], [0, -46]], '#eaf4ee', 1.1)
    p.shape([[-8, -59], [0, -57], [8, -60], [7, -55], [0, -54], [-7, -56]], '#22334f')
    p.line([[-6, -57], [-1, -56]], parry ? '#f3ffff' : '#86dcf4', 1.3)
    p.line([[2, -56], [6, -57]], parry ? '#f3ffff' : '#86dcf4', 1.3)
    for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) p.line([[side * (3 + i * 1.5), -53], [side * (3 + i * 1.5), -50 + i * 0.2]], '#486382', 0.7)
        p.rivet(side * 7, -61, '#d6ebf1')
    }
    const flutter = Math.sin(t * 4.5) * 2
    p.shape([[0, -69], [-dir * 3, -77], [-dir * 9, -80], [-dir * 18, -75 + flutter], [-dir * 23, -66 + flutter], [-dir * 13, -71], [-dir * 7, -73], [-dir * 2, -68]], '#566fa7')
    p.line([[-dir * 4, -74], [-dir * 9, -77], [-dir * 17, -73 + flutter]], '#a9c7e6', 1.5)
    const raise = e.state === 'windup' && e.attack?.kind === 'melee' ? -1.5 * clamp(e.stateT / e.attack.windup, 0, 1) : e.state === 'recover' ? 0.8 : 0
    ctx.save()
    ctx.translate(dir * 13, -34)
    ctx.rotate(parry ? -Math.PI / 2 * dir : dir * (0.45 + raise))
    bossSword(p, 56, false)
    p.oval(-2, 0, 3.5, 4, '#a5bad1')
    if (parry) {
        const x = 8 + (t * 1.6 % 1) * 46
        p.line([[x - 5, 0], [x + 5, 0]], '#e4ffff', 2)
        p.line([[x, -4], [x, 4]], '#e4ffff', 1)
    }
    ctx.restore()
    if (e.shield && !e.shield.broken) {
        const x = -dir * 16
        p.oval(x, -33, 9, 12, '#c0d1df')
        p.oval(x, -33, 7, 10, '#475f85')
        p.oval(x - 1, -34, 5, 7.5, '#6b8eae')
        for (let i = 0; i < 8; i++) {
            const a = i / 8 * Math.PI * 2
            p.rivet(x + Math.cos(a) * 7.5, -33 + Math.sin(a) * 10.5, '#eff8f2')
        }
        p.line([[x, -42], [x, -24]], '#c3dbe5', 1.2)
        p.line([[x - 6, -33], [x + 6, -33]], '#c3dbe5', 1.2)
        p.gem(x, -33, 4, parry ? '#f1ffff' : '#8ed8ed')
    }
    ctx.restore()
}
