import * as THREE from 'three'

/* Graded-slab geometry, materials and label painters.
 *
 * The shell/air/environment construction is adapted from pokemonplaatjes
 * demo/slab.html (the TAG-style slab): real extruded geometry with a
 * transmissive-looking physical material, an environment of strip lights to
 * reflect, and a canvas-painted label. That demo is the GAG design here;
 * PSI, CCC and BRK get their own label painters and shell parameters,
 * each modelled on the real-world service they parody.
 */

export type TcgServiceKey = 'PSI' | 'CCC' | 'GAG' | 'BRK'

export interface SlabInfo {
    /** Card description lines, top of the label (name, year/series, set…). */
    lines: string[]
    /** Card number within the set, e.g. "077/131" — PSI shows it as #077. */
    cardNumber?: string
    grade: string
    gradeText: string
    /** BRK/CCC: the four category sub-grades, already formatted. */
    subgrades?: { centering: string, corners: string, edges: string, surface: string }
    /** GAG: the 1000-point fine score, e.g. "985". */
    score?: string
    /** Designation label when awarded — "Pristine", "Black Label"… */
    designation?: string | null
    serial: string
    /** Deterministic seed for the barcode / code block. */
    seed: string
}

type LabelPainter = (c: CanvasRenderingContext2D, W: number, h: number, info: SlabInfo) => void

export interface SlabDesign {
    labelH: number
    thick: number
    margin: number
    /** Shell corner radius: BRK is square-cornered, GAG softly rounded. */
    cornerR: number
    /** Edge bevel as a fraction of thickness — the roll that carries the
     *  highlights. BRK's crisp square case gets a much smaller one. */
    bevel: number
    /** Moulded wordmark letters in the clear strip below the card (GAG only). */
    wordmark: boolean
    /** Inner holder around the card + label windows: CCC's opaque black
     *  well, or PSI's frosted white holder with a clear viewing window. */
    innerFrame: 'black' | 'frost' | null
    /** How close the card + label sit to the front face. PSA-style holders
     *  press the card right up against the glass. */
    cardZ: number
    paintLabel: LabelPainter
    paintLabelBack: LabelPainter
}

/* ---- shared 2D helpers -------------------------------------------------- */

export function roundedRect(w: number, h: number, r: number): THREE.Shape {
    const s = new THREE.Shape()
    const x = -w / 2, y = -h / 2
    s.moveTo(x + r, y)
    s.lineTo(x + w - r, y)
    s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
    s.lineTo(x + w, y + h - r)
    s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
    s.lineTo(x + r, y + h)
    s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
    s.lineTo(x, y + r)
    s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
    return s
}

function hashOf(s: string): number {
    let h = 0
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0
    return Math.abs(h)
}

/** Decorative barcode: deterministic bar widths from the seed. */
function barcode(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: string, ink = '#000') {
    let s = hashOf(seed) >>> 0
    c.fillStyle = ink
    let px = x
    while (px < x + w) {
        s = (s * 1103515245 + 12345) >>> 0
        const bar = 2 + ((s >>> 16) % 5)
        s = (s * 1103515245 + 12345) >>> 0
        const gap = 2 + ((s >>> 16) % 4)
        c.fillRect(px, y, Math.min(bar, x + w - px), h)
        px += bar + gap
    }
}

/** The TAG-style deterministic code block (decorative, not scannable). */
function codeBlock(c: CanvasRenderingContext2D, qx: number, qy: number, qs: number, seedStr: string) {
    const cells = 13
    c.fillStyle = '#fff'
    c.fillRect(qx - 6, qy - 6, qs + 12, qs + 12)
    c.fillStyle = '#000'
    let seed = 0
    for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
    const cell = qs / cells
    for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
            seed = (seed * 1103515245 + 12345) >>> 0
            const corner = (i < 4 && j < 4) || (i < 4 && j > cells - 5) || (i > cells - 5 && j < 4)
            const on = corner
                ? !((i % 3 === 1 && j > 0 && j < 3) || (j % 3 === 1 && i > 0 && i < 3))
                : (seed >>> 16) % 2 === 0
            if (on) c.fillRect(qx + j * cell, qy + i * cell, cell + 0.5, cell + 0.5)
        }
    }
}

/* ---- label painters ------------------------------------------------------ */

/* PSI — Pristine Slab Institute. Modelled on the classic PSA label: a red
 * surround with a white panel, three caps lines of card info on the left, the
 * number / grade text / big grade / cert stacked on the right, a barcode
 * bottom-left and the blue wordmark plate bottom-centre.
 */
const paintPSI: LabelPainter = (c, W, h, info) => {
    // Per the reference photo: a white label with a thin red frame ring
    // running just inside the edge, not a red surround.
    const RED = '#dc2c34'
    c.fillStyle = '#fdfdfb'
    c.fillRect(0, 0, W, h)
    const INSET = Math.round(h * 0.055)
    c.strokeStyle = RED
    c.lineWidth = Math.max(4, Math.round(h * 0.028))
    c.strokeRect(INSET, INSET, W - INSET * 2, h - INSET * 2)

    const PAD = INSET + 26
    const LINE = Math.round(h * 0.155)
    const TEXT_PX = Math.round(h * 0.115)
    c.fillStyle = '#111'
    c.textAlign = 'left'
    c.textBaseline = 'top'
    c.font = `700 ${TEXT_PX}px system-ui, sans-serif`
    let y = PAD - 4
    for (const line of info.lines.slice(0, 3)) {
        c.fillText(line.toUpperCase(), PAD, y, Math.round(W * 0.62))
        y += LINE
    }

    // Right column, right-aligned: number, grade text, grade, cert.
    const R = W - PAD
    c.textAlign = 'right'
    c.font = `700 ${TEXT_PX}px system-ui, sans-serif`
    let ry = PAD - 4
    if (info.cardNumber) {
        c.fillText(`#${info.cardNumber}`, R, ry)
        ry += LINE
    }
    c.fillText(info.gradeText.toUpperCase(), R, ry)
    ry += LINE
    c.font = `700 ${Math.round(h * 0.17)}px system-ui, sans-serif`
    c.fillText(info.grade, R, ry - 2)
    ry += Math.round(h * 0.185)
    c.font = `600 ${Math.round(TEXT_PX * 0.92)}px system-ui, sans-serif`
    c.fillText(info.serial, R, ry)

    barcode(c, PAD, h - PAD - Math.round(h * 0.11), Math.round(W * 0.24), Math.round(h * 0.105), info.seed)

    // The wordmark plate: white italic caps on a blue parallelogram with the
    // red swoosh underlining it.
    const bw = Math.round(W * 0.135), bh = Math.round(h * 0.155)
    const bx = W / 2 - bw / 2, byy = h - PAD - bh + 6
    c.save()
    c.beginPath()
    const skew = bh * 0.35
    c.moveTo(bx + skew, byy)
    c.lineTo(bx + bw, byy)
    c.lineTo(bx + bw - skew, byy + bh)
    c.lineTo(bx, byy + bh)
    c.closePath()
    c.fillStyle = '#1d3f94'
    c.fill()
    c.fillStyle = '#fff'
    c.font = `800 italic ${Math.round(bh * 0.78)}px system-ui, sans-serif`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('PSI', bx + bw / 2, byy + bh / 2 + 1)
    c.fillStyle = RED
    c.fillRect(bx - 8, byy + bh + 3, bw + 16, Math.max(3, Math.round(bh * 0.1)))
    c.restore()
}

const paintPSIBack: LabelPainter = (c, W, h, info) => {
    c.fillStyle = '#fdfdfb'
    c.fillRect(0, 0, W, h)
    c.fillStyle = '#dc2c34'
    c.fillRect(0, 0, W, Math.round(h * 0.085))
    c.fillRect(0, h - Math.round(h * 0.085), W, Math.round(h * 0.085))
    c.fillStyle = '#1d3f94'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = `800 italic ${Math.round(h * 0.26)}px system-ui, sans-serif`
    c.fillText('PSI', W / 2, h / 2 - h * 0.1)
    c.fillStyle = '#333'
    c.font = `500 ${Math.round(h * 0.11)}px ui-monospace, monospace`
    c.fillText(info.serial, W / 2, h / 2 + h * 0.16)
}

/* CCC — Cardboard Certification Consortium. Modelled on the CGC Cards label:
 * a black band across the top carrying the logo and the full company name,
 * a brushed-silver panel below with the card lines on the left, a divider,
 * and the grade text over a huge grade on the right; barcode + cert centred
 * at the bottom. A "Pristine" designation turns the accents gold.
 */
const paintCCC: LabelPainter = (c, W, h, info) => {
    const gold = !!info.designation
    c.fillStyle = '#0b0b0d'
    c.fillRect(0, 0, W, h)

    const bandH = Math.round(h * 0.24)
    c.fillStyle = gold ? '#e5c05a' : '#fff'
    c.textBaseline = 'middle'
    c.textAlign = 'left'
    c.font = `800 ${Math.round(bandH * 0.62)}px system-ui, sans-serif`
    c.letterSpacing = '2px'
    c.fillText('◆CCC', 40, bandH / 2 + 2)
    c.textAlign = 'right'
    c.font = `600 ${Math.round(bandH * 0.30)}px system-ui, sans-serif`
    c.letterSpacing = '4px'
    c.fillText('CARDBOARD CERTIFICATION CONSORTIUM', W - 40, bandH / 2 + 2)
    c.letterSpacing = '0px'

    // Brushed panel: silver normally, gold metallic for a Pristine label.
    const px = 22, py = bandH + 6, pw = W - px * 2, ph = h - py - 22
    const grad = c.createLinearGradient(0, py, 0, py + ph)
    if (gold) {
        grad.addColorStop(0, '#c3a04c')
        grad.addColorStop(0.35, '#efd898')
        grad.addColorStop(0.65, '#dcbf70')
        grad.addColorStop(1, '#b28d3e')
    } else {
        grad.addColorStop(0, '#dde0e5')
        grad.addColorStop(0.35, '#fafbfc')
        grad.addColorStop(0.65, '#eef0f3')
        grad.addColorStop(1, '#d3d6db')
    }
    c.fillStyle = grad
    c.fillRect(px, py, pw, ph)

    const PAD = px + 26
    const LINE = Math.round(ph * 0.21)
    c.fillStyle = '#101014'
    c.textAlign = 'left'
    c.textBaseline = 'top'
    let y = py + Math.round(ph * 0.10)
    c.font = `700 ${Math.round(ph * 0.16)}px system-ui, sans-serif`
    for (const [i, line] of info.lines.slice(0, 4).entries()) {
        if (i === 1) c.font = `500 ${Math.round(ph * 0.14)}px system-ui, sans-serif`
        c.fillText(line, PAD, y, Math.round(W * 0.66))
        y += LINE
    }

    // The grade block. Pristine gets the CGC treatment: embossed gold type
    // inside an outlined frame on the gold panel; otherwise a plain divider
    // and black type on the silver.
    const divX = W - Math.round(W * 0.235)
    const gx = (divX + (W - px)) / 2
    c.textAlign = 'center'
    if (gold) {
        const fx = divX + 8, fy = py + Math.round(ph * 0.05)
        const fw = (W - px) - fx - 10, fh = Math.round(ph * 0.78)
        c.strokeStyle = '#8a6a12'
        c.lineWidth = 4
        c.strokeRect(fx, fy, fw, fh)
        const emboss = (text: string, font: string, x: number, y: number) => {
            c.font = font
            c.fillStyle = '#fdf3cf'
            c.fillText(text, x, y - 2)
            c.fillStyle = '#7a5c0e'
            c.fillText(text, x, y)
        }
        c.textBaseline = 'top'
        emboss((info.designation ?? info.gradeText).toUpperCase(),
            `700 ${Math.round(ph * 0.145)}px system-ui, sans-serif`, gx, fy + Math.round(ph * 0.06))
        emboss(info.grade, `800 ${Math.round(ph * 0.50)}px system-ui, sans-serif`,
            gx, fy + Math.round(ph * 0.22))
    } else {
        c.strokeStyle = '#5c5f66'
        c.lineWidth = 3
        c.beginPath()
        c.moveTo(divX, py + ph * 0.12)
        c.lineTo(divX, py + ph * 0.74)
        c.stroke()
        c.fillStyle = '#101014'
        c.font = `700 ${Math.round(ph * 0.145)}px system-ui, sans-serif`
        c.letterSpacing = '2px'
        c.fillText(info.gradeText.toUpperCase(), gx, py + Math.round(ph * 0.08))
        c.letterSpacing = '0px'
        c.font = `800 ${Math.round(ph * 0.52)}px system-ui, sans-serif`
        c.fillText(info.grade, gx, py + Math.round(ph * 0.24))
    }

    barcode(c, W / 2 - Math.round(W * 0.11), py + ph - Math.round(ph * 0.155), Math.round(W * 0.15), Math.round(ph * 0.12), info.seed, '#101014')
    c.fillStyle = '#101014'
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    c.font = `500 ${Math.round(ph * 0.115)}px ui-monospace, monospace`
    c.fillText(info.serial, W / 2 + Math.round(W * 0.055), py + ph - Math.round(ph * 0.095))
}

const paintCCCBack: LabelPainter = (c, W, h, info) => {
    c.fillStyle = '#0b0b0d'
    c.fillRect(0, 0, W, h)
    c.strokeStyle = '#2a2a30'
    c.lineWidth = 3
    c.strokeRect(14, 14, W - 28, h - 28)
    c.fillStyle = '#8f939c'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = `800 ${Math.round(h * 0.2)}px system-ui, sans-serif`
    c.letterSpacing = '6px'
    c.fillText('◆CCC', W / 2, h / 2 - h * 0.1)
    c.letterSpacing = '2px'
    c.font = `500 ${Math.round(h * 0.1)}px ui-monospace, monospace`
    c.fillText(info.serial, W / 2, h / 2 + h * 0.14)
    c.letterSpacing = '0px'
}

/* BRK — Brackett & Co. Modelled on the BGS label, tier and all: a brushed
 * silver label below 9.5, brushed gold at 9.5, and the black label with gold
 * text for the Black Label 10. Laurelled "B" plate on the left, card lines
 * and the four sub-grades in the middle, the huge grade on the right.
 */
const paintBRK: LabelPainter = (c, W, h, info) => {
    // Tiers per the reference photos: a 10 is always the black label with
    // gold type (Black Label just changes the designation text), 9.5 is the
    // brushed gold label, below that brushed silver.
    const gradeNum = parseFloat(info.grade)
    const black = info.designation === 'Black Label' || gradeNum >= 10
    const goldTier = !black && gradeNum >= 9.5
    let ink: string
    if (black) {
        c.fillStyle = '#0a0a0c'
        c.fillRect(0, 0, W, h)
        ink = '#d8b84e'
    } else {
        const grad = c.createLinearGradient(0, 0, 0, h)
        if (goldTier) {
            grad.addColorStop(0, '#b28f3a')
            grad.addColorStop(0.35, '#e8cd82')
            grad.addColorStop(0.65, '#cfae58')
            grad.addColorStop(1, '#a5822f')
        } else {
            grad.addColorStop(0, '#b6bac1')
            grad.addColorStop(0.35, '#eceef1')
            grad.addColorStop(0.65, '#d4d7dc')
            grad.addColorStop(1, '#a6aab2')
        }
        c.fillStyle = grad
        c.fillRect(0, 0, W, h)
        ink = '#141416'
    }

    // The logo plate: a "B" inside pseudo-laurels, wordmark under it. On the
    // black label the logo stays silver while the type goes gold.
    const LX = Math.round(W * 0.115)
    c.fillStyle = black ? '#dfe2e8' : ink
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = `800 ${Math.round(h * 0.34)}px Georgia, serif`
    c.fillText('(B)', LX, h * 0.40)
    c.font = `700 ${Math.round(h * 0.105)}px system-ui, sans-serif`
    c.letterSpacing = '1px'
    c.fillText('BRACKETT®', LX, h * 0.68)
    c.letterSpacing = '0px'
    c.fillStyle = ink

    // Card lines, then the sub-grade rows. Kept clear of the grade block on
    // the right via a hard maxWidth — a long set name must squeeze, not run
    // under the big grade digits.
    const TX = Math.round(W * 0.235)
    const MAXW = Math.round(W * 0.50)
    const TEXT_PX = Math.round(h * 0.105)
    c.textAlign = 'left'
    c.textBaseline = 'top'
    c.font = `700 ${TEXT_PX}px system-ui, sans-serif`
    let y = Math.round(h * 0.10)
    for (const line of info.lines.slice(0, 3)) {
        c.fillText(line.toUpperCase(), TX, y, MAXW)
        y += Math.round(h * 0.135)
    }
    if (info.subgrades) {
        const sg = info.subgrades
        const rows: Array<Array<[string, string]>> = [
            [['CENTERING', sg.centering], ['CORNERS', sg.corners]],
            [['EDGES', sg.edges], ['SURFACE', sg.surface]]
        ]
        const CPX = Math.round(h * 0.095)
        y += Math.round(h * 0.02)
        for (const row of rows) {
            let x = TX
            for (const [label, value] of row) {
                c.font = `700 ${CPX}px system-ui, sans-serif`
                c.fillText(label, x, y)
                c.font = `800 ${CPX}px system-ui, sans-serif`
                c.fillText(value, x + Math.round(W * 0.185), y)
                x += Math.round(W * 0.265)
            }
            y += Math.round(h * 0.125)
        }
    }

    // Grade block on the right.
    const R = W - Math.round(W * 0.03)
    c.textAlign = 'right'
    c.textBaseline = 'top'
    c.font = `800 ${Math.round(h * 0.46)}px system-ui, sans-serif`
    c.fillText(info.grade, R, Math.round(h * 0.08))
    c.font = `700 ${Math.round(h * 0.115)}px system-ui, sans-serif`
    c.letterSpacing = '2px'
    // Always the grade text: "Black Label" is the collector nickname for the
    // all-tens black label — the label itself still prints PRISTINE.
    c.fillText(info.gradeText.toUpperCase(), R, Math.round(h * 0.60), Math.round(W * 0.23))
    c.letterSpacing = '0px'
    c.font = `500 ${Math.round(h * 0.10)}px ui-monospace, monospace`
    c.fillText(info.serial, R, Math.round(h * 0.78))
}

const paintBRKBack: LabelPainter = (c, W, h, info) => {
    c.fillStyle = '#0a0a0c'
    c.fillRect(0, 0, W, h)
    c.fillStyle = '#6a6a74'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = `800 ${Math.round(h * 0.22)}px Georgia, serif`
    c.fillText('(B)', W / 2, h / 2 - h * 0.12)
    c.font = `500 ${Math.round(h * 0.1)}px ui-monospace, monospace`
    c.letterSpacing = '2px'
    c.fillText(info.serial, W / 2, h / 2 + h * 0.16)
    c.letterSpacing = '0px'
}

/* GAG — Grading & Authentication Guild. The TAG-style label from slab.html,
 * verbatim in spirit: black, a fine white rule inset from the edge, the
 * wordmark in a notch straddling the top rule, card lines left, grade right,
 * the deterministic code block, and the serial set vertically. GAG's own
 * addition is the 1000-point score under the grade text.
 */
const paintGAG: LabelPainter = (c, W, h, info) => {
    const INSET = 32, RULE = 5
    c.fillStyle = '#000'
    c.fillRect(0, 0, W, h)
    c.strokeStyle = '#e9e9ee'
    c.lineWidth = RULE
    c.strokeRect(INSET, INSET, W - INSET * 2, h - INSET * 2)

    const badgeW = 182, badgeH = 44, bx = (W - badgeW) / 2
    const by = INSET - badgeH / 2
    c.fillStyle = '#000'
    c.fillRect(bx - 12, 0, badgeW + 24, by + badgeH + 8)
    c.strokeStyle = '#e9e9ee'
    c.lineWidth = RULE
    c.strokeRect(bx, by, badgeW, badgeH)
    c.fillStyle = '#fff'
    c.font = '700 33px system-ui, sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.letterSpacing = '6px'
    c.fillText('GAG', W / 2, by + badgeH / 2 + 1)
    c.letterSpacing = '0px'

    const bandMid = h / 2
    const LINE = 32, TEXT_PX = 25
    c.textAlign = 'left'
    c.textBaseline = 'top'
    c.fillStyle = '#fff'
    c.font = `600 ${TEXT_PX}px system-ui, sans-serif`
    let y = bandMid - (info.lines.length * LINE) / 2
    for (const line of info.lines) {
        c.fillText(line.toUpperCase(), 54, y)
        y += LINE
    }

    const GRADE_RIGHT = W - 54, CAP_PX = 19, CAP_GAP = 9
    const gradePx = Math.round(h * 0.44)
    c.textAlign = 'right'
    c.textBaseline = 'alphabetic'
    c.font = `700 ${gradePx}px system-ui, sans-serif`
    const gm = c.measureText(info.grade)
    const gradeCap = gm.actualBoundingBoxAscent
    const gradeTop = bandMid - (gradeCap + CAP_GAP + CAP_PX) / 2
    c.fillText(info.grade, GRADE_RIGHT, gradeTop + gradeCap)
    c.textAlign = 'center'
    c.textBaseline = 'top'
    c.font = `600 ${CAP_PX}px system-ui, sans-serif`
    c.letterSpacing = '2px'
    const capText = (info.designation ?? info.gradeText).toUpperCase()
    c.fillText(capText, GRADE_RIGHT - gm.width / 2, gradeTop + gradeCap + CAP_GAP)
    c.letterSpacing = '0px'

    const qs = Math.round(h * 0.33)
    const qx = GRADE_RIGHT - gm.width - 40 - qs
    const qy = Math.round(bandMid - qs / 2)
    codeBlock(c, qx, qy, qs, info.seed)
    // The 1000-point score sits inside the code block, TAG-style: a white
    // window punched through the middle of the pattern.
    if (info.score) {
        c.font = `700 ${Math.round(qs * 0.26)}px system-ui, sans-serif`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        const sw = Math.max(c.measureText(info.score).width + 16, qs * 0.5)
        const sh = Math.round(qs * 0.32)
        c.fillStyle = '#fff'
        c.fillRect(qx + (qs - sw) / 2, qy + (qs - sh) / 2, sw, sh)
        c.fillStyle = '#000'
        c.fillText(info.score, qx + qs / 2, qy + qs / 2 + 1)
    }

    c.save()
    c.translate(qx - 20, qy + qs / 2)
    c.rotate(-Math.PI / 2)
    c.fillStyle = '#fff'
    c.font = '500 18px ui-monospace, monospace'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.letterSpacing = '2px'
    c.fillText(info.serial, 0, 0)
    c.restore()
}

const paintGAGBack: LabelPainter = (c, W, h, info) => {
    c.fillStyle = '#08080a'
    c.fillRect(0, 0, W, h)
    c.strokeStyle = '#22222a'
    c.lineWidth = 3
    c.strokeRect(14, 14, W - 28, h - 28)
    c.fillStyle = '#4a4a56'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = '700 34px system-ui, sans-serif'
    c.letterSpacing = '8px'
    c.fillText('GAG', W / 2, h / 2 - 18)
    c.letterSpacing = '2px'
    c.font = '500 18px ui-monospace, monospace'
    c.fillText(info.serial, W / 2, h / 2 + 22)
    c.letterSpacing = '0px'
}

/* ---- the four designs ---------------------------------------------------- */

export const SLAB_DESIGNS: Record<TcgServiceKey, SlabDesign> = {
    // PSA-style: chunkier shell, shorter label.
    PSI: { labelH: 0.30, thick: 0.038, margin: 0.088, cornerR: 0.04, bevel: 0.20, wordmark: false, innerFrame: 'frost', cardZ: 0.006, paintLabel: paintPSI, paintLabelBack: paintPSIBack },
    // CGC-style: crystal shell with the black inner well.
    CCC: { labelH: 0.32, thick: 0.046, margin: 0.092, cornerR: 0.06, bevel: 0.42, wordmark: false, innerFrame: 'black', cardZ: 0.002, paintLabel: paintCCC, paintLabelBack: paintCCCBack },
    // TAG-style: slim shell, moulded wordmark.
    GAG: { labelH: 0.35, thick: 0.044, margin: 0.082, cornerR: 0.07, bevel: 0.42, wordmark: true, innerFrame: null, cardZ: 0.002, paintLabel: paintGAG, paintLabelBack: paintGAGBack },
    // BGS-style: the thickest shell of the four.
    BRK: { labelH: 0.32, thick: 0.050, margin: 0.095, cornerR: 0.005, bevel: 0.16, wordmark: false, innerFrame: null, cardZ: 0.002, paintLabel: paintBRK, paintLabelBack: paintBRKBack }
}

/* ---- environment (verbatim from slab.html) ------------------------------- */

export function buildSlabEnvironment(renderer: THREE.WebGLRenderer, lamp = 1): THREE.Texture {
    const env = new THREE.Scene()
    env.background = new THREE.Color(0x000000)

    const wall = (color: number, w: number, h: number, pos: [number, number, number], rot: [number, number, number] | null, gain = 1) => {
        const m = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            new THREE.MeshBasicMaterial({
                color: new THREE.Color(color).multiplyScalar(gain),
                side: THREE.DoubleSide
            }))
        m.position.set(...pos)
        if (rot) m.rotation.set(...rot)
        env.add(m)
    }

    wall(0xffffff, 2.0, 1.3, [-4.5, 4.5, 3.5], [Math.PI / 3.2, Math.PI / 4.5, 0], 2.0 * lamp)
    wall(0xffffff, 0.40, 8.0, [-2.6, 1.5, 5.0], [0, 0.30, 0.16], 2.6 * lamp)
    wall(0xeaf0ff, 0.26, 6.0, [2.4, 0.5, 5.0], [0, -0.34, -0.10], 2.4 * lamp)
    wall(0xc8d6ff, 5.0, 0.30, [0, -2.6, 4.5], [0.22, 0, 0], 1.6 * lamp)
    wall(0xffffff, 0.18, 4.0, [0.9, 2.6, 5.2], [0, -0.12, 0.55], 2.6 * lamp)
    wall(0xffffff, 0.16, 14.0, [-1.1, 0.6, 6.0], [0, 0.10, -0.85], 2.4 * lamp)
    wall(0xdfe8ff, 0.11, 14.0, [1.25, -0.2, 6.0], [0, -0.10, 0.30], 1.7 * lamp)
    wall(0x0d1120, 3, 4, [6, 0.5, -1], [0, -Math.PI / 2.4, 0])
    wall(0x05050a, 14, 14, [0, -6, 0], [-Math.PI / 2, 0, 0])
    wall(0x0b0b12, 14, 14, [0, 7, 0], [Math.PI / 2, 0, 0])

    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    const target = pmrem.fromScene(env, 0.02)
    pmrem.dispose()
    return target.texture
}

/* ---- shell + air + inner frame ------------------------------------------ */

export interface SlabLayout {
    slabW: number
    slabH: number
    thick: number
    cornerR: number
    bevel: number
    cardZ: number
    cardY: number
    labelY: number
    labelH: number
    cardW: number
    cardH: number
}

export function slabLayout(design: SlabDesign, cardAspect: number): SlabLayout {
    const cardW = 1, cardH = 1 / cardAspect
    const TOP = 0.075, BOTTOM = 0.075, GAP = 0.055
    const slabW = cardW + design.margin * 2
    const slabH = TOP + design.labelH + GAP + cardH + BOTTOM
    return {
        slabW, slabH,
        thick: design.thick,
        cornerR: design.cornerR,
        bevel: design.bevel,
        cardZ: design.cardZ,
        cardY: -(slabH / 2) + BOTTOM + cardH / 2,
        labelY: (slabH / 2) - TOP - design.labelH / 2,
        labelH: design.labelH,
        cardW, cardH
    }
}

/** Additive blending that adds light without touching destination alpha. */
function applyAdditiveColourOnly(mat: THREE.Material): void {
    mat.blending = THREE.CustomBlending
    mat.blendEquation = THREE.AddEquation
    mat.blendSrc = THREE.SrcAlphaFactor
    mat.blendDst = THREE.OneFactor
    mat.blendEquationAlpha = THREE.AddEquation
    mat.blendSrcAlpha = THREE.ZeroFactor
    mat.blendDstAlpha = THREE.OneFactor
}

/** The clear shell + its additive glint pass. Returns meshes added to group. */
export function buildShell(group: THREE.Group, layout: SlabLayout): THREE.Object3D[] {
    const shellGeo = new THREE.ExtrudeGeometry(
        roundedRect(layout.slabW, layout.slabH, layout.cornerR), {
            depth: layout.thick, curveSegments: 64,
            bevelEnabled: true,
            bevelThickness: layout.thick * layout.bevel,
            bevelSize: layout.thick * layout.bevel,
            bevelOffset: 0, bevelSegments: 24
        })
    shellGeo.translate(0, 0, -layout.thick / 2)
    shellGeo.computeVertexNormals()

    const shellMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0, roughness: 0.02,
        clearcoat: 1, clearcoatRoughness: 0.02,
        ior: 1.49, reflectivity: 0.6, envMapIntensity: 2.2,
        transparent: true, opacity: 0.045,
        depthWrite: false, side: THREE.DoubleSide
    })
    const glintMat = new THREE.MeshPhysicalMaterial({
        color: 0x000000, metalness: 0, roughness: 0.015,
        clearcoat: 1, clearcoatRoughness: 0.015,
        ior: 1.49, reflectivity: 1.0, envMapIntensity: 2.6,
        transparent: true,
        depthWrite: false, side: THREE.DoubleSide
    })
    // Additive for colour, but hands off the alpha channel: the demo ran on a
    // black page, where the additive pass writing alpha 1 didn't matter — on a
    // lit page it turned the whole "clear" shell opaque black.
    applyAdditiveColourOnly(glintMat)
    const a = new THREE.Mesh(shellGeo, shellMat)
    const b = new THREE.Mesh(shellGeo, glintMat)
    group.add(a, b)
    return [a, b]
}

/** The air-gap panes either side of the card pocket. */
export function buildAirPanes(group: THREE.Group, layout: SlabLayout): void {
    const AIR = 0.0115
    const TOP = 0.075, BOTTOM = 0.075
    const airShape = roundedRect(
        layout.cardW + 0.024, layout.slabH - TOP - BOTTOM + 0.024, 0.07)
    const airGeo = new THREE.ShapeGeometry(airShape, 48)
    airGeo.translate(0, (layout.cardY - layout.cardH / 2 + layout.labelY + layout.labelH / 2) / 2, 0)
    const mid = layout.cardZ
    const airMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0,
        roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.03,
        ior: 1.49, reflectivity: 0.5, envMapIntensity: 1.3,
        transparent: true, opacity: 0.030,
        depthWrite: false, side: THREE.DoubleSide
    })
    for (const z of [mid + AIR, mid - AIR]) {
        const pane = new THREE.Mesh(airGeo, airMat)
        pane.position.z = z
        group.add(pane)
    }
}

/** A cloudy near-white texture for the frosted holder: soft blotches of
 *  slightly varied brightness over a bright base, like sandblasted acrylic. */
function frostTexture(): THREE.CanvasTexture {
    const S = 1024
    const cv = document.createElement('canvas')
    cv.width = cv.height = S
    const c = cv.getContext('2d')!
    // Per-pixel random relief: every pixel its own bump height, softened a
    // touch by one downscale/upscale round trip so the grain reads as a
    // sandblasted finish rather than raw pixel noise. Deterministic, so the
    // holder looks identical between mounts. mulberry32 with Math.imul —
    // a float multiply here loses bits past 2^53 and collapses the sequence
    // into a short cycle, which prints as a visibly repeating pattern.
    let seed = 0x5eed
    const rnd = () => {
        seed = (seed + 0x6D2B79F5) >>> 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const img = c.createImageData(S, S)
    for (let i = 0; i < img.data.length; i += 4) {
        const v = 96 + Math.round(rnd() * 96)
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
        img.data[i + 3] = 255
    }
    c.putImageData(img, 0, 0)
    const half = document.createElement('canvas')
    half.width = half.height = S / 2
    const hc = half.getContext('2d')!
    hc.imageSmoothingEnabled = true
    hc.drawImage(cv, 0, 0, S / 2, S / 2)
    c.imageSmoothingEnabled = true
    c.drawImage(half, 0, 0, S, S)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    // The extrude's UVs are raw shape units (about 1.2 × 1.7 across the
    // holder) — at repeat 1 the noise tiles visibly. One tile covering the
    // whole body keeps the grain non-repeating.
    tex.repeat.set(0.5, 0.5)
    return tex
}

/** The inner holder around the card + label windows. CCC's is an opaque
 *  black well; PSI's is a frosted white holder — cloudy everywhere except
 *  the clear viewing window over the card. */
export function buildInnerFrame(group: THREE.Group, layout: SlabLayout, kind: 'black' | 'frost'): void {
    let shape: THREE.Shape
    if (kind === 'black') {
        // Only the label region gets the black surround — the rest of a CGC
        // shell is clear. The black insert is a card-width unit with the
        // silver label showing through a window inset a little on every
        // side, so the black itself forms the frame.
        shape = new THREE.Shape()
        addTranslatedRoundedRect(shape, layout.cardW + 0.004, layout.labelH + 0.055, 0.05, 0, layout.labelY)
        const holeLabel = new THREE.Path()
        addTranslatedRoundedRect(holeLabel, layout.cardW - 0.055, layout.labelH - 0.04, 0.015, 0, layout.labelY)
        shape.holes.push(holeLabel)
    } else {
        // The shell's own outline; window holes are enlarged by the bevel
        // size, because the extrude's bevel rolls back INTO a hole and would
        // otherwise shrink the window over the card's edges.
        const bev = layout.thick * layout.bevel + 0.0015
        shape = roundedRect(layout.slabW, layout.slabH, layout.cornerR)
        const holeCard = new THREE.Path()
        addTranslatedRoundedRect(holeCard, layout.cardW + 0.012 + bev * 2, layout.cardH + 0.012 + bev * 2, 0.06, 0, layout.cardY)
        const holeLabel = new THREE.Path()
        addTranslatedRoundedRect(holeLabel, layout.cardW + 0.006 + bev * 2, layout.labelH + 0.006 + bev * 2, 0.02, 0, layout.labelY)
        shape.holes.push(holeCard, holeLabel)
    }
    const frameGeo = new THREE.ShapeGeometry(shape, 48)
    if (kind === 'frost') {
        // The pebbled finish lives on the OUTER shell surface — the case
        // itself is textured everywhere except the viewing windows, not a
        // separate frosted body floating inside clear plastic. Only the
        // grain speaks: an additive pass whose per-pixel bumps scatter the
        // room's light into granular sheen (the same trick the shell uses
        // for its reflections). Where no light catches, the page shows
        // straight through.
        const grain = frostTexture()
        // No clearcoat: its reflection uses an un-bumped normal of its own,
        // which lays a perfectly smooth uniform streak OVER the grain. All
        // shine must come through the bumped base normal, so every highlight
        // is broken up by the texture.
        const bumpGlint = new THREE.MeshPhysicalMaterial({
            color: 0x000000, metalness: 0,
            bumpMap: grain, bumpScale: 1.6,
            roughness: 0.5,
            ior: 1.49, reflectivity: 1.0, envMapIntensity: 2.8,
            transparent: true, depthWrite: false, side: THREE.FrontSide
        })
        applyAdditiveColourOnly(bumpGlint)
        // The outer shell's mirror streaks paint OVER this region — on real
        // textured plastic that smooth reflection doesn't exist, so a dim
        // pass multiplies the streaks down across the holder's footprint
        // (windows excluded) before the grain sparkle draws on top of it.
        const dimMat = new THREE.MeshBasicMaterial({
            color: 0x000000, transparent: true, opacity: 0.78,
            depthWrite: false, side: THREE.FrontSide
        })
        dimMat.blending = THREE.CustomBlending
        dimMat.blendEquation = THREE.AddEquation
        dimMat.blendSrc = THREE.ZeroFactor
        dimMat.blendDst = THREE.OneMinusSrcAlphaFactor
        dimMat.blendEquationAlpha = THREE.AddEquation
        dimMat.blendSrcAlpha = THREE.ZeroFactor
        dimMat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
        // One skin, not flat planes plus a ring: a copy of the shell's own
        // extruded geometry (same bevel roll), a hair proud of its surface,
        // carries dim + grain everywhere — faces, bevel roll and side wall
        // are one continuous textured surface, and the window holes get a
        // rolled edge from the same bevel.
        const bevelR = layout.thick * layout.bevel + 0.0015
        const skinDepth = layout.thick + 0.003
        const skinGeo = new THREE.ExtrudeGeometry(shape, {
            depth: skinDepth, curveSegments: 48,
            bevelEnabled: true,
            bevelThickness: bevelR, bevelSize: bevelR,
            bevelOffset: 0, bevelSegments: 12
        })
        skinGeo.translate(0, 0, -skinDepth / 2)
        skinGeo.computeVertexNormals()
        const skinDim = new THREE.Mesh(skinGeo, dimMat)
        skinDim.renderOrder = 11
        const skinGrain = new THREE.Mesh(skinGeo, bumpGlint)
        skinGrain.renderOrder = 12
        group.add(skinDim, skinGrain)
        return
    }
    const mat = new THREE.MeshStandardMaterial({
        color: 0x0a0a0c, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide
    })
    for (const z of [0.0155, -0.0155]) {
        const m = new THREE.Mesh(frameGeo, mat)
        m.position.z = z
        if (z < 0) m.rotation.y = Math.PI
        // The black insert draws late so it overlaps the label's edges and
        // frames the print the way the real cardboard unit does.
        m.renderOrder = 10
        group.add(m)
    }
}

function addTranslatedRoundedRect(p: THREE.Path, w: number, h: number, r: number, cx: number, cy: number) {
    const x = cx - w / 2, y = cy - h / 2
    p.moveTo(x + r, y)
    p.lineTo(x + w - r, y)
    p.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
    p.lineTo(x + w, y + h - r)
    p.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
    p.lineTo(x + r, y + h)
    p.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
    p.lineTo(x, y + r)
    p.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
}

/* ---- the GAG moulded wordmark (verbatim glyphs from slab.html) ----------- */

function poly(points: number[][], holes: number[][][] = []): THREE.Shape {
    const s = new THREE.Shape()
    s.moveTo(points[0]![0]!, points[0]![1]!)
    for (const [x, y] of points.slice(1) as Array<[number, number]>) s.lineTo(x, y)
    s.closePath()
    for (const hole of holes) {
        const hp = new THREE.Path()
        hp.moveTo(hole[0]![0]!, hole[0]![1]!)
        for (const [x, y] of hole.slice(1) as Array<[number, number]>) hp.lineTo(x, y)
        hp.closePath()
        s.holes.push(hp)
    }
    return s
}

const STROKE = 0.09

const GLYPH_A = poly(
    [[0, 0], [0.105, 0], [0.1988, 0.24], [0.6212, 0.24], [0.715, 0], [0.82, 0],
        [0.4635, 1], [0.3565, 1]],
    [[[0.234, 0.33], [0.586, 0.33], [0.41, 0.78]]])

function glyphG(): THREE.Shape {
    const cx = 0.5, cy = 0.5, R = 0.5, r = R - STROKE
    const TOP = 30 * Math.PI / 180
    const END = 340 * Math.PI / 180
    const SPUR = 0.70, BAR_TOP = 0.45
    const g = new THREE.Shape()
    g.moveTo(SPUR, BAR_TOP)
    g.lineTo(1.0, BAR_TOP)
    g.lineTo(cx + R * Math.cos(END), cy + R * Math.sin(END))
    g.absarc(cx, cy, R, END, TOP, true)
    g.lineTo(cx + r * Math.cos(TOP), cy + r * Math.sin(TOP))
    g.absarc(cx, cy, r, TOP, END, false)
    g.lineTo(SPUR, cy + r * Math.sin(END))
    g.closePath()
    return g
}

/** The moulded "GAG" plaque pressed into the strip below the card. */
export function buildWordmark(slabGroup: THREE.Group, layout: SlabLayout): { mark: THREE.Group, markBack: THREE.Group } {
    const GLYPHS = [glyphG(), GLYPH_A, glyphG()]
    const GLYPH_W = [1.0, 0.82, 1.0], TRACK = 0.45
    const BOTTOM = 0.075
    const PLAQUE_H = BOTTOM * 0.82
    const PAD_Y = 0.010, PAD_X = 0.030
    const CAP = PLAQUE_H - PAD_Y * 2
    const FLOOR = 0.012, PLATE_D = 0.004
    const INLAY_D = 0.005
    const wordW = (GLYPH_W.reduce((a, b) => a + b, 0) + TRACK * 2) * CAP
    const PLAQUE_W = wordW + PAD_X * 2

    const inlayMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0,
        roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.30,
        ior: 1.49, reflectivity: 0.7, envMapIntensity: 1.8,
        transparent: true, opacity: 0.20, depthWrite: false, side: THREE.FrontSide
    })
    const inlayGlint = new THREE.MeshPhysicalMaterial({
        color: 0x000000, metalness: 0,
        roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.20,
        ior: 1.49, reflectivity: 1.0, envMapIntensity: 1.5,
        transparent: true,
        depthWrite: false, side: THREE.FrontSide
    })
    applyAdditiveColourOnly(inlayGlint)
    const letterGlint = inlayGlint.clone()
    letterGlint.envMapIntensity = 2.6
    letterGlint.roughness = 0.16

    const mark = new THREE.Group()
    slabGroup.add(mark)

    const plateGeo = new THREE.ExtrudeGeometry(
        roundedRect(PLAQUE_W, PLAQUE_H, 0.012), {
            depth: PLATE_D, curveSegments: 32,
            bevelEnabled: true, bevelThickness: 0.0022, bevelSize: 0.0022,
            bevelSegments: 5
        })
    plateGeo.translate(0, -layout.slabH / 2 + BOTTOM / 2, FLOOR - PLATE_D)
    plateGeo.computeVertexNormals()
    mark.add(new THREE.Mesh(plateGeo, inlayMat))
    mark.add(new THREE.Mesh(plateGeo, inlayGlint))

    let penX = -wordW / 2
    for (let i = 0; i < GLYPHS.length; i++) {
        const geo = new THREE.ExtrudeGeometry(GLYPHS[i]!, {
            depth: INLAY_D / CAP, curveSegments: 32,
            bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 4
        })
        geo.scale(CAP, CAP, CAP)
        geo.translate(penX, -layout.slabH / 2 + (BOTTOM - CAP) / 2, FLOOR)
        geo.computeVertexNormals()
        mark.add(new THREE.Mesh(geo, inlayMat))
        mark.add(new THREE.Mesh(geo, letterGlint))
        penX += (GLYPH_W[i]! + TRACK) * CAP
    }

    const markBack = mark.clone()
    markBack.rotation.y = Math.PI
    slabGroup.add(markBack)
    return { mark, markBack }
}

/* ---- label textures ------------------------------------------------------ */

export function makeLabelTexture(design: SlabDesign, info: SlabInfo, back: boolean, anisotropy: number): THREE.CanvasTexture {
    const W = 1024
    const h = Math.round(W * design.labelH)
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = h
    const c = cv.getContext('2d')!
    ;(back ? design.paintLabelBack : design.paintLabel)(c, W, h, info)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = back ? THREE.SRGBColorSpace : THREE.NoColorSpace
    tex.anisotropy = anisotropy
    return tex
}
