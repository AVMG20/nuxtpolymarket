// Shared vector paths for SVG UI art and synchronous Canvas/Pixi textures.
// This fixed palette belongs to the illustration, not the app's UI theme.
import type { XenoArtId } from './xenoslot-art'

interface Shape {
    d: string
    fill: string
    stroke: string
    width: number
    transform?: [number, number, number]
}

const ink = '#111d35'
const ice = '#e4fbff'
const mint = '#b5f77b'
const cyan = '#7cdeed'
const purple = '#d1a5ff'
const gold = '#ffd47f'

interface Gradient {
    height: number
    stops: [number, string][]
    radial?: boolean
}

const gradients: Record<string, Gradient> = {
    'glow-cyan': { height: 128, radial: true, stops: [[0, '#67e8f960'], [0.6, '#67e8f924'], [1, '#67e8f900']] },
    'glow-violet': { height: 128, radial: true, stops: [[0, '#cc86ff70'], [0.6, '#cc86ff28'], [1, '#cc86ff00']] },
    'glow-lime': { height: 128, radial: true, stops: [[0, '#b5f77b60'], [0.6, '#b5f77b24'], [1, '#b5f77b00']] },
    'glow-gold': { height: 128, radial: true, stops: [[0, '#ffce8560'], [0.6, '#ffce8524'], [1, '#ffce8500']] },
    chrome: { height: 256, stops: [[0, '#f1fcff'], [0.25, '#a0b8d8'], [0.49, '#effaff'], [0.52, '#40557c'], [0.8, '#9bb8d5'], [1, '#233859']] },
    glass: { height: 200, stops: [[0, '#aaf5f4'], [0.25, '#428fac'], [0.65, '#17455d'], [1, '#0c213b']] },
    leaf: { height: 180, stops: [[0, '#f4ffc5'], [0.35, '#c8fa7d'], [0.7, '#72bf57'], [1, '#246f60']] },
    violet: { height: 240, stops: [[0, '#fbeaff'], [0.28, '#d9a0ff'], [0.55, '#9654c4'], [1, '#382466']] },
    plasma: { height: 230, stops: [[0, '#fffbd8'], [0.22, '#ffd793'], [0.48, '#ffae65'], [0.53, '#ea773f'], [1, '#ad3657']] },
    panel: { height: 240, stops: [[0, '#415277'], [0.48, '#1a2944'], [1, '#0b1126']] },
    'royal-ten': { height: 10, stops: [[0, '#f0ffff'], [0.42, '#a6f4ff'], [0.48, '#48d8ed'], [0.53, '#218eaf'], [1, '#0b466f']] },
    'royal-jack': { height: 10, stops: [[0, '#fbffdc'], [0.42, '#d4fba8'], [0.48, '#a0e65a'], [0.53, '#559b39'], [1, '#214e39']] },
    'royal-queen': { height: 10, stops: [[0, '#fff0ff'], [0.42, '#e1baff'], [0.48, '#c58ce9'], [0.53, '#8750b9'], [1, '#3d2468']] },
    'royal-king': { height: 10, stops: [[0, '#fffde5'], [0.42, '#ffe7b4'], [0.48, '#ffd073'], [0.53, '#bd8538'], [1, '#70452a']] },
    'royal-ace': { height: 10, stops: [[0, '#fff0f2'], [0.42, '#ffc4d0'], [0.48, '#f68da5'], [0.53, '#bc506e'], [1, '#692840']] },
    'glyph-rim': { height: 10, stops: [[0, '#ffffff'], [0.4, '#dbeeff'], [0.52, '#4f657e'], [0.75, '#cfdfef'], [1, '#7292b1']] }
}

gradients['badge-lime'] = { height: 10, stops: [[0, '#ffffff'], [0.45, '#e8ffca'], [1, '#b5f77b']] }
gradients['badge-violet'] = { height: 10, stops: [[0, '#ffffff'], [0.45, '#f2e0ff'], [1, '#d1a5ff']] }
for (const [tier, light, mid, dark] of [
    ['bronze', '#ffe0be', '#dba079', '#8e5846'],
    ['silver', '#f2ffff', '#bcd5e5', '#637f9e'],
    ['gold', '#fff4bf', '#ffd47f', '#a87430'],
    ['xenium', '#edffb8', '#b5f77b', '#4c975d']
] as const) {
    gradients[`metal-${tier}`] = { height: 240, stops: [[0, light], [0.38, mid], [0.49, light], [0.52, dark], [0.8, mid], [1, dark]] }
}

function paintColor(ctx: CanvasRenderingContext2D, value: string): string | CanvasGradient {
    const g = gradients[value]
    if (!g) return value
    const gradient = g.radial ? ctx.createRadialGradient(110, 90, 0, 128, 128, g.height) : ctx.createLinearGradient(0, 0, 0, g.height)
    for (const [offset, color] of g.stops) gradient.addColorStop(offset, color)
    return gradient
}

// Path lettering keeps reel textures and SVGs identical without font loading.
const glyphs: Record<string, string> = {
    '0': 'M2 0H5L7 2V8L5 10H2L0 8V2Z',
    '1': 'M1 2L4 0V10M1 10H7',
    '2': 'M0 2L2 0H5L7 2V4L0 10H7',
    '5': 'M7 0H0V4H5L7 6V8L5 10H0',
    J: 'M0 0H7M5 0V8L3 10H1L0 8',
    Q: 'M2 0H5L7 2V8L5 10H2L0 8V2ZM4 7L8 11',
    K: 'M0 0V10M7 0L0 5 7 10',
    A: 'M0 10V3L3.5 0 7 3V10M0 6H7',
    W: 'M0 0L1 10 3.5 6 6 10 7 0',
    I: 'M0 0H7M3.5 0V10M0 10H7',
    L: 'M0 0V10H7',
    D: 'M0 0V10H4L7 7V3L4 0Z',
    B: 'M0 0V10H5L7 8V7L5 5H0M0 0H5L7 2V3L5 5',
    O: 'M2 0H5L7 2V8L5 10H2L0 8V2Z',
    N: 'M0 10V0L7 10V0',
    U: 'M0 0V8L2 10H5L7 8V0',
    S: 'M7 0H2L0 2V3L2 5H5L7 7V8L5 10H0',
    '×': 'M1 2L6 8M6 2L1 8'
}

function illustration(id: XenoArtId): Shape[] {
    const shapes: Shape[] = []
    const p = (d: string, fill = 'none', stroke = ink, width = 5) => shapes.push({ d, fill, stroke, width })
    const line = (d: string, color: string, width = 4) => p(d, 'none', color, width)
    const e = (x: number, y: number, rx: number, ry: number, fill: string, stroke = ink, width = 5) =>
        p(`M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`, fill, stroke, width)
    const text = (value: string, x: number, y: number, size: number, color: string, width = 1.8) => {
        const scale = size / 10
        const left = x - (value.length * 10 - 3) * scale / 2
        for (const [i, letter] of [...value].entries()) shapes.push({ d: glyphs[letter]!, fill: 'none', stroke: color, width, transform: [left + i * 10 * scale, y - size / 2, scale] })
    }
    const star = (x: number, y: number, r = 10, color = ice) => p(`M${x} ${y - r}L${x + 3} ${y - 3} ${x + r} ${y} ${x + 3} ${y + 3} ${x} ${y + r} ${x - 3} ${y + 3} ${x - r} ${y} ${x - 3} ${y - 3}Z`, color, 'none', 0)
    const hex = (r: number, color: string, stroke: string, width = 5) => p(`M128 ${128 - r}L${128 + r * 0.87} ${128 - r * 0.5}V${128 + r * 0.5}L128 ${128 + r} ${128 - r * 0.87} ${128 + r * 0.5}V${128 - r * 0.5}Z`, color, stroke, width)
    const glow = id === 'wild' || id.startsWith('ufo') || id === 'jack' ? 'glow-lime' : id === 'bonus' || id === 'diamond' || id === 'queen' || id === 'core-5' ? 'glow-violet' : id === 'seven' || id === 'king' || id.startsWith('coin-') || id === 'core-10' ? 'glow-gold' : 'glow-cyan'
    e(128, 128, 128, 128, glow, 'none', 0)
    const alien = (x: number, y: number, s: number) => {
        // Compact head geometry also supplies the saucer's little pilot.
        p(`M${x} ${y - 47 * s}C${x - 68 * s} ${y - 47 * s} ${x - 64 * s} ${y + 5 * s} ${x - 25 * s} ${y + 42 * s}Q${x} ${y + 65 * s} ${x + 25 * s} ${y + 42 * s}C${x + 64 * s} ${y + 5 * s} ${x + 68 * s} ${y - 47 * s} ${x} ${y - 47 * s}Z`, 'leaf', ink, 4)
        p(`M${x + 12 * s} ${y - 43 * s}Q${x + 58 * s} ${y - 25 * s} ${x + 29 * s} ${y + 30 * s}L${x} ${y + 51 * s}Q${x + 35 * s} ${y + 50 * s} ${x + 49 * s} ${y}Q${x + 56 * s} ${y - 40 * s} ${x + 12 * s} ${y - 43 * s}`, '#6bbb76', 'none', 0)
        for (const side of [-1, 1]) {
            p(`M${x + side * 9 * s} ${y + 10 * s}Q${x + side * 20 * s} ${y - 13 * s} ${x + side * 43 * s} ${y - 12 * s}Q${x + side * 46 * s} ${y + 21 * s} ${x + side * 9 * s} ${y + 10 * s}Z`, ink, 'none', 0)
            e(x + side * 30 * s, y - 3 * s, 4 * s, 3 * s, ice, 'none', 0)
        }
        line(`M${x - 8 * s} ${y + 34 * s}Q${x} ${y + 39 * s} ${x + 8 * s} ${y + 34 * s}`, ink, 2.5)
    }

    const royals: Record<string, [string, string]> = { ten: ['10', cyan], jack: ['J', mint], queen: ['Q', purple], king: ['K', gold], ace: ['A', '#f4a5b2'] }
    const royal = royals[id]
    if (royal) {
        // Beveled neon lettering, with a quieter plate than the feature symbols.
        const [letter, color] = royal
        const size = id === 'ten' ? 99 : 135
        hex(108, '#0e193080', `${color}55`, 2)
        text(letter, 131, 135, size, ink, 3.4)
        text(letter, 128, 128, size, 'glyph-rim', 2.9)
        text(letter, 128, 128, size, ink, 2.5)
        text(letter, 128, 128, size, `royal-${id}`, 2.1)
        line('M86 215H170', color, 3)
        p('M120 208H136L142 215 128 225 114 215Z', color, ink, 3)
        return shapes
    }

    switch (id) {
        case 'bell':
            // A suspended bioluminescent specimen, with a glass dome and seals.
            e(128, 219, 73, 10, '#09122080', 'none', 0)
            p('M65 176V108Q65 39 128 39Q191 39 191 108V176Z', 'glass', cyan, 5)
            p('M78 165V105Q78 56 128 53Q168 53 178 94Q140 65 115 100Q94 131 101 169Z', '#42989f', 'none', 0)
            p('M128 161Q79 139  90 106Q124 104 128 137Q131 85 165  80 Q186 121 139 157Z', 'leaf', ink, 4)
            line('M128 177V124M128 149L107 127M129 135L154 105', '#316f67', 4)
            line('M83 104Q82  70 107  60', ice, 6)
            p('M55 171H201L192 203H64Z', 'chrome', ink, 5)
            p('M71 203H185L176 219H80Z', '#34475f', ink, 4)
            line('M83 184H105M151 184H173', cyan, 5)
            e(128, 188, 8, 8, mint, ink, 3)
            break
        case 'seven':
            p('M40 55L204 43 213 85 126 219 74 219 146 100 45 113Z', '#bc512e', ink, 7)
            p('M39 40L200 30 209 70 116 205H70L145 86 44 99Z', 'plasma', '#ffe3b2', 3)
            p('M50 48L192 39 197 55 54 70Z', '#ffe1a1', 'none', 0)
            p('M146 86L190  70 108 196H85Z', '#ef794b', 'none', 0)
            line('M35 149L71 128M188 134L218 115M154 196L189 174', gold, 5)
            star(208, 194, 13, gold)
            break
        case 'diamond':
            // A cut xenium gemstone, with alternating reflective facets.
            p('M40 91L77 45H179L218 91 128 218Z', 'violet', '#efd2ff', 5)
            p('M40 91L128 218 84 91Z', '#713daf', 'none', 0)
            p('M84 91L128 218 128 91Z', 'violet', 'none', 0)
            p('M128 91L128 218 174 91Z', '#d8b4ff', 'none', 0)
            p('M174 91L128 218 218 91Z', '#673894', 'none', 0)
            p('M77 45L84 91 128 45Z', '#fceaff', 'none', 0)
            p('M128 45L174 91 179 45Z', '#efd7ff', 'none', 0)
            p('M84 91L128 45 174 91Z', 'violet', 'none', 0)
            line('M42 91H216M77 45L84 91 128 218 174 91 179 45M84 91L128 45 174 91', '#f0ceff', 2)
            line('M52 82L82 52H114', ice, 4)
            star(207,  40, 16)
            star( 50, 168, 12)
            break
        case 'wild':
            hex(116, 'panel', mint, 6)
            hex(103, '#192b31', '#66965e', 2)
            e(128, 104, 70, 70, 'glass', '#a4c2cf', 7)
            p('M 80  80 Q101  40 141  40 Q97  30  70  70Z', ice, 'none', 0)
            alien(128, 99, 1)
            p('M 30 171H226L217 226H39Z', 'panel', mint, 4)
            text('WILD', 128, 199, 39, ink, 2.6)
            text('WILD', 128, 199, 39, 'badge-lime', 1.7)
            line('M41 93V 70 M215 93V 70', mint, 7)
            break
        case 'bonus':
            // A visibly different architecture: an open portal in a hard frame.
            p('M64 15H192L232 55V194L192 235H64L24 194V55Z', 'panel', purple, 6)
            e(128, 108, 70, 80, 'violet', '#ead7ff', 6)
            e(128, 108, 58, 68, '#38285f', '#5e428a', 6)
            e(128, 108, 48, 58, 'glow-violet', 'none', 0)
            for (let arm = 0; arm < 4; arm++) {
                const edge = (t: number, side: number) => {
                    const a = arm * Math.PI / 2 + t * 4.4
                    const r = 5 + t * 48 + side * (2 + t * 4)
                    return `${128 + Math.cos(a) * r},${108 + Math.sin(a) * r * 1.15}`
                }
                const points = Array.from({ length: 25 }, (_, i) => edge(i / 24, 1))
                points.push(...Array.from({ length: 25 }, (_, i) => edge(1 - i / 24, -1)))
                p(`M${points.join('L')}Z`, arm % 2 ? '#efcbff' : '#b892ff', 'none', 0)
            }
            star(128, 108, 15)
            line('M99 64Q65 95 95 143M157 54Q195  90 165 146', ice, 4)
            for (const [x, y] of [[128, 26], [59, 106], [197, 106], [128, 187]] as const) p(`M${x} ${y - 8}l8 8-8 8-8-8Z`, cyan, ink, 3)
            p('M19 185H237L227 233H29Z', 'panel', purple, 4)
            text('BONUS', 128, 209, 33, ink, 2.6)
            text('BONUS', 128, 209, 33, 'badge-violet', 1.7)
            break
        case 'coin-bronze':
        case 'coin-silver':
        case 'coin-gold':
        case 'coin-xenium': {
            const tier = id.slice(5)
            const styles: Record<string, [string, string, number]> = {
                bronze: ['#dba079', '#513b39', 1], silver: ['#d2e5ec', '#344f64', 2], gold: [gold, '#695035', 3], xenium: [mint, '#325848', 4]
            }
            const [rim, face, rank] = styles[tier]!
            e(128, 134, 103, 103, face, ink, 6)
            e(128, 125, 103, 103, `metal-${tier}`, ink, 6)
            e(128, 125, 83, 83, face, ink, 4)
            e(128, 125, 70, 70, 'none', rim, 2)
            // Keep the center empty for the live coin amount rendered by Pixi.
            for (let i = 0; i < 12; i++) {
                const a = i * Math.PI / 6
                line(`M${128 + Math.cos(a) * 91} ${125 + Math.sin(a) * 91}L${128 + Math.cos(a) * 97} ${125 + Math.sin(a) * 97}`, face, 3)
            }
            for (let i = 0; i < rank; i++) {
                const x = 128 + (i - (rank - 1) / 2) * 18
                p(`M${x}  60 l5 6-5 6-5-6Z`, rim, 'none', 0)
            }
            line('M53 80Q77 42 114 35', ice, 5)
            break
        }
        case 'ufo':
        case 'ufo-on': {
            const on = id === 'ufo-on'
            if (on) {
                p('M 90 143H166L220 228Q128 255 36 228Z', '#84edbe40', 'none', 0)
                p('M110 146H146L177 229H79Z', '#afffc650', 'none', 0)
                line('M98 180L88 212M157 180L168 212', mint, 3)
            }
            e(128, 159, 50, 20, '#324864', ink, 5)
            e(128, 162, 35, 11, on ? '#dfffad' : '#67a89c', ink, 3)
            p('M 60 114Q 60  40 128  40 Q196  40 196 114Z', 'glass', '#90d6e0', 5)
            alien(128, 83, 0.52)
            line('M76 87Q79  60 101 55', ice, 5)
            p('M24 123Q39  90 128  90 Q217  90 232 123L213 143Q128 172 43 143Z', 'chrome', ink, 6)
            p('M24 123Q128 155 232 123L213 143Q128 172 43 143Z', '#49617b', ink, 4)
            e(128, 112, 86, 18, 'chrome', ink, 3)
            // Repaint the canopy's lower edge above the saucer deck.
            p('M69 106Q128 123 187 106', 'none', '#7fd6d4', 5)
            for (const x of [50, 80, 128, 176, 206]) e(x, 132 + (1 - Math.abs(x - 128) / 80) * 10, 7, 5, on ? mint : cyan, ink, 2)
            if (on) star(40, 75, 10, mint)
            break
        }
        case 'core-2':
        case 'core-5':
        case 'core-10': {
            const mult = id.slice(5)
            const color = mult === '10' ? gold : mult === '5' ? purple : cyan
            p('M128 14L242 128 128 242 14 128Z', 'panel', color, 6)
            p('M128 36L220 128 128 220 36 128Z', '#14243b', '#5c748c', 3)
            p('M90  30 L128  60 166 30 M 90 226L128 196 166 226', 'none', color, 6)
            e(128, 128, 60, 60, 'glass', color, 4)
            text(`×${mult}`, 128, 128, mult === '10' ? 39 :  50, ice)
            break
        }
    }
    return shapes
}

export function paintXenoVector(ctx: CanvasRenderingContext2D, id: XenoArtId) {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const shape of illustration(id)) {
        ctx.save()
        if (shape.transform) {
            const [x, y, scale] = shape.transform
            ctx.translate(x, y)
            ctx.scale(scale, scale)
        }
        const path = new Path2D(shape.d)
        if (shape.fill !== 'none') {
            ctx.fillStyle = paintColor(ctx, shape.fill)
            ctx.fill(path)
        }
        if (shape.stroke !== 'none' && shape.width) {
            ctx.strokeStyle = paintColor(ctx, shape.stroke)
            ctx.lineWidth = shape.width
            ctx.stroke(path)
        }
        ctx.restore()
    }
    ctx.restore()
}

export function xenoVectorSvg(id: XenoArtId, px: number): string {
    const defs = Object.entries(gradients).map(([name, g]) => {
        const tag = g.radial ? 'radialGradient' : 'linearGradient'
        const coords = g.radial ? `cx="128" cy="128" fx="110" fy="90" r="${g.height}"` : `x1="0" y1="0" x2="0" y2="${g.height}"`
        return `<${tag} id="${name}" gradientUnits="userSpaceOnUse" ${coords}>${g.stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('')}</${tag}>`
    }).join('')
    const color = (value: string) => gradients[value] ? `url(#${value})` : value
    const paths = illustration(id).map((s) => {
        const transform = s.transform ? ` transform="translate(${s.transform[0]} ${s.transform[1]}) scale(${s.transform[2]})"` : ''
        return `<path d="${s.d}" fill="${color(s.fill)}" stroke="${color(s.stroke)}" stroke-width="${s.width}"${transform}/>`
    }).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 256 256"><defs>${defs}</defs><g stroke-linejoin="round" stroke-linecap="round">${paths}</g></svg>`
}
