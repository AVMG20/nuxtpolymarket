/**
 * Cuts the sprites Rail Tycoon draws from OpenGFX (GPL-2.0) into one atlas.
 *
 *   bun scripts/rail-tycoon/extract-opengfx.ts [--source <opengfx checkout>] [--out <dir>]
 *
 * OpenGFX is cloned (or an existing clone reused) at a pinned commit. Nothing from that
 * repository is executed: this script reads its pnml sprite definitions and 8-bit palette
 * PNGs itself, expanding templates with its own small evaluator. Which base-set sprite
 * means what is the table further down, one entry per range, citing the pnml it reads.
 * Output (public/rail-tycoon/opengfx/): atlas.png (RGBA), mask.png (company-colour shade),
 * atlas.json (name to rectangle and offsets), COPYING and README.md. Re-running at the
 * same commit writes byte-identical files.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

export const OPENGFX_URL = 'https://github.com/OpenTTD/OpenGFX'
export const OPENGFX_COMMIT = 'bdea55136ab72c9acd69c8fc761bd8088398bef1'
export const SCRIPT_PATH = 'scripts/rail-tycoon/extract-opengfx.ts'
const COVER_IMAGE_PATH = 'public/images/games/rail-tycoon.jpg'
const COVER_SCRIPT_PATH = 'scripts/rail-tycoon/cover-image.ts'

const ATLAS_WIDTH = 1024
const PADDING = 1
const WATER_FRAMES = 8
// Company-colour ramp of the OpenGFX palette (8 shades, dark to light).
const CC_FIRST = 198
const CC_LAST = 205
// The water colours of the OpenGFX palette: two animated groups of five (dark water, glitter).
const WATER_GROUPS = [217, 222]
const WATER_GROUP_SIZE = 5

/* ------------------------------------------------------------------------------------------
 * Expression evaluator and pnml reader
 * ---------------------------------------------------------------------------------------- */

export interface Token {
    kind: 'num' | 'id' | 'str' | 'op'
    text: string
}

export type Value = number | string | { flag: string }
export type Env = Record<string, Value>

const TWO_CHAR_OPS = ['==', '!=', '<=', '>=', '&&', '||', '<<', '>>']

/** Removes // and block comments, leaving string literals intact. */
export function stripComments(text: string): string {
    let out = ''
    let i = 0
    while (i < text.length) {
        const c = text[i]
        if (c === '"') {
            const end = text.indexOf('"', i + 1)
            if (end < 0) throw new Error('Unterminated string')
            out += text.slice(i, end + 1)
            i = end + 1
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++
        } else if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2)
            if (end < 0) throw new Error('Unterminated comment')
            // keep line breaks so #directives stay on their own lines
            out += text.slice(i, end + 2).replace(/[^\n]/g, ' ')
            i = end + 2
        } else {
            out += c
            i++
        }
    }
    return out
}

export function tokenize(text: string): Token[] {
    const tokens: Token[] = []
    let i = 0
    while (i < text.length) {
        const c = text[i] as string
        if (/\s/.test(c)) {
            i++
        } else if (c === '"') {
            const end = text.indexOf('"', i + 1)
            if (end < 0) throw new Error('Unterminated string')
            tokens.push({ kind: 'str', text: text.slice(i + 1, end) })
            i = end + 1
        } else if (/[0-9]/.test(c)) {
            const m = /^(0[xX][0-9a-fA-F]+|[0-9]+)/.exec(text.slice(i)) as RegExpExecArray
            tokens.push({ kind: 'num', text: m[0] })
            i += m[0].length
        } else if (/[A-Za-z_]/.test(c)) {
            const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i)) as RegExpExecArray
            tokens.push({ kind: 'id', text: m[0] })
            i += m[0].length
        } else {
            const two = text.slice(i, i + 2)
            if (TWO_CHAR_OPS.includes(two)) {
                tokens.push({ kind: 'op', text: two })
                i += 2
            } else {
                tokens.push({ kind: 'op', text: c })
                i++
            }
        }
    }
    return tokens
}

/** Splits #define and #include lines off a comment-free source. */
export function preprocess(text: string, defines: Map<string, Token[]>): string {
    const lines = text.split('\n')
    const kept: string[] = []
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('#')) {
            kept.push(line)
            continue
        }
        const m = /^#\s*(\w+)\s*(.*)$/.exec(trimmed)
        if (!m) throw new Error(`Bad directive: ${trimmed}`)
        if (m[1] === 'include') {
            kept.push('')
        } else if (m[1] === 'define') {
            const d = /^([A-Za-z_]\w*)\s*(.*)$/.exec(m[2] as string)
            if (!d) throw new Error(`Bad #define: ${trimmed}`)
            if ((d[2] as string).startsWith('(')) {
                // a function-like macro: not used by the files we read
                throw new Error(`Function-like #define is not supported: ${trimmed}`)
            }
            defines.set(d[1] as string, tokenize(d[2] as string))
            kept.push('')
        } else {
            throw new Error(`Unsupported directive: ${trimmed}`)
        }
    }
    return kept.join('\n')
}

/** Evaluates integer arithmetic: + - * / % and parentheses, identifiers from env or #defines. */
export function evalTokens(tokens: Token[], env: Env, defines: Map<string, Token[]> = new Map()): number {
    let i = 0
    const peek = (): Token | undefined => tokens[i]
    const expr = (): number => {
        let v = term()
        for (let t = peek(); t && t.kind === 'op' && (t.text === '+' || t.text === '-'); t = peek()) {
            i++
            const r = term()
            v = t.text === '+' ? v + r : v - r
        }
        return v
    }
    const term = (): number => {
        let v = unary()
        for (let t = peek(); t && t.kind === 'op' && (t.text === '*' || t.text === '/' || t.text === '%'); t = peek()) {
            i++
            const r = unary()
            if (t.text === '*') {
                v = v * r
            } else {
                if (r === 0) throw new Error('Division by zero')
                v = t.text === '/' ? Math.trunc(v / r) : v % r
            }
        }
        return v
    }
    const unary = (): number => {
        const t = peek()
        if (t && t.kind === 'op' && (t.text === '-' || t.text === '+')) {
            i++
            const v = unary()
            return t.text === '-' ? -v : v
        }
        return primary()
    }
    const primary = (): number => {
        const t = tokens[i++]
        if (!t) throw new Error('Unexpected end of expression')
        if (t.kind === 'num') return Number(t.text)
        if (t.kind === 'op' && t.text === '(') {
            const v = expr()
            const close = tokens[i++]
            if (!close || close.text !== ')') throw new Error('Missing )')
            return v
        }
        if (t.kind === 'id') {
            if (Object.hasOwn(env, t.text)) {
                const v = env[t.text]
                if (typeof v !== 'number') throw new Error(`${t.text} is not a number`)
                return v
            }
            const d = defines.get(t.text)
            if (d) return evalTokens(d, env, defines)
            throw new Error(`Unknown identifier ${t.text}`)
        }
        throw new Error(`Unexpected token ${t.text}`)
    }
    const v = expr()
    if (i !== tokens.length) throw new Error(`Trailing tokens after expression: ${tokens.slice(i).map(t => t.text).join(' ')}`)
    return v
}

export function evaluate(expression: string, env: Env = {}): number {
    return evalTokens(tokenize(expression), env)
}

export interface SpriteEntry {
    x: number
    y: number
    w: number
    h: number
    xoff: number
    yoff: number
    file: string
    flags: string[]
}

export interface Template {
    params: string[]
    body: Token[]
}

export interface GraphicsBlock {
    kind: 'base_graphics' | 'replacenew'
    /** base sprite number for base_graphics, the label for replacenew */
    label: string
    base: number
    file: string
    offset: number
    /** source text of the enclosing if () condition, '' when unconditional */
    condition: string
    body: Token[]
    source: string
}

export interface Pnml {
    templates: Map<string, Template>
    defines: Map<string, Token[]>
    blocks: GraphicsBlock[]
}

export function createPnml(): Pnml {
    return { templates: new Map(), defines: new Map(), blocks: [] }
}

/** Index of the token closing the bracket opened at tokens[open]. */
function matching(tokens: Token[], open: number): number {
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
    const stack: string[] = []
    for (let i = open; i < tokens.length; i++) {
        const t = tokens[i] as Token
        if (t.kind !== 'op') continue
        if (pairs[t.text]) {
            stack.push(pairs[t.text] as string)
        } else if (t.text === ')' || t.text === ']' || t.text === '}') {
            if (stack.pop() !== t.text) throw new Error(`Mismatched ${t.text}`)
            if (stack.length === 0) return i
        }
    }
    throw new Error('Unclosed bracket')
}

/** Splits tokens on commas that are not nested in brackets. */
function splitArgs(tokens: Token[]): Token[][] {
    const args: Token[][] = []
    let current: Token[] = []
    let depth = 0
    for (const t of tokens) {
        if (t.kind === 'op' && (t.text === '(' || t.text === '[' || t.text === '{')) depth++
        if (t.kind === 'op' && (t.text === ')' || t.text === ']' || t.text === '}')) depth--
        if (depth === 0 && t.kind === 'op' && t.text === ',') {
            args.push(current)
            current = []
        } else {
            current.push(t)
        }
    }
    if (current.length || args.length) args.push(current)
    return args
}

function expect(tokens: Token[], i: number, text: string): void {
    const t = tokens[i]
    if (!t || t.text !== text) throw new Error(`Expected ${text}, found ${t ? t.text : 'end of file'}`)
}

function parseStatements(tokens: Token[], pnml: Pnml, condition: string, source: string): void {
    let i = 0
    while (i < tokens.length) {
        const t = tokens[i] as Token
        if (t.kind === 'id' && t.text === 'template') {
            const name = (tokens[i + 1] as Token).text
            expect(tokens, i + 2, '(')
            const close = matching(tokens, i + 2)
            const params = splitArgs(tokens.slice(i + 3, close)).map(a => {
                if (a.length !== 1 || (a[0] as Token).kind !== 'id') throw new Error(`Bad parameter in template ${name}`)
                return (a[0] as Token).text
            })
            expect(tokens, close + 1, '{')
            const end = matching(tokens, close + 1)
            pnml.templates.set(name, { params, body: tokens.slice(close + 2, end) })
            i = end + 1
        } else if (t.kind === 'id' && (t.text === 'base_graphics' || t.text === 'replacenew')) {
            const named = t.text === 'base_graphics'
            const open = named ? i + 2 : i + 1
            expect(tokens, open, '(')
            const close = matching(tokens, open)
            const args = splitArgs(tokens.slice(open + 1, close))
            expect(tokens, close + 1, '{')
            const end = matching(tokens, close + 1)
            const fileArg = args[1] as Token[]
            if (fileArg.length !== 1 || (fileArg[0] as Token).kind !== 'str') throw new Error(`Expected a file name in ${t.text}`)
            const block: GraphicsBlock = {
                kind: named ? 'base_graphics' : 'replacenew',
                label: named ? String(evalTokens(args[0] as Token[], {}, pnml.defines)) : ((args[0] as Token[])[0] as Token).text,
                base: named ? evalTokens(args[0] as Token[], {}, pnml.defines) : -1,
                file: (fileArg[0] as Token).text,
                offset: args[2] ? evalTokens(args[2], {}, pnml.defines) : 0,
                condition,
                body: tokens.slice(close + 2, end),
                source
            }
            pnml.blocks.push(block)
            i = end + 1
        } else if (t.kind === 'id' && t.text === 'if') {
            expect(tokens, i + 1, '(')
            const close = matching(tokens, i + 1)
            const cond = tokens.slice(i + 2, close).map(x => x.text).join(' ')
            expect(tokens, close + 1, '{')
            const end = matching(tokens, close + 1)
            parseStatements(tokens.slice(close + 2, end), pnml, condition ? `${condition} && ${cond}` : cond, source)
            i = end + 1
        } else if (t.kind === 'id') {
            // any other statement (alternative_sprites, recolour_sprite, ...): skip its block
            let j = i + 1
            while (j < tokens.length && (tokens[j] as Token).text !== '{' && (tokens[j] as Token).text !== ';') {
                if ((tokens[j] as Token).text === '(') j = matching(tokens, j)
                j++
            }
            if (j >= tokens.length) throw new Error(`Unterminated statement ${t.text}`)
            i = (tokens[j] as Token).text === '{' ? matching(tokens, j) + 1 : j + 1
        } else {
            throw new Error(`Unexpected token ${t.text} in ${source}`)
        }
    }
}

/** Reads one pnml/nml source into the shared template, define and block tables. */
export function parsePnml(text: string, pnml: Pnml, source = '<text>'): Pnml {
    const code = preprocess(stripComments(text), pnml.defines)
    parseStatements(tokenize(code), pnml, '', source)
    return pnml
}

function argValue(tokens: Token[], env: Env, pnml: Pnml): Value {
    if (tokens.length === 1) {
        const t = tokens[0] as Token
        if (t.kind === 'str') return t.text
        if (t.kind === 'id' && Object.hasOwn(env, t.text)) return env[t.text] as Value
        if (t.kind === 'id' && !pnml.defines.has(t.text)) return { flag: t.text }
    }
    return evalTokens(tokens, env, pnml.defines)
}

/** Expands a sprite list body (literal entries and template calls) into sprite entries. */
export function expandBody(body: Token[], env: Env, file: string, pnml: Pnml, depth = 0): SpriteEntry[] {
    if (depth > 32) throw new Error('Template recursion too deep')
    const out: SpriteEntry[] = []
    let i = 0
    while (i < body.length) {
        const t = body[i] as Token
        if (t.kind === 'op' && t.text === '[') {
            const end = matching(body, i)
            const values = splitArgs(body.slice(i + 1, end)).map(a => argValue(a, env, pnml))
            const nums = values.slice(0, 6)
            if (nums.length !== 6 || nums.some(v => typeof v !== 'number')) throw new Error('A sprite needs six numbers')
            const [x, y, w, h, xoff, yoff] = nums as number[]
            const entry: SpriteEntry = { x: x as number, y: y as number, w: w as number, h: h as number, xoff: xoff as number, yoff: yoff as number, file, flags: [] }
            for (const v of values.slice(6)) {
                if (typeof v === 'string') {
                    entry.file = v
                } else if (typeof v === 'object') {
                    entry.flags.push(v.flag)
                } else {
                    throw new Error('Unexpected number after the sprite offsets')
                }
            }
            out.push(entry)
            i = end + 1
        } else if (t.kind === 'id') {
            const template = pnml.templates.get(t.text)
            if (!template) throw new Error(`Unknown template ${t.text}`)
            expect(body, i + 1, '(')
            const end = matching(body, i + 1)
            const args = splitArgs(body.slice(i + 2, end))
            if (args.length !== template.params.length) throw new Error(`${t.text} takes ${template.params.length} arguments, got ${args.length}`)
            const callEnv: Env = {}
            template.params.forEach((p, k) => {
                callEnv[p] = argValue(args[k] as Token[], env, pnml)
            })
            out.push(...expandBody(template.body, callEnv, file, pnml, depth + 1))
            i = end + 1
        } else {
            throw new Error(`Unexpected token ${t.text} in a sprite list`)
        }
    }
    return out
}

/** Every sprite of a block, in order. */
export function blockSprites(block: GraphicsBlock, pnml: Pnml): SpriteEntry[] {
    return expandBody(block.body, {}, block.file, pnml)
}

/* ------------------------------------------------------------------------------------------
 * Source checkout and PNG reading
 * ---------------------------------------------------------------------------------------- */

function git(args: string[], cwd?: string): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function defaultSourceDir(): string {
    const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
    return join(config, 'tsch-ai-skills', 'tmp', 'opengfx-src', 'repo')
}

/** Clones OpenGFX, or reuses a clone, and leaves it at the pinned commit with a clean tree. */
export function ensureSource(dir: string): { commit: string, commitDate: string } {
    if (!existsSync(join(dir, '.git'))) {
        mkdirSync(dirname(dir), { recursive: true })
        git(['clone', '--quiet', '--no-checkout', OPENGFX_URL, dir])
    }
    let head = ''
    try {
        head = git(['rev-parse', 'HEAD'], dir)
    } catch {
        head = ''
    }
    if (head !== OPENGFX_COMMIT) {
        if (git(['status', '--porcelain', '--untracked-files=no'], dir)) {
            throw new Error(`${dir} has local changes and is not at ${OPENGFX_COMMIT}`)
        }
        try {
            git(['cat-file', '-e', `${OPENGFX_COMMIT}^{commit}`], dir)
        } catch {
            git(['fetch', '--quiet', 'origin', OPENGFX_COMMIT], dir)
        }
        git(['checkout', '--quiet', '--detach', OPENGFX_COMMIT], dir)
    }
    if (git(['rev-parse', 'HEAD'], dir) !== OPENGFX_COMMIT) throw new Error(`${dir} is not at ${OPENGFX_COMMIT}`)
    if (git(['status', '--porcelain', '--untracked-files=no'], dir)) throw new Error(`${dir} has local changes`)
    return { commit: OPENGFX_COMMIT, commitDate: git(['show', '-s', '--format=%cI', OPENGFX_COMMIT], dir) }
}

interface IndexedImage {
    width: number
    height: number
    /** palette index per pixel */
    idx: Uint8Array
}

/** Reads the PLTE chunk of a PNG file as an array of 0xRRGGBB colours. */
export function readPalette(buffer: Buffer): number[] {
    let p = 8
    while (p < buffer.length) {
        const len = buffer.readUInt32BE(p)
        const type = buffer.toString('ascii', p + 4, p + 8)
        if (type === 'PLTE') {
            const colours: number[] = []
            for (let i = 0; i < len / 3; i++) {
                const o = p + 8 + i * 3
                colours.push(((buffer[o] as number) << 16) | ((buffer[o + 1] as number) << 8) | (buffer[o + 2] as number))
            }
            return colours
        }
        p += 12 + len
    }
    throw new Error('PNG has no palette')
}

class ImageSource {
    private cache = new Map<string, IndexedImage>()
    palette: number[] | null = null

    constructor(private root: string) {}

    load(file: string): IndexedImage {
        const hit = this.cache.get(file)
        if (hit) return hit
        const buffer = readFileSync(join(this.root, file))
        const palette = readPalette(buffer)
        const lookup = new Map<number, number>()
        palette.forEach((c, i) => {
            if (lookup.has(c)) throw new Error(`${file}: palette holds a duplicate colour at ${i}`)
            lookup.set(c, i)
        })
        if (!this.palette) {
            if (palette.length !== 256) throw new Error(`${file}: expected a 256-colour palette`)
            this.palette = palette
        } else if (palette.length !== this.palette.length || palette.some((c, i) => c !== this.palette?.[i])) {
            throw new Error(`${file}: palette differs from the other OpenGFX PNGs`)
        }
        // pngjs expands the palette to RGBA, so every pixel is mapped back to its index
        const png = PNG.sync.read(buffer)
        const idx = new Uint8Array(png.width * png.height)
        for (let i = 0; i < idx.length; i++) {
            const o = i * 4
            const c = ((png.data[o] as number) << 16) | ((png.data[o + 1] as number) << 8) | (png.data[o + 2] as number)
            const k = lookup.get(c)
            if (k === undefined) throw new Error(`${file}: pixel colour ${c.toString(16)} is not in the palette`)
            idx[i] = k
        }
        const image = { width: png.width, height: png.height, idx }
        this.cache.set(file, image)
        return image
    }
}

/* ------------------------------------------------------------------------------------------
 * Cutting, compositing and trimming
 * ---------------------------------------------------------------------------------------- */

interface Cut {
    w: number
    h: number
    /** screen offset of the top-left pixel from the anchor */
    ox: number
    oy: number
    idx: Uint8Array
}

function cutEntry(entry: SpriteEntry, images: ImageSource): Cut {
    const image = images.load(entry.file)
    if (entry.x < 0 || entry.y < 0 || entry.x + entry.w > image.width || entry.y + entry.h > image.height) {
        throw new Error(`${entry.file}: rectangle ${entry.x},${entry.y} ${entry.w}x${entry.h} lies outside the image`)
    }
    const idx = new Uint8Array(entry.w * entry.h)
    for (let y = 0; y < entry.h; y++) {
        for (let x = 0; x < entry.w; x++) {
            idx[y * entry.w + x] = image.idx[(entry.y + y) * image.width + entry.x + x] as number
        }
    }
    return { w: entry.w, h: entry.h, ox: entry.xoff, oy: entry.yoff, idx }
}

/** Draws layers over each other (index 0 is transparent), each shifted by its own offset. */
function composite(layers: { cut: Cut, dx: number, dy: number }[]): Cut {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const l of layers) {
        minX = Math.min(minX, l.cut.ox + l.dx)
        minY = Math.min(minY, l.cut.oy + l.dy)
        maxX = Math.max(maxX, l.cut.ox + l.dx + l.cut.w)
        maxY = Math.max(maxY, l.cut.oy + l.dy + l.cut.h)
    }
    const w = maxX - minX
    const h = maxY - minY
    const idx = new Uint8Array(w * h)
    for (const l of layers) {
        const bx = l.cut.ox + l.dx - minX
        const by = l.cut.oy + l.dy - minY
        for (let y = 0; y < l.cut.h; y++) {
            for (let x = 0; x < l.cut.w; x++) {
                const v = l.cut.idx[y * l.cut.w + x] as number
                if (v !== 0) idx[(by + y) * w + bx + x] = v
            }
        }
    }
    return { w, h, ox: minX, oy: minY, idx }
}

/** Crops transparent borders, moving the offsets so the sprite still lands where it did. */
function trim(cut: Cut): Cut {
    let minX = cut.w
    let minY = cut.h
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < cut.h; y++) {
        for (let x = 0; x < cut.w; x++) {
            if (cut.idx[y * cut.w + x] !== 0) {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
    }
    if (maxX < 0) return { w: 1, h: 1, ox: cut.ox, oy: cut.oy, idx: new Uint8Array(1) }
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    const idx = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
        idx.set(cut.idx.subarray((minY + y) * cut.w + minX, (minY + y) * cut.w + minX + w), y * w)
    }
    return { w, h, ox: cut.ox + minX, oy: cut.oy + minY, idx }
}

/** Screen shift of a point at world offset (dx, dy, dz) inside a tile (16 units a side). */
function worldShift(dx: number, dy: number, dz = 0): { dx: number, dy: number } {
    return { dx: 2 * (dy - dx), dy: dx + dy - dz }
}

/* ------------------------------------------------------------------------------------------
 * What each base-set sprite means
 * ---------------------------------------------------------------------------------------- */

/** OpenTTD slope names (raised corners), in the order of the 19 ground sprites of a set. */
export const SLOPES: { name: string, corners: string, steep: boolean }[] = [
    { name: 'flat', corners: '', steep: false },
    { name: 'w', corners: 'w', steep: false },
    { name: 's', corners: 's', steep: false },
    { name: 'sw', corners: 'sw', steep: false },
    { name: 'e', corners: 'e', steep: false },
    { name: 'ew', corners: 'ew', steep: false },
    { name: 'se', corners: 'se', steep: false },
    { name: 'wse', corners: 'wse', steep: false },
    { name: 'n', corners: 'n', steep: false },
    { name: 'nw', corners: 'nw', steep: false },
    { name: 'ns', corners: 'ns', steep: false },
    { name: 'nws', corners: 'nws', steep: false },
    { name: 'ne', corners: 'ne', steep: false },
    { name: 'enw', corners: 'enw', steep: false },
    { name: 'sen', corners: 'sen', steep: false },
    { name: 'steep-n', corners: 'enw', steep: true },
    { name: 'steep-s', corners: 'wse', steep: true },
    { name: 'steep-w', corners: 'nws', steep: true },
    { name: 'steep-e', corners: 'sen', steep: true }
]

export const DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

/** A run of consecutive base-set sprites and the atlas name of each. */
interface RangeSpec {
    first: number
    /** pnml file and the comment (or block) the numbers come from */
    cite: string
    names: (string | string[] | null)[]
    frames?: boolean
}

const slopeNames = (prefix: string) => SLOPES.map(s => `${prefix}.${s.name}`)
const dirNames = (prefix: string) => DIRECTIONS.map(d => `${prefix}.${d}`)
/** A 4-view vehicle: the far four directions reuse the near four. */
const fourViewNames = (prefix: string) => [0, 1, 2, 3].map(k => [`${prefix}.${DIRECTIONS[k]}`, `${prefix}.${DIRECTIONS[k + 4]}`])
const roadBitNames = ['ne', 'se', 'sw', 'nw']

/** Name of a road piece set by OpenTTD road bits (NW 1, SW 2, SE 4, NE 8). */
function roadBitsName(bits: number): string {
    const parts: string[] = []
    if (bits & 8) parts.push('ne')
    if (bits & 4) parts.push('se')
    if (bits & 2) parts.push('sw')
    if (bits & 1) parts.push('nw')
    return parts.join('-')
}

/** Names of the 19 road sprites of a set, by their offset in the set. */
function roadSetNames(prefix: string): (string | null)[] {
    // offset of each road-bit combination in a set of 19 road sprites
    const offsets = [0, 18, 17, 7, 16, 0, 10, 5, 15, 8, 1, 4, 9, 3, 6, 2]
    const names: (string | null)[] = new Array(19).fill(null)
    for (let bits = 1; bits < 16; bits++) names[offsets[bits] as number] = `${prefix}.${roadBitsName(bits)}`
    names[11] = `${prefix}.slope-ne`
    names[12] = `${prefix}.slope-se`
    names[13] = `${prefix}.slope-sw`
    names[14] = `${prefix}.slope-nw`
    return names
}

const TEMPERATE_TREES = 12
const TREE_STAGES = 7

/** One run per range. Base-set numbers, read from the OpenGFX pnml files named in cite. */
const RANGES: RangeSpec[] = [
    { first: 3981, cite: 'base-3924-terrain.pnml: temperate grass (100% grassy) 3981 - 3999', names: slopeNames('terrain.grass') },
    {
        first: 4000,
        cite: 'base-3924-terrain.pnml: temperate rough terrain 4000 - 4022',
        names: [...slopeNames('terrain.rough'), 'terrain.rough.flat-1', 'terrain.rough.flat-2', 'terrain.rough.flat-3', 'terrain.rough.flat-4']
    },
    { first: 990, cite: 'base-0990-foundations.pnml: foundations 990-1003 (one per slope 1 to 14)', names: SLOPES.slice(1, 15).map(s => `foundation.${s.name}`) },
    {
        first: 1005,
        cite: 'base-1005-rail-infra.pnml: 1005-1010 rail overlays (single piece x, y, n, s, e, w)',
        names: ['rail.overlay.x', 'rail.overlay.y', 'rail.overlay.n', 'rail.overlay.s', 'rail.overlay.e', 'rail.overlay.w']
    },
    {
        first: 1011,
        cite: 'base-1005-rail-infra.pnml: 1011-1036 rail tracks temperate grass',
        names: [
            'rail.flat.y', 'rail.flat.x', 'rail.flat.n', 'rail.flat.s', 'rail.flat.e', 'rail.flat.w', 'rail.flat.x-y',
            // junction grounds: the uncovered tile edge, or none
            'rail.junction.no-ne', 'rail.junction.no-sw', 'rail.junction.no-nw', 'rail.junction.no-se', 'rail.junction.all',
            // sloped track, by slope (offset 12 to 23 of the set)
            'rail.slope.n', 'rail.slope.e', 'rail.slope.w', 'rail.slope.s', 'rail.slope.sen', 'rail.slope.wse',
            'rail.slope.nws', 'rail.slope.enw', 'rail.slope.ne', 'rail.slope.se', 'rail.slope.sw', 'rail.slope.nw',
            'rail.flat.n-s', 'rail.flat.e-w'
        ]
    },
    { first: 1275, cite: 'base-1005-rail-infra.pnml: 1275-1290 signals (tmpl_signals)', names: signalNames('signal.block') },
    { first: 1313, cite: 'base-1309-road-infra.pnml: 1313-1331 road city', names: roadSetNames('road.town') },
    { first: 1332, cite: 'base-1309-road-infra.pnml: 1332-1350 road temperate grass', names: roadSetNames('road.grass') },
    {
        first: 1370,
        cite: 'base-1309-road-infra.pnml: level crossing rail temperate grass / level crossing rail city (rail axis x, y; open, then closed)',
        names: [
            'crossing.grass.x', 'crossing.grass.y', 'crossing.grass.x-closed', 'crossing.grass.y-closed',
            'crossing.town.x', 'crossing.town.y', 'crossing.town.x-closed', 'crossing.town.y-closed'
        ]
    },
    {
        first: 1576,
        cite: 'base-1576-trees.pnml: 1576-1764 temperate trees (the 12 temperate kinds, 7 growth stages each)',
        names: Array.from({ length: TEMPERATE_TREES * TREE_STAGES }, (_, k) => `tree.${Math.floor(k / TREE_STAGES)}.${k % TREE_STAGES}`)
    },
    {
        first: 2692,
        cite: 'base-2692-roadstops-docks.pnml: 2692-2723 road stops (bus stop, cargo stop; grounds then parts A, B, C; facing ne, se, sw, nw)',
        names: ['bus', 'truck'].flatMap(kind => ['ground', 'a', 'b', 'c'].flatMap(part => roadBitNames.map(dir => `roadstop.${kind}.${dir}.${part}`)))
    },
    { first: 2733, cite: 'base-2733-rail-vehicles-wagons.pnml: temperate rail passenger wagon (full + empty)', names: fourViewNames('vehicle.wagon.passengers') },
    { first: 2737, cite: 'base-2733-rail-vehicles-wagons.pnml: temperate rail coal wagon (empty)', names: fourViewNames('vehicle.wagon.coal') },
    { first: 2741, cite: 'base-2733-rail-vehicles-wagons.pnml: temperate rail mail wagon (full + empty)', names: fourViewNames('vehicle.wagon.mail') },
    { first: 2753, cite: 'base-2733-rail-vehicles-wagons.pnml: temperate rail goods wagon (full + empty)', names: fourViewNames('vehicle.wagon.goods') },
    { first: 2765, cite: 'base-2733-rail-vehicles-wagons.pnml: temperate rail wood wagon (empty)', names: fourViewNames('vehicle.wagon.wood') },
    { first: 2781, cite: 'base-2733-rail-vehicles-wagons.pnml: temperate rail coal wagon (full)', names: fourViewNames('vehicle.wagon.coal-full') },
    { first: 2789, cite: 'base-2733-rail-vehicles-wagons.pnml: temperate rail wood wagon (full)', names: fourViewNames('vehicle.wagon.wood-full') },
    { first: 2921, cite: 'base-2905-rail-vehicles-engines.pnml: Kirby Paul (Steam)', names: dirNames('vehicle.train.steam') },
    { first: 2957, cite: 'base-2905-rail-vehicles-engines.pnml: Dash (Diesel)', names: dirNames('vehicle.train.diesel') },
    { first: 3284, cite: 'base-3092-road-vehicles.pnml: 1st passengers', names: dirNames('vehicle.road.bus') },
    { first: 3292, cite: 'base-3092-road-vehicles.pnml: 1st coal unloaded', names: dirNames('vehicle.road.coal') },
    { first: 3300, cite: 'base-3092-road-vehicles.pnml: 1st mail', names: dirNames('vehicle.road.mail') },
    { first: 3324, cite: 'base-3092-road-vehicles.pnml: 1st goods', names: dirNames('vehicle.road.goods') },
    { first: 3348, cite: 'base-3092-road-vehicles.pnml: 1st wood unloaded', names: dirNames('vehicle.road.wood') },
    { first: 3380, cite: 'base-3092-road-vehicles.pnml: 1st coal loaded', names: dirNames('vehicle.road.coal-full') },
    { first: 3396, cite: 'base-3092-road-vehicles.pnml: 1st wood loaded', names: dirNames('vehicle.road.wood-full') }
]

/** The 16 signal sprites: per facing (OpenTTD signal image order), red then green. */
function signalNames(prefix: string): string[] {
    const facings = ['to-sw', 'to-ne', 'to-se', 'to-nw', 'to-e', 'to-w', 'to-s', 'to-n']
    return facings.flatMap(f => [`${prefix}.${f}.red`, `${prefix}.${f}.green`])
}

/** Sprites from the extra (OpenTTD-specific) sprite blocks, by block label and index. */
interface ExtraSpec {
    file: string
    label: string
    condition: string
    first: number
    cite: string
    names: (string | null)[]
    frames?: boolean
}

// Shore slopes of the 8 base and the 10 extra coast sprites, in pnml order.
const BASE_SHORES = ['e', 'w', 's', 'n', 'se', 'ne', 'sw', 'nw']
const EXTRA_SHORES = ['steep-s', 'steep-w', 'wse', 'steep-n', 'nws', 'enw', 'sen', 'steep-e', 'ew', 'ns']

const EXTRAS: ExtraSpec[] = [
    {
        file: 'sprites/extra/extra-shores.pnml',
        label: 'COAST_TILES_BASEGFX',
        condition: 'climate == CLIMATE_TEMPERATE',
        first: 0,
        cite: 'extra-shores.pnml: Additional coast sprites (tmpl_10shore_tiles), temperate',
        names: EXTRA_SHORES.map(s => `coast.${s}`),
        frames: true
    },
    {
        file: 'sprites/extra/extra-signals.pnml',
        label: 'PRE_SIGNAL_SEMAPHORE_PBS',
        condition: '',
        // the two rows of signals_pbs.png labelled Standard and One-way: path signals
        first: 64,
        cite: 'extra-signals.pnml: Signals used for both traffic sides, signals_pbs.png rows Standard and One-way',
        names: [...signalNames('signal.path'), ...signalNames('signal.path-oneway')]
    }
]

const WATER: RangeSpec[] = [
    { first: 4061, cite: 'base-4061-water.pnml: Water and shore tiles (8-tile version), flat water', names: ['water'], frames: true },
    { first: 4062, cite: 'base-4061-water.pnml: Water and shore tiles (8-tile version), tmpl_8shore_tiles', names: BASE_SHORES.map(s => `coast.${s}`), frames: true }
]

/** A sprite assembled from several base-set sprites, each placed at a world offset in the tile. */
interface CompositeSpec {
    name: string
    cite: string
    layers: { spr: number, dx?: number, dy?: number, dz?: number }[]
    layer?: 'rear' | 'front'
}

/** Ground plus building of a finished house; pairs read from the pnml comments. */
const HOUSES: CompositeSpec[] = [
    ...[[1487, 1488], [1489, 1490], [1491, 1492], [1493, 1494], [1495, 1496], [1505, 1506], [1511, 1512], [1566, 1567]].map(([g, b], k) => ({
        name: `house.small.${k}`,
        cite: 'base-1440-houses.pnml: //old house, //house (ground tile then building)',
        layers: [{ spr: g as number }, { spr: b as number }]
    })),
    ...[[1536, 1537], [1538, 1539], [1552, 1553]].map(([g, b], k) => ({
        name: `house.medium.${k}`,
        cite: 'base-1440-houses.pnml: //1536-1537 old flats, //1538-1539 old flats, //1552-1553 theatre',
        layers: [{ spr: g as number }, { spr: b as number }]
    })),
    ...[[1499, 1500], [1532, 1533], [1534, 1535], [1550, 1551], [1562, 1563]].map(([g, b], k) => ({
        name: `house.large.${k}`,
        cite: 'base-1440-houses.pnml: //house 1499-1500, // 1530-1535 office block, //1546-1551 office tower, //modern office building',
        layers: [{ spr: g as number }, { spr: b as number }]
    }))
]

/** Finished industry tiles: ground plus building at its place in the tile. */
const INDUSTRY_TILES: { industry: string, tile: number, ground: number, building?: number, dx?: number, dy?: number }[] = [
    // base-2011-industries.pnml: //2011-2025 coal mine
    { industry: 'coalMine', tile: 0, ground: 2022, building: 2013, dx: 7, dy: 0 },
    { industry: 'coalMine', tile: 1, ground: 2022, building: 2015, dx: 7, dy: 0 },
    { industry: 'coalMine', tile: 2, ground: 2022, building: 2018, dx: 1, dy: 2 },
    { industry: 'coalMine', tile: 3, ground: 2022, building: 2021, dx: 4, dy: 4 },
    { industry: 'coalMine', tile: 4, ground: 2025 },
    { industry: 'coalMine', tile: 5, ground: 2023 },
    { industry: 'coalMine', tile: 6, ground: 2024 },
    // base-2011-industries.pnml: //2045-2054 power plant (ground: 3924 bare land)
    { industry: 'powerStation', tile: 0, ground: 3924, building: 2047, dx: 1, dy: 1 },
    { industry: 'powerStation', tile: 1, ground: 3924, building: 2050, dx: 0, dy: 2 },
    { industry: 'powerStation', tile: 2, ground: 3924, building: 2053, dx: 1, dy: 0 },
    { industry: 'powerStation', tile: 3, ground: 3924, building: 2054, dx: 1, dy: 2 },
    // base-2011-industries.pnml: //2061-2071 sawmill
    { industry: 'sawmill', tile: 0, ground: 3924, building: 2063, dx: 1, dy: 0 },
    { industry: 'sawmill', tile: 1, ground: 3924, building: 2066, dx: 0, dy: 1 },
    { industry: 'sawmill', tile: 2, ground: 3924, building: 2069, dx: 1, dy: 1 },
    { industry: 'sawmill', tile: 3, ground: 3924, building: 2070, dx: 0, dy: 0 },
    { industry: 'sawmill', tile: 4, ground: 3924, building: 2071, dx: 0, dy: 1 },
    // base-2011-industries.pnml: //2072-2077 forest (grown trees on forest ground)
    { industry: 'forest', tile: 0, ground: 2077, building: 2075, dx: 0, dy: 0 }
]

/** A suggested arrangement of each industry's tiles: [x, y, tile] from its north tile. */
export const INDUSTRY_LAYOUTS: Record<string, [number, number, number][]> = {
    coalMine: [[1, 1, 0], [1, 2, 2], [0, 0, 5], [1, 0, 6], [2, 0, 3], [2, 2, 3]],
    powerStation: [[0, 0, 0], [0, 1, 2], [1, 0, 0], [1, 1, 1], [2, 0, 0], [2, 1, 1], [3, 0, 3], [3, 1, 3]],
    sawmill: [[1, 0, 3], [1, 1, 1], [1, 2, 0], [2, 0, 3], [2, 1, 2], [0, 0, 4], [0, 1, 4], [0, 2, 1]],
    forest: [0, 1, 2, 3].flatMap(x => [0, 1, 2, 3].map(y => [x, y, 0] as [number, number, number])).concat([[1, 4, 0], [2, 4, 0]])
}

/** Station, depot and road stop parts placed at their spot in the tile. */
const PARTS: CompositeSpec[] = [
    // base-1005-rail-infra.pnml: //1069-1086 rail station (platforms and the station building)
    { name: 'station.rail.x.plain.rear', cite: 'base-1005-rail-infra.pnml: 1070 platform x rear', layers: [{ spr: 1070 }], layer: 'rear' },
    { name: 'station.rail.x.plain.front', cite: 'base-1005-rail-infra.pnml: 1072 platform x front', layers: [{ spr: 1072, dy: 11 }], layer: 'front' },
    { name: 'station.rail.x.building.rear', cite: 'base-1005-rail-infra.pnml: 1073 station building x', layers: [{ spr: 1073 }], layer: 'rear' },
    { name: 'station.rail.x.building.front', cite: 'base-1005-rail-infra.pnml: 1072 platform x front', layers: [{ spr: 1072, dy: 11 }], layer: 'front' },
    { name: 'station.rail.y.plain.rear', cite: 'base-1005-rail-infra.pnml: 1071 platform y rear', layers: [{ spr: 1071 }], layer: 'rear' },
    { name: 'station.rail.y.plain.front', cite: 'base-1005-rail-infra.pnml: 1069 platform y front', layers: [{ spr: 1069, dx: 11 }], layer: 'front' },
    { name: 'station.rail.y.building.rear', cite: 'base-1005-rail-infra.pnml: 1074 station building y', layers: [{ spr: 1074 }], layer: 'rear' },
    { name: 'station.rail.y.building.front', cite: 'base-1005-rail-infra.pnml: 1069 platform y front', layers: [{ spr: 1069, dx: 11 }], layer: 'front' },
    // base-1005-rail-infra.pnml: //1063-1068 rail depots, ground: grass, or track along the depot
    { name: 'depot.rail.ne.ground', cite: 'base-3924-terrain.pnml: 3981 grass', layers: [{ spr: 3981 }] },
    { name: 'depot.rail.ne.building', cite: 'base-1005-rail-infra.pnml: 1067 depot ne', layers: [{ spr: 1067, dx: 2, dy: 13 }], layer: 'front' },
    { name: 'depot.rail.se.ground', cite: 'base-1005-rail-infra.pnml: 1011 track y', layers: [{ spr: 1011 }] },
    { name: 'depot.rail.se.building', cite: 'base-1005-rail-infra.pnml: 1063 depot se part 1', layers: [{ spr: 1063, dx: 2, dy: 2 }], layer: 'rear' },
    { name: 'depot.rail.se.front', cite: 'base-1005-rail-infra.pnml: 1064 depot se part 2', layers: [{ spr: 1064, dx: 13, dy: 2 }], layer: 'front' },
    { name: 'depot.rail.sw.ground', cite: 'base-1005-rail-infra.pnml: 1012 track x', layers: [{ spr: 1012 }] },
    { name: 'depot.rail.sw.building', cite: 'base-1005-rail-infra.pnml: 1065 depot sw part 1', layers: [{ spr: 1065, dx: 2, dy: 2 }], layer: 'rear' },
    { name: 'depot.rail.sw.front', cite: 'base-1005-rail-infra.pnml: 1066 depot sw part 2', layers: [{ spr: 1066, dx: 2, dy: 13 }], layer: 'front' },
    { name: 'depot.rail.nw.ground', cite: 'base-3924-terrain.pnml: 3981 grass', layers: [{ spr: 3981 }] },
    { name: 'depot.rail.nw.building', cite: 'base-1005-rail-infra.pnml: 1068 depot nw', layers: [{ spr: 1068, dx: 13, dy: 2 }], layer: 'front' },
    // base-1309-road-infra.pnml: //1408-1413 road depot, on the concrete of base-2633-airports.pnml 2634
    ...['ne', 'se', 'sw', 'nw'].map(dir => ({ name: `depot.road.${dir}.ground`, cite: 'base-2633-airports.pnml: 2634 concrete', layers: [{ spr: 2634 }] })),
    { name: 'depot.road.ne.building', cite: 'base-1309-road-infra.pnml: 1412 road depot ne', layers: [{ spr: 1412, dx: 0, dy: 15 }], layer: 'front' },
    { name: 'depot.road.se.building', cite: 'base-1309-road-infra.pnml: 1408 road depot se part 1', layers: [{ spr: 1408 }], layer: 'rear' },
    { name: 'depot.road.se.front', cite: 'base-1309-road-infra.pnml: 1409 road depot se part 2', layers: [{ spr: 1409, dx: 15 }], layer: 'front' },
    { name: 'depot.road.sw.building', cite: 'base-1309-road-infra.pnml: 1410 road depot sw part 1', layers: [{ spr: 1410 }], layer: 'rear' },
    { name: 'depot.road.sw.front', cite: 'base-1309-road-infra.pnml: 1411 road depot sw part 2', layers: [{ spr: 1411, dy: 15 }], layer: 'front' },
    { name: 'depot.road.nw.building', cite: 'base-1309-road-infra.pnml: 1413 road depot nw', layers: [{ spr: 1413, dx: 15 }], layer: 'front' }
]

/** Where road stop parts A, B and C sit in the tile, per stop kind and facing. */
const ROADSTOP_PLACES: Record<string, [number, number][]> = {
    'bus.ne': [[2, 0], [13, 0], [0, 13]],
    'bus.se': [[0, 3], [0, 0], [13, 3]],
    'bus.sw': [[3, 15], [0, 0], [3, 0]],
    'bus.nw': [[15, 2], [0, 13], [0, 0]],
    'truck.ne': [[0, 15], [13, 0], [2, 0]],
    'truck.se': [[15, 3], [0, 0], [0, 3]],
    'truck.sw': [[3, 0], [0, 0], [3, 15]],
    'truck.nw': [[0, 0], [0, 13], [15, 2]]
}

/* ------------------------------------------------------------------------------------------
 * Extraction
 * ---------------------------------------------------------------------------------------- */

export interface AtlasSprite {
    x: number
    y: number
    w: number
    h: number
    ox: number
    oy: number
    layer?: 'rear' | 'front'
}

export interface Extraction {
    files: Record<string, Buffer>
    sprites: Record<string, AtlasSprite>
    width: number
    height: number
    warnings: string[]
}

interface Named {
    name: string
    cut: Cut
    frame: number
    layer?: 'rear' | 'front'
}

const PNML_FILES = [
    'sprites/templates/sprite_templates.pnml',
    'sprites/templates/tmpl_trains.nml',
    'sprites/base/base-0990-foundations.pnml',
    'sprites/base/base-1005-rail-infra.pnml',
    'sprites/base/base-1309-road-infra.pnml',
    'sprites/base/base-1440-houses.pnml',
    'sprites/base/base-1576-trees.pnml',
    'sprites/base/base-2011-industries.pnml',
    'sprites/base/base-2633-airports.pnml',
    'sprites/base/base-2692-roadstops-docks.pnml',
    'sprites/base/base-2733-rail-vehicles-wagons.pnml',
    'sprites/base/base-2905-rail-vehicles-engines.pnml',
    'sprites/base/base-3092-road-vehicles.pnml',
    'sprites/base/base-3924-terrain.pnml',
    'sprites/base/base-4061-water.pnml',
    'sprites/extra/extra-shores.pnml',
    'sprites/extra/extra-signals.pnml'
]

/** Builds the palette of one water animation frame by rotating the water colours. */
function framePalette(base: number[], frame: number): number[] {
    const palette = base.slice()
    if (frame === 0) return palette
    const pos = frame * WATER_GROUP_SIZE
    const step = Math.floor(pos / WATER_FRAMES)
    const r = pos % WATER_FRAMES
    for (const g of WATER_GROUPS) {
        for (let i = 0; i < WATER_GROUP_SIZE; i++) {
            const a = base[g + (i + step) % WATER_GROUP_SIZE] as number
            const b = base[g + (i + step + 1) % WATER_GROUP_SIZE] as number
            let c = 0
            for (const shift of [16, 8, 0]) {
                const ca = (a >> shift) & 255
                const cb = (b >> shift) & 255
                c |= ((ca * (WATER_FRAMES - r) + cb * r + WATER_FRAMES / 2) >> 3) << shift
            }
            palette[g + i] = c
        }
    }
    return palette
}

function keyOf(cut: Cut, frame: number): string {
    return `${cut.w}x${cut.h}/${frame}/${createHash('sha1').update(cut.idx).digest('hex')}`
}

function readCredits(readme: string): string {
    const start = readme.indexOf('## 6.0 Credits')
    if (start < 0) throw new Error('OpenGFX README has no credits section')
    const lines = readme.slice(start).split('\n').slice(1)
    const kept: string[] = []
    for (const line of lines) {
        if (line.startsWith('## ') || line.startsWith('Contact:')) break
        kept.push(line)
    }
    return kept.join('\n').trim()
}

function buildReadme(commit: string, commitDate: string, credits: string): string {
    return [
        '# OpenGFX graphics for Rail Tycoon',
        '',
        'The files in this directory (`atlas.png`, `mask.png`, `atlas.json`) are graphics from',
        '[OpenGFX](' + OPENGFX_URL + '), the free base graphics set for OpenTTD, by the OpenGFX team.',
        '',
        '## License',
        '',
        'These files are licensed under the GNU General Public License version 2 (GPL-2.0); the',
        'full text is in `COPYING`, taken from OpenGFX. The rest of Polynux is MIT licensed; the',
        'GPL covers only the files in this directory, the script that produces them, and the',
        'derived files listed below.',
        '',
        '## Derived files',
        '',
        '`' + COVER_IMAGE_PATH + '`, the game\'s cover image, is drawn from `atlas.png` by',
        '`' + COVER_SCRIPT_PATH + '` and is GPL-2.0 as well.',
        '',
        '## Modification notice',
        '',
        'These files are modified from OpenGFX: sprites were cut from its 8-bit PNGs using its own',
        'pnml sprite definitions, recombined (grounds and buildings composited, station and depot',
        'parts placed in their tile, water frames made by rotating the water palette colours) and',
        'converted to RGBA, with the company-colour pixels written to `mask.png`, by',
        '`' + SCRIPT_PATH + '`.',
        '',
        'Corresponding source: that script, in this repository, together with OpenGFX at',
        `commit \`${commit}\` (committed ${commitDate}) from ${OPENGFX_URL}.`,
        'Run `bun scripts/rail-tycoon/extract-opengfx.ts` to rebuild these files; the same commit gives',
        'byte-identical output.',
        '',
        '## OpenGFX credits',
        '',
        'From the OpenGFX README:',
        '',
        credits,
        ''
    ].join('\n')
}

/** Cuts every sprite and builds the atlas, mask, json, README and COPYING in memory. */
export function extractOpenGfx(sourceDir: string, source: { commit: string, commitDate: string }): Extraction {
    const pnml = createPnml()
    for (const file of PNML_FILES) parsePnml(readFileSync(join(sourceDir, file), 'utf8'), pnml, file)
    const images = new ImageSource(sourceDir)
    const warnings: string[] = []

    // base-set number to sprite entry
    const base = new Map<number, SpriteEntry>()
    for (const block of pnml.blocks) {
        if (block.kind !== 'base_graphics') continue
        blockSprites(block, pnml).forEach((entry, k) => base.set(block.base + k, entry))
    }
    const baseCut = (spr: number): Cut => {
        const entry = base.get(spr)
        if (!entry) throw new Error(`Base sprite ${spr} is not defined in the pnml files read`)
        return cutEntry(entry, images)
    }

    const named: Named[] = []
    const add = (name: string, cut: Cut, frame = 0, layer?: 'rear' | 'front') => {
        named.push({ name, cut: trim(cut), frame, layer })
    }
    const addRange = (names: (string | string[] | null)[], cuts: Cut[], frames: boolean, cite: string) => {
        if (cuts.length < names.length) throw new Error(`${cite}: expected ${names.length} sprites, found ${cuts.length}`)
        names.forEach((n, k) => {
            if (n === null) return
            for (const name of Array.isArray(n) ? n : [n]) {
                if (frames) {
                    for (let f = 0; f < WATER_FRAMES; f++) add(`${name}.${f}`, cuts[k] as Cut, f)
                } else {
                    add(name, cuts[k] as Cut)
                }
            }
        })
    }

    for (const range of [...RANGES, ...WATER]) {
        const cuts = range.names.map((_, k) => baseCut(range.first + k))
        addRange(range.names, cuts, range.frames === true, range.cite)
    }
    for (const extra of EXTRAS) {
        const block = pnml.blocks.find(b => b.kind === 'replacenew' && b.label === extra.label && b.condition === extra.condition && b.source === extra.file)
        if (!block) throw new Error(`${extra.cite}: block ${extra.label} not found`)
        const entries = blockSprites(block, pnml)
        const cuts = extra.names.map((_, k) => {
            const entry = entries[extra.first + k]
            if (!entry) throw new Error(`${extra.cite}: sprite ${extra.first + k} missing`)
            return cutEntry(entry, images)
        })
        addRange(extra.names, cuts, extra.frames === true, extra.cite)
    }

    for (const spec of [...HOUSES, ...PARTS]) {
        const layers = spec.layers.map(l => ({ cut: baseCut(l.spr), ...worldShift(l.dx ?? 0, l.dy ?? 0, l.dz ?? 0) }))
        add(spec.name, composite(layers), 0, spec.layer)
    }
    for (const t of INDUSTRY_TILES) {
        const layers = [{ cut: baseCut(t.ground), dx: 0, dy: 0 }]
        if (t.building !== undefined) layers.push({ cut: baseCut(t.building), ...worldShift(t.dx ?? 0, t.dy ?? 0) })
        add(`industry.${t.industry}.${t.tile}`, composite(layers))
    }
    for (const [key, places] of Object.entries(ROADSTOP_PLACES)) {
        places.forEach(([dx, dy], k) => {
            const part = 'abc'[k] as string
            const index = named.findIndex(n => n.name === `roadstop.${key}.${part}`)
            const entry = named[index] as Named
            const shift = worldShift(dx, dy)
            entry.cut = { ...entry.cut, ox: entry.cut.ox + shift.dx, oy: entry.cut.oy + shift.dy }
            entry.layer = dx >= 8 || dy >= 8 ? 'front' : 'rear'
        })
    }

    // check the indices every sprite uses
    const palette = images.palette as number[]
    const dummy = new Map<number, Set<string>>()
    for (const n of named) {
        for (const v of n.cut.idx) {
            if (v !== 0 && palette[v] === 0x0000ff) throw new Error(`${n.name}: an opaque pixel is pure blue`)
            if ((v >= 1 && v <= 9) || (v >= 246 && v <= 254)) {
                const users = dummy.get(v) ?? new Set<string>()
                users.add(n.name)
                dummy.set(v, users)
            }
        }
    }
    for (const [v, users] of dummy) warnings.push(`palette index ${v} (unused) in ${[...users].join(', ')}: drawn transparent`)

    // unique images, packed onto shelves from tallest to shortest
    const unique = new Map<string, { cut: Cut, frame: number, x: number, y: number }>()
    for (const n of named) {
        const key = keyOf(n.cut, n.frame)
        if (!unique.has(key)) unique.set(key, { cut: n.cut, frame: n.frame, x: 0, y: 0 })
    }
    const order = [...unique.entries()].sort((a, b) => b[1].cut.h - a[1].cut.h || b[1].cut.w - a[1].cut.w || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    let x = 0
    let y = 0
    let shelf = 0
    for (const [, u] of order) {
        if (u.cut.w + PADDING > ATLAS_WIDTH) throw new Error('A sprite is wider than the atlas')
        if (x + u.cut.w + PADDING > ATLAS_WIDTH) {
            x = 0
            y += shelf
            shelf = 0
        }
        u.x = x + PADDING
        u.y = y + PADDING
        x += u.cut.w + PADDING
        shelf = Math.max(shelf, u.cut.h + PADDING)
    }
    const width = ATLAS_WIDTH
    const height = y + shelf + PADDING

    const palettes = Array.from({ length: WATER_FRAMES }, (_, f) => framePalette(palette, f))
    const rgba = Buffer.alloc(width * height * 4)
    const mask = Buffer.alloc(width * height)
    for (const [, u] of order) {
        const pal = palettes[u.frame] as number[]
        for (let py = 0; py < u.cut.h; py++) {
            for (let px = 0; px < u.cut.w; px++) {
                const v = u.cut.idx[py * u.cut.w + px] as number
                if (v === 0 || dummy.has(v)) continue
                const o = (u.y + py) * width + u.x + px
                const c = pal[v] as number
                rgba[o * 4] = (c >> 16) & 255
                rgba[o * 4 + 1] = (c >> 8) & 255
                rgba[o * 4 + 2] = c & 255
                rgba[o * 4 + 3] = 255
                if (v >= CC_FIRST && v <= CC_LAST) mask[o] = (v - CC_FIRST + 1) * 32 - 1
            }
        }
    }

    const sprites: Record<string, AtlasSprite> = {}
    for (const n of [...named].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        if (sprites[n.name]) throw new Error(`Duplicate sprite name ${n.name}`)
        const u = unique.get(keyOf(n.cut, n.frame)) as { x: number, y: number }
        const s: AtlasSprite = { x: u.x, y: u.y, w: n.cut.w, h: n.cut.h, ox: n.cut.ox, oy: n.cut.oy }
        if (n.layer) s.layer = n.layer
        sprites[n.name] = s
    }

    const json = {
        meta: {
            source: 'OpenGFX',
            url: OPENGFX_URL,
            commit: source.commit,
            commitDate: source.commitDate,
            license: 'GPL-2.0',
            generator: SCRIPT_PATH,
            image: 'atlas.png',
            mask: 'mask.png',
            size: { w: width, h: height },
            anchor: 'Draw a sprite with its top-left pixel at (anchor.x + ox, anchor.y + oy). A tile sprite anchors at the north (top) corner of the tile diamond at the tile height, a vehicle at its own position.',
            tile: { w: 64, h: 32, heightStep: 8 },
            maskEncoding: 'mask.png is one channel: 0 outside the company colour; shade s (0 dark to 7 light) is stored as (s + 1) * 32 - 1.',
            waterFrames: WATER_FRAMES,
            directions: DIRECTIONS,
            slopes: Object.fromEntries(SLOPES.map(s => [s.name, { corners: s.corners, steep: s.steep }])),
            railPieces: { x: 'NE-SW straight', y: 'NW-SE straight', n: 'north corner', s: 'south corner', e: 'east corner', w: 'west corner' },
            roadBits: 'road.<grass|town>.<bits>: the half-tile pieces present, from ne, se, sw, nw, joined by -; slope-<ne|se|sw|nw> are the ramps',
            layers: 'Parts marked rear are drawn before a vehicle on the tile, front after it.',
            industryLayouts: INDUSTRY_LAYOUTS
        },
        sprites
    }

    const atlasPng = new PNG({ width, height })
    atlasPng.data = rgba
    const maskPng = new PNG({ width, height })
    maskPng.data = mask
    const readme = readFileSync(join(sourceDir, 'README.md'), 'utf8')
    return {
        files: {
            'atlas.png': PNG.sync.write(atlasPng, { colorType: 6, inputColorType: 6, inputHasAlpha: true }),
            'mask.png': PNG.sync.write(maskPng, { colorType: 0, inputColorType: 0, inputHasAlpha: false }),
            'atlas.json': Buffer.from(JSON.stringify(json, null, 1) + '\n'),
            'COPYING': readFileSync(join(sourceDir, 'LICENSE')),
            'README.md': Buffer.from(buildReadme(source.commit, source.commitDate, readCredits(readme)))
        },
        sprites,
        width,
        height,
        warnings
    }
}

function main(): void {
    const args = process.argv.slice(2)
    const option = (name: string): string | undefined => {
        const k = args.indexOf(name)
        return k >= 0 ? args[k + 1] : undefined
    }
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const sourceDir = resolve(option('--source') ?? process.env.OPENGFX_DIR ?? defaultSourceDir())
    const outDir = resolve(option('--out') ?? join(repoRoot, 'public', 'rail-tycoon', 'opengfx'))
    const source = ensureSource(sourceDir)
    const result = extractOpenGfx(sourceDir, source)
    mkdirSync(outDir, { recursive: true })
    for (const [name, data] of Object.entries(result.files)) {
        writeFileSync(join(outDir, name), data)
        const sum = createHash('sha256').update(data).digest('hex')
        console.log(`${sum}  ${relative(repoRoot, join(outDir, name))} (${data.length} bytes)`)
    }
    console.log(`${Object.keys(result.sprites).length} sprites in a ${result.width}x${result.height} atlas`)
    for (const w of result.warnings) console.warn(`warning: ${w}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
