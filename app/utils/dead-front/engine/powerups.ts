import * as THREE from 'three'
import type { DfPowerupKind } from '#shared/utils/dead-front/constants'
import type { DfPowerupSnap } from '#shared/utils/dead-front/protocol'
import type { DfRenderContext } from '../context'
import { dfVoxMaterial } from '../voxel/material'
import { DfVoxModel } from '../voxel/model'

// Dropped power-ups: spinning voxel tokens (a glowing gold ring around the
// icon: cartridges, x2, a skull, a shell, a hammer) with a blocky halo and a
// golden shimmer; they pop in, bob, and blink faster as they run out.

export const DF_POWERUP_NAMES: Record<DfPowerupKind, string> = {
    maxammo: 'Max Ammo',
    double: 'Double Points',
    insta: 'Insta-Kill',
    nuke: 'Barrage',
    carpenter: 'Carpenter'
}

const KINDS: DfPowerupKind[] = ['maxammo', 'double', 'insta', 'nuke', 'carpenter']

/** Draws a power-up icon (also used by the HUD via toDataURL). */
export function dfDrawPowerupIcon(g: CanvasRenderingContext2D, kind: DfPowerupKind, size: number, fg: string, bg: string | null): void {
    const s = size
    g.save()
    if (bg) {
        g.fillStyle = bg
        g.beginPath()
        g.arc(s / 2, s / 2, s * 0.48, 0, Math.PI * 2)
        g.fill()
    }
    g.fillStyle = fg
    g.strokeStyle = fg
    g.lineCap = 'round'
    g.lineJoin = 'round'
    const cx = s / 2
    const cy = s / 2
    switch (kind) {
        case 'maxammo': {
            // three cartridges
            for (let i = -1; i <= 1; i++) {
                const x = cx + i * s * 0.17
                g.fillRect(x - s * 0.055, cy - s * 0.08, s * 0.11, s * 0.3)
                g.beginPath()
                g.moveTo(x - s * 0.055, cy - s * 0.08)
                g.quadraticCurveTo(x, cy - s * 0.32, x + s * 0.055, cy - s * 0.08)
                g.fill()
                g.fillRect(x - s * 0.07, cy + s * 0.2, s * 0.14, s * 0.04)
            }
            break
        }
        case 'double': {
            g.font = `700 ${s * 0.5}px Georgia, serif`
            g.textAlign = 'center'
            g.textBaseline = 'middle'
            g.fillText('×2', cx, cy + s * 0.02)
            break
        }
        case 'insta': {
            // skull
            g.beginPath()
            g.ellipse(cx, cy - s * 0.05, s * 0.24, s * 0.22, 0, 0, Math.PI * 2)
            g.fill()
            g.fillRect(cx - s * 0.14, cy + s * 0.08, s * 0.28, s * 0.16)
            g.globalCompositeOperation = 'destination-out'
            g.beginPath()
            g.ellipse(cx - s * 0.1, cy - s * 0.04, s * 0.07, s * 0.08, 0, 0, Math.PI * 2)
            g.ellipse(cx + s * 0.1, cy - s * 0.04, s * 0.07, s * 0.08, 0, 0, Math.PI * 2)
            g.fill()
            g.beginPath()
            g.moveTo(cx, cy + s * 0.04)
            g.lineTo(cx - s * 0.035, cy + s * 0.1)
            g.lineTo(cx + s * 0.035, cy + s * 0.1)
            g.fill()
            for (let i = -1; i <= 1; i++) g.fillRect(cx + i * s * 0.07 - s * 0.012, cy + s * 0.15, s * 0.024, s * 0.09)
            g.globalCompositeOperation = 'source-over'
            break
        }
        case 'nuke': {
            // artillery shell
            g.beginPath()
            g.moveTo(cx - s * 0.12, cy + s * 0.26)
            g.lineTo(cx - s * 0.12, cy - s * 0.06)
            g.quadraticCurveTo(cx, cy - s * 0.42, cx + s * 0.12, cy - s * 0.06)
            g.lineTo(cx + s * 0.12, cy + s * 0.26)
            g.closePath()
            g.fill()
            g.globalCompositeOperation = 'destination-out'
            g.fillRect(cx - s * 0.13, cy + s * 0.1, s * 0.26, s * 0.035)
            g.globalCompositeOperation = 'source-over'
            break
        }
        case 'carpenter': {
            // hammer
            g.lineWidth = s * 0.08
            g.beginPath()
            g.moveTo(cx - s * 0.18, cy + s * 0.26)
            g.lineTo(cx + s * 0.08, cy - s * 0.1)
            g.stroke()
            g.save()
            g.translate(cx + s * 0.1, cy - s * 0.13)
            g.rotate(-0.93 + Math.PI / 2)
            g.fillRect(-s * 0.2, -s * 0.07, s * 0.36, s * 0.14)
            g.restore()
            break
        }
    }
    g.restore()
}

/** The voxel token for one power-up: a gold ring with the icon standing inside it. */
export function dfPowerupModel(kind: DfPowerupKind): DfVoxModel {
    const N = 17
    const m = new DfVoxModel(N, N, 3)
    const gold = m.c(0xd9a838, 0.35)
    const goldD = m.c(0x9a6a1c, 0.2)
    const c = (N - 1) / 2
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            const d = Math.hypot(i - c, j - c)
            if (d <= 8.3 && d > 6.9) m.box(i, j, 0, i + 1, j + 1, 3, (i + j) % 5 === 0 ? goldD : gold)
        }
    }
    // Icons as 11 x 11 pixel art (top row first), drawn one voxel proud of the ring's centre.
    const ICONS: Record<DfPowerupKind, string[]> = {
        maxammo: [
            '...........',
            '..t..t..t..',
            '.ttttttttt.',
            '.ttttttttt.',
            '.bbb.bbb.bb',
            '.bbb.bbb.bb',
            '.bbb.bbb.bb',
            '.bbb.bbb.bb',
            '.bbb.bbb.bb',
            '.ddd.ddd.dd',
            '...........'
        ],
        double: [
            '...........',
            '......rrrr.',
            '.....r....r',
            '..........r',
            'r...r....r.',
            '.r.r....r..',
            '..r....r...',
            '.r.r..r....',
            'r...r.rrrrr',
            '...........',
            '...........'
        ],
        insta: [
            '...wwwww...',
            '..wwwwwww..',
            '.wwwwwwwww.',
            '.weewwweew.',
            '.weewwweew.',
            '.wwwwkwwww.',
            '..wwkkkww..',
            '...wwwww...',
            '...wkwkw...',
            '...wwwww...',
            '...........'
        ],
        nuke: [
            '.....f.....',
            '....ooo....',
            '...ooooo...',
            '...ooooo...',
            '...fffff...',
            '...ooooo...',
            '...ooooo...',
            '...ooooo...',
            '...bbbbb...',
            '..bbbbbbb..',
            '...........'
        ],
        carpenter: [
            '...........',
            '....iiiiii.',
            '...iiiiiii.',
            '....ii.....',
            '.....hh....',
            '....hh.....',
            '...hh......',
            '..hh.......',
            '.hh........',
            'hh.........',
            '...........'
        ]
    }
    const key: Record<string, number> = {
        t: m.c(0xd07a3c, 0.5), b: m.c(0xe8bc50, 0.55), d: m.c(0x9a6a1c, 0.35), r: m.c(0xff4a30, 0.75),
        w: m.c(0xf2e8cc, 0.5), e: m.c(0xff2a1a, 1), k: m.c(0x241812), o: m.c(0x8a9a52, 0.4), f: m.c(0xff6a24, 0.9),
        i: m.c(0xc8ccd4, 0.55), h: m.c(0xc08a4a, 0.45)
    }
    const rows = ICONS[kind]
    rows.forEach((row, r) => {
        for (let i = 0; i < row.length; i++) {
            const v = key[row[i]!]
            if (v) m.box(3 + i, 13 - r, 1, 4 + i, 14 - r, 2, v)
        }
    })
    return m
}

const CELL = 0.042

interface Token {
    id: number
    kind: DfPowerupKind
    root: THREE.Group
    spin: THREE.Group
    halo: THREE.Sprite
    shimmer: number
    seen: boolean
    phase: number
    born: number
}

export interface DfPowerupView {
    update(dt: number, time: number, list: readonly DfPowerupSnap[]): void
    dispose(): void
}

function haloTexture(): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')!
    // A soft square glow, quantised into rings so it reads blocky like everything else.
    for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
            const d = Math.max(Math.abs(x - 31.5), Math.abs(y - 31.5)) / 32
            const r = Math.hypot(x - 31.5, y - 31.5) / 32
            const k = Math.floor(Math.max(0, 1 - (d * 0.4 + r * 0.6)) * 8) / 8
            g.fillStyle = `rgba(255,${200 + Math.round(k * 40)},${110 + Math.round(k * 60)},${(k * k * 0.9).toFixed(3)})`
            g.fillRect(x, y, 1, 1)
        }
    }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.magFilter = THREE.NearestFilter
    return t
}

export function createDfPowerupView(ctx: DfRenderContext): DfPowerupView {
    const mat = dfVoxMaterial({ glow: 1 })
    mat.name = 'df-powerups'
    const geos = new Map<DfPowerupKind, THREE.BufferGeometry>()
    for (const k of KINDS) {
        const g = dfPowerupModel(k).mesh(CELL, [8.5, 8.5, 1.5])
        if (g) geos.set(k, g)
    }
    const haloTex = haloTexture()
    const haloMat = new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(1.6, 1.25, 0.6) })
    const tokens = new Map<number, Token>()

    function build(p: DfPowerupSnap, time: number): Token {
        const root = new THREE.Group()
        root.name = `df-powerup-${p.id}`
        const spin = new THREE.Group()
        root.add(spin)
        const geo = geos.get(p.kind) ?? geos.get('maxammo')!
        const mesh = new THREE.Mesh(geo, mat)
        mesh.castShadow = false
        spin.add(mesh)
        const halo = new THREE.Sprite(haloMat)
        halo.scale.setScalar(1.3)
        halo.renderOrder = 2
        root.add(halo)
        ctx.scene.add(root)
        return { id: p.id, kind: p.kind, root, spin, halo, shimmer: 0, seen: true, phase: Math.random() * 6, born: time }
    }

    const tmp = new THREE.Vector3()

    return {
        update(dt, time, list) {
            for (const t of tokens.values()) t.seen = false
            mat.userData.uGlow.value = 1.15 + Math.sin(time * 3.2) * 0.25
            for (const p of list) {
                let t = tokens.get(p.id)
                if (!t) {
                    t = build(p, time)
                    tokens.set(p.id, t)
                    ctx.fx.burst('powerup', p.pos, { scale: 1.6, count: 20 })
                }
                t.seen = true
                const bob = Math.sin(time * 2.2 + t.phase) * 0.08
                // Pops in with an overshoot, then floats and spins.
                const a = Math.min(1, (time - t.born) / 0.45)
                const u = a - 1
                const pop = 1 + 2.7 * u * u * u + 1.7 * u * u
                t.root.position.set(p.pos.x, p.pos.y + 0.95 + bob, p.pos.z)
                t.spin.rotation.y = time * 2.0 + t.phase
                t.spin.scale.setScalar(Math.max(0.001, pop))
                // Blink faster as it runs out.
                let visible = true
                if (p.expiresIn < 6) {
                    const hz = p.expiresIn < 2.5 ? 8 : 3.5
                    visible = Math.sin(time * hz * Math.PI * 2) > -0.2
                }
                t.root.visible = visible
                t.halo.scale.setScalar((1.2 + Math.sin(time * 4 + t.phase) * 0.08) * Math.max(0.001, pop))
                t.shimmer -= dt
                if (t.shimmer <= 0 && visible) {
                    t.shimmer = 0.22
                    tmp.set(p.pos.x, p.pos.y + 0.6 + bob, p.pos.z)
                    ctx.fx.burst('powerup', tmp, { count: 3 })
                }
            }
            for (const [id, t] of tokens) {
                if (t.seen) continue
                ctx.scene.remove(t.root)
                tokens.delete(id)
            }
        },
        dispose() {
            for (const t of tokens.values()) ctx.scene.remove(t.root)
            tokens.clear()
            for (const g of geos.values()) g.dispose()
            mat.dispose()
            haloMat.dispose()
            haloTex?.dispose()
        }
    }
}
